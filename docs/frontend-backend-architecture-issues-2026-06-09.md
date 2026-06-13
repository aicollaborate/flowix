# 前后端架构问题与 DocumentContainer 拆分方案

日期：2026-06-09

范围：`app/frontend` 与 `app/backend` 中 Memo 列表、文档编辑器、文档会话、Tauri IPC、后端 memo 文件写入、事件同步相关代码。

## 总览

当前系统已经通过“文档会话”和“单篇 memo 元数据合并”解决了快速切换文档时的主要闪烁问题。但从架构上看，编辑器会话、memo 元数据、磁盘文件、事件刷新这几层仍然耦合较深。

后续最值得优先处理的是 `DocumentContainer` 职责过重。它目前集中承担了读盘、自动保存、metadata 同步、重命名、frontmatter 修补、外部文档导入、事件监听、轮询刷新和自写抑制。这个组件继续变大后，保存、切换、排序、外部修改、frontmatter 这类问题会更容易互相影响。

## 架构问题清单

### 1. DocumentContainer 职责过重

优先级：P1

位置：

- `app/frontend/windows/main/document-pane/document-container.tsx`

现状：

`DocumentContainer` 同时负责：

- 读取文档内容。
- 渲染编辑器。
- 维护 `contentRef`、`lastSavedContentRef`、`pendingContentRef`。
- 自动保存 debounce。
- 调用 `writeDocument` 写盘。
- 调用 `updateMemoDb` 同步标题、preview、tags、todos 等派生元数据。
- 编辑结束或卸载时执行最终重命名。
- 修补 frontmatter 中的 `filename`。
- 监听 `memo-event` 并按 path 判断是否 reload。
- 每 2.5 秒轮询磁盘外部变更。
- 使用 3 秒自写抑制窗口规避自身写盘引发的 reload。
- 外部文档保存到 Memo。
- 计算字数、token 数、标题栏元信息。

影响：

- 保存、重命名、外部刷新、事件监听之间存在隐式耦合。
- 一个功能的小改动容易影响另一个功能，例如保存链路影响列表排序、frontmatter 写回影响编辑器 reload。
- 组件内有大量 ref 和异步回调，后续维护时很难判断某次 reload 是否来自用户编辑、外部工具、metadata 同步还是路径变化。
- 难以单元测试。多数逻辑只能通过完整 UI 行为间接验证。

建议：

把 `DocumentContainer` 从“业务控制器 + 编辑器渲染器”拆成“会话容器 + 多个专用 hook + 纯 UI 组件”。

详细方案见本文后面的“第一点拆分设计方案”。

### 2. 前端仍有两套当前文档状态，边界需要继续硬化

优先级：P1

位置：

- `app/frontend/lib/store/document-store.ts`
- `app/frontend/lib/store/memo-store.ts`

现状：

- `DocumentStore.activeMemoSession` 表示编辑器真实打开的 memo 会话。
- `MemoStore.selectedMemo` 表示列表选中态。

这个方向是正确的，但部分代码仍会通过 `selectedMemo` 做兜底查找。后续新增功能时，如果没有明确约束，很容易重新把“列表选中”和“编辑器会话”混用。

影响：

- 快速切换文档、保存旧文档、列表刷新时，可能再次出现旧异步任务影响新文档的问题。
- 标题栏、列表、编辑器对“当前 memo”的理解可能不一致。

建议：

- 编辑器读写、保存、重命名只能使用 `activeMemoSession.memoId/path`。
- `selectedMemo` 只用于列表高亮、标题栏展示和上下文菜单。
- 新增统一入口 `openMemoById` 或 `openMemoSessionFromMemo`，由它负责同步 `setSelectedMemo` 和 `openMemoDocument`。

### 3. 后端 list.json 写入不是事务化的

优先级：P1

位置：

- `app/backend/src/memo_file/list_store.rs`
- `app/backend/src/memo_file/content.rs`

现状：

`list.json` 的更新流程是：

```text
read list.json
  -> 修改内存结构
  -> fs::write(list.json)
  -> 同步 memo.json
```

`.md` 文件重命名、`.md` 内容写入、`list.json` 更新、`memo.json` 更新不是一个真正的事务。

影响：

