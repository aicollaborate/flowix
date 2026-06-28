// MemoItem 类型 — 独立文件, 供 types/memo.ts (MemoEvent 镜像) 和
// store/memo-store.ts 共享, 避免循环引用。
//
// 跟后端 `flowix-core::memo_file::Memo` 镜像, 字段命名是 camelCase
// (后端走 `#[serde(rename_all = "camelCase")]` 跨 IPC 边界)。

export type MemoColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'gray';

export interface AgentThreadItem {
  threadId: string;
  title: string;
  // agentType ── 与 Rust struct `AgentThreadItem.agent_type` (`#[serde(rename
  // = "agentType")]`) 对齐, 区分于 agentRole* (角色 persona)。 之前用
  // roleKey 容易跟 agent role 字段混淆, 改名为 agentType。
  agentType: string;
}

export interface MemoItem {
  id: string;
  filename: string;
  preview: string;
  thumbnail?: string | null;
  tags: string[];
  todos: { content: string; status: string }[];
  agents: AgentThreadItem[];
  createdAt: number;
  updatedAt: number;
  favorited: boolean;
  icon: string | null;
  colors: MemoColor[];
  properties: Record<string, unknown>;
  isOpen?: boolean;
}
