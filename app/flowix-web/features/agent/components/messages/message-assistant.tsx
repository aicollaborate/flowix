import type { ChatMessage as ChatMessageType } from "@/types";
import {
  getAgentMessageVisibleContent,
  shouldRenderAgentMessage,
} from "@features/agent/message/agent-message";
import { MarkdownRenderer } from "@features/agent/components/messages/markdown-renderer";

interface MessageAssistantProps {
  message: ChatMessageType;
}

export function MessageAssistant({ message }: MessageAssistantProps) {
  if (!shouldRenderAgentMessage(message)) {
    return null;
  }
  const visibleContent = getAgentMessageVisibleContent(message);

  return (
    <div className="flex gap-3">
      <div className="flex flex-col gap-1 w-full">
        <div className="text-sm text-[var(--agent-foreground)] mt-1">
          <MarkdownRenderer content={visibleContent} />
        </div>
      </div>
    </div>
  );
}
