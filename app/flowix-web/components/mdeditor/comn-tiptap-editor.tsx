import { Editor, Extension, renderNestedMarkdownContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useShortcutScope, pushHandler } from '../../lib/shortcuts';
import { AttachmentLink } from './extensions/attachment-link';
import { TableBubbleMenu } from './components/table-bubble-menu';
import { ComnTiptapToolbar } from './components/tiptap-toolbar';
import { DragContextMenu } from './components/drag-context-menu';
import { SelectionBubbleMenu } from './components/selection-bubble-menu';
import { attachLinkHoverTooltip } from './components/link-hover-tooltip';
import { Tag } from './extensions/tag';
import MarkdownPaste from './extensions/markdown-paste';
import { LinkSelectionHighlight, MarkdownLink } from './extensions/markdown-link';
import { NoteReference } from './extensions/note-reference';
import { DateTimeWidget, updateDateTimeWidget } from './extensions/datetime-widget';
import { CodeBlockShiki } from './extensions/codeblock-shiki/codeblock-shiki';
import { SearchAndReplace } from './extensions/search-replace';
import { SearchReplacePanel } from './extensions/search-replace-panel';
import Frontmatter from './extensions/frontmatter';
import { MenuPinExtension } from './extensions/menu-pin';
import { SlashMenu } from './extensions/slash-menu';
import { AgentThreadCard } from './extensions/agent-thread-card';

interface ComnTiptapEditorProps {
  content: string;
  editable?: boolean;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  className?: string;
  onEditorScroll?: (scrollTop: number) => void;
  autoFocus?: boolean;
  editorStorageUpdatedAt?: Date | null;
  onBeforeCreate?: (editor: Editor) => void;
  // 搜索面板由父组件控制（titlebar 按钮 / Ctrl+F 共享同一开关）
  searchPanelOpen?: boolean;
  onSearchPanelOpenChange?: (open: boolean) => void;
  // Toolbar collapsed — owned by main-layout. Tooltip of the toolbar's visibility
  // is driven purely by this state; the editor no longer tracks focus.
  toolbarCollapsed?: boolean;
  onToolbarCollapsedChange?: (collapsed: boolean) => void;
  onEditingFinished?: () => void;
}

const PreservedParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) {
      const previousContent = Array.isArray(ctx?.previousNode?.content)
        ? ctx.previousNode.content
        : [];
      const previousNodeIsEmptyParagraph =
        ctx?.previousNode?.type === 'paragraph' && previousContent.length === 0;

      return previousNodeIsEmptyParagraph ? '&nbsp;' : '';
    }

    return h.renderChildren(content);
  },
});


const MarkdownEscape = Extension.create({
  name: 'markdownEscape',
  markdownTokenName: 'escape',
  parseMarkdown(token, h) {
    return h.createTextNode(token.raw || token.text || '');
  },
});

function isEmptyParagraphNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;

  const maybeNode = node as { type?: string; content?: unknown };
  return maybeNode.type === 'paragraph' &&
    (!Array.isArray(maybeNode.content) || maybeNode.content.length === 0);
}

const PreservedTaskItem = TaskItem.extend({
  renderMarkdown(node, h) {
    const checkedChar = node.attrs?.checked ? 'x' : ' ';
    const prefix = `- [${checkedChar}] `;
    const content = Array.isArray(node.content) ? node.content : [];

    if (!isEmptyParagraphNode(content[0])) {
      return renderNestedMarkdownContent(node, h, prefix);
    }

    let output = prefix;
    const nestedContent = content.slice(1);

    nestedContent.forEach((child, index) => {
      const childContent = h.renderChild?.(child, index + 1) ?? h.renderChildren([child]);
      if (childContent === undefined || childContent === null) return;

      const indentedChild = childContent
        .split('\n')
        .map(line => h.indent(line || ''))
        .join('\n');

      output += child.type === 'paragraph' ? `\n\n${indentedChild}` : `\n${indentedChild}`;
    });

    return output;
  },
});

