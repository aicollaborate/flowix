// 后端 MemoEvent 的 TypeScript 镜像 — 硬契约, 跟 app/backend/src/memo_events.rs
// 保持一致。`kind` 必须是 snake_case, 字段命名 (id/path/source/memo) 是跨
// IPC 边界的约定, 不要随便改。

import type { MemoItem } from '../lib/store/memo-store';

export type MemoChangeSource =
  | 'user_new'
  | 'user_import'
  | 'user_edit'
  | 'agent_edit'
  | 'agent_write'
  | 'external_tool';

export type MemoEvent =
  | { kind: 'created'; memo: MemoItem; source: MemoChangeSource }
  | { kind: 'updated'; id: string; path: string; source: MemoChangeSource }
  | { kind: 'deleted'; id: string; path: string };
