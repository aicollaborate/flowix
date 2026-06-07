# 主题系统重构方案

> 状态：待评审
> 适用范围：Flowix 前端主题系统 + 后端 `theme` 字段
> 目标版本：下一迭代

---

## 1. 概述

当前主题系统已经能"跑"——核心链路（用户点选 → store → IPC → 写盘 → 跨窗口同步 → 应用）成立，且对未知值有白名单兜底。但存在三类可观察的工程问题：

1. **主题切不干净** — dark / rock / mist 下，`.tiptap` / `.markdown-body` / 滚动条 / 欢迎页等仍是亮色，与"4 套主题"宣传不符。
2. **真源分散** — 合法主题白名单在 2 处重复定义，主题 vars 在 2 处存在（`THEME_VARS_BY_ID` + `THEME_OPTIONS[].vars`），后端用裸 `String` 而非 enum。
3. **运行时过度** — 切一次主题需要 24 次 `removeProperty` + 24 次 `setProperty`，完全可以用一行 `setAttribute` 替代。

本方案在不增加抽象层（不做 Token / ThemeBundle）的前提下，**把 vars 100% 移到 CSS，JS 只 `setAttribute`，所有合法值与兜底逻辑收敛到 `lib/theme/` 单点**。预计净增 ~60 行代码（新增 6 个 TS + 4 个 CSS 文件，但 `index.css` 减少 ~60 行硬编码 vars）。

---

## 2. 当前问题清单

按严重程度排序：

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | `VALID_THEME_IDS` 在 2 处重复 | `useApplyTheme.ts:17`, `user-settings-store.ts:25` | 加主题易漏改，导致 `THEME_VARS_BY_ID[active]` 拿到 `undefined` 崩溃 |
| 2 | 后端 `theme: String` 无 schema 校验 | `user_config.rs:45-47` | 任意字符串可写入；扩展客户端时需重新实现白名单 |
| 3 | 默认值 `"system"` 在前后端各写一次 | `constants.ts:297`, `user_config.rs:34-36` | 改默认值需 2 处同步 |
| 4 | JS 24 次 `setProperty` 切主题 | `useApplyTheme.ts:43-51` | 性能与代码量均次优；CSS 原生 cascade 即可 |
| 5 | `data-theme` 属性被写但无人读 | `useApplyTheme.ts:47-50` | 假信号；且 `codeblock-shiki-view.ts:48` 同名属性表示 shiki 主题，命名空间污染 |
| 6 | `.markdown-body` / `.tiptap` 硬编码 `#ffffff` | `index.css:81-95` | dark/rock/mist 下编辑器与渲染区仍是亮色 |
| 7 | `.agent-welcome-*` / 滚动条硬编码 | `index.css:490-545` | dark/rock/mist 下欢迎页/滚动条颜色错位 |
| 8 | 主题 vars 在 `constants.ts` 与 `THEME_OPTIONS[].vars` 两处存在 | `constants.ts:91-236` | 单主题加变量需 2 处同步 |
| 9 | `system` 是"调度器"但放在主题枚举里 | `constants.ts:74` | 类型上要 `Exclude<ThemeId, 'system'>` 才能用 vars，语义混淆 |
| 10 | `useApply*` 在 App.tsx 散点 | `App.tsx:31-32` | 每加一种运行时 CSS 副作用都要在 App.tsx 挂一行 |
| 11 | 首次渲染有 FOUC 窗口 | `useApplyTheme` 是 `useEffect` | 首帧看到 `:root` 默认值再切换 |

---

## 3. 设计目标

- ✅ **vars 100% 在 CSS** — JS 不持有颜色字面量
- ✅ **切主题 = 1 行 `setAttribute`** — 不再 `setProperty × 24`
- ✅ **单一真源** — `VALID_THEME_IDS` / `DEFAULT_THEME_ID` / `THEME_OPTIONS` 各一份
- ✅ **后端 schema 化** — Rust `Theme` enum 替代 `String`
- ✅ **可测** — `applyTheme` 是纯函数，不依赖 React
- ✅ **可演进但不预演** — 不做 Token 抽象 / 不做 ThemeBundle

---

## 4. 最终架构

