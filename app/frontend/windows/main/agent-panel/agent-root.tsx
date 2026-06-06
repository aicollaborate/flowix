import { useRef, useEffect, useState } from "react";
import { ChatMessage as ChatMessageComponent } from "./chat-message";
import { Inputbox } from "./agent-inputbox";
import { AgentWelcome } from "./agent-welcome";
import { ChatHistory } from "./chat-history";
import { useChatStore } from "../../../lib/store/chat-store";
import { CaretDoubleRightIcon } from "@phosphor-icons/react";
import { aiConfig, windows } from "../../../lib/tauri/client";

interface AgentRootProps {
	onSendMessage?: (content: string, options?: { includeSelectedFile?: boolean }) => void;
	onClosePanel?: () => void;
}

function isWindowsPlatform() {
	return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

export function AgentChatRoot({ onSendMessage, onClosePanel }: AgentRootProps) {
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [loadingVisible, setLoadingVisible] = useState(false);
	// 仅作为"未配置 → 跳转偏好设置"的 gate, 不再保留 agentId / agent instance:
	// 后端 chat 时按需读 ai_config.json。
	const [isAgentConfigured, setIsAgentConfigured] = useState<boolean | null>(null);
	const headerHeightClass = isWindowsPlatform() ? "h-9" : "h-12";

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

	// Loading fade animation
	useEffect(() => {
		if (isLoading) {
			setLoadingVisible(true);
		} else {
			const timer = setTimeout(() => setLoadingVisible(false), 1000);
			return () => clearTimeout(timer);
		}
	}, [isLoading]);

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
		<div className="flex flex-col h-full">
			<div className="shrink-0">
				<div data-tauri-drag-region className={`${headerHeightClass} flex items-center gap-0 px-2`}>
					{onClosePanel && (
						<button
							onClick={onClosePanel}
							className="w-6 h-8 flex items-center justify-center text-gray-500 hover:text-gray-400 rounded-lg transition-colors"
							title="关闭面板"
						>
							<CaretDoubleRightIcon className="w-4 h-4" weight="regular" />
						</button>
					)}
					<ChatHistory onSelectThread={loadThread} />
				</div>
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
				{loadingVisible && (
					<div className={`sticky bottom-0 px-6 py-4 transition-opacity duration-300 ${isLoading ? 'opacity-100' : 'opacity-0'}`}>
						<div className="agent-thinking-loader">
							<span className="agent-thinking-dot" aria-hidden="true" />
							<span className="agent-thinking-text">思考中</span>
						</div>
					</div>
				)}
			</div>

			<div className="shrink-0">
				<Inputbox ref={textareaRef} onSend={handleSendMessage} isLoading={isLoading} />
			</div>
		</div>
	);
}
