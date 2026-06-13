# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Flowix 是一款桌面笔记应用（**Tauri 2 + Rust 后端，React 19 + TS + Tiptap 前端**），内置 AI 代理（`rllm` v1.1，OpenAI / Anthropic / DeepSeek 全部走 `openai_compatible` provider）。

## Workspace 布局

Cargo workspace 根在 `app/Cargo.toml`，三个 crate + 一个前端工程：

- `app/flowix-core/` — 业务核心（note / notebook 存储 + `BigramTokenizer` 全文搜索 + Agent 线程）。**零 Tauri 依赖**，CLI 与桌面端共享同一份读写逻辑，desktop watcher 检测到的变更 CLI 端 1 秒内可见，反之亦然。
- `app/flowix-desktop/` — Tauri 2 桌面应用（IPC 命令、AI provider、fs_watcher、`flowix://` 深链解析）。
- `app/flowix-cli/` — 命令行 sidecar（手写 parser + `$EDITOR` 集成 + 原子写）。`scripts/build-cli.sh` 把它编进 `app/flowix-desktop/binaries/flowix-cli-<host>`，Tauri 打包走 `externalBin` 携入。
- `app/flowix-web/` — Vite root（端口 1420，HMR 1421）；`vite.config.ts` 锁在该目录，watch 忽略所有 `app/**/src` 与 `app/target/**`。

`package.json` / `tsconfig.json` / `vite.config.ts` / `tailwind.config.js` 在仓库根，`postcss.config.js` 同级。

## 命令

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run tauri dev         # 完整应用开发（Tauri + Vite + Rust）
npm run dev               # 仅前端 (localhost:1420)
npm run tauri build       # 生产构建
npm run cli:build         # 编 CLI sidecar 到 app/flowix-desktop/binaries/（当前 host）
npm run cli:build:all     # CI 用：三平台（linux / macOS ×2 / windows）全编
pkill -f "node.*vite" 2>/dev/null   # 端口冲突时
sudo xcode-select -r                  # 首次运行
```

Rust 测试（在 `app/` 目录跑）：

```bash
cd app
cargo test -p flowix-core <module>::tests           # 跑某 crate 某模块
cargo test -p flowix-core <module>::tests::test_xxx # 跑单个
cargo test --workspace --lib                         # 跑全部
```

环境变量（CLI 解析层处理，桌面端不读）：

- `FLOWIX_HOME` — 覆盖 config dir（默认 `~/.flowix`）
- `FLOWIX_DATA` — 覆盖 data dir（默认 `<OS data dir>/flowix`）

## 架构

### 窗口拓扑

两个 Tauri 窗口共用同一份前端 bundle。`app/flowix-web/App.tsx` 按 `window.location.hash` 分发：

- `#preferences/<tab>` → `windows/preferences/preferences-view.tsx`
- 其他 → `windows/main/main-layout.tsx`（三栏：MemoList | DocumentContainer（Tiptap/Monaco 切换）| AgentChatRoot + StatusBar）

`App.tsx` 顶层挂 `useUserSettings` / `useApplyFontSettings` / `useApplyTheme` / `useMemoEvents` / `useAgentEvents` / `mountOpenTargetListener` —— 两窗口都 mount，跨窗口同步自然成立；`./lib/shortcuts/actions` 是 side-effect import（触发 `defineAction()` 注册到全局注册表，否则 `ShortcutsProvider` 读不到）。

`windows/<window>/` 自包含；`preferences/sections/` 是命令面板和偏好设置窗口的设置 tab 单一真源。`components/` 只放跨窗口共享资源（`mdeditor/` Tiptap、`srceditor/` Monaco、`ui/` shadcn、`icons/`、`loading/`、`error-boundary.tsx`、`windows-titlebar-controls.tsx`）。**所有 hooks 集中在 `lib/hooks/`**，禁止在 `windows/<window>/hooks/` 维护镜像。

### 后端（`app/flowix-desktop/src/`）