- 进程退出、磁盘错误、权限错误、杀毒软件占用时，可能出现 `.md` 已改但 `list.json` 未改的半更新状态。
- `list.json` 和 `memo.json` 可能短暂不一致。
- 当前依赖后续 reconcile 兜底，但 reconcile 不应该是主要一致性保障。

建议：

- 增加 `write_json_atomic(path, value)`：写入临时文件后 rename 覆盖。
- 对 `.md`、`list.json`、`memo.json` 的落盘顺序做显式设计。
- 失败时返回结构化错误，而不是仅返回 `false`。

### 4. 后端命令层大量 unwrap，锁中毒会扩大故障

优先级：P1

位置：

- `app/backend/src/commands/memo.rs`
- `app/backend/src/commands/helpers.rs`
- `app/backend/src/lib.rs`

现状：

多个 Tauri command 直接使用：

```rust
state.memo_file.read().unwrap()
state.memo_file.write().unwrap()
state.search.read().unwrap()
```

影响：

- 任意持锁路径 panic 后，锁可能进入 poisoned 状态。
- 后续正常命令因为 unwrap poisoned lock 继续 panic。
- 一个局部问题可能扩大成主窗口不可用。

建议：

- 封装 `read_memo_file_state()` / `write_memo_file_state()`。
- 锁失败时返回 `Result<T, CommandError>`。
- Tauri IPC 层统一将错误转换为前端可展示的错误信息。

### 5. IPC 类型边界偏弱

优先级：P2

位置：

- `app/frontend/lib/tauri/client.ts`

现状：

前端 RPC wrapper 中仍然存在大量：

```ts
invoke<any>
invoke<any | null>
invoke<{ memos: any[] }>
```

影响：

- Rust DTO 变更时，TypeScript 编译器无法及时发现 UI 假设已失效。
- `Memo`、`Notebook`、`MemoEvent` 这类核心模型的字段变化容易变成运行时问题。

建议：

- `client.ts` 中至少使用 `MemoItem`、`Notebook`、`MemoEvent` 等明确类型。
- 禁止业务层直接调用裸 `invoke`。
- 中长期可以引入 Rust 到 TypeScript 的 binding 生成。

### 6. 自写抑制主要依赖时间窗口

优先级：P2

位置：

- `app/frontend/windows/main/document-pane/document-container.tsx`
- `app/backend/src/fs_watcher.rs`

现状：

当前有多层时间窗口：

- 前端 `selfWriteInFlightUntilRef`：3 秒。
- 后端 self-write TTL：2 秒。
- watcher path debounce：150 毫秒。
- watcher id dedup：250 毫秒。

影响：

- 正常本机磁盘场景下有效。
- 大文件、慢机器、网络盘、外部同步软件、杀毒软件占用时，仍可能遇到窗口外事件。
- 事件归因依赖时间推断，不是强语义。

建议：

- 每次写操作生成 `operationId`。
- `writeDocument`、`updateMemoDb`、watcher 事件都携带 `operationId` 或可关联的写入来源。
- 前端按当前会话和 operation 明确忽略自身事件，而不是主要依赖时间窗口。

### 7. 源码和文档的中文显示链路需要统一

优先级：P3

位置：

- 多个前端、后端源码注释。
- `docs/` 下中文文档。

现状：

部分中文注释在 PowerShell 默认读取时会显示乱码。使用 UTF-8 读取时，已有 `docs/document-session-architecture.md` 可以正常显示，说明至少一部分文件本身是 UTF-8，问题可能来自默认控制台解码。

影响：

- 维护人员容易误判文件已损坏。
- 后续用错误编码保存时，可能真的破坏注释或文档。

建议：

- 增加 `.editorconfig`，约束 `charset = utf-8`。
- 约定 PowerShell 查看中文文档时使用 `Get-Content -Encoding UTF8`。
- 后续清理已确认乱码的源码注释，但不要在业务改动中大面积混入注释编码修复。

## 第一点拆分设计方案

### 目标

把 `DocumentContainer` 拆成一个轻量容器，让每类副作用有清晰归属。

拆分后要满足：

