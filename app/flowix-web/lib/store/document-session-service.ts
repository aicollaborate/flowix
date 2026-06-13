import type { MutableRefObject } from 'react';

import {
  applyLoadedContent,
  flushDocument,
  getBuffer,
  getCurrentPath,
  getOrCreateBuffer,
  hasUnsavedLocalChanges,
  setCurrentPath,
  type FlushCallbacks,
} from './buffer-registry';
import type { DocumentBuffer } from './document-buffer';

const SELF_WRITE_SUPPRESSION_MS = 3000;

export interface DocumentDraftSnapshot {
  path: string;
  content: string;
}

export interface DocumentEditResult {
  changed: boolean;
  buffer: DocumentBuffer;
}

export interface SaveDocumentContentOptions {
  path: string;
  content: string;
  selfWriteInFlightUntilRef?: MutableRefObject<number>;
  callbacks?: FlushCallbacks;
}

export function getActiveDocumentDraft(): DocumentDraftSnapshot | null {
  const path = getCurrentPath();
  const buffer = path ? getBuffer(path) : undefined;
  if (!path || !buffer?.content) return null;
  return { path, content: buffer.content };
}

/**
 * 记录用户敲字产生的编辑。
 *
 * 行为不变量 ── 在双 Map 索引 (memoId / canonicalPath) 下, 物理 rename
 * 期间 memo 路径对应的 buffer 不会被换出, recordDocumentEdit 内部
 * 永远命中同一个 buffer object。race 自然消失, 不再需要 P1 修复 (O)
 * 那 3 层防御兜底。
 */
export function recordDocumentEdit(path: string, content: string): DocumentEditResult {
  const buffer = getOrCreateBuffer(path);
  if (content === buffer.lastSavedContent) {
    return { changed: false, buffer };
  }
  buffer.content = content;
  buffer.pendingContent = content;
  return { changed: true, buffer };
}

/**
 * 把 content 写盘。
 *
 * 跟 recordDocumentEdit 同形 ── buffer key 在双索引下永不漂移, 直接
 * getOrCreateBuffer 拿到当前 memo 对应的 buffer 即可。
 */
export async function saveDocumentContent({
  path,
  content,
  selfWriteInFlightUntilRef,
  callbacks,
}: SaveDocumentContentOptions): Promise<boolean> {
  if (!path) return true;
  const buffer = getOrCreateBuffer(path);

  if (selfWriteInFlightUntilRef) {
    selfWriteInFlightUntilRef.current = Date.now() + SELF_WRITE_SUPPRESSION_MS;
  }

  if (content !== buffer.content) {
    buffer.content = content;
    buffer.pendingContent = content;
  }

  return flushDocument(path, callbacks);
}

export function flushDocumentPath(path: string): Promise<boolean> {
  return flushDocument(path);
}

export function getDocumentBuffer(path: string): DocumentBuffer {
  return getOrCreateBuffer(path);
}

export function hasDocumentUnsavedChanges(path?: string): boolean {
  return hasUnsavedLocalChanges(path);
}

// 暴露 buffer-registry 内部的 "current path" 读取给 store 之外的调用方
// (例如 useDocumentAutosave 在 closure 落后于 currentPath 时需要兜底)。
// 不暴露 setCurrentPath ── 状态切换仍走 store / hook 的副作用路径。
export { getCurrentPath };

export function applyLoadedDocumentContent(
  path: string,
  fullContent: string,
  options?: { preservePending?: boolean },
): DocumentBuffer {
  return applyLoadedContent(path, fullContent, options);
}

export function setActiveDocumentPath(path: string | null): void {
  setCurrentPath(path);
}

// moveDocumentBuffer 取消 ── buffer-registry 双 Map 索引下, 物理 rename
// 期间 buffer 不会换出, 调用方 (useMemoEvents.syncActiveDocumentPathIfRenamed
// / useDocumentFinalize.finalizeMemoRename) 改为 IPC 写盘后只切
// active path, 不再需要搬 buffer。
