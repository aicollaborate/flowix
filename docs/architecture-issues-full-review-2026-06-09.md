# 前后端架构问题完整记录

日期：2026-06-09

范围：`app/frontend`、`app/backend`、`docs/` 中和 Memo 编辑、列表、Notebook、文件落盘、事件同步、Tauri IPC 相关的实现。

## 结论

当前系统的主要风险不是单个 bug，而是多个边界仍然不够硬：

- 编辑器会话和列表选中态已经拆开，但仍需要持续约束。
- `DocumentContainer` 仍然承担过多业务职责，是前端稳定性的主要压力点。
- 后端 `.md`、`list.json`、`memo.json` 的写入不是事务化模型。
- IPC 返回值和错误模型偏弱，前后端 DTO 变化缺少编译期保护。
- 文件 watcher 与前端 reload 之间仍依赖时间窗口抑制自身写入事件。

## 问题 1：DocumentContainer 职责过重

优先级：P1

位置：

- `app/frontend/windows/main/document-pane/document-container.tsx`

现状：

`DocumentContainer` 同时负责文档读取、编辑器渲染、自动保存、CAS 写盘、memo metadata 同步、标题和 preview 派生后的列表合并、最终重命名、frontmatter 补写、外部文档导入、`memo-event` 监听、磁盘轮询、自写抑制、字数统计和标题栏元信息输出。

影响：

- 保存、切换、外部修改、列表排序、frontmatter 更新之间容易产生隐式耦合。
- 旧文档异步保存、新文档加载、metadata 同步、watcher reload 之间的竞态难以推理。
- 组件过大，难以测试，也难以判断某次刷新来自哪个来源。

处理方向：

- 将其拆成会话容器、内容加载 hook、自动保存 hook、metadata 同步 hook、最终重命名 hook、外部变化监听 hook。
- `DocumentContainer` 最终只负责 UI 组合和编辑器渲染。

## 问题 2：编辑器会话与列表选中态仍需硬化边界

优先级：P1

位置：

- `app/frontend/lib/store/document-store.ts`
- `app/frontend/lib/store/memo-store.ts`
- `app/frontend/windows/main/main-layout.tsx`
- `app/frontend/windows/main/memo-pane/memo-list.tsx`

现状：

`DocumentStore.activeMemoSession` 表示编辑器真实打开的文档会话，`MemoStore.selectedMemo` 表示列表选中态。方向正确，但部分代码仍会使用 `selectedMemo` 作为兜底数据来源。

影响：

- 后续新增入口时，可能重新把“列表选中”和“编辑器当前文档”混用。
- 异步保存回调如果误读全局选中态，可能再次影响错误文档。

处理方向：

- 保存、读取、重命名只允许使用 `activeMemoSession.memoId/path` 或显式传入的 props。
- `selectedMemo` 只用于列表高亮、标题栏展示、菜单上下文。
- 新增统一打开 helper，避免每个入口自行拼接 `setSelectedMemo + openMemoDocument`。

## 问题 3：后端 list.json / memo.json 写入不是事务化的

优先级：P1

位置：

- `app/backend/src/memo_file/list_store.rs`
- `app/backend/src/memo_file/content.rs`

现状：

`list.json` 和 `memo.json` 采用 read-modify-write，并直接 `fs::write` 覆盖。`.md` 重命名、`.md` 写入、`list.json` 更新、`memo.json` 更新不是一个完整事务。

影响：

- rename 成功但 `list.json` 写失败时，会产生短暂不一致。
- `list.json` 写成功但 `memo.json` 写失败时，todo 派生索引和列表索引不一致。
- 应用异常退出、磁盘错误、权限错误时，可能留下半更新状态。

处理方向：

- 增加 JSON 原子写工具：写临时文件后 rename。
- 明确 `.md`、`list.json`、`memo.json` 的落盘顺序和失败恢复策略。
- 将失败上抛为结构化错误。

## 问题 4：后端命令层大量 unwrap

优先级：P1

位置：

- `app/backend/src/commands/memo.rs`
- `app/backend/src/commands/helpers.rs`
- `app/backend/src/lib.rs`

现状：

多个命令直接调用 `RwLock::read().unwrap()` 和 `RwLock::write().unwrap()`。

影响：

- 持锁路径 panic 后，锁中毒会导致后续命令继续 panic。
- 局部失败可能扩大成主窗口不可用。

处理方向：

- 封装锁读取和写入 helper。
- Tauri command 返回 `Result<T, String>` 或统一错误类型。
- 前端按错误类型显示更明确的信息。

## 问题 5：Tauri IPC 类型边界偏弱

优先级：P2

位置：

- `app/frontend/lib/tauri/client.ts`

