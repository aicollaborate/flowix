import { Fragment, type ComponentType } from 'react';
import {
  Code2,
  ImageUp,
  MessageCircleCheck,
  Paperclip,
  Table2,
  Terminal,
  Video,
  type LucideProps,
} from 'lucide-react';

export type SlashMenuItemId =
  | 'table'
  | 'image'
  | 'file'
  | 'video'
  | 'agent-thread'
  | 'codex'
  | 'claude-code';

export interface SlashMenuItem {
  id: SlashMenuItemId;
  label: string;
  description: string;
  keywords: string[];
  icon: ComponentType<LucideProps>;
  section: string;
}

export interface SlashMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
  onSelect: (item: SlashMenuItem) => void;
  onHover: (index: number) => void;
}

export const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  {
    id: 'table',
    label: '表格',
    description: '3 x 3 表格',
    keywords: ['table', 'biaoge', 'grid'],
    icon: Table2,
    section: '添加',
  },
  {
    id: 'image',
    label: '图片',
    description: '上传图片',
    keywords: ['image', 'img', 'picture', 'tupian'],
    icon: ImageUp,
    section: '上传',
  },
  {
    id: 'video',
    label: '视频',
    description: '上传视频',
    keywords: ['video', 'shipin', 'movie'],
    icon: Video,
    section: '上传',
  },
  {
    id: 'file',
    label: '附件',
    description: '上传文件',
    keywords: ['file', 'attachment', 'fujian'],
    icon: Paperclip,
    section: '上传',
  },
  {
    id: 'agent-thread',
    label: 'Flowix Agent',
    description: '对话卡片',
    keywords: ['ai', 'agent', 'thread', 'chat', 'duihua', 'flowix'],
    icon: MessageCircleCheck,
    section: 'AI 对话',
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI',
    keywords: ['codex', 'openai', 'code', 'bianma'],
    icon: Code2,
    section: 'AI 对话',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic',
    keywords: ['claude', 'code', 'anthropic', 'terminal', 'zhongduan'],
    icon: Terminal,
    section: 'AI 对话',
  },
];

export const SlashMenuDropdown = ({
  items,
  selectedIndex,
  onSelect,
  onHover,
}: SlashMenuProps) => {
  return (
    <div
      className="slash-menu-dropdown"
      role="listbox"
      aria-label="Slash commands"
    >
      <div className="slash-menu-items">
        {items.length === 0 ? (
          <div className="slash-menu-empty">无匹配命令</div>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const selected = index === selectedIndex;
            const prevItem = index > 0 ? items[index - 1] : null;
            const showSectionHeader = !prevItem || prevItem.section !== item.section;

            return (
              <Fragment key={item.id}>
                {showSectionHeader && (
                  <div className="slash-menu-header" role="presentation">
                    <span>{item.section}</span>
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`slash-menu-item${selected ? ' is-selected' : ''}`}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="slash-menu-item-label">{item.label}</span>
                  <span className="slash-menu-item-description">{item.description}</span>
                </button>
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};
