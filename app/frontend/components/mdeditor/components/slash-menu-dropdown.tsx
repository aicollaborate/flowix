export interface SlashMenuItem {
  id: string
  label: string
  icon: string
  description?: string
}

export interface SlashMenuProps {
  items: SlashMenuItem[]
  selectedIndex: number
  onSelect: (item: SlashMenuItem) => void
}

export const SlashMenuDropdown = ({ items, selectedIndex, onSelect }: SlashMenuProps) => {
  if (!items.length) {
    return (
      <div className="slash-menu-dropdown bg-background rounded-lg border shadow-md overflow-hidden p-4 text-center text-sm text-muted-foreground min-w-[200px]">
        暂无内容
      </div>
    )
  }

  return (
    <div className="slash-menu-dropdown bg-background rounded-lg border shadow-md overflow-hidden p-1 space-y-1">
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent transition-colors rounded-md ${
            index === selectedIndex ? 'bg-accent' : ''
          }`}
          onClick={() => onSelect(item)}
        >
          <span className="text-sm w-6 text-center">{item.icon}</span>
          <span className="text-sm text-left flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  )
}