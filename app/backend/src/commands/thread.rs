//! Thread IPC — 对话线程 CRUD。
//!
//! `thread_delete` 顺带清 `AgentManager` 的 in-memory 状态 (与该 thread 关联的
//! read 工具快照 + 卡死检测计数), 否则会无限泄露。

use serde::Serialize;
use tauri::State;

use crate::agent::default_agent_id;
use crate::threads::{ChatMessage, ThreadInfo};

use super::AppState;

#[derive(Serialize)]
pub struct GetThreadResponse {
    pub messages: Vec<ChatMessage>,
}

#[tauri::command]
pub async fn thread_list(state: State<'_, AppState>) -> Result<Vec<ThreadInfo>, String> {
    let manager = state.thread_manager.read().await;
    manager.list_threads().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn thread_create(
    title: String,
    state: State<'_, AppState>,
) -> Result<ThreadInfo, String> {
    let manager = state.thread_manager.read().await;
    // agent_id 列保留以兼容旧 schema, 统一用 default_agent_id() 占位 ─ 见 agent.rs。
    manager
        .create_thread(default_agent_id(), title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn thread_get(
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<GetThreadResponse, String> {
    let manager = state.thread_manager.read().await;
    match manager.get_thread(&thread_id).await.map_err(|e| e.to_string())? {
        Some(thread) => Ok(GetThreadResponse {
            messages: thread.messages,
        }),
        None => Err("Thread not found".to_string()),
    }
}

#[tauri::command]
pub async fn thread_delete(thread_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    // 先清 AgentManager 的 in-memory 状态 ── 与该 thread 关联的 read 工具快照
    // (HashMap<thread_id, HashMap<path, full_file_content>>, 整本笔记本大小)
    // 与卡死检测计数, 否则会无限泄露。两张表独立 HashMap.remove, 总是成功。
    //
    // `agent_manager` 是 `Arc<AgentManager>`, `cleanup_thread` 是 `&self` 方法,
    // 直接调用即可, 不再需要 `.write().await` 包装。
    state.agent_manager.cleanup_thread(&thread_id).await;
    let manager = state.thread_manager.read().await;
    manager.delete_thread(&thread_id).await.map_err(|e| e.to_string())
}
