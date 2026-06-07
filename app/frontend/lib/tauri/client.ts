'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { UserSettings } from '../constants';
import type { AgentChunk, ChatMessage } from '../../types/agent';

// ============================================
// Types
// ============================================

export type { ChatMessage } from '../../types/agent';

// Lightweight message type for LLM communication (without id/timestamp)
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RpcRequest {
  <T = unknown>(method: string, params?: unknown): Promise<T>;
}

// ============================================
// Tauri RPC Client
// ============================================

let rpcInstance: RpcRequest | null = null;

export function initTauriClient(): void {
  rpcInstance = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    return await invoke<T>(method, params as Record<string, unknown> || {});
  };
  (window as any).__tauriRpc = rpcInstance;
}

export function getRpc(): RpcRequest {
  if (!rpcInstance) {
    throw new Error("Tauri RPC not initialized. Call initTauriClient() first.");
  }
  return rpcInstance;
}

export function isInitialized(): boolean {
  return rpcInstance !== null;
}

// ============================================
// RPC Method Wrappers (for type safety)
// ============================================

// Preferences (后端 ~/.flowix/preference.json, 见 backend/src/user_config.rs)
export const preferences = {
  get: () => invoke<UserSettings>('get_preference'),
  set: (preference: UserSettings) => invoke<void>('set_preference', { preference }),
};

// AI Config (后端 ~/.flowix/ai_config.json, 字段与 AgentConfig 镜像)
// ─ 真源在后端文件; 偏好设置的 AI 模型 tab 用 get/set 加载与保存。
//   chat 调用走 backend AgentManager, 无需前端再 init。
export const aiConfig = {
  get: () => invoke<{ model: AgentConfig }>('get_ai_config'),
  set: (config: AgentConfig) => invoke<void>('set_ai_config', { config: { model: config } }),
};

// 全局元数据 KV (~/.flowix/global_meta_data.json, 用于 notebook 的 tag 顺序 / 隐藏状态等非偏好数据)
// 后端 set_* 返回 Result<(), String>, 前端 await 即抛错。
export const settings = {
  get: (key: string) => invoke<{ value: string | null }>('get_setting', { key }),
  getAll: () => invoke<{ settings: Record<string, string> }>('get_all_settings'),
  set: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
  setMultiple: (settings: Record<string, string>) => invoke<void>('set_multiple_settings', { settings }),
  delete: (key: string) => invoke<boolean>('delete_setting', { key }),
};

// Memos
export type FilterType = 'all' | 'todos' | 'favorited' | 'tagged' | 'thisWeek' | 'thisMonth';
export type SortType = 'createdAt' | 'updatedAt';

export type MatchField = 'title' | 'tag' | 'body';

export interface MemoSearchHit {
  id: string;
  filename: string;
  snippet: string;
  matchedIn: MatchField;
  score: number;
  updatedAt: number;
}

export const memos = {
  getMemos: (params?: {
    notebookId?: string;
    filter?: FilterType;
    sort?: SortType;
    tagId?: string;
  }) => invoke<{ memos: any[] }>('get_memos', {
    notebookId: params?.notebookId,
    filter: params?.filter || 'all',
    sort: params?.sort || 'createdAt',
    tagId: params?.tagId,
  }),
  readMemo: (id: string) => invoke<any | null>('read_memo', { id }),
  readDocument: (filePath: string) => invoke<string | null>('read_document', { filePath }),
  writeDocument: (filePath: string, content: string, expectedContent?: string) =>
    invoke<boolean>('write_document', { filePath, content, expectedContent }),
  getLaunchOpenFiles: () => invoke<string[]>('get_launch_open_files'),
  addDocument: (tag?: string, notebookId?: string) => invoke<any>('add_document', { tag, notebookId }),
  importExternalDocumentToMemo: (sourcePath: string, content: string, notebookId?: string) =>
    invoke<any | null>('import_external_document_to_memo', { sourcePath, content, notebookId }),
  updateMemoDb: (id: string, filename?: string, content?: string, preview?: string) =>
    invoke<boolean>('update_memo_db', { id, filename, content, preview }),
  deleteMemo: (id: string) => invoke<boolean>('delete_memo', { id }),
  clearMemos: (notebookId?: string) => invoke<boolean>('clear_memos', { notebookId }),
  favoriteMemo: (id: string) => invoke<boolean>('favorite_memo', { id }),
  unfavoriteMemo: (id: string) => invoke<boolean>('unfavorite_memo', { id }),
  search: (notebookId: string | null, query: string, limit?: number) =>
    invoke<{ hits: MemoSearchHit[]; indexReady: boolean }>('search_memos', {
      notebookId,
      query,
      limit,
    }),
};

// Tags
export const tags = {
  getAll: () => invoke<{ tags: { id: string; name: string }[] }>('get_all_tags'),
  create: (name: string) => invoke<{ id: string; name: string } | null>('create_memo_tag', { name }),
  rename: (id: string, name: string) => invoke<{ id: string; name: string } | null>('rename_memo_tag', { id, name }),
  delete: (id: string) => invoke<boolean>('delete_memo_tag', { id }),
};

// Notebooks
export const notebooks = {
  getAll: () => invoke<any[]>('get_notebooks'),
  create: (name: string, path: string, icon?: string) =>
    invoke<any | null>('create_notebook', { name, path, icon }),
  update: (id: string, name?: string, icon?: string) =>
    invoke<any | null>('update_notebook', { id, name, icon }),
  delete: (id: string) => invoke<boolean>('delete_notebook', { id }),
  clearAll: () => invoke<boolean>('clear_notebooks'),
  setCurrent: (notebookId: string | null) => invoke<void>('set_current_notebook', { notebookId }),
};

