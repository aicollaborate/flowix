'use client';

import { SidebarToggleIcon } from '@shared/icons/sidebar-toggle-icon';
import { Tooltip } from '@shared/ui/tooltip';
import productLogo from '@/assets/product-logo.png';

interface MemoListTitlebarWinProps {
  onCollapseSidebar: () => void;
  onOpenPreferences: () => void;
}

export function MemoListTitlebarWin({
  onCollapseSidebar,
  onOpenPreferences,
}: MemoListTitlebarWinProps) {
  return (
    <div
      data-tauri-drag-region
      className="h-9 px-2 shrink-0 flex items-center justify-between gap-1"
    >
      <Tooltip content="Preferences" shortcut="menu.open">
        <button
          type="button"
          onClick={onOpenPreferences}
          aria-label="Open preferences"
          className="flex h-7 items-center gap-1.5 rounded-md pl-1 pr-2 select-none transition-colors hover:bg-[var(--muted)]"
        >
          <img src={productLogo} alt="" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded" />
          <span className="leading-none translate-y-[1px] text-[14px] font-semibold tracking-tight bg-gradient-to-r from-[#5262DC] via-[#6F5BD8] to-[#8A6DDC] bg-clip-text text-transparent">
            Flowix
          </span>
        </button>
      </Tooltip>
      <div className="flex items-center gap-1">
        <Tooltip content="Collapse sidebar" shortcut="panel.memoList.toggle">
          <button
            type="button"
            onClick={onCollapseSidebar}
            aria-label="Collapse sidebar"
            className="w-7 h-7 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <SidebarToggleIcon className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
