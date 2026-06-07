import { forwardRef, useImperativeHandle } from 'react'

export interface DocRefItem {
  id: string
  name: string
  title: string
  notebookId: string | null
  notebookName: string
}

export interface DocRefDropdownProps {
  items: DocRefItem[]
  selectedIndex: number
  onSelect: (item: DocRefItem) => void
}

export interface DocRefDropdownRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const DocRefDropdown = forwardRef<DocRefDropdownRef, DocRefDropdownProps>(
  ({ items, selectedIndex, onSelect }, _ref) => {
    useImperativeHandle(_ref, () => ({
      onKeyDown({ event }: { event: KeyboardEvent }) {
        if (event.key === 'ArrowUp') {
          return true
        }
        if (event.key === 'ArrowDown') {
          return true
        }
        if (event.key === 'Enter') {
          return true
        }
        return false
      },
    }))

    if (!items.length) {
      return (
        <div className="doc-ref-dropdown bg-background rounded-lg border shadow-md overflow-hidden p-4 text-center text-sm text-muted-foreground min-w-[200px]">
          未找到备忘录
        </div>
      )
    }

    return (
      <div className="doc-ref-dropdown bg-background rounded-lg border shadow-md overflow-hidden p-1 space-y-1">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent transition-colors rounded-md ${
              index === selectedIndex ? 'bg-accent' : ''
            }`}
            onClick={() => onSelect(item)}
          >
            <span className="text-sm">📓</span>
            <span className="text-sm text-left flex-1 truncate">
              {item.notebookName}/{item.title || item.name}
            </span>
          </button>
        ))}
      </div>
    )
  }
)

DocRefDropdown.displayName = 'DocRefDropdown'