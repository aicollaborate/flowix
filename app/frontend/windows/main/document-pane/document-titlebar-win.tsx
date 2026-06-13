'use client';

import { SidebarToggleIcon } from '../../../components/icons/sidebar-toggle-icon';
import type { MemoItem } from '../../../lib/store';
import {
  type DocumentState,
  ExternalCopyButton,
  ExternalPathDisplay,
  ExternalSaveButton,
  MemoActions,
} from './document-titlebar-shared';
import type { MemoColor } from '../../../lib/store';

interface DocumentTitlebarWinProps {
  currentMemo: MemoItem | null;
  isSidebarHidden: boolean;
  isAgentPanelVisible: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onCopyLink: () => void;
  onCopyFullText: () => void;
  onTogglePin: () => void;
  onExportMarkdown: () => void;
  onExportWord: () => void;
  onRequestDeleteMemo: () => void;
  // 文档颜色标签 — 写入 list.json, 由 memo-event 链路回灌。 仅 memo 模式
  // 触发 (external markdown 没有 list.json 项, 不传 onColorsChange 也无害)。
  onColorsChange?: (next: MemoColor[]) => void;
  // Populated by main-layout when the active document is an external file
  // (not a memo). The titlebar then renders the path in the middle slot and
  // a "保存为笔记" button on the right. Mutually exclusive with currentMemo
  // in practice — both can technically be passed, but memo wins (see
  // documentState precedence below).
  externalFilePath?: string | null;
  isExternalSaving?: boolean;
  onSaveExternalToMemo?: () => void;
  onCopyExternalPath?: () => void;
}

// Windows-specific platform styles. h-7 fits the h-9 titlebar; rounded-lg
// matches Windows visual language; no bg/border so the buttons sit on the
// gradient only on hover.
const ICON_BTN =
  'w-7 h-7 flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] rounded-lg transition-colors';
const SAVE_BTN =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60';

export function DocumentTitlebarWin({
  currentMemo,
  isSidebarHidden,
  isAgentPanelVisible,
  onToggleSidebar,
  onOpenSearch,
  onCopyLink,
  onCopyFullText,
  onTogglePin,
  onExportMarkdown,
  onExportWord,
  onRequestDeleteMemo,
  onColorsChange,
  externalFilePath = null,
  isExternalSaving = false,
  onSaveExternalToMemo,
  onCopyExternalPath,
}: DocumentTitlebarWinProps) {
  // Three explicit states. `currentMemo` wins over `externalFilePath` to
  // preserve the existing precedence — when both are non-null the memo
  // action group takes priority. main-layout only sets one in practice.
  const documentState: DocumentState = currentMemo
    ? 'memo'
    : externalFilePath
      ? 'external'
      : 'empty';

  return (
    <div
      data-tauri-drag-region
      className={`h-9 shrink-0 pl-2 z-[50] flex items-center ${isAgentPanelVisible ? 'pr-0' : 'pr-[126px]'}`}
      style={{ backgroundImage: 'linear-gradient(to bottom, var(--bg-titlebar), transparent)' }}
    >
      {isSidebarHidden && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="显示备忘录列表"
          className="w-7 h-7 flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] rounded-lg transition-[opacity,transform,background-color] duration-[400ms] animate-in fade-in zoom-in-95"
        >
          <SidebarToggleIcon className="w-4 h-4" variant="collapsed" />
        </button>
      )}

      {documentState === 'external' && externalFilePath && (
        <ExternalPathDisplay path={externalFilePath} />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2 pr-2">
        {documentState === 'memo' && currentMemo && (
          <MemoActions
            memo={currentMemo}
            iconButtonClass={ICON_BTN}
            onOpenSearch={onOpenSearch}
            onCopyLink={onCopyLink}
            onCopyFullText={onCopyFullText}
            onTogglePin={onTogglePin}
            onExportMarkdown={onExportMarkdown}
            onExportWord={onExportWord}
            onRequestDeleteMemo={onRequestDeleteMemo}
            onColorsChange={onColorsChange ?? (() => {})}
          />
        )}
        {documentState === 'external' && externalFilePath && onSaveExternalToMemo && (
          <>
            {onCopyExternalPath && (
              <ExternalCopyButton
                onCopy={onCopyExternalPath}
                iconButtonClass={ICON_BTN}
              />
            )}
            <ExternalSaveButton
              isSaving={isExternalSaving}
              onSave={onSaveExternalToMemo}
              className={SAVE_BTN}
            />
          </>
        )}
      </div>
    </div>
  );
}
