/**
 * Buffer registry — module-singleton owner of the per-document
 * buffers and the "current path" pointer.
 *
 * Why this lives outside React
 * ----------------------------
 * The buffer (content / lastSavedContent / pendingContent) is mutated
 * synchronously on every keystroke. If it lived in React state or
 * zustand state, every keystroke would trigger a re-render of every
 * subscriber. By keeping it as a module-level mutable Map, keystrokes
 * are O(1) and re-render-free; React state only tracks UI concerns
 * (charCount, isLoading, etc.).
 *
 * Why this lives outside any single hook
 * --------------------------------------
 * Multiple hooks need to read/write the same buffer (useDocumentContent
 * on load, useDocumentAutosave on every keystroke and on save, etc.).
 * Passing the buffer as a ref through component props is fragile
 * (forwarded through every consumer, easy to forget a useEffect
 * dependency). Having a single registry means the buffer is global to
 * the document-pane module — the same one DocumentContainer is the
 * sole user of.
 *
 * Why the store calls into this directly
 * ---------------------------------------
 * The document store previously exposed a Set<DocumentSessionCloser>
 * that hooks registered into. That required every consumer to
 * register/unregister in a useEffect, with all the timing caveats
 * that implies. By owning the buffer + flush logic here, the store
 * can simply call `await flushDocument(prev.path)` directly inside
 * its session-transition action. No more registration, no more
 * commit-phase races.
 *
 * Why two maps (memoId vs canonical path)
 * ---------------------------------------
 * 内部 memo 的物理文件在编辑过程中会被重命名 (首行变更触发 B 方案
 * 三拷贝同步: filename / 物理文件名 / frontmatter 始终一致, 任一变更
 * 都会 rename 物理文件)。如果 buffer 用 path 索引, rename 期间就要
 * 搬键 (moveBuffer), 引入 "closure 落后于 currentPath" 的 race ──
 * 上一轮 P1 修复 (O) 就是用 getCurrentPath() 兜底这个 race。
 *
 * 改用 memoId 索引后, buffer key 永不变, rename 期间 buffer 不动 ──
 * 从根上消除 race。外部 .md 文件不走这套同步, 用 canonical path 索引
 * 即可, 因为外部 .md 不会被后端重命名。
 *
 * L1 缓存 (classifyPathCache): 同一 path 字符串多次解析 BufferOwner
 * 时复用结果, 避免每次都跑正则 ── getOrCreateBuffer 是高频调用
 * (每次敲字都会走)。
 */
import { scheduleSave } from './save-queue';
import { emptyDocumentBuffer, type DocumentBuffer } from './document-buffer';
import { extractMemoIdFromPath } from '../path';

/**
 * Canonical form of a path. On Mac/Linux the on-disk separator is `/`,
 * so we convert any `\` to `/` and collapse runs. Case is preserved
 * (Mac filesystems are case-sensitive by default, unlike Windows).
 */
function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * 一个 buffer 的"所有者" ── 决定走哪个 Map 索引。
 * - `memo`: 内部已注册 memo, key 永不变, 物理 rename 不影响 buffer
 * - `external`: 外部 .md 文件, key 跟 path 走, 后端不会重命名
 */
export type BufferOwner =
  | { kind: 'memo'; memoId: string; canonicalPath: string }
  | { kind: 'external'; canonicalPath: string };

/**
 * 根据 path 分类 buffer owner。`memoId` 解析规则跟后端
 * `extract_memo_id_from_abs_path` 对齐 ── 失败时一律 fallback 到
 * `external`, 不会因误分类出 bug (外部文件走 path 索引, 跟旧逻辑一致)。
 */
function classifyPath(path: string): BufferOwner {
  const cp = canonicalPath(path);
  const memoId = extractMemoIdFromPath(cp);
  if (memoId) {
    return { kind: 'memo', memoId, canonicalPath: cp };
  }
  return { kind: 'external', canonicalPath: cp };
}

