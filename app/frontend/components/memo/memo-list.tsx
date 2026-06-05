'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareDashed, SquarePen, Search, ChevronDown } from 'lucide-react';
import { List, CheckSquare as CheckSquareIcon, HashStraightIcon, HashIcon, DotsSixIcon, EyeIcon, EyeSlashIcon, ArrowLineUpIcon, DotsThreeIcon } from "@phosphor-icons/react";
import { useMemoStore, useDocumentStore, type MemoItem } from '../../lib/store';
import type { Notebook } from '../../lib/store';
import { useTauriRpc } from '../../hooks/useTauriRpc';
import { files, notebooks as notebooksClient, settings as tauriSettings } from '../../lib/tauri/client';
import { joinNotebookMemoPath } from '../../lib/path';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { MemoCard } from './memo-card1';
import { MemoCardTodo, type MemoTodoListEntry } from './memo-card-todo';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '../ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const TAG_ORDER_SETTING_PREFIX = 'tag_order:';
const HIDDEN_TAGS_SETTING_PREFIX = 'hidden_tags:';

function getTagOrderSettingKey(notebookId: string): string {
  return `${TAG_ORDER_SETTING_PREFIX}${notebookId}`;
}

function getHiddenTagsSettingKey(notebookId: string): string {
  return `${HIDDEN_TAGS_SETTING_PREFIX}${notebookId}`;
}

interface MemoMetadataFile {
  todos?: MemoTodoListEntry[];
}

interface MemoListMetadataFile {
  memos?: Array<{
    tags?: string[];
  }>;
}

function getNotebookMemoMetadataPath(notebookPath: string): string {
  const clean = notebookPath.replace(/[\\/]+$/, '');
  return `${clean}/.metadata/memo.json`;
}

function getNotebookListMetadataPath(notebookPath: string): string {
  const clean = notebookPath.replace(/[\\/]+$/, '');
  return `${clean}/.metadata/list.json`;
}

function getTodoSelectionKey(todo: MemoTodoListEntry, index: number): string {
  return [
    todo.memoId,
    todo.createdAt ?? '',
    todo.updatedAt ?? '',
    todo.content,
    index,
  ].join(':');
}

