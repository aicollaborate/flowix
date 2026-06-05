//! OpenAI Chat Completions provider for rllm-compatible agent framework.
//!
//! This module provides a generic OpenAI-compatible provider that uses
//! the /v1/chat/completions endpoint, suitable for MiniMax, DeepSeek, and
//! other OpenAI-compatible APIs.

use async_trait::async_trait;
use futures::stream::Stream;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::Arc;

use rllm::chat::{
    ChatMessage as LlmChatMessage, ChatProvider, ChatResponse, ChatRole, StreamChunk,
};
use rllm::error::LLMError as RllmError;
use rllm::ToolCall;

#[derive(Default)]
struct PendingToolCall {
    id: String,
    call_type: String,
    name: String,
    arguments: String,
}

// ============================================================================
// OpenAI Provider Implementation (using rllm traits)
// ============================================================================

/// Configuration for the OpenAI-compatible provider.
#[derive(Debug, Clone)]
pub struct OpenAIConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub system: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub reasoning_split: Option<bool>,
}

impl OpenAIConfig {
    pub fn new(
        api_key: impl Into<String>,
        model: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            base_url: base_url.into(),
            max_tokens: None,
            temperature: None,
            system: None,
            timeout_seconds: None,
            reasoning_split: None,
        }
    }

    #[allow(dead_code)]
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = Some(max_tokens);
        self
    }

    #[allow(dead_code)]
    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }

    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(system.into());
        self
    }

    #[allow(dead_code)]
    pub fn with_timeout(mut self, timeout_seconds: u64) -> Self {
        self.timeout_seconds = Some(timeout_seconds);
        self
    }

    pub fn with_reasoning_split(mut self, reasoning_split: bool) -> Self {
        self.reasoning_split = Some(reasoning_split);
        self
    }
}

/// OpenAI-compatible provider using /v1/chat/completions endpoint.
/// Implements rllm's ChatProvider trait for compatibility.
#[derive(Debug, Clone)]
pub struct OpenAIProvider {
    config: Arc<OpenAIConfig>,
    client: Client,
}

// Request/Response types for OpenAI Chat Completions API
#[derive(Serialize)]
struct ChatMessageReq {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatMessageReq>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ToolReq>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_split: Option<bool>,
}

#[derive(Serialize)]
struct ToolReq {
    #[serde(rename = "type")]
    tool_type: String,
    function: FunctionSchema,
}

#[derive(Serialize)]
struct FunctionSchema {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct ChatCompletionsResponse {
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize, Debug)]
struct Choice {
    message: Message,
}

#[derive(Deserialize, Debug)]
struct Message {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<MessageToolCall>>,
}

#[derive(Deserialize, Debug)]
struct MessageToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: FunctionCall,
}

#[derive(Deserialize, Debug)]
struct FunctionCall {
    name: String,
    arguments: String,
}

#[derive(Deserialize, Debug, Default, Clone)]
#[allow(dead_code)]
struct Usage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
}

// Streaming response types (for parsing SSE from OpenAI API)
#[derive(Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct ApiStreamChunk {
    choices: Vec<ApiStreamChoice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct ApiStreamChoice {
    delta: ApiStreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct ApiStreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ApiStreamToolCall>>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    reasoning_details: Option<Vec<ReasoningDetail>>,
}

#[derive(Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct ReasoningDetail {
    #[serde(rename = "type")]
    detail_type: Option<String>,
    id: Option<String>,
    format: Option<String>,
    index: Option<usize>,
    text: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
struct ApiStreamToolCall {
    id: Option<String>,
    #[serde(rename = "type")]
    call_type: Option<String>,
    function: Option<ApiStreamFunction>,
}

#[derive(Deserialize, Debug, Clone)]
struct ApiStreamFunction {
    name: Option<String>,
    arguments: Option<String>,
}

impl std::fmt::Display for ChatCompletionsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ChatCompletionsResponse {{ choices: {} }}",
            self.choices.len()
        )
    }
}

impl ChatResponse for ChatCompletionsResponse {
    fn text(&self) -> Option<String> {
        self.choices.first().and_then(|c| c.message.content.clone())
    }

    fn tool_calls(&self) -> Option<Vec<ToolCall>> {
        let calls = self.choices.first()?.message.tool_calls.as_ref()?;

        Some(
            calls
                .iter()
                .map(|c| ToolCall {
                    id: c.id.clone(),
                    call_type: c.call_type.clone(),
                    function: rllm::FunctionCall {
                        name: c.function.name.clone(),
                        arguments: c.function.arguments.clone(),
                    },
                })
                .collect(),
        )
    }
}

impl OpenAIProvider {
    pub fn new(config: OpenAIConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("Failed to build reqwest Client");
        Self {
            config: Arc::new(config),
            client,
        }
    }

