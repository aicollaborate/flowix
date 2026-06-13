/**
 * Per-path coalescing save queue.
 *
 * Why this exists
 * ---------------
 * The document has 5 independent mechanisms that can trigger a save:
 *   1. handleChange debounced timer (1s)
 *   2. sessionCloser (user navigates to another memo)
 *   3. finalizeMemoRename (memo renamed)
 *   4. document.visibilitychange (tab hidden)
 *   5. window.beforeunload (app closing)
 *
 * Before this refactor each of these called memosClient.writeDocument
 * directly. The IPC + CAS pattern is one-shot, so when two of these fired
 * close together (e.g. user types fast and switches memo), we would issue
 * two writes with the SAME expectedContent. The first would succeed and
 * bump the disk version, the second would CAS-fail and surface "文档已被
 * 外部修改" — even though the failure was self-induced.
 *
 * What this module does
 * ---------------------
 * - Serializes writes for a given path through a single chain.
 * - Coalesces: if a write is in flight and another comes in, the new
 *   content is queued as `pending`. The chain processes the in-flight
 *   one, then runs the pending one (with the latest expectedContent read
 *   from the caller at that moment via `readExpected`).
 * - Exposes `scheduleSave` for fire-and-forget callers, and `flushSave`
 *   for callers that need to wait for the chain to settle (closer,
 *   finalize).
 *
 * Buffer ownership
 * ----------------
 * The save queue does NOT own the DocumentBuffer. It calls back into the
 * React hook for two things: `readExpected` (just before IPC) and
 * `onSaved` (just after a successful IPC). This keeps buffer state in
 * React-land where it stays reactive, while the queue orchestrates IPC
 * ordering.
 */
import { memos as memosClient } from '../tauri/client';

export interface SaveContext {
  /** The document path this save targets. */
  path: string;
  /**
   * Read the current expectedContent (CAS expected value) just before the
   * IPC fires. Returning a fresh value here is what makes coalescing
   * safe: the chain re-reads the expected value before every IPC, so a
   * pending save always sends the latest expected version.
   */
  readExpected: () => string;
  /**
   * Called after a successful write. Caller is responsible for updating
   * `lastSavedContent` (and `pendingContent` if appropriate) here.
   */
  onSaved: (writtenContent: string) => void;
  /** Called on CAS refusal (write returned false). */
  onCasRefused: (writtenContent: string) => void;
  /** Called on transport / IPC error. */
  onError: (writtenContent: string, err: unknown) => void;
}

interface QueueEntry {
  /** Latest content waiting to be written (overwritten by later scheduleSave). */
  pending: string | null;
  /** Context for the latest pending content. */
  pendingCtx: SaveContext | null;
  /** The chain promise for the current or last in-flight chain. */
  inFlight: Promise<boolean> | null;
}

const queue = new Map<string, QueueEntry>();

/**
 * Schedule a save for the given path/content. Coalesces with any in-flight
 * or pending save. Returns a promise that resolves when the chain settles,
 * with the result of the LAST attempted write (true = on disk, false =
 * CAS-refused or errored — the latest content was NOT successfully written).
 *
 * Coalescing semantics: if you call scheduleSave with C1, then C2, then
 * C3 in quick succession while the chain is in-flight, the chain will
 * write C1 then C3 (C2 is dropped — the timer that scheduled it had
 * already been overwritten by C3's schedule).
 */
export function scheduleSave(ctx: SaveContext, content: string): Promise<boolean> {
  const path = ctx.path;
  let entry = queue.get(path);
  if (!entry) {
    entry = { pending: null, pendingCtx: null, inFlight: null };
    queue.set(path, entry);
  }

  if (entry.inFlight) {
    // Coalesce: just record the new content. The chain will pick it up.
    entry.pending = content;
    entry.pendingCtx = ctx;
    return entry.inFlight;
  }

  // No chain in flight — start one with this content.
  entry.pending = content;
  entry.pendingCtx = ctx;
  const promise = runChain(ctx);
  entry.inFlight = promise;
  return promise;
}

/**
 * Wait for all in-flight and pending saves for the given path to settle.
 * Used by sessionCloser and finalizeMemoRename to ensure no save is
 * dropped when the user navigates away.
 *
 * Note: this waits for the chain to finish, not for the editor to
 * unmount. Callers that need the editor-mount guarantee should still
 * coordinate with React lifecycle (e.g. via the document store's
 * session transition).
 */
export async function flushSave(path: string): Promise<void> {
  while (true) {
    const entry = queue.get(path);
    if (!entry || !entry.inFlight) return;
    await entry.inFlight;
    // The chain may have spawned a new inFlight for the pending. Loop.
  }
}

async function runChain(ctx: SaveContext): Promise<boolean> {
  const entry = queue.get(ctx.path);
  if (!entry) return true;

  let currentContent = entry.pending ?? '';
  let currentCtx = entry.pendingCtx ?? ctx;
  entry.pending = null;
  entry.pendingCtx = null;
  let lastResult = true;

  while (true) {
    const result = await runOne(currentCtx, currentContent);
    lastResult = result;
    if (!result) {
      // CAS refused (or transport error). Stop the chain — caller will
      // toast/retry. The entry stays in the map with its current
      // pending, so a later scheduleSave can pick it up.
      break;
    }

    const e = queue.get(ctx.path);
    if (!e || e.pending === null) {
      break;
    }
    if (e.pending === currentContent) {
      // Same content was queued twice (e.g. the timer fired twice
      // for the same content because the chain had not yet completed).
      // Drop the duplicate to avoid a wasted IPC.
      e.pending = null;
      e.pendingCtx = null;
      break;
    }
    currentContent = e.pending;
    currentCtx = e.pendingCtx ?? currentCtx;
    e.pending = null;
    e.pendingCtx = null;
  }

  // Cleanup. Runs synchronously after the loop breaks, so no other
  // scheduleSave can interleave with it.
  const e = queue.get(ctx.path);
  if (e) {
    e.inFlight = null;
    if (e.pending === null) {
      queue.delete(ctx.path);
    }
  }
  return lastResult;
}

async function runOne(ctx: SaveContext, content: string): Promise<boolean> {
  // Re-read expected at IPC time, not at schedule time. This is the
  // key correctness property: coalesced saves always CAS against the
  // version of the file that the previous write in the chain just
  // updated to, not the stale value from when the caller scheduled.
  const expected = ctx.readExpected();
  try {
    // `result` 是磁盘最终内容 (含 frontmatter) 或 null。拿它更新
    // `lastSavedContent` ── 修"rename 后下次 saveDoc CAS 失败"的核心点:
    // caller 写的 content 不含 frontmatter, 不能直接做 CAS 比对。
    const result = await memosClient.writeDocument(ctx.path, content, expected);
    if (result !== null) {
      ctx.onSaved(result);
      return true;
    }
    // 写盘失败 ── 自愈: 如果磁盘内容恰好等于 caller 写的 (例如我们刚写
    // 的 frontmatter 跟 caller 写的完全一致), 视为成功, 否则 CAS refused。
    const currentContent = await memosClient.readDocument(ctx.path).catch(() => null);
    if (currentContent === content) {
      ctx.onSaved(content);
      return true;
    }
    ctx.onCasRefused(content);
    return false;
  } catch (err) {
    console.error('[runOne] IPC threw', { path: ctx.path, err });
    ctx.onError(content, err);
    return false;
  }
}
