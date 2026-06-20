'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MenuBoard } from '@features/shell/components/menu-board';
import { DocumentContainer } from '@features/document';
import { DocumentTitlebarWin } from '@features/document';
import { DocumentTitlebarMac } from '@features/document';
import { MemoList } from '@features/memo/components/memo-list';
import { MemoListTitlebarWin } from '@features/memo/components/memo-list-titlebar-win';
import { MemoListTitlebarMac } from '@features/memo/components/memo-list-titlebar-mac';
import { LazyAgentPanel } from '@features/agent';
import { useTauriRpc } from '@platform/tauri/use-tauri-rpc';
import { useDocumentHistoryStore, useDocumentStore, type DocumentHistoryEntry, type MemoDocumentSession } from '@features/document';
import { useMemoStore, type MemoItem, type Notebook } from '@features/memo';
import { useSettingsStore } from '@features/shell';
import { useShallow } from 'zustand/react/shallow';
import { notebooks as notebooksClient, windows } from '@platform/tauri/client';
import { WindowsTitlebarControls } from '@shared/window-titlebar-controls';
import { toast } from '@/lib/toast';
import { canonicalPath, getDocumentInstanceKey } from '@/lib/path';
import { navigateDocumentHistory } from '@/lib/document-navigation';
import { StatusBar } from '@features/shell/components/status-bar/status-bar';
import { NotebookDeleteDialog } from '@features/shell/components/notebook-delete-dialog';
import { FullscreenDragOverlay } from '@features/shell/components/drag-overlay/fullscreen-drag-overlay';
import { useDocumentCommands } from '@features/document';
import { useExternalDocumentOpen } from '@features/document';
import { useNotebookTodoCount } from '@features/memo/components/use-notebook-todo-count';
import { useResizablePanels } from '@features/shell/hooks/use-resizable-panels';
import { useMacosTrackpadSwipe, type MacosTrackpadSwipeDirection } from '@features/shell/hooks/use-macos-trackpad-swipe';
import backgroundImage from '@/assets/bg.document.png';

