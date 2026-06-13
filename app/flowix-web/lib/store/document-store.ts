import { create } from 'zustand';
import { flushDocumentPath } from './document-session-service';

/**
 * Canonicalize a path the same way the buffer-registry does (forward
 * slash, collapsed runs). The document store normalizes on the way IN
 * so that `currentDocumentPath` is always the form the disk recognizes,
 * which means downstream code (filePath prop, reloadDocument, IPC
 * reads) all see one consistent path.
 *
 * Why here and not just in the registry: the store's currentDocumentPath
 * is what main-layout threads through to DocumentContainer as the
 * `filePath` prop. If we left the original (sometimes-backslash) form
 * in the store, the new DocumentContainer would mount with that bad
 * path, call reloadDocument on it, and the IPC read would return false
 * (no such file on disk).
 */
function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export type DocumentSource = 'memo' | 'external';

export interface MemoDocumentSession {
  id: string;
  memoId: string;
  path: string;
  notebookId: string | null;
  notebookPath: string | null;
  openedAt: number;
}

export interface ExternalDocumentSession {
  id: string;
  path: string;
  openedAt: number;
}

export type ActiveDocumentSession = MemoDocumentSession | ExternalDocumentSession;

export interface DocumentStore {
  currentDocumentPath: string | null;
  currentDocumentSource: DocumentSource | null;
  activeMemoSession: MemoDocumentSession | null;
  activeExternalSession: ExternalDocumentSession | null;
  openMemoDocument: (params: {
    memoId: string;
    path: string | null;
    notebookId?: string | null;
    notebookPath?: string | null;
  }) => Promise<void>;
  openExternalDocument: (path: string | null) => Promise<void>;
  clearDocument: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
//
// A document session transition has two phases, both owned by this store:
//   1. flush the outgoing document's pending edits to disk
//      (calls document-session-service.flushDocumentPath for the previous path)
//   2. commit the new session state via set(...)
//
// The flush awaits the save queue's chain — see save-queue.ts — so by
// the time set() runs, the outgoing document's last edit is on disk
// (or a CAS refusal toast has been surfaced). React then re-renders
// with the new session; useDocumentContent's reloadDocument effect
// reads the new path and re-hydrates the buffer.
//
// If there is no previous session (first open after launch), the flush
// is a no-op.
// ---------------------------------------------------------------------------

function documentState(path: string | null, source: DocumentSource | null) {
  return {
    currentDocumentPath: path,
    currentDocumentSource: path ? source : null,
    activeMemoSession: null,
    activeExternalSession: null,
  };
}

let transitionChain: Promise<void> = Promise.resolve();

function enqueueTransition<T>(work: () => Promise<T>): Promise<T> {
  const run = transitionChain.catch(() => undefined).then(work);
  transitionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const useDocumentStore = create<DocumentStore>()(
  (set, get) => ({
    currentDocumentPath: null,
    currentDocumentSource: null,
    activeMemoSession: null,
    activeExternalSession: null,
    openMemoDocument: async ({ memoId, path, notebookId = null, notebookPath = null }) => {
      const canonicalNewPath = path ? canonicalPath(path) : null;
      return enqueueTransition(async () => {
        const prevPath = get().currentDocumentPath;
        if (prevPath) {
          // Flush pending edits on the outgoing document before
          // committing the new session. All document transitions are
          // queued here, so rapid clicks cannot overlap flush/set phases.
          await flushDocumentPath(prevPath);
        }
        set(() => {
          if (!canonicalNewPath) return documentState(null, null);
          const openedAt = Date.now();
          return {
            currentDocumentPath: canonicalNewPath,
            currentDocumentSource: 'memo',
            activeMemoSession: {
              id: `memo:${memoId}`,
              memoId,
              path: canonicalNewPath,
              notebookId,
              notebookPath,
              openedAt,
            },
            activeExternalSession: null,
          };
        });
      });
    },
    openExternalDocument: async (path) => {
      const canonicalNewPath = path ? canonicalPath(path) : null;
      return enqueueTransition(async () => {
        const prevPath = get().currentDocumentPath;
        if (prevPath) {
          await flushDocumentPath(prevPath);
        }
        set(() => {
          if (!canonicalNewPath) return documentState(null, null);
          const openedAt = Date.now();
          return {
            currentDocumentPath: canonicalNewPath,
            currentDocumentSource: 'external',
            activeMemoSession: null,
            activeExternalSession: {
              id: `external:${canonicalNewPath}`,
              path: canonicalNewPath,
              openedAt,
            },
          };
        });
      });
    },
    clearDocument: async () => {
      return enqueueTransition(async () => {
        const prevPath = get().currentDocumentPath;
        if (prevPath) {
          await flushDocumentPath(prevPath);
        }
        set(documentState(null, null));
      });
    },
  })
);
