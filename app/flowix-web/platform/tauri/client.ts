'use client';

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { subscribe } from '@platform/tauri/event-bus';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { UserSettings } from '@/lib/constants';
import type { AgentChunk, AgentCodexModel, AgentPermissionMode, AgentRuntime, ChatMessage, RunInfo } from '@/types/agent';
import type { AgentAccessConfig } from '@/lib/types/agent-access';
import type { MemoColor } from '@features/memo';

// ============================================
// Types
// ============================================

export type { ChatMessage } from '@/types/agent';

// ============================================
// Tauri RPC Client
// ============================================

type RpcRequest = <T = unknown>(method: string, params?: unknown) => Promise<T>;

let rpcInstance: RpcRequest | null = null;

export function initTauriClient(): void {
  rpcInstance = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    return await invoke<T>(method, params as Record<string, unknown> || {});
  };
  (window as any).__tauriRpc = rpcInstance;
}

// ============================================
// RPC Method Wrappers (for type safety)
// ============================================

// Preferences (鍚庣 ~/.flowix/preference.json, 瑙?backend/src/user_config.rs)
export const preferences = {
  get: () => invoke<UserSettings>('get_preference'),
  set: (preference: UserSettings) => invoke<void>('set_preference', { preference }),
};

export interface FontCacheStatus {
  fontId: string;
  cached: boolean;
}

export interface CachedFontFile {
  family: string;
  weight: string;
  style: string;
  format: string;
  unicodeRange?: string | null;
  path: string;
}

export interface CachedFontResult {
  fontId: string;
  cached: boolean;
  files: CachedFontFile[];
}

export const fontCache = {
  getStatus: () => invoke<FontCacheStatus[]>('get_font_cache_status'),
  ensureCached: (fontId: string) => invoke<CachedFontResult>('ensure_font_cached', { fontId }),
  removeCached: (fontId: string) => invoke<void>('remove_cached_font', { fontId }),
  toAssetUrl: (path: string) => convertFileSrc(path),
};

export interface WebPageMetadata {
  url: string;
  title: string;
  description: string;
  image: string;
}

export const web = {
  parsePage: (url: string) => invoke<WebPageMetadata>('parse_web_page', { url }),
};

// AI Config (鍚庣 ~/.flowix/flowix-ai-config.toml, 瀛楁涓?AgentConfig 闀滃儚)
// 鈹€ 鐪熸簮鍦ㄥ悗绔枃浠? 鍋忓ソ璁剧疆鐨?AI 妯″瀷 tab 鐢?get/set 鍔犺浇涓庝繚瀛樸€?
//   chat 璋冪敤璧?backend AgentManager, 鏃犻渶鍓嶇鍐?init銆?
export const aiConfig = {
  get: () => invoke<{ model: AgentConfig }>('get_ai_config'),
  set: (config: AgentConfig) => invoke<void>('set_ai_config', { config: { model: config } }),
};

// Agent 鍙闂洰褰?(鍚庣 ~/.flowix/agent_access.json)銆?// 鈹€鈹€ 鐪熸簮鏄悗绔?`agent_access::AgentAccessStore` 鈹€鈹€ 闀滃儚鎵€鏈?//   notebook + 鐢ㄦ埛鑷坊鍔?folder, 姣忔潯 entry 鏈?enabled 鍕鹃€夈€?//   椹卞姩 `ToolScope::allowed_roots` 涓?`list_notebooks` 宸ュ叿鐨勮繃婊ゃ€?//
// 鏁翠唤 set 鏇夸唬閫愭潯 patch, 閬垮厤鍓嶇瀵瑰崟鏉?entry 绠?diff; 鍐欐椂璧颁箰瑙傛洿鏂?
// (鏈湴鍏堟敼, 澶辫触 `loadInitial` 鍥炴粴)銆?
export const agentAccess = {
  get: () => invoke<AgentAccessConfig>('get_agent_access'),
  set: (config: AgentAccessConfig) => invoke<void>('set_agent_access', { config }),
};

