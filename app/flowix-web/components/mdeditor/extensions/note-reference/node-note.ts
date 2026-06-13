// `<note>` 行内卡片节点。
//
// Markdown 形态: `<note id="vex4v9" notebook="nb_173..." path="/Users/.../foo#vex4v9.md">notebookName/title</note>`
//
// 设计来源:
//   - 用户从外部 (Finder / 终端) 粘贴一份笔记的绝对路径到编辑器
//   - `MarkdownPaste.handlePaste` 顶部命中分支识别到这是当前 notebook 列表中某条
//     memo 的路径, 转成 noteReference 节点 (见 ./physical-link-paste.ts)
//
//
// id-as-truth: 卡片显示文本 `notebookName/title` 是给人看的, 真正用来定位笔记的
// 是 attrs.docId。笔记改名 → 显示文本下次 mount 时会被异步刷新; 笔记被删/被搬
// → 卡片降级为灰色 stale 态。

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView as ProseMirrorNodeView, EditorView } from '@tiptap/pm/view';
import { Node } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';

import { memos as memosClient } from '../../../../lib/tauri/client';
import { openNoteByPhysicalPath } from '../../../../lib/openByTarget';

// ─── Attrs ────────────────────────────────────────────────────────────────────

export interface NoteReferenceAttrs {
  docId: string | null;
  notebookId: string | null;
  notebookName: string;
  title: string;
  originalPath: string | null;
  /** 渲染态: docId 在 notebook 中查不到时为 true; 不写入 markdown */
  stale: boolean;
}


// 文本省略:超出 max 个"字"则截断并在末尾追加 `…`。
//   - 用 Array.from 把字符串拆成 Unicode 码点, 避免把 emoji / 代理对切坏
//   - 中文 / 英文 / 数字一律按 1 个字计, 与 CLAUDE.md「长度按字符数」口径一致
//   - 长度 ≤ max 时原样返回, 不加省略号
function truncateText(s: string, max: number): string {
  if (!s) return s;
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max).join('') + '…';
}

// ─── HTML escape ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 解 HTML 实体, 用于从 marked 解析出来的 token 中还原原始字符串
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// 把 `notebookName/title` 拆开 — 用 lastIndexOf 防止 notebookName 自身含 `/`
function splitDisplay(text: string): { notebookName: string; title: string } {
  const t = text.trim();
  const slash = t.lastIndexOf('/');
  if (slash < 0) return { notebookName: '', title: t };
  return { notebookName: t.slice(0, slash), title: t.slice(slash + 1) };
}

// 从 `<note id="..." notebook="..." path="...">...</note>` 的 attrs 串里抽单个 attr
function pickAttr(attrsStr: string, name: string): string | null {
  // 支持 双引号 / 单引号
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrsStr.match(re);
  if (!m) return null;
  return unescapeHtml(m[1] ?? m[2] ?? '');
}

// ─── HardBreak 清理 ───────────────────────────────────────────────────────────

/**
 * 删掉 noteReference 节点之前紧邻的 hardBreak 节点。
 *
 * 触发场景:用户在编辑器里按 Shift+Enter 硬换行(产生 hardBreak),然后在下一
 * 行粘贴物理路径 → 落盘 markdown 形如 `foo  \n<note ...>...</note>`。再次打
 * 开时,marked 把 hardBreak 和 noteReference 还原成 ProseMirror 节点,渲染时
 * hardBreak 强制占一行,视觉上卡片"头顶"多出一行空白。
 *
 * 完全对照 fileAttachment 节点(`attachment-link/node-file.ts:11` 同名函数)
 * 的处理方式 — 二者都是 inline atom 节点,同样受 hardBreak 残留影响。
 */
function removeHardBreaksBeforeNoteReferences(state: any) {
  const deletions: Array<{ from: number; to: number }> = [];

  state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== 'noteReference') return;

    const $pos = state.doc.resolve(pos);
    const nodeBefore = $pos.nodeBefore;
    if (nodeBefore?.type.name === 'hardBreak') {
      deletions.push({ from: pos - nodeBefore.nodeSize, to: pos });
    }
  });

  if (deletions.length === 0) return null;

  const tr = state.tr;
  deletions.reverse().forEach(({ from, to }) => {
    tr.delete(from, to);
  });
  return tr;
}

