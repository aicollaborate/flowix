'use client';

import { useEffect } from 'react';
import type { FormatConfig } from '../constants';

/**
 * 将用户在「Preferences → Format」中选择的字体/字号/行间距写入 :root
 * 的 CSS 变量, 让全应用 (body + Tiptap 编辑器 + 自定义组件) 即时生效。
 *
 * 与之配套的变量定义在 css/index.css :
 *   --app-font-family
 *   --app-font-size
 *   --app-line-height
 *
 * 调用方: App.tsx (主窗口 + 偏好设置窗口都会挂载, 因此跨窗口都会立即响应)。
 */
export function useApplyFontSettings(format: FormatConfig | undefined) {
  useEffect(() => {
    if (!format) return;
    const root = document.documentElement;
    if (format.fontFamily) {
      root.style.setProperty('--app-font-family', format.fontFamily);
    }
    if (typeof format.fontSize === 'number' && !Number.isNaN(format.fontSize)) {
      root.style.setProperty('--app-font-size', `${format.fontSize}px`);
    }
    if (typeof format.lineHeight === 'number' && !Number.isNaN(format.lineHeight)) {
      root.style.setProperty('--app-line-height', String(format.lineHeight));
    }
  }, [format?.fontFamily, format?.fontSize, format?.lineHeight]);
}
