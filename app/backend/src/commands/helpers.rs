//! 跨域 helper — 索引同步、notebook 切换、路径 scope、自写抑制、markdown 解析。
//!
//! 拆分前这些 helper 集中在 `commands.rs:28-314`, 现在按职能分到本文件:
//!
//! - **索引**: `current_watcher` / `mark_self_write_for` / `switch_notebook_and_rebuild` /
//!   `force_rebuild_index` / `rebuild_index_in_background` /
//!   `try_index_upsert` / `try_index_remove`
//! - **markdown 解析**: `is_markdown_file_path` / `markdown_paths_from_args` /
//!   `strip_markdown_frontmatter` / `title_from_markdown_content`
//! - **路径 scope**: `is_registered_notebook_path` / `is_markdown_like` /
//!   `can_access_document_path` / `can_access_scoped_file`
//! - **附件**: `sanitize_attachment_file_name` / `unique_attachment_path`
//!
//! `pub(crate)` 可见性: 子模块之间 (memo / file / dialog / ...) 是 sibling,
//! `pub(super)` 只暴露到 `commands` 这一层不够用, 必须 `pub(crate)`。

use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Arc, RwLock};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::fs_watcher::MemoWatcher;
use crate::path_scope::path_is_inside;

use super::AppState;

// ==================== 索引 / 自写抑制 ====================

/// 拿当前进程内注册的 `MemoWatcher` (Tauri managed state)。
/// 测试环境 / 老实例没注册 watcher 时返回 `None` — 此时跳过自写抑制, 不报错。
///
/// 可见性: `pub` (不是 `pub(crate)`) — `fs_watcher.rs` 在 crate 外部模块不能
/// 跟 `pub(crate) fn` 一起 `pub use`, 而 `commands/mod.rs` 里我们 re-export
/// 给 `crate::commands::current_watcher` 这条路径, 必须 `pub`。
pub fn current_watcher(app: &AppHandle) -> Option<Arc<RwLock<MemoWatcher>>> {
    app.try_state::<Arc<RwLock<MemoWatcher>>>()
        .map(|s| s.inner().clone())
}

/// 后端自身写入路径 (UI / Agent / import) 在 emit `memo-event` 之前调用, 把
/// 路径塞 watcher 的抑制集合; 1.5s 内的同路径 notify 回调会吞掉。这是
/// "后端写入 → 自身 watcher 误报" 的关键防护。
pub(crate) fn mark_self_write_for(app: &AppHandle, path: &Path) {
    if let Some(w) = current_watcher(app) {
        if let Ok(g) = w.read() {
            g.mark_self_write(path);
        }
    }
}

/// 切换 `memo_file.current_notebook_id` 并触发后台 `MemoIndex` 重建.
///
/// 调用约定: 显式 user-facing 的 `set_current_notebook` / `create_notebook`
/// 走这个助手. 其他命令 (get_memos / add_document / save_attachment 等) 仍按
/// 原样 `set_current_notebook(...)` 切上下文, 索引由 user 后续手动切 notebook
/// 时 rebuild — 写入路径通过 `try_index_upsert/remove` 维护当前 notebook 索引.
///
/// 幂等守卫: 如果 notebook 实际未变且索引已加载, 直接 return.
/// 否则标记索引为 unloaded, 用 `std::thread::spawn` 在后台线程 rebuild.
///
/// 索引 rebuild 期间 (几百 ms) `MemoIndex::is_loaded() == false`,
/// `search()` 返回空, `try_index_upsert/remove` 也会跳过 — 这是为不阻塞主线程
/// 的一致性取舍, 见 `search.rs` 模块顶部注释.
pub(crate) fn switch_notebook_and_rebuild(
    state: &AppState,
    app: &AppHandle,
    notebook_id: Option<String>,
) {
    let prev = state.memo_file.read().unwrap().current_notebook_id_value();
    let idx_nb = state
        .search
        .read()
        .unwrap()
        .current_notebook()
        .map(str::to_string);
    let idx_loaded = state.search.read().unwrap().is_loaded();

    if prev == notebook_id && idx_nb == notebook_id && idx_loaded {
        return;
    }

    // 同步更新 MemoFile 上的 current_notebook_id.
    state
        .memo_file
        .write()
        .unwrap()
        .set_current_notebook(notebook_id);

    // 切 notebook 时同步 rebind 文件监听器到新目录, 否则旧目录的 .md 改动
    // 会被错误地"当成"新 notebook 的更新。旧 watcher 在 MemoWatcher::rebind
    // 入口处 _watcher.take() 显式 Drop, 不并发。
    if let Some(watcher) = current_watcher(app) {
        let new_dir = state.memo_file.read().unwrap().get_memo_base();
        if let Ok(mut g) = watcher.write() {
            g.rebind(app.clone(), Some(new_dir));
        }
    }

    // 跟磁盘对账: 应用关闭期间用户在外部新建的 .md 文件, 重启后 list.json
    // 没记录, watcher 也帮不上忙 (notify 不回放历史事件)。这一步把 list.json
    // 缺的条目补上, 写回 list.json, 后续 `read_memos` 自然能拿到。
    // 幂等: 已经在 list.json 里的 .md 会被跳过, 多次调用零成本。
    if let Err(e) = state.memo_file.read().unwrap().reconcile_with_disk() {
        tracing::warn!("[switch_notebook_and_rebuild] reconcile_with_disk failed: {e}");
    }

    // 标记索引未加载; rebuild 在后台线程.
    rebuild_index_in_background(state, app);
}

