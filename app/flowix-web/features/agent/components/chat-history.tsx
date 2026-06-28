'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ChatCircleTextIcon, TrashIcon } from '@phosphor-icons/react';
import { ChevronDown } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { toast } from '@/lib/toast';
import { useChatStore } from '@features/agent/store/chat-store';
import { cn } from '@/lib/utils';
import type { ThreadListItem } from '@/types';
import { getAgentType } from '@/lib/agent-types';
import { useI18n, type I18nParams } from '@features/i18n';

interface ChatHistoryProps {
	onSelectThread?: (threadId: string) => void;
}

function ThreadRow({
	item,
	onSelect,
	onDelete,
	formatTime,
}: {
	item: ThreadListItem;
	onSelect: (tid: string) => void;
	onDelete?: (e: MouseEvent, tid: string) => void;
	formatTime: (ts: number) => string;
}) {
	const { t } = useI18n();
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
				'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
				'outline-none transition-colors hover:bg-[var(--muted)] focus:bg-[var(--muted)]'
			)}
		>
			<ChatCircleTextIcon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
			<span className="min-w-0 flex-1 truncate text-left text-sm text-[var(--agent-foreground)]">
				{item.title || t('agent.chat.thread.unnamed')}
			</span>
			{isRunning && (
				<span
					aria-label={t('agent.chat.thread.running')}
					title={t('agent.chat.thread.running')}
					className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500"
				/>
			)}
			<span className="shrink-0 text-xs text-[var(--muted-foreground)] group-hover:hidden">
				{formatTime(item.updatedAt || item.createdAt)}
			</span>
			{onDelete && (
				<button
					type="button"
					onClick={(e) => onDelete(e, item.threadId)}
					onMouseDown={(e) => e.stopPropagation()}
					aria-label={t('agent.chat.thread.delete')}
					className={cn(
						'h-4 shrink-0 hidden items-center justify-center rounded px-1',
						'text-[var(--muted-foreground)] transition-colors cursor-pointer',
						'hover:bg-[var(--accent)] hover:text-red-500 group-hover:inline-flex'
					)}
				>
					<TrashIcon className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}

export function ChatHistory({ onSelectThread }: ChatHistoryProps) {
	const { t, language } = useI18n();
	const [open, setOpen] = useState(false);

	const activeTypeKey = useChatStore((state) => state.activeAgentTypeKey);
	const activeType = getAgentType(activeTypeKey);
	const threadList = useChatStore((state) =>
		getAgentType(state.activeAgentTypeKey).key === 'codex' ? state.codexThreadList : state.threadList
	);
	const currentThreadTitle = useChatStore((state) =>
		getAgentType(state.activeAgentTypeKey).key === 'codex'
			? state.currentCodexThreadTitle
			: state.currentThreadTitle
	);
	const loadThreadList = useChatStore((state) => state.loadThreadList);
	const loadCodexThreadList = useChatStore((state) => state.loadCodexThreadList);
	const deleteThread = useChatStore((state) => state.deleteThread);

	useEffect(() => {
		if (!open) return;
		if (activeType.key === 'codex') {
			loadCodexThreadList();
		} else {
			loadThreadList();
		}
	}, [activeType.key, loadCodexThreadList, loadThreadList, open]);

	const handleSelectThread = (threadId: string) => {
		onSelectThread?.(threadId);
		setOpen(false);
	};

	const handleCreateThread = () => {
		const store = useChatStore.getState();
		if (getAgentType(store.activeAgentTypeKey).key === 'codex') {
			store.createCodexThread();
		} else {
			store.createThread();
		}
		setOpen(false);
	};

	const handleDeleteThread = async (e: MouseEvent, threadId: string) => {
		e.stopPropagation();
		e.preventDefault();
		try {
			await deleteThread(threadId);
		} catch (err) {
			console.error('Failed to delete thread:', err);
			toast.error(t('agent.chat.thread.deleteFailed'));
		}
	};

	const formatTime = useMemo(() => {
		const intlLocale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
		return (timestamp: number): string => {
			const now = Date.now();
			const diffMs = Math.max(0, now - timestamp);
			const diffSec = Math.floor(diffMs / 1000);
			const diffMin = Math.floor(diffSec / 60);
			const diffHour = Math.floor(diffMin / 60);
			const diffDay = Math.floor(diffHour / 24);

			if (diffSec < 60) return t('agent.time.justNow');
			if (diffMin < 60) return t('agent.time.minutesAgo', { m: diffMin } satisfies I18nParams);
			if (diffHour < 24) return t('agent.time.hoursAgo', { h: diffHour } satisfies I18nParams);
			if (diffDay < 7) return t('agent.time.daysAgo', { d: diffDay } satisfies I18nParams);
			return new Date(timestamp).toLocaleDateString(intlLocale);
		};
	}, [t, language]);

	return (
		<div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="group flex max-w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md px-2 py-0.5 transition-colors [-webkit-app-region:no-drag]"
					>
						<span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--agent-foreground)] transition-colors duration-150 group-hover:text-[color-mix(in_oklch,var(--agent-foreground)_80%,white)]">
							{currentThreadTitle || t('agent.chat.unnamedConversation')}
						</span>
						<ChevronDown
							className="h-[14px] w-[14px] shrink-0 text-[var(--muted-foreground)]"
							strokeWidth={2.5}
						/>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-[280px] space-y-1 px-1 py-1.5">
					<DropdownMenuLabel className="px-2 pb-1 text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
						{t('agent.chat.historyLabel', { role: activeType.name } satisfies I18nParams)}
					</DropdownMenuLabel>
					<div className="max-h-[300px] space-y-1 overflow-y-auto">
						{threadList.length === 0 ? (
							<div className="px-2 py-3 text-center text-sm text-[var(--muted-foreground)]">
								{t('agent.chat.emptyHistory')}
							</div>
						) : (
							threadList.map((item) => (
								<ThreadRow
									key={item.threadId}
									item={item}
									onSelect={handleSelectThread}
									onDelete={activeType.key === 'codex' ? undefined : handleDeleteThread}
									formatTime={formatTime}
								/>
							))
						)}
					</div>
					<div className="p-0">
						<button
							type="button"
							onClick={handleCreateThread}
							className={cn(
								'flex w-full cursor-pointer items-center justify-center rounded-md px-2 py-1.5',
								'border border-[var(--border)] text-sm text-[var(--agent-foreground)]',
								'transition-colors hover:bg-[var(--muted)]'
							)}
						>
							<span>{t('agent.chat.newThread')}</span>
						</button>
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
