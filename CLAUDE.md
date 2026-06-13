# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Flowix 是一款桌面笔记应用（Tauri 2 + Rust 后端，React 19 + TS + Tiptap 前端），内置 AI 代理（`rllm` crate，OpenAI / Anthropic / DeepSeek 全部走 `openai_compatible` provider）。

## 命令

`package.json` 在仓库根目录（`app/` 下只有 `backend/` + `frontend/`）。`tauri dev/build` 内部走 `cargo run/build` + Vite（端口 1420，HMR 1421）。

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run tauri dev     # 完整应用开发
npm run dev           # 仅前端 (localhost:1420)
npm run tauri build   # 生产构建
pkill -f "node.*vite" 2>/dev/null   # 端口冲突时
sudo xcode-select -r                 # 首次运行
```

Rust 测试：

```bash
cd app/backend
cargo test <module>::tests           # 跑某模块
cargo test <module>::tests::test_xxx # 跑单个
cargo test --lib                     # 跑全部
```

## 架构

### 窗口拓扑

两个 Tauri 窗口共用同一份前端 bundle。`app/frontend/App.tsx` 按 `window.location.hash` 分发：

- `#preferences/<tab>` → `windows/preferences/preferences-view.tsx`
- 其他 → `windows/main/main-layout.tsx`（三栏：MemoList | DocumentContainer（Tiptap/Monaco 切换）| AgentChatRoot + StatusBar）

`windows/<window>/` 自包含；`preferences/sections/` 是命令面板和偏好设置窗口的设置 tab 单一真源。`components/` 只放跨窗口共享资源（`mdeditor/` Tiptap、`srceditor/` Monaco、`ui/` shadcn、`icons/`、`loading/`、`error-boundary.tsx`、`windows-titlebar-controls.tsx`）。**所有 hooks 集中在 `lib/hooks/`**，禁止在 `windows/<window>/hooks/` 维护镜像。

### 后端（`app/backend/src/`）

`lib.rs::run()` 做四件事：(1) 一次性迁移旧数据（`migrate_legacy_woop_dirs()` WoopMemo 目录、`migrate_legacy_app_db()` SQLite `app_state` → JSON）；(2) 初始化 6 个共享服务（`UserConfigStore` / `GlobalMetaData` / `MemoFile` / `MemoIndex` / `ThreadManager` / `AgentManager`）；(3) 启动 `MemoWatcher`（`notify` crate）→ `memo-event` 推前端；(4) 注册 IPC 命令到 `tauri::generate_handler!`。

IPC 命令按业务域拆到 `commands/<domain>.rs`（memo / tag / notebook / file / dialog / agent / thread / window / settings / kv / helpers）。`AppState` 在 `commands/mod.rs`（`user_config` / `memo_file` / `thread_manager` 用 `Arc` 共享）。`memo_file/` 是子模块（mod + content/frontmatter/list_store/notebook/types/derivation/registration/time）。`providers/openai_compatible.rs` 统一 LLM adapter；`providers/tools/{filesystem,notebook}.rs` 是 Agent 工具调用；`prompt/` 是 system prompt 拼装；`search.rs` 是当前 notebook 的内存倒排索引（bigram）；`path_scope.rs` 是 Agent 工具路径白名单；`threads.rs` 是 Agent 对话历史（SQLite）。

**跨 IPC 边界的 struct 必须加 `#[serde(rename_all = "camelCase")]`**（详见 [docs/pending-issues.md](docs/pending-issues.md) §3.4）。

### 前端（`app/frontend/`）

- `App.tsx` — 入口；顶层挂 `useUserSettings` / `useApplyFontSettings` / `useMemoEvents`（两窗口都 mount，跨窗口同步自然成立）。
- `lib/tauri/client.ts` — IPC 封装，命名空间：`preferences` / `aiConfig` / `settings` / `memos` / `tags` / `notebooks` / `files` / `dialogs` / `windows` / `agent`（`agent` 还暴露 `listenToAgentStream` / `stopListeningToAgentStream`）。
- `lib/store/` — Zustand stores（`memo-store` / `chat-store` / `user-settings-store` / `settings-store` / `document-store` / `tag-store`）。
- `lib/hooks/` — 全部 hooks 集中；`useMemoEvents` 是 `memo-event` 的前端单订阅者。
- `lib/theme/` — 主题纯函数 + Provider（见下）。
- `windows/{main,preferences}/` + `components/` + `types/` + `css/theme/{light,dark,rock}.css` + `assets/`。

### 数据流

1. 前端走 `client.ts` 命名空间调 IPC → Rust 写 `~/.flowix/*.json` 或 `~/Documents/flowix/<notebook>/.metadata/*.json` + `.md`
2. 写后 `emit("memo-event", { kind, memo, source })` → `useMemoEvents` 单订阅 → `memo-store.handleMemo*` → `triggerRefresh` 触发 UI 更新

### 主题与首屏防闪

主题真源 `~/.flowix/preference.json` 是 async IPC，首帧会闪一帧白。修复靠 `public/theme-boot.js`（CSP `script-src 'self' 'unsafe-eval'` 不允许 inline script）在 CSS paint 前同步读 `localStorage['flowix-theme']` 写 `data-theme`。改主题时**三处必须同步**：`public/theme-boot.js` + `lib/theme/apply.ts`（命中失败回退 `prefers-color-scheme`，解析后写 localStorage）+ `css/theme/*.css`。

### 数据布局

- `~/.flowix/{preference,ai_config,notebook,global_meta_data}.json` — 配置（preference / ai_config 原子写 tmp+fsync+rename 0o600）
- `~/Documents/flowix/<notebook>/.metadata/{list,tag}.json` + `<title>-<id>.md`（YAML frontmatter）

### AI 流式响应

`commands/agent::chat_with_agent_stream` 通过 `agent-chunk` 事件推流（`AgentChunk` 9 变体）；`stop_agent_stream` 终止。`Usage.total_tokens` 当前未做 budget 拦截（[docs/pending-issues.md](docs/pending-issues.md) §2.1 P1-#2）。

## 关键模式

- **窗口路由**：`#preferences/<tab>` ↔ `MainLayout`；设置类 hooks 在 `App.tsx` 顶层挂载。
- **跨窗口同步**：`user_config` 写后 emit `user-config-changed` → `App.tsx` 监听调 `loadInitial()`；`memo` 走 `memo-event` → `useMemoEvents`。
- **跨窗口对话框触发**：`window.dispatchEvent(new CustomEvent('flowix:xxx', { detail }))`，不把 state lift 到 MainLayout。
- **CSP**（在 `app/backend/tauri.conf.json`）：`script-src 'self' 'unsafe-eval'`、`style-src 'self' 'unsafe-inline'`、`connect-src` 含 `ipc:` `http(s)://ipc.localhost`、`img/media-src` 含 `asset:` 与 `http(s)://asset.localhost`。改前端加载方式先核对这里。
- **图标刷新**：`scripts/gen-icon.mjs` 跑完 `rm -rf app/backend/icons/{android,ios}`（本项目不发移动端）。

## Rules

- 在非常确信情况下再进行代码修改
- 保持专业架构设计，不写垃圾代码
- 修改后端 `commands/` / `provider` / `agent` / `threads` 时，跨 IPC 边界 struct 必须 `#[serde(rename_all = "camelCase")]`
- 修改主题相关代码时，`public/theme-boot.js` + `lib/theme/` + `css/theme/*.css` 三处必须同步
