'use client';

import { useEffect } from 'react';
import { THEME_VARS_BY_ID, type ThemeId } from '../constants';

/**
 * 将用户选择的主题写入 :root 的 CSS 变量。
 *
 * 'system' 会订阅 prefers-color-scheme, 在 light / dark 之间动态切换;
 * 其它主题为静态变量集, 直接 setProperty。
 *
 * 切换主题时, 仅先清除上一组写过的变量, 避免 light → dark 时遗留
 * 浅色专属 token 污染深色面板。
 */
export function useApplyTheme(theme: ThemeId | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const active: ThemeId = theme ?? 'system';

    /** 实际写入页面的 vars (system 会被解析成 light 或 dark) */
    const resolve = (): Record<string, string> => {
      if (active !== 'system') return THEME_VARS_BY_ID[active];
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      return prefersDark ? THEME_VARS_BY_ID.dark : THEME_VARS_BY_ID.light;
    };

    /** 全主题的并集 — 清除时统一抹掉, 避免残留 */
    const allKeys = new Set<string>();
    Object.values(THEME_VARS_BY_ID).forEach((vars) => {
      Object.keys(vars).forEach((k) => allKeys.add(k));
    });

    const apply = () => {
      const vars = resolve();
      allKeys.forEach((k) => root.style.removeProperty(k));
      Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
      // 顺手在 <html> 上打 data-theme 属性, 方便 Tiptap / 第三方组件依据它定制
      root.setAttribute('data-theme', active === 'system'
        ? (resolve() === THEME_VARS_BY_ID.dark ? 'dark' : 'light')
        : active);
    };

    apply();

    // 跟随系统时, 订阅系统外观变化
    if (active === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => apply();
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [theme]);
}
