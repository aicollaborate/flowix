// 后端 `memo-event` 事件总线的前端单订阅者 — 挂在 App.tsx 顶层, 让主窗口和
// 偏好设置窗口都同步。事件按 `kind` 派发到 memo-store 的 handleMemo* 三个
// action; store 自己负责乐观更新 + triggerRefresh, 不在这里做任何业务判断。
//
// 替代旧的 `agent-document-updated` 事件, 新协议统一为 `memo-event` 一个事件名
// 内部 snake_case `kind` 区分 Created/Updated/Deleted。
//
// 设计取舍:
// - 这里不分支 source: 不同 source (agent_edit vs user_edit vs external_tool)
//   走完全相同的 store 更新路径。前端不用 source 做任何 UI 决策 — 它的存在
//   仅供日志 / 后续 toast 区分使用。
// - 不在事件 handler 里直接 mutate selectedMemo: store action 自己处理。

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useMemoStore } from '../store/memo-store';
import type { MemoEvent } from '../../types/memo';

export function useMemoEvents(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<MemoEvent>('memo-event', (event) => {
      if (disposed) return;
      const payload = event.payload;
      const store = useMemoStore.getState();
      switch (payload.kind) {
        case 'created':
          store.handleMemoCreated(payload.memo);
          break;
        case 'updated':
          store.handleMemoUpdated(payload.id);
          break;
        case 'deleted':
          store.handleMemoDeleted(payload.id);
          break;
      }
    })
      .then((fn) => {
        // 异步 listen() 完成时如果组件已经卸载, 立刻 unlisten
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        // 监听失败只 warn, 不影响主窗口 UI
        // eslint-disable-next-line no-console
        console.warn('[useMemoEvents] failed to subscribe to memo-event:', err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
