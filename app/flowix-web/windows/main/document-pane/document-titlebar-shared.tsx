'use client';

import { Fragment } from 'react';
import { Check, ChevronRight, Ellipsis, Paintbrush, Palette, Search } from 'lucide-react';
import {
  LinkSimpleIcon,
  CopyIcon,
  PushPinIcon,
  PushPinSlashIcon,
  FileMdIcon,
  FileDocIcon,
  ClockIcon,
  TrashIcon,
  BoxArrowDownIcon,
} from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../../components/ui/dropdown-menu';
import {
  MEMO_COLORS,
  MEMO_COLOR_HEX,
  type MemoColor,
  type MemoItem,
} from '../../../lib/store';

/**
 * Document state for the titlebar. Exactly one is active at a time:
 *   - 'empty':    no memo, no external file (titlebar shows only the shell
 *                 and the optional sidebar toggle)
 *   - 'memo':     an internal memo is open → memo action group on the right
 *   - 'external': an external file is open → path display in the middle,
 *                 "保存为笔记" button on the right
 */
export type DocumentState = 'empty' | 'memo' | 'external';

// =====================================================================
// External file path display — platform-agnostic, zero-prop besides path
// =====================================================================

export function ExternalPathDisplay({ path }: { path: string }) {
  // Split "/Users/rop/.../file.md" into segments and drop the leading empty
  // entry from the leading slash. Trailing/duplicate slashes are also dropped
  // by filter(Boolean).
  const segments = path.split('/').filter(Boolean);

  return (
    <div className="w-fit max-w-full min-w-0 pl-3" title={path}>
      <div className="flex items-center overflow-hidden text-xs text-[var(--foreground)]">
        {segments.map((segment, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight
                aria-hidden="true"
                className="mx-1 h-3 w-3 shrink-0 text-[var(--muted-foreground)]"
              />
            )}
            <span className="shrink-0">{segment}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// External save button — icon + text identical across platforms,
// className (height / radius / bg / border / padding) supplied by caller
// =====================================================================

export function ExternalSaveButton({
  isSaving,
  onSave,
  className,
}: {
  isSaving: boolean;
  onSave: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={isSaving}
      className={className}
    >
      <BoxArrowDownIcon className="h-4 w-4" />
      <span className="text-xs">{isSaving ? '保存中...' : '保存为笔记'}</span>
    </button>
  );
}

// =====================================================================
// External copy-path button — icon only, iconButtonClass supplied by caller
// (uses the same class as the memo action icon buttons for visual unity)
// =====================================================================

export function ExternalCopyButton({
  onCopy,
  iconButtonClass,
}: {
  onCopy: () => void;
  iconButtonClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title="复制完整路径"
      aria-label="复制完整路径"
      className={iconButtonClass}
    >
      <CopyIcon className="w-4 h-4" />
    </button>
  );
}

// =====================================================================
// Memo color picker — multi-select, dropdown of 7 swatches
// 触发按钮:
//   - 空数组 (无颜色) 时显示 `Palette` 图标
//   - 至少 1 个颜色时显示叠加的小圆点 (右上偏移, 制造"多色"的视觉密度)
// 7 个色块 + 1 个 "无" 按钮: 点色块 toggle, 点 "无" 清空全部。 每次切换
// 把整组新颜色走 `onChange` 一次性写回后端, 由 memo-event 链路回灌 store。
// =====================================================================

const COLOR_LABELS: Record<MemoColor, string> = {
  red: '红',
  orange: '橙',
  yellow: '黄',
  green: '绿',
  cyan: '青',
  blue: '蓝',
  gray: '灰',
};

export function MemoColorPicker({
  colors,
  iconButtonClass,
  onChange,
}: {
  colors: MemoColor[];
  iconButtonClass: string;
  onChange: (next: MemoColor[]) => void;
}) {
  const selected = new Set(colors);

  const toggle = (c: MemoColor) => {
    const next = new Set(selected);
    if (next.has(c)) {
      next.delete(c);
    } else {
      next.add(c);
    }
    // 保持 MEMO_COLORS 声明顺序, 列表 / 触发按钮展示稳定。
    onChange(MEMO_COLORS.filter((c) => next.has(c)));
  };

  const clear = () => onChange([]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="文档颜色"
          aria-label="文档颜色"
          className={iconButtonClass}
        >
          {colors.length > 0 ? (
            <span aria-hidden="true" className="relative block h-3.5 w-3.5">
              {colors.slice(0, 3).map((c, i) => (
                <span
                  key={c}
                  className="absolute h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: MEMO_COLOR_HEX[c],
                    top: colors.length === 1 ? '2px' : `${(i % 2) * 4}px`,
                    left: colors.length === 1 ? '2px' : `${(i % 2) * 4}px`,
                    zIndex: 10 - i,
                  }}
                />
              ))}
            </span>
          ) : (
            <Palette className="w-4 h-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[180px] p-2"
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="无颜色"
            aria-label="清除颜色"
            onClick={clear}
            className={`relative h-7 w-7 rounded-md transition-colors ${
              colors.length === 0
                ? 'ring-2 ring-[var(--muted)]'
                : 'hover:bg-[var(--muted)]'
            }`}
          >
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--muted-foreground)]">
              <Paintbrush className="h-3.5 w-3.5" />
            </span>
          </button>
          {MEMO_COLORS.map((c) => {
            const isSelected = selected.has(c);
            return (
              <button
                key={c}
                type="button"
                title={COLOR_LABELS[c]}
                aria-label={COLOR_LABELS[c]}
                aria-pressed={isSelected}
                onClick={() => toggle(c)}
                className="relative h-7 w-7 rounded-md transition-transform hover:scale-110"
                style={{ backgroundColor: MEMO_COLOR_HEX[c] }}
              >
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center text-white opacity-70"
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =====================================================================
// Memo action group — color + search + ellipsis dropdown
// iconButtonClass (size / radius / bg / border) supplied by caller
// =====================================================================

export function MemoActions({
  memo,
  iconButtonClass,
  onOpenSearch,
  onCopyLink,
  onCopyFullText,
  onTogglePin,
  onExportMarkdown,
  onExportWord,
  onRequestDeleteMemo,
  onColorsChange,
}: {
  memo: MemoItem;
  iconButtonClass: string;
  onOpenSearch: () => void;
  onCopyLink: () => void;
  onCopyFullText: () => void;
  onTogglePin: () => void;
  onExportMarkdown: () => void;
  onExportWord: () => void;
  onRequestDeleteMemo: () => void;
  onColorsChange: (next: MemoColor[]) => void;
}) {
  const isPinned = !!memo.favorited;

  return (
    <>
      <MemoColorPicker
        colors={memo.colors}
        iconButtonClass={iconButtonClass}
        onChange={onColorsChange}
      />
      <button
        onClick={onOpenSearch}
        title="文档搜索"
        className={iconButtonClass}
      >
        <Search className="w-4 h-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button title="更多" className={iconButtonClass}>
            <Ellipsis className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px] px-1 py-1.5 space-y-1">
          <DropdownMenuItem
            onClick={onCopyLink}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
          >
            <LinkSimpleIcon className="w-4 h-4 mr-2" /> 复制链接
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCopyFullText}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
          >
            <CopyIcon className="w-4 h-4 mr-2" /> 复制全文
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onTogglePin}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
          >
            {isPinned ? (
              <><PushPinSlashIcon className="w-4 h-4 mr-2" /> 取消置顶</>
            ) : (
              <><PushPinIcon className="w-4 h-4 mr-2" /> 置顶</>
            )}
          </DropdownMenuItem>
          <hr className="mx-2 border-t border-[var(--border)] opacity-50" />
          <DropdownMenuItem
            onClick={onExportMarkdown}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
          >
            <FileMdIcon className="w-4 h-4 mr-2" /> 导出为 Markdown
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onExportWord}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
          >
            <FileDocIcon className="w-4 h-4 mr-2" /> 导出为 Word
          </DropdownMenuItem>
          <hr className="mx-2 border-t border-[var(--border)] opacity-50" />
          <DropdownMenuItem className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]">
            <ClockIcon className="w-4 h-4 mr-2" /> 历史版本
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRequestDeleteMemo}
            className="flex items-center cursor-pointer rounded-md px-2 hover:bg-[var(--muted)] text-[var(--destructive)]"
          >
            <TrashIcon className="w-4 h-4 mr-2" /> 删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
