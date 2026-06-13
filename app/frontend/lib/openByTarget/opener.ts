/**
 * "通过链接打开笔记" — 唯一对外入口。
 *
 * 设计:
 *   - `openNoteByTarget` 是真正的打开动作, 接收已解析的 `ResolvedOpenTarget`
 *     (后端 `open_memo_by_target` IPC 解析的产物), 做:
 *       1. 跨 notebook 切换 (若需要)
 *       2. upsertMemo + setSelectedMemo (**早于** openMemoDocument, 与
 *          `node-note.ts::openNoteReference` 同步, 关掉 enqueueTransition
 *          窗口期间 activeMemoSession.memoId 滞后的问题)
 *       3. openMemoDocument ── 走 document-store 的串行化
 *
 *   - `openNoteByDeepLink` / `openNoteByPhysicalPath` 是**热路径入口**, 接收
 *     原始字符串, 委托后端 IPC 解析。 物理路径粘贴的 NoteReference 双击也
 *     走这个, 替代 `openNoteReference` 里 4 步手操 ── 后端权威解析 + emit
 *     走相同 pipeline, 行为统一。
 *
 *   - `mountOpenTargetListener` 是**单订阅者**, 挂在 App.tsx 顶层, 跨窗口
 *     同步通过 Tauri 事件总线承担 (跟 `external-markdown-opened` 同形)。
 */

import { memos as memosClient, notebooks as notebooksClient } from '../tauri/client';
import { useDocumentStore, useMemoStore, type MemoItem, type Notebook } from '../store';
import { resolveAbsolutePath } from './path-helper';
import type { ResolvedOpenTarget } from './types';

/**
 * 把 ResolvedOpenTarget 喂给 document-store。 跨 notebook 时先切, 切完
 * 等 memos 列表重新加载完成再设置 selectedMemo + openMemoDocument。
 *
 * 跟 `node-note.ts::openNoteReference` 同源, 但这里 ResolvedOpenTarget 来自
 * 后端权威解析 (memoId / notebookId / absolutePath 全部校验过)。
 */
export async function openNoteByTarget(resolved: ResolvedOpenTarget): Promise<void> {
  const store = useMemoStore.getState();
  const documentStore = useDocumentStore.getState();

  // 1. 跨 notebook 切换
  const targetNotebook: Notebook | null = store.notebooks.find(
    (nb) => nb.id === resolved.notebookId,
  ) ?? null;

  if (store.selectedNotebook?.id !== resolved.notebookId) {
    try {
      // Tauri IPC: 把 current_notebook_id 切到目标, 后端 switch_notebook_and_rebuild
      // 走 watcher rebind + 索引 rebuild, 但不切文档 (避免闪烁)。
      await notebooksClient.setCurrent(resolved.notebookId);
      // store 也要同步 selectedNotebook, 后续 selectedMemo 跟列表对齐
      if (targetNotebook) {
        store.setSelectedNotebook(targetNotebook);
      } else {
        // 后端合法但前端 store 还没拿到, 触发一次 loadNotebooks
        await store.loadNotebooks();
        const reloaded = useMemoStore.getState().notebooks.find(
          (nb) => nb.id === resolved.notebookId,
        );
        if (reloaded) {
          useMemoStore.getState().setSelectedNotebook(reloaded);
        }
      }
      // 重新拉 memos (新 notebook 的列表)
      await useMemoStore.getState().loadMemos({ notebookId: resolved.notebookId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[openByTarget] switch notebook failed:', err);
      return;
    }
  }

  // 2. upsertMemo + setSelectedMemo
  //    ── 顺序约束: setSelectedMemo **必须早于** openMemoDocument, 关闭
  //    enqueueTransition 异步窗口期间 activeMemoSession.memoId 滞后的
  //    "reopen 旧 memo" race (见 noteReference fix)。
  const memoItem: MemoItem = {
    id: resolved.memoId,
    filename: resolved.memoTitle,
    preview: '',
    tags: [],
    todos: [],
    createdAt: 0,
    updatedAt: 0,
    favorited: false,
    icon: null,
    colors: [],
    path: null,
    isOpen: true,
  };

  const latest = useMemoStore.getState();
  if (!latest.memos.find((m) => m.id === memoItem.id)) {
    latest.upsertMemo(memoItem);
  }
  latest.setSelectedMemo(memoItem);

  // 3. openMemoDocument ── document-store 内部走 enqueueTransition 串行化
  try {
    await documentStore.openMemoDocument({
      memoId: resolved.memoId,
      path: resolveAbsolutePath(resolved),
      notebookId: resolved.notebookId,
      notebookPath: resolved.notebookPath,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[openByTarget] openMemoDocument failed:', err);
  }
}

/**
 * 入口: 深链 `flowix://...` ── 直接调后端 IPC 解析 + 打开。
 * 主窗口 listener 收到 `flowix:open-target` 事件时也是同样的逻辑。
 */
export async function openNoteByDeepLink(url: string): Promise<void> {
  const resolved = await memosClient.openMemoByTarget(url);
  if (!resolved) {
    // eslint-disable-next-line no-console
    console.warn('[openByTarget] openMemoByTarget returned null for', url);
    return;
  }
  await openNoteByTarget(resolved);
}

/**
 * 入口: 物理路径 / 物理路径的 `file://` URL ── 走同一条 IPC, 后端按 OpenTarget
 * 解析。 NoteReference 双击也走这里 (替代原 `openNoteReference` 的 4 步手操)。
 */
export async function openNoteByPhysicalPath(rawPath: string): Promise<void> {
  await openNoteByDeepLink(rawPath);
}
