'use client';

import { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { TrashIcon } from '@phosphor-icons/react';

interface TableBubbleMenuProps {
  editor: Editor;
}

function getTableBoundingRect(editor: Editor): DOMRect | null {
  const { state } = editor;
  const { selection } = state;

  const tablePos = state.doc.resolve(selection.from).before(1);
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return null;
  }

  const domNode = editor.view.nodeDOM(tablePos);
  if (domNode instanceof HTMLElement) {
    return domNode.getBoundingClientRect();
  }
  return null;
}

function ColumnsPlusLeftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="144" y="40" width="40" height="176" rx="8" />
      <line x1="52" y1="120" x2="124" y2="120" />
      <line x1="88" y1="84" x2="88" y2="156" />
    </svg>
  );
}

function ColumnsPlusRightIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="72" y="40" width="40" height="176" rx="8" />
      <line x1="132" y1="120" x2="204" y2="120" />
      <line x1="168" y1="84" x2="168" y2="156" />
    </svg>
  );
}

function RowsPlusTopIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="40" y="144" width="176" height="40" rx="8" />
      <line x1="128" y1="52" x2="128" y2="124" />
      <line x1="92" y1="88" x2="164" y2="88" />
    </svg>
  );
}

function RowsPlusBottomIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="40" y="72" width="176" height="40" rx="8" />
      <line x1="128" y1="132" x2="128" y2="204" />
      <line x1="92" y1="168" x2="164" y2="168" />
    </svg>
  );
}

function RowsDeleteIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="40" y="128" width="176" height="40" rx="8" />
      <line x1="92" y1="44" x2="140" y2="92" />
      <line x1="140" y1="44" x2="92" y2="92" />
    </svg>
  );
}

function ColumnsDeleteIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <rect x="128" y="40" width="40" height="176" rx="8" />
      <line x1="44" y1="92" x2="92" y2="140" />
      <line x1="92" y1="92" x2="44" y2="140" />
    </svg>
  );
}

export function TableBubbleMenu({ editor }: TableBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubbleMenu"
      shouldShow={({ editor }) => editor.isActive('table')}
      getReferencedVirtualElement={() => {
        const rect = getTableBoundingRect(editor);
        if (!rect) return null;
        return {
          getBoundingClientRect: () => rect,
        };
      }}
      options={{
        placement: 'top',
        flip: true,
        shift: true,
        offset: 12,
      }}
    >
      <div className="table-bubble-menu">
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().addRowBefore().run();
          }}
          title="上方插入行"
          type="button"
        >
          <RowsPlusTopIcon size={18} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().addRowAfter().run();
          }}
          title="下方插入行"
          type="button"
        >
          <RowsPlusBottomIcon size={18} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().deleteRow().run();
          }}
          title="删除行"
          type="button"
        >
          <RowsDeleteIcon size={18} />
        </button>
        <div className="menu-divider" />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().addColumnBefore().run();
          }}
          title="左侧插入列"
          type="button"
        >
          <ColumnsPlusLeftIcon size={18} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().addColumnAfter().run();
          }}
          title="右侧插入列"
          type="button"
        >
          <ColumnsPlusRightIcon size={18} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().deleteColumn().run();
          }}
          title="删除列"
          type="button"
        >
          <ColumnsDeleteIcon size={18} />
        </button>
        <div className="menu-divider" />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().deleteTable().run();
          }}
          title="删除表格"
          type="button"
          className="delete-table-btn"
        >
          <TrashIcon size={18} />
        </button>
      </div>
    </BubbleMenu>
  );
}