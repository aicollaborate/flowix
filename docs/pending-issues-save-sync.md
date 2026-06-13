# 待解决问题登记 — 保存与同步展示

> 状态：未排期，按"优先级"和"影响"组织
> 范围：仅限"保存（写盘）+ 同步展示（list / buffer / filename / preview）"这条链路
> 最近更新：2026-06-13

---

## 0. 上下文

本表跟进 `app/frontend` 与 `app/backend` 中 memo 文档保存、文件名/物理文件同步、`list.json` 维护、buffer registry 联动、preview/filename 派生展示这条端到端链路上的剩余隐患。

设计基线：
- `filename` 字段 / 物理文件名 / frontmatter `title` 视为同一字段的三个拷贝，创建与编辑时必须保持一致。
- memo id 永远不变，用作定位锚点。
- 后端 `write_document` 路径自带派生 + 写盘 + 三拷贝同步（不再依赖前端 `syncMemoMetadata` 兜底）。
- 物理 rename 触发的编辑器 path 切换走 `useMemoEvents.syncActiveDocumentPathIfRenamed`。
- `apply_derived_memo_fields` 内部"filename 仅在空时覆盖"保护保留（给 `register_unnamed_file` / `update_memo_item` / `reload_memo_from_disk` 用）；B 方案 helper 内部不走该保护。

---

## 1. ✅ 本轮已修

| ID | 标题 | 落地点 | 修法 |
|---|---|---|---|
| A | `syncActiveDocumentPathIfRenamed` 并发触发导致 `moveDocumentBuffer` 重复执行 | `app/frontend/lib/hooks/useMemoEvents.ts` | 模块层 `renamingInFlight: Set<string>` 互斥 |
| B | A 修后衍生：重复 enqueueTransition 噪声 | 同上 | 同一互斥集合自然消解 |
| C | `state.fullContent` 与 `buf.content` 解耦的隐性约束未在代码中标注 | `app/frontend/lib/hooks/useMemoEvents.ts` 末尾 | 加 `TODO` 注释提示未来改 buffer 需同步 setState |
| **D** | **冗余 IPC（同一 `memo-event:updated` 触发两次 `readMemo`）** | **`app/frontend/lib/store/memo-store.ts` + `app/frontend/lib/hooks/useMemoEvents.ts`** | **`handleMemoUpdated` 改 `async` 返回 memo；`syncActiveDocumentPathIfRenamed` 接受 `prefetchedMemo` 可选参数复用，外部直调兼容保留** |
| **E** | **`handleMemoUpdated` 乐观 `updatedAt: Date.now()` 占位导致排序抖动** | **`app/frontend/lib/store/memo-store.ts`** | **去掉占位 set；改为 `await readMemo` 拿权威值后一次性 `upsertMemo`（`upsertSortedMemo` 自然按真实 `updatedAt` 排）** |
| **O** | **rename 异步链期间敲字触发 "保存失败: 文档已被外部修改"** | **`app/frontend/lib/store/document-session-service.ts` + `app/frontend/windows/main/document-pane/session/use-document-autosave.ts`** | **`recordDocumentEdit` / `saveDocumentContent` 改 `getBuffer` + fallback 到 `getCurrentPath()`（不再给已搬走的旧 key 创建空 buffer）；`useDocumentAutosave.handleChange` / `saveDoc` / 1s timer fire 全部 fallback 到 `getCurrentPath() ?? filePath`，避免 closure 落后于 buffer-registry 内部 currentPath** |
| H | 外部修改兜底（"文档已被外部修改"） | `app/frontend/lib/hooks/useMemoEvents.ts:131-150` | 现有 `userHasUnsaved` 兜底已存在，无需新修 |

> 验证：后端 `cargo test --lib` 132/132 通过；前端 `tsc --noEmit` 干净。

---

## 2. 🔴 P1 — 本次扫描发现（2026-06-13 第二轮扫描）

### 2.1 问题 J：`reloadDocument` 每次重算 `isNewlyCreated`，外部改盘触发 autoFocus

**位置**：`app/frontend/windows/main/document-pane/session/use-document-content.ts:60-62`