// Files
export const files = {
  getTree: (spacePath: string) => invoke<any[] | null>('get_file_tree', { spacePath }),
  getDirChildren: (dirPath: string) => invoke<any[]>('get_dir_children', { dirPath }),
  read: (filePath: string, spacePath?: string) => invoke<string | null>('read_file', { filePath, spacePath }),
  write: (filePath: string, content: string, skipValidation?: boolean, spacePath?: string) =>
    invoke<boolean>('write_file', { filePath, content, skipValidation, spacePath }),
  delete: (filePath: string, spacePath?: string) => invoke<boolean>('delete_file', { filePath, spacePath }),
  createFolder: (spacePath: string, name: string, parentId?: string) =>
    invoke<any | null>('create_folder', { spacePath, name, parentId }),
  createDocument: (spacePath: string, name: string, parentId?: string) =>
    invoke<any | null>('create_document', { spacePath, name, parentId }),
};

// Dialogs
export interface SaveFileFilter {
  name: string;
  extensions: string[];
}

export const dialogs = {
  selectDirectory: () => invoke<string | null>('select_directory'),
  selectFiles: () => invoke<any[] | null>('select_files'),
  saveFile: (suggestedName?: string, filters?: SaveFileFilter[]) =>
    invoke<string | null>('save_file_dialog', {
      suggestedName,
      filters: filters?.map((f) => [f.name, ...f.extensions]),
    }),
  writeExportFile: (filePath: string, content: string) =>
    invoke<boolean>('write_export_file', { filePath, content }),
  saveAttachment: (sourcePath: string, notebookId?: string) =>
    invoke<string | null>('save_attachment', { sourcePath, notebookId }),
};

// Windows
export const windows = {
  openPreferences: (tab?: string) => invoke<void>('open_preferences_window', { tab }),
};

// Agent
//
// AI 模型配置以 ~/.flowix/ai_config.json 为真源 ─ 见 aiConfig.set/get 上方。
// 前端不再 init agent / 提交模型信息: chat / thread 调用时, 后端按需读取配置
// 并惰性构建 provider 实例 (见 backend/src/agent.rs AgentManager::ensure_instance)。
//
// 字段命名: 后端 AiModelConfig 用 `#[serde(rename_all = "camelCase")]`, 所以
// IPC 传过去必须是 camelCase ─ snake_case 会被 serde 静默丢弃, 字段全部回退
// 到 #[serde(default)] = 空串, 表现就是"保存后刷新 apiKey/apiUrl 都空了"。
export interface AgentConfig {
  provider: string;
  model: string;
  apiUrl: string;
  apiKey: string;
}

export interface ChatResponse {
  response: string;
}

export interface AgentUserMessage {
  content: string;
  llmContent?: string;
  systemReminderDirectory?: string;
  systemReminderDocumentPath?: string;
}

export interface ThreadInfo {
  threadId: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export const agent = {
  chatStream: (threadId: string, message: AgentUserMessage) =>
    invoke<ChatResponse>('chat_with_agent_stream', { threadId, message }),
  // 终止运行中的 chat_stream。后端 AgentManager.stop_chat 翻转 cancel flag,
  // 正在跑的 ReAct 循环在下一个 checkpoint 检测到后调 flush_cancel 退出。
  // 返回 true = 成功触发了取消, false = 当前没有 chat 在跑 (no-op)。
  stopChatStream: (threadId: string) =>
    invoke<boolean>('stop_agent_stream', { threadId }),
  listThreads: () =>
    invoke<ThreadInfo[]>('thread_list'),
  createThread: (title: string) =>
    invoke<ThreadInfo>('thread_create', { title }),
  getThread: (threadId: string) =>
    invoke<{ messages: ChatMessage[] }>('thread_get', { threadId }),
  deleteThread: (threadId: string) =>
    invoke<void>('thread_delete', { threadId }),
};

// Stream event handling
export type StreamCallback = (chunk: AgentChunk) => void;

let streamUnlisten: UnlistenFn | null = null;

export async function listenToAgentStream(callback: StreamCallback): Promise<void> {
  if (streamUnlisten) {
    streamUnlisten();
  }
  streamUnlisten = await listen<AgentChunk>('agent-chunk', (event) => {
    callback(event.payload);
  });
}

export function stopListeningToAgentStream(): void {
  if (streamUnlisten) {
    streamUnlisten();
    streamUnlisten = null;
  }
}

// ============================================
// 跨窗口同步
// ============================================
// 后端 set_preference / set_ai_config 成功后 emit 'user-config-changed',
// payload 是 "preference" | "ai_config" 指明哪个文件变了。
// 其它窗口收到后从磁盘重新 load, 解决: 两个 Tauri 窗口各跑独立 React 树
// + 独立 zustand store, 一边改动另一边看不到的问题。

export type UserConfigChangeKind = 'preference' | 'ai_config';
export type UserConfigChangeHandler = (kind: UserConfigChangeKind) => void;

let userConfigUnlisten: UnlistenFn | null = null;

export async function listenToUserConfigChanges(
  handler: UserConfigChangeHandler,
): Promise<void> {
  if (userConfigUnlisten) {
    userConfigUnlisten();
  }
  userConfigUnlisten = await listen<UserConfigChangeKind>('user-config-changed', (event) => {
    handler(event.payload);
  });
}

export function stopListeningToUserConfigChanges(): void {
  if (userConfigUnlisten) {
    userConfigUnlisten();
    userConfigUnlisten = null;
  }
}
