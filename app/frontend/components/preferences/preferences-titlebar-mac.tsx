'use client';

/**
 * Mac title bar for the Preferences window.
 *
 * Design rules:
 * - h-12 (48px) — matches the rest of the Mac chrome (traffic lights live in
 *   the system-managed 28px strip on top of the window itself)
 * - 左侧 90px 留空给红绿灯
 * - 标题居中, 沿用 macOS Big Sur+ 的窗口标题惯例
 * - 整条作为 Tauri drag region
 */
export function PreferencesTitlebarMac() {
  return (
    <div
      data-tauri-drag-region
      className="h-12 shrink-0 pl-[90px] pr-4 flex items-center justify-center bg-[#f7f7f7] border-b border-black/5 select-none"
    >
      <span
        className="text-sm font-semibold tracking-tight text-[var(--foreground)] pointer-events-none"
        aria-label="Preferences"
      >
        Preferences
      </span>
    </div>
  );
}