**症状**：`applyLoadedContent` 内部 `setState({isNewlyCreated: isNew})`，`isNew = fullContent.trimStart().startsWith('# ')`。**每次** reloadDocument 都会重算 `isNewlyCreated`：
- 外部工具改盘 → `useExternalDocumentChangeWatch` 调 `reloadDocument` → 如果新盘内容以 `# ` 开头，**`isNewlyCreated: true`** → `autoFocus={state.isNewlyCreated}` 触发 → **用户光标被强行跳到编辑器**（即使已经在别处点过）
- 同样在 `saveDoc` CAS refused 时的自动 reloadDocument 也会触发

**修法**：
- `isNewlyCreated` 应该只在 `applyLoadedContent` **首次**（新文档实例）算一次
- 之后保持原值（用户编辑过就 false，永不重置）
- 提取到独立的 ref（useRef / useState 单独管理），不要在 `setState({...})` 里覆盖

**估时**：30 分钟
**风险**：低（独立字段，setState 调用点局部调整）

### 2.2 问题 K：saveDoc onCasRefused 自动 reloadDocument 几乎不触发

**位置**：`app/frontend/windows/main/document-pane/session/use-document-autosave.ts:82-87`

**症状**：
```ts
if (isMountedRef.current && buf.content === writtenContent && buf.pendingContent === null) {
  void reloadDocument(path, { preservePending: false, showLoading: false });
}
```

`buf.pendingContent === null` 这条**几乎永远不满足**——CAS refused 走 `onCasRefused` 时不调 `applyLoadedContent`（不清 pending）。`pendingContent` 只在 `onSaved` 时被清（line 224-229 buffer-registry.ts）。所以 CAS refused 时 `pendingContent` 仍然有值（最近一次 `recordDocumentEdit` / `saveDocumentContent` 设的）。

**结果**：CAS 失败时 toast 弹"文档已被外部修改"，**但编辑器不会自动 reload 磁盘最新内容**，用户 buffer 留着 stale 字符。要等用户敲字 / 切 memo / 外部再改一次盘才会被外部 watcher 触发 reload。

**修法**：
- 删 `buf.pendingContent === null` 这条守卫（或放宽到"buf.content === writtenContent"单条件）
- 或直接 `void reloadDocument(path, ...)` 无条件（CAS refused 总是希望恢复磁盘版）

**估时**：15 分钟
**风险**：低（reloadDocument 幂等，且 fail 时用户能立刻看到磁盘版重新对账）

### 2.3 问题 L：useMemoEvents / useExternalDocumentChangeWatch 的 listen() 异步注册 race

**位置**：
- `app/frontend/lib/hooks/useMemoEvents.ts:28-87`
- `app/frontend/windows/main/document-pane/session/use-external-document-change-watch.ts:54-93`

**症状**：两个 hook 都用 `listen<T>(event, cb).then(fn => { unlisten = fn })` 模式。Tauri `listen` 是**异步 IPC**：
- 在 `.then` 完成前（毫秒级），如果 useEffect cleanup 触发（filePath 变 / 组件 unmount）→ `disposed = true; unlisten?.()` → `unlisten` 还是 `undefined` → **Tauri 端 listener 不取消**
- 后续 memo-event / fs_watcher 事件继续触发到**已卸载组件**的回调
- 回调里 `if (disposed) return` 早 return → 不崩，但**Tauri listener 永久残留**
- 频繁切 memo / notebook → **listener 累积 → 内存泄漏 + 性能下降**

**修法**：
```ts
let unlistenPromise: Promise<() => void> | null = null;
unlistenPromise = listen(...).then((fn) => {
  if (disposed) {
    fn();           // 立即 unlisten
    return () => {};
  }
  return fn;
});
// cleanup
disposed = true;
unlistenPromise?.then((unlisten) => unlisten());
```

**估时**：30 分钟（两处同步改）
**风险**：低（仅调整 cleanup 顺序，不改业务逻辑）

### 2.4 问题 M：normalizePathForCompare 在 case-sensitive 磁盘上是误判

**位置**：`app/frontend/windows/main/document-pane/session/document-utils.ts:12-14`

**症状**：
```ts
export function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}
```

`toLowerCase()` 与 `buffer-registry.canonicalPath`（不 lowercase）**行为分裂**。

在 case-sensitive 文件系统（**Mac APFS 默认 / Linux**）上，"MyMemo.md" 和 "mymemo.md" 是两个文件，但 `normalizePathForCompare` 会判为相等。