现状：

RPC wrapper 中仍有大量 `invoke<any>`、`invoke<any | null>`、`invoke<{ memos: any[] }>`。

影响：

- Rust DTO 字段变化时，TypeScript 无法编译期发现。
- 核心数据结构如 `Memo`、`Notebook`、`MemoEvent` 只能靠运行时验证。

处理方向：

- `client.ts` 使用明确的前端镜像类型。
- 禁止业务层直接裸调 `invoke`。
- 中长期引入 Rust 到 TypeScript 的类型生成。

## 问题 6：IPC 错误信息被 bool / Option 吞掉

优先级：P2

位置：

- `app/backend/src/commands/memo.rs`
- `app/backend/src/commands/file.rs`
- `app/frontend/lib/tauri/client.ts`

现状：

不少命令返回 `bool` 或 `Option<T>`，失败原因被折叠成 `false` 或 `null`。

影响：

- 前端无法区分路径越权、文件不存在、CAS 冲突、权限失败、编码失败、磁盘错误。
- 用户看到的错误文案只能是“读取失败”“保存失败”，排查成本高。

处理方向：

- 命令返回 `Result<T, CommandError>`。
- 错误类型包含 code 和 message。
- 前端按 code 决定是否提示重试、刷新、权限说明或冲突处理。

## 问题 7：自写抑制依赖时间窗口

优先级：P2

位置：

- `app/frontend/windows/main/document-pane/document-container.tsx`
- `app/backend/src/fs_watcher.rs`

现状：

系统通过前端 3 秒窗口、后端 2 秒 self-write TTL、150ms path debounce、250ms id dedup 规避自身写盘引发的重复 reload。

影响：

- 常规本机磁盘足够有效。
- 大文件、慢机器、网络盘、外部同步软件或杀毒软件环境下，窗口外事件仍可能出现。
- 事件来源依赖时间推断，不是强语义模型。

处理方向：

- 写操作生成 `operationId`。
- `writeDocument`、`updateMemoDb`、`memo-event`、watcher 事件尽量携带或关联 `operationId`。
- 前端根据当前 session 的 pending operation 明确忽略自身事件。

## 问题 8：前端列表缓存策略尚未形成 Notebook 级模型

优先级：P2

位置：

- `app/frontend/lib/store/memo-store.ts`

现状：

当前 store 保存当前 Notebook 的 `memos`，保存单篇 memo 后已改为按 id 合并，避免全量 `loadMemos()`。但尚未形成按 Notebook 分片的本地列表缓存。

影响：

- Notebook 切换时仍偏向重新加载。
- 大文档库下，列表加载和排序可能成为可见成本。

处理方向：

- 短期保留当前模式，避免过早缓存复杂化。
- 中期可以引入 `memosByNotebookId`，缓存当前筛选前的基础列表。
- 筛选、排序、tag view 应明确哪些在前端派生，哪些从后端读取。

## 问题 9：标题、preview、tags、todos 已后端化，但派生和写盘仍强耦合

优先级：P2

位置：

- `app/backend/src/memo_file/derivation.rs`
- `app/backend/src/memo_file/content.rs`

现状：

标题、preview、tags、todos 已集中在后端派生，这是正确方向。但派生、frontmatter 写入、文件重命名、list.json 同步仍在 `update_memo_item` 链路中串行完成。

影响：

- 某一阶段失败可能造成文件和索引短暂不一致。
- 派生逻辑要非常小心 frontmatter，避免再次引发头信息解析异常。

处理方向：

- 保持派生逻辑后端单一来源。
- 将“解析正文”“计算派生字段”“生成落盘计划”“执行落盘计划”拆成更清晰的阶段。

## 问题 10：源码和文档的中文显示链路需要统一

优先级：P3

位置：

- `docs/`
- 多个前后端源码注释。

现状：

部分中文注释在 PowerShell 默认读取时显示乱码，UTF-8 读取时部分文档正常。

影响：

- 维护时容易误判文件损坏。
- 使用错误编码重新保存时，可能真的破坏注释。

处理方向：

- 增加 `.editorconfig` 约束 UTF-8。
- 查看中文文档时使用 `Get-Content -Encoding UTF8`。
- 业务改动和大面积注释编码修复分开提交。

## 当前优先处理项

本轮开始处理“问题 1：DocumentContainer 职责过重”。

执行顺序：

1. 提取纯函数和共享类型，保持行为不变。
2. 提取文档内容加载 hook。
3. 提取自动保存 hook。
4. 提取 memo metadata sync hook。
5. 提取最终重命名 hook。
6. 提取外部变更监听 hook。
7. 每一步运行前端构建验证。

