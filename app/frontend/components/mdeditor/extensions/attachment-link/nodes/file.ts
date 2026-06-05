import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView as ProseMirrorNodeView, EditorView, Decoration } from '@tiptap/pm/view';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { assetMarkdownUrl, assetUrl, decodeStorageKey } from './utils';


// 鈹€鈹€鈹€ FileView (Pure Render) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function removeHardBreaksBeforeFileAttachments(state: any) {
    const deletions: Array<{ from: number; to: number }> = [];

    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name !== 'fileAttachment') return;

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

class FileView implements ProseMirrorNodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement | null = null;
    node: ProseMirrorNode;
    view: EditorView;
    getPos: (() => number) | undefined;
    decorations: readonly Decoration[];
    selected = false;

    constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number, decorations: readonly Decoration[]) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.decorations = decorations;
        this.dom = this.createCard();
        this.contentDOM = null;
    }

    private createCard(): HTMLElement {
        const { url, name, storageMode, storageKey } = this.node.attrs;

        const fileUrl = storageMode === 'attachment' && storageKey
            ? assetUrl(String(storageKey))
            : url ?? '';

        const wrapper = document.createElement('span');
        wrapper.className = 'tiptap-file-attachment';
        wrapper.contentEditable = 'false';
        wrapper.style.whiteSpace = 'nowrap';
        wrapper.style.display = 'inline';
        wrapper.draggable = true;

        const card = document.createElement('span');
        card.className = 'tiptap-file-attachment__card';
        card.setAttribute('data-storage-mode', storageMode ?? '');
        card.setAttribute('data-storage-key', storageKey ?? '');

        const icon = document.createElement('span');
        icon.className = 'tiptap-file-attachment__icon';
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.verticalAlign = 'middle';
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;

        const filenameSpan = document.createElement('span');
        filenameSpan.className = 'tiptap-file-attachment__name';
        filenameSpan.textContent = name ?? '';

        const link = document.createElement('a');
        link.href = fileUrl || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        link.addEventListener('click', (e) => {
            if (!e.metaKey && !e.ctrlKey) e.preventDefault();
        });

        card.appendChild(icon);
        card.appendChild(filenameSpan);
        card.appendChild(link);
        wrapper.appendChild(card);

        card.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.metaKey || e.ctrlKey) {
                window.open(fileUrl, '_blank', 'noopener,noreferrer');
            } else {
                const pos = this.getPos?.();
                if (pos !== undefined) {
                    const selection = NodeSelection.create(this.view.state.doc, pos);
                    this.view.dispatch(this.view.state.tr.setSelection(selection));
                }
            }
        });

        card.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });

        return wrapper;
    }

    private refreshCard(): void {
        const newCard = this.createCard().querySelector('.tiptap-file-attachment__card') as HTMLElement;
        if (!newCard) return;
        const oldCard = this.dom.querySelector('.tiptap-file-attachment__card');
        if (oldCard) this.dom.replaceChild(newCard, oldCard);
        else this.dom.appendChild(newCard);
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type.name !== 'fileAttachment') return false;
        const nameChanged = node.attrs.name !== this.node.attrs.name;
        const urlChanged = node.attrs.url !== this.node.attrs.url;
        this.node = node;
        if (nameChanged || urlChanged) this.refreshCard();
        return true;
    }

    selectNode(): void {
        this.selected = true;
        this.dom.classList.add('is-selected');
    }

    deselectNode(): void {
        this.selected = false;
        this.dom.classList.remove('is-selected');
    }

    deleteNode(): void {
        const { state, dispatch } = this.view;
        const pos = this.getPos?.();
        if (pos === undefined) return;
        const tr = state.tr.delete(pos, pos + this.node.nodeSize);
        dispatch(tr);
    }

    stopEvent(event: Event): boolean {
        const target = event.target as HTMLElement;
        if (!target.closest('.tiptap-file-attachment')) return false;
        if (event.type.startsWith('composition')) return false;
        return true;
    }

    ignoreMutation(_mutation: ViewMutationRecord): boolean {
        return true;
    }
}