**触发点**：
- `use-external-document-change-watch.ts:64-65` 路径匹配：可能把不相关文件改动误判成当前文档的改动 → 误触发 `reloadDocument` → 误覆盖用户编辑
- `use-document-finalize.ts:130` `stillActiveMemo` 校验：可能误判 active session 是否一致

**修法**：
- 去掉 `.toLowerCase()`，与 `canonicalPath` 行为统一
- 或在注释里写明"仅 case-insensitive 文件系统（Windows / HFS+）下正确"

**估时**：10 分钟
**风险**：低（行为统一后，跨平台一致性更可预测）

### 2.5 问题 N：useMemoMetadataSync 是孤儿代码

**位置**：
- `app/frontend/windows/main/document-pane/document-container.tsx:56` — 调用但不接住返回值
- `app/frontend/windows/main/document-pane/session/use-memo-metadata-sync.ts` — 整文件

**症状**：
- `useMemoMetadataSync({memoId, isExternalDocument, upsertMemo})` 调用，**返回值 `{syncMemoMetadata}` 丢弃**
- 全仓 grep `syncMemoMetadata` **0 调用方**（除了 useMemoEvents 的注释和 use-document-autosave 的注释）
- hook 内部 `useCallback` 创建的函数**永远不被触发**——纯死代码

**修法**：
- 删 `document-container.tsx:56` 调用
- 删整个 `use-memo-metadata-sync.ts` 文件
- 同步清理 `use-document-autosave.ts:75` 注释（"兜底入口保留"是误导性的——没人接住返回值就啥也不是）



### 2.6 问题 O：rename 异步链期间敲字触发 "文档已被外部修改"

**位置**：
- `app/frontend/lib/store/document-session-service.ts:42-49` (`recordDocumentEdit`) / `:52-103` (`saveDocumentContent`)
- `app/frontend/windows/main/document-pane/session/use-document-autosave.ts:51-100, 100-145` (`saveDoc` / `handleChange`)

**症状**（用户原话）：
> 编辑首行之后, 再次编辑首行, 或文档其他内容 (不离开文档的情况下进行编辑), 会提示: 保存失败: 文档已被外部修改

**根因 — closure filePath 落后于 buffer-registry currentPath**:

`useMemoEvents.syncActiveDocumentPathIfRenamed` 异步链 (`await readDocument` → `moveDocumentBuffer` → `await openMemoDocument`) 的中间窗口里:
1. `moveDocumentBuffer(oldPath, newPath, ...)` 内部 `moveBuffer` 已 delete 旧 key ── 旧 path 不再在 `buffers` map 里
2. `currentPath` 已切到 newKey (moveBuffer line 178-181)
3. 但 React `filePath` prop 仍是 oldPath (要等 `openMemoDocument` 的 `set` 完才更新)
4. **editor.onUpdate 仍持有旧 `handleChange` 闭包** (通过 `onChangeRef.current`)

此时用户敲字:
- `handleChange` closure `filePath = oldPath`
- `recordDocumentEdit(oldPath, content2)`:
  - `getOrCreateBuffer(oldPath)` 看到 oldKey 已 delete → **创建新空 buffer 给 oldKey**
  - `buf.content = content2, buf.lastSavedContent = ""`
- 1s debounce timer 触发:
  - `saveDoc(content2, oldPath)` → `readExpected: () => ""` → `write_document(oldPath, content2, expected="")`
  - 后端 `fs::read_to_string(oldPath)` → **旧路径已 rename 走** → `Err(No such file)` → return `None` → 前端 `onCasRefused` → **toast "保存失败: 文档已被外部修改"**

**修法** (已落, 2026-06-13):
- `recordDocumentEdit` / `saveDocumentContent` 改用 `getBuffer` + fallback 到 `getCurrentPath()` ── **不再给已搬走的旧 key 创建空 buffer**
- `useDocumentAutosave.handleChange` / `saveDoc` 内部 `writePath = getCurrentPath() ?? filePath` ── 整个写盘链路使用同一个 path 来源, 避免 record / flush / reload 三处 path 不一致
- `useDocumentAutosave` 1s timer 触发时再次取 `getCurrentPath()`, 不闭包到 schedule 时的 `pathAtSchedule`
- `onCasRefused` 内的 `reloadDocument` 也 fallback 到 `getCurrentPath()` ── 避免 stale closure 在错误 memo session 上 reload

