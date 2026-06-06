import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { memos, notebooks, type FilterType, type SortType } from '../tauri/client';
import { STORAGE_KEYS } from '../constants';

export interface MemoItem {
  id: string;
  filename: string;
  preview: string;
  tags: string[];
  todos: { content: string; status: string }[];
  createdAt: number;
  updatedAt: number;
  favorited: boolean;
  icon: string | null;
  path?: string | null;
  isOpen?: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  icon: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  isDefault: boolean;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'completed';
}

export interface MemoMeta {
  type: string;
  agent_name?: string;
  agent_description?: string;
}

export type SortOption = 'createdAt' | 'updatedAt' | 'title';

export interface MemoStore {
  // List data
  memos: MemoItem[];
  notebooks: Notebook[];
  // Selection state
  selectedMemo: MemoItem | null;
  selectedNotebook: Notebook | null;
  // UI filter/sort
  activeFilter: FilterType;
  activeSort: SortType;
  // Reload trigger
  refreshTrigger: number;

  // Setters
  setMemos: (memos: MemoItem[]) => void;
  setNotebooks: (notebooks: Notebook[]) => void;
  setSelectedMemo: (memo: MemoItem | null) => void;
  setSelectedNotebook: (notebook: Notebook | null) => void;
  setActiveFilter: (filter: FilterType) => void;
  setActiveSort: (sort: SortType) => void;
  triggerRefresh: () => void;
  // Incremental memo update (avoids full reload)
  updateMemoMeta: (id: string, meta: Partial<Pick<MemoItem, 'updatedAt' | 'preview' | 'favorited'>>) => void;
  // Sync memo metadata to DB (tags, todos, filename) + store update
  syncMemoMeta: (id: string, meta: { filename?: string; preview?: string }) => Promise<void>;
  // Data loading
  loadMemos: (params?: { notebookId?: string; filter?: FilterType; sort?: SortType; tagId?: string }) => Promise<void>;
  loadNotebooks: () => Promise<void>;
  createMemo: (tag?: string, notebookId?: string) => Promise<MemoItem>;
  deleteMemo: (id: string) => Promise<boolean>;
  favoriteMemo: (id: string) => Promise<boolean>;
  unfavoriteMemo: (id: string) => Promise<boolean>;
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<T>;
}

export const useMemoStore = create<MemoStore>()(
  persist(
    (set, get) => ({
      memos: [],
      notebooks: [],
      selectedMemo: null,
      selectedNotebook: null,
      activeFilter: 'all',
      activeSort: 'createdAt',
      refreshTrigger: 0,

      setMemos: (memos) => set({ memos }),
      setNotebooks: (notebooks) => set({ notebooks }),
      setSelectedMemo: (memo) => set({ selectedMemo: memo }),
      setSelectedNotebook: (notebook) => set({ selectedNotebook: notebook }),
      setActiveFilter: (filter) => set({ activeFilter: filter }),
      setActiveSort: (sort) => set({ activeSort: sort }),
      triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),

      updateMemoMeta: (id, meta) => {
        const nextMeta = omitUndefined(meta);
        set((state) => ({
          memos: state.memos.map((m) => m.id === id ? { ...m, ...nextMeta } : m),
          selectedMemo: state.selectedMemo?.id === id
            ? { ...state.selectedMemo, ...nextMeta }
            : state.selectedMemo,
        }));
      },

      syncMemoMeta: async (id, meta) => {
        const nextMeta = omitUndefined(meta);
        // Update store immediately for responsiveness
        set((state) => ({
          memos: state.memos.map((m) => m.id === id ? { ...m, ...nextMeta } : m),
          selectedMemo: state.selectedMemo?.id === id
            ? { ...state.selectedMemo, ...nextMeta }
            : state.selectedMemo,
        }));
        // Async DB update
        await memos.updateMemoDb(id, meta.filename, undefined, meta.preview);
        set((state) => ({ refreshTrigger: state.refreshTrigger + 1 }));
      },

      loadMemos: async (params) => {
        const state = get();
        const response = await memos.getMemos({
          notebookId: params?.notebookId || state.selectedNotebook?.id,
          filter: params?.filter || state.activeFilter,
          sort: params?.sort || state.activeSort,
          tagId: params?.tagId,
        });
        const nextMemos = response.memos as MemoItem[];
        const selectedMemo = state.selectedMemo
          ? nextMemos.find((memo) => memo.id === state.selectedMemo?.id) ?? null
          : null;

        set({
          memos: nextMemos,
          selectedMemo,
        });
      },

      loadNotebooks: async () => {
        const nbList = await notebooks.getAll();
        set({ notebooks: nbList as Notebook[] });
      },

      createMemo: async (tag, notebookId) => {
        const memo = await memos.addDocument(tag, notebookId);
        const state = get();
        set({ memos: [...state.memos, memo as MemoItem] });
        return memo as MemoItem;
      },

      deleteMemo: async (id) => {
        const success = await memos.deleteMemo(id);
        if (success) {
          const state = get();
          set({
            memos: state.memos.filter(m => m.id !== id),
            selectedMemo: state.selectedMemo?.id === id ? null : state.selectedMemo,
          });
        }
        return success;
      },

      favoriteMemo: async (id) => {
        return await memos.favoriteMemo(id);
      },

      unfavoriteMemo: async (id) => {
        return await memos.unfavoriteMemo(id);
      },
    }),
    {
      name: STORAGE_KEYS.MEMO,
      partialize: (state) => ({
        selectedNotebook: state.selectedNotebook,
        selectedMemo: state.selectedMemo,
      }),
    }
  )
);
