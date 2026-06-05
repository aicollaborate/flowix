'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChatStore } from '../../lib/store/chat-store';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface ChatHistoryProps {
	onSelectThread?: (threadId: string) => void;
}

export function ChatHistory({ onSelectThread }: ChatHistoryProps) {
	const [open, setOpen] = useState(false);

	const threadList = useChatStore((state) => state.threadList);
	const currentThreadTitle = useChatStore((state) => state.currentThreadTitle);
	const loadThreadList = useChatStore((state) => state.loadThreadList);

	useEffect(() => {
		if (open) {
			loadThreadList();
		}
	}, [open, loadThreadList]);

	const handleSelectThread = (threadId: string) => {
		onSelectThread?.(threadId);
		setOpen(false);
	};

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={cn(
						'flex items-center gap-1 px-1 rounded-md cursor-pointer active:scale-95 transition-all'
					)}
				>
					<span className="text-sm text-[var(--foreground)] truncate font-medium min-w-0">
						{currentThreadTitle || 'Untitled Chat'}
					</span>
					<ChevronDown className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[260px] max-h-[360px] overflow-y-auto bg-white border border-gray-200 text-xs">
				<div className="px-3 py-2 text-xs text-gray-900">
					历史对话
				</div>
				{threadList.length === 0 ? (
					<div className="px-3 py-2 text-xs text-gray-500">暂无历史对话</div>
				) : (
					threadList.map((item, index) => (
						<DropdownMenuItem
							key={item.threadId || `thread-${index}`}
							onClick={() => handleSelectThread(item.threadId)}
							className="flex flex-col items-start gap-0.5 cursor-pointer py-1.5 hover:bg-gray-200 active:scale-[0.98] transition-all"
						>
							<div className="flex items-center justify-between w-full">
								<span className="text-xs text-gray-900 truncate flex-1 text-left">
									{item.title || 'Untitled'}
								</span>
								<span className="text-[10px] text-gray-500 ml-2 shrink-0">
									{formatRelativeTime(item.createdAt)}
								</span>
							</div>
						</DropdownMenuItem>
					))
				)}
				<div className="p-2">
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							const store = useChatStore.getState();
							store.createThread();
						}}
						className="w-full px-3 py-1.5 text-xs text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg cursor-pointer active:scale-[0.98] transition-all"
					>
						新建对话
					</button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) return '刚刚';
	if (diffMin < 60) return `${diffMin}分钟前`;
	if (diffHour < 24) return `${diffHour}小时前`;
	if (diffDay < 7) return `${diffDay}天前`;
	return new Date(timestamp).toLocaleDateString('zh-CN');
}