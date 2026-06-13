import type { MemoItem, MemoStore } from '../../../../lib/store';

// Re-exported for callers that import DocumentBuffer from this module.
// The canonical definition lives in lib/store/document-buffer.ts so that
// the document store layer (which is window-agnostic) can use it.
export type { DocumentBuffer } from '../../../../lib/store/document-buffer';

export function extractBodyContent(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

export function countTextUnits(content: string): number {
  const chineseChars = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWords = content.match(/[A-Za-z]+/g)?.length ?? 0;

  return chineseChars + englishWords;
}

export function upsertFilenameFrontmatter(content: string, filename: string): string {
  const filenameLine = `filename: ${JSON.stringify(filename)}`;
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);

  if (!match) {
    return `---\n${filenameLine}\n---\n${content}`;
  }

  const bodyStart = match[0].length;
  const frontmatter = /^filename\s*:/m.test(match[2])
    ? match[2].replace(/^filename\s*:.*$/m, filenameLine)
    : `${filenameLine}\n${match[2]}`;

  return `${match[1]}${frontmatter}${match[3]}${content.slice(bodyStart)}`;
}

export function joinPath(basePath: string, filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\')) {
    return filePath;
  }
  return `${basePath.replace(/[\\/]+$/, '')}\\${filePath.replace(/^[\\/]+/, '')}`;
}

export function resolveMemoDocumentPath(
  notebookPath: string | undefined,
  memo: MemoItem,
  fallbackPath: string,
): string {
  if (!notebookPath || !memo.path) {
    return memo.path ?? fallbackPath;
  }

  return joinPath(notebookPath, memo.path);
}

export function findMemoById(
  state: Pick<MemoStore, 'memos' | 'selectedMemo'>,
  memoId: string | null | undefined,
): MemoItem | null {
  if (!memoId) return null;
  return state.memos.find((memo) => memo.id === memoId)
    ?? (state.selectedMemo?.id === memoId ? state.selectedMemo : null);
}

export function memoNeedsFilenameFinalize(
  notebookPath: string | null | undefined,
  memo: MemoItem | null,
  currentPath: string,
): boolean {
  if (!notebookPath || !memo?.path || !currentPath) {
    return false;
  }

  const targetPath = resolveMemoDocumentPath(notebookPath, memo, currentPath);
  return normalizePathForCompare(targetPath) !== normalizePathForCompare(currentPath);
}

