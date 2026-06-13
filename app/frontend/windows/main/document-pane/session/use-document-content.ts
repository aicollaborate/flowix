import { useCallback, useRef, useState } from 'react';

import { memos as memosClient } from '../../../../lib/tauri/client';
import { useMemoStore } from '../../../../lib/store';
import {
  setActiveDocumentPath,
  applyLoadedDocumentContent,
} from '../../../../lib/store';
import { formatDateTime } from '../../../../lib/utils';
import {
  initialDocumentContainerState,
  type DocumentContainerState,
  type LoadContentOptions,
} from './types';
import {
  countTextUnits,
  extractBodyContent,
  findMemoById,
} from './document-utils';

interface UseDocumentContentOptions {
  memoId: string | null;
  isExternalDocument: boolean;
}

function getMemoSnapshot(memoId: string | null | undefined) {
  return findMemoById(useMemoStore.getState(), memoId);
}

export function useDocumentContent({
  memoId,
  isExternalDocument,
}: UseDocumentContentOptions) {
  const [state, setState] = useState<DocumentContainerState>(initialDocumentContainerState);
  // Buffer state (content / lastSavedContent / pendingContent) lives in
  // the document session service now, not in this hook. We only track
  // UI state here (charCount, isLoading, etc.).
  //
  // Monotonic counter for the latest reloadDocument call. Stale IPC
  // reads compare against this and abort.
  const counter = useRef(0);

  const applyLoadedContent = useCallback(
    (path: string, fullContent: string, options?: Pick<LoadContentOptions, 'preservePending'>) => {
      const buf = applyLoadedDocumentContent(path, fullContent, { preservePending: options?.preservePending });
      const memo = isExternalDocument ? null : getMemoSnapshot(memoId);
      const createdAt = memo?.createdAt ? formatDateTime(memo.createdAt) : '';
      const updatedAt = memo?.updatedAt ? formatDateTime(memo.updatedAt) : '';
      const updatedAtDate = memo?.updatedAt ? new Date(memo.updatedAt) : null;
      const isFavorited = memo?.favorited || false;
      const isNew = fullContent.trimStart().startsWith('# ');
      const initialContent = buf.content;
      const initialBody = extractBodyContent(initialContent);
      const initialCharCount = countTextUnits(initialBody);

      setState({
        fullContent: initialContent,
        isLoading: false,
        error: null,
        isScrolled: false,
        isNewlyCreated: isNew,
        charCount: initialCharCount,
        tokenCount: Math.ceil(initialCharCount / 4),
        createdAt,
        updatedAt,
        updatedAtDate,
        isFavorited,
        frontmatterMeta: {},
      });
    },
    [isExternalDocument, memoId],
  );

  const reloadDocument = useCallback(
    async (path: string, options?: LoadContentOptions) => {
      if (!path) return;

      // Switch the active buffer up-front so any in-flight writes from
      // the previous document that resolve after this point still
      // target the right buffer.
      setActiveDocumentPath(path);
      const currentLoadId = ++counter.current;
      if (options?.showLoading ?? true) {
        setState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          isScrolled: false,
          isNewlyCreated: false,
        }));
      }

      try {
        const fullContent = await memosClient.readDocument(path);

        if (fullContent === null || fullContent === undefined) {
          setState((prev) => ({ ...prev, isLoading: false, error: '读取失败' }));
          return;
        }

        applyLoadedContent(path, fullContent, { preservePending: options?.preservePending });
      } catch (err) {
        if (currentLoadId !== counter.current) return;
        setState((prev) => ({ ...prev, isLoading: false, error: '读取失败' }));
      }
    },
    [applyLoadedContent],
  );

  return {
    state,
    setState,
    reloadDocument,
  };
}
