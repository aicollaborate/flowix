import { useRef, useEffect, useState } from "react";
import { ChatMessage as ChatMessageComponent } from "./chat-message";
import { Inputbox } from "./agent-inputbox";
import { AgentWelcome } from "./agent-welcome";
import { ChatHistory } from "./chat-history";
import { AgentThinkingIndicator } from "./agent-thinking-indicator";
import { useChatStore } from "../../../lib/store/chat-store";
import { CaretDoubleRightIcon } from "@phosphor-icons/react";
import { aiConfig, windows } from "../../../lib/tauri/client";

interface AgentRootProps {
	onSendMessage?: (content: string, options?: { includeSelectedFile?: boolean }) => void;
	onClosePanel?: () => void;
}

const IS_WINDOWS = /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
const HEADER_HEIGHT_CLASS = IS_WINDOWS ? "h-9" : "h-12";

export function AgentChatRoot({ onSendMessage, onClosePanel }: AgentRootProps) {
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// 仅作为"未配置 → 跳转偏好设置"的 gate, 不再保留 agentId / agent instance:
	// 后端 chat 时按需读 ai_config.json。
	const [isAgentConfigured, setIsAgentConfigured] = useState<boolean | null>(null);

	const messages = useChatStore((state) => state.messages);
	const isLoading = useChatStore((state) => state.isLoading);
	const onSendMessageStore = useChatStore((state) => state.sendMessageStream);
	const threadId = useChatStore((state) => state.threadId);
	const loadThread = useChatStore((state) => state.loadThread);
	const loadThreadList = useChatStore((state) => state.loadThreadList);

	// 启动时探一下 ai_config.json 是否已填 model — 仅决定要不要直接跳偏好设置,
	// 真正的 provider 由后端在 chat 时构建。
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const cfg = await aiConfig.get();
				if (!cancelled) {
					setIsAgentConfigured(Boolean(cfg.model?.model));
				}
			} catch {
				if (!cancelled) {
					setIsAgentConfigured(false);
				}
			}
		})();
		loadThreadList();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (threadId) {
			loadThread(threadId);
		}
	}, [threadId, loadThread]);

	// Scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Set input value for welcome prompts
	const setInputValue = (value: string) => {
		if (textareaRef.current) {
			textareaRef.current.value = value;
			textareaRef.current.style.height = "auto";
			const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 40), 200);
			textareaRef.current.style.height = `${newHeight}px`;
		}
	};

	const handleSendMessage = (content: string, options?: { includeSelectedFile?: boolean }) => {
		if (isAgentConfigured === false) {
			windows.openPreferences("agent");
			return;
		}
		if (onSendMessage) {
			onSendMessage(content, options);
		} else {
			onSendMessageStore(content);
		}
	};

	return (
		<div
			className="flex flex-col h-full"
			// 子树内 --foreground 重定义到 --agent-foreground, 已有 text-[var(--foreground)]
			// 工具类自动跟随 agent 主题色; 其它 token 保持原值, chrome 仍清晰。
			style={{ "--foreground": "var(--agent-foreground)" } as React.CSSProperties}
		>
			<div
				data-tauri-drag-region
				className={`shrink-0 ${HEADER_HEIGHT_CLASS} flex items-center gap-0 px-2`}
			>
				{onClosePanel && (
					<button
						onClick={onClosePanel}
						className="w-6 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg transition-colors"
						title="关闭面板"
					>
						<CaretDoubleRightIcon className="w-4 h-4" weight="regular" />
					</button>
				)}
				<ChatHistory onSelectThread={loadThread} />
			</div>

			<div className="flex-1 overflow-y-auto scrollbar overflow-x-hidden">
				{messages.length > 0 ? (
					<div className="space-y-3 px-6 py-4">
						{messages.map((message) => (
							<ChatMessageComponent key={message.id} message={message} />
						))}
						<div ref={messagesEndRef} />
					</div>
				) : (
					<AgentWelcome onSelectPrompt={setInputValue} />
				)}
			</div>

			{/* 底部 footer: 思考中指示器按需渲染, 不流式时完全脱离布局,
			    容器自然收缩到 Inputbox 高度。 */}
			<div className="shrink-0">
				{isLoading && <AgentThinkingIndicator />}
				<Inputbox ref={textareaRef} onSend={handleSendMessage} isLoading={isLoading} />
			</div>
		</div>
	);
}