// ─── NodeView ─────────────────────────────────────────────────────────────────

const STALE_CHECK_FLAG: WeakSet<ProseMirrorNode> = new WeakSet();

class NoteReferenceView implements ProseMirrorNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: (() => number | undefined) | undefined;
  private clickHandler: (e: MouseEvent) => void;

  constructor(node: ProseMirrorNode, view: EditorView, getPos: (() => number | undefined) | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = this.createCard();
    this.clickHandler = (e) => this.handleClick(e);
    // 监听挂在外层 wrapper 上, 与 file-attachment 同源
    this.dom.addEventListener('mousedown', (e) => {
      // 点击卡片时阻止 ProseMirror 把焦点放到卡片中间(atom)
      e.preventDefault();
    });
    this.dom.addEventListener('click', this.clickHandler);
    this.scheduleStaleCheck();
  }

  private createCard(): HTMLElement {
    const { notebookName, title, originalPath, stale } = this.node.attrs as NoteReferenceAttrs;

    // 外层 wrapper: 与 .tiptap-file-attachment 同结构 (display:inline),
    // 内部 __card 是真正的"卡片" — 拿 hover/selected 高亮
    const wrapper = document.createElement('span');
    wrapper.className = 'tiptap-note-reference';
    wrapper.contentEditable = 'false';

    const card = document.createElement('span');
    card.className = 'tiptap-note-reference__card';
    card.setAttribute('data-stale', stale ? 'true' : 'false');
    if (originalPath) {
      card.setAttribute('title', stale ? `链接已失效 · ${originalPath}` : originalPath);
    }

    // 笔记图标 (lucide file-text 同形, 内联 SVG 避免依赖 React)
    const icon = document.createElement('span');
    icon.className = 'tiptap-note-reference__icon';
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

    // 名称 = `notebookName > title` — 三段: notebook (muted) / chevron / title (primary)
    // 与 file-attachment 的 __name 同属"标签段", 但内部语义更强, 用 chevron
    // 区分路径层级 (lucide chevron-right 同形, 9x9 inline SVG)
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tiptap-note-reference__name';
    if (notebookName) {
      const nbSpan = document.createElement('span');
      nbSpan.className = 'tiptap-note-reference__notebook';
      // 笔记本名 > 10 字省略, 避免极长 notebook 名把卡片撑变形
      nbSpan.textContent = truncateText(notebookName, 10);

      const chevron = document.createElement('span');
      chevron.className = 'tiptap-note-reference__chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tiptap-note-reference__title';
      // 笔记标题 > 30 字省略, 与 notebook 限制保持一致的"按字"口径
      titleSpan.textContent = truncateText(title || '未命名', 30);

      nameSpan.append(nbSpan, chevron, titleSpan);
    } else {
      // notebookName 缺失 (粘贴路径无前缀命中) — 只显示 title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tiptap-note-reference__title';
      titleSpan.textContent = truncateText(title || '未命名', 30);
      nameSpan.appendChild(titleSpan);
    }

    card.appendChild(icon);
    card.appendChild(nameSpan);
    wrapper.appendChild(card);

    // 选中态 toggle (与 file-attachment 的 selectNode/deselectNode 同源,
    // 但挂在 card 上, 因为高亮背景在 .is-selected .tiptap-note-reference__card)
    card.addEventListener('selectstart', (e) => {
      e.preventDefault();
    });

    return wrapper;
  }

  private async handleClick(e: MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    // 单击只选中节点 — 把 ProseMirror NodeSelection 落上去, 用户继续输入能
    // 自然挤掉卡片, 行为对齐 Tiptap 其它 atom 节点。
    const pos = this.getPos?.();
    if (pos !== undefined) {
      const sel = NodeSelection.create(this.view.state.doc, pos);
      this.view.dispatch(this.view.state.tr.setSelection(sel));
    }

    // 双击才触发跳转; 单击 / ⌘+click / Ctrl+click 都不打开。
    if (e.detail < 2) return;

    const attrs = this.node.attrs as NoteReferenceAttrs;
    if (!attrs.docId || attrs.stale) return;

    // 走 `openByTarget` 统一管线 ── 把卡片绑定的物理路径交给后端权威解析
    // (走 parser.rs::PhysicalPath 分支), 由 `openNoteByTarget` 完成跨 notebook
    // 切换 + upsertMemo + setSelectedMemo + openMemoDocument 串行链路。
    // 后端 `find_memo_file_by_id` 二次校验 (笔记本外路径 / 文件被删), 比
    // 之前手写 4 步更稳。
    if (!attrs.originalPath) return;
    await openNoteByPhysicalPath(attrs.originalPath);
  }

  private scheduleStaleCheck(): void {
    // 同一份 node 多次 mount/unmount 时只校验一次, 减少 IPC
    if (STALE_CHECK_FLAG.has(this.node)) return;
    STALE_CHECK_FLAG.add(this.node);

    const attrs = this.node.attrs as NoteReferenceAttrs;
    if (!attrs.docId) return;

    // 切到下一个 tick — 避免在 NodeView 构造期间触发 dispatch
    void (async () => {
      try {
        const memo = await memosClient.readMemo(attrs.docId!);
        if (!memo) {
          this.applyAttrs({ stale: true });
          return;
        }
        // 笔记还在: 顺手刷新 title 防止文件改名后卡片显示过期文案
        const freshTitle = String(memo.filename ?? memo.name ?? '').trim();
        if (freshTitle && freshTitle !== attrs.title) {
          this.applyAttrs({ title: freshTitle, stale: false });
        } else if (attrs.stale) {
          // 之前误判过 stale, 现在恢复
          this.applyAttrs({ stale: false });
        }
      } catch (err) {
        // IPC 失败不强制标 stale (网络/进程问题), 保持现状
        // eslint-disable-next-line no-console
        console.warn('[note-reference] stale check failed:', err);
      }
    })();
  }

  /**
   * 异步把新的 attrs 写回 doc。必须重新解析 pos, 因为 NodeView mount 时拿到的
   * getPos() 在校验返回时可能已经位移。
   */
  private applyAttrs(patch: Partial<NoteReferenceAttrs>): void {
    const pos = this.getPos?.();
    if (pos === undefined) return;
    // 防御: 检查该位置当前是不是仍然是本节点
    const nodeAtPos = this.view.state.doc.nodeAt(pos);
    if (!nodeAtPos || nodeAtPos.type.name !== 'noteReference') return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      ...patch,
    });
    // setMeta 'addToHistory' false: stale 校验是后台行为, 不进 undo 栈
    tr.setMeta('addToHistory', false);
    this.view.dispatch(tr);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== 'noteReference') return false;
    this.node = node;
    const next = this.createCard();
    this.dom.replaceWith(next);
    next.addEventListener('mousedown', (e) => e.preventDefault());
    next.addEventListener('click', this.clickHandler);
    this.dom = next;
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('is-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  stopEvent(event: Event): boolean {
    // 卡片内部事件不让 ProseMirror 接管, 但 composition 例外
    if (event.type.startsWith('composition')) return false;
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.dom.removeEventListener('click', this.clickHandler);
  }
}