`lib.rs::run()` 做六件事：(1) 一次性迁移旧数据（`migrate_legacy_woop_dirs()` 旧 `.woop/` 目录、`migrate_legacy_app_db()` SQLite `app_state` → JSON、旧 `app_data/notebook.json` → `~/.flowix/notebook.json`）；(2) 初始化 **7 个共享服务**（`UserConfigStore` / `GlobalMetaData` / `MemoFile` / `MemoIndex` / `ThreadManager` / `AgentManager` / `AgentAccessStore`），其中 `user_config` / `memo_file` / `thread_manager` / `agent_manager` / `agent_access` 用 `Arc` 共享（refcount 期望见 `lib.rs:286-288`）；(3) 启动 `MemoWatcher`（`notify` crate）→ `memo-event` 推前端；(4) 注册 Tauri 插件（`single_instance` / `opener` / `dialog` / `deep_link`），`single_instance` 闭包里同时处理 markdown argv + `flowix://` 深链；(5) 解析 `flowix://` 深链（`open_target/` 模块：parse → resolve → emit `flowix:open-target`）；(6) 注册 IPC 命令到 `tauri::generate_handler![commands::<sub>::xxx]`。

启动时还会 `ThreadManager::clear_all_loading()` 一次性清理上次 SIGKILL 残留的 `is_loading=1` 行（解决"工具行转圈卡死"）。

IPC 命令按业务域拆到 `commands/<domain>.rs`（settings / kv / memo / tag / notebook / file / dialog / agent / agent_access / thread / window + helpers）。`AppState` 在 `commands/mod.rs`。**新加 IPC 直接挂到对应子模块**，不要改 `commands/mod.rs`（`pub use` re-export 只为兼容 `current_watcher` / `markdown_paths_from_args` 两个跨模块消费方）。`memo_file/` 是 `flowix-core` 子模块（mod + content/frontmatter/list_store/notebook/types/derivation/registration/time）。`providers/openai_compatible.rs` 统一 LLM adapter；`providers/tools/{filesystem,notebook}.rs` 是 Agent 工具调用，受 `path_scope.rs` 路径白名单约束；`prompt/` 是 system prompt 拼装；`search.rs` 是当前 notebook 的内存倒排索引（`BigramTokenizer`：CJK bigram + ASCII 词；不落盘，切换 notebook 触发 rebuild）；`threads.rs` 是 Agent 对话历史（SQLite `thread.db`）。

**跨 IPC 边界的 struct 必须加 `#[serde(rename_all = "camelCase")]`**。

### 前端（`app/flowix-web/`）

- `App.tsx` — 入口；顶层挂全局 hooks（见上）。
- `lib/tauri/client.ts` — IPC 封装，命名空间：`preferences` / `aiConfig` / `agentAccess` / `settings` / `memos` / `tags` / `notebooks` / `files` / `dialogs` / `windows` / `agent`（`agent` 还暴露 `listenToAgentStream` / `stopListeningToAgentStream` / `listenToUserConfigChanges` / `listenToAgentAccessChanges`）。
- `lib/store/` — Zustand stores：`memo-store` / `chat-store` / `user-settings-store` / `settings-store` / `document-store` / `tag-store` / `agent-access-store` / `save-queue` / `document-buffer` / `document-session-service` / `buffer-registry`。
- `lib/hooks/` — 全部 hooks 集中；`useMemoEvents` 是 `memo-event` 的前端单订阅者，`useAgentEvents` 是 `agent-chunk` 的单订阅者（按 `thread_id` 派发到 `chat-store.threadStates[tid]`，多 thread 并行不串台）。
- `lib/openByTarget/` — 前端 `flowix:open-target` 监听器（把 IPC resolve 出来的 memo/notebook 目标翻译成 store action；preferences 窗口 listener 内部 no-op）。`mountOpenTargetListener` 在 `App.tsx` 顶层挂。
- `lib/shortcuts/` — 快捷键解析 / 注册 / Provider；`actions.ts` 顶部 `defineAction()` 把所有 action 注册到全局注册表。
- `lib/theme/` — 主题纯函数 + Provider（见下）。
- `lib/message/`, `lib/types/`, `lib/utils/`, `lib/constants.ts` — 共享类型 / 工具。
- `windows/{main,preferences}/` + `components/` + `types/` + `css/theme/{light,dark,rock}.css` + `assets/`。

### 数据流

