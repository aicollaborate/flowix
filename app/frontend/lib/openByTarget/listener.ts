/**
 * 跨窗口单订阅者 — 监听后端 `flowix:open-target` 事件, 由 App.tsx 顶层挂。
 *
 * 设计:
 *   - 单 listener, 模块级 singleton unlisten (跟 `listenToAgentStream` /
 *     `listenToUserConfigChanges` 同形, 避免 React StrictMode 双挂
 *     堆 listener)。
 *   - 两个 webview (主窗口 / 偏好窗口) 各自挂自己的 listener 实例, 但
 *     **只有主窗口真正打开** — preferences 窗口只用来配置, 不持有 memo-list
 *     状态, 收到后 no-op。
 *   - document-store 的 enqueueTransition 已经做串行化, 同一时刻多次深链
 *     触发自动按序处理 (新值覆盖旧 session, 不重叠)。
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { openNoteByTarget } from './opener';
import { FLOWIX_OPEN_TARGET_EVENT, type ResolvedOpenTarget } from './types';

let unlisten: UnlistenFn | null = null;

/**
 * 在主窗口 (非 preferences) 才有意义 — 偏好窗口收到事件后 no-op。
 */
function isMainWindow(): boolean {
  return !window.location.hash.startsWith('#preferences');
}

/**
 * App.tsx 顶层调用。 挂全局单订阅者。 HMR / StrictMode 双挂场景下, 重复
 * 挂载会先 unlisten 旧 listener 再挂新的 (同 `listenToAgentStream` 模式)。
 */
export async function mountOpenTargetListener(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  unlisten = await listen<ResolvedOpenTarget>(FLOWIX_OPEN_TARGET_EVENT, (event) => {
    if (!isMainWindow()) return;
    void openNoteByTarget(event.payload);
  });
}

export function unmountOpenTargetListener(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
