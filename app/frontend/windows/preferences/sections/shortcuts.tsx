'use client';

import { SectionHeader } from './primitives';

const shortcutsList = [
  { keys: ['⌘', 'K'], label: '快速搜索' },
  { keys: ['⌘', 'N'], label: '新建笔记' },
  { keys: ['⌘', 'Shift', 'N'], label: '新建文件夹' },
  { keys: ['⌘', '/'], label: '查看快捷键' },
  { keys: ['⌘', 'S'], label: '保存笔记' },
  { keys: ['⌘', 'B'], label: '折叠 / 展开侧栏' },
];

export function ShortcutsSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="键盘快捷键"
      />
      <div className="space-y-2">
        {shortcutsList.map((shortcut, index) => (
          <div
            key={index}
            className="flex items-center justify-between py-2.5 pl-0 pr-3 rounded-lg bg-[var(--card)] hover:bg-[var(--muted)] transition-colors"
          >
            <span className="text-sm text-[var(--foreground)]">{shortcut.label}</span>
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key, i) => (
                <kbd
                  key={i}
                  className="px-1.5 py-0.5 text-xs font-mono bg-[var(--muted)] text-[var(--muted-foreground)] rounded border border-[var(--divider)]"
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
