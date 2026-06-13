# 文档会话架构设计

日期：2026-06-09

范围：主窗口 Memo 列表、文档编辑器、文档状态 Store，以及全局搜索打开 Memo 的前端数据流。

## 背景

编辑器原先把“当前打开的文档”隐式绑定到 `selectedMemo`。这会导致一个竞态问题：

1. 用户正在编辑 A 文档，A 触发自动保存。
2. A 保存完成前，用户快速切换到 B 文档。
3. B 已经加载完成后，A 的保存回调继续执行。
4. 如果保存回调或列表刷新又读取当前全局 `selectedMemo`，此时读到的是 B。
5. A 的异步结果可能间接刷新 B 的编辑器，表现为 B 打开后再次闪烁或抖动。

这个问题的根因不是单个 `reload` 判断，而是状态模型混淆了两个概念：

- `selectedMemo`：列表选中态，用于列表高亮、标题栏展示、上下文操作。
- 当前编辑器会话：一次明确打开的文档实例，应当有稳定身份，并且异步保存必须回到它自己的 `memoId`。

## 设计目标

- 编辑器实例的身份由稳定的文档会话决定，而不是由列表对象引用决定。
- 单篇 Memo 保存后只按 `id` 合并这篇 Memo 的最新元数据，不触发全量 `loadMemos()`。
- A 文档的保存、重命名、metadata 同步完成后，只能影响 A 的 Memo 记录，不能重载当前已经打开的 B。
- Memo 列表可以继续更新标题、预览、收藏、时间等元数据，但这些更新不能导致编辑器重建。
- 搜索、创建、待办跳转等入口必须显式打开文档会话，不能依赖 `selectedMemo` 的副作用。

## 核心模型

### DocumentStore

文件：`app/frontend/lib/store/document-store.ts`

`DocumentStore` 负责描述“当前打开文档会话”，而不是列表选中态。

主要字段：

- `currentDocumentPath`：当前编辑器读取的真实文件路径。
- `currentDocumentSource`：当前来源，取值为 `memo` 或 `external`。
- `activeMemoSession`：当前 Memo 文档会话。
- `activeExternalSession`：当前外部文档会话。

主要动作：

- `openMemoDocument({ memoId, path, notebookId, notebookPath })`
- `openExternalDocument(path)`
- `clearDocument()`

`activeMemoSession.id` 使用 `memo:${memoId}`。这保证同一个 Memo 即使因为标题提取导致文件名变化，编辑器身份仍然稳定，不会因为路径变化而重建。

## 模块职责

### MemoStore

文件：`app/frontend/lib/store/memo-store.ts`

职责：

- 保存当前 Notebook 的 Memo 列表。
- 保存 `selectedMemo` 和 `selectedNotebook`。
- 提供 `loadMemos()` 做列表级加载。
- 提供 `upsertMemo(memo)` 做单篇 Memo 的元数据合并。

约束：

- `selectedMemo` 只代表列表选中态，不代表编辑器真实打开会话。
- 保存单篇 Memo 后不应调用全量 `loadMemos()`。
- `upsertMemo()` 只更新当前列表中已存在的 Memo，避免把其它 Notebook 或其它筛选条件下的 Memo 插入当前列表。

### MemoList

文件：`app/frontend/windows/main/memo-pane/memo-list.tsx`

职责：

- 列表展示、筛选、排序、待办视图、创建/删除 Memo。
- 用户点击 Memo 或待办项时，同时更新 `selectedMemo` 并调用 `openMemoDocument()`。

关键约束：

- 不再监听 `selectedMemo` 变化来自动打开文档。
- `loadData()` 或 `loadMemos()` 完成后，不再根据最新 `selectedMemo` 重新打开当前文档。
- 删除当前 Memo 时，清空 `selectedMemo` 并调用 `clearDocument()`。

这样可以避免列表刷新或单篇元数据合并触发编辑器重新装载。

### MainLayout

文件：`app/frontend/windows/main/main-layout.tsx`

职责：

- 汇总主窗口布局状态。
- 根据 `activeMemoSession.memoId` 从 `memos` 中查找当前标题栏需要展示的最新 Memo 元数据。
- 将稳定的 `memoId / notebookId / notebookPath` 传给 `DocumentContainer`。
- 使用文档会话 id 作为 `DocumentContainer` 的 React `key`。

关键点：

- 标题栏可以随着 `memos` 元数据更新而刷新。
- 编辑器实例的 key 使用 `activeMemoSession.id`，不是路径和 `selectedMemo` 对象。
- 外部文件通过 `openExternalDocument(path)` 打开，和 Memo 会话分离。

