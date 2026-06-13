import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

import { hasDocumentUnsavedChanges } from '../../../../lib/store';
import { toast } from '../../../../lib/toast';
import { normalizePathForCompare } from './document-utils';

interface UseExternalDocumentChangeWatchOptions {
  filePath: string;
  selfWriteInFlightUntilRef: React.MutableRefObject<number>;
  clearSaveTimer: () => void;
  reloadDocument: (path: string, options?: { preservePending?: boolean; showLoading?: boolean }) => Promise<void>;
}

// Suppress repeat conflict warnings within this window — fs_watcher can
// fire several events for a single external write (multi-line edits,
// debounced editor saves from another app), and we do not want a toast
// storm.
const CONFLICT_WARNING_COOLDOWN_MS = 5000;

export function useExternalDocumentChangeWatch({
  filePath,
  selfWriteInFlightUntilRef,
  clearSaveTimer,
  reloadDocument,
}: UseExternalDocumentChangeWatchOptions) {
  // Last time we surfaced the "disk changed while you have unsaved edits"
  // warning. fs_watcher can emit multiple events for a single external
  // write; the cooldown collapses them into one toast.
  const lastConflictWarningAtRef = useRef(0);

  const maybeWarnAboutConflict = () => {
    if (!hasDocumentUnsavedChanges(filePath)) return;
    if (Date.now() - lastConflictWarningAtRef.current < CONFLICT_WARNING_COOLDOWN_MS) return;
    lastConflictWarningAtRef.current = Date.now();
    toast.warning('文档已被外部修改', {
      duration: 5000,
    });
  };

  useEffect(() => {
    if (!filePath) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    // Backend fs_watcher is the only source of truth for "this file on
    // disk just changed externally". When it fires, the disk has already
    // moved past our last-saved version — we do not need to re-read the
    // file to verify. A 3s self-write window (set in useDocumentAutosave
    // before each write) plus the backend's 2s mark_self_write_for TTL
    // and notify's 150ms debounce together cover our own writes, so any
    // event that survives the window is a real external change.
    listen<{ kind: 'updated'; id: string; path: string; source: string }>(
      'memo-event',
      async (event) => {
        if (disposed || !filePath) return;
        if (event.payload?.kind !== 'updated') return;
        if (!event.payload.path) return;

        if (Date.now() < selfWriteInFlightUntilRef.current) return;
        if (event.payload?.source === 'user_edit') return;

        const updatedPath = normalizePathForCompare(event.payload.path);
        const currentPath = normalizePathForCompare(filePath);
        if (updatedPath !== currentPath) return;

        if (hasDocumentUnsavedChanges(filePath)) {
          // Real divergence: external writer and user typing are about to
          // collide on the next save (CAS refusal). Warn so the user can
          // choose to copy their work elsewhere before the conflict
          // surfaces.
          maybeWarnAboutConflict();
          return;
        }

        // No local divergence — safe to drop the editor onto the fresh
        // disk version.
        clearSaveTimer();
        await reloadDocument(filePath, { preservePending: false, showLoading: false });
      }
    ).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    filePath,
    reloadDocument,
    clearSaveTimer,
    selfWriteInFlightUntilRef,
  ]);
}
