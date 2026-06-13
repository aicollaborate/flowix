import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { ImageAttachment } from './node-image';
import { VideoAttachment } from './node-video';
import { FileAttachment } from './node-file';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        attachmentLink: {
            openFileDialog: (params?: { accept?: string; multiple?: boolean }) => ReturnType;
        };
    }
}

// ─── Plugin Key ───────────────────────────────────────────────────────────────

export const fileUploadPluginKey = new PluginKey('tiptap-file-upload');

// ─── Default Options ─────────────────────────────────────────────────────────

const defaultOptions = {
    storage: { mode: 'attachment' as const },
    picker: { accept: undefined as string | undefined, multiple: true },
    ingest: { paste: true, drop: true, allowedMimeTypes: [] as string[], maxFileSize: Infinity },
    onError: undefined,
};

type FileUploadOptions = typeof defaultOptions;

function normalizeOptions(options: Partial<FileUploadOptions> = {}) {
    return {
        storage: { mode: options.storage?.mode ?? 'attachment' },
        ingest: {
            paste: options.ingest?.paste ?? true,
            drop: options.ingest?.drop ?? true,
            allowedMimeTypes: options.ingest?.allowedMimeTypes ?? [],
            maxFileSize: options.ingest?.maxFileSize ?? Infinity,
        },
        onError: options.onError,
    };
}

// ─── File Utilities ───────────

function getFileKind(file: File): 'image' | 'video' | 'file' {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    return 'file';
}

function getFileKindFromName(name: string): 'image' | 'video' | 'file' {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'].includes(ext)) return 'video';
    return 'file';
}

function mimeTypeFromName(name: string): string {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const mimeTypes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        txt: 'text/plain',
        md: 'text/markdown',
        csv: 'text/csv',
        json: 'application/json',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
    };
    return mimeTypes[ext] ?? 'application/octet-stream';
}

function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || '附件';
}

function isTauriApp(): boolean {
    return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

function safeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_');
}

function assetUrl(storageKey: string | null | undefined): string {
    if (!storageKey) return '';
    return convertFileSrc(storageKey);
}

// ─── Filter Functions ────────

function filterFilesByMimeTypes(files: File[], allowedMimeTypes?: string[]): File[] {
    if (!allowedMimeTypes?.length) return files;
    return files.filter((file) => allowedMimeTypes.includes(file.type));
}

function filterIncomingFiles(files: File[], maxFileSize?: number): File[] {
    if (!maxFileSize) return files;
    return files.filter((file) => file.size <= maxFileSize);
}

function hasClipboardHtmlContent(htmlContent: string): boolean {
    return htmlContent.trim().length > 0;
}

// ─── Upload Handler ───────────

export async function createAttachmentUpload(files: File[]): Promise<{ assets: StoredAsset[] }> {
    const assets: StoredAsset[] = [];

    for (const file of files) {
        const kind = getFileKind(file);
        const fileName = safeFileName(file.name);

        const base64Content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                const base64 = result.includes(',') ? result.split(',')[1] : result;
                resolve(base64);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

        let storageKey: string | null = null;
        try {
            storageKey = await invoke<string | null>('save_attachment_content', {
                content: base64Content,
                fileName,
                notebookId: null,
            });
        } catch (err) {
            console.error('[FileUpload] Failed to save attachment:', err);
        }

        const blobUrl = URL.createObjectURL(file);
        assets.push({
            kind,
            url: blobUrl,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            fileName,
            storageMode: 'attachment',
            storageKey,
            revokeObjectURL: true,
        });
    }

    return { assets };
}

