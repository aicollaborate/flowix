// 物理路径粘贴 → noteReference 卡片。
//
// 用户从 Finder / 终端复制一份 `~/Documents/flowix/<notebook>/<title>#<id>.md`
// 这种笔记本内的绝对路径粘贴到编辑器, 这里负责:
//   1. 解析路径文件名末尾的 6 字符 memo id (跟后端
//      `extract_memo_id_from_abs_path` 同形, 见 backend/src/memo_file/registration.rs)
//   2. 按 notebook.path 做前缀比对, 命中后给出 attrs 让上游构造 noteReference 节点
//
// 设计要点:
// - **不允许子目录**: 文件必须直接在 notebook 根目录下 (`path === notebook.path + filename`),
//   跟后端 `reconcile_with_disk` 只扫根目录的行为对齐, 避免出现根本不会被索引的引用。
// - **前缀按长度倒序比**: 防止 `/a/b/c-notebook/` 把更短的 `/a/b/` notebook 误命中。
// - **notebook 列表用模块级缓存**: 粘贴属于高频键盘事件, 不能每次走 IPC。
//   App.tsx 启动时 `prewarmNotebookCache()`, notebook 变更时 `invalidateNotebookCache()`。
//   冷启动未到位时返回 null, 走普通文本路径 — 不阻塞粘贴。

import { notebooks } from '../../../../lib/tauri/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotebookLite {
  id: string;
  name: string;
  path: string;
}

export interface NoteReferenceAttrs {
  docId: string;
  notebookId: string;
  notebookName: string;
  title: string;
  originalPath: string;
  /** 渲染态标记 — 不写入 markdown */
  stale: boolean;
}

// ─── Notebook cache ───────────────────────────────────────────────────────────

let cached: NotebookLite[] | null = null;
let cachePromise: Promise<NotebookLite[]> | null = null;

function fetchNotebooks(): Promise<NotebookLite[]> {
  return notebooks.getAll().then((list) => {
    const arr = Array.isArray(list) ? list : [];
    return arr
      .map((n: any) => ({
        id: String(n?.id ?? ''),
        name: String(n?.name ?? ''),
        path: String(n?.path ?? ''),
      }))
      .filter((n) => n.id && n.path);
  });
}

/**
 * App.tsx 顶层调用 — 让 notebook 列表在首帧后就常驻内存, 避免用户首次粘贴
 * 物理路径时缓存为空导致 miss。失败时静默, 下次粘贴会再尝试拉取。
 */
export function prewarmNotebookCache(): Promise<void> {
  if (cached) return Promise.resolve();
  if (!cachePromise) {
    cachePromise = fetchNotebooks().then((list) => {
      cached = list;
      return list;
    }).catch((err) => {
      // 拉取失败让下次 prewarm/match 再试
      // eslint-disable-next-line no-console
      console.warn('[note-reference] prewarmNotebookCache failed:', err);
      cachePromise = null;
      return [];
    });
  }
  return cachePromise.then(() => undefined);
}

/**
 * notebook 增删改时调 — 把缓存清掉, 下次粘贴会触发重新拉取。
 * 上游可挂在 `agent-access-changed` 事件 (notebook CRUD 时会 emit)。
 */
export function invalidateNotebookCache(): void {
  cached = null;
  cachePromise = null;
}

// ─── Path normalization ───────────────────────────────────────────────────────

/**
 * 把粘贴板的"路径串"洗成纯绝对路径:
 *   - 去首尾空格
 *   - 去包裹的单/双引号
 *   - 解 `file://` 前缀 + percent-decode
 *   - 拒绝含换行 (多行剪贴板交还给 Tiptap 默认处理)
 */
function normalizePath(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (/[\r\n]/.test(s)) return null;

  // 去首尾包裹引号 (Finder "复制路径" 偶尔加引号; 终端粘贴常见)
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // file:// 前缀 — 解 percent-encoding 后还原成绝对路径
  if (/^file:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      // url.pathname 已经 percent-decode 不彻底, 用 decodeURIComponent 兜底
      s = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }

  // 必须是绝对路径 (mac/linux 起 '/'; windows 留作未来扩展)
  if (!s.startsWith('/')) return null;
  return s;
}

// ─── Filename parsing (mirrors backend extract_memo_id_from_abs_path) ────────

const MEMO_ID_RE = /^[0-9a-z]{6}$/;

interface ParsedFilename {
  title: string;
  docId: string;
}

function parseMemoFilename(filename: string): ParsedFilename | null {
  // 必须 .md 结尾 (大小写不敏感, 与后端一致)
  if (!/\.md$/i.test(filename)) return null;
  const stem = filename.slice(0, -3);

  // 末尾 `#<6-char id>` — 用 lastIndexOf 防止 title 自身含 '#'
  const hash = stem.lastIndexOf('#');
  if (hash < 0) return null;
  const docId = stem.slice(hash + 1);
  if (!MEMO_ID_RE.test(docId)) return null;

  const title = stem.slice(0, hash);
  if (!title) return null;

  return { title, docId };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * 尝试把一段粘贴文本解析成 noteReference attrs。
 *
 * 返回 null 的场景一律由 caller 走 fallthrough (普通文本 / markdown 解析):
 *   - 文本不像绝对路径
 *   - 文件名不符合 `{title}#{6-char-id}.md` 命名
 *   - 没有任何 notebook 前缀命中
 *   - notebook 缓存为空 (冷启动还没拉到)
 *
 * 不做异步 IPC — 整个判定走同步路径, 让 `MarkdownPaste.handlePaste` 能立刻决断。
 */
export function tryMatchPhysicalMemoPath(raw: string): NoteReferenceAttrs | null {
  if (!cached || cached.length === 0) return null;

  const path = normalizePath(raw);
  if (!path) return null;

  const slash = path.lastIndexOf('/');
  if (slash < 0) return null;
  const filename = path.slice(slash + 1);
  const parsed = parseMemoFilename(filename);
  if (!parsed) return null;

  // 按 path 长度倒序, 优先匹配最长前缀
  const sorted = [...cached].sort((a, b) => b.path.length - a.path.length);
  for (const nb of sorted) {
    if (!nb.path) continue;
    if (!path.startsWith(nb.path)) continue;
    const remainder = path.slice(nb.path.length);
    // remainder 必须就是 filename (不含子目录), 与后端 reconcile 只扫根目录的行为一致
    if (remainder !== filename) continue;

    return {
      docId: parsed.docId,
      notebookId: nb.id,
      notebookName: nb.name,
      title: parsed.title,
      originalPath: path,
      stale: false,
    };
  }
  return null;
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

/** 仅供单测用 — 直接喂 notebook 列表绕过 IPC */
export function __setCacheForTests(list: NotebookLite[] | null): void {
  cached = list;
  cachePromise = list ? Promise.resolve(list) : null;
}
