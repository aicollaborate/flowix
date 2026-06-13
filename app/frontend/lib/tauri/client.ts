'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { UserSettings } from '../constants';
import type { AgentChunk, ChatMessage, RunInfo } from '../../types/agent';
import type { AgentAccessConfig } from '../types/agent-access';
import type { MemoColor } from '../store';

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

// Agent 可访问目录 (后端 ~/.flowix/agent_access.json)。
// ── 真源是后端 `agent_access::AgentAccessStore` ── 镜像所有
//   notebook + 用户自添加 folder, 每条 entry 有 enabled 勾选。
//   驱动 `ToolScope::allowed_roots` 与 `list_notebooks` 工具的过滤。
//
// 整份 set 替代逐条 patch, 避免前端对单条 entry 算 diff; 写时走乐观更新
// (本地先改, 失败 `loadInitial` 回滚)。
export const agentAccess = {
  get: () => invoke<AgentAccessConfig>('get_agent_access'),
  set: (config: AgentAccessConfig) => invoke<void>('set_agent_access', { config }),
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
  // 写盘 IPC。返回值为 null = 写盘失败 (路径非法 / CAS refuse / fs error),
  // 否则返回磁盘上的最终内容 (含 frontmatter)。前端用这个值更新
  // `lastSavedContent` 以匹配磁盘, 避免 "rename 后下次 saveDoc CAS 失败"。
  writeDocument: (filePath: string, content: string, expectedContent?: string) =>
    invoke<string | null>('write_document', { filePath, content, expectedContent }),
  getLaunchOpenFiles: () => invoke<string[]>('get_launch_open_files'),
  addDocument: (tag?: string, notebookId?: string) => invoke<any>('add_document', { tag, notebookId }),
  importExternalDocumentToMemo: (sourcePath: string, content: string, notebookId?: string) =>
    invoke<any | null>('import_external_document_to_memo', { sourcePath, content, notebookId }),
  updateMemoDb: (id: string, filename?: string, content?: string, preview?: string, deferRename?: boolean) =>
    invoke<boolean>('update_memo_db', { id, filename, content, preview, deferRename }),
  finalizeMemoFilename: (id: string) => invoke<boolean>('finalize_memo_filename', { id }),
  deleteMemo: (id: string) => invoke<boolean>('delete_memo', { id }),
  clearMemos: (notebookId?: string) => invoke<boolean>('clear_memos', { notebookId }),
  favoriteMemo: (id: string) => invoke<boolean>('favorite_memo', { id }),
  unfavoriteMemo: (id: string) => invoke<boolean>('unfavorite_memo', { id }),
  setMemoColors: (id: string, colors: MemoColor[]) =>
    invoke<boolean>('set_memo_colors', { id, colors }),
  search: (notebookId: string | null, query: string, limit?: number) =>
    invoke<{ hits: MemoSearchHit[]; indexReady: boolean }>('search_memos', {
      notebookId,
      query,
      limit,
    }),
  // 全局"通过链接打开笔记"入口 ── 接收任意形式的 `flowix://` URL / 物理路径,
  // 后端走 parser + resolver, 返回 ResolvedOpenTarget。 null 表示解析失败
  // (id 不存在 / 路径不在 notebook 内 / 物理路径指向已删笔记)。 配合
  // `lib/openByTarget/listener.ts` 监听 `flowix:open-target` 事件 ── 主动
  // 调用 (noteReference 双击 / Agent 工具) 走 await, 被动派发 (外部深链 /
  // single-instance 二次启动) 走事件。 两条路径汇合到同一 `openNoteByTarget`。
  openMemoByTarget: (raw: string) => invoke<{
    memoId: string;
    notebookId: string;
    notebookName: string;
    notebookPath: string;
    absolutePath: string;
    memoTitle: string;
  } | null>('open_memo_by_target', { raw }),
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
  // 查询当前 in-flight chat 集合 ── 启动时前端调一次, seed
  // `threadStates[].isLoading`。 空 map 表示当前没有 in-flight chat。
  // 后端镜像 `cancel_flags` 的生命周期, 与 `StreamStart/End` chunk 同步。
  runningThreads: () =>
    invoke<Record<string, RunInfo>>('agent_running_threads'),
  listThreads: () =>
    invoke<ThreadInfo[]>('thread_list'),
  createThread: (title: string) =>
    invoke<ThreadInfo>('thread_create', { title }),
  getThread: (threadId: string) =>
    invoke<{ messages: ChatMessage[] }>('thread_get', { threadId }),
  deleteThread: (threadId: string) =>
    invoke<void>('thread_delete', { threadId }),
  // 重命名 thread ── 首条用户消息落地后调一次, 覆盖 ensureThread 走 early return
  // 时的漏网之鱼(点过"新建对话"再发消息的场景)。返回 None 表示 thread 不存在。
  updateThreadTitle: (threadId: string, title: string) =>
    invoke<ThreadInfo | null>('thread_update_title', { threadId, title }),
};

// Stream event handling
//
// **模块级单例 listener** ── 这里只允许注册一次, 整个 app 共享同一份
// 监听。`useAgentEvents` 在 App.tsx 顶层挂一次, 把 chunk 派发到 chat-store
// 的 `dispatchAgentChunk` action; 多个组件 (主窗口 / 偏好窗口) 不再各自
// 挂 listener ── 避免 chunk 被多个 handler 重复处理。
//
// 历史: 旧版 `listenToAgentStream` 是 `sendMessageStream` 内每次发消息挂
// 一次, 收到 `finally` 调 `stopListeningToAgentStream` 卸掉。 新模型下
// listener 长在, 永远不卸, 派发器自己按 `thread_id` 路由到正确的 store
// 状态。 旧调用点 (chat-store.ts: sendMessageStream 里的
// `listenToAgentStream((chunk) => ...)`) 已经整体替换为单点 dispatch。
export type StreamCallback = (chunk: AgentChunk) => void;

let streamUnlisten: UnlistenFn | null = null;

export async function listenToAgentStream(callback: StreamCallback): Promise<void> {
  if (streamUnlisten) {
    // 重复挂载: 先 unlisten 旧的, 重新挂一次。 短时间内的重复挂载
    // (StrictMode 双调用 / HMR 重载) 不至于让 listener 堆积。
    streamUnlisten();
    streamUnlisten = null;
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

// Agent 可访问目录变更事件 ── 后端 set_agent_access / notebook CRUD
// 钩子任一成功都 emit, payload 是 `()` (无 payload), 监听者直接
// `loadInitial()` 拉整份 config。 与 `user-config-changed` 同形。
export type AgentAccessChangeHandler = () => void;

let agentAccessUnlisten: UnlistenFn | null = null;

export async function listenToAgentAccessChanges(
  handler: AgentAccessChangeHandler,
): Promise<void> {
  if (agentAccessUnlisten) {
    agentAccessUnlisten();
  }
  agentAccessUnlisten = await listen<unknown>('agent-access-changed', () => {
    handler();
  });
}

export function stopListeningToAgentAccessChanges(): void {
  if (agentAccessUnlisten) {
    agentAccessUnlisten();
    agentAccessUnlisten = null;
  }
}