async function createAttachmentUploadFromPaths(paths: string[]): Promise<{ assets: StoredAsset[] }> {
    const assets: StoredAsset[] = [];

    for (const path of paths) {
        const name = fileNameFromPath(path);
        const fileName = safeFileName(name);
        let storageKey: string | null = null;

        try {
            storageKey = await invoke<string | null>('save_attachment', {
                sourcePath: path,
                notebookId: null,
            });
        } catch (err) {
            console.error('[FileUpload] Failed to save attachment:', err);
        }

        assets.push({
            kind: getFileKindFromName(name),
            url: storageKey ? assetUrl(storageKey) : '',
            name,
            mimeType: mimeTypeFromName(name),
            size: 0,
            fileName,
            storageMode: 'attachment',
            storageKey,
        });
    }

    return { assets };
}

// ─── Content Builder ───────────────────────────────────────────────────────────

export function buildUploadContent(assets: StoredAsset[]): JSONContent[] {
    return assets.flatMap((asset) => {
        const fileName = asset.fileName ?? asset.name;

        if (asset.kind === 'image') {
            return [{
                type: 'image',
                attrs: {
                    src: assetUrl(asset.storageKey) || asset.url,
                    alt: asset.name,
                    title: asset.name,
                    fileName,
                    mimeType: asset.mimeType,
                    storageMode: asset.storageMode ?? null,
                    storageKey: asset.storageKey ?? null,
                },
            }] as JSONContent[];
        }

        if (asset.kind === 'video') {
            return [{
                type: 'videoAttachment',
                attrs: {
                    src: assetUrl(asset.storageKey) || asset.url,
                    title: asset.name,
                    fileName,
                    mimeType: asset.mimeType,
                    storageMode: asset.storageMode ?? null,
                    storageKey: asset.storageKey ?? null,
                },
            }] as JSONContent[];
        }

        return [{
            type: 'fileAttachment',
            attrs: {
                url: assetUrl(asset.storageKey) || asset.url,
                name: fileName,
                fileName,
                mimeType: asset.mimeType || '',
                size: asset.size ?? 0,
                storageMode: asset.storageMode ?? null,
                storageKey: asset.storageKey ?? null,
            },
        }] as JSONContent[];
    });
}

function normalizeUploadContentForInsert(content: JSONContent[]): JSONContent[] {
    return content;
}

function insertUploadContent(view: EditorView, content: JSONContent[], position?: number) {
    if (content.length === 0) return;

    let tr = view.state.tr;
    let insertPos = position ?? view.state.selection.from;

    content.forEach((node) => {
        const safeInsertPos = Math.min(insertPos, tr.doc.content.size);
        const $insertPos = tr.doc.resolve(safeInsertPos);
        const pmNode = view.state.schema.nodeFromJSON(
            node.type === 'fileAttachment' && !$insertPos.parent.inlineContent
                ? { type: 'paragraph', content: [node] }
                : node
        );

        tr = tr.insert(safeInsertPos, pmNode);
        insertPos = safeInsertPos + pmNode.nodeSize;
    });

    view.dispatch(tr);
}

// ─── ProseMirror Plugin ────────────────────────────────────────────────────────

function createFileUploadPlugin(options: {
    ingest: { drop: boolean; paste: boolean; allowedMimeTypes?: string[] };
}) {
    const { ingest } = options;

    return new Plugin({
        key: fileUploadPluginKey,
        props: {
            handleDrop(view, event) {
                if (view.editable === false) return false;
                if (!ingest.drop) return false;
                const dt = event.dataTransfer;
                if (!dt) return false;
                const files = Array.from(dt.files || []);
                const filteredFiles = filterFilesByMimeTypes(files, ingest.allowedMimeTypes);
                if (filteredFiles.length === 0) return false;
                event.preventDefault();
                event.stopPropagation();
                const coords = { left: event.clientX, top: event.clientY };
                const pos = view.posAtCoords(coords)?.pos;
                handleFileUpload(view, filteredFiles, pos);
                return true;
            },
            handlePaste(view, event) {
                if (view.editable === false) return false;
                if (!ingest.paste) return false;
                const files = filterFilesByMimeTypes(
                    Array.from(event.clipboardData?.files || []),
                    ingest.allowedMimeTypes
                );
                if (files.length === 0) return false;
                const htmlContent = event.clipboardData?.getData('text/html') ?? '';
                if (hasClipboardHtmlContent(htmlContent)) return false;
                event.preventDefault();
                event.stopPropagation();
                const pos = view.state.selection.from;
                handleFileUpload(view, files, pos);
                return true;
            },
        },
    });
}

