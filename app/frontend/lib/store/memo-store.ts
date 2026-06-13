import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { memos, notebooks, type FilterType, type SortType } from '../tauri/client';
import { STORAGE_KEYS } from '../constants';

// 文档颜色标签 — 跟后端 `MemoColor` 镜像 (`#[serde(rename_all = "lowercase")]`),
// 写入 list.json。单文档可挂多个色, 空数组即"无颜色"。色值在
// `MEMO_COLOR_HEX` 集中维护, picker / 列表 dot 共用。
export type MemoColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'gray';

export const MEMO_COLORS: readonly MemoColor[] = [
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'gray',
] as const;

/** 7 色色板 ── 跟主题解耦, 在 light / dark / rock 下都使用同一组色值。 */
export const MEMO_COLOR_HEX: Record<MemoColor, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  gray: '#9ca3af',
};

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
  colors: MemoColor[];
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

const LOCAL_CREATE_EVENT_TTL_MS = 5000;
const localCreatedMemoIds = new Map<string, number>();
let localCreateInFlightCount = 0;

export function beginLocalMemoCreate(): void {
  localCreateInFlightCount += 1;
}

export function markLocalMemoCreated(id: string): void {
  if (localCreateInFlightCount > 0) {
    localCreateInFlightCount -= 1;
  }
  localCreatedMemoIds.set(id, Date.now() + LOCAL_CREATE_EVENT_TTL_MS);
}

export function cancelLocalMemoCreate(): void {
  if (localCreateInFlightCount > 0) {
    localCreateInFlightCount -= 1;
  }
}

export function shouldSuppressLocalCreatedMemo(id: string, source?: string): boolean {
  const expiresAt = localCreatedMemoIds.get(id);
  if (expiresAt) {
    localCreatedMemoIds.delete(id);
    if (expiresAt >= Date.now()) {
      return true;
    }
  }

  if (source === 'user_new' && localCreateInFlightCount > 0) {
    localCreateInFlightCount -= 1;
    return true;
  }

  return false;
}

function compareMemoItems(filter: FilterType, sort: SortType) {
  return (a: MemoItem, b: MemoItem) => {
    if (filter === 'all' && a.favorited !== b.favorited) {
      return Number(b.favorited) - Number(a.favorited);
    }

    if (sort === 'updatedAt') {
      return b.updatedAt - a.updatedAt;
    }

    return b.createdAt - a.createdAt;
  };
}

function memoMatchesFilter(memo: MemoItem, filter: FilterType): boolean {
  const now = new Date();
  switch (filter) {
    case 'todos':
      return memo.todos.length > 0;
    case 'favorited':
      return memo.favorited;
    case 'tagged':
      return memo.tags.length > 0;
    case 'thisWeek': {
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - diffToMonday);
      return memo.createdAt >= start.getTime() && memo.createdAt <= now.getTime();
    }
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return memo.createdAt >= start && memo.createdAt <= now.getTime();
    }
    default:
      return true;
  }
}