// L1 缓存: 同一 canonicalPath 字符串的解析结果复用。
// 用 canonicalPath (而非 raw path) 作 key, 同一文件多 path 形式命中同一行。
const classifyPathCache = new Map<string, BufferOwner>();

/**
 * 公开的 classifyPath (带缓存)。给文档 session service / useMemoEvents
 * 用 ── 它们要按 BufferOwner 类型走不同路径 (例如 memo → IPC updateMemoItem,
 * external → IPC registerUnnamedFile)。
 */
export function classifyBufferOwner(path: string): BufferOwner {
  const cp = canonicalPath(path);
  const cached = classifyPathCache.get(cp);
  if (cached) return cached;
  const owner = classifyPath(cp);
  classifyPathCache.set(cp, owner);
  return owner;
}

/**
 * 缓存淘汰 ── rename 后旧 path 不再出现, 但仍占缓存行。极端笔记本
 * 几千个 memo 重命名后, 缓存会堆积 dead 路径。
 *
 * 释放接口 (显式): 调用方在知道 "这个 path 永远不会再来" 时调一下
 * (例如外部文件 dropBuffer)。memo path 不需要 ── memo 数量有限
 * (几千), 即使累积也只占几 MB, 跟 user 体验无关。
 */
export function evictClassifyCache(path: string): void {
  classifyPathCache.delete(canonicalPath(path));
}

// 两个 buffer map, 互不交叉 ── 同一个文件不可能同时是 memo 和 external,
// 同一个 memoId 也不可能跟 external path 重复。
const memoBuffers = new Map<string, DocumentBuffer>();       // key = memoId
const externalBuffers = new Map<string, DocumentBuffer>();  // key = canonicalPath

let currentPath: string | null = null;
let currentBuffer: DocumentBuffer = emptyDocumentBuffer();

/** The path currently "active" — the one keystrokes will save. */
export function getCurrentPath(): string | null {
  return currentPath;
}

/** The buffer for the currently active path. */
export function getCurrentBuffer(): DocumentBuffer {
  return currentBuffer;
}

/**
 * The buffer for the given path, indexed by its BufferOwner type:
 * - memo path → memoId 索引, 物理 rename 期间 buffer 不丢
 * - external path → canonical path 索引
 *
 * 旧 `moveBuffer` 取消: 物理 rename 不再需要搬键 ── memoId 索引
 * 保证同 memo 的 buffer 永不被换出。这条不变量是当前 3 层防御
 * 兜底逻辑的根因修复。
 */
export function getBuffer(path: string): DocumentBuffer | undefined {
  const owner = classifyBufferOwner(path);
  return owner.kind === 'memo'
    ? memoBuffers.get(owner.memoId)
    : externalBuffers.get(owner.canonicalPath);
}

/** The buffer for a path, allocating one if needed. */
export function getOrCreateBuffer(path: string): DocumentBuffer {
  const owner = classifyBufferOwner(path);
  if (owner.kind === 'memo') {
    let buf = memoBuffers.get(owner.memoId);
    if (!buf) {
      buf = emptyDocumentBuffer();
      memoBuffers.set(owner.memoId, buf);
    }
    return buf;
  }
  let buf = externalBuffers.get(owner.canonicalPath);
  if (!buf) {
    buf = emptyDocumentBuffer();
    externalBuffers.set(owner.canonicalPath, buf);
  }
  return buf;
}

/**
 * 按 memoId 直接拿 buffer ── 走 memoBuffers 索引 (双 Map 索引下 memoId
 * 是稳定 key, 物理 rename 期间不变)。用于"已知 memoId 一定存在"的场景
 * (例如 useMemoEvents 收到 memo-event 携带 memoId 时)。
 *
 * 跟 getBuffer(path) 的区别: getBuffer 走 path → `extractMemoIdFromPath`
 * 解析, 可能误判为 external 走错索引; getBufferByMemoId 不走解析, 直接
 * 命中 memoBuffers。外部 .md 文件没有 memoId ── 这个 API 对它们无意义。
 */
