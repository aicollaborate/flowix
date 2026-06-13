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

interface DocumentTitlebarMacProps {
  currentMemo: MemoItem | null;
  isSidebarHidden: boolean;
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

// Mac-specific platform styles. h-8 matches the h-12 titlebar's hit area;
// rounded-xl matches macOS visual language; bg-titlebar + border so the
// buttons sit visibly on the gradient background.
const ICON_BTN =
  'w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] rounded-xl transition-colors bg-[var(--bg-titlebar)] border border-[var(--border)]';
const SAVE_BTN =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-titlebar)] px-3 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60';

export function DocumentTitlebarMac({
  currentMemo,
  isSidebarHidden,
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
}: DocumentTitlebarMacProps) {
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
      className={`h-12 shrink-0 ${isSidebarHidden ? 'pl-[90px]' : 'pl-0'} pr-0 z-[50] flex items-center`}
      style={{ backgroundImage: 'linear-gradient(to bottom, var(--bg-titlebar), transparent)' }}
    >
      {isSidebarHidden && (
        <button
          onClick={onToggleSidebar}
          className="w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] rounded-xl transition-colors"
        >
          <SidebarToggleIcon className="w-5 h-5" variant="collapsed" />
        </button>
      )}

      {documentState === 'external' && externalFilePath && (
        <ExternalPathDisplay path={externalFilePath} />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3 pr-2">
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
