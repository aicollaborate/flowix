'use client';

import { SlidersHorizontal } from 'lucide-react';
import { SidebarToggleIcon } from '../../../components/icons/sidebar-toggle-icon';

interface MemoListTitlebarMacProps {
  onCollapseSidebar: () => void;
  onOpenPreferences: () => void;
}

export function MemoListTitlebarMac({
  onCollapseSidebar,
  onOpenPreferences,
}: MemoListTitlebarMacProps) {
  return (
    <div data-tauri-drag-region className="h-12 px-3 shrink-0 flex items-center justify-end gap-1">
      <button
        onClick={onCollapseSidebar}
        title="折叠侧栏"
        className="w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        <SidebarToggleIcon className="w-5 h-5" />
      </button>
      <button
        onClick={onOpenPreferences}
        title="偏好设置"
        className="w-8 h-8 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        <SlidersHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}
