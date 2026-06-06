use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;

use crate::prompt::{build_system_prompt, SystemPromptConfig};
use crate::providers::{execute_tool, get_all_tools, OpenAIConfig, OpenAIProvider};
use crate::threads::ChatMessage as ThreadChatMessage;
use crate::user_config::AiModelConfig;
use rllm::chat::{ChatMessage as LlmChatMessage, ChatProvider, ChatRole, StreamChunk, Tool};

/// 线程表 `agent_id` 列的固定占位值。
///
/// 重构后前端不再传 agent_id ─ 整个应用同一时刻只有"当前 ai_config 描述的那一个
/// agent"。 schema 仍保留 agent_id 列以兼容历史数据, 全部写入此常量。
pub const DEFAULT_AGENT_ID: &str = "default";

/// AgentManager 现在只维护"当前生效的 provider 实例", 真正的配置真源是
/// `~/.woop/ai_config.json` (经 `UserConfigStore` 暴露)。每次 chat 调用前
/// 读最新配置, 与构建缓存的配置对比, 不一致则重建 provider。
///
/// 这样 ai_config 变更 (例如用户在偏好里换了模型 / API key) 不再依赖前端重新
/// "init agent", 后端自己感知并热替换。
pub struct AgentManager {
    instance: tokio::sync::RwLock<Option<CachedInstance>>,
    /// 每个 thread 的 read 工具快照。edit 工具需要 read 后的内容做漂移检测。
    read_snapshots: tokio::sync::RwLock<HashMap<String, HashMap<String, String>>>,
}

struct CachedInstance {
    config: AiModelConfig,
    instance: AgentInstance,
}

