import { Fragment, useLayoutEffect, useRef, type MouseEvent } from 'react';
import {
  CheckSquareIcon,
  CodeIcon,
  FilePlusIcon,
  ImageSquareIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  FunctionIcon,
  MinusIcon,
  PaperclipIcon,
  QuotesIcon,
  TableIcon,
  VideoCameraIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { getAgentRole } from '@/lib/agent-roles';
import { ShortcutKbd } from '@shared/ui/shortcut-kbd';
import {
  OverlayScrollbar,
  type OverlayScrollbarHandle,
} from '@shared/ui/overlay-scrollbar';
import { translate, useI18n, type AppLanguage, type I18nKey } from '@features/i18n';

export type SlashMenuItemId =
  | 'blockquote'
  | 'code-block'
  | 'table'
  | 'math-block'
  | 'web-card'
  | 'horizontal-rule'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'image'
  | 'video'
  | 'file'
  | 'agent-thread-flowix'
  | 'agent-thread-codex'
  | 'create-child-note'
  | 'reference-note';

// Agent 角色项用图片资源展示角色图标（与 agent-roles.ts 集中管理的图标同源）；
// 其它项用 Phosphor 图标组件。两种渲染分支在 SlashMenuDropdown 内分发。
export type SlashMenuIcon = PhosphorIcon | string;

export interface SlashMenuItem {
  id: SlashMenuItemId;
  /** 原始展示文本 ── 用于品牌名 (Flowix / Codex 等不可翻译字串)。
   *  与 labelKey 互斥: 同时存在时 labelKey 优先。 */
  label?: string;
  /** i18n key ── 渲染 / 过滤时按当前语言翻译。 */
  labelKey?: I18nKey;
  description?: string;
  keywords: string[];
  icon: SlashMenuIcon;
  /** 分组标题: 优先用 i18n key 翻译; 没有 key 时回退到 section 原始字串
   *  (用于 AI 这种跨语言统一的缩写)。 */
  section?: string;
  /** i18n key ── 渲染时按当前语言翻译。 */
  sectionKey?: I18nKey;
  /** 快捷键 actionId ── 给出时, 右侧用 ShortcutKbd 渲染 (覆盖 description)。
   *  description + shortcut 同时缺省时, 右侧不渲染, label 独占宽度。 */
  shortcut?: string;
}

export interface SlashMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
  onSelect: (item: SlashMenuItem) => void;
  onHover: (index: number) => void;
}

const SLASH_MENU_SCROLL_PADDING_TOP = 20;

/** Resolve an item's display label for the given language.
 *  优先用 labelKey 翻译; 没有 key 时回退到原始 label (品牌名场景)。 */
export function getSlashMenuItemLabel(item: SlashMenuItem, language: AppLanguage): string {
  if (item.labelKey) return translate(language, item.labelKey);
  return item.label ?? '';
}

/** Resolve an item's section header for the given language. */
export function getSlashMenuItemSection(item: SlashMenuItem, language: AppLanguage): string {
  if (item.sectionKey) return translate(language, item.sectionKey);
  return item.section ?? '';
}

export const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  {
    id: 'agent-thread-flowix',
    label: getAgentRole('flowix').name,
    description: 'AI Agent',
    keywords: ['ai', 'agent', 'thread', 'chat', 'duihua', 'flowix', '任务', 'renwu', 'task'],
    icon: getAgentRole('flowix').icon,
    section: 'AI',
  },
  {
    id: 'agent-thread-codex',
    label: getAgentRole('codex').name,
    description: 'AI Agent',
    keywords: ['codex', 'openai', 'code', 'bianma', '任务', 'renwu', 'task'],
    icon: getAgentRole('codex').icon,
    section: 'AI',
  },
  {
    id: 'blockquote',
    labelKey: 'editor.slash.label.quote',
    keywords: ['quote', 'blockquote', 'yinyong', '引用'],
    icon: QuotesIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'code-block',
    labelKey: 'editor.slash.label.codeBlock',
    keywords: ['code', 'block', 'codeblock', 'daimakuai', '代码', 'kuai'],
    icon: CodeIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'table',
    labelKey: 'editor.slash.label.table',
    keywords: ['table', 'biaoge', 'grid'],
    icon: TableIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'math-block',
    labelKey: 'editor.slash.label.math',
    keywords: ['math', 'formula', 'latex', 'katex', 'gongshi'],
    icon: FunctionIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'web-card',
    labelKey: 'editor.slash.label.web',
    keywords: ['web', 'url', 'link', 'preview', 'card', 'wangye', 'lianjie'],
    icon: LinkSimpleIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'horizontal-rule',
    labelKey: 'editor.slash.label.divider',
    keywords: ['divider', 'hr', 'horizontal', 'rule', 'fenge', '分割'],
    icon: MinusIcon,
    sectionKey: 'editor.slash.section.addBlock',
  },
  {
    id: 'bullet-list',
    labelKey: 'editor.slash.label.bulletList',
    keywords: ['bullet', 'list', 'unordered', 'wuxu', '列表'],
    icon: ListBulletsIcon,
    sectionKey: 'editor.slash.section.addBlock',
    shortcut: 'editor.toggleBulletList',
  },
  {
    id: 'ordered-list',
    labelKey: 'editor.slash.label.orderedList',
    keywords: ['ordered', 'list', 'numbered', 'youxu', '列表'],
    icon: ListNumbersIcon,
    sectionKey: 'editor.slash.section.addBlock',
    shortcut: 'editor.toggleOrderedList',
  },
  {
    id: 'task-list',
    labelKey: 'editor.slash.label.taskList',
    keywords: ['task', 'todo', 'checkbox', 'daiban', '待办'],
    icon: CheckSquareIcon,
    sectionKey: 'editor.slash.section.addBlock',
    shortcut: 'editor.toggleTaskList',
  },
  {
    id: 'image',
    labelKey: 'editor.slash.label.image',
    keywords: ['image', 'img', 'picture', 'tupian'],
    icon: ImageSquareIcon,
    sectionKey: 'editor.slash.section.upload',
  },
  {
    id: 'video',
    labelKey: 'editor.slash.label.video',
    keywords: ['video', 'shipin', 'movie'],
    icon: VideoCameraIcon,
    sectionKey: 'editor.slash.section.upload',
  },
  {
    id: 'file',
    labelKey: 'editor.slash.label.attachment',
    keywords: ['file', 'attachment', 'fujian'],
    icon: PaperclipIcon,
    sectionKey: 'editor.slash.section.upload',
  },
  {
    id: 'create-child-note',
    labelKey: 'editor.slash.label.newMemo',
    keywords: ['note', 'memo', 'child', 'create', 'reference', 'xinjian', 'biji', 'zibiji'],
    icon: FilePlusIcon,
    sectionKey: 'editor.slash.section.memo',
  },
  {
    id: 'reference-note',
    labelKey: 'editor.slash.label.referenceMemo',
    keywords: ['note', 'memo', 'reference', 'mention', 'link', 'yinyong', 'biji'],
    icon: LinkSimpleIcon,
    sectionKey: 'editor.slash.section.memo',
  },
];