```
                  ┌──────────────────────────────────────┐
                  │  lib/theme/  (前端单一真源)            │
                  │  ├─ types.ts     ThemeId 联合类型      │
                  │  ├─ palette.ts   THEME_IDS / DEFAULT  │
                  │  ├─ sanitize.ts  sanitizeTheme()       │
                  │  ├─ apply.ts     applyTheme() 纯函数   │
                  │  ├─ options.ts   THEME_OPTIONS UI 元数据│
                  │  └─ provider.tsx <ThemeProvider>       │
                  └──────────────────────────────────────┘
                              ▲             ▲
                              │             │
        ┌─────────────────────┘             └──────────────────────┐
        │                                                          │
   ┌────────────┐                                          ┌──────────────┐
   │  useApply  │ hook (旧,保留为薄封装)                    │  user-       │
   │  Theme()   │                                          │  settings-   │
   │            │  或直接用 <ThemeProvider>                │  store.ts    │
   └────────────┘                                          └──────────────┘
                                                                   │
                                                                   ▼
                                              ┌──────────────────────────────┐
                                              │  Rust Theme enum             │
                                              │  (Serialize as 'system'..)   │
                                              │  ←→ ~/.flowix/preference.json  │
                                              └──────────────────────────────┘

   ┌────────────────────────────────────────────────────────────────────┐
   │  css/theme/{light,dark,rock,mist}.css                              │
   │    :root                   { /* light vars, 默认 */ }              │
   │    [data-theme="dark"]     { /* dark vars  */ }                    │
   │    [data-theme="rock"]     { /* rock vars  */ }                    │
   │    [data-theme="mist"]     { /* mist vars  */ }                    │
   └────────────────────────────────────────────────────────────────────┘
```

---

## 5. 文件结构

### 5.1 新建文件

```
app/frontend/lib/theme/
  index.ts            # 桶导出（types / palette / sanitize / apply / options / provider）
  types.ts            # ThemeId, ResolvedThemeId
  palette.ts          # THEME_IDS, DEFAULT_THEME_ID
  sanitize.ts         # sanitizeTheme(), resolveSystemTheme()
  apply.ts            # applyTheme(root, themeId, opts) 纯函数
  options.ts          # THEME_OPTIONS, ThemeOption
  provider.tsx        # <ThemeProvider>

app/frontend/css/theme/
  light.css           # :root 变量（默认主题）
  dark.css            # [data-theme="dark"] 变量
  rock.css            # [data-theme="rock"] 变量
  mist.css            # [data-theme="mist"] 变量
```

### 5.2 修改文件

| 文件 | 改动 |
|---|---|
| `app/frontend/css/index.css` | 删除 ~60 行硬编码 vars，import 4 个 `theme/*.css`；修 `.markdown-body` / `.tiptap` / 滚动条 / 欢迎页硬编码 |
| `app/frontend/lib/constants.ts` | 删除 `ThemeId` / `THEME_VARS_BY_ID` / `LIGHT_VARS` / `DARK_VARS` / `ROCK_VARS` / `MIST_VARS` / `THEME_OPTIONS` / `ThemeOption`（共 ~160 行），全部移到 `lib/theme/` |
| `app/frontend/lib/hooks/useApplyTheme.ts` | 重写为 ~18 行薄封装（委托给 `applyTheme`） |
| `app/frontend/lib/store/user-settings-store.ts` | 删本地 `VALID_THEME_IDS` 与 `sanitizeTheme`，统一 import from `lib/theme` |
| `app/frontend/App.tsx` | 用 `<ThemeProvider>` 替换 `useApplyTheme(settings.theme)` |
| `app/frontend/windows/preferences/sections/theme.tsx` | import 路径改 `lib/theme`；`DEFAULT_USER_SETTINGS.theme` 改 `DEFAULT_THEME_ID` |
| `app/backend/src/user_config.rs` | `theme: String` 改 `theme: Theme`（enum），删 `default_theme()`，删手工 `impl Default` |

---

## 6. 详细实现

### 6.1 `lib/theme/types.ts`

```ts
export type ThemeId = 'system' | 'light' | 'dark' | 'rock' | 'mist';
export type ResolvedThemeId = Exclude<ThemeId, 'system'>;
```

### 6.2 `lib/theme/palette.ts`

```ts
import type { ThemeId } from './types';

/** 单一真源 — useApplyTheme / store / 后端都引用这份。 */
export const THEME_IDS = ['system', 'light', 'dark', 'rock', 'mist'] as const;

export const DEFAULT_THEME_ID: ThemeId = 'system';
```

### 6.3 `lib/theme/sanitize.ts`