// ─── Node definition ──────────────────────────────────────────────────────────

export const NoteReference = Node.create({
  name: 'noteReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  // 抢在 Markdown 扩展之前注册 tokenizer
  priority: 1000,

  addAttributes() {
    return {
      docId:        { default: null },
      notebookId:   { default: null },
      notebookName: { default: '' },
      title:        { default: '' },
      originalPath: { default: null },
      stale:        { default: false, rendered: false }, // 不写入 HTML/markdown
    };
  },

  parseHTML() {
    return [
      {
        tag: 'note',
        getAttrs: (el: HTMLElement) => {
          const docId        = el.getAttribute('id') || null;
          const notebookId   = el.getAttribute('notebook') || null;
          const originalPath = el.getAttribute('path') || null;
          const { notebookName, title } = splitDisplay(el.textContent ?? '');
          return { docId, notebookId, notebookName, title, originalPath, stale: false };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const a = node.attrs as NoteReferenceAttrs;
    return [
      'note',
      {
        id: a.docId ?? '',
        notebook: a.notebookId ?? '',
        path: a.originalPath ?? '',
      },
      `${a.notebookName || ''}${a.notebookName ? '/' : ''}${a.title || ''}`,
    ];
  },

  // ─── Markdown round-trip ──────────────────────────────────────────────────
  // marked 默认会把 `<note>...</note>` 当作 inline HTML token, 走
  // `@tiptap/markdown` 的 parseHTMLToken → 我们的 parseHTML 路径。
  // 这里再注册一份自定义 tokenizer 兜底, 防止 marked 行为变化。

  markdownTokenizer: {
    name: 'noteReference',
    level: 'inline' as const,
    start(src: string) {
      // 注意 `<note ` 必须带空格, 防止误吃未来 `<notexyz>` 一类的扩展
      const i = src.indexOf('<note ');
      return i < 0 ? -1 : i;
    },
    tokenize(src: string): any {
      const m = /^<note\s+([^>]*)>([\s\S]*?)<\/note>/.exec(src);
      if (!m) return undefined;
      return { type: 'noteReference', raw: m[0], attrs: m[1], text: m[2] };
    },
  },

  parseMarkdown(token: any) {
    const attrsStr = String(token.attrs ?? '');
    const text     = String(token.text ?? '');
    const { notebookName, title } = splitDisplay(unescapeHtml(text));
    return {
      type: 'noteReference',
      attrs: {
        docId:        pickAttr(attrsStr, 'id'),
        notebookId:   pickAttr(attrsStr, 'notebook'),
        notebookName,
        title,
        originalPath: pickAttr(attrsStr, 'path'),
        stale:        false,
      },
    };
  },

  renderMarkdown(node: any) {
    const a = (node?.attrs ?? {}) as NoteReferenceAttrs;
    const id   = escapeHtml(a.docId        ?? '');
    const nb   = escapeHtml(a.notebookId   ?? '');
    const pa   = escapeHtml(a.originalPath ?? '');
    const display = a.notebookName
      ? `${a.notebookName}/${a.title || ''}`
      : (a.title || '');
    return `<note id="${id}" notebook="${nb}" path="${pa}">${escapeHtml(display)}</note>`;
  },

  // ─── NodeView ─────────────────────────────────────────────────────────────

  addNodeView() {
    return ({ node, view, getPos }) => new NoteReferenceView(node, view, getPos as () => number | undefined);
  },

  // ─── HardBreak 清理 ───────────────────────────────────────────────────────
  // 与 fileAttachment 同源(`attachment-link/node-file.ts:onCreate / addProseMirrorPlugins`):
  // 编辑器刚创建时扫一遍,后续每次文档变动也扫一遍,防止用户手动在卡片
  // 前插入换行(Shift+Enter)导致卡片头部出现空行。

  onCreate() {
    const tr = removeHardBreaksBeforeNoteReferences(this.editor.state);
    if (tr?.docChanged) {
      this.editor.view.dispatch(tr);
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(transaction => transaction.docChanged)) return null;
          return removeHardBreaksBeforeNoteReferences(newState);
        },
      }),
    ];
  },

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection } = this.editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === 'noteReference') {
          this.editor.commands.deleteSelection();
          return true;
        }
        const { $from } = selection;
        const before = $from.nodeBefore;
        if (before && before.type.name === 'noteReference') {
          const from = $from.pos - before.nodeSize;
          this.editor.commands.deleteRange({ from, to: $from.pos });
          return true;
        }
        return false;
      },
      Delete: () => {
        const { selection } = this.editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === 'noteReference') {
          this.editor.commands.deleteSelection();
          return true;
        }
        const { $from } = selection;
        const after = $from.nodeAfter;
        if (after && after.type.name === 'noteReference') {
          this.editor.commands.deleteRange({ from: $from.pos, to: $from.pos + after.nodeSize });
          return true;
        }
        return false;
      },
    };
  },
});
