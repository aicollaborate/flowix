'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { HashIcon } from '@phosphor-icons/react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { OverlayScrollbar } from '@shared/ui/overlay-scrollbar';
import { NoteNavigationPanelHeaderMac } from '@features/memo/components/note-navigation-panel-header-mac';
import { NoteNavigationPanelHeaderWin } from '@features/memo/components/note-navigation-panel-header-win';
import {
  NotebookIcon,
  useMemoStore,
  useTagStore,
  type Notebook,
} from '@features/memo';
import {
  loadMemoLibraryMetadata,
  persistTagOrder,
} from '@features/memo/services/memo-list-metadata-service';
import { useI18n } from '@features/i18n';
import { isWindowsPlatform } from '@features/shortcuts/platform';

interface TagDragGhost {
  id: string;
  rect: DOMRect;
  currentX: number;
  currentY: number;
}

interface NoteNavigationPanelProps {
  notebooks: Notebook[];
  selectedNotebook: Notebook | null;
  onSelectNotebook: (notebook: Notebook) => void;
  onEditNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onTogglePanel: () => void;
}

// 笔记本列表区域高度 ── 持久化键 + 读 / 写助手。
// 选 localStorage 而非 user-settings-store: 这是纯 UI 维度, 单 number,
// 写读都是 O(1), 无需经 Tauri IPC; 现有 theme/apply.ts 也是同套模式。
// 取值范围与 NOTEBOOK_LIST_MIN/MAX_HEIGHT 同步约束, 越界视为无效。
const NOTEBOOK_LIST_HEIGHT_STORAGE_KEY = 'flowix:notebook-list-height';

function readPersistedNotebookListHeight(
  min: number,
  max: number
): number | null {
  try {
    const raw = localStorage.getItem(NOTEBOOK_LIST_HEIGHT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < min || parsed > max) return null;
    return Math.round(parsed);
  } catch {
    return null;
  }
}

function writePersistedNotebookListHeight(height: number | null): void {
  try {
    if (height === null) {
      localStorage.removeItem(NOTEBOOK_LIST_HEIGHT_STORAGE_KEY);
    } else {
      localStorage.setItem(NOTEBOOK_LIST_HEIGHT_STORAGE_KEY, String(height));
    }
  } catch {
    // localStorage 不可用 (隐私模式 / 配额满 / SSR) 时静默吞掉, 不影响 UI。
  }
}

