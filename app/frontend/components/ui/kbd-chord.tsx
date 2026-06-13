'use client';

import { formatChord } from '../../lib/shortcuts';
import { cn } from '../../lib/utils';

/**
 * 平台感知的快捷键展示组件 — 给一个 chord 字符串 (e.g. 'Mod+Shift+K'),
 * 按当前平台渲染为:
 *   - Mac:   ⌘⇧K   (Unicode 修饰符 + 大写主键)
 *   - Win:   Ctrl+Shift+K
 *
 * 视觉: 外框 + 无背景, 文字用 muted-foreground 让 binding 不抢 action 标题的
 * 视觉权重。 这是 GitHub / Notion / Linear 的常见风格 — 比"灰底实心"更轻,
 * 偏好列表多行排列时眼睛负担更小。
 *
 * 与 components/ui/kbd.tsx 的区别: 那个是 form 内部 hint (absolute 定位、
 * 透明背景), 这里是 standalone 展示 (有边框, 强调"这是一个键")。
 *
 * 故意做成单一 kbd 元素: 单 chord 渲染成一行, 比拆成多 kbd + 间隔更紧凑。
 * 如果未来想要"VS Code 多键风格"再加 variant。
 */
export interface KbdChordProps {
  /** chord 字符串 — 与 actions.ts defaultBinding / parser.parseChord 同格式。 */
  chord: string;
  className?: string;
}

export function KbdChord({ chord, className }: KbdChordProps) {
  const display = formatChord(chord);
  return (
    <kbd
      className={cn(
        'inline-flex h-5 select-none items-center rounded border border-[var(--border)] px-1.5 font-mono text-[11px] font-medium tracking-widest text-[var(--muted-foreground)]',
        className,
      )}
    >
      {display}
    </kbd>
  );
}
