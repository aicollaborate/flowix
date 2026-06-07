//! Agent IPC — LLM 流式 chat + abort。
//!
//! Agent 的配置真源是 `~/.flowix/ai_config.json` (经 `set_ai_config` 命令落盘)。
//! 后端按需从 `UserConfigStore` 拉取并在 `AgentManager` 里缓存 provider 实例,
//! 前端不再 init agent / 提交模型信息, 只发起 chat / thread 操作。

use tauri::State;

use crate::agent::{AgentChatResponse, AgentUserMessage};

use super::AppState;

#[tauri::command]
#[allow(non_snake_case)]
pub async fn chat_with_agent_stream(
    threadId: String,
    message: AgentUserMessage,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AgentChatResponse, String> {
    tracing::info!(
        "[Command] chat_with_agent_stream called for thread: {}",
        threadId
    );
    // `agent_manager` 现在是 `Arc<AgentManager>` 而非 `RwLock<AgentManager>`, 直接调用即可。
    // chat_stream 的所有内部可变性都通过 HashMap 自己的 RwLock 保护, 不需要外层包装。
    //
    // Tauri IPC 边界仍要求 `Result<T, String>` ── `AgentError` 在此
    // `.map_err(|e| e.to_string())` 透传, 错误前缀 (thread/user_config/llm/...)
    // 自动带到前端。
    let result = state
        .agent_manager
        .chat_stream(&threadId, message, &app_handle)
        .await;
    tracing::info!(
        "[Command] chat_with_agent_stream result: {:?}",
        result.is_ok()
    );
    result
        .map(|response| AgentChatResponse { response })
        .map_err(|e| e.to_string())
}

/// Frontend-initiated abort for an in-flight `chat_with_agent_stream`.
/// Returns `true` if a chat was actually running for this `threadId` and
/// got a cancel signal; `false` if there was nothing to cancel (e.g. user
/// clicked stop after the LLM had already finished, or never sent a
/// message). The frontend uses the boolean to decide whether to also
/// hide the stop button / show a toast — a `false` return is harmless.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn stop_agent_stream(
    threadId: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    tracing::info!("[Command] stop_agent_stream called for thread: {}", threadId);
    let signalled = state.agent_manager.stop_chat(&threadId).await;
    tracing::info!(
        "[Command] stop_agent_stream result: {} (chat was {}running)",
        threadId,
        if signalled { "" } else { "not " }
    );
    Ok(signalled)
}
