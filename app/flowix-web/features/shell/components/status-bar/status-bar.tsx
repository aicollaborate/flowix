'use client';

import { Hash, Infinity, ListTodo, SlidersHorizontal } from 'lucide-react';
import { Tooltip } from '@shared/ui/tooltip';
import type { Notebook } from '@features/memo';
import { NotebookSwitcher } from '@features/shell/components/status-bar/notebook-switcher';
import { useI18n } from '@features/i18n';

interface StatusBarProps {
  /** Current width of the memo list column; used to size the notebook dropdown. */
  memoColWidth: number;
  notebooks: Notebook[];
  selectedNotebook: Notebook | null;
  notebookPopupOpen: boolean;
  setNotebookPopupOpen: (open: boolean) => void;
  onSelectNotebook: (notebook: Notebook) => void;
  onEditNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onRefreshNotebooks: (notebooks: Notebook[]) => void;
  todoCount: number;
  onOpenTodos: () => void;
  charCount: number;
  onToggleAgentPanel: () => void;
  onToggleNoteNavigation: () => void;
  onOpenPreferences: () => void;
}

/**
 * Bottom status bar for the main window.
 *
 * Layout (left → right):
 *   [NotebookSwitcher] [Todos] [char count]   …flex spacer…   [AI Chat] [⚙]
 *
 * Renders no chrome of its own — it assumes it lives in a `h-6` flex strip.
 */
export function StatusBar({
  memoColWidth,
  notebooks,
  selectedNotebook,
  notebookPopupOpen,
  setNotebookPopupOpen,
  onSelectNotebook,
  onEditNotebook,
  onDeleteNotebook,
  onRefreshNotebooks,
  todoCount,
  onOpenTodos,
  charCount,
  onToggleAgentPanel,
  onToggleNoteNavigation,
  onOpenPreferences,
}: StatusBarProps) {
  const { t } = useI18n();
  return (
    <div className="h-[28px] shrink-0 flex items-center text-xs text-[var(--muted-foreground)] border-t border-[var(--divider)] bg-[var(--statusbar-bg)]">
      <div className="h-full flex items-center gap-1.5">
        <NotebookSwitcher
          open={notebookPopupOpen}
          onOpenChange={setNotebookPopupOpen}
          notebooks={notebooks}
          selectedNotebook={selectedNotebook}
          onSelect={onSelectNotebook}
          onEdit={onEditNotebook}
          onDelete={onDeleteNotebook}
          onRefresh={onRefreshNotebooks}
          dropdownWidth={memoColWidth}
        />
        <button
          type="button"
          className="h-full inline-flex items-center gap-1 px-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          aria-label={`${t('status.todos')} ${todoCount}`}
          onClick={onOpenTodos}
        >
          <ListTodo className="w-3.5 h-3.5 shrink-0" />
          <span>{t('status.todos')}</span>
          <span>{todoCount}</span>
        </button>
        {charCount > 0 && <span className="text-[var(--muted-foreground)]">{t('status.characters')} {charCount}</span>}
      </div>
      <div className="flex-1" />
      <Tooltip content="笔记导航">
        <button
          type="button"
          onClick={onToggleNoteNavigation}
          className="h-full flex items-center gap-1 px-1.5 py-0 hover:bg-[var(--muted)] mr-1"
          aria-label="笔记导航"
        >
          <Hash className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={t('status.aiChat')} shortcut="panel.agent.toggle">
        <button
          type="button"
          onClick={onToggleAgentPanel}
          className="h-full flex items-center gap-1 px-1.5 py-0 hover:bg-[var(--muted)] mr-1"
        >
          <Infinity className="w-3.5 h-3.5" />
          <span>{t('status.aiChat')}</span>
        </button>
      </Tooltip>
      <Tooltip content={t('status.preferences')} shortcut="menu.open" side="top">
        <button
          type="button"
          onClick={onOpenPreferences}
          className="h-full flex items-center justify-center px-1.5 py-0 hover:bg-[var(--muted)] mr-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label={t('status.preferences')}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
