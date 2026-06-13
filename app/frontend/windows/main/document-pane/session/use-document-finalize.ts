import { useCallback, useEffect, useRef } from 'react';

import { memos as memosClient } from '../../../../lib/tauri/client';
import {
  getDocumentBuffer,
  moveDocumentBuffer,
  setActiveDocumentPath,
  type MemoItem,
  useDocumentStore,
  useMemoStore,
} from '../../../../lib/store';
import {
  findMemoById,
  joinPath,
  memoNeedsFilenameFinalize,
  normalizePathForCompare,
  upsertFilenameFrontmatter,
} from './document-utils';

interface UseDocumentFinalizeOptions {
  filePath: string;
  memoId: string | null;
  notebookId: string | null;
  notebookPath: string | null;
  isExternalDocument: boolean;
  clearSaveTimer: () => void;
  saveDoc: (content: string, path: string, options?: { refreshList?: boolean }) => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<{
    fullContent: string;
    isLoading: boolean;
    error: string | null;
    isScrolled: boolean;
    isNewlyCreated: boolean;
    charCount: number;
    tokenCount: number;
    createdAt: string;
    updatedAt: string;
    updatedAtDate: Date | null;
    isFavorited: boolean;
    frontmatterMeta: Record<string, unknown>;
  }>>;
  upsertMemo: (memo: MemoItem) => void;
  openMemoDocument: (params: {
    memoId: string;
    path: string | null;
    notebookId?: string | null;
    notebookPath?: string | null;
  }) => Promise<void>;
}

function getMemoSnapshot(memoId: string | null | undefined): MemoItem | null {
  return findMemoById(useMemoStore.getState(), memoId);
}

export function useDocumentFinalize({
  filePath,
  memoId,
  notebookId,
  notebookPath,
  isExternalDocument,
  clearSaveTimer,
  saveDoc,
  setState,
  upsertMemo,
  openMemoDocument,
}: UseDocumentFinalizeOptions) {
  const finalizeMemoRenameRef = useRef<(() => void) | null>(null);
  const finalizeInFlightRef = useRef<Promise<void> | null>(null);

  const finalizeMemoRename = useCallback(async (options?: {
    updateEditorState?: boolean;
    refreshList?: boolean;
  }) => {
    if (finalizeInFlightRef.current) {
      await finalizeInFlightRef.current;
      return;
    }

    const run = (async () => {
      if (!memoId || isExternalDocument || !notebookPath || !filePath) return;

      const updateEditorState = options?.updateEditorState ?? true;
      const refreshList = options?.refreshList ?? true;
      const memoSnapshot = getMemoSnapshot(memoId);
      const path = filePath;
      const buf = getDocumentBuffer(path);
      const content = buf.content;

      if (!content) return;

      const hasContentChanges = content !== buf.lastSavedContent;
      const needsFilenameFinalize = memoNeedsFilenameFinalize(
        notebookPath,
        memoSnapshot,
        path,
      );

      if (!hasContentChanges && !needsFilenameFinalize) return;

      clearSaveTimer();

      if (hasContentChanges) {
        await saveDoc(content, path);
      }

      if (!needsFilenameFinalize) return;

      const didFinalize = await memosClient.finalizeMemoFilename(memoId);
      if (!didFinalize) return;

      const latestMemo = await memosClient.readMemo(memoId) as MemoItem | null;
      const finalFilename = latestMemo?.filename || memoSnapshot?.filename;
      if (!finalFilename) return;

      if (latestMemo && refreshList) {
        upsertMemo(latestMemo);
      }

      const nextPath = latestMemo?.path
        ? joinPath(notebookPath, latestMemo.path)
        : path;
      const diskContent = await memosClient.readDocument(nextPath).catch(() => null);
      const finalizedContent = diskContent ?? upsertFilenameFrontmatter(buf.content, finalFilename);

      moveDocumentBuffer(path, nextPath, finalizedContent);

      const documentState = useDocumentStore.getState();
      const stillActiveMemo =
        documentState.activeMemoSession?.memoId === memoId &&
        normalizePathForCompare(documentState.currentDocumentPath ?? '') === normalizePathForCompare(path);

      if (!updateEditorState || !stillActiveMemo) return;

      setState(prev => ({
        ...prev,
        fullContent: prev.fullContent === content ? finalizedContent : prev.fullContent,
      }));

      setActiveDocumentPath(nextPath);
      await openMemoDocument({
        memoId,
        path: nextPath,
        notebookId,
        notebookPath,
      });
    })();

    finalizeInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (finalizeInFlightRef.current === run) {
        finalizeInFlightRef.current = null;
      }
    }
  }, [
    filePath,
    memoId,
    notebookId,
    notebookPath,
    isExternalDocument,
    clearSaveTimer,
    openMemoDocument,
    saveDoc,
    setState,
    upsertMemo,
  ]);

  useEffect(() => {
    finalizeMemoRenameRef.current = () => {
      void finalizeMemoRename({ updateEditorState: false, refreshList: false });
    };
  }, [finalizeMemoRename]);

  useEffect(() => {
    return () => {
      finalizeMemoRenameRef.current?.();
    };
  }, []);

  return { finalizeMemoRename };
}