// 鍏ㄥ眬鍏冩暟鎹?KV (~/.flowix/global_meta_data.json, 鐢ㄤ簬 notebook 鐨?tag 椤哄簭 / 闅愯棌鐘舵€佺瓑闈炲亸濂芥暟鎹?
// 鍚庣 set_* 杩斿洖 Result<(), String>, 鍓嶇 await 鍗虫姏閿欍€?
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

export interface MemoTemplate {
  id: string;
  name: string;
}

export interface MentionNoteSearchItem {
  id: string;
  filename: string;
  title: string;
  updatedAt: number;
  notebookId: string;
  notebookName: string;
  notebookPath: string;
  originalPath: string | null;
}

export type MemoVersionSource = 'auto' | 'manual' | 'restore_backup';

export interface MemoVersionMeta {
  id: string;
  memoId: string;
  createdAt: number;
  source: MemoVersionSource;
  filename: string;
  title: string;
  size: number;
  contentHash: string;
}

export interface MemoTodoMetadataEntry {
  content: string;
  status: string;
  memoId: string;
  priority?: string;
  timeRange?: string;
  owner?: string;
  assignee?: string;
  createdAt?: number;
  updatedAt?: number;
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
  searchMentionNotes: (query?: string, limit?: number) =>
    invoke<MentionNoteSearchItem[]>('search_mention_notes', {
      query,
      limit,
    }),
  getUsedTagIds: (notebookId?: string) =>
    invoke<{ usedTagIds: string[] }>('get_used_memo_tag_ids', { notebookId }),
  getTodoMetadata: (notebookId?: string, sort?: SortType) =>
    invoke<MemoTodoMetadataEntry[]>('get_memo_todo_metadata', { notebookId, sort }),
  getTodoCount: (notebookId?: string) =>
    invoke<number>('get_memo_todo_count', { notebookId }),
  readMemo: (id: string) => invoke<any | null>('read_memo', { id }),
  readDocument: (filePath: string) => invoke<string | null>('read_document', { filePath }),
  // 鍐欑洏 IPC銆傝繑鍥炲€间负 null = 鍐欑洏澶辫触 (璺緞闈炴硶 / CAS refuse / fs error),
  // 鍚﹀垯杩斿洖 { path, content } 鈹€鈹€ `path` 鏄鐩樹笂鏈€缁堢墿鐞嗚矾寰?  // (rename 鍚庡彲鑳借窡 caller 浼犵殑 filePath 涓嶅悓, 鍓嶇闇€瑕佹嵁姝ゅ垏 buf),
  // `content` 鏄鐩樻渶缁堝唴瀹?(鍚?frontmatter), 鐢ㄤ簬 `lastSavedContent` 瀵归綈銆?  //
  // `channel`:
  // - 'internal' 鈹€鈹€ 鍐呴儴 memo 鏂囨。, 鐢?`key` (memoId) 鍙嶆煡 memo index
  //   鎷垮綋鍓?entry.filename, 娲剧敓棣栬鍙樺寲瑙﹀彂鐗╃悊 rename + memo index 鍚屾銆?
  // - 'external' 鈹€鈹€ 澶栭儴 .md 鏂囦欢, 璧?`filePath` 瀵诲潃 + CAS, 涓嶆敼鍚?
  //   涓嶅姩 memo index銆?
  writeDocument: (params: {
    key: string | null;
    channel: 'internal' | 'external';
    filePath: string;
    content: string;
    expectedContent?: string;
  }) => invoke<{ path: string; content: string } | null>('write_document', {
    key: params.key,
    channel: params.channel,
    filePath: params.filePath,
    content: params.content,
    expectedContent: params.expectedContent,
  }),
  getLaunchOpenFiles: () => invoke<string[]>('get_launch_open_files'),
  addDocument: (tag?: string, notebookId?: string) => invoke<any>('add_document', { tag, notebookId }),
  listTemplates: () => invoke<MemoTemplate[]>('list_memo_templates'),
  saveTemplate: (title: string, content: string) =>
    invoke<MemoTemplate>('save_memo_template', { title, content }),
  deleteTemplate: (templateId: string) =>
    invoke<boolean>('delete_memo_template', { templateId }),
  createFromTemplate: (templateId: string, notebookId?: string) =>
    invoke<any>('create_memo_from_template', { templateId, notebookId }),
  importExternalDocumentToMemo: (filePath: string, content: string, notebookId?: string) =>
    invoke<any | null>('import_external_document_to_memo', { filePath, content, notebookId }),
  deleteMemo: (id: string) => invoke<boolean>('delete_memo', { id }),
  clearMemos: (notebookId?: string) => invoke<boolean>('clear_memos', { notebookId }),
  favoriteMemo: (id: string) => invoke<boolean>('favorite_memo', { id }),
  unfavoriteMemo: (id: string) => invoke<boolean>('unfavorite_memo', { id }),
  setMemoColors: (id: string, colors: MemoColor[]) =>
    invoke<boolean>('set_memo_colors', { id, colors }),
  listVersions: (id: string) =>
    invoke<MemoVersionMeta[]>('list_memo_versions', { id }),
  readVersion: (id: string, versionId: string) =>
    invoke<string | null>('read_memo_version', { id, versionId }),
  createVersion: (id: string, source?: MemoVersionSource) =>
    invoke<MemoVersionMeta | null>('create_memo_version', { id, source }),
  restoreVersion: (id: string, versionId: string, expectedContent?: string) =>
    invoke<{ path: string; content: string } | null>('restore_memo_version', {
      id,
      versionId,
      expectedContent,
    }),
  deleteVersion: (id: string, versionId: string) =>
    invoke<boolean>('delete_memo_version', { id, versionId }),
  search: (notebookId: string | null, query: string, limit?: number) =>
    invoke<{ hits: MemoSearchHit[]; indexReady: boolean }>('search_memos', {
      notebookId,
      query,
      limit,
    }),
  // 鍏ㄥ眬"閫氳繃閾炬帴鎵撳紑绗旇"鍏ュ彛 鈹€鈹€ 鎺ユ敹浠绘剰褰㈠紡鐨?`flowix://` URL / 鐗╃悊璺緞,
  // 鍚庣璧?parser + resolver, 杩斿洖 ResolvedOpenTarget銆?null 琛ㄧず瑙ｆ瀽澶辫触
  // (id 涓嶅瓨鍦?/ 璺緞涓嶅湪 notebook 鍐?/ 鐗╃悊璺緞鎸囧悜宸插垹绗旇)銆?閰嶅悎
  // `lib/openByTarget/listener.ts` 鐩戝惉 `flowix:open-target` 浜嬩欢 鈹€鈹€ 涓诲姩
  // 璋冪敤 (noteReference 鍙屽嚮 / Agent 宸ュ叿) 璧?await, 琚姩娲惧彂 (澶栭儴娣遍摼 /
  // single-instance 浜屾鍚姩) 璧颁簨浠躲€?涓ゆ潯璺緞姹囧悎鍒板悓涓€ `openNoteByTarget`銆?
  openMemoByTarget: (raw: string, options?: { emitEvent?: boolean }) => invoke<{
    memoId: string;
    notebookId: string;
    notebookName: string;
    notebookPath: string;
    absolutePath: string;
    memoTitle: string;
  } | null>('open_memo_by_target', { raw, emitEvent: options?.emitEvent ?? true }),
};