- 切换文档时，旧文档的异步保存不能影响新文档。
- 单篇 memo 保存后只按 `id` 合并元数据，不全量刷新列表。
- 同一 memo 文件名变化时，不重建编辑器实例。
- 外部工具修改当前文件时，如果本地无未保存改动，可以刷新内容。
- 自身写盘产生的 watcher / memo-event 不应触发编辑器 reload。
- frontmatter 仍由后端作为主处理方，前端不再承担复杂 frontmatter 逻辑。

### 拆分后的模块

建议新增目录：

```text
app/frontend/windows/main/document-pane/session/
```

建议模块：

```text
session/types.ts
session/document-content.ts
session/document-autosave.ts
session/memo-metadata-sync.ts
session/external-change-watch.ts
session/document-finalize.ts
session/use-document-session.ts
```

### 1. `types.ts`

职责：

- 定义文档会话内部共享类型。
- 避免每个 hook 都重复声明参数。

建议类型：

```ts
export interface DocumentSessionIdentity {
  instanceKey: string;
  filePath: string;
  source: 'memo' | 'external';
  memoId: string | null;
  notebookId: string | null;
  notebookPath: string | null;
}

export interface DocumentContentState {
  fullContent: string;
  isLoading: boolean;
  error: string | null;
  charCount: number;
  tokenCount: number;
  updatedAtDate: Date | null;
}

export interface SaveResult {
  ok: boolean;
  content: string;
  path: string;
}
```

### 2. `document-content.ts`

职责：

- 只负责加载文档、应用文档内容、维护 dirty 基准。

应该拥有：

- `contentRef`
- `lastSavedContentRef`
- `pendingContentRef`
- `loadIdRef`
- `reloadDocument(path, options)`
- `applyLoadedContent(content, options)`
- `hasUnsavedLocalChanges()`
- `markSaved(content)`

不应该拥有：

- `updateMemoDb`
- `readMemo`
- `openMemoDocument`
- `memo-event listen`
- `setInterval`

### 3. `document-autosave.ts`

职责：

- 只负责用户编辑后的 debounce 保存。
- 调用 `writeDocument`。
- 使用 CAS 的 `expectedContent` 防止覆盖外部修改。

应该拥有：

- `saveTimerRef`
- `scheduleSave(content)`
- `flushSave()`
- `clearSaveTimer()`

输入：

- 当前 `filePath`
- 当前 `contentRef`
- 当前 `lastSavedContentRef`
- `markSaved`
- `onSaved`

`onSaved` 只派发“保存成功”事件，不直接处理 memo metadata。

### 4. `memo-metadata-sync.ts`

职责：

- 只负责 memo 保存后的后端 metadata 同步。
- 调用 `updateMemoDb(memoId, ..., deferRename=true)`。
- 调用 `readMemo(memoId)` 并 `upsertMemo(latestMemo)`。

输入：

- `memoId`
- `isExternalDocument`
- `upsertMemo`

约束：

- 不能读 `selectedMemo`。
- 不能调用 `loadMemos()`。
- 不能直接 reload 编辑器。

### 5. `document-finalize.ts`

职责：

- 只负责编辑结束或组件卸载时的最终落盘。
- 判断是否需要最终重命名。
- 调用 `updateMemoDb(memoId, ..., deferRename=false)`。
- 如果路径变化，只调用 `openMemoDocument` 更新当前会话 path。

输入：

- `memoId`
- `notebookId`
- `notebookPath`
- 当前 `filePath`
- `contentRef`
- `lastSavedContentRef`
- `saveNow`
- `upsertMemo`
- `openMemoDocument`

约束：

- 只能使用传入的 `memoId`。
- 不能读取全局 `selectedMemo` 作为保存目标。
- 不直接处理编辑器 UI。

### 6. `external-change-watch.ts`

职责：

- 只负责外部修改检测。
- 监听 `memo-event`。
- 轮询磁盘内容。
- 决定是否调用 `reloadDocument`。

输入：

- 当前 `filePath`
- `hasUnsavedLocalChanges`
- `reloadDocument`
- `selfWriteGuard`

改进方向：

- 第一阶段保留当前时间窗口逻辑。
- 第二阶段引入 `operationId` 后，改为按 operation 判断是否忽略事件。

### 7. `use-document-session.ts`

职责：

