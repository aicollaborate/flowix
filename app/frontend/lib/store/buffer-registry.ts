/**
 * Buffer registry — module-singleton owner of the per-path document
 * buffers and the "current path" pointer.
 *
 * Why this lives outside React
 * ----------------------------
 * The buffer (content / lastSavedContent / pendingContent) is mutated
 * synchronously on every keystroke. If it lived in React state or
 * zustand state, every keystroke would trigger a re-render of every
 * subscriber. By keeping it as a module-level mutable Map, keystrokes
 * are O(1) and re-render-free; React state only tracks UI concerns
 * (charCount, isLoading, etc.).
 *
 * Why this lives outside any single hook
 * --------------------------------------
 * Multiple hooks need to read/write the same buffer (useDocumentContent
 * on load, useDocumentAutosave on every keystroke and on save, etc.).
 * Passing the buffer as a ref through component props is fragile
 * (forwarded through every consumer, easy to forget a useEffect
 * dependency). Having a single registry means the buffer is global to
 * the document-pane module — the same one DocumentContainer is the
 * sole user of.
 *
 * Why the store calls into this directly
 * ---------------------------------------
 * The document store previously exposed a Set<DocumentSessionCloser>
 * that hooks registered into. That required every consumer to
 * register/unregister in a useEffect, with all the timing caveats
 * that implies. By owning the buffer + flush logic here, the store
 * can simply call `await flushDocument(prev.path)` directly inside
 * its session-transition action. No more registration, no more
 * commit-phase races.
 *
 * Why path normalization at the boundary
 * --------------------------------------
 * The same file can be referenced by multiple distinct path strings
 * (e.g. forward-slash vs backslash separators depending on which code
 * path produced the string — Rust's `format!` sometimes inserts `\\`,
 * JS joins use `/`). The buffer Map used the raw path as its key, so
 * two path forms for the same file produced two distinct buffer
 * entries. The save queue would look up one form, find an empty
 * buffer, no-op, and the user's edits sat in the orphaned buffer
 * until the next reload clobbered them.
 *
 * Fix: every entry point normalizes the input path to a canonical form
 * (forward-slash, collapsed //). The Map is keyed on the canonical
 * form, and the IPC receives the canonical form so the backend writes
 * to the same on-disk file the user expects.
 */
import { scheduleSave } from './save-queue';
import { emptyDocumentBuffer, type DocumentBuffer } from './document-buffer';

/**
 * Canonical form of a path. On Mac/Linux the on-disk separator is `/`,
 * so we convert any `\` to `/` and collapse runs. Case is preserved
 * (Mac filesystems are case-sensitive by default, unlike Windows).
 */
function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

const buffers = new Map<string, DocumentBuffer>();
let currentPath: string | null = null;
let currentBuffer: DocumentBuffer = emptyDocumentBuffer();

/** The path currently "active" — the one keystrokes will save. */
export function getCurrentPath(): string | null {
  return currentPath;
}

/** The buffer for the currently active path. */
export function getCurrentBuffer(): DocumentBuffer {
  return currentBuffer;
}

/** The buffer for an arbitrary path (used by external-change watcher). */
export function getBuffer(path: string): DocumentBuffer | undefined {
  return buffers.get(canonicalPath(path));
}

/** The buffer for an arbitrary path, allocating one if needed. */
export function getOrCreateBuffer(path: string): DocumentBuffer {
  const key = canonicalPath(path);
  let buf = buffers.get(key);
  if (!buf) {
    buf = emptyDocumentBuffer();
    buffers.set(key, buf);
  }
  return buf;
}

/**
 * Switch the active path. Allocates a fresh buffer if the path has
 * never been seen; otherwise reuses the existing buffer so that any
 * pending edits survive a switch away and back.
 */
export function setCurrentPath(path: string | null): void {
  if (path === null) {
    currentPath = null;
    currentBuffer = emptyDocumentBuffer();
    return;
  }
  const key = canonicalPath(path);
  if (key === currentPath) return;
  currentPath = key;
  let buf = buffers.get(key);
  if (!buf) {
    buf = emptyDocumentBuffer();
    buffers.set(key, buf);
  }
  currentBuffer = buf;
}

