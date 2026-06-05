import { Editor, renderNestedMarkdownContent } from '@tiptap/core';
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
import { AttachmentLink } from './extensions/attachment-link';
import { TableBubbleMenu } from './components/table-bubble-menu';
import { ComnTiptapToolbar } from './components/tiptap-toolbar';
import { DragContextMenu } from './components/drag-context-menu';
import { SelectionAIBubbleMenu } from './components/selection-ai-bubble-menu';
import { attachLinkHoverTooltip } from './components/link-hover-tooltip';
import { Tag } from './extensions/tag';
import MarkdownPaste from './extensions/markdown-paste';
import { LinkSelectionHighlight, MarkdownLink } from './extensions/markdown-link';
import { DocReference } from './extensions/doc-reference';
import { DateTimeWidget, updateDateTimeWidget } from './extensions/datetime-widget';
import { CodeBlockShiki } from './extensions/codeblock-shiki/codeblock-shiki';
import { SearchAndReplace } from './extensions/search-replace';
import { SearchReplacePanel } from './extensions/search-replace-panel';
import Frontmatter from './extensions/frontmatter';

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
}

function normalizeMarkdownOutput(markdown: string): string {
  return markdown.replace(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n{2,}/, '$1\n');
}

function isFormField(element: EventTarget | null): boolean {
  return element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement;
}

const PreservedParagraph = Paragraph.extend({
  renderMarkdown(node, h) {
    const content = Array.isArray(node.content) ? node.content : [];
    return content.length === 0 ? '&nbsp;' : h.renderChildren(content);
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
}: ComnTiptapEditorProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEditorScrollRef = useRef(onEditorScroll);
  const contentRef = useRef(content);
  const isApplyingExternalContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onEditorScrollRef.current = onEditorScroll;
  onChangeRef.current = onChange;

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
          placeholder: placeholder || 'Write Something',
        }),
        Tag,
        MarkdownPaste,
        DateTimeWidget,
        Frontmatter,
        DocReference,
        SearchAndReplace,
      ],
      content: content,
      contentType: 'markdown',
      editable,
      autofocus: autoFocus ? 'end' : false,
      onUpdate: ({ editor }) => {
        const markdown = normalizeMarkdownOutput(editor.getMarkdown());
        contentRef.current = markdown;
        if (isApplyingExternalContentRef.current) return;
        onChangeRef.current?.(markdown);
      },
      onFocus: () => setIsEditing(true),
      onBlur: () => setIsEditing(false),
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearchPanel(true);
        return;
      }

      if (e.defaultPrevented || isFormField(e.target)) {
        return;
      }

      const editor = editorRef.current;
      const editorRoot = elementRef.current;
      const target = e.target as Node | null;
      const isEditorShortcutTarget =
        editor &&
        editorRoot &&
        target &&
        editorRoot.contains(target);

      if (!isEditorShortcutTarget) {
        return;
      }

      const key = e.key.toLowerCase();
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === 'z';
      const isRedo =
        (e.metaKey || e.ctrlKey) &&
        (key === 'y' || (e.shiftKey && key === 'z'));

      if (isUndo && editor.commands.undo()) {
        e.preventDefault();
        return;
      }

      if (isRedo && editor.commands.redo()) {
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className={`comn-tiptap-editor ${className || ''}`}>
      <SearchReplacePanel
        editor={editorRef.current}
        visible={showSearchPanel}
        onClose={() => setShowSearchPanel(false)}
      />
      <div ref={elementRef} className="editor-content">
        {editorRef.current && editorRef.current.view && <DragContextMenu editor={editorRef.current} />}
        {editorRef.current && !isScrolling && <TableBubbleMenu editor={editorRef.current} />}
        {editorRef.current && !isScrolling && <SelectionAIBubbleMenu editor={editorRef.current} />}
      </div>
      <ComnTiptapToolbar
        editor={editorRef.current}
        visible={isEditing}
      />
    </div>
  );
}
