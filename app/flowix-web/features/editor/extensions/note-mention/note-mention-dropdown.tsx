import { type MouseEvent } from 'react';
import { useSelectedItemScroll } from '@features/editor/extensions/shared/use-selected-item-scroll';
import { OverlayScrollbar } from '@shared/ui/overlay-scrollbar';
import type { MentionNoteItem } from '@features/editor/extensions/note-mention/note-mention-data';

export interface NoteMentionDropdownProps {
  items: MentionNoteItem[];
  selectedIndex: number;
  hasMore: boolean;
  loading: boolean;
  onSelect: (item: MentionNoteItem) => void;
  onHover: (index: number) => void;
  onLoadMore: () => void;
}

export function NoteMentionDropdown({
  items,
  selectedIndex,
  hasMore,
  loading,
  onSelect,
  onHover,
  onLoadMore,
}: NoteMentionDropdownProps) {
  const { scrollerRef, itemRefs } = useSelectedItemScroll({
    items,
    selectedIndex,
  });
  const handleItemMouseMove = (
    event: MouseEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.movementX === 0 && event.movementY === 0) return;
    onHover(index);
  };

  return (
    <div className="mention-note-dropdown" role="listbox" aria-label="Notes">
      <div className="mention-note-header" aria-label="Mention type">笔记</div>
      <OverlayScrollbar
        className="mention-note-items-frame"
        scrollerClassName="mention-note-items"
        scrollerRef={scrollerRef}
        onScroll={(event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
              onLoadMore();
            }
        }}
      >
          {loading && items.length === 0 ? (
            <div className="mention-note-empty">加载中</div>
          ) : items.length === 0 ? (
            <div className="mention-note-empty">无匹配笔记</div>
          ) : (
            items.map((item, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={`${item.notebookId}:${item.id}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`mention-note-item${selected ? ' is-selected' : ''}`}
                  onMouseMove={(event) => handleItemMouseMove(event, index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                >
                  <span className="mention-note-title">{item.title}</span>
                  <span className="mention-note-notebook mention-note-notebook-name">
                    {item.notebookName}
                  </span>
                </button>
              );
            })
          )}
          {hasMore && (
            <button
              type="button"
              className="mention-note-more"
              onMouseDown={(event) => {
                event.preventDefault();
                onLoadMore();
              }}
            >
              加载更多
            </button>
          )}
      </OverlayScrollbar>
    </div>
  );
}
