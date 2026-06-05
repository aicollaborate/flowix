import { useCallback, useEffect, useState, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { TextHOneIcon, TextHTwoIcon, TextHThreeIcon, TextHFourIcon, TextTIcon, ListBulletsIcon, ListNumbersIcon, CheckSquareIcon, TrashSimpleIcon } from '@phosphor-icons/react'
import { Kbd } from '../../ui/kbd'

interface DragContextMenuProps {
  editor: Editor
}

interface DragHandleState {
  visible: boolean
  position: { x: number; y: number }
}

const BLOCK_SELECTED_CLASS = 'is-block-selected'

const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, .ProseMirror-node'

function clearBlockHighlight(node: HTMLElement | null) {
  if (node && node.classList) {
    node.classList.remove(BLOCK_SELECTED_CLASS)
  }
}

// Resolve the block-level DOM element that contains the editor's current
// selection. Mirrors the lookup logic used by the drag handle, but exposes it
// as a pure function so the click handler can identify the right node to
// highlight without depending on internal render state.
function findCurrentBlockNode(editor: Editor): HTMLElement | null {
  const view = editor.view
  if (!view) return null
  const editorDom = view.dom as HTMLElement
  const { from } = view.state.selection

  const domPos = view.domAtPos(from)
  if (domPos.node instanceof Element) {
    const node = domPos.node.closest?.(BLOCK_SELECTOR) as HTMLElement | null
    if (node) return node
  }
  if (domPos.node?.parentElement) {
    const node = domPos.node.parentElement.closest?.(BLOCK_SELECTOR) as HTMLElement | null
    if (node) return node
  }
  const focused = editorDom.querySelector(':focus')
  if (focused instanceof HTMLElement) {
    const node = focused.closest?.(BLOCK_SELECTOR) as HTMLElement | null
    if (node) return node
  }
  return editorDom.querySelector(BLOCK_SELECTOR) as HTMLElement | null
}

const headingItems = [
  { level: 1 as const, icon: <TextHOneIcon size={16} weight="bold" />, symbol: '#', shortcut: '⌘1' },
  { level: 2 as const, icon: <TextHTwoIcon size={16} weight="bold" />, symbol: '##', shortcut: '⌘2' },
  { level: 3 as const, icon: <TextHThreeIcon size={16} weight="bold" />, symbol: '###', shortcut: '⌘3' },
  { level: 4 as const, icon: <TextHFourIcon size={16} weight="bold" />, symbol: '####', shortcut: '⌘4' },
  { type: 'paragraph' as const, icon: <TextTIcon size={16} weight="bold" />, label: '正文', shortcut: '⌘0' },
]

const listItems = [
  { type: 'bulletList' as const, icon: <ListBulletsIcon size={16} weight="bold" />, label: '无序列表', shortcut: '⌘⇧8' },
  { type: 'orderedList' as const, icon: <ListNumbersIcon size={16} weight="bold" />, label: '有序列表', shortcut: '⌘⇧7' },
  { type: 'taskList' as const, icon: <CheckSquareIcon size={16} weight="bold" />, label: '待办列表', shortcut: '⌘⇧9' },
]

export function DragContextMenu({ editor }: DragContextMenuProps) {
  const [state, setState] = useState<DragHandleState>({
    visible: false,
    position: { x: 0, y: 0 },
  })
  const [showMenu, setShowMenu] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [menuPosition, setMenuPosition] = useState<'bottom' | 'top'>('bottom')
  const [blockSelected, setBlockSelected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const ignoreBlur = useRef(false)
  const highlightedNodeRef = useRef<HTMLElement | null>(null)

  // Apply (or move) the visual highlight to `node`. If a previous node is
  // still marked, strip its class first so we never leave a stale highlight
  // behind on a different block.
  const applyBlockHighlight = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const previous = highlightedNodeRef.current
    if (previous && previous !== node) {
      clearBlockHighlight(previous)
    }
    node.classList.add(BLOCK_SELECTED_CLASS)
    highlightedNodeRef.current = node
  }, [])

  useEffect(() => {
    if (!editor?.view?.dom) return

    let mounted = true
    let rafId: number | null = null
    let frameSkip = 0

    const updateDragHandle = () => {
      if (!mounted || !editor.view) return

      if (!editor.view.hasFocus()) {
        setState(prev => ({ ...prev, visible: false }))
        return
      }

      const { view } = editor
      const { from } = view.state.selection

      // Cache DOM references
      const editorDom = view.dom as HTMLElement
      const editorContent = editorDom.closest('.editor-content') as HTMLElement

      // Find the block containing the current selection
      let domNode: HTMLElement | null = null

      // Walk up from cursor position to find block element
      const domPos = view.domAtPos(from)
      if (domPos.node instanceof Element) {
        domNode = domPos.node.closest?.('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, .ProseMirror-node') || null
      }
      if (!domNode && domPos.node?.parentElement) {
        domNode = domPos.node.parentElement.closest?.('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, .ProseMirror-node') || null
      }

      // Fallback: use focused element
      if (!domNode) {
        const focused = editorDom.querySelector(':focus')
        if (focused instanceof HTMLElement) {
          domNode = focused.closest?.('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, .ProseMirror-node') || null
        }
      }

      // Query for first block element
      if (!domNode) {
        const firstBlock = editorDom.querySelector('p, h1, h2, h3, h4, h5, h6, li') as HTMLElement | null
        if (firstBlock) domNode = firstBlock
      }

      if (!domNode || !editorContent) return

      const proseMirrorRect = view.dom.getBoundingClientRect()
      const contentRect = editorContent.getBoundingClientRect()
      const nodeRect = domNode.getBoundingClientRect()

      // X: fixed offset from proseMirror left edge, Y: follow current block
      // Note: use proseMirrorRect (the .comn-tiptap-editor container) as reference
      // instead of contentRect (.editor-content), because .editor-content scrolls
      // and its viewport-relative top changes, causing y offset errors
      const x = (proseMirrorRect.left - contentRect.left) + 18
      const y = nodeRect.top - proseMirrorRect.top + 5

      // When the user has clicked the handle to "select" a block, keep the
      // highlight pinned to the originally targeted node — even if the cursor
      // moves within or just after the block — so the menu's context remains
      // visually anchored. If the pinned node is gone (e.g., another code
      // path deleted the block), drop the highlight rather than chase the
      // cursor.
      if (blockSelected) {
        const pinned = highlightedNodeRef.current
        if (pinned && !pinned.isConnected) {
          highlightedNodeRef.current = null
          setBlockSelected(false)
        }
      }

      setState({
        visible: true,
        position: { x, y },
      })
    }

    const handleScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateDragHandle()
      })
    }

    const handleBlur = () => {
      if (!ignoreBlur.current) {
        setState(prev => ({ ...prev, visible: false }))
        // Drop the highlight when the editor loses focus — the menu's context
        // is no longer actionable, so leaving it on-screen would be misleading.
        clearBlockHighlight(highlightedNodeRef.current)
        highlightedNodeRef.current = null
        setBlockSelected(false)
      }
    }

    editor.on('selectionUpdate', updateDragHandle)
    editor.on('focus', updateDragHandle)
    editor.on('blur', handleBlur)

    const editorDom = editor.view.dom as HTMLElement
    const scrollContainer = editorDom.closest('.comn-tiptap-editor') as HTMLElement
    const scrollTarget = scrollContainer || editorDom
    scrollTarget.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      if (rafId) return
      frameSkip++
      if (frameSkip % 3 !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateDragHandle()
      })
    })
    resizeObserver.observe(scrollContainer || editorDom)

    return () => {
      mounted = false
      if (rafId) cancelAnimationFrame(rafId)
      editor.off('selectionUpdate', updateDragHandle)
      editor.off('focus', updateDragHandle)
      editor.off('blur', handleBlur)
      scrollTarget.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [editor, blockSelected, applyBlockHighlight])

  // Clean up the highlight if the component unmounts (e.g., editor destroyed
  // when switching memos). Without this, an orphan `is-block-selected` class
  // could stick to a DOM node that outlives this component.
  useEffect(() => {
    return () => {
      clearBlockHighlight(highlightedNodeRef.current)
      highlightedNodeRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!showMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        // Dismissing via outside click also drops the highlight.
        clearBlockHighlight(highlightedNodeRef.current)
        highlightedNodeRef.current = null
        setBlockSelected(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu, editor])

  const handleTransform = (type: string, level?: 1 | 2 | 3 | 4) => {
    if (type === 'paragraph') {
      editor.chain().focus().setParagraph().run()
    } else if (type === 'heading' && level) {
      editor.chain().focus().toggleHeading({ level }).run()
    } else if (type === 'bulletList') {
      editor.chain().focus().toggleBulletList().run()
    } else if (type === 'orderedList') {
      editor.chain().focus().toggleOrderedList().run()
    } else if (type === 'taskList') {
      editor.chain().focus().toggleTaskList().run()
    }
    setShowMenu(false)
    // The transformed block may be a different DOM node; drop the old
    // highlight so we don't leave a stale class behind. The new block
    // will be picked up by the next selectionUpdate tick if needed.
    clearBlockHighlight(highlightedNodeRef.current)
    highlightedNodeRef.current = null
    setBlockSelected(false)
  }

  const renderMenuButton = (
    icon: React.ReactNode,
    label: string,
    shortcut?: string,
    onClick?: () => void
  ) => (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className="relative flex items-center w-full px-3 py-1.5 text-sm cursor-pointer active:bg-[#e8ecf4] text-left rounded"
      style={{ gap: 12, color: '#333' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}
      <span style={{ color: '#333' }}>{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  )

  return (
    <div
      ref={containerRef}
      className={`drag-context-menu-handle${showMenu ? ' active' : ''}`}
      style={{
        position: 'absolute',
        left: `${state.position.x}px`,
        top: `${state.position.y}px`,
        width: '18px',
        height: '18px',
        display: state.visible ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
        zIndex: 1000,
        background: showMenu ? '#5262DC' : (isHovered ? '#f0f0f0' : 'transparent'),
        color: showMenu ? 'white' : '#5262DC',
        borderRadius: '4px',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={(e) => {
        ignoreBlur.current = true
        if (showMenu) {
          e.preventDefault()
        }
      }}
      onMouseUp={() => {
        setTimeout(() => { ignoreBlur.current = false }, 300)
      }}
      onClick={() => {
        if (!showMenu && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          const spaceBelow = window.innerHeight - rect.bottom
          setMenuPosition(spaceBelow > 300 ? 'bottom' : 'top')
        }
        const nextOpen = !showMenu
        // When opening, mark the current block as "selected" so the user
        // gets explicit visual feedback that the menu's commands apply to
        // that paragraph. When closing, drop the highlight.
        if (nextOpen) {
          const currentNode = findCurrentBlockNode(editor)
          if (currentNode) {
            applyBlockHighlight(currentNode)
            setBlockSelected(true)
          }
        } else {
          clearBlockHighlight(highlightedNodeRef.current)
          highlightedNodeRef.current = null
          setBlockSelected(false)
        }
        setShowMenu(nextOpen)
      }}
    >
      <svg width="12" height="13" viewBox="0 0 12 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="10" height="1.8" rx="0.75" fill="currentColor"/>
        <rect x="4" y="6" width="6" height="1.8" rx="0.75" fill="currentColor"/>
        <rect x="2" y="11" width="9" height="1.8" rx="0.75" fill="currentColor"/>
      </svg>
      {showMenu && (
        <div
          className="absolute z-50 bg-white border border-[rgba(0,0,0,0.08)] rounded-lg shadow-lg p-1"
          style={{
            left: '100%',
            top: menuPosition === 'bottom' ? 0 : 'auto',
            bottom: menuPosition === 'top' ? 0 : 'auto',
            marginLeft: 8,
            minWidth: 180,
          }}
        >
          {headingItems.map((item) => (
            renderMenuButton(
              item.icon,
              item.symbol ?? item.label,
              'shortcut' in item ? item.shortcut : undefined,
              () => 'level' in item ? handleTransform('heading', item.level) : handleTransform(item.type)
            )
          ))}
          <hr className="my-1 border-t border-[rgba(0,0,0,0.06)]" />
          {listItems.map(({ type, icon, label, shortcut }) => (
            renderMenuButton(icon, label, shortcut, () => handleTransform(type))
          ))}
          <hr className="my-1 border-t border-[rgba(0,0,0,0.06)]" />
          {renderMenuButton(
            <TrashSimpleIcon size={16} weight="bold" />,
            '删除',
            '⌫',
            () => {
              const { selection } = editor.state
              const { $from } = selection
              const pos = $from.before(1)
              if (pos >= 0) {
                const node = editor.state.doc.nodeAt(pos)
                if (node) {
                  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
                }
              }
              setShowMenu(false)
              // The deleted node is gone — clear the ref to avoid dangling
              // references, and drop the highlight state.
              clearBlockHighlight(highlightedNodeRef.current)
              highlightedNodeRef.current = null
              setBlockSelected(false)
            }
          )}
        </div>
      )}
    </div>
  )
}