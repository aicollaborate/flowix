'use client';

import { useUserSettingsStore, type UserSettingsUpdate } from '../store/user-settings-store';

/**
 * 偏好设置 hook — 薄包装层, 委托给全局 zustand store。
 *
 * 真实状态在 lib/store/user-settings-store.ts: 全进程单例, 多个调用方
 * 共享同一份 settings。任何 updateSettings 调用立即通知所有订阅者。
 *
 * 启动加载 (loadInitial) 需在 App.tsx 顶层显式调一次, 见 App.tsx。
 */
export function useUserSettings() {
  const settings = useUserSettingsStore((s) => s.settings);
  const isLoading = useUserSettingsStore((s) => s.isLoading);
  const updateSettings = useUserSettingsStore((s) => s.updateSettings);
  return { settings, isLoading, updateSettings };
}

export type { UserSettingsUpdate };
