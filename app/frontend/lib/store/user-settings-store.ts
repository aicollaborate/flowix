import { create } from 'zustand';
import { preferences as tauriPreferences } from '../tauri/client';
import {
  DEFAULT_USER_SETTINGS,
  FONT_FAMILY_OPTIONS,
  type PersonalizeConfig,
  type FormatConfig,
  type UserSettings,
} from '../constants';
import { sanitizeTheme, type ThemeId } from '../theme';

/**
 * 偏好设置全局单例 store。
 *
 * 为什么不用 useState: 同一个 React 树里 useUserSettings 被多次调用
 * (App.tsx 顶层 + PreferencesView + AccountSection 等), 每个 hook 调用
 * 都是独立的 useState, updateSettings 只更新本实例的 state, 其他实例
 * 看不到 — 导致"刚改的值在另一处读不到、刷新后丢失"的诡异 bug。
 *
 * 用 zustand 单例后, 任何订阅者拿到的都是同一份 state, 写入立即通知
 * 所有订阅者。 后端 IPC 仍走 ~/.flowix/preference.json, 这里只是前端
 * 状态层的统一源。
 */

// sanitizeTheme / VALID_THEME_IDS 统一收敛在 lib/theme/sanitize.ts, 这里不再重复。

function mergeSettings(base: UserSettings, updates: UserSettingsUpdate): UserSettings {
  const theme = updates.theme !== undefined
    ? sanitizeTheme(updates.theme, base.theme)
    : base.theme;
  return {
    personalize: { ...base.personalize, ...(updates.personalize ?? {}) },
    format: { ...base.format, ...(updates.format ?? {}) },
    theme,
  };
}

/** 兜底默认值 — 字段为空 (老 snake_case 数据 / 外部写入 / 迁移中等) 时填充,
 *  保证 UI 始终有可显示的值。
 *  关键: 这些 fallback 必须等于 DEFAULT_USER_SETTINGS 的对应字段, 否则
 *  会出现"全新安装显示 A, 数据损坏后变成 B"的诡异跳变 (P3#1 修过)。
 *  - responseLength / preferredLanguage: 与 DEFAULT_USER_SETTINGS 一致
 *  - fontFamily / fontSize / lineHeight: 同上
 *  - customInstruction / selectedTags: 允许空, 不兜底
 */
function sanitizeSettings(settings: UserSettings): UserSettings {
  return {
    personalize: {
      customInstruction: settings.personalize.customInstruction,
      responseLength:
        settings.personalize.responseLength || DEFAULT_USER_SETTINGS.personalize.responseLength,
      preferredLanguage:
        settings.personalize.preferredLanguage ||
        DEFAULT_USER_SETTINGS.personalize.preferredLanguage,
      selectedTags: settings.personalize.selectedTags,
    },
    format: {
      fontFamily: settings.format.fontFamily || FONT_FAMILY_OPTIONS[0].value,
      fontSize: settings.format.fontSize || DEFAULT_USER_SETTINGS.format.fontSize,
      lineHeight: settings.format.lineHeight || DEFAULT_USER_SETTINGS.format.lineHeight,
    },
    theme: settings.theme,
  };
}

/** updateSettings 接受的 patch 形状 — 每个分组都是 Partial, 顶层 theme 是可选。 */
export interface UserSettingsUpdate {
  personalize?: Partial<PersonalizeConfig>;
  format?: Partial<FormatConfig>;
  theme?: ThemeId;
}

interface UserSettingsState {
  settings: UserSettings;
  isLoading: boolean;
  /** 启动时从后端加载一次, 写盘由 setPending 自动 debounce 落盘 */
  loadInitial: () => Promise<void>;
  /** 更新 settings: 同步写状态, 异步 debounce 落盘 (200ms)。
   *  返回 Promise<void> 以保持与旧 useUserSettings 的 Promise 签名兼容。 */
  updateSettings: (updates: UserSettingsUpdate) => Promise<void>;
  /** 强制立即 flush pending 写盘 — 卸载时用 */
  flushPending: () => Promise<void>;
}

const FLUSH_DELAY_MS = 200;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: UserSettings | null = null;

async function writeToBackend(settings: UserSettings): Promise<void> {
  try {
    await tauriPreferences.set(settings);
  } catch (error) {
    console.error('Failed to persist settings:', error);
  }
}

/** debounced flush — 拖动滑块 / 连续敲键盘时合并多次写盘 */
function scheduleFlush(settings: UserSettings): void {
  pendingSettings = settings;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const toWrite = pendingSettings;
    flushTimer = null;
    pendingSettings = null;
    if (toWrite) void writeToBackend(toWrite);
  }, FLUSH_DELAY_MS);
}

export const useUserSettingsStore = create<UserSettingsState>((set, get) => ({
  settings: DEFAULT_USER_SETTINGS,
  isLoading: true,

  loadInitial: async () => {
    try {
      const loaded = await tauriPreferences.get();
      const theme = sanitizeTheme(
        (loaded as Partial<UserSettings>).theme,
        DEFAULT_USER_SETTINGS.theme,
      );
      const merged = mergeSettings(DEFAULT_USER_SETTINGS, { ...loaded, theme });
      const sanitized = sanitizeSettings(merged);
      set({ settings: sanitized, isLoading: false });
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ isLoading: false });
    }
  },

  updateSettings: (updates) => {
    const next = mergeSettings(get().settings, updates);
    set({ settings: next });
    scheduleFlush(next);
    // 返回 Promise<void> 以保持与旧 useUserSettings 的 Promise 签名兼容
    // (section 内部有些代码 await 这个返回值)。
    return Promise.resolve();
  },

  flushPending: async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingSettings) {
      const toWrite = pendingSettings;
      pendingSettings = null;
      await writeToBackend(toWrite);
    }
  },
}));
