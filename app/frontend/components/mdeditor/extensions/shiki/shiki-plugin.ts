import type { BundledLanguage, BundledTheme } from 'shiki'

import { findChildren } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { getDecorations } from './shiki-decorations'

export interface PluginShikiOptions {
  name: string
  defaultLanguage: BundledLanguage | 'plaintext' | null | undefined
  defaultTheme: BundledTheme
}

export function proseMirrorPluginShiki(options: PluginShikiOptions) {
  const { name, defaultLanguage, defaultTheme } = options

  const shikiPlugin: Plugin = new Plugin({
    key: new PluginKey('codeBlockShiki'),

    state: {
      init: (_, { doc }) => {
        return getDecorations({ doc, name, defaultLanguage, defaultTheme })
      },

      apply: (transaction, decorationSet, oldState, newState) => {
        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name

        const oldNodes = findChildren(oldState.doc, node => node.type.name === name)
        const newNodes = findChildren(newState.doc, node => node.type.name === name)

        const didChangeSomeCodeBlock = transaction.docChanged && (
          [oldNodeName, newNodeName].includes(name)
          || newNodes.length !== oldNodes.length
          || transaction.steps.some((step: any) => {
            return (step.from !== undefined && step.to !== undefined
              && oldNodes.some((node) => {
                return (
                  node.pos >= step.from
                  && node.pos + node.node.nodeSize <= step.to
                )
              })
            )
          }))

        if (transaction.getMeta('shikiPluginForceDecoration') || didChangeSomeCodeBlock) {
          return getDecorations({
            doc: transaction.doc,
            name,
            defaultLanguage,
            defaultTheme
          })
        }

        return decorationSet.map(transaction.mapping, transaction.doc)
      }
    },

    props: {
      decorations(state) {
        return shikiPlugin.getState(state)
      }
    }
  })

  return shikiPlugin
}
