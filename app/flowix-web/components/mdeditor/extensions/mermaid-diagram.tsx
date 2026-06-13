'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState, memo } from 'react';

interface MermaidDiagramState {
  isEditing: boolean;
  isRendering: boolean;
  error: string | null;
  svg: string | null;
}

async function renderMermaidDiagram(code: string, theme: 'dark' | 'light'): Promise<{ svg: string } | { error: string }> {
  try {
    const mermaidModule = await import('mermaid/dist/mermaid.core.mjs');
    const mermaid = mermaidModule.default;

    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const svg = await mermaid.render(id, code);

    return { svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : '图表渲染失败';
    return { error: message };
  }
}

const MermaidDiagramView = memo(({ node }: { node: any }) => {
  const code = node.textContent;
  const [state, setState] = useState<MermaidDiagramState>({
    isEditing: false,
    isRendering: true,
    error: null,
    svg: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  const theme = 'light';

  useEffect(() => {
    let cancelled = false;
    cancelledRef.current = false;

    async function render() {
      if (!code.trim()) {
        setState(prev => ({ ...prev, isRendering: false, error: null, svg: null }));
        return;
      }

      setState(prev => ({ ...prev, isRendering: true }));

      const result = await renderMermaidDiagram(code, theme);

      if (!cancelled && !cancelledRef.current) {
        if ('error' in result) {
          setState(prev => ({
            ...prev,
            isRendering: false,
            error: result.error,
            svg: null,
          }));
        } else {
          setState(prev => ({
            ...prev,
            isRendering: false,
            error: null,
            svg: result.svg,
          }));
        }
      }
    }

    render();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, [code, theme]);

  const handleEditClick = useCallback(() => {
    setState(prev => ({ ...prev, isEditing: true }));
  }, []);

  const handleViewClick = useCallback(() => {
    setState(prev => ({ ...prev, isEditing: false }));
  }, []);

  if (!state.isEditing) {
    return (
      <NodeViewWrapper>
        <div className="mermaid-diagram-wrapper">
          <div className="mermaid-toolbar">
            <button
              className="mermaid-edit-btn"
              onClick={handleEditClick}
              type="button"
              title="编辑图表"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          {state.isRendering && (
            <div className="mermaid-loading">正在渲染图表…</div>
          )}
          {state.error && (
            <div className="mermaid-error">
              <span className="mermaid-error-icon">!</span>
              <span className="mermaid-error-text">{state.error}</span>
            </div>
          )}
          {state.svg && (
            <div
              ref={containerRef}
              className="mermaid-svg-container"
              dangerouslySetInnerHTML={{ __html: state.svg }}
            />
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div className="mermaid-diagram-wrapper mermaid-editing">
        <div className="mermaid-toolbar">
          <button
            className="mermaid-view-btn"
            onClick={handleViewClick}
            type="button"
            title="查看图表"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        <NodeViewContent className="mermaid-editor" />
      </div>
    </NodeViewWrapper>
  );
});

const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  content: 'text*',
  defining: true,

  addNodeView() {
    return ReactNodeViewRenderer(MermaidDiagramView, {
      stopEvent: () => false,
    });
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid"]',
        getAttrs: (node) => {
          const el = node as HTMLElement;
          return { data: el.dataset.diagram || '' };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'mermaid', 'data-diagram': node.textContent },
        HTMLAttributes
      ),
    ];
  },
});

export default MermaidDiagram;