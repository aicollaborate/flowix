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

export function isWindowsPlatform(): boolean {
  return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}
