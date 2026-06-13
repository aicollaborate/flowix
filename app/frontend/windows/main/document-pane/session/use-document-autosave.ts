import { useCallback, useEffect, useRef } from 'react';

import {
  getActiveDocumentDraft,
  getDocumentBuffer,
  recordDocumentEdit,
  saveDocumentContent,
} from '../../../../lib/store';
import { toast } from '../../../../lib/toast';
import { formatDateTime } from '../../../../lib/utils';
import {
  countTextUnits,
  extractBodyContent,
} from './document-utils';

interface UseDocumentAutosaveOptions {
  filePath: string;
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
  reloadDocument: (path: string, options?: { preservePending?: boolean; showLoading?: boolean }) => Promise<void>;
  syncMemoMetadata: (content: string, refreshList: boolean) => void;
}

export function useDocumentAutosave({
  filePath,
  setState,
  reloadDocument,
  syncMemoMetadata,
}: UseDocumentAutosaveOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const selfWriteInFlightUntilRef = useRef<number>(0);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const saveDoc = useCallback(async (content: string, path: string, options?: { refreshList?: boolean }) => {
    if (!path) return;
    const refreshList = options?.refreshList ?? true;
    const buf = getDocumentBuffer(path);

    await saveDocumentContent({
      path,
      content,
      selfWriteInFlightUntilRef,
      callbacks: {
        onSaved: (writtenContent) => {
          const now = Date.now();
          if (isMountedRef.current) {
            setState(prev => ({
              ...prev,
              updatedAt: formatDateTime(now),
              updatedAtDate: new Date(now),
              error: null,
            }));
          }
          syncMemoMetadata(writtenContent, refreshList);
        },
        onCasRefused: (writtenContent) => {
          toast.error('保存失败：文档已被外部修改', {
            duration: 5000,
          });
          if (isMountedRef.current && buf.content === writtenContent && buf.pendingContent === null) {
            void reloadDocument(path, { preservePending: false, showLoading: false });
          }
        },
        onError: (_writtenContent, err) => {
          console.error('[DocumentContainer] Failed to save memo:', err);
          toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`, {
            duration: 5000,
          });
          if (isMountedRef.current) {
            setState(prev => ({ ...prev, error: '保存失败' }));
          }
        },
      },
    });
  }, [
    reloadDocument,
    setState,
    syncMemoMetadata,
  ]);

  const handleChange = useCallback((content: string) => {
    if (!filePath) return;
    const edit = recordDocumentEdit(filePath, content);
    if (!edit.changed) return;

    const body = extractBodyContent(content);
    const textUnits = countTextUnits(body);
    setState(prev => ({
      ...prev,
      fullContent: content,
      charCount: textUnits,
      tokenCount: Math.ceil(textUnits / 4),
    }));

    clearSaveTimer();
    const pathAtSchedule = filePath;
    saveTimerRef.current = setTimeout(() => {
      void saveDoc(content, pathAtSchedule);
    }, 1000);
  }, [
    filePath,
    clearSaveTimer,
    saveDoc,
    setState,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    const handleVisibilityChange = () => {
      const draft = getActiveDocumentDraft();
      if (document.hidden && draft) {
        clearSaveTimer();
        void saveDoc(draft.content, draft.path);
      }
    };

    const handleBeforeUnload = () => {
      const draft = getActiveDocumentDraft();
      if (draft) {
        void saveDoc(draft.content, draft.path);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      isMountedRef.current = false;
      clearSaveTimer();
    };
  }, [saveDoc, clearSaveTimer]);

  return {
    clearSaveTimer,
    handleChange,
    saveDoc,
    selfWriteInFlightUntilRef,
  };
}
