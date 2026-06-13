'use client';

import { useEffect } from 'react';
import { applyTheme, sanitizeTheme, type ThemeId } from '../theme';

/**
 * 把用户选的主题应用到 <html>。
 *
 * 行为:
 * - 'system' 时订阅 prefers-color-scheme 变化, 实时跟随。
 * - 切换后 dispatch 'app-theme-changed' 事件, 消费方 (comn-tiptap-editor) 据此
 *   强制 Shiki PM 插件重算装饰 — 因为 PM 装饰不监听 CSS var 变化。
 *
 * 真实写盘逻辑委托给 lib/theme/apply.ts 纯函数, 这个 hook 只做 React 副作用装配。
 * 新代码优先使用 <ThemeProvider>; 本 hook 保留为薄封装以不破坏历史调用点。
 */
export function useApplyTheme(theme: ThemeId | string | undefined) {
  useEffect(() => {
    const id = sanitizeTheme(theme);
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = applyTheme(root, id, { prefersDark: mq.matches });
      window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { theme: resolved } }));
    };
    apply();
    if (id === 'system') {
      const listener = () => apply();
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [theme]);
}
