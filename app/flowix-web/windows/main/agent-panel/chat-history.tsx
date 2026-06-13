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
import type { ThreadListItem } from '../../../types';

interface ChatHistoryProps {
	onSelectThread?: (threadId: string) => void;
}

/** 单个 thread 行 ── 独立组件是为了能用 zustand selector 订阅自身
 * `isLoading` 变化, 不然父组件整体 re-render 太重 (列表大时尤其明显)。
 * 这里只读一个字段, 用 selector 切到最小依赖, chunk 派发器改 isLoading
 * 不会触发其他 thread 行重渲染。 */
function ThreadRow({
	item,
	onSelect,
	onDelete,
}: {
	item: ThreadListItem;
	onSelect: (tid: string) => void;
	onDelete: (e: MouseEvent, tid: string) => void;
}) {
	const isRunning = useChatStore(
		(s) => s.threadStates[item.threadId]?.isLoading ?? false
	);
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onSelect(item.threadId)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(item.threadId);
				}
			}}
			className={cn(
				'group flex items-center cursor-pointer rounded-md px-2 py-1.5 gap-2',
				'hover:bg-[var(--muted)] focus:bg-[var(--muted)] outline-none transition-colors'
			)}
		>
			<ChatCircleTextIcon className="w-4 h-4 shrink-0 text-[var(--muted-foreground)]" />
			<span className="flex-1 min-w-0 truncate text-left text-sm text-[var(--agent-foreground)]">
				{item.title || '未命名'}
			</span>
			{/* 后台运行指示 ── isRunning 时显示脉冲蓝点。 由 stream_start
			    / stream_end chunk 在 `dispatchAgentChunk` 里维护
			    `threadStates[tid].isLoading`, 这里只读。 */}
			{isRunning && (
				<span
					aria-label="后台运行中"
					title="后台运行中"
					className="shrink-0 w-2 h-2 rounded-full bg-blue-500 animate-pulse"
				/>
			)}
			{/* hover 时隐藏时间,展示删除按钮 */}
			<span className="text-xs text-[var(--muted-foreground)] shrink-0 group-hover:hidden">
				{formatRelativeTime(item.createdAt)}
			</span>
			<button
				type="button"
				onClick={(e) => onDelete(e, item.threadId)}
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
	);
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
		<div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="group flex max-w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden px-2 py-0.5 rounded-md transition-colors [-webkit-app-region:no-drag]"
				>
					<span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--agent-foreground)] transition-colors duration-150 group-hover:text-[color-mix(in_oklch,var(--agent-foreground)_80%,white)]">
						{currentThreadTitle || '未命名对话'}
					</span>
					<ChevronDown className="w-[14px] h-[14px] text-[var(--muted-foreground)] shrink-0" strokeWidth={2.5} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[280px] px-1 py-1.5 space-y-1">
				<DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] px-2 pb-1">历史对话</DropdownMenuLabel>
				{/* 可滚动列表区:与底部分隔,新建对话始终可见 */}
				<div className="max-h-[300px] overflow-y-auto space-y-1">
					{threadList.length === 0 ? (
						<div className="px-2 py-3 text-sm text-[var(--muted-foreground)] text-center">
							暂无历史对话
						</div>
					) : (
						threadList.map((item) => (
							<ThreadRow
								key={item.threadId}
								item={item}
								onSelect={handleSelectThread}
								onDelete={handleDeleteThread}
							/>
						))
					)}
				</div>
				{/* 固定底部:新建对话,不被列表滚动影响 */}
				<div className="p-0">
					<button
						type="button"
						onClick={handleCreateThread}
						className={cn(
							'flex items-center justify-center cursor-pointer rounded-md w-full px-2 py-1.5',
							'text-sm text-[var(--agent-foreground)] border border-[var(--border)]',
							'hover:bg-[var(--muted)] transition-colors'
						)}
					>
						<span>新建对话</span>
					</button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
		</div>
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
