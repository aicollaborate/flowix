'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MenuBoard } from './menu-board';
import { DocumentContainer } from './document-pane/document-container';
import { DocumentTitlebarWin } from './document-pane/document-titlebar-win';
import { DocumentTitlebarMac } from './document-pane/document-titlebar-mac';
import { MemoList } from './memo-pane/memo-list';
import { MemoListTitlebarWin } from './memo-pane/memo-list-titlebar-win';
import { MemoListTitlebarMac } from './memo-pane/memo-list-titlebar-mac';
import { AgentChatRoot } from './agent-panel/agent-root';
import { useTauriRpc } from '../../lib/hooks/useTauriRpc';
import { useMemoStore, useDocumentStore, useSettingsStore, type Notebook, type MemoItem, type MemoColor } from '../../lib/store';
import { files, memos as memosClient, notebooks as notebooksClient, dialogs, type SaveFileFilter, windows } from '../../lib/tauri/client';
import { WindowsTitlebarControls } from '../../components/windows-titlebar-controls';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from '../../lib/toast';
import {
  buildWordHtml,
  markdownToHtml,
  sanitizeFileName,
  stripFrontmatter,
} from '../../lib/export';
import { getDocumentInstanceKey } from '../../lib/path';
import { StatusBar } from './status-bar/status-bar';
import { NotebookDeleteDialog } from './notebook-delete-dialog';
import { FullscreenDragOverlay } from './drag-overlay/fullscreen-drag-overlay';
import backgroundImage from '../../assets/bg.document.png';

interface MemoMetadataFile {
  todos?: unknown[];
}

type ExportableDocument = { title: string; markdown: string };

const EXTERNAL_MARKDOWN_OPENED_EVENT = 'external-markdown-opened';
const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown)$/i;

function isWindowsPlatform(): boolean {
  return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

function getNotebookMemoMetadataPath(notebookPath: string): string {
  const clean = notebookPath.replace(/[\\/]+$/, '');
  return `${clean}/.metadata/memo.json`;
}

function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(path);
}

function extractTitleFromMarkdown(body: string): string {
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed
      .replace(/^#+\s*/, '')
      .replace(/^[-*+]\s*\[[ xX]?\]\s*/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 120);
  }
  return '';
}

function firstMarkdownPath(paths?: string[]): string | undefined {
  return paths?.find(isMarkdownPath);
}

