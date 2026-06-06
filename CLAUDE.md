# CLAUDE.md

WoopMemo 是一款桌面笔记应用，具备 AI 能力，基于 Tauri 2 (Rust 后端) + React 19 + TypeScript + Tiptap 构建。

## 命令

`package.json` 位于仓库根目录（`app/` 下只有 `backend/` 和 `frontend/` 两个子工程，没有独立 package.json），所有 npm 命令都在根目录执行：

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run tauri dev     # 完整应用开发
npm run dev           # 仅前端 (localhost:1420)
npm run tauri build   # 生产构建
```

若端口 1420 被占用：`pkill -f "node.*vite" 2>/dev/null` 或 `lsof -i :1420 -t | xargs kill -9`

首次运行可能需要：`sudo xcode-select -r`

## 技术栈

- **后端**：Tauri 2、Rust、JSON 配置文件（`~/.woop/*.json`，原子写入 + 0o600 权限）、YAML 解析
- **前端**：React 19、TypeScript、Tiptap 编辑器、Zustand（状态管理 + 持久化）、Tailwind CSS、shadcn UI
- **AI**：`rllm` crate 支持 OpenAI/Anthropic/DeepSeek

## 架构

### 窗口拓扑
前端按 Tauri 窗口边界组织。每个窗口自包含（layout、组件、专属逻辑），共享层只在最浅位置：

- **`windows/main/`** - 主窗口（三栏编辑器 + AI 代理面板 + 状态栏 + Cmd+K 命令面板）
- **`windows/preferences/`** - 偏好设置窗口；`sections/` 下的设置 tab 内容（general/format/theme/agent/shortcuts/connections/history）被命令面板和偏好设置窗口共用，单一真源
- **`components/`** - 仅放跨窗口共享资源：`mdeditor/`（Tiptap）、`srceditor/`（Monaco）、`ui/`（shadcn）、`icons/`、`loading/`、`error-boundary.tsx`、`windows-titlebar-controls.tsx`
- **`lib/hooks/`** - 全部 hooks 集中管理，**不**在 `windows/<window>/hooks/` 下维护镜像

### 三栏布局
`app/frontend/windows/main/main-layout.tsx` 实现：MemoList（左侧，350px）| MemoDetail（中间）| MemoDetailMeta（右侧，可选）

### 后端（`app/backend/src/`）
- `lib.rs` - 应用入口，插件配置，命令路由
- `commands.rs` - 所有 Tauri IPC 命令（备忘录、标签、笔记本、文件、AI 代理）
- `user_config.rs` - `~/.woop/preference.json` + `ai_config.json`（原子写入：tmp + fsync + rename, 0o600）
- `global_meta_data.rs` - `~/.woop/global_meta_data.json`（扩展键值对，无 schema）
- `memo_file.rs` - 文件存储管理（YAML frontmatter + markdown）
- `agent.rs` - AI 代理管理（LLM 连接）
- `threads.rs` - 对话线程管理

### 前端（`app/frontend/`）
- `App.tsx` - 入口；按 `window.location.hash` 路由到 `MainLayout` 或 `PreferencesView`（均用 `lazy()` + `Suspense` 加载）
- `windows/main/` - 主窗口
  - `main-layout.tsx` - 三栏布局编排
  - `memo-pane/`, `document-pane/`, `agent-panel/`, `status-bar/`
  - `menu-board.tsx` - Cmd+K 命令面板
- `windows/preferences/` - 偏好设置窗口
  - `preferences-view.tsx`, `preferences-titlebar-{mac,win}.tsx`
  - `sections/` - 设置 tab 内容 + `primitives.tsx`（Field/SectionHeader/FieldRow）+ `types.ts`（SettingsTab）
- `components/` - 跨窗口共享资源（见上）
- `lib/` - 业务工具
  - `hooks/` - 全局 hooks（`useUserSettings`, `useApplyTheme`, `useApplyFontSettings`, `useTauriRpc`, `useMemoInsertAnimation`, `useComposingValue`）
  - `store/` - Zustand stores
  - `tauri/client.ts` - IPC 封装
  - `constants.ts`, `toast`, `export`, `path`, `utils`, `message/`
- `types/`, `css/`, `assets/`

### 数据流
1. 前端通过 `lib/tauri/client.ts` 调用 Tauri IPC 命令
2. Rust 后端处理命令，更新 `~/.woop/*.json` 或备忘录文件系统
3. 返回 JSON，前端更新 Zustand store
4. UI 自动响应 store 变化

## 备忘录文件格式

完整元数据存储笔记本 `.metadata/list.json` 中：

```json
{
  "version": 1,
  "last_updated": 1234567890,
  "memos": [{
    "id": "m_xxxxx",
    "filename": "标题",
    "preview": "摘要...",
    "tags": ["tag1", "tag2"],
    "todos": [{ "content": "任务", "status": "pending" }],
    "createdAt": 1234567890,
    "updatedAt": 1234567890,
    "favorited": false,
    "icon": null,
    "path": "标题-m_xxxxx.md"
  }]
}
```

笔记本元数据存储在 `.metadata/tag.json` 中。

## 关键模式

- **窗口路由**：`App.tsx` 按 `window.location.hash` 分发：
  - `#preferences/<tab>` → `PreferencesView`（`tab` 可选：`general`/`format`/`theme`/`agent`/`shortcuts`/`connections`/`history`）
  - 其他 → `MainLayout`
  两个窗口共用同一份前端 bundle；设置类 hooks（`useUserSettings` / `useApplyTheme` / `useApplyFontSettings`）在 `App.tsx` 顶层挂载，两侧都会即时同步。
- URL 参数 `?memoWindowId=` 可打开独立窗口（参见 `app/frontend/App.tsx`）
- 文件监听：前端 `chokidar` / Rust `notify` crate
- AI 流式响应：通过 Tauri 事件 `agent-chunk` 推送

## Git 操作

```bash
# 首次推送（远程为空）
git init
git remote add origin git@github.com:aicollaborate/woop.git
git add -A && git commit -m "Initial commit"
git push -u origin main

# 强制覆盖远程（完全替换远程分支，远程有本地无的文件会被删除）
git push -f origin main
```

## Rules

- 在非常确信情况下再进行代码修改
- 保持专业架构设计，不写垃圾代码