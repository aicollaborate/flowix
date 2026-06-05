use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

pub struct UserSetting {
    pub key: String,
    pub value: String,
}

impl Database {
    pub fn get_user_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT value FROM user_settings WHERE key = ?")
            .ok()?;
        let result = stmt.query_row([key], |row| row.get(0)).ok()?;
        Some(result)
    }

    pub fn get_all_user_settings(&self) -> Vec<UserSetting> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT key, value FROM user_settings")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok(UserSetting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn set_user_setting(&self, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            [key, value, &now.to_string()],
        )
        .unwrap();
    }

    pub fn delete_user_setting(&self, key: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let result = conn.execute("DELETE FROM user_settings WHERE key = ?", [key]);
        result.map(|r| r > 0).unwrap_or(false)
    }
}
