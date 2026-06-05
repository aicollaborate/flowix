/**
 * Unified chat message types for WoopMemo app
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

// Stream events from agent
export type StreamEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | ToolResultEvent
  | ReasoningStartEvent
  | ReasoningEvent
  | ReasoningEndEvent
  | FinishEvent
  | ThreadIdEvent
  | ErrorEvent;

export interface TextDeltaEvent {
  type: "text-delta";
  content: string;
}

export interface ToolCallStartEvent {
  type: "tool-call-start";
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

export interface ToolCallEndEvent {
  type: "tool-call-end";
  toolCallId: string;
}

export interface ToolResultEvent {
  type: "tool-result";
  toolCallId: string;
  result: string;
}

export interface ReasoningEvent {
  type: "reasoning";
  content: string;
}

export interface ReasoningStartEvent {
  type: "reasoning-start";
  id: string;
}

export interface ReasoningEndEvent {
  type: "reasoning-end";
  id: string;
}

export interface FinishEvent {
  type: "finish";
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ThreadIdEvent {
  type: "thread-id";
  threadId: string;
}

export interface ErrorEvent {
  type: "error";
  content: string;
}

// Re-export for backwards compatibility
export type MessageType = ChatMessage;
