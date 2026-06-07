import { Node, mergeAttributes } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Plugin, NodeSelection } from 'prosemirror-state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { DocRefItem } from '../components/doc-ref-dropdown'
import { createRoot, type Root } from 'react-dom/client'
import { DocRefDropdown } from '../components/doc-ref-dropdown'
import React from 'react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { memos, notebooks } from '../../../lib/tauri/client'

// ============================================================================
// Types
// ============================================================================

export const docReferencePluginKey = new PluginKey('docReference')

interface DropdownState {
  triggerFrom: number
  items: DocRefItem[]
  selectedIndex: number
  clientRect: () => DOMRect | null
}

interface DropdownInstance {
  selectedIndex: number
  items: DocRefItem[]
  onSelect: (item: DocRefItem) => void
}

// ============================================================================
// Module-level State (Dropdown management)
// ============================================================================

let dropdownState: DropdownState | null = null
let dropdownRoot: Root | null = null
let dropdownContainer: HTMLDivElement | null = null
let editorViewRef: EditorView | null = null
let dropdownInstance: DropdownInstance | null = null
let dropdownPending = false

// ============================================================================
// NodeView: React component for doc-reference cards
// ============================================================================

function DocRefCardView({ node: nodeProp, editor, getPos }: { node: ProseMirrorNode; editor: any; getPos: () => number | undefined }) {
  const node = nodeProp;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const pos = getPos()
    if (pos !== undefined && editor) {
      editor.commands.setNodeSelection(pos)
    }
  }

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      style={{ display: 'inline' }}
      className="doc-ref-card inline-flex items-center gap-0.5 px-1 py-0.5 mx-0.5 rounded text-xs cursor-pointer hover:bg-[color-mix(in_oklch,var(--accent)_50%,transparent)]"
      data-title={node.attrs.title}
      data-doc-id={node.attrs.docId}
      data-notebook-id={node.attrs.notebookId}
      data-notebook-name={node.attrs.notebookName}
      onClick={handleClick}
    >
      <FileText size={12} className="text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">[[</span>
      <span className="text-primary font-medium">{node.attrs.notebookName}/{node.attrs.title || '未命名'}</span>
      <span className="text-muted-foreground">]]</span>
    </NodeViewWrapper>
  )
}

// ============================================================================
// Dropdown Component
// ============================================================================

function DocRefDropdownComponent({
  instance,
  onSelect,
}: {
  instance: DropdownInstance
  onSelect: (item: DocRefItem) => void
}) {
  return (
    <DocRefDropdown
      items={instance.items}
      selectedIndex={instance.selectedIndex}
      onSelect={onSelect}
    />
  )
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadDocRefItems(query: string): Promise<DocRefItem[]> {
  try {
    const [memosResult, notebooksResult] = await Promise.all([
      memos.getMemos(),
      notebooks.getAll(),
    ]);

    const memosData = memosResult?.memos || [];
    const notebooksData = notebooksResult || [];

    const docRefItems: DocRefItem[] = memosData.map((memo: any) => {
      const notebook = notebooksData.find((n: any) => n.id === memo.notebookId)
      return {
        id: memo.id,
        name: memo.name || memo.title,
        title: memo.title,
        notebookId: memo.notebookId,
        notebookName: notebook?.name || 'Default',
      }
    })

    if (!query) return docRefItems

    const lowerQuery = query.toLowerCase()
    return docRefItems.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery)
    )
  } catch (e) {
    console.error('[DocRef] loadDocRefItems error:', e)
    return []
  }
}

// ============================================================================
// Dropdown Management
// ============================================================================

function closeDropdown() {
  if (dropdownRoot) {
    dropdownRoot.unmount()
    dropdownRoot = null
  }
  if (dropdownContainer) {
    dropdownContainer.remove()
    dropdownContainer = null
  }
  dropdownState = null
  dropdownPending = false
  editorViewRef = null
  dropdownInstance = null
}

function handleSelect(item: DocRefItem) {
  if (!dropdownState || !editorViewRef) return

  const view = editorViewRef
  const currentState = view.state
  const triggerFrom = dropdownState.triggerFrom
  const currentTo = currentState.selection.from

  const tr = currentState.tr.delete(triggerFrom, currentTo).replaceWith(
    triggerFrom,
    triggerFrom,
    view.state.schema.nodes.docReference.create({
      docId: item.id,
      title: item.title,
      notebookId: item.notebookId,
      notebookName: item.notebookName,
    })
  )
  view.dispatch(tr)

  closeDropdown()
  view.focus()
}

function openDropdown(props: DropdownState, view: EditorView) {
  closeDropdown()

  editorViewRef = view
  dropdownState = props

  if (!dropdownContainer) {
    dropdownContainer = document.createElement('div')
    dropdownContainer.style.position = 'fixed'
    dropdownContainer.style.zIndex = '9999'
    document.body.appendChild(dropdownContainer)
    dropdownRoot = createRoot(dropdownContainer)
  }

  if (dropdownState.clientRect && dropdownContainer) {
    const rect = dropdownState.clientRect()
    if (rect) {
      dropdownContainer.style.top = `${rect.bottom + 4}px`
      dropdownContainer.style.left = `${rect.left}px`
    }
  }

  dropdownInstance = {
    selectedIndex: 0,
    items: props.items,
    onSelect: handleSelect,
  }

  if (dropdownRoot) {
    dropdownRoot.render(
      <DocRefDropdownComponent instance={dropdownInstance} onSelect={handleSelect} />
    )
  }
}

