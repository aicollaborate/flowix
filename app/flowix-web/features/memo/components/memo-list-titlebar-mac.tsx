'use client';

import { SlidersHorizontal } from 'lucide-react';
import { SidebarToggleIcon } from '@shared/icons/sidebar-toggle-icon';
import { Tooltip } from '@shared/ui/tooltip';
import { useI18n } from '@features/i18n';

interface MemoListTitlebarMacProps {
  onCollapseSidebar: () => void;
  onOpenPreferences: () => void;
}

export function MemoListTitlebarMac({
  onCollapseSidebar,
  onOpenPreferences,
}: MemoListTitlebarMacProps) {
  const { t } = useI18n();
  return (
    <div data-tauri-drag-region className="h-12 px-3 shrink-0 flex items-center justify-end gap-1">
      <Tooltip content={t("memo.list.collapseSidebarTooltip")} shortcut="panel.memoList.toggle">
        <button
          type="button"
          onClick={onCollapseSidebar}
          aria-label={t("memo.list.collapseSidebar")}
          className="w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <SidebarToggleIcon className="w-5 h-5" />
        </button>
      </Tooltip>
      <Tooltip content={t("memo.list.preferencesTooltip")} shortcut="menu.open">
        <button
          type="button"
          onClick={onOpenPreferences}
          aria-label={t("memo.list.preferences")}
          className="w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </Tooltip>
    </div>
  );
}