// Tags
export const tags = {
  getAll: (notebookId?: string) =>
    invoke<{ tags: { id: string; name: string }[] }>('get_all_tags', { notebookId }),
  create: (name: string) => invoke<{ id: string; name: string } | null>('create_memo_tag', { name }),
  rename: (id: string, name: string) => invoke<{ id: string; name: string } | null>('rename_memo_tag', { id, name }),
  delete: (id: string) => invoke<boolean>('delete_memo_tag', { id }),
};

// Notebooks
export const notebooks = {
  getAll: () => invoke<any[]>('get_notebooks'),
  create: (name: string, path: string, icon?: string | null) =>
    invoke<any>('create_notebook', { name, path, icon }),
  update: (id: string, name?: string, icon?: string | null) =>
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
  copyAttachmentFile: (sourcePath: string, targetPath: string) =>
    invoke<boolean>('copy_attachment_file', { sourcePath, targetPath }),
};

// Windows
export const windows = {
  openPreferences: (tab?: string) => invoke<void>('open_preferences_window', { tab }),
};

export interface ProductInfo {
  productName: string;
  version: string;
  configDir: string;
  dataDir: string;
  logDir: string;
  os: string;
  arch: string;
}

export const product = {
  getInfo: () => invoke<ProductInfo>('get_product_info'),
  getDiagnostics: () => invoke<string>('get_diagnostics'),
  openLogDir: () => invoke<void>('open_log_dir'),
};