/// 强制重建当前 notebook 的索引 (不切 notebook). 用于 `clear_memos` 等大量写入
/// 之后索引明显过期的场景.
pub(crate) fn force_rebuild_index(state: &AppState, app: &AppHandle) {
    state.search.write().unwrap().mark_unloaded();
    rebuild_index_in_background(state, app);
}

pub(crate) fn rebuild_index_in_background(state: &AppState, app: &AppHandle) {
    let app = app.clone();
    let nb = state
        .memo_file
        .read()
        .unwrap()
        .current_notebook_id_value()
        .unwrap_or_default();
    // 走 std::thread 而非 tokio::task::spawn_blocking: 调用方多为同步 Tauri 命令
    // (get_memos / select_notebook / search_memos / clear_memos), 跑在 Tauri 的
    // blocking 线程池里, 没有 Tokio reactor handle, 直接用 tokio runtime 会 panic
    // ("there is no reactor running"). 这里只做磁盘读 + 内存索引重建 + emit 事件,
    // 不需要 Tokio 调度, std::thread 语义更直接.
    std::thread::spawn(move || {
        let st: tauri::State<AppState> = app.state();
        let items = st.memo_file.read().unwrap().read_all_memos_with_body();
        st.search.write().unwrap().rebuild(nb, items);
        let _ = app.emit("search-index-ready", ());
    });
}

/// 单条 memo upsert 到索引. 索引未加载 (启动早期 / rebuild 中) 时静默跳过 —
/// rebuild 完成后会从磁盘读到最新内容, 这次 upsert 的修改被自然捕获.
pub(crate) fn try_index_upsert(state: &AppState, id: &str) {
    let Some((entry, full_md)) = state.memo_file.read().unwrap().read_memo_with_body(id) else {
        return;
    };
    let mut idx = state.search.write().unwrap();
    if !idx.is_loaded() {
        return;
    }
    idx.upsert(entry, &full_md);
}

/// 单条 memo 从索引删除. 索引未加载时静默跳过.
pub(crate) fn try_index_remove(state: &AppState, id: &str) {
    let mut idx = state.search.write().unwrap();
    if !idx.is_loaded() {
        return;
    }
    idx.remove(id);
}

// ==================== markdown 解析 ====================

pub(crate) fn is_markdown_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
        && path.is_file()
}

pub fn markdown_paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter_map(|arg| {
            let path = Path::new(&arg);
            if is_markdown_file_path(path) {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

pub(crate) fn strip_markdown_frontmatter(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("---") else {
        return content;
    };
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'));
    let Some(rest) = rest else {
        return content;
    };

    if let Some(index) = rest.find("\r\n---\r\n") {
        return &rest[index + "\r\n---\r\n".len()..];
    }
    if let Some(index) = rest.find("\n---\n") {
        return &rest[index + "\n---\n".len()..];
    }

    content
}

pub(crate) fn title_from_markdown_content(content: &str, fallback: &str) -> String {
    strip_markdown_frontmatter(content)
        .lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .map(|line| {
            line.trim_start_matches('#')
                .trim()
                .trim_matches(|c| matches!(c, '*' | '_' | '`'))
                .trim()
                .to_string()
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

// ==================== 附件 ====================
//
// `sanitize_attachment_file_name` / `unique_attachment_path` 只在 `dialog.rs` 域内
// 使用, 域内 helper, 跟 dialog.rs 放一起。helpers.rs 不留 mirror。

// ==================== 路径 scope ====================

pub(crate) fn is_registered_notebook_path(path: &Path, state: &State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    memo_file
        .registered_notebook_paths()
        .iter()
        .any(|root| path_is_inside(path, root))
}

fn is_markdown_like(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

pub(crate) fn can_access_document_path(path: &Path, state: &State<AppState>) -> bool {
    is_registered_notebook_path(path, state) || is_markdown_like(path)
}

pub(crate) fn can_access_scoped_file(
    file_path: &Path,
    space_path: Option<&str>,
    state: &State<AppState>,
) -> bool {
    let Some(space_path) = space_path else {
        return false;
    };
    let root = Path::new(space_path);
    is_registered_notebook_path(root, state) && path_is_inside(file_path, root)
}
