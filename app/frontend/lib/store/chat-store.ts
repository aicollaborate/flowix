import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, ThreadListItem } from '../../types';
import { STORAGE_KEYS } from '../constants';
import { agent, listenToAgentStream, stopListeningToAgentStream } from '../tauri/client';
import { useMemoStore } from './memo-store';
import { useDocumentStore } from './document-store';
import { isEmptyAssistantMessage } from '../message/empty';

function joinPath(basePath: string, filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\')) {
    return filePath;
  }
  return `${basePath.replace(/[\\/]+$/, '')}\\${filePath.replace(/^[\\/]+/, '')}`;
}

function buildDirectoryReminder(directory: string, notePath?: string): string {
  const noteLine = notePath ? `\n当前笔记：${notePath}` : '';
  return `<system-reminder>\n当前目录：${directory}${noteLine}\n</system-reminder>`;
}

function buildUserLlmContent(content: string, messages: ChatMessage[]): {
  llmContent: string;
  systemReminderDirectory?: string;
  systemReminderDocumentPath?: string;
} {
  const memoState = useMemoStore.getState();
  const documentState = useDocumentStore.getState();
  const currentDirectory = memoState.selectedNotebook?.path?.trim();
  if (!currentDirectory) {
    return { llmContent: content };
  }

  const currentNotePath = documentState.currentDocumentPath?.trim()
    || (memoState.selectedMemo?.path ? joinPath(currentDirectory, memoState.selectedMemo.path) : undefined);

  const lastReminderMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.systemReminderDirectory);

  if (
    lastReminderMessage?.systemReminderDirectory === currentDirectory &&
    lastReminderMessage.systemReminderDocumentPath === currentNotePath
  ) {
    return { llmContent: content };
  }

  return {
    llmContent: `${content}\n\n${buildDirectoryReminder(currentDirectory, currentNotePath)}`,
    systemReminderDirectory: currentDirectory,
    systemReminderDocumentPath: currentNotePath,
  };
}

function parseToolEvent(chunk: string, prefix: string): any | null {
  if (!chunk.startsWith(prefix)) {
    return null;
  }

  try {
    return JSON.parse(chunk.slice(prefix.length).trim());
  } catch (err) {
    console.error('[ChatStore] Failed to parse tool event:', err);
    return null;
  }
}

function toToolInput(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function buildThreadTitle(content: string): string {
  const title = content.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 28) : '新对话';
}