// ============================================================================
// DocReference Node Definition
// ============================================================================

export const DocReference = Node.create({
  name: 'docReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: null },
      docId: { default: null },
      notebookId: { default: null },
      notebookName: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'span[data-doc-ref]',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        return {
          title: element.getAttribute('data-title'),
          docId: element.getAttribute('data-doc-id'),
          notebookId: element.getAttribute('data-notebook-id'),
          notebookName: element.getAttribute('data-notebook-name'),
        }
      },
    }]
  },

  renderHTML({ node }) {
    const title = node.attrs?.title || ''
    const notebookName = node.attrs?.notebookName || 'Default'

    return [
      'span',
      mergeAttributes(
        { 'data-doc-ref': '', class: 'doc-reference mx-1', style: 'display: inline-block ' },
        {
          'data-title': title,
          'data-doc-id': node.attrs?.docId || null,
          'data-notebook-id': node.attrs?.notebookId || null,
          'data-notebook-name': notebookName,
        }
      ),
      ['span', { contenteditable: 'false', class: 'inline-block gap-0.5 py-0.5 mx-0.5 rounded text-xs cursor-pointer hover:bg-[color-mix(in_oklch,var(--accent)_50%,transparent)] text-muted-foreground' }, '[['],
      ['span', { contenteditable: 'false', class: 'inline-block gap-0.5 py-0.5 mx-0.5 rounded text-xs cursor-pointer hover:bg-[color-mix(in_oklch,var(--accent)_50%,transparent)] text-primary font-medium' }, `${notebookName}/${title}`],
      ['span', { contenteditable: 'false', class: 'inline-block gap-0.5 py-0.5 mx-0.5 rounded text-xs cursor-pointer hover:bg-[color-mix(in_oklch,var(--accent)_50%,transparent)] text-muted-foreground' }, ']]'],
    ]
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection } = this.editor.state
        const { $from } = selection

        if (selection instanceof NodeSelection && selection.node.type.name === 'docReference') {
          this.editor.commands.deleteSelection()
          return true
        }

        const nodeAfter = $from.nodeAfter
        if (nodeAfter && nodeAfter.type.name === 'docReference') {
          const targetPos = $from.pos
          const tr = this.editor.state.tr.delete(targetPos, targetPos + nodeAfter.nodeSize)
          this.editor.view.dispatch(tr)
          return true
        }

        return false
      },
      Delete: () => {
        const { selection } = this.editor.state
        const { $from } = selection

        if (selection instanceof NodeSelection && selection.node.type.name === 'docReference') {
          this.editor.commands.deleteSelection()
          return true
        }

        const nodeBefore = $from.nodeBefore
        if (nodeBefore && nodeBefore.type.name === 'docReference') {
          const targetPos = $from.pos - nodeBefore.nodeSize
          const tr = this.editor.state.tr.delete(targetPos, targetPos + nodeBefore.nodeSize)
          this.editor.view.dispatch(tr)
          return true
        }

        return false
      },
      ArrowLeft: () => {
        const { selection } = this.editor.state
        const { $from } = selection
        const nodeBefore = $from.nodeBefore
        const nodeAfter = $from.nodeAfter

        // 如果两侧都是 docReference，说明光标在两个卡片之间，让自然光标移动
        if (nodeBefore && nodeBefore.type.name === 'docReference' &&
            nodeAfter && nodeAfter.type.name === 'docReference') {
          return false
        }

        if (nodeBefore && nodeBefore.type.name === 'docReference') {
          const targetPos = $from.before()
          this.editor.commands.setTextSelection(targetPos)
          return true
        }
        return false
      },
      ArrowRight: () => {
        const { selection } = this.editor.state
        const { $from } = selection
        const nodeBefore = $from.nodeBefore
        const nodeAfter = $from.nodeAfter

        // 如果两侧都是 docReference，说明光标在两个卡片之间，让自然光标移动
        if (nodeBefore && nodeBefore.type.name === 'docReference' &&
            nodeAfter && nodeAfter.type.name === 'docReference') {
          return false
        }

        if (nodeAfter && nodeAfter.type.name === 'docReference') {
          const targetPos = $from.after()
          this.editor.commands.setTextSelection(targetPos)
          return true
        }
        return false
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocRefCardView, {
      attrs: {
        // 确保 NodeView 不干扰光标
      }
    })
  },

  // Markdown serialization/parsing: [[notebook/title$docId$]]
  markdownTokenizer: {
    name: 'docReference',
    level: 'inline',
    start(src: string) {
      return src.indexOf('[[')
    },
    tokenize(src: string): any {
      const match = /\[\[([^\]]+)\]\]/.exec(src)
      if (!match) return undefined
      return { type: 'docReference', raw: match[0] }
    },
  },

  parseMarkdown(token: any, _parsers: any) {
    const content = token.raw.slice(2, -2)
    const idStart = content.indexOf('$')
    const idEnd = content.lastIndexOf('$')

    let title = content
    let notebookName = 'Default'
    let docId = null
    let notebookId = null

    if (idStart !== -1 && idStart !== idEnd) {
      const beforeId = content.slice(0, idStart)
      docId = content.slice(idStart + 1, idEnd)
      const parts = beforeId.split('/')
      notebookName = parts.length > 1 ? parts[0] : 'Default'
      title = parts.length > 1 ? parts[1] : parts[0]
    } else {
      const parts = content.split('/')
      notebookName = parts.length > 1 ? parts[0] : 'Default'
      title = parts.length > 1 ? parts[1] : parts[0]
    }

    return {
      type: 'docReference',
      attrs: { title, notebookName, docId, notebookId },
    }
  },

  renderMarkdown(node, _helpers) {
    const notebookName = node.attrs?.notebookName || 'Default'
    const title = node.attrs?.title || ''
    const docId = node.attrs?.docId
    if (docId) {
      return `[[${notebookName}/${title}$${docId}$]]`
    }
    return `[[${notebookName}/${title}]]`
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: docReferencePluginKey,

        props: {
          handleTextInput(view, from, _to, text) {
            const state = view.state
            const $from = state.doc.resolve(from)
            const nodeBefore = $from.nodeBefore

            if (text === '[' && nodeBefore && nodeBefore.isText && nodeBefore.text?.endsWith('[')) {
              dropdownPending = true
              loadDocRefItems('').then((items) => {
                openDropdown({
                  triggerFrom: from - 1,
                  items,
                  selectedIndex: 0,
                  clientRect: () => {
                    const coords = view.coordsAtPos(from)
                    return new DOMRect(coords.left, coords.bottom, 0, 0)
                  },
                }, view as EditorView)
                dropdownPending = false
              })
              return false
            }

            const textAtCursor = state.doc.textBetween(Math.max(0, from - 2), from, '', '')
            if (textAtCursor === '[[' && !dropdownState && !dropdownPending) {
              dropdownPending = true
              loadDocRefItems('').then((items) => {
                openDropdown({
                  triggerFrom: from - 2,
                  items,
                  selectedIndex: 0,
                  clientRect: () => {
                    const coords = view.coordsAtPos(from)
                    return new DOMRect(coords.left, coords.bottom, 0, 0)
                  },
                }, view as EditorView)
                dropdownPending = false
              })
              return false
            }

            if ((dropdownState || dropdownPending) && text) {
              const triggerPos = dropdownState ? dropdownState.triggerFrom : from - 2
              const queryStart = triggerPos + 2
              const existingText = state.doc.textBetween(queryStart, from, '', '')
              const query = existingText + text

              loadDocRefItems(query).then((newItems) => {
                if (dropdownState && dropdownInstance) {
                  if (dropdownInstance.selectedIndex >= newItems.length) {
                    dropdownInstance.selectedIndex = newItems.length > 0 ? 0 : -1
                  }
                  dropdownInstance.items = newItems
                  if (dropdownRoot) {
                    dropdownRoot.render(
                      <DocRefDropdownComponent instance={dropdownInstance} onSelect={handleSelect} />
                    )
                  }
                } else if (dropdownPending) {
                  openDropdown({
                    triggerFrom: triggerPos,
                    items: newItems,
                    selectedIndex: 0,
                    clientRect: () => {
                      const coords = view.coordsAtPos(from)
                      return new DOMRect(coords.left, coords.bottom, 0, 0)
                    },
                  }, view as EditorView)
                }
              })
              return false
            }

            if (dropdownState) {
              closeDropdown()
            }
            return false
          },

          handleKeyDown(_view, event) {
            if (!dropdownState || !dropdownInstance) return false

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              dropdownInstance.selectedIndex = dropdownInstance.selectedIndex > 0
                ? dropdownInstance.selectedIndex - 1
                : dropdownInstance.items.length - 1
              if (dropdownRoot) {
                dropdownRoot.render(
                  <DocRefDropdownComponent instance={dropdownInstance} onSelect={handleSelect} />
                )
              }
              return true
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              dropdownInstance.selectedIndex = dropdownInstance.selectedIndex < dropdownInstance.items.length - 1
                ? dropdownInstance.selectedIndex + 1
                : 0
              if (dropdownRoot) {
                dropdownRoot.render(
                  <DocRefDropdownComponent instance={dropdownInstance} onSelect={handleSelect} />
                )
              }
              return true
            }

            if (event.key === 'Escape') {
              closeDropdown()
              return true
            }

            if (event.key === 'Enter' && dropdownInstance.items.length > 0) {
              event.preventDefault()
              const item = dropdownInstance.items[dropdownInstance.selectedIndex]
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

  onDestroy() {
    closeDropdown()
  },
})