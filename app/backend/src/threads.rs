use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub thread_id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub llm_content: Option<String>,
    pub system_reminder_directory: Option<String>,
    pub timestamp: String,
    pub is_loading: Option<bool>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_data: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub reasoning: Option<String>,
    pub is_completed: Option<bool>,
    pub is_collapsed: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Thread {
    pub info: ThreadInfo,
    pub messages: Vec<ChatMessage>,
}

pub struct ThreadManager {
    conn: Mutex<Connection>,
}

impl ThreadManager {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS threads (
                thread_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS thread_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                llm_content TEXT,
                system_reminder_directory TEXT,
                timestamp TEXT NOT NULL,
                is_loading INTEGER,
                tool_call_id TEXT,
                tool_name TEXT,
                tool_data TEXT,
                tool_input TEXT,
                reasoning TEXT,
                is_completed INTEGER,
                is_collapsed INTEGER,
                sequence INTEGER NOT NULL,
                FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_sequence
                ON thread_messages(thread_id, sequence);
            ",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn list_threads(&self) -> Result<Vec<ThreadInfo>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT thread_id, agent_id, title, created_at, updated_at
                 FROM threads
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ThreadInfo {
                    thread_id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub async fn create_thread(
        &self,
        agent_id: String,
        title: String,
    ) -> Result<ThreadInfo, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let thread_id = format!("thread_{}", now);

        let info = ThreadInfo {
            thread_id: thread_id.clone(),
            agent_id,
            title,
            created_at: now,
            updated_at: now,
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO threads (thread_id, agent_id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                info.thread_id,
                info.agent_id,
                info.title,
                info.created_at,
                info.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(info)
    }

    pub async fn get_thread(&self, thread_id: &str) -> Result<Option<Thread>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let info = conn
            .query_row(
                "SELECT thread_id, agent_id, title, created_at, updated_at
                 FROM threads
                 WHERE thread_id = ?1",
                [thread_id],
                |row| {
                    Ok(ThreadInfo {
                        thread_id: row.get(0)?,
                        agent_id: row.get(1)?,
                        title: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(info) = info else {
            return Ok(None);
        };

        let mut stmt = conn
            .prepare(
                "SELECT id, role, content, llm_content, system_reminder_directory, timestamp,
                        is_loading, tool_call_id, tool_name, tool_data, tool_input, reasoning,
                        is_completed, is_collapsed
                 FROM thread_messages
                 WHERE thread_id = ?1
                 ORDER BY sequence ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([thread_id], Self::row_to_message)
            .map_err(|e| e.to_string())?;
        let messages = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(Some(Thread { info, messages }))
    }

    pub async fn add_message(&self, thread_id: &str, message: ChatMessage) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sequence: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM thread_messages WHERE thread_id = ?1",
                [thread_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO thread_messages (
                id, thread_id, role, content, llm_content, system_reminder_directory, timestamp,
                is_loading, tool_call_id, tool_name, tool_data, tool_input, reasoning,
                is_completed, is_collapsed, sequence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                message.id,
                thread_id,
                message.role,
                message.content,
                message.llm_content,
                message.system_reminder_directory,
                message.timestamp,
                opt_bool_to_int(message.is_loading),
                message.tool_call_id,
                message.tool_name,
                message.tool_data,
                message.tool_input.map(|v| v.to_string()),
                message.reasoning,
                opt_bool_to_int(message.is_completed),
                opt_bool_to_int(message.is_collapsed),
                sequence,
            ],
        )
        .map_err(|e| e.to_string())?;
        self.touch_thread(&conn, thread_id, now)?;
        Ok(())
    }

    pub async fn update_tool_result(
        &self,
        thread_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        result_content: &str,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE thread_messages
             SET content = ?1, tool_data = ?1, tool_name = ?2, is_loading = 0
             WHERE thread_id = ?3 AND role = 'tool' AND tool_call_id = ?4",
            params![result_content, tool_name, thread_id, tool_call_id],
        )
        .map_err(|e| e.to_string())?;
        self.touch_thread(&conn, thread_id, now)?;
        Ok(())
    }

    pub async fn delete_thread(&self, thread_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn
            .execute("DELETE FROM threads WHERE thread_id = ?1", [thread_id])
            .map_err(|e| e.to_string())?;
        Ok(deleted > 0)
    }

    #[allow(dead_code)]
    pub async fn update_title(
        &self,
        thread_id: &str,
        title: String,
    ) -> Result<Option<ThreadInfo>, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE threads SET title = ?1, updated_at = ?2 WHERE thread_id = ?3",
            params![title, now, thread_id],
        )
        .map_err(|e| e.to_string())?;
        drop(conn);
        Ok(self.get_thread(thread_id).await?.map(|thread| thread.info))
    }

    fn touch_thread(
        &self,
        conn: &Connection,
        thread_id: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        conn.execute(
            "UPDATE threads SET updated_at = ?1 WHERE thread_id = ?2",
            params![updated_at, thread_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatMessage> {
        let tool_input_raw: Option<String> = row.get(10)?;
        Ok(ChatMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            llm_content: row.get(3)?,
            system_reminder_directory: row.get(4)?,
            timestamp: row.get(5)?,
            is_loading: int_to_opt_bool(row.get(6)?),
            tool_call_id: row.get(7)?,
            tool_name: row.get(8)?,
            tool_data: row.get(9)?,
            tool_input: tool_input_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
            reasoning: row.get(11)?,
            is_completed: int_to_opt_bool(row.get(12)?),
            is_collapsed: int_to_opt_bool(row.get(13)?),
        })
    }
}

fn opt_bool_to_int(value: Option<bool>) -> Option<i64> {
    value.map(|v| if v { 1 } else { 0 })
}

fn int_to_opt_bool(value: Option<i64>) -> Option<bool> {
    value.map(|v| v != 0)
}
