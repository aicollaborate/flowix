import { CodeBlock } from '@tiptap/extension-code-block';
import { createCodeBlockShikiView } from './codeblock-shiki-view';
import { proseMirrorPluginShiki } from '../shiki/shiki-plugin';
import { loadHighlighter } from '../shiki/shiki-highlighter';

const defaultTheme = 'rose-pine-dawn';
const defaultLanguage = 'plaintext';
const languageClassPrefix = 'language-';

function getLanguageFromElement(element: HTMLElement): string | null {
  const codeElement = element.matches('code') ? element : element.querySelector('code');
  const languageClass = Array.from(codeElement?.classList || [])
    .find(className => className.startsWith(languageClassPrefix));

  return languageClass?.replace(languageClassPrefix, '') || null;
}

// Initialize highlighter immediately with default languages/themes
loadHighlighter({
  themes: [defaultTheme],
  langs: [defaultLanguage, 'typescript', 'python', 'rust', 'go'],
});

export const CodeBlockShiki = CodeBlock.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      defaultLanguage,
      defaultTheme,
    } as any;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: defaultLanguage,
        parseHTML: (element) => {
          return element.getAttribute('data-language') || getLanguageFromElement(element) || null;
        },
        renderHTML: (attributes) => {
          if (attributes.language === defaultLanguage) return {};
          return { 'data-language': attributes.language };
        },
      },
      theme: {
        default: defaultTheme,
        parseHTML: element => element.getAttribute('data-theme'),
      },
    };
  },

  addNodeView() {
    return (...args) => createCodeBlockShikiView(...args);
  },

  addProseMirrorPlugins() {
    const plugins = super.addProseMirrorPlugins?.() || [];
    return [
      ...plugins,
      proseMirrorPluginShiki({
        name: this.name,
        defaultLanguage,
        defaultTheme,
      }),
    ];
  },
});

// Export for external usage
export { loadHighlighter, initHighlighter, loadLanguage, loadTheme } from '../shiki/shiki-highlighter';