#[derive(Clone)]
pub struct AgentInstance {
    provider: Arc<dyn ChatProvider>,
    tools: Vec<Tool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserMessage {
    pub content: String,
    pub llm_content: Option<String>,
    pub system_reminder_directory: Option<String>,
}

#[derive(Serialize)]
pub struct AgentChatResponse {
    pub response: String,
}

fn tool_path_key(arguments: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Args {
        path: String,
    }

    let args = serde_json::from_str::<Args>(arguments).ok()?;
    let path = PathBuf::from(args.path);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    let normalized = std::fs::canonicalize(&resolved).unwrap_or(resolved);
    Some(normalized.display().to_string())
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            instance: tokio::sync::RwLock::new(None),
            read_snapshots: tokio::sync::RwLock::new(HashMap::new()),
        }
    }

    /// 拿到与当前 ai_config 对应的 provider 实例; 配置缺 model 则报错。
    ///
    /// 走双读锁: 先 read 尝试命中缓存, 不命中再升级到 write 重建。这样并发 chat
    /// 不会互相阻塞 — 只有真正发生配置变更时才有写锁竞争。
    async fn ensure_instance(&self, config: &AiModelConfig) -> Result<AgentInstance, String> {
        if config.model.trim().is_empty() {
            return Err("尚未配置模型, 请到偏好设置 → 智能体 填写 ai_config".to_string());
        }
        {
            let guard = self.instance.read().await;
            if let Some(cached) = guard.as_ref() {
                if &cached.config == config {
                    return Ok(cached.instance.clone());
                }
            }
        }
        let instance = Self::build_instance(config);
        let mut guard = self.instance.write().await;
        *guard = Some(CachedInstance {
            config: config.clone(),
            instance: instance.clone(),
        });
        Ok(instance)
    }

    fn build_instance(config: &AiModelConfig) -> AgentInstance {
        // Enable reasoning_split to separate thinking from final response
        let reasoning_split = config.model.contains("MiniMax");
        let system_prompt = build_system_prompt(SystemPromptConfig {
            model: &config.model,
            tools_enabled: true,
        });

        let provider = OpenAIProvider::new(
            OpenAIConfig::new(&config.api_key, &config.model, &config.api_url)
                .with_system(system_prompt)
                .with_reasoning_split(reasoning_split),
        );

        AgentInstance {
            provider: Arc::new(provider),
            tools: get_all_tools(),
        }
    }

    pub async fn chat(
        &self,
        thread_id: &str,
        message: AgentUserMessage,
        app_state: &crate::commands::AppState,
        app_handle: &tauri::AppHandle,
    ) -> Result<String, String> {
        let ai_config = app_state.user_config.get_ai_config().model;
        let instance = self.ensure_instance(&ai_config).await?;

        self.persist_user_message(thread_id, &message, app_state)
            .await?;
        let messages = self.load_thread_llm_messages(thread_id, app_state).await?;

        // Convert messages to rllm format
        let mut llm_messages: Vec<LlmChatMessage> = messages
            .iter()
            .map(|m| {
                let role = match m.role.as_str() {
                    "assistant" => ChatRole::Assistant,
                    _ => ChatRole::User,
                };
                LlmChatMessage {
                    role,
                    content: m.content.clone(),
                    message_type: Default::default(),
                }
            })
            .collect();

        // React loop: keep calling until no tool calls
        let max_cycles = 10;
        let mut text_response = String::new();

        for _cycle in 0..max_cycles {
            let response = instance
                .provider
                .chat_with_tools(&llm_messages, Some(&instance.tools))
                .await
                .map_err(|e| format!("Chat failed: {}", e))?;

            // Get text response
            if let Some(text) = response.text() {
                text_response = text;
            }

            // Check for tool calls
            let tool_calls = response.tool_calls();
            if tool_calls.is_none() || tool_calls.as_ref().map(|c| c.is_empty()).unwrap_or(true) {
                // No tool calls, return the text response
                break;
            }

            let calls = tool_calls.unwrap();

            // Execute each tool call and add results to messages
            for call in calls {
                let tool_result = self
                    .execute_tool_for_thread(
                        thread_id,
                        &call.function.name,
                        &call.function.arguments,
                        app_state,
                        Some(app_handle),
                    )
                    .await;

                // Add assistant tool call message
                llm_messages.push(LlmChatMessage {
                    role: ChatRole::Assistant,
                    content: String::new(),
                    message_type: rllm::chat::MessageType::ToolUse(vec![call]),
                });

                // Add user tool result message
                let result_json = serde_json::to_string(&tool_result)
                    .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string());
                llm_messages.push(LlmChatMessage {
                    role: ChatRole::User,
                    content: result_json.clone(),
                    message_type: rllm::chat::MessageType::ToolResult(vec![rllm::ToolCall {
                        id: format!("call_{}", chrono::Utc::now().timestamp_millis()),
                        call_type: "function".to_string(),
                        function: rllm::FunctionCall {
                            name: "tool_result".to_string(),
                            arguments: result_json,
                        },
                    }]),
                });
            }
        }

        self.flush_assistant_message(thread_id, &text_response, app_state)
            .await?;
        Ok(text_response)
    }

    pub async fn chat_stream(
        &self,
        thread_id: &str,
        message: AgentUserMessage,
        app_state: &crate::commands::AppState,
        app_handle: &tauri::AppHandle,
    ) -> Result<String, String> {
        let ai_config = app_state.user_config.get_ai_config().model;
        let instance = self.ensure_instance(&ai_config).await?;

        self.persist_user_message(thread_id, &message, app_state)
            .await?;
        let messages = self.load_thread_llm_messages(thread_id, app_state).await?;

        // Convert messages to rllm format
        let mut llm_messages: Vec<LlmChatMessage> = messages
            .iter()
            .map(|m| {
                let role = match m.role.as_str() {
                    "assistant" => ChatRole::Assistant,
                    _ => ChatRole::User,
                };
                LlmChatMessage {
                    role,
                    content: m.content.clone(),
                    message_type: Default::default(),
                }
            })
            .collect();

        // React loop with streaming
        let max_cycles = 10;
        let mut full_response = String::new();
        let mut reasoning_buffer = String::new();
        let mut assistant_buffer = String::new();

        tracing::debug!("[Agent] Starting chat_stream for thread_id: {}", thread_id);

        for _cycle in 0..max_cycles {
            reasoning_buffer.clear();
            assistant_buffer.clear();
            let mut hit_tool_call = false;
            let mut stream = instance
                .provider
                .chat_stream_with_tools(&llm_messages, Some(&instance.tools))
                .await
                .map_err(|e| format!("Stream failed: {}", e))?;

            // Process stream chunks
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        match chunk {
                            StreamChunk::Text(text) => {
                                tracing::debug!("[Agent] Emitting text chunk: {}", text);
                                // Emit chunk event for frontend
                                let _ = app_handle.emit("agent-chunk", &text);
                                if !text.starts_with("[REASONING]: ") {
                                    assistant_buffer.push_str(&text);
                                    full_response.push_str(&text);
                                } else {
                                    reasoning_buffer
                                        .push_str(text.trim_start_matches("[REASONING]: "));
                                }
                            }
                            StreamChunk::ToolUseComplete { tool_call, .. } => {
                                self.flush_reasoning_message(
                                    thread_id,
                                    &reasoning_buffer,
                                    app_state,
                                )
                                .await?;
                                reasoning_buffer.clear();
                                self.flush_assistant_message(
                                    thread_id,
                                    &assistant_buffer,
                                    app_state,
                                )
                                .await?;
                                assistant_buffer.clear();

                                let tool_input = serde_json::from_str::<serde_json::Value>(
                                    &tool_call.function.arguments,
                                )
                                .unwrap_or_else(|_| {
                                    serde_json::Value::String(tool_call.function.arguments.clone())
                                });
                                let tool_call_event = serde_json::json!({
                                    "id": tool_call.id,
                                    "name": tool_call.function.name,
                                    "input": tool_input,
                                });
                                let _ = app_handle.emit(
                                    "agent-chunk",
                                    format!("[TOOL_CALL]: {}", tool_call_event),
                                );
                                self.persist_tool_call(
                                    thread_id,
                                    &tool_call.id,
                                    &tool_call.function.name,
                                    tool_input,
                                    app_state,
                                )
                                .await?;

                                // Execute tool call
                                let tool_result = self
                                    .execute_tool_for_thread(
                                        thread_id,
                                        &tool_call.function.name,
                                        &tool_call.function.arguments,
                                        app_state,
                                        Some(app_handle),
                                    )
                                    .await;
                                let tool_result_event = serde_json::json!({
                                    "id": tool_call.id,
                                    "name": tool_call.function.name,
                                    "result": tool_result,
                                });
                                let _ = app_handle.emit(
                                    "agent-chunk",
                                    format!("[TOOL_RESULT]: {}", tool_result_event),
                                );
                                let result_json = serde_json::to_string_pretty(&tool_result)
                                    .unwrap_or_else(|_| {
                                        r#"{"error":"serialization failed"}"#.to_string()
                                    });
                                self.persist_tool_result(
                                    thread_id,
                                    &tool_call.id,
                                    &tool_call.function.name,
                                    &result_json,
                                    app_state,
                                )
                                .await?;

                                // Add messages for tool use
                                llm_messages.push(LlmChatMessage {
                                    role: ChatRole::Assistant,
                                    content: String::new(),
                                    message_type: rllm::chat::MessageType::ToolUse(vec![tool_call]),
                                });

                                let result_json = serde_json::to_string(&tool_result)
                                    .unwrap_or_else(|_| {
                                        r#"{"error":"serialization failed"}"#.to_string()
                                    });
                                llm_messages.push(LlmChatMessage {
                                    role: ChatRole::User,
                                    content: result_json.clone(),
                                    message_type: rllm::chat::MessageType::ToolResult(vec![
                                        rllm::ToolCall {
                                            id: format!(
                                                "call_{}",
                                                chrono::Utc::now().timestamp_millis()
                                            ),
                                            call_type: "function".to_string(),
                                            function: rllm::FunctionCall {
                                                name: "tool_result".to_string(),
                                                arguments: result_json,
                                            },
                                        },
                                    ]),
                                });

                                // Continue to next iteration to get final response
                                hit_tool_call = true;
                                break;
                            }
                            StreamChunk::Done { .. } => {
                                // Stream ended
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        return Err(format!("Stream error: {}", e));
                    }
                }
            }

            // Continue only when this cycle actually executed a tool. A cycle without
            // tool calls is the completion signal for the current ReAct task.
            if !hit_tool_call {
                self.flush_reasoning_message(thread_id, &reasoning_buffer, app_state)
                    .await?;
                self.flush_assistant_message(thread_id, &assistant_buffer, app_state)
                    .await?;
                break;
            }
        }

        Ok(full_response)
    }

    async fn persist_user_message(
        &self,
        thread_id: &str,
        message: &AgentUserMessage,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        let thread_message = ThreadChatMessage {
            id: format!("user_{}", chrono::Utc::now().timestamp_millis()),
            role: "user".to_string(),
            content: message.content.clone(),
            llm_content: message.llm_content.clone(),
            system_reminder_directory: message.system_reminder_directory.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            is_loading: None,
            tool_call_id: None,
            tool_name: None,
            tool_data: None,
            tool_input: None,
            reasoning: None,
            is_completed: None,
            is_collapsed: None,
        };
        self.add_thread_message(thread_id, thread_message, app_state)
            .await
    }

    async fn load_thread_llm_messages(
        &self,
        thread_id: &str,
        app_state: &crate::commands::AppState,
    ) -> Result<Vec<ChatMessage>, String> {
        let manager = app_state.thread_manager.read().await;
        let thread = manager
            .get_thread(thread_id)
            .await?
            .ok_or_else(|| format!("Thread not found: {}", thread_id))?;
        Ok(thread
            .messages
            .into_iter()
            .filter(|message| message.role == "user" || message.role == "assistant")
            .map(|message| ChatMessage {
                role: message.role,
                content: message.llm_content.unwrap_or(message.content),
            })
            .collect())
    }

    async fn add_thread_message(
        &self,
        thread_id: &str,
        message: ThreadChatMessage,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        let manager = app_state.thread_manager.read().await;
        manager.add_message(thread_id, message).await
    }

    async fn execute_tool_for_thread(
        &self,
        thread_id: &str,
        tool_name: &str,
        arguments: &str,
        app_state: &crate::commands::AppState,
        app_handle: Option<&tauri::AppHandle>,
    ) -> crate::providers::tools::ToolResult {
        let path_key = tool_path_key(arguments);
        let read_snapshot = if tool_name == "edit" {
            match path_key.as_ref() {
                Some(path_key) => {
                    let snapshots = self.read_snapshots.read().await;
                    snapshots
                        .get(thread_id)
                        .and_then(|files| files.get(path_key))
                        .cloned()
                }
                None => None,
            }
        } else {
            None
        };

        let result = execute_tool(
            tool_name,
            arguments,
            &app_state.memo_file,
            read_snapshot.as_deref(),
        )
        .await;

        if result.success {
            match tool_name {
                "read" => {
                    if let Some(path_key) = path_key {
                        if let Ok(content) = std::fs::read_to_string(&path_key) {
                            let mut snapshots = self.read_snapshots.write().await;
                            snapshots
                                .entry(thread_id.to_string())
                                .or_default()
                                .insert(path_key, content);
                        }
                    }
                }
                "write" | "edit" => {
                    if let Some(path_key) = path_key {
                        let mut snapshots = self.read_snapshots.write().await;
                        if let Some(files) = snapshots.get_mut(thread_id) {
                            files.remove(&path_key);
                        }
                        if tool_name == "edit" {
                            if let Some(app_handle) = app_handle {
                                let _ = app_handle.emit(
                                    "agent-document-updated",
                                    serde_json::json!({
                                        "path": path_key,
                                        "tool": "edit",
                                    }),
                                );
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        result
    }

    async fn flush_reasoning_message(
        &self,
        thread_id: &str,
        content: &str,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        if content.is_empty() {
            return Ok(());
        }
        self.add_thread_message(
            thread_id,
            ThreadChatMessage {
                id: format!("reasoning_{}", chrono::Utc::now().timestamp_millis()),
                role: "reasoning".to_string(),
                content: content.to_string(),
                llm_content: None,
                system_reminder_directory: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                is_loading: None,
                tool_call_id: None,
                tool_name: None,
                tool_data: None,
                tool_input: None,
                reasoning: None,
                is_completed: Some(true),
                is_collapsed: None,
            },
            app_state,
        )
        .await
    }

    async fn flush_assistant_message(
        &self,
        thread_id: &str,
        content: &str,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        if content.is_empty() {
            return Ok(());
        }
        self.add_thread_message(
            thread_id,
            ThreadChatMessage {
                id: format!("assistant_{}", chrono::Utc::now().timestamp_millis()),
                role: "assistant".to_string(),
                content: content.to_string(),
                llm_content: None,
                system_reminder_directory: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                is_loading: None,
                tool_call_id: None,
                tool_name: None,
                tool_data: None,
                tool_input: None,
                reasoning: None,
                is_completed: None,
                is_collapsed: None,
            },
            app_state,
        )
        .await
    }

    async fn persist_tool_call(
        &self,
        thread_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        tool_input: serde_json::Value,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        self.add_thread_message(
            thread_id,
            ThreadChatMessage {
                id: format!("tool_{}", tool_call_id),
                role: "tool".to_string(),
                content: String::new(),
                llm_content: None,
                system_reminder_directory: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                is_loading: Some(true),
                tool_call_id: Some(tool_call_id.to_string()),
                tool_name: Some(tool_name.to_string()),
                tool_data: None,
                tool_input: Some(tool_input),
                reasoning: None,
                is_completed: None,
                is_collapsed: None,
            },
            app_state,
        )
        .await
    }

    async fn persist_tool_result(
        &self,
        thread_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        result_content: &str,
        app_state: &crate::commands::AppState,
    ) -> Result<(), String> {
        let manager = app_state.thread_manager.read().await;
        manager
            .update_tool_result(thread_id, tool_call_id, tool_name, result_content)
            .await
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}
