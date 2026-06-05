/**
 * 全局常量定义
 */

import { SUPPORTED_TEXT_EXTENSIONS } from '../types';

// 文件类型
export const BINARY_EXTENSIONS = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
];

/** 判断是否为文本文件 */
export function isTextFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return SUPPORTED_TEXT_EXTENSIONS.some(e => ext === e || fileName.toLowerCase().endsWith(e));
}

// UI 存储键名
export const STORAGE_KEYS = {
  CHAT: 'woopmemo-chat-storage',
  SETTINGS: 'woopmemo-settings',
  TAG: 'woopmemo-tag',
  MEMO: 'woopmemo-memo-storage',
} as const;

// AI Settings 键名
export const USER_SETTINGS_KEYS = {
  CUSTOM_INSTRUCTION: 'customInstruction',
  SELECTED_TAGS: 'selectedTags',
  RESPONSE_LENGTH: 'responseLength',
  PREFERRED_LANGUAGE: 'preferredLanguage',
  USER_NAME: 'userName',
  USER_EMAIL: 'userEmail',
  AGENT_MODEL: 'agentModel',
  AGENT_API_URL: 'agentApiUrl',
  AGENT_API_KEY: 'agentApiKey',
  // 格式 (Format)
  FONT_FAMILY: 'fontFamily',
  FONT_SIZE: 'fontSize',
  LINE_HEIGHT: 'lineHeight',
  // 主题 (Theme)
  THEME: 'theme',
} as const;

export type UserSettingsKey = typeof USER_SETTINGS_KEYS[keyof typeof USER_SETTINGS_KEYS];

export interface UserSettings {
  customInstruction: string;
  selectedTags: string[];
  responseLength: string;
  preferredLanguage: string;
  userName: string;
  userEmail: string;
  agentModel: string;
  agentApiUrl: string;
  agentApiKey: string;
  /** 字体族 (CSS font-family stack) */
  fontFamily: string;
  /** 字号 (px) */
  fontSize: number;
  /** 行间距 (unitless line-height) */
  lineHeight: number;
  /** 主题 id, 见 THEME_OPTIONS */
  theme: ThemeId;
}

/* ============================================================
 * 主题 (Theme)
 * ----------------------------------------------------------------
 * 每个主题就是一组 CSS 变量覆写, 由 useApplyTheme 写入 :root。
 * - 'system' 是特殊主题: 跟随 prefers-color-scheme 在 light / dark 间切换
 * - 其余主题为静态色板
 *
 * preview.swatches 仅用于设置面板里的预览卡片, 与实际生效的 vars 解耦,
 * 这样卡片可以挑最具代表性的 3-4 个色块呈现, 而不必暴露全部 token。
 * ============================================================ */

export type ThemeId = 'system' | 'light' | 'dark' | 'rock' | 'mist';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** 预览卡片用的色板: [背景, 表面, 主色, 文字/边框] */
  preview: {
    background: string;
    surface: string;
    primary: string;
    accent: string;
  };
  /** 写入 :root 的 CSS 变量; 'system' 为空, 由 hook 在运行时挑 light/dark */
  vars: Record<string, string>;
}

const LIGHT_VARS: Record<string, string> = {
  '--background': '#ffffff',
  '--foreground': '#0d1a2b',
  '--card': '#ffffff',
  '--card-foreground': '#0d1a2b',
  '--popover': '#ffffff',
  '--popover-foreground': '#0d1a2b',
  '--primary': '#09244B',
  '--primary-foreground': '#ffffff',
  '--secondary': '#f1f3f5',
  '--secondary-foreground': '#1f2937',
  '--muted': '#f5f7fa',
  '--muted-foreground': '#979797',
  '--accent': '#f3f5f6',
  '--accent-foreground': '#1f2937',
  '--border': '#e5e7eb',
  '--input': '#e5e7eb',
  '--ring': '#b6c0cc',
  '--bg-titlebar': '#F8F8F8',
  '--memo-detail-bg': '#f6f8fb8e',
  '--statusbar-bg': '#e8e8e8',
};

const DARK_VARS: Record<string, string> = {
  '--background': '#0e1014',
  '--foreground': '#e6e8eb',
  '--card': '#16191f',
  '--card-foreground': '#e6e8eb',
  '--popover': '#16191f',
  '--popover-foreground': '#e6e8eb',
  '--primary': '#7aa2ff',
  '--primary-foreground': '#0e1014',
  '--secondary': '#1c2028',
  '--secondary-foreground': '#cfd3d8',
  '--muted': '#1a1d23',
  '--muted-foreground': '#8a8f97',
  '--accent': '#222732',
  '--accent-foreground': '#e6e8eb',
  '--border': '#262a31',
  '--input': '#262a31',
  '--ring': '#3a4150',
  '--bg-titlebar': '#0e1014',
  '--memo-detail-bg': '#13161c',
  '--statusbar-bg': '#16191f',
};

