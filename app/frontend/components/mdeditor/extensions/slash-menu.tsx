import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from '@tiptap/pm/view'
import { createRoot, type Root } from 'react-dom/client'
import { SlashMenuDropdown, type SlashMenuItem } from '../components/slash-menu-dropdown'

export const slashMenuPluginKey = new PluginKey('slashMenu')

interface SlashMenuState {
  triggerFrom: number
  queryFrom: number
  clientRect: () => DOMRect | null
}

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  {
    id: 'table',
    label: 'Table',
    icon: '📊',
    description: 'Insert a table',
  },
  {
    id: 'code-block',
    label: 'Code Block',
    icon: '💻',
    description: 'Insert a code block',
  },
]

let menuState: SlashMenuState | null = null
let menuRoot: Root | null = null
let menuContainer: HTMLDivElement | null = null
let editorViewRef: EditorView | null = null
let menuInstance: MenuInstance | null = null

interface MenuInstance {
  selectedIndex: number
  items: SlashMenuItem[]
  onSelect: (item: SlashMenuItem) => void
}

function closeMenu() {
  if (menuRoot) {
    menuRoot.unmount()
    menuRoot = null
  }
  if (menuContainer) {
    menuContainer.remove()
    menuContainer = null
  }
  menuState = null
  editorViewRef = null
  menuInstance = null
}

async function handleSelect(item: SlashMenuItem): Promise<void> {
  if (!menuState || !editorViewRef) return

  const view = editorViewRef
  const currentState = view.state
  const triggerFrom = menuState.triggerFrom
  const currentTo = currentState.selection.from

  // Delete the "/" and any typed query
  const tr = currentState.tr.delete(triggerFrom, currentTo)

  switch (item.id) {
    case 'table': {
      // Insert a table using editor commands
      // We need to use the editor chain, but we have view, not editor
      // Use the prosemirror transaction directly
      const schema = view.state.schema
      // Create a table node with 3 rows and 3 cols
      const table = schema.nodes.table.create(
        { rows: 3, cols: 3, withHeaderRow: true },
        [
          schema.nodes.tableRow.create(
            {},
            [
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
            ]
          ),
          schema.nodes.tableRow.create(
            {},
            [
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
            ]
          ),
          schema.nodes.tableRow.create(
            {},
            [
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
              schema.nodes.tableCell.create({}, schema.nodes.paragraph.create()),
            ]
          ),
        ]
      )
      tr.replaceWith(triggerFrom, triggerFrom, table)
      break
    }
    case 'code-block': {
      // Insert a code block
      const schema = view.state.schema
      const codeBlock = schema.nodes.codeBlock.create(
        {},
        schema.text(' ')
      )
      tr.replaceWith(triggerFrom, triggerFrom, codeBlock)
      break
    }
  }

  view.dispatch(tr)
  closeMenu()
  view.focus()
}

function openMenu(props: SlashMenuState, view: EditorView, _parentMemoId: string | null) {
  closeMenu()

  editorViewRef = view
  menuState = props

  if (!menuContainer) {
    menuContainer = document.createElement('div')
    menuContainer.style.position = 'fixed'
    menuContainer.style.zIndex = '9999'
    document.body.appendChild(menuContainer)
    menuRoot = createRoot(menuContainer)
  }

  if (menuState.clientRect && menuContainer) {
    const rect = menuState.clientRect()
    if (rect) {
      menuContainer.style.top = `${rect.bottom + 4}px`
      menuContainer.style.left = `${rect.left}px`
    }
  }

  menuInstance = {
    selectedIndex: 0,
    items: SLASH_MENU_ITEMS,
    onSelect: handleSelect,
  }

  if (menuRoot) {
    menuRoot.render(
      <SlashMenuDropdown
        items={menuInstance.items}
        selectedIndex={menuInstance.selectedIndex}
        onSelect={menuInstance.onSelect}
      />
    )
  }
}

function isTriggerPosition(view: EditorView, pos: number): boolean {
  const state = view.state
  const $from = state.doc.resolve(pos)

  // Check if we're at the start of a line or after whitespace
  // Trigger if slash is at start of line (after newline) or after whitespace/paragraph boundary
  // We check if the last non-whitespace character before position is a paragraph break or newline
  const nodeBefore = $from.nodeBefore
  if (!nodeBefore) {
    // At start of document
    return true
  }

  // If nodeBefore is text, check what ends with
  if (nodeBefore.isText && nodeBefore.text) {
    // Trigger if after whitespace (space, tab) or newline
    const lastChar = nodeBefore.text[nodeBefore.text.length - 1]
    if (lastChar === ' ' || lastChar === '\t' || lastChar === '\n') {
      return true
    }
  }

  // If nodeBefore is a block node (paragraph), trigger
  if (nodeBefore.isBlock && nodeBefore.type.name !== 'text') {
    return true
  }

  return false
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addOptions() {
    return {
      parentMemoId: null,
    }
  },

  addProseMirrorPlugins() {
    const parentMemoId = this.options.parentMemoId

    return [
      new Plugin({
        key: slashMenuPluginKey,

        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== '/') {
              if (menuState) {
                closeMenu()
              }
              return false
            }

            // Only trigger at appropriate positions (start of line or after whitespace)
            if (!isTriggerPosition(view, from)) {
              if (menuState) {
                closeMenu()
              }
              return false
            }

            const coords = view.coordsAtPos(from)
            const rect = new DOMRect(coords.left, coords.bottom, 0, 0)

            openMenu(
              {
                triggerFrom: from,
                queryFrom: from + 1,
                clientRect: () => rect,
              },
              view,
              parentMemoId
            )

            return false
          },

          handleKeyDown(_view, event) {
            if (!menuState || !menuInstance) return false

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              menuInstance.selectedIndex = menuInstance.selectedIndex > 0
                ? menuInstance.selectedIndex - 1
                : menuInstance.items.length - 1
              if (menuRoot) {
                menuRoot.render(
                  <SlashMenuDropdown
                    items={menuInstance.items}
                    selectedIndex={menuInstance.selectedIndex}
                    onSelect={menuInstance.onSelect}
                  />
                )
              }
              return true
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              menuInstance.selectedIndex = menuInstance.selectedIndex < menuInstance.items.length - 1
                ? menuInstance.selectedIndex + 1
                : 0
              if (menuRoot) {
                menuRoot.render(
                  <SlashMenuDropdown
                    items={menuInstance.items}
                    selectedIndex={menuInstance.selectedIndex}
                    onSelect={menuInstance.onSelect}
                  />
                )
              }
              return true
            }

            if (event.key === 'Escape') {
              closeMenu()
              return true
            }

            if (event.key === 'Enter' && menuInstance.items.length > 0) {
              event.preventDefault()
              const item = menuInstance.items[menuInstance.selectedIndex]
              if (item) {
                handleSelect(item)
              }
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})