```ts
import { THEME_IDS, DEFAULT_THEME_ID } from './palette';
import type { ResolvedThemeId, ThemeId } from './types';

const VALID = new Set<ThemeId>(THEME_IDS);

/** 后端 / 老数据 / 损坏 JSON 注入未知值时, 兜底成 DEFAULT_THEME_ID。 */
export function sanitizeTheme(v: unknown, fallback: ThemeId = DEFAULT_THEME_ID): ThemeId {
  return typeof v === 'string' && VALID.has(v as ThemeId) ? (v as ThemeId) : fallback;
}

/** system 模式: 跟随系统外观解析成具体主题。 */
export function resolveSystemTheme(prefersDark: boolean): ResolvedThemeId {
  return prefersDark ? 'dark' : 'light';
}
```

### 6.4 `lib/theme/apply.ts`

```ts
import { resolveSystemTheme, sanitizeTheme } from './sanitize';
import type { ResolvedThemeId, ThemeId } from './types';

export interface ApplyOptions {
  prefersDark: boolean;
}

/**
 * 纯函数: 接受 themeId + 系统偏好, 把结果写到给定 root。
 * 不依赖 React; SSR / 单测 / 非 React 上下文都能复用。
 */
export function applyTheme(
  root: HTMLElement,
  theme: ThemeId,
  opts: ApplyOptions,
): ResolvedThemeId {
  const id = sanitizeTheme(theme);
  const resolved: ResolvedThemeId =
    id === 'system' ? resolveSystemTheme(opts.prefersDark) : id;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved === 'dark' ? 'dark' : 'light';
  return resolved;
}
```

### 6.5 `lib/theme/options.ts`

```ts
import type { ThemeId } from './types';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** 设置面板预览卡片用的色板, 与 CSS vars 解耦。 */
  preview: { background: string; surface: string; primary: string; accent: string };
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'system',
    label: '跟随系统',
    description: '随系统外观自动切换浅色 / 深色',
    preview: { background: '#ffffff', surface: '#0e1014', primary: '#09244B', accent: '#7aa2ff' },
  },
  { id: 'light', label: '浅色', description: '明亮、清爽,适合白天',
    preview: { background: '#ffffff', surface: '#f5f7fa', primary: '#09244B', accent: '#e5e7eb' } },
  { id: 'dark',  label: '深色', description: '低光、护眼,适合夜间',
    preview: { background: '#0e1014', surface: '#16191f', primary: '#7aa2ff', accent: '#262a31' } },
  { id: 'rock',  label: '岩灰', description: '温润的暖灰,稳重低饱和',
    preview: { background: '#ecebe6', surface: '#f3f2ed', primary: '#4a4744', accent: '#cfccc4' } },
  { id: 'mist',  label: '雾紫', description: '柔和的紫色调,文艺感',
    preview: { background: '#f6f3fb', surface: '#ece5fa', primary: '#6b5bd6', accent: '#dccff1' } },
];
```

### 6.6 `lib/theme/provider.tsx`

```tsx
'use client';
import { useEffect } from 'react';
import { useUserSettingsStore } from '../store/user-settings-store';
import { applyTheme } from './apply';
import { sanitizeTheme } from './sanitize';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUserSettingsStore((s) => s.settings.theme);

  useEffect(() => {
    const id = sanitizeTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(document.documentElement, id, { prefersDark: mq.matches });
    apply();
    if (id === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  return <>{children}</>;
}
```

### 6.7 `lib/theme/index.ts`

```ts
export type { ThemeId, ResolvedThemeId } from './types';
export { THEME_IDS, DEFAULT_THEME_ID } from './palette';
export { sanitizeTheme, resolveSystemTheme } from './sanitize';
export { applyTheme } from './apply';
export { THEME_OPTIONS, type ThemeOption } from './options';
export { ThemeProvider } from './provider';
```

### 6.8 CSS 主题文件

`css/theme/light.css`（默认 `:root`）：

```css
:root {
  --background: #ffffff;
  --foreground: #0d1a2b;
  --card: #ffffff;
  --primary: #09244B;
  --primary-foreground: #ffffff;
  --secondary: #eef2f5;
  --secondary-foreground: #1f2937;
  --muted: #f5f7fa;
  --muted-foreground: #979797;
  --accent: #f3f5f6;
  --border: #e5e7eb;
  --input: var(--border);
  --divider: color-mix(in oklch, var(--background) 50%, var(--border));
  --ring: #b6c0cc;
  --bg-titlebar: #F8F8F8;
  --memo-detail-bg: #f6f8fb8e;
  --statusbar-bg: color-mix(in oklch, var(--card) 92%, var(--background));
  --code-bg: #eaeaec;
  --success: #22c55e;
  --editor-foreground: #333333;
  --agent-foreground: color-mix(in srgb, var(--editor-foreground) 80%, transparent);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: #ffffff;
  color-scheme: light;
}
```