const ROCK_VARS: Record<string, string> = {
  '--background': '#ecebe6',
  '--foreground': '#2e2c28',
  '--card': '#f3f2ed',
  '--card-foreground': '#2e2c28',
  '--popover': '#f3f2ed',
  '--popover-foreground': '#2e2c28',
  '--primary': '#4a4744',
  '--primary-foreground': '#f3f2ed',
  '--secondary': '#e0ded7',
  '--secondary-foreground': '#3a3733',
  '--muted': '#e6e4dd',
  '--muted-foreground': '#8a857c',
  '--accent': '#dcd9d1',
  '--accent-foreground': '#3a3733',
  '--border': '#cfccc4',
  '--input': '#cfccc4',
  '--ring': '#b1aea4',
  '--bg-titlebar': '#e6e4dd',
  '--memo-detail-bg': '#f0eee8',
  '--statusbar-bg': '#dcd9d1',
};

const MIST_VARS: Record<string, string> = {
  '--background': '#f6f3fb',
  '--foreground': '#2a2440',
  '--card': '#fbf9ff',
  '--card-foreground': '#2a2440',
  '--popover': '#fbf9ff',
  '--popover-foreground': '#2a2440',
  '--primary': '#6b5bd6',
  '--primary-foreground': '#ffffff',
  '--secondary': '#ece5fa',
  '--secondary-foreground': '#3b3160',
  '--muted': '#efeaf8',
  '--muted-foreground': '#857ba0',
  '--accent': '#e4dbf7',
  '--accent-foreground': '#3b3160',
  '--border': '#dccff1',
  '--input': '#dccff1',
  '--ring': '#b6a6e5',
  '--bg-titlebar': '#eee7fa',
  '--memo-detail-bg': '#f3eefc',
  '--statusbar-bg': '#e4dbf7',
};

export const THEME_VARS_BY_ID: Record<Exclude<ThemeId, 'system'>, Record<string, string>> = {
  light: LIGHT_VARS,
  dark: DARK_VARS,
  rock: ROCK_VARS,
  mist: MIST_VARS,
};

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'system',
    label: '跟随系统',
    description: '随系统外观自动切换浅色 / 深色',
    preview: { background: '#ffffff', surface: '#0e1014', primary: '#09244B', accent: '#7aa2ff' },
    vars: {},
  },
  {
    id: 'light',
    label: '浅色',
    description: '明亮、清爽,适合白天',
    preview: { background: '#ffffff', surface: '#f5f7fa', primary: '#09244B', accent: '#e5e7eb' },
    vars: LIGHT_VARS,
  },
  {
    id: 'dark',
    label: '深色',
    description: '低光、护眼,适合夜间',
    preview: { background: '#0e1014', surface: '#16191f', primary: '#7aa2ff', accent: '#262a31' },
    vars: DARK_VARS,
  },
  {
    id: 'rock',
    label: '岩灰',
    description: '温润的暖灰,稳重低饱和',
    preview: { background: '#ecebe6', surface: '#f3f2ed', primary: '#4a4744', accent: '#cfccc4' },
    vars: ROCK_VARS,
  },
  {
    id: 'mist',
    label: '雾紫',
    description: '柔和的紫色调,文艺感',
    preview: { background: '#f6f3fb', surface: '#ece5fa', primary: '#6b5bd6', accent: '#dccff1' },
    vars: MIST_VARS,
  },
];

/**
 * 可选字体列表 - 与 menu-board.tsx 中 Font 下拉选项保持同步。
 * key 是 UI 标签, value 是写入 CSS 的 font-family stack。
 */
export const FONT_FAMILY_OPTIONS: { label: string; value: string }[] = [
  {
    label: 'Nunito Sans (默认)',
    value: "'Nunito Sans', 'Inter', -apple-system, 'Segoe UI', sans-serif, BlinkMacSystemFont",
  },
  {
    label: 'Inter',
    value: "'Inter', -apple-system, 'Segoe UI', sans-serif",
  },
  {
    label: 'PingFang SC',
    value: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  {
    label: 'Microsoft YaHei',
    value: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
  {
    label: 'System UI',
    value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  {
    label: 'Serif',
    value: "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
  },
  {
    label: 'Monospace',
    value: "'JetBrains Mono', 'Anonymous Pro', 'Consolas', 'Menlo', monospace",
  },
];

/** 字号范围 (px) */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_STEP = 1;

/** 行间距范围 (unitless) */
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.4;
export const LINE_HEIGHT_STEP = 0.05;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  customInstruction: '',
  selectedTags: [],
  responseLength: 'standard',
  preferredLanguage: 'zh',
  userName: 'User',
  userEmail: '',
  agentModel: 'MiniMax-M3',
  agentApiUrl: 'https://api.minimaxi.com/v1',
  agentApiKey: '',
  fontFamily: FONT_FAMILY_OPTIONS[0].value,
  fontSize: 15,
  lineHeight: 1.6,
  theme: 'system',
};

// UI 常量
export const DEFAULT_REQUEST_TIMEOUT = 600000;

// ---------- Toast 视觉常量 ----------

/** 单条 toast 默认展示时长 (ms) */
export const TOAST_DURATION_MS = 1600;

/** Toast 背景色 */
export const TOAST_BG = '#2d2f35';

/** Toast 阴影 (用于内联 box-shadow) */
export const TOAST_SHADOW =
  '0 16px 40px rgba(15,18,25,0.22), 0 3px 10px rgba(15,18,25,0.18)';

/** Toast 4 种 tone 对应的图标颜色 */
export const TOAST_COLORS = {
  success: '#09244B',
  error:   '#FF8A8A',
  info:    '#7CB9FF',
  warning: '#FFC56B',
} as const;

export type ToastColorKey = keyof typeof TOAST_COLORS;