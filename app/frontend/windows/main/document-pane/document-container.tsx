'use client';

import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useDocumentStore, useMemoStore } from '../../../lib/store';
import { ComnTiptapEditor } from '../../../components/mdeditor/comn-tiptap-editor';
import { getDocumentInstanceKey } from '../../../lib/path';
import {
  initialDocumentContainerState,
  type DocumentContainerProps,
} from './session/types';
import {
  findMemoById,
} from './session/document-utils';
import { useDocumentContent } from './session/use-document-content';
import { useMemoMetadataSync } from './session/use-memo-metadata-sync';
import { useDocumentAutosave } from './session/use-document-autosave';
import { useDocumentFinalize } from './session/use-document-finalize';
import { useExternalDocumentChangeWatch } from './session/use-external-document-change-watch';
import { useExternalDocumentImport } from './session/use-external-document-import';
import backgroundImage from '../../../assets/bg.document.png';

export function DocumentContainer({
  filePath,
  memoId = null,
  notebookId = null,
  notebookPath = null,
  onMetainfoData,
  onCharCountChange,
  isExternalDocument = false,
  searchPanelOpen = false,
  onSearchPanelOpenChange,
  toolbarCollapsed = false,
  onToolbarCollapsedChange,
  onExternalImportApiChange,
}: DocumentContainerProps) {
  const documentInstanceKey = useMemo(
    () => memoId ? `memo:${memoId}` : getDocumentInstanceKey(filePath),
    [filePath, memoId]
  );
  const loadedDocumentInstanceKeyRef = useRef<string | null>(null);
  const { selectedNotebook, setSelectedMemo, loadMemos, upsertMemo } = useMemoStore();
  const activeMemo = useMemoStore(useCallback((store) => {
    return findMemoById(store, memoId);
  }, [memoId]));
  const openMemoDocument = useDocumentStore((store) => store.openMemoDocument);
  const {
    state,
    setState,
    reloadDocument,
  } = useDocumentContent({ memoId, isExternalDocument });

  // `useMemoMetadataSync` 在后端整合前是 `onSaved` 回调里调 `syncMemoMetadata`
  // 的来源 ── 现在 `useDocumentAutosave.onSaved` 不再需要它, 解构丢弃即可。
  // hook 本身保留作为外部场景 (例如外部工具改盘后业务方主动同步) 的兜底
  // 入口; 默认路径不调。
  useMemoMetadataSync({ memoId, isExternalDocument, upsertMemo });
  const {
    clearSaveTimer,
    handleChange,
    saveDoc,
    selfWriteInFlightUntilRef,
  } = useDocumentAutosave({
    filePath,
    setState,
    reloadDocument,
  });
  const { finalizeMemoRename } = useDocumentFinalize({
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
  });
  const setDocumentError = useCallback((message: string) => {
    setState(prev => ({ ...prev, error: message }));
  }, [setState]);
  const {
    isImportingExternal,
    handleSaveExternalToMemo,
  } = useExternalDocumentImport({
    filePath,
    isExternalDocument,
    selectedNotebook,
    clearSaveTimer,
    saveDoc,
    setSelectedMemo,
    loadMemos,
    openMemoDocument,
    setError: setDocumentError,
  });

  // Publish the external-import api upward so the titlebar (rendered as a
  // sibling above the content area) can show the file path and the save
  // button. Memoize to keep referential equality stable across unrelated
  // re-renders — the parent only re-runs its effect when isSaving flips.
  const externalImportApi = useMemo(
    () => (isExternalDocument
      ? { isSaving: isImportingExternal, save: handleSaveExternalToMemo }
      : null),
    [isExternalDocument, isImportingExternal, handleSaveExternalToMemo],
  );
  useEffect(() => {
    onExternalImportApiChange?.(externalImportApi);
  }, [externalImportApi, onExternalImportApiChange]);
  useEffect(() => {
    return () => onExternalImportApiChange?.(null);
  }, [onExternalImportApiChange]);

  useEffect(() => {
    const handleNavigateToMemo = async (e: Event) => {
      const customEvent = e as CustomEvent<{ memoId: string }>;
      const targetMemoId = customEvent.detail?.memoId;
      if (targetMemoId) {
        const { memos } = useMemoStore.getState();
        const memo = memos.find(m => m.id === targetMemoId);
        if (memo?.path) {
          // Navigate by path - handled by parent component
          window.location.hash = `/memo/${memo.id}`;
        }
      }
    };

    document.addEventListener('navigate-to-memo', handleNavigateToMemo);
    return () => {
      document.removeEventListener('navigate-to-memo', handleNavigateToMemo);
    };
  }, []);

  useEffect(() => {
    if (!filePath) {
      setState(initialDocumentContainerState);
      return;
    }

    const loadedDocumentInstanceKey = loadedDocumentInstanceKeyRef.current;
    loadedDocumentInstanceKeyRef.current = documentInstanceKey;

    // A memo rename changes only the path. Keep the editor instance and content
    // intact when the stable memo id still points to the same document.
    if (loadedDocumentInstanceKey === documentInstanceKey) {
      return;
    }

    // Switching to a different document must not carry the previous document's
    // unsaved editor snapshot into the new load. The buffer for the new path
    // was just (re)allocated inside reloadDocument -> setActiveDocumentPath, so its
    // pendingContent is already null. clearSaveTimer is a defensive sweep
    // for any stray timer from the previous document.
    clearSaveTimer();

    reloadDocument(filePath, { preservePending: false, showLoading: true });
  }, [filePath, documentInstanceKey, reloadDocument, clearSaveTimer]);

  useExternalDocumentChangeWatch({
    filePath,
    selfWriteInFlightUntilRef,
    clearSaveTimer,
    reloadDocument,
  });

  const metaInfo = useMemo(() => {
    return {
      charCount: state.charCount,
      tokenCount: state.tokenCount,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      memoPath: memoId ?? null,
      memoContent: state.fullContent,
      isFavorited: state.isFavorited,
      frontmatterMeta: state.frontmatterMeta,
    };
  }, [state.charCount, state.tokenCount, state.createdAt, state.updatedAt, state.fullContent, state.isFavorited, state.frontmatterMeta, memoId]);

  useEffect(() => {
    if (filePath) {
      onMetainfoData?.(metaInfo);
      onCharCountChange?.(state.charCount);
    }
  }, [filePath, metaInfo, onMetainfoData, onCharCountChange, state.charCount]);

  if (!filePath) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-no-repeat bg-bottom bg-[length:auto_800px] opacity-[0.32]"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
        <span className="relative text-center text-[var(--muted-foreground)] text-sm">
          请选择一个文档
        </span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted-foreground)] text-sm">
        {state.error}
      </div>
    );
  }

  return (
    <div className="h-full w-full min-w-0 flex flex-col bg-transparent relative overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {state.fullContent && (
          <ComnTiptapEditor
            key={documentInstanceKey}
            content={state.fullContent}
            onChange={(content) => {
              handleChange(content);
              if (state.isNewlyCreated) setState(prev => ({ ...prev, isNewlyCreated: false }));
            }}
            placeholder="请输入 Memo..."
            className=""
            onEditorScroll={(scrollTop) => setState(prev => ({ ...prev, isScrolled: scrollTop > 90 }))}
            onEditingFinished={finalizeMemoRename}
            autoFocus={state.isNewlyCreated}
            editorStorageUpdatedAt={state.updatedAtDate ?? (activeMemo?.updatedAt ? new Date(activeMemo.updatedAt) : null)}
            searchPanelOpen={searchPanelOpen}
            onSearchPanelOpenChange={onSearchPanelOpenChange}
            toolbarCollapsed={toolbarCollapsed}
            onToolbarCollapsedChange={onToolbarCollapsedChange}
          />
        )}
      </div>
    </div>
  );
}