**修后 invariant**:
- rename 异步链完成前后, 用户敲字都落到 `getCurrentPath()` 对应的 buffer 上 ── 永远不写"空 buffer 给孤儿 path"的状态
- IPC filePath 跟 buffer key 永远一致 ── 后端 `fs::read_to_string` 不会落到已 rename 走的物理文件上

**估时**: 已修
**风险**: 低 (三层防御: buffer-registry 兜底 + saveDoc 路径兜底 + timer fire 时再取一次)

**仍待评估**:
- 补强 (1) 仍写回 `userContent` (含旧 frontmatter) 给 `newBuf.content`, 下次 1s saveDoc 会把"旧 frontmatter + 新 body"发到后端, 后端 `strip_markdown_frontmatter` 剥掉旧 frontmatter 拼新的 ── 正确收敛, 但路径多绕一道; 进一步优化空间是把 `state.fullContent` 也跟 buf.content 同步 (P2 问题 I 仍未解)

**估时**：10 分钟
**风险**：极低（纯删代码）

---

## 3. ⚪ 本次发现已撤销（误判）

> **2026-06-13 复审结论**：原列的「问题 P：finalize 路径下僵尸 buffer 复活」经仔细推演后**判定为误判**——`moveDocumentBuffer` 内部的 `getOrCreateBuffer` 确实会临时给 oldKey 注入 buffer，但紧接着 `moveBuffer` 内的 `buffers.delete(oldKey)` 会清掉（line 176 buffer-registry.ts），newKey 拿到的是填充后的 finalizedContent，oldKey 不留痕迹。原始推演忽略了 `moveBuffer` 的 delete 步骤。

---

## 4. 🟡 P2 — 本次发现，架构隐患，当前未触发

### 4.1 问题 I：`state.fullContent` 与 `buf.content` 解耦

**位置**：
- `app/frontend/lib/hooks/useMemoEvents.ts`（`syncActiveDocumentPathIfRenamed`）
- `app/frontend/lib/hooks/useDocumentContent.ts`（`fullContent` state）

**症状**：`syncActiveDocumentPathIfRenamed` 直接改 buffer registry，不触发 `useDocumentContent` 的 setState。已加 TODO 注释（C）标记。当前场景下 `state.fullContent` 与 `buf.content` 恰好一致，但任何未来直接改 buffer 而不 setState 的路径都会造成视觉错位。

**影响**：当前未触发；但约束散落在注释里，新人改这块容易踩坑。

**修法（任选其一）**：
- 把"buffer 与 fullContent 必须同步"的不变量提到一个 helper（`applyBufferChange(setState, ...)`）里
- 或在 buffer-registry 层抛事件，被 useDocumentContent 订阅
- 或直接对 `syncActiveDocumentPathIfRenamed` 加显式 setState（仅必要分支）

**估时**：1-2 小时
**风险**：低-中（取决于选哪种修法）

### 4.2 ~~问题 D：冗余 IPC（同一事件触发两次 `readMemo`）~~ ✅ 已修 (2026-06-13)

**修法落地点**：
- `app/frontend/lib/store/memo-store.ts:347-368` — `handleMemoUpdated: (id) => Promise<MemoItem | null>`，去掉乐观 `Date.now()` 占位（E 同修），改 `await memos.readMemo(id)` 拿权威值后一次性 `upsertMemo`，并把 memo 返回给 caller
- `app/frontend/lib/hooks/useMemoEvents.ts:54-66` — `case 'updated'` 改 `await store.handleMemoUpdated(payload.id)` 拿 `updatedMemo`，透传给 `syncActiveDocumentPathIfRenamed(payload.id, updatedMemo)`
- `app/frontend/lib/hooks/useMemoEvents.ts:120-126` — `syncActiveDocumentPathIfRenamed(memoId, prefetchedMemo?)` / `syncActiveDocumentPathIfRenamedInner` 接受可选 prefetched，**有则跳过 readMemo，无则兜底仍自己 read**（保留外部直调的兼容性）

**验证**：D + E 合并改，`tsc --noEmit` 干净（无类型错误）。

---

