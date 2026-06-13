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

// fs_watcher 单次外部写入可能发多次事件 (FSEvents 双触发 + 编辑器
// debounce save), cooldown 收敛冲突警告避免 toast 风暴。
const CONFLICT_WARNING_COOLDOWN_MS = 5000;

export function useExternalDocumentChangeWatch({
  filePath,
  selfWriteInFlightUntilRef,
  clearSaveTimer,
  reloadDocument,
}: UseExternalDocumentChangeWatchOptions) {
  const lastConflictWarningAtRef = useRef(0);

  const maybeWarnAboutConflict = () => {
    if (!hasDocumentUnsavedChanges(filePath)) return;
    if (Date.now() - lastConflictWarningAtRef.current < CONFLICT_WARNING_COOLDOWN_MS) return;
    lastConflictWarningAtRef.current = Date.now();
    toast.warning('文档已被外部修改', { duration: 5000 });
  };

  useEffect(() => {
    if (!filePath) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    // 后端 fs_watcher 是"磁盘已变"的唯一信号源。3s self-write window
    // (useDocumentAutosave) + 后端 2s mark_self_write_for TTL + 150ms
    // 防抖三道闸, 漏过的事件即为真外部变更, 不需要再 readDocument 验证。
    listen<{ kind: 'updated'; id: string; path: string; source: string }>(
      'memo-event',
      async (event) => {
        if (disposed || !filePath) return;
        if (event.payload?.kind !== 'updated') return;
        if (!event.payload.path) return;

        if (Date.now() < selfWriteInFlightUntilRef.current) return;
        if (event.payload?.source === 'user_edit') return;

        // 匹配 emit path 跟当前 filePath ── 不一致说明物理 rename 了
        // (emit 用 list.json 新 path, filePath 是 React 状态可能未跟上)。
        // 这种情况由 useMemoEvents.syncActiveDocumentPathIfRenamed 全权
        // 处理 (切 active path + 同步 buffer), 本 hook 不再 reload, 避免
        // 重复 IPC + 重复 applyLoadedContent。
        const updatedPath = normalizePathForCompare(event.payload.path);
        const currentPath = normalizePathForCompare(filePath);
        if (updatedPath !== currentPath) return;

        if (hasDocumentUnsavedChanges(filePath)) {
          // 用户在敲字, 外部并发改盘 ── 提示冲突但不覆盖 (避免丢字符),
          // 让用户决定下一步 (继续编辑 / 手动复制 / 切走再切回)。
          maybeWarnAboutConflict();
          return;
        }

        // 无本地脏字符, 拉磁盘新内容覆盖编辑器。event.payload.path 此时
        // 等于 currentPath (上面已匹配), 用哪个都行 ── 用 filePath 跟原
        // 行为一致。
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
