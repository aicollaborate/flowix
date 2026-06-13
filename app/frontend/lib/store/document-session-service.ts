import type { MutableRefObject } from 'react';

import {
  applyLoadedContent,
  flushDocument,
  getBuffer,
  getCurrentPath,
  getOrCreateBuffer,
  hasUnsavedLocalChanges,
  moveBuffer,
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

export function recordDocumentEdit(path: string, content: string): DocumentEditResult {
  // 防御: path 对应的 buffer 已被搬走时 (例如 useMemoEvents 在
  // syncActiveDocumentPathIfRenamed IPC 异步期间触发 moveDocumentBuffer),
  // 不要创建新的空 buffer 给旧 key ── 旧 key 上的 content 会变成
  // "内容 = user content, lastSavedContent = 空串", 下次 saveDoc 拿空
  // expected 发 IPC, 触发后端 fs::read_to_string 报错 (旧路径已 rename
  // 走) → CAS refused。Fallback 到 currentPath 的 buffer: 编辑器
  // 显示的就是 currentPath 对应的磁盘内容, 用户敲字落到正确的 buffer 上。
  let buffer = getBuffer(path);
  if (!buffer) {
    const fallbackPath = getCurrentPath();
    if (fallbackPath) {
      buffer = getBuffer(fallbackPath);
    }
  }
  if (!buffer) {
    // 真没 buffer (例如新文档未加载完的极小窗口), 创建并返回。保留这条
    // fallback 是因为 recordDocumentEdit 在 reload 完成前被 onUpdate 调用
    // 的窗口期也需要写 buffer (罕见, 但要安全)。
    buffer = getOrCreateBuffer(path);
  }
  if (content === buffer.lastSavedContent) {
    return { changed: false, buffer };
  }
  buffer.content = content;
  buffer.pendingContent = content;
  return { changed: true, buffer };
}

export async function saveDocumentContent({
  path,
  content,
  selfWriteInFlightUntilRef,
  callbacks,
}: SaveDocumentContentOptions): Promise<boolean> {
  if (!path) return true;
  // 防御: 跟 recordDocumentEdit 同形 ── path 对应 buffer 已被搬走时
  // fallback 到 currentPath 的 buffer, 避免 "新空 buffer + 空
  // lastSavedContent" 触发下一次 CAS fail。
  let buffer = getBuffer(path);
  if (!buffer) {
    const fallbackPath = getCurrentPath();
    if (fallbackPath) {
      buffer = getBuffer(fallbackPath);
    }
  }
  if (!buffer) {
    buffer = getOrCreateBuffer(path);
  }

  if (selfWriteInFlightUntilRef) {
    selfWriteInFlightUntilRef.current = Date.now() + SELF_WRITE_SUPPRESSION_MS;
  }

  if (content !== buffer.content) {
    buffer.content = content;
    buffer.pendingContent = content;
  }

  // 写盘 IPC 也要发到 fallback 后的 path ── 否则旧 path 的物理文件
  // 已 rename 走, 后端 fs::read_to_string 报错, 触发 CAS refused。
  const writePath = buffer === getBuffer(path) ? path : (getCurrentPath() ?? path);
  return flushDocument(writePath, callbacks);
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

export function moveDocumentBuffer(
  oldPath: string,
  newPath: string,
  finalizedContent: string,
): DocumentBuffer {
  const buffer = getOrCreateBuffer(oldPath);
  buffer.lastSavedContent = finalizedContent;
  buffer.content = finalizedContent;
  buffer.pendingContent = null;
  return moveBuffer(oldPath, newPath);
}
