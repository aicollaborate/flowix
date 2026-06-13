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

import { subscribe } from '../tauri/event-bus';
import { shouldSuppressLocalCreatedMemo, useMemoStore } from '../store/memo-store';
import { useDocumentStore } from '../store/document-store';
import { memos as memosClient } from '../tauri/client';
import { applyLoadedDocumentContent } from '../store/document-session-service';
import { hasUnsavedLocalChangesForMemo } from '../store/buffer-registry';
import type { MemoEvent } from '../../types/memo';
import type { MemoItem } from '../store/memo-store';

export function useMemoEvents(): void {
  useEffect(() => {
    // 走 event-bus: subscribe 返回的 UnlistenFn 直接用于 useEffect cleanup,
    // 不再需要 disposed / unlisten 护栏 (event-bus 里面负责严格完成
    // listen() 后的 unlisten 生命周期管理, StrictMode 双挂 / HMR 重载
    // 都安全)。
    const unlisten = subscribe<MemoEvent>('memo-event', (payload) => {
      const store = useMemoStore.getState();
      switch (payload.kind) {
        case 'created':
          if (shouldSuppressLocalCreatedMemo(payload.memo.id, payload.source)) {
            return;
          }
          store.handleMemoCreated(payload.memo);
          return;
        case 'updated': {
          // 拿到 handleMemoUpdated 返回的 prefetchedMemo 透传给
          // syncActiveDocumentPathIfRenamed ── 复用 store 这里已经读到的
          // 权威值, 避免同一事件触发两次 readMemo IPC (D 修)。
          void (async () => {
            const updatedMemo = await store.handleMemoUpdated(payload.id);
            // 后端 write_document 写盘可能 rename 物理文件, 这里负责
            // 切 active session 路径 + 同步 buffer 跟 disk 新内容。
            await syncActiveDocumentPathIfRenamed(payload.id, updatedMemo);
          })();
          return;
        }
        case 'deleted':
          store.handleMemoDeleted(payload.id);
          return;
      }
    });
    return unlisten;
  }, []);
}

/// 物理 rename 后, 写盘路径路径已变 (list.json `path` 字段), 这里:
/// 1. 同步 buffer 到磁盘新内容 (避免 editor 视图跟 disk 不一致)
/// 2. 切 active session 路径 (让 React filePath 跟上 disk)
///
/// 不依赖 `useDocumentContent` 的 useEffect 触发 reloadDocument ── 那个
/// effect 在 `documentInstanceKey` (memo:{memoId}) 不变时早 return, 物理
/// rename 期间 memoId 不变, 跳过 reload。
///
/// 并发保护 ── 与 `useDocumentFinalize.finalizeMemoRename` 走同样路径
/// 切换流程, 同一 memoId 重复触发浪费 IPC。用模块层 Set 互斥。
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

  // 把 buffer 同步到磁盘新内容 ── 双 Map 索引下 memoId 永不变, 命中
  // 同一个 buffer object; buf.content / lastSavedContent 是首次 load
  // 时的内容, 跟物理 rename 后磁盘新内容 (含新 frontmatter / 派生
  // title) 不一致, 必须显式覆盖。
  //
  // 跳过 dirty 覆盖 ── 用户正在编辑器中敲字 (buf.content 跟 lastSavedContent
  // 的 body 不等), 覆盖会丢字符。这种情况下不覆盖, 后续
  // 用户手动 save 时会自然收敛 (本事件只是中间状态, 不是终态)。
  //
  // 用 hasUnsavedLocalChangesForMemo 跟 buffer-registry 共用 "strip frontmatter
  // 后比较" 语义 ── 让同一个“是否有未保存本地改动”的判定
  // 在 memo-store / buffer-registry / useMemoEvents 三处一致, 避免行为分裂。
  if (!hasUnsavedLocalChangesForMemo(memoId)) {
    try {
      const diskContent = await memosClient.readDocument(normalizedLatest);
      if (diskContent !== null) {
        applyLoadedDocumentContent(normalizedLatest, diskContent);
      }
    } catch {
      // readDocument 失败 (偶发 IO) ── 不强求覆盖, 用户后续操作再
      // 自然收敛。
    }
  }

  await docStore.openMemoDocument({
    memoId,
    path: normalizedLatest,
    notebookId: active.notebookId ?? null,
    notebookPath,
  });
}
