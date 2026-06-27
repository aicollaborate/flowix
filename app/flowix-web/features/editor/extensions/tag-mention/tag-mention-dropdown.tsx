import { type MouseEvent } from 'react';
import { Hash } from 'lucide-react';
import { useSelectedItemScroll } from '@features/editor/extensions/shared/use-selected-item-scroll';
import { OverlayScrollbar } from '@shared/ui/overlay-scrollbar';
import type { MentionTagItem } from '@features/editor/extensions/tag-mention/tag-mention-data';

export interface TagMentionDropdownProps {
  items: MentionTagItem[];
  selectedIndex: number;
  hasMore: boolean;
  loading: boolean;
  onSelect: (item: MentionTagItem) => void;
  onHover: (index: number) => void;
  onLoadMore: () => void;
}

export function TagMentionDropdown({
  items,
  selectedIndex,
  hasMore,
  loading,
  onSelect,
  onHover,
  onLoadMore,
}: TagMentionDropdownProps) {
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
    <div className="mention-note-dropdown" role="listbox" aria-label="Tags">
      <div className="mention-note-header" aria-label="Mention type">标签</div>
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
            <div className="mention-note-empty">无匹配标签</div>
          ) : (
            items.map((item, index) => {
              const selected = index === selectedIndex;
              // 新建占位项右侧展示"新建"文案; 已存在标签不展示右侧文案
              return (
                <button
                  key={item.create ? `create:${item.id}` : `tag:${item.id}`}
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
                  <span className="mention-note-title mention-tag-title">
                    <Hash className="mention-tag-icon" aria-hidden="true" />
                    <span className="mention-tag-name">{item.name}</span>
                  </span>
                  {item.create && <span className="mention-note-notebook">新建</span>}
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
