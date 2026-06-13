// 后端 `memo-event` 事件总线的前端单订阅者 — 挂在 App.tsx 顶层, 让主窗口和
// 偏好设置窗口都同步。事件按 `kind` 派发到 memo-store 的 handleMemo* 三个
// action; store 自己负责乐观更新 + triggerRefresh, 不在这里做任何业务判断。
//
// 替代旧的 `agent-document-updated` 事件, 新协议统一为 `memo-event` 一个事件名
// 内部 snake_case `kind` 区分 Created/Updated/Deleted。
//
// 设计取舍:
// - 这里不分支 source: 不同 source (agent_edit vs user_edit vs external_tool)
//   走完全相同的 store 更新路径。前端不用 source 做任何 UI 决策 — 它的存在
//   仅供日志 / 后续 toast 区分使用。
// - 不在事件 handler 里直接 mutate selectedMemo: store action 自己处理。

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { shouldSuppressLocalCreatedMemo, useMemoStore } from '../store/memo-store';
import { useDocumentStore } from '../store/document-store';
import { memos as memosClient } from '../tauri/client';
import {
  applyLoadedDocumentContent,
  moveDocumentBuffer,
} from '../store/document-session-service';
import { getBuffer } from '../store/buffer-registry';
import type { MemoEvent } from '../../types/memo';
import type { MemoItem } from '../store/memo-store';