export function MainLayout() {
  const { memos, notebooks, selectedMemo, selectedNotebook, refreshTrigger, activeSort, setActiveFilter, loadMemos, setSelectedMemo, setSelectedNotebook, setNotebooks, triggerRefresh, updateMemoMeta, setMemoColors } = useMemoStore();
  const {
    currentDocumentPath,
    currentDocumentSource,
    activeMemoSession,
    activeExternalSession,
    openExternalDocument: openExternalDocumentSession,
    clearDocument,
  } = useDocumentStore();
  const {
    memoListVisible,
    agentPanelVisible,
    agentColWidth,
    setMemoListVisible,
    toggleMemoListVisible,
    toggleAgentPanelVisible,
    setAgentColWidth,
  } = useSettingsStore();
  const [isMenuBoardOpen, setIsMenuBoardOpen] = useState(false);
  const [notebookPopupOpen, setNotebookPopupOpen] = useState(false);
  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null);
  const { request } = useTauriRpc();
  const [memoColWidth, setMemoColWidth] = useState(320);
  const [agentPanelDraftWidth, setAgentPanelDraftWidth] = useState(agentColWidth);
  const [isDraggingListDivider, setIsDraggingListDivider] = useState(false);
  const [isDraggingAgentDivider, setIsDraggingAgentDivider] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  // Toolbar collapsed — owned here, controlled by the toolbar's own collapse/expand
  // buttons. Session-only.
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [currentDocumentContent, setCurrentDocumentContent] = useState('');
  const listDividerStartRef = useRef({ x: 0, width: 0 });
  const agentDividerStartRef = useRef({ x: 0, width: agentColWidth });
  const agentPanelDraftWidthRef = useRef(agentColWidth);
  const isMemoListHidden = !memoListVisible;
  const memoListWidth = isMemoListHidden ? 0 : memoColWidth;
  const agentPanelWidth = agentPanelVisible ? agentPanelDraftWidth : 0;

  useEffect(() => {
    if (isDraggingAgentDivider) return;
    setAgentPanelDraftWidth(agentColWidth);
    agentPanelDraftWidthRef.current = agentColWidth;
  }, [agentColWidth, isDraggingAgentDivider]);

  // Memo list divider drag
  const handleListDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingListDivider(true);
    listDividerStartRef.current = { x: e.clientX, width: memoColWidth };
  }, [memoColWidth]);

  // Agent panel divider drag
  const handleAgentDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingAgentDivider(true);
    agentDividerStartRef.current = { x: e.clientX, width: agentPanelDraftWidth };
    agentPanelDraftWidthRef.current = agentPanelDraftWidth;
  }, [agentPanelDraftWidth]);

  useEffect(() => {
    if (!isDraggingListDivider && !isDraggingAgentDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingListDivider) {
        const diff = e.clientX - listDividerStartRef.current.x;
        const newW = listDividerStartRef.current.width + diff;
        if (newW >= 150 && newW <= 500) setMemoColWidth(newW);
      }
      if (isDraggingAgentDivider) {
        const diff = agentDividerStartRef.current.x - e.clientX;
        const newW = agentDividerStartRef.current.width + diff;
        if (newW >= 200 && newW <= 600) {
          agentPanelDraftWidthRef.current = newW;
          setAgentPanelDraftWidth(newW);
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingAgentDivider) {
        setAgentColWidth(agentPanelDraftWidthRef.current);
      }
      setIsDraggingListDivider(false);
      setIsDraggingAgentDivider(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingListDivider, isDraggingAgentDivider, setAgentColWidth]);

  // Narrow window: opening the agent panel auto-collapses the memo list to
  // reclaim horizontal space. We only act on the false→true transition, so
  // once the agent panel is open the user can freely re-open the memo list
  // without us fighting them.
  const prevAgentPanelVisibleRef = useRef(agentPanelVisible);
  useEffect(() => {
    if (
      agentPanelVisible &&
      !prevAgentPanelVisibleRef.current &&
      window.innerWidth < 1100 &&
      memoListVisible
    ) {
      setMemoListVisible(false);
    }
    prevAgentPanelVisibleRef.current = agentPanelVisible;
  }, [agentPanelVisible, memoListVisible, setMemoListVisible]);

  const currentMemo = currentDocumentPath && currentDocumentSource === 'memo' && activeMemoSession
    ? memos.find((memo) => memo.id === activeMemoSession.memoId)
      ?? (selectedMemo?.id === activeMemoSession.memoId ? selectedMemo : null)
    : null;
  const isExternalDocument = currentDocumentSource === 'external';
  const currentDocumentInstanceKey =
    currentDocumentSource === 'memo' && activeMemoSession
      ? activeMemoSession.id
      : activeExternalSession?.id ?? (currentDocumentPath ? getDocumentInstanceKey(currentDocumentPath) : null);

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

  const openExternalDocument = useCallback(async (path: string | undefined) => {
    if (!path || !isMarkdownPath(path)) return;
    // 必须先 await document store 的 set() 落到 store, 再 setSelectedMemo(null).
    // 顺序颠倒会触发 memo-list.tsx:229 那个 useEffect —— 它在 selectedMemo 变 null 时
    // 检查 currentDocumentSource !== 'external' 就调 clearDocument(). 如果在 document store
    // 还没 set() 之前先 setSelectedMemo(null), useEffect 看到 currentDocumentSource 还是空
    // 状态, 误调 clearDocument(), 它的 set() 后于 openExternalDocumentSession 的 set()
    // 执行, 把刚 set 好的 currentDocumentPath 覆盖回 null —— 表现就是"首次拖入文档被清空".
    await openExternalDocumentSession(path);
    setSelectedMemo(null);
  }, [openExternalDocumentSession, setSelectedMemo]);

  useEffect(() => {
    setCurrentDocumentContent('');
  }, [currentDocumentInstanceKey]);

  // 切换 memo 时关闭搜索面板 — 搜索/替换的 matches 是基于当前 editor state,
  // 切到新 memo 后旧结果毫无意义, 应当随切换重置。
  useEffect(() => {
    setIsSearchPanelOpen(false);
  }, [currentDocumentInstanceKey]);

  const writeClipboardText = useCallback(async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }, []);

  const handleCopyFullText = useCallback(async () => {
    if (!currentDocumentPath) return;

    try {
      const content = currentDocumentContent || await memosClient.readDocument(currentDocumentPath) || '';
      await writeClipboardText(content);
      toast.success('复制成功');
    } catch (error) {
      console.warn('[MainLayout] Failed to copy document content:', error);
      toast.error('复制失败');
    }
  }, [currentDocumentContent, currentDocumentPath, writeClipboardText]);

  const handleCopyLink = useCallback(async () => {
    if (!currentDocumentPath) return;

    try {
      await writeClipboardText(currentDocumentPath);
      toast.success('复制成功');
    } catch (error) {
      console.warn('[MainLayout] Failed to copy document link:', error);
      toast.error('复制失败');
    }
  }, [currentDocumentPath, writeClipboardText]);

  const handleCopyExternalPath = useCallback(async () => {
    if (!currentDocumentPath || !isExternalDocument) return;

    try {
      await writeClipboardText(currentDocumentPath);
      toast.success('已复制完整路径');
    } catch (error) {
      console.warn('[MainLayout] Failed to copy external path:', error);
      toast.error('复制失败');
    }
  }, [currentDocumentPath, isExternalDocument, writeClipboardText]);

  const handleTogglePin = useCallback(async () => {
    if (!currentMemo) return;

    const wasFavorited = currentMemo.favorited;
    try {
      const ok = wasFavorited
        ? await memosClient.unfavoriteMemo(currentMemo.id)
        : await memosClient.favoriteMemo(currentMemo.id);

      if (!ok) {
        toast.error(wasFavorited ? '取消置顶失败' : '置顶失败');
        return;
      }

      updateMemoMeta(currentMemo.id, { favorited: !wasFavorited });
      toast.success(wasFavorited ? '取消置顶成功' : '置顶成功');
    } catch (error) {
      console.warn('[MainLayout] Failed to toggle pin:', error);
      toast.error(wasFavorited ? '取消置顶失败' : '置顶失败');
    }
  }, [currentMemo, updateMemoMeta]);

  // 文档颜色标签 — 走 store action (乐观更新 + IPC) 写 list.json。
  // 不弹 toast: 这是一个高频、低成本操作, 失败概率极低, 即便失败
  // store / 后端的 memo-event 链路也会自然收敛。
  const handleColorsChange = useCallback((next: MemoColor[]) => {
    if (!currentMemo) return;
    void setMemoColors(currentMemo.id, next);
  }, [currentMemo, setMemoColors]);

  const getExportableDocument = useCallback(async (): Promise<ExportableDocument | null> => {
    if (!currentDocumentPath) return null;

    let raw = currentDocumentContent;
    if (!raw) {
      try {
        raw = (await memosClient.readDocument(currentDocumentPath)) ?? '';
      } catch (error) {
        console.warn('[MainLayout] Failed to read document for export:', error);
        toast.error('读取文档失败');
        return null;
      }
    }

    const title = currentMemo?.filename || extractTitleFromMarkdown(stripFrontmatter(raw)) || 'Untitled';
    return { title, markdown: raw };
  }, [currentDocumentContent, currentDocumentPath, currentMemo?.filename]);

  const requireExportableDocument = useCallback(async () => {
    const doc = await getExportableDocument();
    if (!doc) {
      toast.error('没有可导出的文档');
      return null;
    }
    return doc;
  }, [getExportableDocument]);

  const promptExportTarget = useCallback(async (doc: ExportableDocument, extension: string, filter: SaveFileFilter) => {
    return dialogs.saveFile(`${sanitizeFileName(doc.title)}.${extension}`, [filter]);
  }, []);

  const handleExportMarkdown = useCallback(async () => {
    const doc = await requireExportableDocument();
    if (!doc) return;

    const target = await promptExportTarget(doc, 'md', { name: 'Markdown', extensions: ['md', 'markdown'] });
    if (!target) return;

    const ok = await dialogs.writeExportFile(target, doc.markdown);
    toast[ok ? 'success' : 'error'](ok ? '已导出 Markdown' : '导出失败');
  }, [promptExportTarget, requireExportableDocument]);

  const handleExportWord = useCallback(async () => {
    const doc = await requireExportableDocument();
    if (!doc) return;

    const target = await promptExportTarget(doc, 'doc', { name: 'Word 文档', extensions: ['doc'] });
    if (!target) return;

    let bodyHtml: string;
    try {
      bodyHtml = markdownToHtml(doc.markdown);
    } catch (error) {
      console.warn('[MainLayout] Failed to convert markdown for Word export:', error);
      toast.error('导出失败');
      return;
    }

    const ok = await dialogs.writeExportFile(target, buildWordHtml(doc.title, bodyHtml));
    toast[ok ? 'success' : 'error'](ok ? '已导出 Word 文档' : '导出失败');
  }, [promptExportTarget, requireExportableDocument]);

  const handleOpenTodos = useCallback(async () => {
    setMemoListVisible(true);
    setActiveFilter('todos');
    await loadMemos({
      notebookId: selectedNotebook?.id,
      filter: 'todos',
      sort: activeSort,
    });
  }, [activeSort, loadMemos, selectedNotebook?.id, setActiveFilter, setMemoListVisible]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadNotebookTodoCount() {
      if (!selectedNotebook?.path) {
        setTodoCount(0);
        return;
      }

      try {
        const content = await files.read(
          getNotebookMemoMetadataPath(selectedNotebook.path),
          selectedNotebook.path
        );
        if (cancelled) return;

        if (!content) {
          setTodoCount(0);
          return;
        }

        const metadata = JSON.parse(content) as MemoMetadataFile;
        setTodoCount(Array.isArray(metadata.todos) ? metadata.todos.length : 0);
      } catch (error) {
        if (!cancelled) {
          console.warn('[MainLayout] Failed to read memo metadata todos:', error);
          setTodoCount(0);
        }
      }
    }

    loadNotebookTodoCount();

    return () => {
      cancelled = true;
    };
  }, [selectedNotebook?.path, refreshTrigger, memos.length]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    memosClient.getLaunchOpenFiles()
      .then((paths) => {
        const path = firstMarkdownPath(paths);
        if (!disposed && path) {
          openExternalDocument(path);
        }
      })
      .catch((error) => console.warn('[MainLayout] Failed to read launch files:', error));

    listen<string[]>(EXTERNAL_MARKDOWN_OPENED_EVENT, (event) => {
      openExternalDocument(firstMarkdownPath(event.payload));
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openExternalDocument]);

  // 区分"窗口内 HTML5 拖动"与"外部 OS 文件拖入"。
  //
  // Tauri 的 onDragDropEvent 也会对 webview 内部的 HTML5 drag 触发 enter/leave,
  // 会让"拖入松开，打开文件"蒙层误显示在拖动 memo list item 等内部操作上。
  // HTML5 原生 dragstart / dragend 只对 draggable 元素触发 — 外部 OS 拖文件不会
  // 触发 — 用 ref 标记内部拖动期, Tauri 事件处理时跳过蒙层显隐。
  const isInternalHtml5DragRef = useRef(false);

  useEffect(() => {
    const onHtmlDragStart = () => {
      isInternalHtml5DragRef.current = true;
    };
    const onHtmlDragEnd = () => {
      isInternalHtml5DragRef.current = false;
    };
    document.addEventListener('dragstart', onHtmlDragStart);
    document.addEventListener('dragend', onHtmlDragEnd);
    document.addEventListener('drop', onHtmlDragEnd);
    return () => {
      document.removeEventListener('dragstart', onHtmlDragStart);
      document.removeEventListener('dragend', onHtmlDragEnd);
      document.removeEventListener('drop', onHtmlDragEnd);
    };
  }, []);

  useEffect(() => {
    // 纯 web 调试模式（Vite 浏览器）下没有 Tauri runtime，避免无谓挂载 + 控制台噪音。
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onDragDropEvent((event) => {
      // 内部 HTML5 拖动期间: 不显示外部文件蒙层, drop 也不接管 (memo card 自己的
      // onDragEnd 会处理"拖到空白处打开新窗口"的内部逻辑)。
      if (isInternalHtml5DragRef.current) {
        return;
      }
      const { type } = event.payload;
      // enter/over 显示蒙层，drop/leave 清除。`over` 事件高频触发但只读 payload，
      // 不会触发额外渲染开销（蒙层显隐只跟 enter/leave 相关）。
      if (type === 'enter' || type === 'over') {
        if (type === 'enter') {
          setIsDraggingFiles(true);
        }
        return;
      }
      if (type === 'leave' || type === 'drop') {
        setIsDraggingFiles(false);
      }
      if (type !== 'drop') return;
      const { paths } = event.payload;
      if (!paths || paths.length === 0) return;
      // 拖到窗口的 .md 文件统一走 "external markdown" 模式: 不进 list.json,
      // 用户可手动 save 成正式 memo。
      openExternalDocument(firstMarkdownPath(paths));
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((error) => {
      console.warn('[MainLayout] Failed to listen for file drops:', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openExternalDocument]);

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
            <div className="flex-1 min-w-0 overflow-hidden">
              {currentDocumentPath ? (
                <DocumentContainer
                  key={currentDocumentInstanceKey}
                  filePath={currentDocumentPath}
                  memoId={activeMemoSession?.memoId ?? null}
                  notebookId={activeMemoSession?.notebookId ?? null}
                  notebookPath={activeMemoSession?.notebookPath ?? null}
                  isExternalDocument={isExternalDocument}
                  searchPanelOpen={isSearchPanelOpen}
                  onSearchPanelOpenChange={setIsSearchPanelOpen}
                  toolbarCollapsed={isToolbarCollapsed}
                  onToolbarCollapsedChange={setIsToolbarCollapsed}
                  onMetainfoData={(data) => setCurrentDocumentContent(data.memoContent)}
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
                <AgentChatRoot onClosePanel={toggleAgentPanelVisible} />
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
