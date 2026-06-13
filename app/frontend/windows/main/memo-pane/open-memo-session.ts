import { joinNotebookMemoPath } from '../../../lib/path';
import { useDocumentStore, useMemoStore, type MemoItem, type Notebook } from '../../../lib/store';

export function resolveMemoSessionPath(memo: MemoItem, notebook: Notebook | null): string | null {
  return notebook?.path ? joinNotebookMemoPath(notebook.path, memo.path) : memo.path ?? null;
}

export async function openMemoSession(memo: MemoItem, notebook: Notebook | null): Promise<void> {
  const fullPath = resolveMemoSessionPath(memo, notebook);

  try {
    await useDocumentStore.getState().openMemoDocument({
      memoId: memo.id,
      path: fullPath,
      notebookId: notebook?.id ?? null,
      notebookPath: notebook?.path ?? null,
    });
  } catch (err) {
    console.error('[openMemoSession] openMemoDocument rejected', err);
    return;
  }

  useMemoStore.getState().setSelectedMemo(memo);
}