### DocumentContainer

文件：`app/frontend/windows/main/document-pane/document-container.tsx`

职责：

- 读取和渲染当前文档内容。
- 处理自动保存、外部变更监听、编辑结束后的重命名落盘。
- 对 Memo 文档按传入的 `memoId` 同步后端 metadata。

关键约束：

- 保存、重命名、读取最新 Memo 时必须使用 props 传入的 `memoId`。
- 不允许在保存回调里读取全局当前 `selectedMemo` 作为目标 Memo。
- 重命名后如果真实路径变化，通过 `openMemoDocument({ memoId, path: nextPath, ... })` 更新当前会话路径，但会话 id 保持 `memo:${memoId}`。
- 组件内部编辑器 key 使用 `memo:${memoId}`，保证同一 Memo 改名不重建编辑器。

### GlobalSearchCommand

文件：`app/frontend/windows/main/global-search-command.tsx`

职责：

- 搜索结果选中 Memo。
- 新建 Memo。
- 切换 Notebook。

关键约束：

- 搜索结果命中后，除了 `setSelectedMemo(memo)`，还必须显式调用 `openMemoDocument()`。
- 新建 Memo 后同样必须显式打开文档会话。
- 切换 Notebook 时清空 `selectedMemo` 并调用 `clearDocument()`。

## 关键数据流

### 打开 Memo

```text
用户点击 Memo / 搜索命中 / 待办跳转 / 新建 Memo
  -> setSelectedMemo(memo)
  -> openMemoDocument({ memoId, path, notebookId, notebookPath })
  -> MainLayout 读取 activeMemoSession
  -> DocumentContainer 以 memo:${memoId} 作为稳定实例
  -> DocumentContainer readDocument(path)
```

### 编辑保存

```text
编辑器内容变化
  -> DocumentContainer debounce saveDoc(content, path)
  -> writeDocument(path, content, expectedContent)
  -> updateMemoDb(memoId, ..., deferRename=true)
  -> readMemo(memoId)
  -> upsertMemo(latestMemo)
```

保存链路只携带打开时确定的 `memoId`。即使用户已经切到 B，A 的保存回调仍然只会更新 A 的列表元数据。

### 编辑结束和重命名

```text
编辑结束 / 组件卸载
  -> finalizeMemoRename()
  -> updateMemoDb(memoId, ..., deferRename=false)
  -> readMemo(memoId)
  -> 根据 latestMemo.path + notebookPath 计算真实路径
  -> 必要时 openMemoDocument({ memoId, path: nextPath, ... })
```

同一 Memo 的文件名变化不会改变会话 id，因此不会造成编辑器重建。

### 列表刷新

```text
筛选 / 排序 / Notebook 切换 / 明确刷新
  -> loadMemos()
  -> 更新 memos[]
  -> MainLayout 的 currentMemo 可随列表元数据刷新
  -> DocumentContainer 不因 selectedMemo 或 memos 对象变化重载
```

## 稳定性约束

后续维护时需要遵守以下约束：

- 不要在 `MemoList` 中恢复“监听 `selectedMemo` 自动打开文档”的 effect。
- 不要在单篇保存完成后调用全量 `loadMemos()`。
- 不要在 `DocumentContainer.saveDoc()` 或 `finalizeMemoRename()` 中用全局 `selectedMemo.id` 作为保存目标。
- 任何可以打开 Memo 的入口，都必须显式调用 `openMemoDocument()`。
- 文档路径变化不等于文档身份变化。Memo 文档身份应优先使用 `memoId`。
- `selectedMemo` 可以用于列表高亮和标题栏兜底展示，但不能作为编辑器会话来源。

## 已验证行为

已通过前端构建：

```text
npm.cmd run build
```

构建通过。Vite 仍报告大 chunk warning，这是既有打包体积问题，不属于本次文档会话重构范围。

## 后续可改进点

- 将“打开 Memo”的逻辑封装为共享 helper，减少 `MemoList`、`GlobalSearchCommand` 等入口重复拼接路径。
- `chat-store` 当前仍会从 `selectedMemo` 推断当前笔记路径，后续如果需要严格跟随编辑器会话，应改为优先读取 `DocumentStore.currentDocumentPath`。
- 可以为 `DocumentStore` 增加轻量单元测试，覆盖打开 Memo、打开外部文件、清空文档、Memo 改名路径更新等状态转换。