export function MemoList() {
  const { request } = useTauriRpc();
  const {
    memos,
    selectedMemo,
    setSelectedMemo,
    selectedNotebook,
    setSelectedNotebook,
    refreshTrigger,
    triggerRefresh,
    notebooks,
    setNotebooks,
    activeFilter,
    activeSort,
    setActiveFilter,
    setActiveSort,
    loadMemos,
  } = useMemoStore();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [deleteMemo, setDeleteMemo] = useState<MemoItem | null>(null);
  const [createNotebookOpen, setCreateNotebookOpen] = useState(false);
  const [notebookDropdownOpen, setNotebookDropdownOpen] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [newNotebookPath, setNewNotebookPath] = useState('');
  const [tagMap, setTagMap] = useState<Record<string, string>>({});
  const [tagOptions, setTagOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [todoEntries, setTodoEntries] = useState<MemoTodoListEntry[]>([]);
  const [selectedTodoKey, setSelectedTodoKey] = useState<string | null>(null);
  const [tagOrder, setTagOrder] = useState<string[]>([]);
  const [hiddenTagIds, setHiddenTagIds] = useState<string[]>([]);
  const [draggingTagId, setDraggingTagId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [dragGhost, setDragGhost] = useState<{
    id: string;
    rect: DOMRect;
    currentY: number;
    offsetY: number;
  } | null>(null);
  const dragPointerRef = useRef<{
    sourceId: string;
    pointerId: number;
    startY: number;
    startX: number;
    offsetY: number;
    rect: DOMRect | null;
    isDragging: boolean;
  } | null>(null);
  const popoverRowRefs = useRef(new Map<string, HTMLDivElement>());
  const tagScrollRef = useRef<HTMLDivElement>(null);
  const tagButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const openMemoDocument = useCallback((memo: MemoItem, notebook: Notebook | null) => {
    const fullPath = notebook?.path ? joinNotebookMemoPath(notebook.path, memo.path) : memo.path ?? null;
    useDocumentStore.getState().setCurrentMemoDocumentPath(fullPath);
  }, []);

  useEffect(() => {
    if (selectedMemo) {
      openMemoDocument(selectedMemo, selectedNotebook);
    } else if (useDocumentStore.getState().currentDocumentSource !== 'external') {
      useDocumentStore.getState().setCurrentDocumentPath(null);
    }
  }, [openMemoDocument, selectedMemo, selectedNotebook]);

  const loadData = useCallback(async () => {
    const state = useMemoStore.getState();
    let currentNotebook = state.selectedNotebook;

    const notebooksResult = await notebooksClient.getAll();
    if (!notebooksResult || notebooksResult.length === 0) {
      return;
    }
    setNotebooks(notebooksResult);

    if (currentNotebook) {
      const currentId = currentNotebook.id;
      const exists = notebooksResult.some((n: Notebook) => n.id === currentId);
      if (exists) {
        currentNotebook = notebooksResult.find((n: Notebook) => n.id === currentId) || null;
      } else {
        // Persisted notebook no longer exists, find default
        const defaultNb = notebooksResult.find((n: Notebook) => n.isDefault) || notebooksResult[0];
        setSelectedNotebook(defaultNb);
        currentNotebook = defaultNb;
      }
    } else {
      // No persisted notebook, find default
      const defaultNb = notebooksResult.find((n: Notebook) => n.isDefault) || notebooksResult[0];
      setSelectedNotebook(defaultNb);
      currentNotebook = defaultNb;
    }

    if (!currentNotebook) {
      return;
    }

    const [tagsResult, listContent, tagOrderSetting, hiddenTagsSetting] = await Promise.all([
      request<{ tags: any[] }>('get_all_tags'),
      currentNotebook.path
        ? files.read(getNotebookListMetadataPath(currentNotebook.path), currentNotebook.path)
        : Promise.resolve(''),
      tauriSettings.get(getTagOrderSettingKey(currentNotebook.id)).catch(() => ({ value: null })),
      tauriSettings.get(getHiddenTagsSettingKey(currentNotebook.id)).catch(() => ({ value: null })),
    ]);

    const map: Record<string, string> = {};
    let nextSelectedTagId = selectedTagId;
    const allTagDefinitions = tagsResult?.tags ?? [];
    if (tagsResult?.tags) {
      for (const t of tagsResult.tags) {
        map[t.id] = t.name;
      }
      setTagMap(map);
    } else {
      setTagMap({});
    }

    const usedTagIds: string[] = [];
    const seenTagIds = new Set<string>();
    if (listContent) {
      try {
        const listMetadata = JSON.parse(listContent) as MemoListMetadataFile;
        for (const memo of listMetadata.memos ?? []) {
          for (const tagId of memo.tags ?? []) {
            if (tagId && !seenTagIds.has(tagId)) {
              seenTagIds.add(tagId);
              usedTagIds.push(tagId);
            }
          }
        }
      } catch (error) {
        console.warn('[MemoList] Failed to read list metadata tags:', error);
      }
    }

    // Reconcile persisted tag order with the currently-used tag ids.
    // - Drop ids that no longer exist in this notebook
    // - Append ids that are used but missing from the saved order
    let savedOrder: string[] = [];
    if (tagOrderSetting?.value) {
      try {
        const parsed = JSON.parse(tagOrderSetting.value);
        if (Array.isArray(parsed)) {
          savedOrder = parsed.filter((id): id is string => typeof id === 'string');
        }
      } catch (error) {
        console.warn('[MemoList] Failed to parse saved tag order:', error);
      }
    }
    const savedOrderFiltered = savedOrder.filter((id) => seenTagIds.has(id));
    const missingIds = usedTagIds.filter((id) => !savedOrderFiltered.includes(id));
    const nextTagOrder = [...savedOrderFiltered, ...missingIds];
    setTagOrder(nextTagOrder);

    const tagById = new Map(
      usedTagIds.map((id) => [id, map[id] ?? allTagDefinitions.find((tag) => tag.id === id)?.name ?? id])
    );
    const nextTagOptions = nextTagOrder
      .map((id) => ({ id, name: tagById.get(id) ?? id }))
      .filter((tag) => tagById.has(tag.id));
    setTagOptions(nextTagOptions);

    // Reconcile persisted hidden-tag ids with the currently-used tag ids.
    let savedHidden: string[] = [];
    if (hiddenTagsSetting?.value) {
      try {
        const parsed = JSON.parse(hiddenTagsSetting.value);
        if (Array.isArray(parsed)) {
          savedHidden = parsed.filter((id): id is string => typeof id === 'string');
        }
      } catch (error) {
        console.warn('[MemoList] Failed to parse saved hidden tags:', error);
      }
    }
    setHiddenTagIds(savedHidden.filter((id) => seenTagIds.has(id)));

    if (selectedTagId && !seenTagIds.has(selectedTagId)) {
      nextSelectedTagId = null;
      setSelectedTagId(null);
    }

    // Load memos via store (which uses IPC with backend filtering)
    await loadMemos({
      notebookId: currentNotebook.id,
      filter: activeFilter,
      sort: activeSort,
      tagId: activeFilter === 'tagged' ? nextSelectedTagId ?? undefined : undefined,
    });

    const latestState = useMemoStore.getState();
    if (latestState.selectedMemo) {
      openMemoDocument(latestState.selectedMemo, currentNotebook);
    } else if (useDocumentStore.getState().currentDocumentSource !== 'external') {
      useDocumentStore.getState().setCurrentDocumentPath(null);
    }

  }, [request, setNotebooks, setSelectedNotebook, loadMemos, openMemoDocument, activeFilter, activeSort, selectedTagId]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  useEffect(() => {
    let cancelled = false;

    async function loadTodoEntries() {
      if (activeFilter !== 'todos' || !selectedNotebook?.path) {
        setTodoEntries([]);
        return;
      }

      try {
        const content = await files.read(
          getNotebookMemoMetadataPath(selectedNotebook.path),
          selectedNotebook.path
        );
        if (cancelled) return;

        if (!content) {
          setTodoEntries([]);
          return;
        }

        const metadata = JSON.parse(content) as MemoMetadataFile;
        const todos = Array.isArray(metadata.todos) ? metadata.todos : [];
        const sortedTodos = [...todos].sort((a, b) => {
          const aTime = activeSort === 'updatedAt' ? a.updatedAt : a.createdAt;
          const bTime = activeSort === 'updatedAt' ? b.updatedAt : b.createdAt;
          return (bTime ?? 0) - (aTime ?? 0);
        });
        setTodoEntries(sortedTodos);
      } catch (error) {
        if (!cancelled) {
          console.warn('[MemoList] Failed to read memo metadata todos:', error);
          setTodoEntries([]);
        }
      }
    }

    loadTodoEntries();

    return () => {
      cancelled = true;
    };
  }, [activeFilter, activeSort, refreshTrigger, selectedNotebook?.path, memos.length]);

  const displayMemos = memos;
  const memoById = useMemo(
    () => new Map(displayMemos.map((memo) => [memo.id, memo])),
    [displayMemos]
  );
  const displayTodoEntries = useMemo(
    () => activeFilter === 'todos'
      ? todoEntries.filter((todo) => memoById.has(todo.memoId))
      : [],
    [activeFilter, memoById, todoEntries]
  );
  const hiddenTagIdSet = useMemo(() => new Set(hiddenTagIds), [hiddenTagIds]);
  const visibleTagOptions = useMemo(
    () => tagOptions.filter((t) => !hiddenTagIdSet.has(t.id)),
    [tagOptions, hiddenTagIdSet]
  );

  useEffect(() => {
    if (activeFilter !== 'tagged') {
      setTagPopoverOpen(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    if (!selectedTagId || activeFilter !== 'tagged') return;

    const container = tagScrollRef.current;
    const selectedButton = tagButtonRefs.current.get(selectedTagId);
    if (!container || !selectedButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = selectedButton.getBoundingClientRect();
    const isFullyVisible = buttonRect.left >= containerRect.left && buttonRect.right <= containerRect.right;
    if (isFullyVisible) return;

    const nextLeft = container.scrollLeft
      + buttonRect.left
      - containerRect.left
      - (containerRect.width - buttonRect.width) / 2;

    container.scrollTo({
      left: Math.max(0, nextLeft),
      behavior: 'smooth',
    });
  }, [activeFilter, selectedTagId, tagOptions]);

  const handleSelectMemo = useCallback((memo: MemoItem) => {
    setSelectedTodoKey(null);
    setSelectedMemo(memo);
    openMemoDocument(memo, useMemoStore.getState().selectedNotebook);
  }, [openMemoDocument, setSelectedMemo]);

  const handleSelectTodo = useCallback((memo: MemoItem, todoKey: string) => {
    setSelectedTodoKey(todoKey);
    setSelectedMemo(memo);
    openMemoDocument(memo, useMemoStore.getState().selectedNotebook);
  }, [openMemoDocument, setSelectedMemo]);

  const handleOpenMemoWindow = useCallback(async (memoId: string) => {
    try {
      await request("window:openMemoWindow", { memoId });
    } catch (err) {
      console.error("[MemoList] Failed to open memo window:", err);
    }
  }, [request]);

  const handleFavoriteToggle = useCallback(async (memo: MemoItem) => {
    await request(memo.favorited ? 'unfavorite_memo' : 'favorite_memo', { id: memo.id });
    triggerRefresh();
  }, [request, triggerRefresh]);

  const handleSelectNotebook = async (notebook: Notebook) => {
    setSelectedNotebook(notebook);
    setSelectedMemo(null);
    setSelectedTodoKey(null);
    setSelectedTagId(null);
    useDocumentStore.getState().setCurrentDocumentPath(null);
    // Sync with backend - set current notebook and refresh memo list
    await request('set_current_notebook', { notebookId: notebook.id });
    triggerRefresh();
  };

  const handleFilterChange = async (filter: typeof activeFilter) => {
    if (filter !== 'todos') {
      setSelectedTodoKey(null);
    }
    const nextTagId = filter === 'tagged' ? selectedTagId : null;
    if (filter !== 'tagged') {
      setSelectedTagId(null);
    }
    setActiveFilter(filter);
    const state = useMemoStore.getState();
    await loadMemos({
      notebookId: state.selectedNotebook?.id,
      filter,
      sort: state.activeSort,
      tagId: nextTagId ?? undefined,
    });
  };

  const handleSortChange = async (sort: typeof activeSort) => {
    setActiveSort(sort);
    const state = useMemoStore.getState();
    await loadMemos({
      notebookId: state.selectedNotebook?.id,
      filter: state.activeFilter,
      sort,
      tagId: state.activeFilter === 'tagged' ? selectedTagId ?? undefined : undefined,
    });
  };

  const handleTagSelect = async (tagId: string) => {
    const nextTagId = selectedTagId === tagId ? null : tagId;
    const nextFilter = nextTagId ? 'tagged' : 'all';
    setSelectedTagId(nextTagId);
    setSelectedTodoKey(null);
    setTagPopoverOpen(false);
    setActiveFilter(nextFilter);
    const state = useMemoStore.getState();
    await loadMemos({
      notebookId: state.selectedNotebook?.id,
      filter: nextFilter,
      sort: state.activeSort,
      tagId: nextFilter === 'tagged' ? nextTagId ?? undefined : undefined,
    });
  };

  const persistTagOrder = useCallback(
    async (nextOrder: string[], notebookId: string | null | undefined) => {
      if (!notebookId) return;
      try {
        await tauriSettings.set(
          getTagOrderSettingKey(notebookId),
          JSON.stringify(nextOrder)
        );
      } catch (error) {
        console.warn('[MemoList] Failed to persist tag order:', error);
      }
    },
    []
  );

  const applyTagReorder = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after') => {
      if (sourceId === targetId) return;
      const current = tagOrder.length > 0 ? tagOrder : tagOptions.map((t) => t.id);
      const fromIndex = current.indexOf(sourceId);
      const toIndex = current.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0) return;

      const next = current.slice();
      next.splice(fromIndex, 1);
      const insertIndex = position === 'before' ? next.indexOf(targetId) : next.indexOf(targetId) + 1;
      next.splice(insertIndex, 0, sourceId);

      setTagOrder(next);
      const byId = new Map(tagOptions.map((t) => [t.id, t]));
      setTagOptions(
        next
          .map((id) => byId.get(id))
          .filter((t): t is { id: string; name: string } => Boolean(t))
      );
      const notebookId = useMemoStore.getState().selectedNotebook?.id;
      void persistTagOrder(next, notebookId);
    },
    [persistTagOrder, tagOptions, tagOrder]
  );

  const persistHiddenTags = useCallback(
    async (nextHidden: string[], notebookId: string | null | undefined) => {
      if (!notebookId) return;
      try {
        await tauriSettings.set(
          getHiddenTagsSettingKey(notebookId),
          JSON.stringify(nextHidden)
        );
      } catch (error) {
        console.warn('[MemoList] Failed to persist hidden tags:', error);
      }
    },
    []
  );

  const handleToggleTagHidden = useCallback(
    (tagId: string) => {
      const notebookId = useMemoStore.getState().selectedNotebook?.id;
      const nextHidden = hiddenTagIds.includes(tagId)
        ? hiddenTagIds.filter((id) => id !== tagId)
        : [...hiddenTagIds, tagId];
      setHiddenTagIds(nextHidden);
      void persistHiddenTags(nextHidden, notebookId);
    },
    [hiddenTagIds, persistHiddenTags]
  );

  const handlePinTagToTop = useCallback(
    (tagId: string) => {
      const current = tagOrder.length > 0 ? tagOrder : tagOptions.map((t) => t.id);
      const firstOther = current.find((id) => id !== tagId);
      if (!firstOther) return;
      applyTagReorder(tagId, firstOther, 'before');
    },
    [applyTagReorder, tagOptions, tagOrder]
  );

  const findPopoverDropTarget = useCallback(
    (y: number, sourceId: string): { id: string; position: 'before' | 'after' } | null => {
      for (const tag of tagOptions) {
        if (tag.id === sourceId) continue;
        const row = popoverRowRefs.current.get(tag.id);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          const position: 'before' | 'after' = y < rect.top + rect.height / 2 ? 'before' : 'after';
          return { id: tag.id, position };
        }
      }
      return null;
    },
    [tagOptions]
  );

  const handlePopoverRowPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, tagId: string) => {
      if (e.button !== 0) return;
      // Prevent text selection while interacting with the row.
      e.preventDefault();
      const row = e.currentTarget;
      try {
        row.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const rect = row.getBoundingClientRect();
      dragPointerRef.current = {
        sourceId: tagId,
        pointerId: e.pointerId,
        startY: e.clientY,
        startX: e.clientX,
        offsetY: e.clientY - rect.top,
        rect,
        isDragging: false,
      };
    },
    []
  );

  useEffect(() => {
    const DRAG_THRESHOLD = 4;

    const handleMove = (e: PointerEvent) => {
      const state = dragPointerRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      if (!state.isDragging) {
        const dy = Math.abs(e.clientY - state.startY);
        const dx = Math.abs(e.clientX - state.startX);
        if (dy < DRAG_THRESHOLD && dx < DRAG_THRESHOLD) return;
        state.isDragging = true;
        setDraggingTagId(state.sourceId);
        if (state.rect) {
          setDragGhost({
            id: state.sourceId,
            rect: state.rect,
            currentY: e.clientY,
            offsetY: state.offsetY,
          });
        }
      } else {
        setDragGhost((prev) => (prev ? { ...prev, currentY: e.clientY } : null));
      }

      setDropTarget(findPopoverDropTarget(e.clientY, state.sourceId));
    };

    const handleUp = (e: PointerEvent) => {
      const state = dragPointerRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      if (state.isDragging) {
        const target = findPopoverDropTarget(e.clientY, state.sourceId);
        if (target) {
          applyTagReorder(state.sourceId, target.id, target.position);
        }
      } else {
        // Treat as a click: select the tag.
        handleTagSelect(state.sourceId);
      }

      dragPointerRef.current = null;
      setDraggingTagId(null);
      setDragGhost(null);
      setDropTarget(null);
    };

    const handleCancel = (e: PointerEvent) => handleUp(e);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
  }, [applyTagReorder, findPopoverDropTarget, handleTagSelect]);

  const handleCreateMemo = async () => {
    if (!selectedNotebook) return;
    const result: any = await request('add_document', { tag: undefined, notebookId: selectedNotebook.id });
    if (result) {
      // Refresh the list to include the new memo
      await loadMemos({ notebookId: selectedNotebook.id });
      const state = useMemoStore.getState();
      const newMemo = state.memos.find(m => m.id === result.id);
      if (newMemo) {
        setSelectedMemo({ ...newMemo, isOpen: true });
        openMemoDocument(newMemo, selectedNotebook);
      }
    }
  };

  const handleCreateNotebook = () => {
    setNewNotebookName('');
    setCreateNotebookOpen(true);
  };

  const handleConfirmCreateNotebook = async () => {
    if (!newNotebookName.trim() || !newNotebookPath.trim()) return;
    await request('create_notebook', { name: newNotebookName.trim(), path: newNotebookPath.trim(), icon: '📓' });
    setCreateNotebookOpen(false);
    setNewNotebookName('');
    setNewNotebookPath('');
    triggerRefresh();
  };

  const currentNotebook = selectedNotebook;

  return (
    <div className="flex flex-col h-full bg-[var(--agent-bg)] relative">
      {/* Memo Tab */}
      <div className="flex items-center justify-between px-4 py-2 gap-2">
        <DropdownMenu open={notebookDropdownOpen} onOpenChange={(open) => {
            if (open) {
              // Reload notebooks each time dropdown opens
              notebooksClient.getAll().then((nbList) => {
                if (nbList && nbList.length > 0) {
                  setNotebooks(nbList);
                }
              });
            }
            setNotebookDropdownOpen(open);
          }}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1 pr-2 py-0.5 rounded-md hover:bg-[var(--muted)] transition-colors"
            >
              <span className="text-[15px] font-medium">{currentNotebook?.name || '选择笔记本'}</span>
              <ChevronDown className="w-[14px] h-[14px] text-gray-500" strokeWidth={2.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-[200px] p-1">
            {/* Group 1: Notebook List */}
            <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] px-2 mb-1">笔记本</DropdownMenuLabel>
            {notebooks.map((notebook, index) => (
              <DropdownMenuItem
                key={notebook.id || `nb-${index}`}
                onClick={() => handleSelectNotebook(notebook)}
                className="flex items-center justify-between cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
              >
                <span>{notebook.name}</span>
                {selectedNotebook?.id === notebook.id && <span className="text-xs text-[var(--primary)]">✓</span>}
              </DropdownMenuItem>
            ))}

            {/* Group 2: Sort Options */}
            <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] px-2 mb-1 mt-2">排序</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => handleSortChange('createdAt')}
              className="flex items-center justify-between cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
            >
              <span>创建时间</span>
              {activeSort === 'createdAt' && <span className="text-xs text-[var(--primary)]">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleSortChange('updatedAt')}
              className="flex items-center justify-between cursor-pointer rounded-md px-2 hover:bg-[var(--muted)]"
            >
              <span>更新时间</span>
              {activeSort === 'updatedAt' && <span className="text-xs text-[var(--primary)]">✓</span>}
            </DropdownMenuItem>

            {/* New Notebook Button */}
            <DropdownMenuItem
              onClick={() => handleCreateNotebook()}
              className="flex items-center justify-center cursor-pointer rounded-md border border-[var(--border)] w-full mt-2 hover:bg-[var(--muted)]"
            >
              <span>新建笔记本</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="h-8 px-3 justify-center bg-black text-white hover:opacity-90 rounded-full"
          onClick={handleCreateMemo}
        >
          <SquarePen className="w-4 h-4 text-white" />
        </Button>
      </div>

      {/* Filter Buttons */}
      <div className="flex items-center justify-center gap-4 px-4 pb-1">
        <button
          onClick={() => handleFilterChange('all')}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            activeFilter === 'all' || activeFilter === 'tagged' ? 'text-[var(--primary)] bg-[var(--accent)]' : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)]'
          )}
        >
          <List className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleFilterChange(activeFilter === 'todos' ? 'all' : 'todos')}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            activeFilter === 'todos' ? 'text-[var(--primary)] bg-[var(--accent)]' : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)]'
          )}
        >
          <CheckSquareIcon className="w-4 h-4" weight={activeFilter === 'todos' ? 'fill' : 'regular'} />
        </button>
        <button
          onClick={() => {/* TODO: toggle search */ }}
          className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)] transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {tagOptions.length > 0 && (activeFilter === 'all' || activeFilter === 'tagged') && (
        <div className="px-4 pb-2 pt-1">
          <div className="relative">
            <div ref={tagScrollRef} className="scrollbar-hide flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pr-12">
            {visibleTagOptions.map((tag) => (
              <button
                key={tag.id}
                ref={(node) => {
                  if (node) {
                    tagButtonRefs.current.set(tag.id, node);
                  } else {
                    tagButtonRefs.current.delete(tag.id);
                  }
                }}
                type="button"
                onClick={() => handleTagSelect(tag.id)}
                className={cn(
                  "h-7 max-w-[140px] shrink-0 rounded-full border px-3 text-xs font-medium leading-none transition-colors",
                  "bg-white/70 hover:border-[var(--primary)] hover:text-[var(--primary)]",
                  selectedTagId === tag.id
                    ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--primary)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]"
                )}
                title={tag.name}
              >
                <span className="flex min-w-0 items-center">
                  <HashStraightIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{tag.name}</span>
                </span>
              </button>
            ))}
            </div>

            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-r from-transparent via-[var(--agent-bg)] to-[var(--agent-bg)] pl-6">
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                      tagPopoverOpen
                        ? "text-[var(--primary)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                    )}
                    aria-label="更多标签"
                    aria-expanded={tagPopoverOpen}
                  >
                    <DotsThreeIcon className="h-4 w-4" weight="bold" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="w-[240px] max-h-[480px] overflow-hidden rounded-lg bg-white p-0 shadow-xl"
                >
                  <div className="max-h-[480px] space-y-1 overflow-y-auto p-1.5">
                    {tagOptions.map((tag) => {
                      const isSelected = selectedTagId === tag.id;
                      const isDragging = draggingTagId === tag.id;
                      const isHidden = hiddenTagIdSet.has(tag.id);
                      const isDropBefore =
                        dropTarget?.id === tag.id && dropTarget.position === 'before' && !isDragging;
                      const isDropAfter =
                        dropTarget?.id === tag.id && dropTarget.position === 'after' && !isDragging;
                      return (
                        <div
                          key={tag.id}
                          ref={(node) => {
                            if (node) {
                              popoverRowRefs.current.set(tag.id, node);
                            } else {
                              popoverRowRefs.current.delete(tag.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => handlePopoverRowPointerDown(e, tag.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleTagSelect(tag.id);
                            }
                          }}
                          className={cn(
                            "group relative flex h-8 w-full cursor-grab select-none items-center gap-2 rounded-md pl-1.5 pr-1 text-left text-sm transition-colors active:cursor-grabbing",
                            isSelected && !isDragging
                              ? "bg-[var(--accent)] text-[var(--primary)]"
                              : "text-[var(--agent-text-primary)] hover:bg-[var(--muted)]",
                            isDragging && "opacity-50",
                            isHidden && !isDragging && "opacity-70"
                          )}
                          title={tag.name}
                        >
                          <span
                            aria-hidden
                            className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--muted-foreground)] opacity-50 group-hover:text-[var(--primary)] group-hover:opacity-100"
                          >
                            <DotsSixIcon className="h-3.5 w-3.5" weight="bold" />
                          </span>
                          <HashIcon
                            className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
                            weight="bold"
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              isHidden && "text-[var(--muted-foreground)]"
                            )}
                          >
                            {tag.name}
                          </span>
                          {isSelected && !isDragging && (
                            <span className="ml-1 shrink-0 text-xs text-[var(--primary)]">已选</span>
                          )}
                          <button
                            type="button"
                            aria-label={`置顶 ${tag.name}`}
                            title="置顶"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePinTagToTop(tag.id);
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <ArrowLineUpIcon className="h-3.5 w-3.5" weight="bold" />
                          </button>
                          <button
                            type="button"
                            aria-label={isHidden ? `取消隐藏 ${tag.name}` : `隐藏 ${tag.name}`}
                            title={isHidden ? '取消隐藏' : '隐藏'}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleTagHidden(tag.id);
                            }}
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] focus-visible:opacity-100",
                              isHidden
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100"
                            )}
                          >
                            {isHidden ? (
                              <EyeSlashIcon className="h-3.5 w-3.5" weight="bold" />
                            ) : (
                              <EyeIcon className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {isDropBefore && (
                            <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-[var(--primary)]" />
                          )}
                          {isDropAfter && (
                            <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--primary)]" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {dragGhost && (
                    <div
                      aria-hidden
                      className="pointer-events-none fixed z-[1100] flex items-center gap-2 rounded-md border border-[var(--primary)] bg-white px-2 text-sm opacity-50 shadow-lg"
                      style={{
                        left: dragGhost.rect.left,
                        top: dragGhost.currentY - dragGhost.offsetY,
                        width: dragGhost.rect.width,
                        height: dragGhost.rect.height,
                      }}
                    >
                      <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--primary)]">
                        <DotsSixIcon className="h-3.5 w-3.5" weight="bold" />
                      </span>
                      <HashIcon
                        className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]"
                        weight="bold"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {tagOptions.find((t) => t.id === dragGhost.id)?.name ?? ''}
                      </span>
                    </div>
                  )}
                </PopoverContent>
                </Popover>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {(activeFilter === 'todos' ? displayTodoEntries.length > 0 : displayMemos.length > 0) ? (
          <div className="flex flex-col">
            {activeFilter === 'todos' ? (
              displayTodoEntries.map((todo, index) => {
                const memo = memoById.get(todo.memoId);
                if (!memo) return null;
                const todoKey = getTodoSelectionKey(todo, index);

                return (
                  <div key={todoKey}>
                    <MemoCardTodo
                      memo={memo}
                      todo={todo}
                      todoKey={todoKey}
                      selectedTodoKey={selectedTodoKey}
                      onSelect={handleSelectTodo}
                    />
                    <hr className="border-t border-[var(--border)] opacity-50" />
                  </div>
                );
              })
            ) : (
              displayMemos.map((memo) => (
                <div key={memo.id}>
                  <MemoCard
                    memo={memo}
                    tagMap={tagMap}
                    selectedMemo={selectedMemo}
                    openDropdown={openDropdown}
                    onOpenDropdown={setOpenDropdown}
                    onSelect={handleSelectMemo}
                    onOpenWindow={handleOpenMemoWindow}
                    onFavoriteToggle={handleFavoriteToggle}
                    onDelete={setDeleteMemo}
                  />
                  <hr className="border-t border-[var(--border)] opacity-50" />
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--muted-foreground)]">
            <MessageSquareDashed className="w-12 h-12 opacity-30" />
            <span className="text-sm">No Memo Found</span>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteMemo} onOpenChange={(open) => !open && setDeleteMemo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Memo</AlertDialogTitle>
            <AlertDialogDescription>确定要删除 "{deleteMemo?.filename}" 吗？此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteMemo(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteMemo) {
                request('delete_memo', { id: deleteMemo.id }).then(() => {
                  if (selectedMemo?.id === deleteMemo.id) {
                    setSelectedMemo(null);
                    useDocumentStore.getState().setCurrentDocumentPath(null);
                  }
                  triggerRefresh();
                  setDeleteMemo(null);
                });
              }
            }}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 新建 Notebook 弹窗 */}
      <Dialog open={createNotebookOpen} onOpenChange={setCreateNotebookOpen}>
        <DialogContent className="w-[400px]">
          <DialogHeader>
            <DialogTitle>新建笔记本</DialogTitle>
            <DialogDescription>选择笔记本保存位置</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <Input
              placeholder="笔记本名称"
              value={newNotebookName}
              onChange={(e) => setNewNotebookName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateNotebook();
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <Input
                placeholder="选择文件夹路径"
                value={newNotebookPath}
                onChange={(e) => setNewNotebookPath(e.target.value)}
                className="flex-1"
                readOnly
              />
              <Button
                variant="outline"
                onClick={async () => {
                  // Use IPC to open directory dialog
                  const result = await request<string | null>('select_directory');
                  if (result) setNewNotebookPath(result);
                }}
              >
                选择
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => {
                setCreateNotebookOpen(false);
                setNewNotebookName('');
                setNewNotebookPath('');
              }}
              className="px-4 py-2 text-sm rounded-md hover:bg-[var(--muted)]"
            >
              取消
            </button>
            <button
              onClick={handleConfirmCreateNotebook}
              className="px-4 py-2 text-sm rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
              disabled={!newNotebookName.trim() || !newNotebookPath.trim()}
            >
              创建
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