export function NoteNavigationPanel({
  notebooks,
  selectedNotebook,
  onSelectNotebook,
  onEditNotebook,
  onDeleteNotebook,
  onTogglePanel,
}: NoteNavigationPanelProps) {
  const { t } = useI18n();
  const activeFilter = useMemoStore((s) => s.activeFilter);
  const { setActiveFilter } = useMemoStore(
    useShallow((s) => ({
      setActiveFilter: s.setActiveFilter,
    })),
  );
  const selectedTagId = useTagStore((s) => s.selectedTagId);
  const setSelectedTagId = useTagStore((s) => s.setSelectedTagId);
  const tagMetadataRefreshVersion = useTagStore((s) => s.metadataRefreshVersion);
  const [tagOptions, setTagOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [tagOrder, setTagOrder] = useState<string[]>([]);
  const [hiddenTagIds, setHiddenTagIds] = useState<string[]>([]);
  const [draggingTagId, setDraggingTagId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [dragGhost, setDragGhost] = useState<TagDragGhost | null>(null);

  const dragPointerRef = useRef<{
    sourceId: string;
    pointerId: number;
    startY: number;
    startX: number;
    rect: DOMRect | null;
    isDragging: boolean;
  } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // 笔记本列表区域手动调节高度 ── 默认按内容自适应 (max-h 兜底),
  // 用户拖动分隔条后切到显式 height, 但仍受 MAX_NOTEBOOK_HEIGHT 限制。
  // 拖动结束会把最终高度写入 localStorage, 下次打开时 readPersistedNotebookListHeight 还原。
  const NOTEBOOK_LIST_MIN_HEIGHT = 80;
  const NOTEBOOK_LIST_MAX_HEIGHT = 320;
  const [notebookListHeight, setNotebookListHeight] = useState<number | null>(() =>
    readPersistedNotebookListHeight(NOTEBOOK_LIST_MIN_HEIGHT, NOTEBOOK_LIST_MAX_HEIGHT)
  );
  const notebookContainerRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  // window 事件回调里读取的 height 必须是「最新一次 setState 后的值」, 但事件 effect 是
  // 空依赖建立的, 闭包里拿到的是旧值 ── 用 ref 同步 state 解决。
  const latestNotebookListHeightRef = useRef<number | null>(notebookListHeight);
  useEffect(() => {
    latestNotebookListHeightRef.current = notebookListHeight;
  }, [notebookListHeight]);

  const hiddenTagIdSet = useMemo(() => new Set(hiddenTagIds), [hiddenTagIds]);

  useEffect(() => {
    let cancelled = false;

    const loadTags = async (notebook: Notebook) => {
      try {
        const metadata = await loadMemoLibraryMetadata({
          notebook,
          selectedTagId: useTagStore.getState().selectedTagId,
        });
        if (!metadata || cancelled) return;
        setTagOptions(metadata.tagOptions);
        setTagOrder(metadata.tagOrder);
        setHiddenTagIds(metadata.hiddenTagIds);
        const currentSelectedTagId = useTagStore.getState().selectedTagId;
        if (metadata.selectedTagId !== currentSelectedTagId) {
          setSelectedTagId(metadata.selectedTagId);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[NoteNavigationPanel] Failed to load tags:', error);
          setTagOptions([]);
          setTagOrder([]);
          setHiddenTagIds([]);
        }
      }
    };

    if (!selectedNotebook) {
      setTagOptions([]);
      setTagOrder([]);
      setHiddenTagIds([]);
      return;
    }

    void loadTags(selectedNotebook);

    return () => {
      cancelled = true;
    };
  }, [tagMetadataRefreshVersion, selectedNotebook, setSelectedTagId]);

  const handleTagSelect = useCallback(
    (tagId: string) => {
      const isCurrentlySelected = activeFilter === 'tagged' && selectedTagId === tagId;
      const nextTagId = isCurrentlySelected ? null : tagId;
      const nextFilter = nextTagId ? 'tagged' : 'all';

      setSelectedTagId(nextTagId);
      setActiveFilter(nextFilter);
    },
    [
      activeFilter,
      selectedTagId,
      setActiveFilter,
      setSelectedTagId,
    ],
  );

  // 笔记本行点击: 与 NotebookSwitcher 保持一致 ── 失效路径直接 toast 警告,
  // 不切换。有效路径走 onSelectNotebook 回调。
  const handleNotebookRowActivate = useCallback(
    (notebook: Notebook) => {
      if (notebook.missing) {
        toast.warning(t('status.invalidNotebookPath'));
        return;
      }
      onSelectNotebook(notebook);
    },
    [onSelectNotebook, t],
  );

  const handleCreateNotebookClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('flowix:open-create-notebook'));
  }, []);

  // 笔记本 / 标签 分隔条拖动 ── 与现有 tag 行 pointer 拖动复用 window listener 套路:
  // pointerdown 在分隔条上记录起点 + 当前高度 + 锁选区; pointermove 累加 deltaY,
  // clamp 到 [MIN, MAX] 后写入 state; pointerup/pointercancel 释放锁并还原 userSelect。
  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const container = notebookContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      resizeStateRef.current = {
        startY: e.clientY,
        startHeight: notebookListHeight ?? rect.height,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    },
    [notebookListHeight]
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = e.clientY - state.startY;
      const next = Math.max(
        NOTEBOOK_LIST_MIN_HEIGHT,
        Math.min(NOTEBOOK_LIST_MAX_HEIGHT, state.startHeight + delta)
      );
      setNotebookListHeight(next);
    };
    const handleUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // 拖动结束: 把最终高度持久化到 localStorage, 下次打开时由 useState 初始化读回。
      // 读 latestNotebookListHeightRef 而非直接闭包, 因为 effect 是空依赖建⽴的,
      // 闭包里的 notebookListHeight 始终是 effect 创建时的旧值。
      writePersistedNotebookListHeight(latestNotebookListHeightRef.current);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  // 拖动排序逻辑 ── 指针事件三段式 (与原 TagOverflowPopoverContent 同款, 现已并入本文件):
  // 1. pointerdown 在行上设 setPointerCapture 并暂存起点;
  // 2. pointermove 越过 4px 阈值进入拖动态, 显示 ghost + drop 指示条;
  // 3. pointerup 时若处于拖动态则提交 reorder, 否则回退为选中点击;
  // 4. 排序结果写入 tagOrder + 同步重排 tagOptions, 持久化到 per-notebook 设置。
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
      void persistTagOrder(next, notebookId).catch((error) => {
        console.warn('[NoteNavigationPanel] Failed to persist tag order:', error);
      });
    },
    [tagOptions, tagOrder]
  );

  const findDropTarget = useCallback(
    (y: number, sourceId: string): { id: string; position: 'before' | 'after' } | null => {
      for (const tag of tagOptions) {
        if (tag.id === sourceId) continue;
        const row = rowRefs.current.get(tag.id);
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

  const handleRowPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, tagId: string) => {
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
            currentX: e.clientX,
            currentY: e.clientY,
          });
        }
      } else {
        setDragGhost((prev) => (prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null));
      }

      setDropTarget(findDropTarget(e.clientY, state.sourceId));
    };

    const handleUp = (e: PointerEvent) => {
      const state = dragPointerRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      if (state.isDragging) {
        const target = findDropTarget(e.clientY, state.sourceId);
        if (target) {
          applyTagReorder(state.sourceId, target.id, target.position);
        }
      } else {
        // 没有位移, 视为普通点击 → 选中标签。
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
  }, [applyTagReorder, findDropTarget, handleTagSelect]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--agent-bg)] text-[var(--agent-foreground)]">
      {/* 顶部 header ── Mac/Win 差分:
            - Mac: h-12 (与 OS 标题栏同高) + pl-[90px] 避开红绿灯 + rounded-xl 按钮
            - Win: h-9 (在 OS 标题栏下方, 仅做内部 UI) + rounded-lg 按钮
          两者都整块作为窗口拖动区 (data-tauri-drag-region)。 */}
      {isWindowsPlatform() ? (
        <NoteNavigationPanelHeaderWin onTogglePanel={onTogglePanel} />
      ) : (
        <NoteNavigationPanelHeaderMac onTogglePanel={onTogglePanel} />
      )}

      {/* 笔记本列表 ── 与 status-bar/notebook-switcher 下拉项的呈现保持一致:
          NotebookIcon + 名称 + 失效路径提示, hover 显形编辑/删除。
          高度默认按内容自适应 (max-h 兜底 320px); 用户拖过分隔条后切到显式 height,
          但仍受 320px 上限约束。下方标签区用 flex-1 填满剩余。 */}
      <div
        ref={notebookContainerRef}
        className="flex min-h-0 max-h-[320px] shrink-0 flex-col"
        style={notebookListHeight !== null ? { height: `${notebookListHeight}px` } : undefined}
      >
        <OverlayScrollbar
          className="min-h-0 flex-1"
          scrollerClassName="h-full overflow-y-auto px-2 pt-2 pb-1"
        >
          <div className="space-y-0.5">
            {notebooks.length === 0 ? (
              <div className="px-2 py-2 text-sm text-[var(--muted-foreground)]">
                {t('status.noNotebooks')}
              </div>
            ) : (
              notebooks.map((notebook) => {
                const isActive = selectedNotebook?.id === notebook.id;
                const isMissing = Boolean(notebook.missing);
                return (
                  <div
                    key={notebook.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotebookRowActivate(notebook)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleNotebookRowActivate(notebook);
                      }
                    }}
                    className={cn(
                      'group relative flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md pl-1.5 pr-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--muted)] text-[var(--foreground)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--muted)]',
                      isMissing && 'opacity-70',
                    )}
                    title={notebook.name}
                    aria-pressed={isActive}
                  >
                    <NotebookIcon
                      icon={notebook.icon}
                      name={notebook.name}
                      className="h-6 w-6 rounded-md bg-[var(--muted)] text-[11px] font-semibold text-[var(--secondary-foreground)]"
                    />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="min-w-0 truncate">
                        <span className={isMissing ? 'text-[var(--muted-foreground)]' : ''}>
                          {notebook.name}
                        </span>
                        {isMissing && (
                          <>
                            <span className="text-[var(--muted-foreground)]">{' '}</span>
                            <span className="text-[var(--muted-foreground)]">
                              {t('status.invalid')}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    {/* 编辑 / 删除 ── 与 NotebookSwitcher 行内操作保持一致,
                        absolute 定位 + group-hover 渐显, 默认笔记本无删除。 */}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditNotebook(notebook);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                        aria-label={t('status.editNotebook')}
                      >
                        <Pencil className="h-3 w-3" />
                      </span>
                      {!notebook.isDefault && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteNotebook(notebook);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--destructive)] cursor-pointer"
                          aria-label={t('status.deleteNotebook')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {/* 「新建笔记本」按钮 ── 放在滚动列表内最下方, 与列表项一同滚动,
              取消外框与居中, 改为左侧对齐, 容器 / 图标 / 文本节奏与标签行一致。 */}
          <button
            type="button"
            onClick={handleCreateNotebookClick}
            className={cn(
              'group relative mt-0.5 flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md pl-1.5 pr-2 text-left text-sm transition-colors',
              'text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{t('status.new')}</span>
          </button>
        </OverlayScrollbar>
      </div>

      {/* 笔记本 / 标签 分隔条 ── 鼠标 hover 显形 + 可拖动, 调节上方笔记本列表高度。
          4px 命中区 (h-1) + 顶部 1px 视觉线 (border-t), 颜色取 --muted-foreground
          中灰 /50 保证清晰可见; group-hover/active 切到 primary 色反馈。 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整笔记本列表高度"
        onPointerDown={handleResizeStart}
        className="group mx-2 h-1 shrink-0 cursor-row-resize border-t border-[var(--muted-foreground)]/50 hover:border-[var(--primary)]/70 active:border-[var(--primary)]"
      />

      {/* 标签列表 ── 填满笔记本区剩余的 64% 高度, 内部独立滚动。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <OverlayScrollbar
          className="min-h-0 flex-1"
          scrollerClassName="h-full overflow-y-auto px-2 pt-2 pb-3"
        >
          {tagOptions.length === 0 ? null : (
            <div className="space-y-0.5">
              {tagOptions.map((tag) => {
                const isSelected = activeFilter === 'tagged' && selectedTagId === tag.id;
                const isHidden = hiddenTagIdSet.has(tag.id);
                const isDragging = draggingTagId === tag.id;
                const isDropBefore =
                  dropTarget?.id === tag.id && dropTarget.position === 'before' && !isDragging;
                const isDropAfter =
                  dropTarget?.id === tag.id && dropTarget.position === 'after' && !isDragging;

                return (
                  <div
                    key={tag.id}
                    ref={(node) => {
                      if (node) {
                        rowRefs.current.set(tag.id, node);
                      } else {
                        rowRefs.current.delete(tag.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) => handleRowPointerDown(event, tag.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleTagSelect(tag.id);
                      }
                    }}
                    className={cn(
                      'group relative flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md pl-1.5 pr-2 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-[var(--muted)] text-[var(--foreground)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--muted)]',
                      isDragging && 'opacity-50',
                      isHidden && !isSelected && 'opacity-70',
                    )}
                    title={tag.name}
                    aria-pressed={isSelected}
                  >
                    <span className="shrink-0 opacity-60">
                      <HashIcon
                        className="h-3.5 w-3.5 text-[var(--muted-foreground)]"
                        weight="bold"
                      />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        isHidden && !isSelected && 'text-[var(--muted-foreground)]',
                      )}
                    >
                      {tag.name}
                    </span>
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
          )}
        </OverlayScrollbar>
      </div>

      {dragGhost && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1100] flex items-center gap-2 rounded-md border border-[var(--primary)] bg-[var(--card)] px-2 text-sm opacity-50 shadow-lg"
          style={{
            left: dragGhost.currentX + 12,
            top: dragGhost.currentY + 12,
            width: dragGhost.rect.width,
            height: dragGhost.rect.height,
          }}
        >
          <HashIcon
            className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]"
            weight="bold"
          />
          <span className="min-w-0 flex-1 truncate">
            {tagOptions.find((tag) => tag.id === dragGhost.id)?.name ?? ''}
          </span>
        </div>
      )}
    </div>
  );
}
