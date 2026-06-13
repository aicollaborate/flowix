import { useCallback, useEffect, useRef } from 'react';

import {
  getActiveDocumentDraft,
  getCurrentPath,
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
}

export function useDocumentAutosave({
  filePath,
  setState,
  reloadDocument,
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

  const saveDoc = useCallback(async (content: string, path: string) => {
    // 防御: caller 传进来的 path 可能落后于 buffer-registry 当前的
    // currentPath (例如 useMemoEvents 异步链跑完后, 旧 path 的 buffer
    // 已被 moveBuffer delete)。Fallback 到 currentPath, 跟 handleChange
    // 的兜底逻辑保持一致 ── 整个写盘链路使用同一个 path 来源, 避免
    // record / flush / reload 三处 path 不一致引发 "文件已被外部修改"
    // 误报。
    const writePath = getCurrentPath() ?? path;
    if (!writePath) return;
    const buf = getDocumentBuffer(writePath);

    await saveDocumentContent({
      path: writePath,
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
          // 注: 历史上这里会调 `syncMemoMetadata(writtenContent, refreshList)`,
          // 由它发 `updateMemoDb` 二次同步 list.json 派生字段。后端整合后
          // `write_document` 写盘成功已自带派生同步 (`sync_derived_fields_for_memo`),
          // list.json 在写盘路径上单点保证一致, 不再需要前端二次同步。
          //
          // `useMemoMetadataSync` hook 与 `syncMemoMetadata` 入参保留作为兜底
          // 入口 (例如外部工具改盘的场景) ── 接入方应自己判断是否调用, 默认
          // 路径不再走这里。
          void writtenContent;
        },
        onCasRefused: (writtenContent) => {
          toast.error('保存失败：文档已被外部修改', {
            duration: 5000,
          });
          if (isMountedRef.current && buf.content === writtenContent && buf.pendingContent === null) {
            // reloadDocument 用 currentPath ── 如果用户已经切到别的 memo,
            // 不要在旧 memo 的 hook 里 reload 旧 path 的内容 (会污染新
            // memo 的 buffer)。getCurrentPath() 拿到的就是用户当前看的 path。
            const reloadPath = getCurrentPath() ?? path;
            void reloadDocument(reloadPath, { preservePending: false, showLoading: false });
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
  ]);

  const handleChange = useCallback((content: string) => {
    // 防御: closure 捕获的 filePath 可能落后于 buffer-registry 当前的
    // currentPath (例如 syncActiveDocumentPathIfRenamed 异步链尚未完成
    // 的窗口期用户敲字, 这时旧 key 已被 moveBuffer delete, 新 key
    // 已在 map 里)。getCurrentPath() 始终是 buffer-registry 内部的最新值,
    // 用它作 recordDocumentEdit 的目标 key, 避免给已搬走的旧 key 创建
    // 新的空 buffer ── 那是 "保存失败: 文档已被外部修改" 的直接成因。
    const writePath = getCurrentPath() ?? filePath;
    if (!writePath) return;
    const edit = recordDocumentEdit(writePath, content);
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
    // 1s debounce 期间 buffer-registry 的 currentPath 可能再变 (例如
    // rename 异步链跑完 openMemoDocument 切了 currentPath)。timer 触发
    // 时再次取 currentPath, 而不是闭包到 schedule 时的 writePath,
    // 避免写到旧 path 的孤儿 buffer 上。
    saveTimerRef.current = setTimeout(() => {
      const pathAtFire = getCurrentPath() ?? writePath;
      void saveDoc(content, pathAtFire);
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
