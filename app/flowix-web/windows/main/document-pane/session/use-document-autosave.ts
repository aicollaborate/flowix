import { useCallback, useEffect, useRef } from 'react';

import { memos as memosClient } from '../../../../lib/tauri/client';
import {
  getActiveDocumentDraft,
  getDocumentBuffer,
  hasDocumentUnsavedChanges,
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
    if (!path) return;
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
          // 注: 历史上这里会调 `syncMemoMetadata(writtenContent, refreshList)`,
          // 由它发 `updateMemoDb` 二次同步 list.json 派生字段。后端整合后
          // `write_document` 写盘成功已自带派生同步 (`sync_derived_fields_for_memo`),
          // list.json 在写盘路径上单点保证一致, 不再需要前端二次同步。
          void writtenContent;
        },
        onCasRefused: (writtenContent) => {
          // [DEBUG] 打印关键状态: expected content (后端回写的 buf.lastSavedContent),
          // caller content (Tiptap 纯文本), buf.content / buf.lastSavedContent 全量。
          // ── 复现"保留你的修改" toast 时, 把这段 console.error 输出贴回来定位。
          console.error('[DEBUG onCasRefused] path:', path, {
            expectedContent: buf.lastSavedContent,
            expectedContentLength: buf.lastSavedContent.length,
            expectedContentHasFrontmatter: buf.lastSavedContent.startsWith('---'),
            callerContent: writtenContent,
            callerContentLength: writtenContent.length,
            callerContentHasFrontmatter: writtenContent.startsWith('---'),
            bufContent: buf.content,
            bufContentEqualsLastSaved: buf.content === buf.lastSavedContent,
            bufContentEqualsCaller: buf.content === writtenContent,
            stripEqual:
              writtenContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') ===
              buf.lastSavedContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''),
          });
          // CAS 拒绝: caller content 跟磁盘不一致, 必有外部改盘。
          // 不依赖 watcher 时序: 刚 set 的 3s self-write 窗口会把 fs_watcher
          // emit 吞掉, 不在这里主动拉的话, 编辑器视图会卡在 "自己敲错
          // 的版本 + toast 提示被外部改" 但磁盘内容不可见。
          //
          // 策略: 主动 re-read 磁盘, 分情况处理 ──
          //   1. 磁盘 == caller content: 仅是 frontmatter 派生差异
          //      (产品 write_document 重写 frontmatter), 强制
          //      reloadDocument 让 React state 跟磁盘对齐
          //   2. 磁盘 != caller content: 真正的并发冲突, **不覆盖**
          //      用户字符, 只 toast 提示 + 把 buf 对齐磁盘
          //      lastSavedContent, 让用户决定下一步
          //
          // 历史 BUG: 旧判断 buf.pendingContent === null 在 CAS 拒绝
          // 路径永远 false, reloadDocument 永远不被调, 用户看到
          // "toast + 编辑器不动" 的卡死态。
          if (!isMountedRef.current) {
            toast.error('保存失败：文档已被外部修改', { duration: 5000 });
            return;
          }
          buf.pendingContent = null;
          void (async () => {
            const onDisk = await memosClient.readDocument(path).catch(() => null);
            // [DEBUG] 打印后端 readDocument 返回的实际磁盘内容 (含 frontmatter)。
            // 对比 expected / caller / onDisk 三者, 看清是哪两者不等导致走到哪个 toast 分支。
            console.error('[DEBUG onCasRefused] onDisk read back:', {
              onDisk,
              onDiskLength: onDisk?.length ?? null,
              onDiskHasFrontmatter: onDisk?.startsWith('---') ?? null,
              onDiskEqualsExpected: onDisk === buf.lastSavedContent,
              onDiskEqualsCaller: onDisk === writtenContent,
            });
            if (!isMountedRef.current) return;
            if (onDisk === null || onDisk === writtenContent) {
              // 磁盘空 / 磁盘等于 caller content: 走 reload 让
              // React state 跟磁盘对齐 (处理 frontmatter 派生差异)
              void reloadDocument(path, { preservePending: false, showLoading: false });
              toast.error('保存失败：文档已被外部修改 — 已自动同步磁盘最新内容', {
                duration: 5000,
              });
            } else {
              // 真正冲突: 把磁盘内容塞到 lastSavedContent, 下次
              // 用户保存会用磁盘作为 expected, 避免反复撞。
              buf.lastSavedContent = onDisk;
              toast.error('保存失败：文档已被外部修改 — 保留你的修改，请检查外部改动后再保存', {
                duration: 5000,
              });
            }
          })();
          void writtenContent;
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
  // visibilitychange 强保存的 disk-aware 版本 ── 设计动机见 hook 顶部注释。
  // 跟 onCasRefused 的 "清 pendingContent + reloadDocument" 路径同一语义,
  // 只是触发点换成 "切走前"。定义在 saveDoc 之后, 因为内部要引用 saveDoc。
  const maybeSaveOrReloadOnHide = useCallback(async (content: string, path: string) => {
    if (!path) return;
    // 1. 拉磁盘看是否变了
    let onDisk: string | null = null;
    try {
      onDisk = await memosClient.readDocument(path);
    } catch {
      // IPC 失败: 保守走 saveDoc, 让原 onCasRefused 兜底 (弹 toast + 拉新)
      void saveDoc(content, path);
      return;
    }
    if (onDisk === null) {
      void saveDoc(content, path);
      return;
    }
    const buf = getDocumentBuffer(path);
    // 2. 磁盘跟 lastSavedContent 一致 ── 没人改过盘, 走 saveDoc
    if (onDisk === buf.lastSavedContent) {
      void saveDoc(content, path);
      return;
    }
    // 3. 磁盘变了 ── 放弃 save, 直接把磁盘内容覆盖到 buf + 编辑器
    // (跟 watcher 走 reloadDocument 等价, 但在切走时主动做, 不依赖
    // fs_watcher emit 时序)
    if (!isMountedRef.current) return;
    if (hasDocumentUnsavedChanges(path)) {
      // 用户有本地未保存改动 + 磁盘被外部改 ── 提示冲突, 不覆盖
      toast.warning('文档已被外部修改', { duration: 5000 });
      return;
    }
    // 磁盘变了 + 无本地未保存 ── 走 reloadDocument 拉新 (跟 watcher
    // 走 reloadDocument 等价, 主动做不依赖 fs_watcher emit 时序)。
    // reloadDocument 内部 applyLoadedContent 会把 buf 跟 React state
    // 一起对齐到磁盘, 这里不用手动改 buf。
    void reloadDocument(path, { preservePending: false, showLoading: false });
  }, [saveDoc, reloadDocument]);



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

    // 切走 (document.hidden=true) 时的强保存 ── 跟 1s debounce 抢跑。
    // 先 disk-check: 磁盘已被外部改 (vscode / Agent) 时, saveDoc 必 CAS
    // 拒绝弹 "已被外部修改" 但用户其实没敲字, toast 无意义; 不如直接放弃
    // save, 让 watcher 后续 emit 走 reloadDocument 拉新 ── 用户切回时
    // 看到的编辑器是磁盘最新内容, 不会撞 CAS。
    //
    // 注: 这里 readDocument 是唯一一次主动 re-read, 正常 flow (用户没切
    // 走) 不走这条路径, 不会浪费 IPC。
    const handleVisibilityChange = () => {
      const draft = getActiveDocumentDraft();
      if (!(document.hidden && draft)) return;
      clearSaveTimer();
      void maybeSaveOrReloadOnHide(draft.content, draft.path);
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
  }, [saveDoc, clearSaveTimer, maybeSaveOrReloadOnHide]);

  return {
    clearSaveTimer,
    handleChange,
    maybeSaveOrReloadOnHide,
    saveDoc,
    selfWriteInFlightUntilRef,
  };
}