export function getBufferByMemoId(memoId: string): DocumentBuffer | undefined {
  return memoBuffers.get(memoId);
}

/**
 * Switch the active path. Allocates a fresh buffer if the path has
 * never been seen; otherwise reuses the existing buffer so that any
 * pending edits survive a switch away and back.
 */
export function setCurrentPath(path: string | null): void {
  if (path === null) {
    currentPath = null;
    currentBuffer = emptyDocumentBuffer();
    return;
  }
  // currentPath 存 canonicalPath 不存 memoId ── 让 getCurrentPath() 返回值
  // 仍可作为 path 喂给 classifyPath (后者重新解析 memoId)。存 memoId 会
  // 让 recordDocumentEdit(memoId, ...) 走 classifyPath 解析失败 fallback
  // 到 external 走错索引。
  const owner = classifyBufferOwner(path);
  if (owner.canonicalPath === currentPath) return;
  currentPath = owner.canonicalPath;
  currentBuffer = getOrCreateBuffer(path);
}

/**
 * True if the buffer at `path` (or the current path) has unsaved local
 * edits. Used by the external-change watcher to decide whether an
 * external file change is safe to silently apply.
 *
 * 比较时 strip frontmatter ── `buf.content` (用户敲字结果, 含编辑器
 * 状态里的旧 frontmatter) 跟 `buf.lastSavedContent` (磁盘权威内容,
 * 含后端派生重写的新 frontmatter) 在首行变更场景下永远因 frontmatter
 * 字段不同而不等, 但 body 部分完全一致。视为"等价", 不阻塞外部
 * reloadDocument ── 否则用户停留文档时, 外部 VSCode 改盘会永远
 * 被误判为冲突 ("文档已被外部修改" toast + 编辑器不更新)。
 *
 * 已知 trade-off: 用户双击 frontmatter 块改了字段, 但不保存就放手,
 * 此时 strip 后 body 相等, 也视作不 dirty, 外部改盘会覆盖用户对
 * frontmatter 的修改 ── 这种 case 罕见, 用户可手动重新编辑 frontmatter。
 */
export function hasUnsavedLocalChanges(path?: string): boolean {
  const target = path ?? getCurrentPath();
  if (!target) return false;
  const buf = getBuffer(target);
  if (!buf) return false;
  if (buf.content === buf.lastSavedContent) return false;
  // 仅有 frontmatter 差异 (派生 title 变化时后端 strip + 重写 frontmatter
  // 而 body 不变) ── 视为不 dirty
  if (stripFrontmatter(buf.content) === stripFrontmatter(buf.lastSavedContent)) {
    return false;
  }
  return true;
}

/**
 * 按 memoId 判 dirty ── 跟 hasUnsavedLocalChanges(path) 行为一致 (含
 * frontmatter 差异豁免), 但用 memoBuffers 直接索引, 绕开 classifyPath
 * 走 path 解析可能误判 external 的风险。供 useMemoEvents 在物理
 * rename 场景 (已知 memoId 一定存在) 用。
 */
export function hasUnsavedLocalChangesForMemo(memoId: string): boolean {
  const buf = memoBuffers.get(memoId);
  if (!buf) return false;
  if (buf.content === buf.lastSavedContent) return false;
  if (stripFrontmatter(buf.content) === stripFrontmatter(buf.lastSavedContent)) {
    return false;
  }
  return true;
}