- 聚合上面几个 hook。
- 给 `DocumentContainer` 提供渲染所需的最小接口。

输出建议：

```ts
return {
  state,
  documentInstanceKey,
  handleChange,
  finalize,
  saveExternalToMemo,
  metaInfo,
};
```

`DocumentContainer` 最终只保留：

- 空状态渲染。
- loading / error 渲染。
- 外部文档顶部提示栏。
- `SrcEditor` / `ComnTiptapEditor` 渲染。
- 把 `onChange`、`onEditingFinished` 传给 session。

### 拆分顺序

建议分四步做，避免一次性大改引入新问题。

#### 第一步：提取纯函数和类型

迁移内容：

- `extractBodyContent`
- `normalizePathForCompare`
- `countTextUnits`
- `joinPath`
- `resolveMemoDocumentPath`
- `findMemoById`
- `memoNeedsFilenameFinalize`

目标：

- 不改变运行行为。
- 先减少 `DocumentContainer` 文件内的噪音。

验证：

- `npm.cmd run build`

#### 第二步：提取内容加载和保存 hook

新增：

- `useDocumentContent`
- `useDocumentAutosave`

迁移内容：

- `reloadDocument`
- `applyLoadedContent`
- `handleChange`
- `saveDoc`
- save timer 管理

目标：

- 让 `DocumentContainer` 不再直接维护保存 timer。
- 保存行为保持不变。

验证重点：

- 打开 memo。
- 编辑后 1 秒自动保存。
- 快速切换 A/B，不发生旧保存刷新新文档。
- 源码视图和富文本视图切换时，未保存内容不丢失。

#### 第三步：提取 metadata sync 和 finalize hook

新增：

- `useMemoMetadataSync`
- `useDocumentFinalize`

迁移内容：

- `updateMemoDb(..., deferRename=true)`
- `readMemo + upsertMemo`
- `finalizeMemoRename`
- 卸载时 finalize

目标：

- 保存正文和同步 memo 元数据变成两个清晰阶段。
- 重命名逻辑只存在一个 hook 中。

验证重点：

- 修改第一行后标题更新。
- 修改第二行后 preview 更新。
- 修改第三行以后，不应该无意义改变 preview。
- 按更新时间排序时，打开文档不应导致排序跳动。
- 编辑结束后，如果标题变化，文件最终重命名。

#### 第四步：提取外部变更监听

新增：

- `useExternalDocumentChangeWatch`

迁移内容：

- `memo-event` 监听。
- `setInterval` 磁盘轮询。
- focus 时检查外部变更。
- 自写抑制判断。

目标：

- 把“外部变化导致 reload”的规则从 UI 容器中移走。

验证重点：

- 当前文档被外部工具修改，且本地无未保存变更时，编辑器刷新。
- 当前文档有未保存变更时，不被外部内容覆盖。
- 用户自己编辑保存后，不因为 watcher 事件 reload。

## 后续增强方案：operationId

拆分完成后，可以继续把时间窗口型自写抑制升级为强语义模型。

设计：

```text
前端保存生成 operationId
  -> writeDocument(filePath, content, expectedContent, operationId)
  -> updateMemoDb(id, ..., operationId)
  -> 后端 memo-event 携带 operationId
  -> watcher 若能关联 self-write，也携带 operationId
  -> 前端当前 session 记录 pending operationId
  -> 收到同 operationId 事件时忽略 reload
```

收益：

- 不再主要依赖 2 秒、3 秒这类经验窗口。
- 慢磁盘、大文件、网络盘、外部同步软件环境下更稳定。
- 日志中可以明确追踪一次保存从前端到后端再到事件的完整链路。

## 验收标准

拆分完成后，应满足：

- `DocumentContainer` 只负责渲染和组合 hook，不直接写复杂业务流程。
- 保存单篇 memo 后不调用全量 `loadMemos()`。
- 保存、metadata 同步、重命名都按 `memoId` 定位目标。
- `selectedMemo` 不参与保存目标选择。
- 快速切换 A/B 时，A 的保存回调不会 reload B。
- 按更新时间排序时，打开文档不会触发更新时间变化。
- 外部修改当前文档时，本地无 dirty 才刷新。
- `npm.cmd run build` 通过。