export const SlashMenuDropdown = ({
  items,
  selectedIndex,
  onSelect,
  onHover,
}: SlashMenuProps) => {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overlayScrollbarRef = useRef<OverlayScrollbarHandle | null>(null);

  const handleItemMouseMove = (
    event: MouseEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.movementX === 0 && event.movementY === 0) return;
    onHover(index);
  };

  // 键盘上下键移动 selectedIndex 后, 仅在当前 item 即将离开弹窗内部
  // 视口时滚动一次; 滚动发生时尽量把 item 放到顶部下方 20px。
  // 这样连续移动可见 item 时不会每次都推动列表, 减少抖动。
  // items 也进依赖: 过滤导致列表换血时, 即使 selectedIndex 没变
  // 也需要重新评估 (新列表里 selectedIndex 可能对应不同位置的 item)。
  useLayoutEffect(() => {
    const item = itemRefs.current[selectedIndex];
    const scroller = scrollerRef.current;
    if (!item || !scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const itemTop = itemRect.top - scrollerRect.top + scroller.scrollTop;
    const itemBottom = itemRect.bottom - scrollerRect.top + scroller.scrollTop;
    const visibleTop = scroller.scrollTop + SLASH_MENU_SCROLL_PADDING_TOP;
    const visibleBottom = scroller.scrollTop + scroller.clientHeight;

    if (itemTop >= visibleTop && itemBottom <= visibleBottom) return;

    const targetTop = itemTop - SLASH_MENU_SCROLL_PADDING_TOP;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(targetTop, maxScrollTop));
    overlayScrollbarRef.current?.update();
  }, [selectedIndex, items]);

  useLayoutEffect(() => {
    overlayScrollbarRef.current?.update();
  }, [items]);

  return (
    <div
      className="slash-menu-dropdown"
      role="listbox"
      aria-label="Slash commands"
    >
      <OverlayScrollbar
        ref={overlayScrollbarRef}
        className="slash-menu-items-frame"
        scrollerClassName="slash-menu-items"
        scrollerRef={scrollerRef}
      >
        {items.length === 0 ? (
          <div className="slash-menu-empty">{t('editor.slash.empty')}</div>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const selected = index === selectedIndex;
            const prevItem = index > 0 ? items[index - 1] : null;
            const sectionLabel = item.sectionKey ? t(item.sectionKey) : (item.section ?? '');
            const prevSectionLabel = prevItem
              ? (prevItem.sectionKey ? t(prevItem.sectionKey) : (prevItem.section ?? ''))
              : null;
            const showSectionHeader = !prevItem || prevSectionLabel !== sectionLabel;
            const displayLabel = item.labelKey ? t(item.labelKey) : (item.label ?? '');
            const renderIcon = typeof Icon === 'string'
              ? (
                  <img
                    src={Icon}
                    alt=""
                    className="h-4 w-4 rounded object-contain"
                    aria-hidden="true"
                  />
                )
              : (
                  <Icon className="h-4 w-4" weight="bold" aria-hidden="true" />
                );

            return (
              <Fragment key={item.id}>
                {showSectionHeader && (
                  <div className="slash-menu-header" role="presentation">
                    <span>{sectionLabel}</span>
                  </div>
                )}
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`slash-menu-item${selected ? ' is-selected' : ''}`}
                  onMouseMove={(event) => handleItemMouseMove(event, index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                >
                  {renderIcon}
                  <span className="slash-menu-item-label">{displayLabel}</span>
                  {(item.shortcut || item.description) && (
                    <span className="slash-menu-item-description">
                      {item.shortcut
                        ? <ShortcutKbd actionId={item.shortcut} />
                        : item.description}
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })
          )}
      </OverlayScrollbar>
    </div>
  );
};