`css/theme/dark.css`：

```css
[data-theme="dark"] {
  --background: #0e1014;
  --foreground: #e6e8eb;
  --card: #16191f;
  --primary: #7aa2ff;
  --primary-foreground: #0e1014;
  --secondary: #1d2027;
  --secondary-foreground: #cfd3d8;
  --muted: #1a1d23;
  --muted-foreground: #8a8f97;
  --accent: #222732;
  --border: #262a31;
  --divider: color-mix(in oklch, var(--background) 50%, var(--border));
  --ring: #3a4150;
  --bg-titlebar: #0e1014;
  --memo-detail-bg: #13161c;
  --statusbar-bg: color-mix(in oklch, var(--card) 92%, var(--background));
  --code-bg: #1a1c25;
  --success: #22c55e;
  --editor-foreground: #cbd1d9;
  --agent-foreground: color-mix(in srgb, var(--editor-foreground) 80%, transparent);
  color-scheme: dark;
}
```

`rock.css` / `mist.css` 同样模板（值用对应主题，`color-scheme` 视具体明度写 `light` 或 `dark`）。每套 ~30 行，**全部在 CSS 中，JS 不持有任何颜色字面量**。

### 6.9 `css/index.css` 改动

```diff
+ @import "./theme/light.css";
+ @import "./theme/dark.css";
+ @import "./theme/rock.css";
+ @import "./theme/mist.css";

  @layer base {
    :root {
-     --background: oklch(1 0 0);
-     --foreground: oklch(0.148 0.004 228.8);
-     --card: oklch(1 0 0);
-     --primary: #09244B;
-     /* ... 60 行硬编码 vars, 全部删除 (移到 light.css) ... */
+     /* 主题色由 css/theme/*.css 提供; 此处只放非颜色 token */
+     --radius: 0.625rem;
+     --font-heading: var(--font-sans);
+     --font-sans: 'Nunito Sans', 'Inter', -apple-system, 'Segoe UI', sans-serif, BlinkMacSystemFont;
+     --font-nav: 'SF Mono';
+     --agent-font: 'Anonymous Pro', 'PingFang SC', 'Microsoft YaHei', 'Inter', -apple-system, monospace;
+     --app-font-family: var(--font-sans);
+     --app-font-size: 15px;
+     --app-line-height: 1.6;
    }

-   .markdown-body { background: #ffffff !important; }
-   .markdown-body { --bgColor-default: #ffffff; --bgColor-muted: #F5F3F0; }
-   .tiptap { background: #ffffff !important; }
+   .markdown-body { background: var(--card); }
+   .markdown-body { --bgColor-default: var(--card); --bgColor-muted: var(--muted); }
+   .tiptap { background: var(--background); }
```

滚动条 / `.agent-welcome-*` 硬编码颜色全部替换为 `var(...)` 或 `color-mix(var(--muted-foreground) X%, transparent)`。

### 6.10 `lib/hooks/useApplyTheme.ts`（重写为薄封装）

```ts
'use client';
import { useEffect } from 'react';
import { applyTheme, sanitizeTheme } from '../theme';

export function useApplyTheme(theme: string | undefined) {
  useEffect(() => {
    const id = sanitizeTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(document.documentElement, id, { prefersDark: mq.matches });
    apply();
    if (id === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);
}
```

> 保留 `useApplyTheme` 是为了不破坏现有 `App.tsx` 调用点；新代码建议直接用 `<ThemeProvider>`。

### 6.11 `lib/store/user-settings-store.ts` 改动

```diff
- const VALID_THEME_IDS: ReadonlySet<ThemeId> = new Set<ThemeId>([
-   'system', 'light', 'dark', 'rock', 'mist',
- ]);
- function sanitizeTheme(value: unknown, fallback: ThemeId = 'system'): ThemeId {
-   return typeof value === 'string' && VALID_THEME_IDS.has(value as ThemeId)
-     ? (value as ThemeId) : fallback;
- }
+ import { sanitizeTheme } from '../theme';
```

### 6.12 `App.tsx` 改动

```diff
- useApplyFontSettings(settings.format);
- useApplyTheme(settings.theme);
+ <ThemeProvider>
+   <Suspense fallback={null}>{...}</Suspense>
+ </ThemeProvider>
```

