'use client';

import { useRef, useCallback, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import { cn } from '../../lib/utils';
import { createMonacoTheme } from '../mdeditor/extensions/shiki/monaco-shiki-theme';
import { getShiki } from '../mdeditor/extensions/shiki/shiki-highlighter';
import { loadHighlighter } from '../mdeditor/extensions/codeblock-shiki/codeblock-shiki';

interface SrcEditorProps {
  content: string;
  onChange?: (value: string) => void;
  onEditingFinished?: () => void;
  className?: string;
  isReadOnly?: boolean;
}

const defaultTheme = 'rose-pine-dawn';

export function SrcEditor({
  content,
  onChange,
  onEditingFinished,
  className,
  isReadOnly = false,
}: SrcEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef(content);
  const isApplyingExternalContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onEditingFinishedRef = useRef(onEditingFinished);
  onChangeRef.current = onChange;
  onEditingFinishedRef.current = onEditingFinished;

  const handleBeforeMount = useCallback(async () => {
    await loadHighlighter({
      themes: [defaultTheme],
      langs: ['plaintext', 'typescript', 'python', 'rust', 'go', 'javascript'],
    });
    const highlighter = getShiki();
    if (highlighter) {
      const monacoTheme = createMonacoTheme(highlighter, defaultTheme);
      monaco.editor.defineTheme('shiki-rose-pine', monacoTheme as any);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let editor: monaco.editor.IStandaloneCodeEditor | null = null;

    handleBeforeMount().then(() => {
      if (!containerRef.current) return;

      editor = monaco.editor.create(containerRef.current, {
        value: contentRef.current,
        language: 'markdown',
        theme: 'shiki-rose-pine',
        readOnly: isReadOnly,
        minimap: { enabled: false },
        lineNumbers: 'on',
        wordWrap: 'on',
        wrappingStrategy: 'advanced',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'line',
        folding: true,
        foldingHighlight: true,
        foldingStrategy: 'indentation',
        showFoldingControls: 'mouseover',
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'hidden',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });

      editorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        const value = editor?.getValue() || '';
        contentRef.current = value;
        if (isApplyingExternalContentRef.current) return;
        onChangeRef.current?.(value);
      });

      editor.onDidBlurEditorWidget(() => {
        onEditingFinishedRef.current?.();
      });

      editor.focus();
    });

    return () => {
      editor?.dispose();
      editorRef.current = null;
    };
  }, [handleBeforeMount, isReadOnly]);

  // Sync external content changes (e.g., file reload) into the editor
  useEffect(() => {
    if (editorRef.current && content !== contentRef.current) {
      const editor = editorRef.current;
      const position = editor.getPosition();
      const selection = editor.getSelection();
      const scrollTop = editor.getScrollTop();
      const scrollLeft = editor.getScrollLeft();

      contentRef.current = content;
      isApplyingExternalContentRef.current = true;
      try {
        editor.setValue(content);
      } finally {
        isApplyingExternalContentRef.current = false;
      }

      if (position) {
        const model = editor.getModel();
        const lineCount = model?.getLineCount() ?? 1;
        const lineNumber = Math.min(position.lineNumber, lineCount);
        const maxColumn = model?.getLineMaxColumn(lineNumber) ?? 1;
        editor.setPosition({
          lineNumber,
          column: Math.min(position.column, maxColumn),
        });
      }
      if (selection) {
        const model = editor.getModel();
        const lineCount = model?.getLineCount() ?? 1;
        const clampLine = (lineNumber: number) => Math.min(lineNumber, lineCount);
        const clampColumn = (lineNumber: number, column: number) => {
          const clampedLine = clampLine(lineNumber);
          return Math.min(column, model?.getLineMaxColumn(clampedLine) ?? 1);
        };
        editor.setSelection(new monaco.Selection(
          clampLine(selection.selectionStartLineNumber),
          clampColumn(selection.selectionStartLineNumber, selection.selectionStartColumn),
          clampLine(selection.positionLineNumber),
          clampColumn(selection.positionLineNumber, selection.positionColumn),
        ));
      }
      editor.setScrollPosition({ scrollTop, scrollLeft });
    }
  }, [content]);

  return (
    <div className={cn('srceditor', className)}>
      <div className="srceditor-editor" ref={containerRef} />
    </div>
  );
}