export function ComnTiptapEditor({
  content,
  editable = true,
  placeholder,
  onChange,
  className,
  onEditorScroll,
  autoFocus = false,
  editorStorageUpdatedAt,
  onBeforeCreate,
  searchPanelOpen = false,
  onSearchPanelOpenChange,
  toolbarCollapsed = false,
  onToolbarCollapsedChange,
  onEditingFinished,
}: ComnTiptapEditorProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEditorScrollRef = useRef(onEditorScroll);
  const contentRef = useRef(content);
  const isApplyingExternalContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onSearchPanelOpenChangeRef = useRef(onSearchPanelOpenChange);
  const onEditingFinishedRef = useRef(onEditingFinished);
  onEditorScrollRef.current = onEditorScroll;
  onChangeRef.current = onChange;
  onSearchPanelOpenChangeRef.current = onSearchPanelOpenChange;
  onEditingFinishedRef.current = onEditingFinished;

  // 注册 'editor' scope — 挂载期间 editor.undo / editor.redo 生效,
  // 卸载后 pop, 防止在 memo 列表/弹窗里按 ⌘Z 误触发。
  useShortcutScope('editor');

  const findScrollable = useCallback((el: Element): HTMLElement | null => {
    const style = window.getComputedStyle(el);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return el as HTMLElement;
    }
    for (const child of Array.from(el.children)) {
      const found = findScrollable(child);
      if (found) return found;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!elementRef.current || !content) {
      return;
    }
    const editor = new Editor({
      element: elementRef.current,
      // 修复跨多块复制时多余空行：ProseMirror 默认在块间插入 `\n\n`，
      // 改成单个 `\n`，粘贴到纯文本目标时块间只保留一个换行。
      editorProps: {
        clipboardTextSerializer(content) {
          return content.content.textBetween(0, content.content.size, '\n', '\n');
        },
      },
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3, 4],
          },
          dropcursor: false,
          gapcursor: false,
          link: false,
          codeBlock: false,
          paragraph: false,
        }),
        PreservedParagraph,
        MarkdownEscape,
        AttachmentLink,
        MarkdownLink,
        LinkSelectionHighlight,
        CodeBlockShiki,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        PreservedTaskItem.configure({
          nested: true,
        }),
        Markdown.configure({
          markedOptions: {
            gfm: true,
            breaks: true,
          },
        }),
        Placeholder.configure({
          placeholder: placeholder || '开始书写…',
        }),
        Tag,
        MarkdownPaste,
        DateTimeWidget,
        Frontmatter,
        NoteReference,
        AgentThreadCard,
        SlashMenu,
        SearchAndReplace,
        MenuPinExtension,
      ],
      content: content,
      contentType: 'markdown',
      editable,
      autofocus: autoFocus ? 'end' : false,
      onUpdate: ({ editor }) => {
        const markdown = editor.getMarkdown();
        contentRef.current = markdown;
        if (isApplyingExternalContentRef.current) return;
        onChangeRef.current?.(markdown);
      },
      // onBlur 仍需要触发 onEditingFinished (最终化重命名等); toolbar 显隐
      // 不再依赖 focus, 去掉 onFocus 以避免无谓的 setState。
      onBlur: ({ event }) => {
        const nextTarget = event.relatedTarget as HTMLElement | null;
        if (nextTarget?.closest?.('.agent-thread-card')) return;
        onEditingFinishedRef.current?.();
      },
    });

    onBeforeCreate?.(editor);
    editorRef.current = editor;

    if (editorStorageUpdatedAt) {
      updateDateTimeWidget(editor, editorStorageUpdatedAt);
    }

    const detachLinkHoverTooltip = attachLinkHoverTooltip(editor, elementRef.current);

    const scrollEl = findScrollable(elementRef.current);
    if (scrollEl) {
      const handleScroll = () => {
        setIsScrolling(true);
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }
        scrollTimerRef.current = setTimeout(() => {
          setIsScrolling(false);
        }, 150);
        onEditorScrollRef.current?.(scrollEl.scrollTop);
      };

      scrollEl.addEventListener('scroll', handleScroll, { passive: true });

      return () => {
        scrollEl.removeEventListener('scroll', handleScroll);
        detachLinkHoverTooltip();
        editor.destroy();
        editorRef.current = null;
      };
    }

    return () => {
      detachLinkHoverTooltip();
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || content === contentRef.current) {
      return;
    }

    const selection = editor.state.selection;
    const scrollEl = elementRef.current ? findScrollable(elementRef.current) : null;
    const scrollTop = scrollEl?.scrollTop ?? 0;
    const scrollLeft = scrollEl?.scrollLeft ?? 0;

    contentRef.current = content;
    isApplyingExternalContentRef.current = true;
    try {
      editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
    } finally {
      isApplyingExternalContentRef.current = false;
    }

    const docSize = editor.state.doc.content.size;
    const from = Math.min(selection.from, docSize);
    const to = Math.min(selection.to, docSize);
    editor.commands.setTextSelection({ from, to });
    if (scrollEl) {
      scrollEl.scrollTop = scrollTop;
      scrollEl.scrollLeft = scrollLeft;
    }
  }, [content, findScrollable]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setEditable(editable);
    }
  }, [editable]);

  useEffect(() => {
    if (editorRef.current) {
      updateDateTimeWidget(editorRef.current, editorStorageUpdatedAt || null);
    }
  }, [editorStorageUpdatedAt]);

  // 把 editor.find / editor.undo / editor.redo 三个 action 的实例级 handler
  // 注册到全局 handler-registry。组件卸载时 pop 走 — 命令面板 (Phase 3)
  // 仍能从 registry 读到 action 列表, 但 run 落到空栈, 行为退化为 no-op。
  //
  // ⌘F 不限制 scope (走 'window'), 焦点不在编辑器内时 invokeHandler 也会命中
  // 这个栈 — 单一编辑器挂载, 自然没有歧义。Phase 3 若引入第二个 Tiptap 实例
  // (e.g. 浮层编辑器), 改用 focus 事件动态 push/pop 即可。
  useEffect(() => {
    const pops = [
      pushHandler('editor.find', () => {
        onSearchPanelOpenChangeRef.current?.(true);
      }),
      pushHandler('editor.undo', () => {
        editorRef.current?.commands.undo();
      }),
      pushHandler('editor.redo', () => {
        editorRef.current?.commands.redo();
      }),
      // 块元素切换 (⌘1-4 / ⌘0 / ⌘⇧7-9) — 与 drag-context-menu items.tsx
      // 里的菜单项一一对应, 走同一组 Tiptap chain().focus().toggleXxx() 命令。
      // focus() 先调用是为了: 用户可能从标题输入框等地方按快捷键,
      // focus 保证命令落到编辑器内的当前 block。
      pushHandler('editor.setHeading1', () => {
        editorRef.current?.chain().focus().toggleHeading({ level: 1 }).run();
      }),
      pushHandler('editor.setHeading2', () => {
        editorRef.current?.chain().focus().toggleHeading({ level: 2 }).run();
      }),
      pushHandler('editor.setHeading3', () => {
        editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run();
      }),
      pushHandler('editor.setHeading4', () => {
        editorRef.current?.chain().focus().toggleHeading({ level: 4 }).run();
      }),
      pushHandler('editor.setParagraph', () => {
        editorRef.current?.chain().focus().setParagraph().run();
      }),
      pushHandler('editor.toggleBulletList', () => {
        editorRef.current?.chain().focus().toggleBulletList().run();
      }),
      pushHandler('editor.toggleOrderedList', () => {
        editorRef.current?.chain().focus().toggleOrderedList().run();
      }),
      pushHandler('editor.toggleTaskList', () => {
        editorRef.current?.chain().focus().toggleTaskList().run();
      }),
    ];
    return () => {
      for (const pop of pops) pop();
    };
  }, []);

  // 主题切换时强制 Shiki 重新着色。
  //
  // 链路: useApplyTheme.apply() 写完 --shiki-theme 后 dispatch 'app-theme-changed' →
  // 本 effect 收到事件 → 在下一帧给 PM view 发一个带 'shikiPluginForceDecoration'
  // meta 的空事务, shiki-plugin.ts 的 state.apply 据此重跑 getDecorations。
  // 用 rAF 而非同步触发是为了与浏览器布局/绘制合批, 避免 CSS var 写入和
  // decoration 重建在同一 microtask 里冲突 (rAF 还顺带去抖, 多次连续切换主题
  // 时只触发一次 dispatch)。
  useEffect(() => {
    let rafId: number | null = null;
    const handleThemeChange = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed) return;
        editor.view.dispatch(
          editor.state.tr.setMeta('shikiPluginForceDecoration', true)
        );
      });
    };

    window.addEventListener('app-theme-changed', handleThemeChange);
    return () => {
      window.removeEventListener('app-theme-changed', handleThemeChange);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className={`comn-tiptap-editor ${className || ''}`}>
      <SearchReplacePanel
        editor={editorRef.current}
        visible={searchPanelOpen}
        onClose={() => onSearchPanelOpenChangeRef.current?.(false)}
      />
      <div ref={elementRef} className="editor-content">
        {editorRef.current && editorRef.current.view && <DragContextMenu editor={editorRef.current} />}
        {editorRef.current && !isScrolling && <TableBubbleMenu editor={editorRef.current} />}
        {editorRef.current && !isScrolling && <SelectionBubbleMenu editor={editorRef.current} />}
      </div>
      <ComnTiptapToolbar
        editor={editorRef.current}
        collapsed={toolbarCollapsed}
        onCollapsedChange={onToolbarCollapsedChange}
      />
    </div>
  );
}