// strip frontmatter 跟后端 `extract_body_content` 行为对齐; 仅用于
// dirty 比较, 不参与编辑器 / 写盘逻辑。
function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Apply freshly-loaded content to the buffer for `path`. If
 * `preservePending` is true and the buffer already has a pending edit,
 * the pending edit wins (so a fast switch away and back doesn't lose
 * the user's in-flight typing).
 */
export function applyLoadedContent(
  path: string,
  fullContent: string,
  options?: { preservePending?: boolean },
): DocumentBuffer {
  setCurrentPath(path);
  const buf = currentBuffer;
  const initialContent = options?.preservePending
    ? (buf.pendingContent ?? fullContent)
    : fullContent;
  buf.content = initialContent;
  buf.lastSavedContent = fullContent;
  if (!options?.preservePending) {
    buf.pendingContent = null;
  }
  return buf;
}

/**
 * Drop the buffer for a path. Called by the external-change watcher
 * when the disk version no longer matches the cached buffer, so the
 * next load reads fresh state.
 *
 * 双重清理: memo / external 两边都尝试删 (只一边会命中), 然后也清
 * classifyPathCache ── 避免 stale owner 分类 (例如路径从 memo 被
 * 改成 external 后, 旧 owner 还占缓存行)。
 */
export function dropBuffer(path: string): void {
  const owner = classifyBufferOwner(path);
  const cp = owner.canonicalPath;
  // 双重清理: 用 path 和 memoId 各自解一次
  memoBuffers.delete(extractMemoIdFromPath(cp) ?? '');
  externalBuffers.delete(cp);
  if (currentPath === cp) {
    currentPath = null;
    currentBuffer = emptyDocumentBuffer();
  }
  evictClassifyCache(cp);
}

// moveBuffer 取消 ── memoId 索引下, 物理 rename 期间 buffer 不需要搬键。
// 旧调用方 (useMemoEvents.syncActiveDocumentPathIfRenamed,
// useDocumentFinalize.finalizeMemoRename) 改为直接 IPC + 切 active path
// 即可, 不再需要改 buffer 本身。

export interface FlushCallbacks {
  /** Called after a successful IPC. The buffer has already been updated. */
  onSaved?: (content: string) => void;
  /** Called on CAS refusal. */
  onCasRefused?: (content: string) => void;
  /** Called on transport / IPC error. */
  onError?: (content: string, err: unknown) => void;
}

/**
 * Flush any pending edits for the given path through the save queue.
 * Returns true if the buffer is on disk (either was already, or the
 * save succeeded), false if the save was CAS-refused or errored.
 *
 * No-op (returns true) when:
 *   - path has no buffer (e.g. never loaded, or already dropped)
 *   - buffer is already in sync with disk
 *
 * The save queue handles coalescing with any in-flight or pending save
 * for the same path. Multiple flushes called close together resolve
 * into a single chain of IPCs — see save-queue.ts for details.
 *
 * IPC path: 内部 memo 也用 canonical path 发 IPC ── 后端会按
 * `extract_memo_id_from_path` 自己解析 memoId, 走同步派生路径。两条
 * IPC (memo vs external) 在 IPC 层透明, 前端只关心 buffer 索引。
 */
export async function flushDocument(
  path: string,
  callbacks?: FlushCallbacks,
): Promise<boolean> {
  const owner = classifyBufferOwner(path);
  const buf = owner.kind === 'memo'
    ? memoBuffers.get(owner.memoId)
    : externalBuffers.get(owner.canonicalPath);
  if (!buf) return true;
  if (buf.content === buf.lastSavedContent) {
    return true;
  }

  return scheduleSave({
    path: owner.canonicalPath,
    readExpected: () => buf.lastSavedContent,
    onSaved: (written) => {
      buf.lastSavedContent = written;
      if (buf.content === written) {
        buf.pendingContent = null;
      } else if (buf.pendingContent === written) {
        buf.pendingContent = null;
      }
      callbacks?.onSaved?.(written);
    },
    onCasRefused: (written) => {
      callbacks?.onCasRefused?.(written);
    },
    onError: (written, err) => {
      callbacks?.onError?.(written, err);
    },
  }, buf.content);
}