## 5. ⚪ P3 — 本次发现，仓库既有 / 设计如此

### 5.1 ~~问题 E：`handleMemoUpdated` 同步设置 `updatedAt: Date.now()`（local 时间）~~ ✅ 已修 (2026-06-13)

**修法落地点**：`app/frontend/lib/store/memo-store.ts:347-368` — 去掉乐观 `set(updatedAt: Date.now())` 占位，改为 `await memos.readMemo(id)` 拿权威 `updatedAt` 后再 `upsertMemo`（走 `upsertSortedMemo` 自然按真实值排，不抖）。

**取舍**：等 readMemo 回来的几毫秒到几十毫秒内 list 项不立刻更新（`upsertMemo` 推迟到 readMemo 完成后）。视觉一致换即时反馈，**收益远大于成本**（保存按钮 → 用户注意力不在列表上，几十毫秒感知不到）。

### 5.2 问题 F：`handleMemoUpdated` 不调 `triggerRefresh`

**位置**：同上

**症状**：设计如此 — `upsertMemo` 走 `upsertSortedMemo` 自然排序，不再额外触发全局 refresh。

**影响**：无（设计意图）。

**修法**：跳过。

### 5.3 问题 G：`finalize_memo_filename` 走 `update_memo_item` 不走 B 方案 helper

**位置**：`app/backend/src/commands/memo.rs` — `finalize_memo_filename` 路径

**症状**：与 B 方案 helper 是两条独立写盘路径，但派生规则 deterministic（同一输入产同一输出），不会跑偏。

**影响**：双重派生是浪费，但一致性能保住。

**修法**：后续可统一到 B 方案 helper；本次不动。

**估时**：2 小时（独立 PR）
**风险**：低-中（需保证 finalize 时机与原 update_memo_item 等价）

---

## 6. 关键代码索引（resume 直接引用）

- `app/frontend/lib/hooks/useMemoEvents.ts` — A/B/C 修复落地点；`syncActiveDocumentPathIfRenamed` 主函数
- `app/frontend/lib/hooks/useMemoEvents.ts:131-150` — H 兜底（`userHasUnsaved`）
- `app/frontend/windows/main/document-pane/session/use-document-finalize.ts:97-117` — finalize 流程主路径（2026-06-13 复审确认无 race）
- `app/backend/src/commands/memo.rs:69-204` — `sync_derived_fields_for_memo` 整合 helper
- `app/backend/src/commands/memo.rs:248-385` — `write_document` 路径（改返回 `Option<String>`）
- `app/frontend/lib/store/save-queue.ts:174-205` — `runOne`（`result !== null` 判失败）
- `app/frontend/lib/store/buffer-registry.ts:218-238` — `flushDocument`
- `app/backend/src/memo_file/derivation.rs` — 块节点过滤档案（`BLOCK_NODE_FILTERS`，含 `::agent-thread-chard`）

---

## 7. 修复顺序建议

| 优先级 | 任务 | 估时 | 风险 |
|---|---|---|---|
| **J（2.1）** | `isNewlyCreated` 提取独立字段，reloadDocument 不再重算 | 30 分钟 | 低 |
| **K（2.2）** | onCasRefused 自动 reload 守卫放宽 | 15 分钟 | 低 |
| **L（2.3）** | useMemoEvents + external watcher listen() race | 30 分钟 | 低 |
| **M（2.4）** | normalizePathForCompare 去 toLowerCase | 10 分钟 | 低 |
| **N（2.5）** | 删 useMemoMetadataSync 孤儿代码 + 注释清理 | 10 分钟 | 极低 |
| **I（4.1）** | fullContent/buf 不变量收口 | 1-2 小时 | 低-中 |
| **G（5.3）** | finalize_memo_filename 路径统一到 B 方案 helper | 2 小时 | 低-中 |

### 推荐：先做 J → K → L → M → N 五连（合计 ~95 分钟，零风险）

J/K/L/M/N 都是"清理 + 收紧"性质的真问题，不动产品逻辑：
- **J + K** 直接改善用户可感知的 UX bug（外部改盘误聚焦 / CAS 失败不自动恢复）
- **L** 修内存泄漏（高频切 memo 场景）
- **M** 修跨平台一致性问题
- **N** 纯删死代码

修完后再做 I（不变量收口）和 G（路径统一）。