export function useMemoEvents(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<MemoEvent>('memo-event', (event) => {
      if (disposed) return;
      const payload = event.payload;
      const store = useMemoStore.getState();
      switch (payload.kind) {
        case 'created':
          if (shouldSuppressLocalCreatedMemo(payload.memo.id, payload.source)) {
            break;
          }
          store.handleMemoCreated(payload.memo);
          break;
        case 'updated': {
          // 注: 历史上这里会在 `source === 'user_edit'` 时 break, 因为
          // `write_document` 与 `update_memo_db` 两条 IPC 各发一次, 频率
          // 翻倍 + 前端 `useMemoMetadataSync` 在 `onSaved` 里已走 store
          // 兜底 (`readMemo` + `upsertMemo`)。后端整合 `write_document`
          // 写盘路径单点自带派生 + emit, 且前端 `useMemoMetadataSync` 已
          // 降级为可选入口, 不再每次自动调 ── `user_edit` 事件成为 list
          // 立即刷新的唯一来源, 必须放行。
          //
          // 拿到 handleMemoUpdated 返回的 prefetchedMemo 透传给
          // syncActiveDocumentPathIfRenamed ── 它原本会自己 readMemo 一次,
          // 现在复用 store 这里已经读到的权威值, 避免同一事件触发两次 IPC (D 修)。
          void (async () => {
            const updatedMemo = await store.handleMemoUpdated(payload.id);
            // B 方案: write_document 写盘后端若 rename 了物理文件, 这里
            // 主动把编辑器切到新 path。否则编辑器还指着旧路径, 下一次
            // saveDoc 会以旧路径发 IPC, 触发 CAS refusal 或写到孤儿文件。
            await syncActiveDocumentPathIfRenamed(payload.id, updatedMemo);
          })();
          break;
        }
        case 'deleted':
          store.handleMemoDeleted(payload.id);
          break;
      }
    })
      .then((fn) => {
        // 异步 listen() 完成时如果组件已经卸载, 立刻 unlisten
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        // 监听失败只 warn, 不影响主窗口 UI
        // eslint-disable-next-line no-console
        console.warn('[useMemoEvents] failed to subscribe to memo-event:', err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

/// B 方案 (filename / 物理文件名 / frontmatter 三拷贝一致) 配套: 写盘后
/// 后端若改了物理文件名, 收到 `Updated` 事件后这里检测到 "active memo
/// session 还是旧 path, 但最新 list.json 里 path 已变", 主动把编辑器
/// 切到新 path。
///
/// **并发保护 ──** `syncActiveDocumentPathIfRenamed` 与
/// `useDocumentFinalize.finalizeMemoRename` 走几乎一样的"读盘 + 搬 buffer
/// + 切 path"流程。两者会在以下场景并发触发同一对 rename (都响应同一条
/// memo 路径变更):
/// 1. `useMemoEvents` 收到 `Updated(user_edit)` 事件 (写盘 helper 写完盘)
/// 2. `useMemoEvents` 收到 `Updated(user_edit)` 事件 (finalize 走
///    `update_memo_item` 写完盘)
/// 两条事件几乎同时到达, 两次 `syncActiveDocumentPathIfRenamed` 并发跑
/// 会引发:
/// - 第二次 `moveBuffer` 拿不到 oldKey (第一次已 delete) ── 创建空 buffer
///   给 oldKey, 僵尸 buffer 复活。
/// - 两次 `openMemoDocument` 重复 enqueueTransition 走 setState, 浪费 IPC。
///
/// 用模块层 Set 做并发闸: 同 memoId 有任务在跑, 直接 return。
const renamingInFlight = new Set<string>();

async function syncActiveDocumentPathIfRenamed(
  memoId: string,
  prefetchedMemo?: MemoItem | null,
): Promise<void> {
  if (renamingInFlight.has(memoId)) return;
  renamingInFlight.add(memoId);
  try {
    await syncActiveDocumentPathIfRenamedInner(memoId, prefetchedMemo);
  } finally {
    renamingInFlight.delete(memoId);
  }
}

async function syncActiveDocumentPathIfRenamedInner(
  memoId: string,
  prefetchedMemo?: MemoItem | null,
): Promise<void> {
  const docStore = useDocumentStore.getState();
  const active = docStore.activeMemoSession;
  if (!active || active.memoId !== memoId) return;

  // 复用 useMemoEvents 入口处 readMemo 拿到的权威值, 跳过本函数内第二次 IPC (D 修)。
  // 兜底: prefetchedMemo 为 null/undefined 时仍自己 read, 保留外部直接调 sync 的兼容。
  const memo = (prefetchedMemo !== undefined ? prefetchedMemo : null)
    ?? (await memosClient.readMemo(memoId) as MemoItem | null);
  if (!memo || !memo.path) return;

  // 算新 path (跟 list_store.rs 的 generate_memo_filename 同形: 由 caller
  // 端 join notebook 根目录)。如果当前 active path 与最新 path 不一致, 切。
  const notebookPath = active.notebookPath ?? null;
  const normalizedCurrent = active.path.replace(/\\/g, '/');
  const normalizedLatest = (notebookPath
    ? `${notebookPath.replace(/[\\/]+$/, '')}/${memo.path}`
    : memo.path
  ).replace(/\\/g, '/');
  if (normalizedCurrent === normalizedLatest) return;

  // rename 配套: 不能只调 `openMemoDocument` ── 它只改 `useDocumentStore`
  // 状态, 不重读盘; 而 `useDocumentContent` 那个 useEffect 在 memoId 不变
  // 时早 return (documentInstanceKey = "memo:" + memoId, 跟 filePath 无关),
  // 也不会触发 reloadDocument。`recordDocumentEdit` 之后 `lastSavedContent`
  // 仍是空字符串, 下次 saveDoc CAS 拿 "" vs 磁盘 `frontmatter+body` → 失败。
  //
  // 修复: 主动 `readDocument` + `moveBuffer` + `applyLoadedDocumentContent` ──
  // 一步把 buffer 的 content / lastSavedContent 同步到磁盘最终内容, 同时
  // 切 active session 路径。
  //
  // 两个不变量 (改时务必保持):
  // 1. **保留用户未保存字符**: 写盘完成到本函数执行之间 (IPC 往返 + 事件
  //    emit + listen 异步) 用户可能已经继续敲字, 这些字符在旧 buffer 上
  //    (`buf.content !== buf.lastSavedContent`)。`moveDocumentBuffer` /
  //    `applyLoadedDocumentContent` 默认会用 diskContent 覆盖 content ──
  //    这里在覆盖**之后**再写回用户最新字符, lastSavedContent 保留为
  //    diskContent ── 1s 后节流 saveDoc 会自然把用户字符写回, 同时
  //    `lastSavedContent` 拿新磁盘内容再对齐, 收敛到一致状态。
  // 2. **读盘失败仍搬 buffer**: `readDocument` 偶发失败不能放任僵尸 buffer
  //    (旧 key 残留) ── 即使没 diskContent 也调 `moveDocumentBuffer` 把
  //    buffer 键搬到 newPath, 代价是 lastSavedContent 被覆盖为空串, 接受
  //    下次 saveDoc 可能 CAS 失败 (用户可手动重存) ── 远比"旧 buffer 永不
  //    同步"安全。
  const oldBuf = getBuffer(normalizedCurrent);
  const userContent = oldBuf?.content;
  const userHasUnsaved = oldBuf !== undefined
    && oldBuf.content !== oldBuf.lastSavedContent;

  let diskContent: string | null = null;
  try {
    diskContent = await memosClient.readDocument(normalizedLatest);
  } catch {
    diskContent = null;
  }

  // 搬键 + 设 lastSavedContent / content 为 diskContent (或空串兜底)
  moveDocumentBuffer(normalizedCurrent, normalizedLatest, diskContent ?? '');
  if (diskContent !== null) {
    applyLoadedDocumentContent(normalizedLatest, diskContent);
  }

  // 补强 (1): 用户有未保存字符且与磁盘内容不一致时, 把它再写回
  // (applyLoadedDocumentContent 之后做, 避免被它覆盖)
  if (diskContent !== null && userHasUnsaved && userContent !== diskContent) {
    const newBuf = getBuffer(normalizedLatest);
    if (newBuf) {
      newBuf.content = userContent!;
      newBuf.pendingContent = userContent!;
      // lastSavedContent 保持 diskContent ── saveDoc 会用 diskContent
      // 作 expected, 与磁盘一致, CAS 成功; 写盘后 onSaved 拿新磁盘内容
      // (frontmatter + userContent) 再对齐 lastSavedContent, 收敛。
    }
  }

  // 切 active session 路径 (走 enqueueTransition, 在外层 setState 完成)
  await docStore.openMemoDocument({
    memoId,
    path: normalizedLatest,
    notebookId: active.notebookId ?? null,
    notebookPath,
  });

  // TODO: `useDocumentContent` 持有的 `state.fullContent` 与本函数改的
  // `buf.content` 不通过 React 同步 ── 本函数调 `moveDocumentBuffer` /
  // `applyLoadedDocumentContent` 只动 buffer-registry (imperative state),
  // 不调 `useDocumentContent` 的 setState。当前场景下 `state.fullContent`
  // 与 `buf.content` 恰好一致 (写盘 helper 写完后用户没敲字时 diskContent
  // = userContent = state.fullContent), 但若未来这条路径要支持"rename 时
  // 把新 buffer 内容也 push 到编辑器显示", 需要扩展为: 本函数返回 diskContent,
  // `useMemoEvents` 拿到后调 document-container 的 setState 同步 fullContent。
}
