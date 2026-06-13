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
  const buffer = getOrCreateBuffer(path);
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
