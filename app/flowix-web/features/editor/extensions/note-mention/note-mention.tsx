import type { EditorView } from '@tiptap/pm/view';
import { createSuggestionExtension } from '@features/editor/extensions/shared/suggestion-menu';
import { NoteMentionDropdown } from '@features/editor/extensions/note-mention/note-mention-dropdown';
import {
  queryMentionNotes,
  toNoteReferenceAttrs,
  type MentionNoteItem,
} from '@features/editor/extensions/note-mention/note-mention-data';

const TRIGGER = '@';
const WIDTH = 280;

/**
 * `@` 触发笔记 mention。选中后插入 `noteReference` 节点 (内联卡片),
 * 双击 / 通过 openMemoByTarget 跨文档跳转。
 */
export const NoteMention = createSuggestionExtension<MentionNoteItem>({
  trigger: TRIGGER,
  width: WIDTH,

  parseQuery: (view: EditorView, triggerFrom, trigger) => {
    const { selection } = view.state;
    if (!selection.empty || selection.from < triggerFrom + 1) return null;

    const $trigger = view.state.doc.resolve(triggerFrom);
    const $cursor = view.state.doc.resolve(selection.from);
    if (!$trigger.sameParent($cursor)) return null;

    const text = view.state.doc.textBetween(triggerFrom, selection.from, '\n', '\n');
    if (!text.startsWith(trigger)) return null;

    const query = text.slice(1);
    // 笔记标题里常有 `.`/`-` 等标点, 只按空白终止, 不使用 `[\s\p{P}]`
    if (/\s/.test(query)) return null;
    return query;
  },

  fetchItems: (query) => queryMentionNotes(query),

  render: ({ items, selectedIndex, hasMore, loading, onSelect, onHover, onLoadMore }) => (
    <NoteMentionDropdown
      items={items}
      selectedIndex={selectedIndex}
      hasMore={hasMore}
      loading={loading}
      onSelect={onSelect}
      onHover={onHover}
      onLoadMore={onLoadMore}
    />
  ),

  onSelect: ({ editor, item, deleteTriggerText }) => {
    deleteTriggerText();
    if (!editor.schema.nodes.noteReference) return;
    editor.commands.insertContent({
      type: 'noteReference',
      attrs: toNoteReferenceAttrs(item),
    });
  },

  onError: (err) => console.warn('[note-mention] query failed:', err),
});