// Agent
//
// AI 妯″瀷閰嶇疆浠?~/.flowix/flowix-ai-config.toml 涓虹湡婧?鈹€ 瑙?aiConfig.set/get 涓婃柟銆?// 鍓嶇涓嶅啀 init agent / 鎻愪氦妯″瀷淇℃伅: chat / thread 璋冪敤鏃? 鍚庣鎸夐渶璇诲彇閰嶇疆
// 骞舵儼鎬ф瀯寤?provider 瀹炰緥 (瑙?backend/src/agent.rs AgentManager::ensure_instance)銆?//
// 瀛楁鍛藉悕: 鍚庣 AiModelConfig 鐢?`#[serde(rename_all = "camelCase")]`, 鎵€浠?// IPC 浼犺繃鍘诲繀椤绘槸 camelCase 鈹€ snake_case 浼氳 serde 闈欓粯涓㈠純, 瀛楁鍏ㄩ儴鍥為€€
// 鍒?#[serde(default)] = 绌轰覆, 琛ㄧ幇灏辨槸"淇濆瓨鍚庡埛鏂?apiKey/apiUrl 閮界┖浜?銆?
export interface AgentConfig {
  provider: string;
  model: string;
  apiUrl: string;
  apiKey: string;
}

interface ChatResponse {
  response: string;
}

interface AgentUserMessage {
  content: string;
  llmContent?: string;
  systemReminderDirectory?: string;
  systemReminderDocumentPath?: string;
  runtime?: AgentRuntime;
  permissionMode?: AgentPermissionMode;
  codexModel?: AgentCodexModel;
}