function isWindowsPlatform(): boolean {
  return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

function isDifferentHistoryTarget(entry: DocumentHistoryEntry, activeMemoSession: MemoDocumentSession | null): boolean {
  if (entry.kind !== 'memo') return true;
  if (!activeMemoSession) return true;
  return (
    entry.memoId !== activeMemoSession.memoId ||
    canonicalPath(entry.path) !== canonicalPath(activeMemoSession.path)
  );
}

type PanelVisibilityState = {
  memoListVisible: boolean;
  agentPanelVisible: boolean;
};

type PanelVisibilityTransition = Partial<PanelVisibilityState>;

function resolvePanelSwipeTransition(
  state: PanelVisibilityState,
  direction: MacosTrackpadSwipeDirection,
): PanelVisibilityTransition | null {
  if (direction === 'left') {
    if (state.memoListVisible) return { memoListVisible: false };
    if (!state.agentPanelVisible) return { agentPanelVisible: true };
    return null;
  }

  if (state.memoListVisible) return null;
  if (state.agentPanelVisible) return { agentPanelVisible: false };
  return { memoListVisible: true };
}

export function MainLayout() {
  // 切片订阅：每个 useStore 只取真正用到的字段，setter 走 useShallow 聚合。
  // 替代原来的 `useMemoStore()` / `useDocumentStore()` / `useSettingsStore()`
  // 全量订阅 —— 任何 set 都会让 MainLayout 整树重渲，跨菜单栏 / 状态栏 /
  // document 容器一起抖。切到 selector 后, 只在用到的字段变化时本组件
  // 才重渲, memo-list / document-container 各自独立订阅, 互不污染。
  const memos = useMemoStore((s) => s.memos);
  const notebooks = useMemoStore((s) => s.notebooks);
  const selectedMemo = useMemoStore((s) => s.selectedMemo);
  const selectedNotebook = useMemoStore((s) => s.selectedNotebook);
  const refreshTrigger = useMemoStore((s) => s.refreshTrigger);
  const activeSort = useMemoStore((s) => s.activeSort);

  const memoActions = useMemoStore(
    useShallow((s) => ({
      setActiveFilter: s.setActiveFilter,
      loadMemos: s.loadMemos,
      setSelectedMemo: s.setSelectedMemo,
      setSelectedNotebook: s.setSelectedNotebook,
      setNotebooks: s.setNotebooks,
      triggerRefresh: s.triggerRefresh,
      updateMemoMeta: s.updateMemoMeta,
      setMemoColors: s.setMemoColors,
    })),
  );
  const {
    setActiveFilter,
    loadMemos,
    setSelectedMemo,
    setSelectedNotebook,
    setNotebooks,
    triggerRefresh,
    updateMemoMeta,
    setMemoColors,
  } = memoActions;

  const {
    currentDocumentPath,
    currentDocumentSource,
    activeMemoSession,
    activeExternalSession,
    isDocumentTransitioning,
    openExternalDocument: openExternalDocumentSession,
    clearDocument,
  } = useDocumentStore(
    useShallow((s) => ({
      currentDocumentPath: s.currentDocumentPath,
      currentDocumentSource: s.currentDocumentSource,
      activeMemoSession: s.activeMemoSession,
      activeExternalSession: s.activeExternalSession,
      isDocumentTransitioning: s.isDocumentTransitioning,
      openExternalDocument: s.openExternalDocument,
      clearDocument: s.clearDocument,
    })),
  );

  const {
    memoListVisible,
    agentPanelVisible,
    agentColWidth,
    setMemoListVisible,
    toggleMemoListVisible,
    setAgentPanelVisible,
    toggleAgentPanelVisible,
    setAgentColWidth,
  } = useSettingsStore(
    useShallow((s) => ({
      memoListVisible: s.memoListVisible,
      agentPanelVisible: s.agentPanelVisible,
      agentColWidth: s.agentColWidth,
      setMemoListVisible: s.setMemoListVisible,
      toggleMemoListVisible: s.toggleMemoListVisible,
      setAgentPanelVisible: s.setAgentPanelVisible,
      toggleAgentPanelVisible: s.toggleAgentPanelVisible,
      setAgentColWidth: s.setAgentColWidth,
    })),
  );
  const canNavigateBack = useDocumentHistoryStore((s) => (
    s.backStack.some((entry) => isDifferentHistoryTarget(entry, activeMemoSession))
  ));
  const canNavigateForward = useDocumentHistoryStore((s) => (
    s.forwardStack.some((entry) => isDifferentHistoryTarget(entry, activeMemoSession))
  ));
  const [isMenuBoardOpen, setIsMenuBoardOpen] = useState(false);
  const [notebookPopupOpen, setNotebookPopupOpen] = useState(false);
  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null);
  const { request } = useTauriRpc();
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  // Toolbar collapsed — owned here, controlled by the toolbar's own collapse/expand
  // buttons. Session-only.
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const currentDocumentContentRef = useRef('');
  const {
    agentPanelDraftWidth,
    agentPanelWidth,
    handleAgentDividerMouseDown,
    handleListDividerMouseDown,
    isDraggingAgentDivider,
    isDraggingListDivider,
    isMemoListHidden,
    memoColWidth,
    memoListWidth,
  } = useResizablePanels({
    agentColWidth,
    agentPanelVisible,
    memoListVisible,
    setAgentColWidth,
    setMemoListVisible,
  });

  const handlePanelSwipe = useCallback((direction: MacosTrackpadSwipeDirection) => {
    const transition = resolvePanelSwipeTransition(
      { memoListVisible, agentPanelVisible },
      direction,
    );
    if (!transition) return;
    if (transition.memoListVisible !== undefined && transition.memoListVisible !== memoListVisible) {
      setMemoListVisible(transition.memoListVisible);
    }
    if (transition.agentPanelVisible !== undefined && transition.agentPanelVisible !== agentPanelVisible) {
      setAgentPanelVisible(transition.agentPanelVisible);
    }
  }, [
    agentPanelVisible,
    memoListVisible,
    setAgentPanelVisible,
    setMemoListVisible,
  ]);

  // 双指横向滑动 → 切换侧栏 / Agent 面板 (macOS only, hook 内部已判定平台)。
  //
  // 手势矩阵 (memolist × agent):
  //   开 × *    左滑 → 关闭 memolist; 右滑 → no-op (memolist 已开)
  //   关 × 开   左滑 → no-op; 右滑 → 关闭 agent
  //   关 × 关   左滑 → 打开 agent; 右滑 → 打开 memolist (回落原手势)
  //
  // 守卫防止 set 在已是目标值时仍触发订阅者重渲 ── useSettingsStore
  // 没有 subscribeWithSelector, set 会通知所有订阅者。
  useMacosTrackpadSwipe({ onSwipe: handlePanelSwipe });

  const currentMemo = currentDocumentPath && currentDocumentSource === 'memo' && activeMemoSession
    ? memos.find((memo) => memo.id === activeMemoSession.memoId)
      ?? (selectedMemo?.id === activeMemoSession.memoId ? selectedMemo : null)
    : null;
  const isExternalDocument = currentDocumentSource === 'external';
  const currentDocumentInstanceKey =
    currentDocumentSource === 'memo' && activeMemoSession
      ? activeMemoSession.id
      : activeExternalSession?.id ?? (currentDocumentPath ? getDocumentInstanceKey(currentDocumentPath) : null);
  const todoCount = useNotebookTodoCount(selectedNotebook?.path, refreshTrigger, memos.length);
  const { isDraggingFiles } = useExternalDocumentOpen({
    openExternalDocumentSession,
    setSelectedMemo,
  });
  const getCurrentDocumentContent = useCallback(() => currentDocumentContentRef.current, []);
  const {
    handleCopyFullText,
    handleCopyLink,
    handleCopyExternalPath,
    handleTogglePin,
    handleColorsChange,
    handleExportMarkdown,
    handleExportWord,
  } = useDocumentCommands({
    currentDocumentPath,
    getCurrentDocumentContent,
    currentMemo,
    isExternalDocument,
    updateMemoMeta,
    setMemoColors,
  });

  // The DocumentContainer owns the import hook (it needs the editor's
  // contentRef + saveDoc) but the titlebar renders the file path and the
  // "保存为笔记" button. We bridge them: container publishes its api upward
  // via onExternalImportApiChange, we hold it here, and feed it to the
  // titlebar. The setter is memoized so the container's effect doesn't
  // re-fire on every parent render.
  const [externalImportApi, setExternalImportApi] = useState<{
    isSaving: boolean;
    save: () => void;
  } | null>(null);
  const handleExternalImportApiChange = useCallback(
    (api: { isSaving: boolean; save: () => void } | null) => {
      setExternalImportApi(api);
    },
    [],
  );

  useEffect(() => {
    currentDocumentContentRef.current = '';
  }, [currentDocumentInstanceKey]);

  // 切换 memo 时关闭搜索面板 — 搜索/替换的 matches 是基于当前 editor state,
  // 切到新 memo 后旧结果毫无意义, 应当随切换重置。
  useEffect(() => {
    setIsSearchPanelOpen(false);
  }, [currentDocumentInstanceKey]);

  // 监听 ⌘⇧N 切换笔记本下拉面板 — 状态留在 MainLayout 内部,
  // 走与 memo-list.tsx 的 `flowix:toggle-palette` 同款 CustomEvent 解耦模式。
  // setNotebookPopupOpen 用 prev 回调实现 toggle 语义, 二次触发即关闭。
  useEffect(() => {
    const handleToggle = () => setNotebookPopupOpen(prev => !prev);
    window.addEventListener('flowix:toggle-notebook-switcher', handleToggle);
    return () => window.removeEventListener('flowix:toggle-notebook-switcher', handleToggle);
  }, []);

  const handleOpenTodos = useCallback(async () => {
    setMemoListVisible(true);
    setActiveFilter('todos');
    await loadMemos({
      notebookId: selectedNotebook?.id,
      filter: 'todos',
      sort: activeSort,
    });
  }, [activeSort, loadMemos, selectedNotebook?.id, setActiveFilter, setMemoListVisible]);

  const handleNavigateBack = useCallback(() => {
    void navigateDocumentHistory('back');
  }, []);

  const handleNavigateForward = useCallback(() => {
    void navigateDocumentHistory('forward');
  }, []);

  const handleSelectNotebook = useCallback(
    async (notebook: Notebook) => {
      if (selectedNotebook?.id === notebook.id) return;
      setSelectedNotebook(notebook);
      setSelectedMemo(null);
      clearDocument();
      try {
        await request('set_current_notebook', { notebookId: notebook.id });
      } catch (error) {
        console.warn('[MainLayout] Failed to sync current notebook:', error);
      }
      triggerRefresh();
    },
    [clearDocument, request, selectedNotebook?.id, setSelectedMemo, setSelectedNotebook, triggerRefresh]
  );

  const handleEditNotebook = useCallback(
    (notebook: Notebook) => {
      // Close the dropdown first so it doesn't overlap the dialog.
      setNotebookPopupOpen(false);
      // Defer to next tick so the dropdown finishes closing before the dialog opens.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent<Notebook>('flowix:open-edit-notebook', { detail: notebook }));
      }, 0);
    },
    []
  );

  const handleDeleteNotebook = useCallback(
    (notebook: Notebook) => {
      if (notebook.isDefault) {
        toast.error('默认笔记本不可删除');
        return;
      }
      // Close the dropdown so the confirmation dialog isn't visually stacked
      // on top of the popup, then open the confirmation dialog on the next
      // tick (the dropdown needs a frame to start its close transition).
      setNotebookPopupOpen(false);
      setTimeout(() => {
        setNotebookToDelete(notebook);
      }, 0);
    },
    []
  );

  const handleConfirmDeleteNotebook = useCallback(async () => {
    const target = notebookToDelete;
    if (!target) return;
    try {
      const ok = await notebooksClient.delete(target.id);
      if (ok) {
        toast.success('已删除');
        const nbList = await notebooksClient.getAll();
        if (nbList) setNotebooks(nbList);
      } else {
        toast.error('删除失败');
      }
    } catch (error) {
      console.warn('[MainLayout] Failed to delete notebook:', error);
      toast.error('删除失败');
    } finally {
      setNotebookToDelete(null);
    }
  }, [notebookToDelete, setNotebooks]);

  // Document titlebar's more → delete menu: hand off to MemoList, which owns
  // the delete-memo confirmation dialog. We use a custom event (same pattern
  // as the notebook edit dialog) so MainLayout doesn't need to lift MemoList's
  // state up.
  const handleRequestDeleteMemo = useCallback(() => {
    if (!currentMemo) return;
    window.dispatchEvent(
      new CustomEvent<MemoItem>('flowix:request-delete-memo', { detail: currentMemo })
    );
  }, [currentMemo]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--document-bg)' }}>
      <WindowsTitlebarControls />
      <FullscreenDragOverlay visible={isDraggingFiles} />
      <MenuBoard open={isMenuBoardOpen} onOpenChange={setIsMenuBoardOpen} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex flex-1 h-full overflow-hidden">
          {/* Memo list column */}
          <div
            className={`flex flex-col overflow-hidden will-change-[width] ${
              isDraggingListDivider ? 'transition-none' : 'transition-[width] duration-150 ease-out'
            }`}
            style={{ width: memoListWidth, flexShrink: 0 }}
            aria-hidden={isMemoListHidden}
          >
            <div
              className="flex flex-col overflow-hidden h-full bg-[var(--card)] border-[var(--border)] border-r"
              style={{ width: memoColWidth }}
            >
              {isWindowsPlatform() ? (
                <MemoListTitlebarWin
                  onCollapseSidebar={() => setMemoListVisible(false)}
                  onOpenPreferences={() => windows.openPreferences()}
                />
              ) : (
                <MemoListTitlebarMac
                  onCollapseSidebar={() => setMemoListVisible(false)}
                  onOpenPreferences={() => windows.openPreferences()}
                />
              )}
              <div className="flex-1 min-h-0">
                <MemoList />
              </div>
            </div>
          </div>
          {/* List <-> Memo detail divider */}
          {!isMemoListHidden && (
            <div className="relative w-[1px] h-full cursor-col-resize group z-10" onMouseDown={handleListDividerMouseDown}>
              <div className="absolute inset-0 -translate-x-1/2 w-[12px] left-1/2 bg-transparent z-11" />
              <div className={`w-[1px] h-full transition-colors ${isDraggingListDivider ? 'bg-transparent' : 'group-hover:bg-transparent bg-transparent'}`} />
            </div>
          )}
          {/* Memo detail */}
            <div className="h-full min-w-0 relative flex flex-col" style={{ minWidth: 200, flex: 1 }}>
            {/* Fixed top navigation bar */}
            {isWindowsPlatform() ? (
              <DocumentTitlebarWin
                currentMemo={currentMemo}
                isSidebarHidden={isMemoListHidden}
                isAgentPanelVisible={agentPanelVisible}
                onToggleSidebar={toggleMemoListVisible}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                onNavigateBack={handleNavigateBack}
                onNavigateForward={handleNavigateForward}
                onOpenSearch={() => setIsSearchPanelOpen(true)}
                onCopyLink={handleCopyLink}
                onCopyFullText={handleCopyFullText}
                onTogglePin={handleTogglePin}
                onExportMarkdown={handleExportMarkdown}
                onExportWord={handleExportWord}
                onRequestDeleteMemo={handleRequestDeleteMemo}
                onColorsChange={handleColorsChange}
                externalFilePath={isExternalDocument ? currentDocumentPath : null}
                isExternalSaving={externalImportApi?.isSaving ?? false}
                onSaveExternalToMemo={externalImportApi?.save}
                onCopyExternalPath={isExternalDocument ? handleCopyExternalPath : undefined}
              />
            ) : (
              <DocumentTitlebarMac
                currentMemo={currentMemo}
                isSidebarHidden={isMemoListHidden}
                onToggleSidebar={toggleMemoListVisible}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                onNavigateBack={handleNavigateBack}
                onNavigateForward={handleNavigateForward}
                onOpenSearch={() => setIsSearchPanelOpen(true)}
                onCopyLink={handleCopyLink}
                onCopyFullText={handleCopyFullText}
                onTogglePin={handleTogglePin}
                onExportMarkdown={handleExportMarkdown}
                onExportWord={handleExportWord}
                onRequestDeleteMemo={handleRequestDeleteMemo}
                onColorsChange={handleColorsChange}
                externalFilePath={isExternalDocument ? currentDocumentPath : null}
                isExternalSaving={externalImportApi?.isSaving ?? false}
                onSaveExternalToMemo={externalImportApi?.save}
                onCopyExternalPath={isExternalDocument ? handleCopyExternalPath : undefined}
              />
            )}

            {/* Content area */}
            <div className="relative flex-1 min-w-0 overflow-hidden">
              {currentDocumentPath ? (
                <DocumentContainer
                  key={currentDocumentInstanceKey}
                  filePath={currentDocumentPath}
                  memoId={activeMemoSession?.memoId ?? null}
                  notebookId={activeMemoSession?.notebookId ?? null}
                  notebookPath={activeMemoSession?.notebookPath ?? null}
                  transitionId={activeMemoSession?.transitionId ?? activeExternalSession?.transitionId ?? null}
                  isExternalDocument={isExternalDocument}
                  searchPanelOpen={isSearchPanelOpen}
                  onSearchPanelOpenChange={setIsSearchPanelOpen}
                  toolbarCollapsed={isToolbarCollapsed}
                  onToolbarCollapsedChange={setIsToolbarCollapsed}
                  onMetainfoData={(data) => {
                    currentDocumentContentRef.current = data.memoContent;
                  }}
                  onCharCountChange={setCharCount}
                  onExternalImportApiChange={handleExternalImportApiChange}
                />
              ) : (
                <div className="relative flex h-full w-full items-center justify-center">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-no-repeat bg-bottom bg-[length:auto_800px] opacity-[0.32]"
                    style={{ backgroundImage: `url(${backgroundImage})` }}
                  />
                  <span className="relative text-center text-[var(--muted-foreground)] text-sm">
                    请选择一个文档
                  </span>
                </div>
              )}
              {isDocumentTransitioning && (
                <div
                  className="absolute inset-0 z-40 flex items-center justify-center bg-[color-mix(in_oklch,var(--card)_78%,transparent)] backdrop-blur-[1px]"
                  role="status"
                  aria-label="Loading"
                >
                  <div
                    className="h-5 w-5 rounded-full border-2 border-[color-mix(in_oklch,var(--muted-foreground)_26%,transparent)] border-t-[var(--brand)] animate-spin"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          </div>
          {/* Agent chat panel divider */}
            <div
              className={`relative h-full group z-10 overflow-hidden ${
                isDraggingAgentDivider ? 'transition-none' : 'transition-[width,opacity] duration-150 ease-out'
              } ${
                agentPanelVisible ? 'cursor-col-resize opacity-100' : 'pointer-events-none opacity-0'
              }`}
              style={{ width: agentPanelVisible ? 1 : 0, flexShrink: 0 }}
              onMouseDown={agentPanelVisible ? handleAgentDividerMouseDown : undefined}
            >
              <div className="absolute inset-0 -translate-x-1/2 w-[12px] left-1/2 bg-transparent z-11" />
              <div className="w-[1px] h-full transition-colors bg-transparent" />
            </div>
          {/* Agent chat panel */}
            <div
              className={`h-full flex-shrink-0 overflow-hidden will-change-[width] ${
                isDraggingAgentDivider ? 'transition-none' : 'transition-[width] duration-150 ease-out'
              }`}
              style={{ width: agentPanelWidth }}
              aria-hidden={!agentPanelVisible}
            >
              <div
                className="h-full overflow-hidden bg-[var(--agent-bg)] border-[var(--border)] border-l"
                style={{ width: agentPanelDraftWidth }}
              >
                {agentPanelVisible && <LazyAgentPanel onClosePanel={toggleAgentPanelVisible} />}
              </div>
            </div>
          </div>
          {/* Status bar */}
          <StatusBar
            memoColWidth={memoColWidth}
            notebooks={notebooks}
            selectedNotebook={selectedNotebook}
            notebookPopupOpen={notebookPopupOpen}
            setNotebookPopupOpen={setNotebookPopupOpen}
            onSelectNotebook={handleSelectNotebook}
            onEditNotebook={handleEditNotebook}
            onDeleteNotebook={handleDeleteNotebook}
            onRefreshNotebooks={(nbList) => setNotebooks(nbList)}
            todoCount={todoCount}
            onOpenTodos={handleOpenTodos}
            charCount={charCount}
            onToggleAgentPanel={toggleAgentPanelVisible}
            onOpenPreferences={() => windows.openPreferences()}
          />
        </div>
      </div>

      <NotebookDeleteDialog
        target={notebookToDelete ? { id: notebookToDelete.id, name: notebookToDelete.name } : null}
        onCancel={() => setNotebookToDelete(null)}
        onConfirm={handleConfirmDeleteNotebook}
      />
    </div>
  );
}
