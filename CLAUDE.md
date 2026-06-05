# CLAUDE.md

WoopMemo 是一款桌面笔记应用，具备 AI 能力，基于 Tauri 2 (Rust 后端) + React 19 + TypeScript + Tiptap 构建。

## 命令

```bash
cd app
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run tauri dev     # 完整应用开发
npm run dev           # 仅前端 (localhost:1420)
npm run tauri build   # 生产构建
```

若端口 1420 被占用：`pkill -f "node.*vite" 2>/dev/null` 或 `lsof -i :1420 -t | xargs kill -9`

首次运行可能需要：`sudo xcode-select -r`

## 技术栈

- **后端**：Tauri 2、Rust、SQLite（rusqlite）、YAML 解析
- **前端**：React 19、TypeScript、Tiptap 编辑器、Zustand（状态管理 + 持久化）、Tailwind CSS、shadcn UI
- **AI**：`rllm` crate 支持 OpenAI/Anthropic/DeepSeek

## 架构

### 三栏布局
`app/frontend/components/app-layout.tsx` 实现：MemoList（左侧，350px）| MemoDetail（中间）| MemoDetailMeta（右侧，可选）

### 后端（`app/backend/src/`）
- `lib.rs` - 应用入口，插件配置，命令路由
- `commands.rs` - 所有 Tauri IPC 命令（备忘录、标签、笔记本、文件、AI 代理）
- `db.rs` - SQLite 数据库（`app_state`、`user_settings` 表）
- `memo_file.rs` - 文件存储管理（YAML frontmatter + markdown）
- `agent.rs` - AI 代理管理（LLM 连接）
- `threads.rs` - 对话线程管理

### 前端（`app/frontend/`）
- `lib/store/` - Zustand store（memo、tag、settings、chat）
- `lib/tauri/client.ts` - Tauri RPC 封装，按领域组织
- `hooks/` - Store + RPC 逻辑封装（useMemoStore、useTagStore 等）
- `components/mdeditor/` - Tiptap 编辑器及自定义扩展
- `components/memo/` - 备忘录列表、详情、元数据组件
- `components/agent/` - AI 代理管理界面
- `components/ui/` - shadcn UI 组件库
- `components/menu-board.tsx` - 命令面板

### 数据流
1. 前端通过 `lib/tauri/client.ts` 调用 Tauri IPC 命令
2. Rust 后端处理命令，更新 SQLite 或文件系统
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