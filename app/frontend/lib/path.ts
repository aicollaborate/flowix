/**
 * Cross-platform path utilities for joining notebook and memo paths.
 * On Mac/Linux, uses forward slashes; on Windows, handles both \\ and /.
 */

export function joinNotebookMemoPath(notebookPath: string, memoPath: string | null | undefined): string | null {
  if (!memoPath) return null;

  // Remove trailing slashes from notebook path
  const cleanNotebook = notebookPath.replace(/[\\/]+$/, '');
  // Remove leading slashes from memo path
  const cleanMemo = memoPath.replace(/^[\\/]+/, '');

  // Use forward slash as separator - works on all platforms
  return `${cleanNotebook}/${cleanMemo}`;
}

const MEMO_ID_FILENAME_PATTERN = /#([0-9a-z]{6})\.md$/i;

export function generateMemoFilename(title: string, memoId: string): string {
  const base = title.length > 0
    ? title
    : `untitled-${new Date().toLocaleDateString('en-CA')}`;

  return `${base}#${memoId}.md`;
}

export function extractMemoIdFromPath(path: string): string | null {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const match = fileName.match(MEMO_ID_FILENAME_PATTERN);
  return match?.[1] ?? null;
}

export function getDocumentInstanceKey(path: string): string {
  const memoId = extractMemoIdFromPath(path);
  return memoId ? `memo:${memoId}` : `path:${path}`;
}

export function isWindowsPlatform(): boolean {
  return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}