export interface ThreadInfo {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export const agent = {
  chatStream: (threadId: string, message: AgentUserMessage) =>
    invoke<ChatResponse>('chat_with_agent_stream', { threadId, message }),
  // 缁堟杩愯涓殑 chat_stream銆傚悗绔?AgentManager.stop_chat 缈昏浆 cancel flag,
  // 姝ｅ湪璺戠殑 ReAct 寰幆鍦ㄤ笅涓€涓?checkpoint 妫€娴嬪埌鍚庤皟 flush_cancel 閫€鍑恒€?
  // 杩斿洖 true = 鎴愬姛瑙﹀彂浜嗗彇娑? false = 褰撳墠娌℃湁 chat 鍦ㄨ窇 (no-op)銆?
  stopChatStream: (threadId: string) =>
    invoke<boolean>('stop_agent_stream', { threadId }),
  // 鏌ヨ褰撳墠 in-flight chat 闆嗗悎 鈹€鈹€ 鍚姩鏃跺墠绔皟涓€娆? seed
  // `threadStates[].isLoading`銆?绌?map 琛ㄧず褰撳墠娌℃湁 in-flight chat銆?
  // 鍚庣闀滃儚 `cancel_flags` 鐨勭敓鍛藉懆鏈? 涓?`StreamStart/End` chunk 鍚屾銆?
  runningThreads: () =>
    invoke<Record<string, RunInfo>>('agent_running_threads'),
  listThreads: () =>
    invoke<ThreadInfo[]>('thread_list'),
  createThread: (title: string) =>
    invoke<ThreadInfo>('thread_create', { title }),
  getThread: (threadId: string) =>
    invoke<{ messages: ChatMessage[] }>('thread_get', { threadId }),
  /**
   * Layer 4: 鍒嗛〉鍔犺浇 thread 鍘嗗彶. 杩斿洖 { messages (ASC), oldestSequence, hasMore }.
   *  - beforeSequence = null/undefined 鈫?鍙栨渶杩?limit 鏉?   *  - beforeSequence = N 鈫?鍙?sequence < N 鐨勬渶杩?limit 鏉?(鍚戜笂缈婚〉)
   * 鏈嶅姟绔?clamp limit 鍒?[1, 1000].
   */
  getThreadPage: (
    threadId: string,
    beforeSequence: number | null,
    limit: number,
  ) =>
    invoke<{
      messages: ChatMessage[];
      oldestSequence: number | null;
      hasMore: boolean;
    }>('thread_get_page', { threadId, beforeSequence, limit }),
  listCodexThreads: () =>
    invoke<ThreadInfo[]>('codex_thread_list'),
  getCodexThread: (threadId: string) =>
    invoke<{ messages: ChatMessage[] }>('codex_thread_get', { threadId }),
  getCodexSessionId: (threadId: string) =>
    invoke<string | null>('codex_thread_session_id', { threadId }),
  getCodexDefaultModel: () =>
    invoke<string>('codex_default_model'),
  deleteThread: (threadId: string) =>
    invoke<void>('thread_delete', { threadId }),
  // 閲嶅懡鍚?thread 鈹€鈹€ 棣栨潯鐢ㄦ埛娑堟伅钀藉湴鍚庤皟涓€娆? 瑕嗙洊 ensureThread 璧?early return
  // 鏃剁殑婕忕綉涔嬮奔(鐐硅繃"鏂板缓瀵硅瘽"鍐嶅彂娑堟伅鐨勫満鏅?銆傝繑鍥?None 琛ㄧず thread 涓嶅瓨鍦ㄣ€?
  updateThreadTitle: (threadId: string, title: string) =>
    invoke<ThreadInfo | null>('thread_update_title', { threadId, title }),
};

// Stream event handling
//
// **妯″潡绾у崟渚?listener** 鈹€鈹€ 杩欓噷鍙厑璁告敞鍐屼竴娆? 鏁翠釜 app 鍏变韩鍚屼竴浠?// 鐩戝惉銆俙useAgentEvents` 鍦?App.tsx 椤跺眰鎸備竴娆? 鎶?chunk 娲惧彂鍒?chat-store
// 鐨?`dispatchAgentChunk` action; 澶氫釜缁勪欢 (涓荤獥鍙?/ 鍋忓ソ绐楀彛) 涓嶅啀鍚勮嚜
// 鎸?listener 鈹€鈹€ 閬垮厤 chunk 琚涓?handler 閲嶅澶勭悊銆?//
// 鍘嗗彶: 鏃х増 `listenToAgentStream` 鏄?`sendMessageStream` 鍐呮瘡娆″彂娑堟伅鎸?// 涓€娆? 鏀跺埌 `finally` 璋?`stopListeningToAgentStream` 鍗告帀銆?鏂版ā鍨嬩笅
// listener 闀垮湪, 姘歌繙涓嶅嵏, 娲惧彂鍣ㄨ嚜宸辨寜 `thread_id` 璺敱鍒版纭殑 store
// 鐘舵€併€?鏃ц皟鐢ㄧ偣 (chat-store.ts: sendMessageStream 閲岀殑
// `listenToAgentStream((chunk) => ...)`) 宸茬粡鏁翠綋鏇挎崲涓哄崟鐐?dispatch銆?
type StreamCallback = (chunk: AgentChunk) => void;

// CLI sidecar JSON-RPC 鈹€鈹€ 閫氳繃鍚庣 `cli_invoke` 鍛戒护璧?`flowix-cli serve` 瀛愯繘绋嬨€?// 鍚庣 spawn sidecar 杩涚▼, 缁存姢 stdin/stdout 鍙屽悜娴? 鎶?method + params 鍖呮垚
// line-delimited JSON 鍙戣繃鍘? 绛夊搷搴斿洖鍓嶇銆?鍗忚灞傝 `app/flowix-cli/src/serve.rs`銆?//
// 褰撳墠鐩存帴娑堣垂鑰? command palette (鏈潵), agent filesystem 宸ュ叿 (鏈潵)銆?
// v1 鍙槸鍏堟毚闇插叆鍙? 瀹為檯璋冪敤鏂逛細鍦ㄥ悗缁伐鍗曢噷鎺ャ€?
export const cli = {
  invoke: <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> =>
    invoke<T>('cli_invoke', { method, params: params ?? {} }),
};

// 鍐呴儴浠呬繚鐣欏巻鍙?API 鍚嶅瓧; 瀹炵幇鍏ㄩ儴璧?event-bus銆?// 澶氫釜璋冪敤鐐?(chat-store 涓?useAgentEvents) 鍏变韩鍚屼竴浠?Tauri listener,
// 涓嶅啀闇€瑕佹墜宸ヨ窡韪?streamUnlisten銆?鍘?streamUnlisten 浠呯敤浜庡畬鍏?
// 鍗歌浇 (stopListeningToAgentStream), 鐜板湪涔熻蛋 event-bus.unsubscribe銆?
export function listenToAgentStream(callback: StreamCallback): UnlistenFn {
  return subscribe<AgentChunk>('agent-chunk', callback);
}

// ============================================
// 璺ㄧ獥鍙ｅ悓姝?// ============================================
// 鍚庣 set_preference / set_ai_config 鎴愬姛鍚?emit 'user-config-changed',
// payload 鏄?"preference" | "ai_config" 鎸囨槑鍝釜鏂囦欢鍙樹簡銆?// 鍏跺畠绐楀彛鏀跺埌鍚庝粠纾佺洏閲嶆柊 load, 瑙ｅ喅: 涓や釜 Tauri 绐楀彛鍚勮窇鐙珛 React 鏍?// + 鐙珛 zustand store, 涓€杈规敼鍔ㄥ彟涓€杈圭湅涓嶅埌鐨勯棶棰樸€?
type UserConfigChangeKind = 'preference' | 'ai_config';
type UserConfigChangeHandler = (kind: UserConfigChangeKind) => void;

export function listenToUserConfigChanges(
  handler: UserConfigChangeHandler,
): UnlistenFn {
  return subscribe<UserConfigChangeKind>('user-config-changed', handler);
}

// 鍘嗗彶鍏煎: useEffect cleanup 浠嶆湁浜烘墜璋冭繖涓┖鍑芥暟(渚嬪
// `preferences/sections/agent.tsx`)銆?鍐呴儴璧?event-bus.unsubscribe 涓嶉渶瑕?
// 鍏ㄩ噺 reset, GC 鑷劧娓呯悊灏辫銆?涓嶅垹閬垮厤鐮村潖璋冪敤鏂广€?
export function stopListeningToUserConfigChanges(): void {
  // 璧?event-bus 鐨?UnlistenFn, 涓氬姟涓婂簲璇ヨ
  // subscribe 杩斿洖鐨?unlisten 璧?useEffect cleanup, 涓嶈鎵嬪伐璋?stopXxx銆?
}

// Agent 鍙闂洰褰曞彉鏇翠簨浠?鈹€鈹€ 鍚庣 set_agent_access / notebook CRUD
// 閽╁瓙浠讳竴鎴愬姛閮?emit, payload 鏄?`()` (鏃?payload), 鐩戝惉鑰呯洿鎺?
// `loadInitial()` 鎷夋暣浠?config銆?涓?`user-config-changed` 鍚屽舰銆?
type AgentAccessChangeHandler = () => void;

export function listenToAgentAccessChanges(
  handler: AgentAccessChangeHandler,
): UnlistenFn {
  return subscribe<unknown>('agent-access-changed', () => handler());
}

export function listenToNotebookImportComplete(
  handler: (notebookId: string) => void,
): UnlistenFn {
  return subscribe<string>('notebook-import-complete', handler);
}
