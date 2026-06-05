import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const TAG_REGEX = /#([^\s\p{P}]+)(?=$|[\s\p{P}])/gu

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
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return true

              let match
              TAG_REGEX.lastIndex = 0

              while ((match = TAG_REGEX.exec(node.text))) {
                const from = pos + match.index
                const to = from + match[0].length
                decorations.push(Decoration.inline(from, to, { class: 'tag-node' }))
              }

              return true
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