`useApplyFontSettings` 同样建议收敛到 `FormatProvider`（本方案不强制要求，可作为后续 PR）。

### 6.13 `windows/preferences/sections/theme.tsx` 改动

```diff
- import { DEFAULT_USER_SETTINGS, THEME_OPTIONS, type ThemeId } from '../../../lib/constants';
+ import { DEFAULT_THEME_ID, THEME_OPTIONS, type ThemeId } from '../../../lib/theme';
  ...
- onClick={() => updateSettings({ theme: DEFAULT_USER_SETTINGS.theme })}
+ onClick={() => updateSettings({ theme: DEFAULT_THEME_ID })}
```

### 6.14 `app/backend/src/user_config.rs` 改动

```rust
// 新增 enum 替换裸 String
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
    Rock,
    Mist,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceFile {
    #[serde(default)]
    pub personalize: PersonalizeConfig,
    #[serde(default)]
    pub format: FormatConfig,
    #[serde(default)]
    pub theme: Theme,           // ← 替代 String
}
// 删掉 fn default_theme() 和手工 impl Default
```

序列化输出 `"system" | "light" | "dark" | "rock" | "mist"`（lowercase），与前端 `ThemeId` 字面量一一对应。前端 `sanitizeTheme` 仍是兜底（防后端扩展新值时前端不识别）。

---

## 7. 迁移步骤

按 4 个独立 commit 推进，每个单独可测、可回滚：

| # | Commit | 范围 | 验证 |
|---|---|---|---|
| 1 | `refactor(theme): extract lib/theme/ single source` | 新建 `lib/theme/{types,palette,sanitize,apply,options,index}.ts`；改 `constants.ts` 删除 vars；改 `theme.tsx` 与 `store.ts` import 路径 | 编译过,设置面板仍能切主题（仍是 JS 写 vars 旧路径） |
| 2 | `refactor(theme): move vars to css, JS sets data-theme only` | 新建 `css/theme/*.css`；改 `index.css` 删除 ~60 行硬编码；改 `useApplyTheme` 为 `setAttribute` 形式；修 `.markdown-body` / `.tiptap` / 滚动条 / 欢迎页硬编码 | 4 套主题视觉一致；DevTools 看 `<html data-theme="...">` 正确 |
| 3 | `refactor(theme): ThemeProvider + App.tsx simplification` | 引入 `<ThemeProvider>`；App.tsx 移除 `useApplyTheme` | 两个窗口仍同步切换 |
| 4 | `refactor(backend): Theme enum + drop manual Default` | Rust enum 化；删 `default_theme()`、手工 `impl Default` | IPC 行为不变,反序列化非法值报错而非静默回退 |

**回滚策略**：每个 commit 单独 revert 即恢复旧行为；无需迁移数据（IPC payload 仍是 `"system"` 等字符串，向后兼容）。

---

## 8. 验证清单

### 8.1 功能正确性

- [ ] 设置面板点选 4 张卡片（浅色 / 深色 / 岩灰 / 雾紫）→ 立即生效，无白屏
- [ ] 设置面板点选"跟随系统" → 系统切换深浅时，应用跟随
- [ ] 切换主题后，`document.documentElement.getAttribute('data-theme')` 等于目标值
- [ ] 切换主题后，`document.documentElement.style.colorScheme` 等于 `light` 或 `dark`
- [ ] 主窗口与偏好设置窗口切换主题同步（通过 `user-config-changed` 事件）
- [ ] Tiptap 编辑器背景在 4 套主题下都是对应色（不再卡死在 `#ffffff`）
- [ ] Markdown 渲染区背景在 4 套主题下都是对应色
- [ ] 滚动条颜色在 4 套主题下都可见
- [ ] `.agent-welcome-*` 卡片在 4 套主题下都可读

### 8.2 边界条件

- [ ] `theme.json` 被人为改为 `"invalid"` → 前端 `sanitizeTheme` 兜底成 `system`，不崩溃
- [ ] `theme.json` 字段缺失 → Rust `#[serde(default)]` 回退到 `Theme::System`
- [ ] 系统外观在主题为 `light` 时变化 → 不响应（避免误切换）
- [ ] `prefers-color-scheme` API 不可用环境（极少见）→ `applyTheme` 不抛错
- [ ] 卸载时 `matchMedia` listener 正确清理

### 8.3 性能