1. 前端走 `client.ts` 命名空间调 IPC → Rust 写 `~/.flowix/*.json` 或 `<data_dir>/flowix/<notebook>/.metadata/*.json` + `.md`（原子写：tmp + fsync + rename 0o600，preference / ai_config 走这条）
2. 写后 `emit("memo-event", { kind, memo, source })` → `useMemoEvents` 单订阅 → `memo-store.handleMemo*` → `triggerRefresh` 触发 UI 更新
3. 外部编辑器 / CLI 改磁盘 → `MemoWatcher` (notify) → 走同一条 `memo-event` 管道（CLI 端 1 秒内反映）

### 主题与首屏防闪

主题真源 `~/.flowix/preference.json` 是 async IPC，首帧会闪一帧白。修复靠 `public/theme-boot.js`（CSP `script-src 'self' 'unsafe-eval'` 不允许 inline script）在 CSS paint 前同步读 `localStorage['flowix-theme']` 写 `data-theme`。改主题时**三处必须同步**：`public/theme-boot.js` + `lib/theme/apply.ts`（命中失败回退 `prefers-color-scheme`，解析后写 localStorage）+ `css/theme/*.css`。

### 数据布局

- `~/.flowix/{preference,ai_config,notebook,agent_access,global_meta_data}.json` — 配置
- `<data_dir>/flowix/<notebook>/.metadata/{list,tag}.json` + `<title>-<id>.md`（YAML frontmatter）— `<data_dir>` = `~/Library/Application Support/flowix` (macOS) / `%APPDATA%\flowix` (Windows) / `~/.local/share/flowix` (Linux)
- `<data_dir>/flowix/thread.db` — Agent 对话历史 SQLite

### AI 流式响应

`commands/agent::chat_with_agent_stream` 通过 `agent-chunk` 事件推流（`AgentChunk` 9 变体）；`stop_agent_stream` 终止。`Usage.total_tokens` 当前未做 budget 拦截。

## 关键模式

- **窗口路由**：`#preferences/<tab>` ↔ `MainLayout`；设置类 hooks 在 `App.tsx` 顶层挂载。
- **IPC 命令注册路径**：`tauri::generate_handler![commands::<sub>::xxx]`（不是平铺在 `commands::`），新加 IPC 不用动 `commands/mod.rs`。
- **跨窗口同步通道**：
  - `user_config` 写后 emit `user-config-changed` → `App.tsx` 监听调 `loadInitial()`
  - `agent_access` 写后 emit `agent-access-changed` → 两窗口重新 `loadInitial` + `invalidateNotebookCache`（note-reference 粘贴判定用到）
  - `memo` 走 `memo-event` → `useMemoEvents`
  - `flowix://` 深链 resolve 后 emit `flowix:open-target` → `lib/openByTarget` listener
- **跨窗口对话框触发**：`window.dispatchEvent(new CustomEvent('flowix:xxx', { detail }))`，不把 state lift 到 MainLayout。
- **Tauri 插件**（`app/flowix-desktop/Cargo.toml`）：`tauri-plugin-opener` / `tauri-plugin-dialog` / `tauri-plugin-single-instance` / `tauri-plugin-deep-link`。
- **CSP**（`app/flowix-desktop/tauri.conf.json`）：`script-src 'self' 'unsafe-eval'`、`style-src 'self' 'unsafe-inline'`、`connect-src` 含 `ipc:` `http(s)://ipc.localhost`、`img/media-src` 含 `asset:` 与 `http(s)://asset.localhost`。改前端加载方式先核对这里。
- **图标刷新**：`node scripts/gen-icon.mjs` 跑完 `rm -rf app/flowix-desktop/icons/{android,ios}`（本项目不发移动端，脚本会自动清掉 `npx tauri icon` 生成的移动端目录）。
- **Tauri 与 Vite 路径**：`frontendDist: "../dist"`，dev 走 `http://localhost:1420`；`vite.config.ts` 的 `root` 锁在 `app/flowix-web/`，别移。

## Rules

- 在非常确信情况下再进行代码修改
- 保持专业架构设计，不写垃圾代码
- 修改后端 `commands/` / `provider` / `agent` / `threads` 时，跨 IPC 边界 struct 必须 `#[serde(rename_all = "camelCase")]`
- 修改主题相关代码时，`public/theme-boot.js` + `lib/theme/` + `css/theme/*.css` 三处必须同步
- 新加 IPC 命令直接挂到对应 `commands/<sub>.rs`，**不要**改 `commands/mod.rs`
