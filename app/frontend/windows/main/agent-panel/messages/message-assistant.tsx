import type { ChatMessage as ChatMessageType } from "../../../../types";
import { isEmptyAssistantMessage } from "../../../../lib/message/empty";
import { MarkdownRenderer } from "./markdown-renderer";

interface MessageAssistantProps {
  message: ChatMessageType;
}

export function MessageAssistant({ message }: MessageAssistantProps) {
  if (isEmptyAssistantMessage(message)) {
    return null;
  }

  return (
    <div className="flex gap-3">
      <div className="flex flex-col gap-1 w-full">
        <div className="text-sm text-[var(--agent-foreground)] mt-1">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    </div>
  );
}