// 鈹€鈹€鈹€ FileAttachment Node 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export const FileAttachment = Node.create({
    name: 'fileAttachment',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    
    
    addAttributes() {
        return {
            url:         { default: null },
            name:        { default: null },
            fileName:    { default: null },
            mimeType:    { default: null },
            size:        { default: 0 },
            storageMode: { default: null },
            storageKey:  { default: null },
        };
    },

    parseHTML() {
        return [{
            tag: 'span[data-file-attachment]',
            getAttrs: (element: HTMLElement) => {
                if (!(element instanceof HTMLElement)) return false;
                const rawSize = element.getAttribute('data-size');
                return {
                    url:         element.getAttribute('data-url'),
                    name:        element.getAttribute('data-name'),
                    fileName:    element.getAttribute('data-file-name'),
                    mimeType:    element.getAttribute('data-mime'),
                    size:        rawSize != null ? Number(rawSize) : 0,
                    storageMode: element.getAttribute('data-storage-mode'),
                    storageKey:  element.getAttribute('data-storage-key'),
                };
            },
        }];
    },

    renderHTML({ HTMLAttributes }) {
        const { url, name, storageMode, storageKey, fileName, mimeType, size, ...rest } = HTMLAttributes;
        const fileUrl = storageMode === 'attachment' && storageKey
            ? assetUrl(String(storageKey))
            : url ?? '';
        return [
            'span',
            mergeAttributes(
                {
                    'data-file-attachment': 'true',
                    'data-url': fileUrl ?? '',
                    'data-name': name ?? '',
                    'data-file-name': fileName ?? '',
                    'data-mime': mimeType ?? '',
                    'data-size': size ?? 0,
                    'data-storage-mode': storageMode ?? '',
                    'data-storage-key': storageKey ?? '',
                },
                rest
            ),
            [
                'span',
                { class: 'tiptap-file-attachment__icon', style: 'display:inline-flex;align-items:center;vertical-align:middle' },
                '馃搸'
            ],
            ['span', { class: 'tiptap-file-attachment__name' }, name ?? ''],
        ];
    },

    addNodeView() {
        return (props) => new FileView(
            props.node,
            props.view,
            () => props.getPos?.() ?? 0,
            props.decorations
        );
    },

    onCreate() {
        const tr = removeHardBreaksBeforeFileAttachments(this.editor.state);
        if (tr?.docChanged) {
            this.editor.view.dispatch(tr);
        }
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                appendTransaction: (transactions, _oldState, newState) => {
                    if (!transactions.some(transaction => transaction.docChanged)) return null;
                    return removeHardBreaksBeforeFileAttachments(newState);
                },
            }),
        ];
    },

    addKeyboardShortcuts() {
        return {
            Backspace: () => {
                const { selection } = this.editor.state;
                const { $from } = selection;
                if ($from.nodeBefore?.type.name === 'fileAttachment') {
                    const from = $from.pos - $from.nodeBefore.nodeSize;
                    const to = $from.pos;
                    this.editor.commands.deleteRange({ from, to });
                    return true;
                }
                return false;
            },
            Delete: () => {
                const { selection } = this.editor.state;
                const { $from } = selection;
                if ($from.nodeAfter?.type.name === 'fileAttachment') {
                    const from = $from.pos;
                    const to = $from.pos + $from.nodeAfter.nodeSize;
                    this.editor.commands.deleteRange({ from, to });
                    return true;
                }
                return false;
            },
        };
    },

    markdownTokenizer: {
        name: 'fileAttachment',
        level: 'inline' as const,
        start(src: string) {
            const assetLink = /\[[^\]]*\]\((?:asset:\/\/|https?:\/\/asset\.localhost\/)/.exec(src);
            return assetLink?.index ?? -1;
        },
        tokenize(src: string): any {
            const match = /^\[([^\]]*)\]\((asset:\/\/[^)]*|https?:\/\/asset\.localhost\/[^)]*)\)/.exec(src);
            if (!match) return undefined;
            return { type: 'fileAttachment', raw: match[0], url: match[2], title: match[1] };
        },
    },

    parseMarkdown(token: any) {
        const { url, title } = token;

        return {
            type: 'fileAttachment',
            attrs: {
                url,
                name: title ?? null,
                mimeType: null,
                size: 0,
                storageMode: 'attachment',
                storageKey: decodeStorageKey(url),
            },
        };
    },

    renderMarkdown(node: any) {
        const { storageMode, storageKey, url, name } = node.attrs ?? {};
        const fileUrl = storageMode === 'attachment' && storageKey
            ? assetMarkdownUrl(String(storageKey))
            : url ?? '';
        return `[${name ?? ''}](${fileUrl})`;
    },
});