async function handleFileUpload(view: EditorView, files: File[], position?: number) {
    try {
        const filteredFiles = filterIncomingFiles(files);
        if (filteredFiles.length === 0) return;

        const result = await createAttachmentUpload(filteredFiles);
        const content = normalizeUploadContentForInsert(buildUploadContent(result.assets));

        if (view.isDestroyed) return;
        if (content.length === 0) return;

        insertUploadContent(view, content, position);
    } catch (err) {
        console.error('[FileUpload] Upload failed:', err);
    }
}

export const AttachmentLink = Extension.create<FileUploadOptions>({
    name: 'attachmentLink',

    addOptions() {
        return defaultOptions;
    },

    addProseMirrorPlugins() {
        const opts = normalizeOptions(this.options);
        return [
            createFileUploadPlugin({
                ingest: {
                    drop: opts.ingest.drop,
                    paste: opts.ingest.paste,
                    allowedMimeTypes: opts.ingest.allowedMimeTypes,
                },
            }),
        ];
    },

    addExtensions() {
        return [ImageAttachment, VideoAttachment, FileAttachment];
    },

    addCommands() {
        return {
            openFileDialog:
                (params?: { accept?: string; multiple?: boolean }) =>
                ({ editor }: { editor: Editor }) => {
                    if (!editor.isEditable) return false;

                    if (isTauriApp()) {
                        void (async () => {
                            try {
                                const paths = await invoke<string[] | null>('select_files');
                                if (!paths?.length) return;
                                const result = await createAttachmentUploadFromPaths(paths);
                                const content = normalizeUploadContentForInsert(buildUploadContent(result.assets));
                                if (content.length > 0) {
                                    editor.commands.focus();
                                    insertUploadContent(editor.view, content);
                                }
                            } catch (err) {
                                console.error('[FileUpload] Upload failed:', err);
                            }
                        })();
                        return true;
                    }

                    const input = document.createElement('input');
                    let settled = false;
                    input.type = 'file';
                    input.accept = params?.accept ?? '';
                    input.multiple = params?.multiple ?? true;
                    input.style.position = 'fixed';
                    input.style.left = '-9999px';

                    const cleanup = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(safetyTimer);
                        input.onchange = null;
                        input.oncancel = null;
                        window.removeEventListener('focus', handleWindowFocus, true);
                        input.remove();
                    };

                    const safetyTimer = window.setTimeout(cleanup, 300_000);

                    const handleWindowFocus = () => {
                        window.setTimeout(() => {
                            if (!settled && (input.files?.length ?? 0) === 0) {
                                cleanup();
                            }
                        }, 0);
                    };

                    input.oncancel = cleanup;

                    input.onchange = async () => {
                        try {
                            const files = Array.from(input.files || []);
                            if (files.length > 0) {
                                void handleFileUpload(editor.view, files);
                            }
                        } finally {
                            cleanup();
                        }
                    };

                    document.body.appendChild(input);
                    window.addEventListener('focus', handleWindowFocus, true);
                    input.click();
                    return true;
                },

            insertFiles:
                (params: { files: File[]; position?: number }) =>
                ({ editor }: { editor: Editor }) => {
                    if (!editor.isEditable) return false;
                    void handleFileUpload(editor.view, params.files, params.position);
                    return true;
                },
        } as any;
    },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type StoredAsset = {
    kind: 'image' | 'video' | 'file';
    url: string;
    name: string;
    mimeType: string;
    size: number;
    fileName?: string | null;
    storageMode?: 'attachment';
    storageKey?: string | null;
    revokeObjectURL?: boolean;
};