export interface ChatStore {
  messages: ChatMessage[];
  threadId: string | undefined;
  isLoading: boolean;
  streamingContent: string;
  streamingReasoningContent: string;
  threadList: ThreadListItem[];
  currentThreadTitle: string | undefined;
  /**
   * One-shot prompt staged by external callers (e.g. the editor selection bubble
   * menu) for the inputbox to pick up on the next render. Cleared as soon as the
   * inputbox consumes it via `consumePendingPrompt`.
   */
  pendingPrompt: string | undefined;
  /**
   * One-shot citation staged alongside the prompt — rendered as a card above
   * the input area and emitted in the outgoing user message wrapped in
   * `<citation>…</citation>` tags. Cleared on send or on dismiss.
   */
  pendingCitation: string | undefined;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setThreadId: (id: string | undefined) => void;
  clearMessages: () => void;
  updateLastMessage: (updates: Partial<ChatMessage>) => void;
  setIsLoading: (loading: boolean) => void;
  appendStreamingContent: (chunk: string) => void;
  clearStreamingContent: () => void;
  appendStreamingReasoning: (chunk: string) => void;
  clearStreamingReasoning: () => void;
  setThreadList: (list: ThreadListItem[]) => void;
  setCurrentThreadTitle: (title: string | undefined) => void;
  setPendingPrompt: (prompt: string | undefined) => void;
  consumePendingPrompt: () => string | undefined;
  setPendingCitation: (citation: string | undefined) => void;
  consumePendingCitation: () => string | undefined;
  loadThreadList: () => Promise<void>;
  loadThread: (threadId: string) => Promise<void>;
  createThread: (title?: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendMessageStream: (content: string) => Promise<void>;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => {
      // 首次 send 时若没有 thread, 先创建一个。 thread 不再绑定 agent 信息 —
      // 后端按需读 ai_config.json, 取消了 agent_id 透传。
      const ensureThread = async (content: string): Promise<string> => {
        const existingThreadId = get().threadId;
        if (existingThreadId) {
          return existingThreadId;
        }

        const thread = await agent.createThread(buildThreadTitle(content));
        set({
          threadId: thread.threadId,
          currentThreadTitle: thread.title,
          messages: [],
        });
        await get().loadThreadList();
        return thread.threadId;
      };

      return {
        messages: [],
        threadId: undefined,
        isLoading: false,
        streamingContent: '',
        streamingReasoningContent: '',
        threadList: [],
        currentThreadTitle: undefined,
        pendingPrompt: undefined,
        pendingCitation: undefined,

        addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
        setMessages: (messages) => set({ messages }),
        setThreadId: (id) => set({ threadId: id }),
        clearMessages: () => set({ messages: [], threadId: undefined, currentThreadTitle: undefined }),
        updateLastMessage: (updates) =>
          set((state) => ({
            messages: state.messages.map((m, i) =>
              i === state.messages.length - 1 ? { ...m, ...updates } : m
            ),
          })),
        setIsLoading: (loading) => set({ isLoading: loading }),
        appendStreamingContent: (chunk) =>
          set((state) => ({ streamingContent: state.streamingContent + chunk })),
        clearStreamingContent: () => set({ streamingContent: '' }),
        appendStreamingReasoning: (chunk) =>
          set((state) => ({ streamingReasoningContent: state.streamingReasoningContent + chunk })),
        clearStreamingReasoning: () => set({ streamingReasoningContent: '' }),
        setThreadList: (list) => set({ threadList: list }),
        setCurrentThreadTitle: (title) => set({ currentThreadTitle: title }),
        setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
        consumePendingPrompt: () => {
          const { pendingPrompt } = get();
          if (pendingPrompt !== undefined) {
            set({ pendingPrompt: undefined });
          }
          return pendingPrompt;
        },
        setPendingCitation: (citation) => set({ pendingCitation: citation }),
        consumePendingCitation: () => {
          const { pendingCitation } = get();
          if (pendingCitation !== undefined) {
            set({ pendingCitation: undefined });
          }
          return pendingCitation;
        },

        loadThreadList: async () => {
          try {
            const threads = await agent.listThreads();
            set({ threadList: threads });
          } catch (err) {
            console.error('Failed to load thread list:', err);
          }
        },

        loadThread: async (threadId) => {
          try {
            const thread = await agent.getThread(threadId);
            const threadInfo =
              get().threadList.find((item) => item.threadId === threadId) ??
              (await agent.listThreads()).find((item) => item.threadId === threadId);
            // Drop empty assistant messages that older sessions may have
            // persisted — they render as blank cards and add no value.
            const messages = thread.messages.filter((m) => !isEmptyAssistantMessage(m));
            set({
              threadId,
              messages,
              currentThreadTitle: threadInfo?.title ?? '未命名对话',
            });
          } catch (err) {
            console.error('Failed to load thread:', err);
          }
        },

        createThread: async (title = '新对话') => {
          try {
            const thread = await agent.createThread(title);
            set({
              messages: [],
              threadId: thread.threadId,
              currentThreadTitle: thread.title,
            });
            await get().loadThreadList();
          } catch (err) {
            console.error('Failed to create thread:', err);
          }
        },

        deleteThread: async (threadId) => {
          try {
            await agent.deleteThread(threadId);
            set((state) => ({
              threadList: state.threadList.filter((t) => t.threadId !== threadId),
              ...(state.threadId === threadId
                ? { messages: [], threadId: undefined, currentThreadTitle: undefined }
                : {}),
            }));
          } catch (err) {
            console.error('Failed to delete thread:', err);
          }
        },

        sendMessage: async (content) => {
          return get().sendMessageStream(content);
        },

        sendMessageStream: async (content) => {
          const {
            appendStreamingContent,
            clearStreamingContent,
            appendStreamingReasoning,
            clearStreamingReasoning,
          } = get();

          let effectiveThreadId: string;
          try {
            effectiveThreadId = await ensureThread(content);
          } catch (err) {
            console.error('Failed to ensure thread:', err);
            set({ isLoading: false });
            return;
          }

          const userPayload = buildUserLlmContent(content, get().messages);
          const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            llmContent: userPayload.llmContent,
            systemReminderDirectory: userPayload.systemReminderDirectory,
            systemReminderDocumentPath: userPayload.systemReminderDocumentPath,
            timestamp: new Date().toISOString(),
          };
          set((state) => ({ messages: [...state.messages, userMessage] }));

          clearStreamingContent();
          clearStreamingReasoning();
          set({ isLoading: true });

          let reasoningMessageId: string | null = null;
          let assistantMessageId: string | null = null;
          let hasAnyAssistantText = false;

          await listenToAgentStream((chunk) => {
            const toolCallEvent = parseToolEvent(chunk, '[TOOL_CALL]: ');
            if (toolCallEvent) {
              assistantMessageId = null;
              const toolMessage: ChatMessage = {
                id: `tool-${toolCallEvent.id || Date.now()}`,
                role: 'tool',
                content: '',
                timestamp: new Date().toISOString(),
                toolCallId: String(toolCallEvent.id || ''),
                toolName: String(toolCallEvent.name || ''),
                toolInput: toToolInput(toolCallEvent.input),
                isLoading: true,
              };
              set((state) => ({ messages: [...state.messages, toolMessage] }));
              return;
            }

            const toolResultEvent = parseToolEvent(chunk, '[TOOL_RESULT]: ');
            if (toolResultEvent) {
              assistantMessageId = null;
              const resultContent = JSON.stringify(toolResultEvent.result ?? {}, null, 2);
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.role === 'tool' && m.toolCallId === String(toolResultEvent.id || '')
                    ? {
                        ...m,
                        content: resultContent,
                        toolData: resultContent,
                        toolName: String(toolResultEvent.name || m.toolName || ''),
                        isLoading: false,
                      }
                    : m
                ),
              }));
              return;
            }

            if (chunk.startsWith('[REASONING]: ')) {
              const reasoningText = chunk.slice('[REASONING]: '.length);
              appendStreamingReasoning(reasoningText);

              if (!reasoningMessageId) {
                reasoningMessageId = `reasoning-${Date.now()}`;
                const reasoningMessage: ChatMessage = {
                  id: reasoningMessageId,
                  role: 'reasoning',
                  content: reasoningText,
                  timestamp: new Date().toISOString(),
                  isCompleted: false,
                };
                set((state) => ({ messages: [...state.messages, reasoningMessage] }));
              } else {
                set((state) => ({
                  messages: state.messages.map((m) =>
                    m.id === reasoningMessageId ? { ...m, content: m.content + reasoningText } : m
                  ),
                }));
              }
              return;
            }

            // Skip empty/whitespace-only chunks to avoid creating empty
            // assistant placeholders between tool calls. The LLM stream may
            // emit pure-whitespace chunks (e.g. "\n" or "") that would
            // otherwise produce a visible empty card here.
            if (!chunk || !chunk.trim()) {
              return;
            }

            hasAnyAssistantText = true;
            appendStreamingContent(chunk);
            if (reasoningMessageId) {
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === reasoningMessageId ? { ...m, isCompleted: true } : m
                ),
              }));
            }

            if (!assistantMessageId) {
              assistantMessageId = `assistant-${Date.now()}`;
              const assistantMessage: ChatMessage = {
                id: assistantMessageId,
                role: 'assistant',
                content: chunk,
                timestamp: new Date().toISOString(),
              };
              set((state) => ({ messages: [...state.messages, assistantMessage] }));
            } else {
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === assistantMessageId ? { ...m, content: m.content + chunk } : m
                ),
              }));
            }
          });

          try {
            const response = await agent.chatStream(effectiveThreadId, {
              content,
              llmContent: userPayload.llmContent,
              systemReminderDirectory: userPayload.systemReminderDirectory,
              systemReminderDocumentPath: userPayload.systemReminderDocumentPath,
            });

            if (reasoningMessageId) {
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === reasoningMessageId ? { ...m, isCompleted: true } : m
                ),
              }));
            }

            if (!hasAnyAssistantText && response.response && response.response.trim()) {
              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: response.response,
                timestamp: new Date().toISOString(),
              };
              set((state) => ({ messages: [...state.messages, assistantMessage] }));
            }
            await get().loadThreadList();
          } catch (err) {
            console.error('Failed to send message:', err);
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: typeof err === 'string' && err
                ? err
                : '抱歉，发生了错误。',
              timestamp: new Date().toISOString(),
            };
            set((state) => ({ messages: [...state.messages, errorMessage] }));
          } finally {
            stopListeningToAgentStream();
            clearStreamingContent();
            clearStreamingReasoning();
            set({ isLoading: false });
          }
        },
      };
    },
    {
      name: STORAGE_KEYS.CHAT,
      partialize: (state) => ({
        threadId: state.threadId,
        currentThreadTitle: state.currentThreadTitle,
      }),
    }
  )
);