/**
 * True if the buffer at `path` (or the current path) has unsaved local
 * edits. Used by the external-change watcher to decide whether an
 * external file change is safe to silently apply.
 */
export function hasUnsavedLocalChanges(path?: string): boolean {
  const target = path ? canonicalPath(path) : currentPath;
  if (!target) return false;
  const buf = buffers.get(target);
  if (!buf) return false;
  return buf.content !== buf.lastSavedContent;
}

/**
 * Apply freshly-loaded content to the buffer for `path`. If
 * `preservePending` is true and the buffer already has a pending edit,
 * the pending edit wins (so a fast switch away and back doesn't lose
 * the user's in-flight typing).
 */
export function applyLoadedContent(
  path: string,
  fullContent: string,
  options?: { preservePending?: boolean },
): DocumentBuffer {
  setCurrentPath(path);
  const buf = currentBuffer;
  const initialContent = options?.preservePending
    ? (buf.pendingContent ?? fullContent)
    : fullContent;
  buf.content = initialContent;
  buf.lastSavedContent = fullContent;
  if (!options?.preservePending) {
    buf.pendingContent = null;
  }
  return buf;
}

/**
 * Drop the buffer for a path. Called by the external-change watcher
 * when the disk version no longer matches the cached buffer, so the
 * next load reads fresh state.
 */
export function dropBuffer(path: string): void {
  const key = canonicalPath(path);
  buffers.delete(key);
  if (currentPath === key) {
    currentPath = null;
    currentBuffer = emptyDocumentBuffer();
  }
}

/**
 * Move a buffer after a memo file is renamed. This keeps the saved
 * content version attached to the new path, so later saves do not CAS
 * against an empty or stale buffer.
 */
export function moveBuffer(oldPath: string, newPath: string): DocumentBuffer {
  const oldKey = canonicalPath(oldPath);
  const newKey = canonicalPath(newPath);
  const buf = buffers.get(oldKey) ?? emptyDocumentBuffer();
  buffers.set(newKey, buf);
  if (oldKey !== newKey) {
    buffers.delete(oldKey);
  }
  if (currentPath === oldKey) {
    currentPath = newKey;
    currentBuffer = buf;
  }
  return buf;
}

export interface FlushCallbacks {
  /** Called after a successful IPC. The buffer has already been updated. */
  onSaved?: (content: string) => void;
  /** Called on CAS refusal. */
  onCasRefused?: (content: string) => void;
  /** Called on transport / IPC error. */
  onError?: (content: string, err: unknown) => void;
}

/**
 * Flush any pending edits for the given path through the save queue.
 * Returns true if the buffer is on disk (either was already, or the
 * save succeeded), false if the save was CAS-refused or errored.
 *
 * No-op (returns true) when:
 *   - path has no buffer (e.g. never loaded, or already dropped)
 *   - buffer is already in sync with disk
 *
 * The save queue handles coalescing with any in-flight or pending save
 * for the same path. Multiple flushes called close together resolve
 * into a single chain of IPCs — see save-queue.ts for details.
 *
 * Path normalization: the input `path` is canonicalized before buffer
 * lookup and before being passed to the IPC, so callers that pass
 * different string forms of the same file (e.g. forward-slash from
 * joinNotebookMemoPath vs backslash from a Rust-side format!) all
 * hit the same buffer and write to the same on-disk file.
 */
export async function flushDocument(
  path: string,
  callbacks?: FlushCallbacks,
): Promise<boolean> {
  const key = canonicalPath(path);
  const buf = buffers.get(key);
  if (!buf) return true;
  if (buf.content === buf.lastSavedContent) {
    return true;
  }

  return scheduleSave({
    path: key,
    readExpected: () => buf.lastSavedContent,
    onSaved: (written) => {
      buf.lastSavedContent = written;
      if (buf.content === written) {
        buf.pendingContent = null;
      } else if (buf.pendingContent === written) {
        buf.pendingContent = null;
      }
      callbacks?.onSaved?.(written);
    },
    onCasRefused: (written) => {
      callbacks?.onCasRefused?.(written);
    },
    onError: (written, err) => {
      callbacks?.onError?.(written, err);
    },
  }, buf.content);
}