    #[allow(dead_code)]
    pub fn with_client(client: Client, config: OpenAIConfig) -> Self {
        Self {
            config: Arc::new(config),
            client,
        }
    }

    fn build_url(&self) -> String {
        let base = self.config.base_url.trim_end_matches('/');
        format!("{}/chat/completions", base)
    }

    fn role_to_str(role: &ChatRole) -> &'static str {
        match role {
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        }
    }

    fn prepare_messages(&self, messages: &[LlmChatMessage]) -> Vec<ChatMessageReq> {
        let mut result: Vec<ChatMessageReq> = Vec::with_capacity(messages.len() + 1);

        // Add system message if configured
        if let Some(system) = &self.config.system {
            result.push(ChatMessageReq {
                role: "system".to_string(),
                content: system.clone(),
            });
        }

        // Convert messages (owned copies)
        for msg in messages {
            result.push(ChatMessageReq {
                role: Self::role_to_str(&msg.role).to_string(),
                content: msg.content.clone(),
            });
        }

        result
    }
}

#[async_trait]
impl ChatProvider for OpenAIProvider {
    async fn chat(&self, messages: &[LlmChatMessage]) -> Result<Box<dyn ChatResponse>, RllmError> {
        self.chat_with_tools(messages, None).await
    }

    async fn chat_with_tools(
        &self,
        messages: &[LlmChatMessage],
        tools: Option<&[rllm::chat::Tool]>,
    ) -> Result<Box<dyn ChatResponse>, RllmError> {
        if self.config.api_key.is_empty() {
            return Err(RllmError::AuthError("Missing API key".to_string()));
        }

        let msgs = self.prepare_messages(messages);

        // Convert rllm Tools to OpenAI tool format
        let tool_requests = tools.map(|tools| {
            tools
                .iter()
                .map(|t| ToolReq {
                    tool_type: "function".to_string(),
                    function: FunctionSchema {
                        name: t.function.name.clone(),
                        description: t.function.description.clone(),
                        parameters: t.function.parameters.clone(),
                    },
                })
                .collect()
        });

        let request = ChatCompletionsRequest {
            model: self.config.model.clone(),
            messages: msgs,
            max_tokens: self.config.max_tokens,
            temperature: self.config.temperature,
            stream: false,
            tools: tool_requests,
            reasoning_split: self.config.reasoning_split,
        };

        let url = self.build_url();
        let mut req = self
            .client
            .post(&url)
            .bearer_auth(&self.config.api_key)
            .header("Content-Type", "application/json");

        if let Some(timeout) = self.config.timeout_seconds {
            req = req.timeout(std::time::Duration::from_secs(timeout));
        }

        let response = req
            .json(&request)
            .send()
            .await
            .map_err(|e| RllmError::HttpError(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(RllmError::ResponseFormatError {
                message: format!("API error {}", status.as_u16()),
                raw_response: body,
            });
        }

        let chat_response: ChatCompletionsResponse = response
            .json()
            .await
            .map_err(|e| RllmError::JsonError(e.to_string()))?;

        Ok(Box::new(chat_response))
    }

    async fn chat_stream_with_tools(
        &self,
        messages: &[LlmChatMessage],
        tools: Option<&[rllm::chat::Tool]>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamChunk, RllmError>> + Send>>, RllmError> {
        if self.config.api_key.is_empty() {
            return Err(RllmError::AuthError("Missing API key".to_string()));
        }

        let msgs = self.prepare_messages(messages);

        let tool_requests = tools.map(|tools| {
            tools
                .iter()
                .map(|t| ToolReq {
                    tool_type: "function".to_string(),
                    function: FunctionSchema {
                        name: t.function.name.clone(),
                        description: t.function.description.clone(),
                        parameters: t.function.parameters.clone(),
                    },
                })
                .collect()
        });

        let request = ChatCompletionsRequest {
            model: self.config.model.clone(),
            messages: msgs,
            max_tokens: self.config.max_tokens,
            temperature: self.config.temperature,
            stream: true,
            tools: tool_requests,
            reasoning_split: self.config.reasoning_split,
        };

        let url = self.build_url();
        let mut req = self
            .client
            .post(&url)
            .bearer_auth(&self.config.api_key)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream");

        if let Some(timeout) = self.config.timeout_seconds {
            req = req.timeout(std::time::Duration::from_secs(timeout));
        }

        let body =
            serde_json::to_string(&request).map_err(|e| RllmError::JsonError(e.to_string()))?;
        tracing::debug!("[OpenAI] Request body: {}", body);

        let response = req
            .body(body)
            .send()
            .await
            .map_err(|e| RllmError::HttpError(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(RllmError::ResponseFormatError {
                message: format!("API error {}", status.as_u16()),
                raw_response: body,
            });
        }

        let stream = futures::stream::unfold(
            (
                response.bytes_stream(),
                String::new(),
                PendingToolCall::default(),
                VecDeque::<Result<StreamChunk, RllmError>>::new(),
            ),
            |(mut byte_stream, mut sse_buffer, mut pending_tool, mut queue)| async move {
                if let Some(item) = queue.pop_front() {
                    return Some((item, (byte_stream, sse_buffer, pending_tool, queue)));
                }

                while let Some(chunk) = byte_stream.next().await {
                    let bytes = match chunk {
                        Ok(bytes) => bytes,
                        Err(e) => {
                            return Some((
                                Err(RllmError::HttpError(e.to_string())),
                                (byte_stream, sse_buffer, pending_tool, queue),
                            ));
                        }
                    };

                    let text = String::from_utf8_lossy(&bytes).to_string();
                    tracing::debug!("[OpenAI] Received bytes, text length: {}", text.len());
                    sse_buffer.push_str(&text);

                    while let Some(newline_index) = sse_buffer.find('\n') {
                        let line: String = sse_buffer.drain(..=newline_index).collect();
                        let line = line.trim();
                        if !line.starts_with("data: ") {
                            continue;
                        }

                        let json_str = line.trim_start_matches("data: ").trim();
                        if json_str == "[DONE]" {
                            tracing::debug!("[OpenAI] Stream done");
                            queue.push_back(Ok(StreamChunk::Done {
                                stop_reason: "stop".to_string(),
                            }));
                            continue;
                        }

                        let Ok(response) = serde_json::from_str::<ApiStreamChunk>(json_str) else {
                            tracing::debug!("[OpenAI] Failed to parse stream JSON: {}", json_str);
                            continue;
                        };

                        for choice in response.choices {
                            let delta = choice.delta;

                            if let Some(reasoning) = delta.reasoning_content {
                                if !reasoning.is_empty() {
                                    tracing::debug!("[OpenAI] Got reasoning chunk: {}", reasoning);
                                    queue.push_back(Ok(StreamChunk::Text(format!(
                                        "[REASONING]: {}",
                                        reasoning
                                    ))));
                                }
                            }

                            if let Some(content) = delta.content {
                                if !content.is_empty() {
                                    tracing::debug!("[OpenAI] Got text chunk: {}", content);
                                    queue.push_back(Ok(StreamChunk::Text(content)));
                                }
                            }

                            if let Some(tool_calls) = delta.tool_calls {
                                for tc in tool_calls {
                                    if let Some(id) = tc.id {
                                        if !id.is_empty() {
                                            pending_tool.id = id;
                                        }
                                    }
                                    if let Some(call_type) = tc.call_type {
                                        if !call_type.is_empty() {
                                            pending_tool.call_type = call_type;
                                        }
                                    }
                                    if let Some(function) = tc.function {
                                        if let Some(name) = function.name {
                                            if !name.is_empty() {
                                                pending_tool.name = name;
                                            }
                                        }
                                        if let Some(arguments) = function.arguments {
                                            pending_tool.arguments.push_str(&arguments);
                                        }
                                    }
                                }
                            }

                            if choice.finish_reason.as_deref() == Some("tool_calls")
                                && !pending_tool.name.is_empty()
                            {
                                let tool_call = ToolCall {
                                    id: if pending_tool.id.is_empty() {
                                        format!("call_{}", chrono::Utc::now().timestamp_millis())
                                    } else {
                                        pending_tool.id.clone()
                                    },
                                    call_type: if pending_tool.call_type.is_empty() {
                                        "function".to_string()
                                    } else {
                                        pending_tool.call_type.clone()
                                    },
                                    function: rllm::FunctionCall {
                                        name: pending_tool.name.clone(),
                                        arguments: pending_tool.arguments.clone(),
                                    },
                                };
                                pending_tool = PendingToolCall::default();
                                queue.push_back(Ok(StreamChunk::ToolUseComplete {
                                    index: 0,
                                    tool_call,
                                }));
                            }
                        }
                    }

                    if let Some(item) = queue.pop_front() {
                        return Some((item, (byte_stream, sse_buffer, pending_tool, queue)));
                    }
                }

                if !pending_tool.name.is_empty() {
                    let tool_call = ToolCall {
                        id: if pending_tool.id.is_empty() {
                            format!("call_{}", chrono::Utc::now().timestamp_millis())
                        } else {
                            pending_tool.id
                        },
                        call_type: if pending_tool.call_type.is_empty() {
                            "function".to_string()
                        } else {
                            pending_tool.call_type
                        },
                        function: rllm::FunctionCall {
                            name: pending_tool.name,
                            arguments: pending_tool.arguments,
                        },
                    };
                    return Some((
                        Ok(StreamChunk::ToolUseComplete {
                            index: 0,
                            tool_call,
                        }),
                        (byte_stream, sse_buffer, PendingToolCall::default(), queue),
                    ));
                }

                None
            },
        );

        Ok(Box::pin(stream))
    }
}