function upsertSortedMemo(
  current: MemoItem[],
  memo: MemoItem,
  filter: FilterType,
  sort: SortType
): MemoItem[] {
  const withoutExisting = current.filter((item) => item.id !== memo.id);
  if (!memoMatchesFilter(memo, filter)) {
    return withoutExisting;
  }
  return [...withoutExisting, memo].sort(compareMemoItems(filter, sort));
}

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
  upsertMemo: (memo: MemoItem) => void;
  // Incremental memo update (avoids full reload)
  updateMemoMeta: (id: string, meta: Partial<Pick<MemoItem, 'updatedAt' | 'preview' | 'favorited'>>) => void;
  // 注: 历史上还有 `syncMemoMeta` 这个 store action, 它在 IPC 层就是把
  // `filename` / `preview` 推给后端 `update_memo_db`。但编辑器的实际保存
  // 路径是 `useDocumentAutosave` → `writeDocument` (IPC 写盘) →
  // `useMemoMetadataSync.syncMemoMetadata` → 直接调 `updateMemoDb`, 整个
  // 流程根本不走 store action。`syncMemoMeta` 仓内 0 调用方 ── 已删除,
  // 避免后人误把它当成另一条保存路径。
  // Data loading
  loadMemos: (params?: { notebookId?: string; filter?: FilterType; sort?: SortType; tagId?: string }) => Promise<void>;
  loadNotebooks: () => Promise<void>;
  createMemo: (tag?: string, notebookId?: string) => Promise<MemoItem>;
  deleteMemo: (id: string) => Promise<boolean>;
  favoriteMemo: (id: string) => Promise<boolean>;
  unfavoriteMemo: (id: string) => Promise<boolean>;
  setMemoColors: (id: string, colors: MemoColor[]) => Promise<boolean>;

  // 后端 memo-event 推送的 store action — 由 useMemoEvents 监听器调用。
  // 设计: 只做"乐观更新" + `triggerRefresh`, 真正重排 / preview 刷新走
  // MemoList 里 [refreshTrigger] useEffect 的 loadData 管线, 避免在 store
  // 里维护两套排序逻辑。
  handleMemoCreated: (memo?: MemoItem, options?: { select?: boolean }) => void;
  handleMemoUpdated: (id: string) => Promise<MemoItem | null>;
  handleMemoDeleted: (id: string) => void;
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

      upsertMemo: (memo) => {
        set((state) => ({
          memos: state.memos.some((item) => item.id === memo.id)
            ? upsertSortedMemo(state.memos, memo, state.activeFilter, state.activeSort)
            : state.memos,
          selectedMemo:
            state.selectedMemo?.id === memo.id
              ? { ...memo, isOpen: state.selectedMemo.isOpen }
              : state.selectedMemo,
        }));
      },

      updateMemoMeta: (id, meta) => {
        const nextMeta = omitUndefined(meta);
        set((state) => ({
          memos: state.memos.map((m) => m.id === id ? { ...m, ...nextMeta } : m),
          selectedMemo: state.selectedMemo?.id === id
            ? { ...state.selectedMemo, ...nextMeta }
            : state.selectedMemo,
        }));
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
        const latestSelectedMemo = get().selectedMemo;
        const selectedMemo = latestSelectedMemo
          ? nextMemos.find((memo) => memo.id === latestSelectedMemo.id) ?? null
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
        markLocalMemoCreated((memo as MemoItem).id);
        set({
          memos: upsertSortedMemo(state.memos, memo as MemoItem, state.activeFilter, state.activeSort),
        });
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

      // 设置 / 清除文档颜色标签 (多选)。 乐观更新: 本地先改 `colors`,
      // 后端 `set_memo_colors` 写 list.json + emit `Updated` 事件,
      // 后续 `useMemoEvents` 收到后调 `readMemo` 把权威值回灌, 自然收敛。
      setMemoColors: async (id, colors) => {
        const state = get();
        const next = state.memos.map((m) => m.id === id ? { ...m, colors } : m);
        const nextSelected = state.selectedMemo?.id === id
          ? { ...state.selectedMemo, colors }
          : state.selectedMemo;
        set({ memos: next, selectedMemo: nextSelected });
        return await memos.setMemoColors(id, colors);
      },

      // ===== memo-event 推送入口 =====
      // useMemoEvents 监听后端 memo-event, 按 kind 派发到下面三个 action。
      // 仅做"乐观更新" (UI 立刻动) + 触发 refreshTrigger, 真正的 sort / preview
      // 重算走 MemoList 的 [refreshTrigger] useEffect → loadData → get_memos 拉一遍。
      // 这样 store 不维护第二套排序, list.json 是唯一真源。

      handleMemoCreated: (memo, options) => {
        if (!memo) {
          get().triggerRefresh();
          return;
        }

        set((state) => ({
          memos:
            state.activeFilter === 'tagged'
              ? state.memos
              : upsertSortedMemo(state.memos, memo, state.activeFilter, state.activeSort),
          selectedMemo:
            options?.select
              ? { ...memo, isOpen: true }
              : state.selectedMemo?.id === memo.id
                ? { ...memo, isOpen: state.selectedMemo.isOpen }
                : state.selectedMemo,
        }));
        if (get().activeFilter === 'tagged') {
          get().triggerRefresh();
        }
      },

      handleMemoUpdated: async (id) => {
        // 事件 payload 只带 id, 权威值要走 readMemo 拿。等真实值回来一次性
        // upsertMemo (走 upsertSortedMemo 自然按 updatedAt 排序), 不再乐观
        // 占位 Date.now() ── 避免 "占位时间排一次, 真值时间又排一次" 的视觉闪。
        // 改前: set(updatedAt: Date.now()) + readMemo().then(upsertMemo) ──
        // 占位期间排序抖动, 且与 useMemoEvents.syncActiveDocumentPathIfRenamed
        // 走第二次 readMemo 重复 IPC。
        // 改后: 直接 readMemo 拿权威 memo, 调 upsertMemo 合并。
        //
        // 返回拿到的 memo 给 `useMemoEvents` 复用 ── `syncActiveDocumentPathIfRenamed`
        // 之前会再 readMemo 一次, 现在用这个 prefetchedMemo 跳过第二次 IPC。
        const memo = await memos.readMemo(id);
        if (memo) {
          get().upsertMemo(memo as MemoItem);
        }
        return memo as MemoItem | null;
      },

      handleMemoDeleted: (id) => {
        set((state) => ({
          memos: state.memos.filter((m) => m.id !== id),
          selectedMemo:
            state.selectedMemo?.id === id ? null : state.selectedMemo,
        }));
        // Deleted 不 bump refreshTrigger — 列表已经同步, 没有需要重拉的派生字段
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
