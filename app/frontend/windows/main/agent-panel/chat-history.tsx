'use client';

import { useState, useEffect, type MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { ChatCircleTextIcon, TrashIcon } from '@phosphor-icons/react';
import { cn } from '../../../lib/utils';
import { useChatStore } from '../../../lib/store/chat-store';
import { toast } from '../../../lib/toast';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

interface ChatHistoryProps {
	onSelectThread?: (threadId: string) => void;
}

export function ChatHistory({ onSelectThread }: ChatHistoryProps) {
	const [open, setOpen] = useState(false);

	const threadList = useChatStore((state) => state.threadList);
	const currentThreadTitle = useChatStore((state) => state.currentThreadTitle);
	const loadThreadList = useChatStore((state) => state.loadThreadList);
	const deleteThread = useChatStore((state) => state.deleteThread);

	useEffect(() => {
		if (open) {
			loadThreadList();
		}
	}, [open, loadThreadList]);

	const handleSelectThread = (threadId: string) => {
		onSelectThread?.(threadId);
		setOpen(false);
	};

	const handleCreateThread = () => {
		const store = useChatStore.getState();
		store.createThread();
		setOpen(false);
	};

	const handleDeleteThread = async (e: MouseEvent, threadId: string) => {
		// 阻止冒泡到外层 item,避免触发选中/关闭
		e.stopPropagation();
		e.preventDefault();
		try {
			await deleteThread(threadId);
		} catch (err) {
			console.error('Failed to delete thread:', err);
			toast.error('删除失败');
		}
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
						{currentThreadTitle || '未命名对话'}
					</span>
					<ChevronDown className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[280px] p-0">
				<DropdownMenuLabel className="px-3 pt-1.5">历史对话</DropdownMenuLabel>
				{/* 可滚动列表区:与底部分隔,新建对话始终可见 */}
				<div className="max-h-[300px] overflow-y-auto px-1 pb-1 space-y-1">
					{threadList.length === 0 ? (
						<div className="px-2 py-3 text-sm text-[var(--muted-foreground)] text-center">
							暂无历史对话
						</div>
					) : (
						threadList.map((item, index) => (
							<div
								key={item.threadId || `thread-${index}`}
								role="button"
								tabIndex={0}
								onClick={() => handleSelectThread(item.threadId)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handleSelectThread(item.threadId);
									}
								}}
								className={cn(
									'group flex items-center cursor-pointer rounded-md px-2 py-1.5 gap-2',
									'hover:bg-[var(--muted)] focus:bg-[var(--muted)] outline-none transition-colors'
								)}
							>
								<ChatCircleTextIcon className="w-4 h-4 shrink-0 text-[var(--muted-foreground)]" />
								<span className="flex-1 min-w-0 truncate text-left text-sm text-[var(--foreground)]">
									{item.title || '未命名'}
								</span>
								{/* hover 时隐藏时间,展示删除按钮 */}
								<span className="text-xs text-[var(--muted-foreground)] shrink-0 group-hover:hidden">
									{formatRelativeTime(item.createdAt)}
								</span>
								<button
									type="button"
									onClick={(e) => handleDeleteThread(e, item.threadId)}
									onMouseDown={(e) => e.stopPropagation()}
									aria-label="删除对话"
									className={cn(
										'shrink-0 hidden group-hover:inline-flex items-center justify-center',
										'h-4 px-1 rounded text-[var(--muted-foreground)]',
										'hover:text-red-500 hover:bg-[var(--accent)] transition-colors cursor-pointer'
									)}
								>
									<TrashIcon className="w-3.5 h-3.5" />
								</button>
							</div>
						))
					)}
				</div>
				{/* 固定底部:新建对话,不被列表滚动影响 */}
				<div className="p-1">
					<button
						type="button"
						onClick={handleCreateThread}
						className={cn(
							'flex items-center justify-center cursor-pointer rounded-md w-full px-2 py-1.5',
							'text-sm text-[var(--foreground)] border border-[var(--border)]',
							'hover:bg-[var(--muted)] transition-colors'
						)}
					>
						<span>新建对话</span>
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
