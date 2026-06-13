import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

// A `#tag` is only a tag when the `#` is at the start of the line or follows
// a whitespace character. Inline `#` (e.g. "哈哈#哈哈") is not a tag.
// The `(?<=^|\n|\s)` lookbehind covers the three line-start cases:
//   ^  — first char of the document
//   \n — start of a new block / line
//   \s — any whitespace (space, tab, …) before the `#`
const TAG_REGEX = /(?<=^|\n|\s)#([^\s\p{P}]+)(?=$|\n|\s|\p{P})/gu

export const Tag = Mark.create({
  name: 'tag',

  parseHTML() {
    return [{ tag: 'span.tag-node' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tag-node' }), 0]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tag'),

        props: {
          decorations(state) {
            // Walk the doc once to build a plain-text view alongside a
            // char-index → PM-position map. Separators are only inserted
            // when there is content before them, so a single-paragraph
            // doc has no leading newline — the `(?<=^|\n|\s)` lookbehind
            // handles the doc-start case via `^`.
            let plainText = ''
            const charToPM: number[] = []
            const appendSep = (ch: string) => {
              if (plainText.length === 0) return
              charToPM.push(-1)
              plainText += ch
            }
            state.doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                for (let i = 0; i < node.text.length; i++) {
                  charToPM.push(pos + i)
                }
                plainText += node.text
              } else if (node.isBlock) {
                appendSep('\n')
              } else if (node.isLeaf) {
                appendSep(' ')
              }
              return true
            })

            const decorations: Decoration[] = []
            for (const match of plainText.matchAll(TAG_REGEX)) {
              const fromChar = match.index!
              const toChar = fromChar + match[0].length
              const fromPM = charToPM[fromChar]
              const toPM = charToPM[toChar - 1] + 1
              if (fromPM < 0 || toPM <= 0) continue
              decorations.push(Decoration.inline(fromPM, toPM, { class: 'tag-node' }))
            }

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
