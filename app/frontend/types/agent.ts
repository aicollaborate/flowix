/**
 * Unified chat message types for Flowix app
 */

// Thread list item
export interface ThreadListItem {
  threadId: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// Core message type used throughout the app
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "reasoning" | "end";
  content: string;
  llmContent?: string;
  systemReminderDirectory?: string;
  systemReminderDocumentPath?: string;
  timestamp: string;
  isLoading?: boolean;
  toolCallId?: string;
  toolName?: string;
  toolData?: string;
  toolInput?: Record<string, unknown>;
  toolCalls?: ToolCall[];
  reasoning?: string;
  isCompleted?: boolean;
  isCollapsed?: boolean;
}

// Tool call definition
export interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
  args?: string;
}

// Stream events from agent ── 与后端 `AgentChunk` 1:1 镜像, 由
// `client.ts:listenToAgentStream` 监听 `agent-chunk` 通道消费。
// 替换之前 `[REASONING]:` / `[TOOL_CALL]:` / `[TOOL_RESULT]:` / `[ERROR]:`
// 字符串前缀协议 ── 用判别联合 (kind) 替代 startsWith。
export type AgentChunk =
  | AgentChunkText
  | AgentChunkReasoning
  | AgentChunkToolCall
  | AgentChunkToolResult
  | AgentChunkError;

export interface AgentChunkText {
  kind: "text";
  text: string;
}

export interface AgentChunkReasoning {
  kind: "reasoning";
  text: string;
}

export interface AgentChunkToolCall {
  kind: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentChunkToolResult {
  kind: "tool_result";
  id: string;
  name: string;
  result: unknown;
}

export interface AgentChunkError {
  kind: "error";
  message: string;
}

// Re-export for backwards compatibility
export type MessageType = ChatMessage;
