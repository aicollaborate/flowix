import type { Highlighter } from 'shiki'

interface MonacoThemeData {
  base: string;
  inherit: boolean;
  rules: { token: string; foreground: string }[];
  colors: Record<string, string>;
}

function mapTokenType(shikiStyle: string): string {
  const lower = shikiStyle.toLowerCase()
  if (lower.includes('comment')) return 'comment'
  if (lower.includes('string')) return 'string'
  if (lower.includes('keyword')) return 'keyword'
  if (lower.includes('number')) return 'number'
  if (lower.includes('type')) return 'type'
  if (lower.includes('function')) return 'function'
  if (lower.includes('operator')) return 'operator'
  if (lower.includes('punctuation')) return 'delimiter'
  return 'variable'
}

export function createMonacoTheme(
  highlighter: Highlighter,
  themeName: string,
): MonacoThemeData {
  const shikiTheme = highlighter.getTheme(themeName)
  const colors = shikiTheme.colors || {}

  const sampleTokens = highlighter.codeToTokensBase('sample text', {
    lang: 'typescript',
    theme: themeName as any
  })

  const seen = new Set<string>()
  const tokenRules: { token: string; foreground: string }[] = []

  for (const lineTokens of sampleTokens) {
    for (const token of lineTokens) {
      const monacoType = mapTokenType(token.color || '')
      const key = `${monacoType}-${token.color}`
      if (!seen.has(key) && token.color) {
        seen.add(key)
        tokenRules.push({
          token: monacoType,
          foreground: token.color.replace('#', ''),
        })
      }
    }
  }

  return {
    base: 'vs',
    inherit: true,
    rules: tokenRules,
    colors: {
      'editor.background': colors['editor.background'] || '#ffffff',
      'editor.foreground': colors['editor.foreground'] || '#333333',
      'editorLineNumber.foreground': colors['editorLineNumber.foreground'] || '#999999',
      'editor.selectionBackground': colors['editor.selectionBackground'] || '#b4d7ff',
      'editor.lineHighlightBackground': colors['editor.lineHighlightBackground'] || '#f5f5f5',
      'editorCursor.foreground': colors['editorCursor.foreground'] || '#5262DC',
      'editorWhitespace.foreground': colors['editorLineNumber.foreground'] || '#cccccc',
    },
  }
}