- [ ] 切换主题时 DevTools Performance 录制，DOM 写操作 ≤ 2 次（`setAttribute` + `colorScheme`）
- [ ] 首屏不出现明显颜色闪烁（接受 1-2 帧的 `:root` 默认色 → 真实主题）

### 8.4 类型与构建

- [ ] `tsc --noEmit` 通过
- [ ] `cargo check` 通过
- [ ] `npm run build` 通过
- [ ] Vite 生产构建产物中无 `THEME_VARS_BY_ID` 常量残留

### 8.5 （可选）自动化测试

- [ ] `lib/theme/sanitize.test.ts` 覆盖空字符串、非法值、null、undefined、合法 5 值
- [ ] `lib/theme/apply.test.ts` 用 jsdom 验证 `setAttribute('data-theme', ...)` 与 `colorScheme` 正确

---

## 9. 收益

| 指标 | 旧 | 新 |
|---|---|---|
| `useApplyTheme.ts` 行数 | 63 | 18 |
| `constants.ts` 主题相关行数 | ~160 | 0（移到 CSS） |
| 切一次主题的 DOM 写操作 | ~48 次（24 remove + 24 set） | 2 次（`setAttribute` + `colorScheme`） |
| `VALID_THEME_IDS` 重复定义点 | 2 | 1 |
| 加一个新主题需改文件 | 3（constants + 2 处白名单） | 3（`THEME_IDS` 数组 + `THEME_OPTIONS` + 1 个 CSS 文件） |
| 硬编码颜色绕过主题的地方 | 5+ | 0 |
| 后端 schema 合法值 | 任意字符串 | enum 5 项 |
| 跨窗口同步触发 IPC | 每次 IPC `get_preference` | 同（不在本次范围） |

总账：

- **新增** ~250 行（6 个 TS 文件 + 4 个 CSS 文件，含注释与空行）
- **删除** ~190 行（`constants.ts` 主题块 + `useApplyTheme.ts` 旧版 + 重复白名单 + 硬编码 vars）
- **净增** ~60 行 + **消灭一类 bug**（切不干净、VALID_THEME_IDS 漂移、后端 schema 弱）

---

## 10. 显式不做的事

为了保持"简洁、工程化"，下面这些功能**显式不做**，避免过度设计：

| 不做项 | 理由 |
|---|---|
| Token 抽象（`surface/foreground/state` 语义层） | 4 套主题 hex 改写仍直白可读，加抽象层价值不大 |
| ThemeBundle（带 shiki / monaco 配套） | shiki 主题与 app 主题本就解耦（`data-shiki-theme` 走 NodeView），不强耦合 |
| 主题市场 / JSON 导入 | 不在本次范围 |
| FOUC 修复（启动时从后端读 theme 注入 `index.html`） | 当前 useEffect 首帧会看到 `:root` 默认（light）值再切换，1-2 帧在桌面 Tauri 不可见；可作为后续独立 PR |
| 细粒度 `user-config-changed` 事件（只 sync 变更字段） | 当前 `loadInitial` 已经够快（一次 JSON 解析），等 profiling 显示瓶颈再做 |
| 单元测试强制要求 | 标注为"可选"在 §8.5，鼓励但不阻塞合并 |
| 高对比度 / 色彩无障碍变体 | 不在本次范围 |
| `<FormatProvider>` 合并 `useApplyFontSettings` | 与本次主题改动正交，单独 PR 处理 |

---

## 11. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `data-theme` 选择器特异性不够，被其他 CSS 覆盖 | 低 | 中 | 把 `theme/*.css` import 顺序放在 `tailwind.css` 之后；用 `[data-theme="dark"]` 而非 `.dark` |
| 第三方组件（shadcn / Tiptap）依赖硬编码颜色 | 中 | 中 | 替换为 `var(--xxx)`；shadcn 已经基于 CSS 变量，与新方案契合 |
| Rust enum 序列化字段名变化导致老 `preference.json` 读取失败 | 极低 | 高 | `#[serde(rename_all = "lowercase")]` 保持字符串形态与旧值一致；`#[serde(default)]` 处理非法值 |
| 跨窗口同步丢失（store 变更未触发 IPC） | 极低 | 高 | `useUserSettingsStore` 的 `updateSettings` 仍走 `scheduleFlush`，未改动 |
| 主题切换瞬间的 FOUC | 低 | 低 | 桌面 Tauri 1-2 帧不可见；后续可注入 `index.html` 优化 |

**回滚**：4 个 commit 单独 `git revert`，IPC payload 仍是字符串，向后兼容，无需数据迁移。
