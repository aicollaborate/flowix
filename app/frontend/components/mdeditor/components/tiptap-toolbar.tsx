'use client';

import { Editor } from '@tiptap/core';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { TextHOneIcon, TextHTwoIcon, TextHThreeIcon, TextHFourIcon, TextTIcon, ListBulletsIcon, CheckSquareIcon, TextBIcon, TextUnderlineIcon, TextItalicIcon, TextStrikethroughIcon, HighlighterIcon, CodeIcon, PaperclipIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useState, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import { openLinkBubbleMenu } from './link-bubble-menu';

interface ComnTiptapToolbarProps {
  editor: Editor | null;
  visible?: boolean;
}

type HeadingLevel = 1 | 2 | 3 | 4;

interface ToolbarState {
  heading: HeadingLevel | null;
  bold: boolean;
  underline: boolean;
  italic: boolean;
  bulletList: boolean;
  taskList: boolean;
  highlight: boolean;
  strikethrough: boolean;
  link: boolean;
}

const headingConfigs: { level: HeadingLevel; icon: React.ReactNode; symbol: string }[] = [
  { level: 1, icon: <TextHOneIcon size={18} weight="bold" />, symbol: '#' },
  { level: 2, icon: <TextHTwoIcon size={18} weight="bold" />, symbol: '##' },
  { level: 3, icon: <TextHThreeIcon size={18} weight="bold" />, symbol: '###' },
  { level: 4, icon: <TextHFourIcon size={18} weight="bold" />, symbol: '####' },
];

const paragraphIcon = <TextTIcon size={18} weight="bold" />;

const INITIAL_STATE: ToolbarState = {
  heading: null,
  bold: false,
  underline: false,
  italic: false,
  bulletList: false,
  taskList: false,
  highlight: false,
  strikethrough: false,
  link: false,
};

export function ComnTiptapToolbar({ editor, visible = true }: ComnTiptapToolbarProps) {
  const [state, setState] = useState<ToolbarState>(INITIAL_STATE);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    const updateActiveStates = () => {
      let heading: HeadingLevel | null = null;
      for (let i = 1; i <= 4; i++) {
        if (currentEditor.isActive('heading', { level: i as HeadingLevel })) {
          heading = i as HeadingLevel;
          break;
        }
      }

      setState({
        heading,
        bold: currentEditor.isActive('bold'),
        underline: currentEditor.isActive('underline'),
        italic: currentEditor.isActive('italic'),
        bulletList: currentEditor.isActive('bulletList'),
        taskList: currentEditor.isActive('taskList'),
        highlight: currentEditor.isActive('highlight'),
        strikethrough: currentEditor.isActive('strike'),
        link: currentEditor.isActive('link'),
      });
    };

    updateActiveStates();

    currentEditor.on('selectionUpdate', updateActiveStates);
    currentEditor.on('transaction', updateActiveStates);

    return () => {
      currentEditor.off('selectionUpdate', updateActiveStates);
      currentEditor.off('transaction', updateActiveStates);
    };
  }, [editor]);

  const toolbarClass = `comn-tiptap-toolbar${visible ? ' toolbar-visible' : ' toolbar-hidden'}`;

  if (!editor) {
    return null;
  }

  const getCurrentHeadingIcon = () => {
    if (state.heading) {
      const found = headingConfigs.find(h => h.level === state.heading);
      return found ? found.icon : paragraphIcon;
    }
    return paragraphIcon;
  };

  return (
    <div className={toolbarClass}>
      <div className="toolbar-content">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`toolbar-button ${state.heading ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              type="button"
              style={{ width: 42, height: 28, gap: 2, display: 'flex', alignItems: 'center' }}
            >
              {getCurrentHeadingIcon()}
              <ChevronDown size={12} className="opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" sideOffset={5} align="center" className="p-1 w-auto min-w-[120px]">
            {headingConfigs.map(({ level, icon, symbol }) => (
              <DropdownMenuItem
                key={level}
                className={`gap-3 rounded-md justify-between ${state.heading === level ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
              >
                {icon}
                <span className="text-[#9ca3af]">{symbol}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className={`gap-3 rounded-md justify-between ${!state.heading ? 'active' : ''}`}
              onClick={() => editor.chain().focus().setParagraph().run()}
            >
              {paragraphIcon}
              <span className="text-[#9ca3af]">正文</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="toolbar-divider" />

        <button
          className={`toolbar-button ${state.bold ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <TextBIcon size={18} weight="bold" />
        </button>
        <button
          className={`toolbar-button ${state.underline ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <TextUnderlineIcon size={18} weight="bold" />
        </button>
        <button
          className={`toolbar-button ${state.italic ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <TextItalicIcon size={18} weight="bold" />
        </button>
        <button
          className={`toolbar-button ${state.link ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openLinkBubbleMenu(editor, () => undefined)}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="添加链接"
        >
          <LinkSimpleIcon size={18} weight="bold" />
        </button>

        <div className="toolbar-divider" />

        <button
          className={`toolbar-button ${state.bulletList ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <ListBulletsIcon size={18} weight="bold" />
        </button>

        <button
          className={`toolbar-button ${state.taskList ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="待办列表"
        >
          <CheckSquareIcon size={18} weight="bold" />
        </button>

        <button
          className={`toolbar-button ${state.highlight ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          type="button"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <HighlighterIcon size={18} weight="bold" />
        </button>

        <div className="toolbar-divider" />

        <div className="relative inline-block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="toolbar-button"
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" sideOffset={5} align="center" className="p-1 w-auto min-w-[136px]">
              <DropdownMenuItem
                className="gap-3 rounded-md"
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              >
                <CodeIcon size={16} weight="bold" />
                <span>插入代码块</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className={`gap-3 ${state.strikethrough ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <TextStrikethroughIcon size={16} weight="bold" />
                <span>删除线</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-3 rounded-md"
                onClick={() => editor.commands.openFileDialog()}
              >
                <PaperclipIcon size={16} weight="bold" />
                <span>添加附件</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
