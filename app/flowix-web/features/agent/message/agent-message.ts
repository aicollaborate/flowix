import type { ChatMessage } from "@/types";
import { extractFileName } from "@features/agent/message/format";
import { getToolLabel } from "@features/agent/message/tools";
import { stripSystemBlock } from "@features/agent/message/system";
import { isEmptyAssistantMessage } from "@features/agent/message/empty";
import { translate, type AppLanguage } from "@features/i18n";

export interface AgentMessageViewModel {
  message: ChatMessage;
  role: ChatMessage["role"];
  visibleContent: string;
  shouldRender: boolean;
  reasoningLabel: string;
  toolLabel: string;
  toolSummary: string;
  endTimeText: string;
}

export function agentMessageValueToText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function getAgentToolInputSummary(input?: Record<string, unknown>): string {
  if (!input) return "";

  const pathLike = input.path ?? input.pattern ?? input.command ?? input.cwd;
  if (typeof pathLike === "string" && pathLike.length > 0) {
    return extractFileName(pathLike);
  }

  const first = Object.entries(input)[0];
  return first
    ? `${first[0]}: ${agentMessageValueToText(first[1]).split("\n")[0]}`
    : "";
}

export function getAgentReasoningLabel(message: ChatMessage, language: AppLanguage = "zh-CN"): string {
  return translate(language, message.isCompleted ? "agent.reasoning.completed" : "agent.reasoning.thinking");
}

export function getAgentMessageEndTimeText(message: ChatMessage, language: AppLanguage = "zh-CN"): string {
  if (!message.timestamp) {
    return new Date().toLocaleTimeString(language === "zh-CN" ? "zh-CN" : "en-US");
  }

  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.timestamp));
}

export function getAgentMessageVisibleContent(message: ChatMessage, language: AppLanguage = "zh-CN"): string {
  if (message.role === "user") {
    return stripSystemBlock(message.content || "");
  }

  if (message.role === "end") {
    return message.content || getAgentMessageEndTimeText(message, language);
  }

  return message.content || "";
}

export function shouldRenderAgentMessage(message: ChatMessage): boolean {
  return !isEmptyAssistantMessage(message);
}

export function createAgentMessageViewModel(message: ChatMessage, language: AppLanguage = "zh-CN"): AgentMessageViewModel {
  return {
    message,
    role: message.role,
    visibleContent: getAgentMessageVisibleContent(message, language),
    shouldRender: shouldRenderAgentMessage(message),
    reasoningLabel: getAgentReasoningLabel(message, language),
    toolLabel: getToolLabel(message.toolName, language),
    toolSummary: getAgentToolInputSummary(message.toolInput),
    endTimeText: getAgentMessageEndTimeText(message, language),
  };
}
