//! `MemoEventProcessor` — 把 `RawFsEvent` 转成 `MemoEvent` 并 emit。
//!
//! PR3 业务下沉: fs_watcher.rs 不再直接调 `MemoFile` 的 register / reload /
//! unregister, 统一委派给本模块。pipeline 跑过之后, 把 `RawFsEvent` 喂给
//! `MemoEventProcessor::process`, 它看 event.kind 分派, 走 register_unnamed /
//! reload / unregister, 最后 emit `MemoEvent` (走 dispatcher 抽象, 多 channel
//! 后续在这里 extend)。
//!
//! `process` 是同步的, 跟 fs_watcher 现在的风格一致: 拿到事件 → 同步改
//! `MemoFile` (Arc<RwLock>) → 同步 emit → 返回。notify 回调线程不 await。

use std::path::Path;
use std::sync::Arc;

use tauri::AppHandle;

use crate::memo_events::{emit, MemoChangeSource, MemoEvent};
use crate::watcher::event::{FsEventKind, RawFsEvent};
use flowix_core::memo_file::MemoFile;

/// 业务处理器 — 状态由调用方注入 (memo_file / app / watcher)。
///
/// 故意不做成 struct 持字段, 而是 stateless: `process` 接收所有依赖。原因:
/// fs_watcher.rs 的 notify 回调闭包已经是 `move |res| { ... }`, 闭包捕获
/// Arc<MemoFile> / AppHandle / Arc<MemoWatcher> 引用, 不需要 processor 内部
/// 再持一份。
pub struct MemoEventProcessor;

impl MemoEventProcessor {
    /// 入口 — pipeline 跑过之后调用, 事件已通过 4 段 filter。
    ///
    /// 行为跟原 fs_watcher.rs 内联业务完全一致:
    /// - Create/Modify: 文件存在 → reload 或 register; 不存在 → unregister
    /// - Remove:        unregister
    /// - Other:         忽略
    pub fn process(
        event: &RawFsEvent,
        app: &AppHandle,
        memo_file: &Arc<std::sync::RwLock<MemoFile>>,
    ) {
        match event.kind {
            FsEventKind::Create | FsEventKind::Modify => {
                let path = &event.path;
                if !path.exists() {
                    // Modify 事件但文件没了 — 走 Delete 路径
                    Self::unregister_and_emit(app, memo_file, path);
                    return;
                }
                if let Some(id) =
                    MemoFile::extract_memo_id_from_abs_path(path)
                {
                    // 文件名匹配 `{title}#xxxxxx.md` 约定 — 已有 memo。
                    // id 二级兜底已由 pipeline 跑过, 直接进入 reload / register。
                    if let Some(updated) = memo_file
                        .read()
                        .ok()
                        .and_then(|mf| mf.reload_memo_from_disk(&id).ok())
                    {
                        // emit path 用 `updated.path` (list.json 权威值), 不能
                        // 用 watcher 收到事件时的原始 `path`。理由详见 fs_watcher
                        // 原注释 (title 变化触发 fs::rename, 旧 path 会读到 no
                        // such file)。
                        let entry_path = match updated.path.as_deref() {
                            Some(filename) => memo_file
                                .read()
                                .ok()
                                .map(|mf| mf.get_memo_base().join(filename))
                                .unwrap_or_else(|| path.clone())
                                .display()
                                .to_string(),
                            None => path.display().to_string(),
                        };
                        emit(
                            app,
                            MemoEvent::Updated {
                                id: updated.id.clone(),
                                path: entry_path,
                                source: MemoChangeSource::ExternalTool,
                            },
                        );
                    } else {
                        // list.json 还没注册, 外部直接 create 的新 .md —
                        // register_existing_file 路径
                        if let Ok(mf) = memo_file.read() {
                            if let Ok(memo) = mf.register_existing_file(path) {
                                emit(
                                    app,
                                    MemoEvent::Created {
                                        memo,
                                        source: MemoChangeSource::ExternalTool,
                                    },
                                );
                            }
                        }
                    }
                } else {
                    // 文件名不含 `#xxxxxx` 后缀 — 外部直接 create 的任意命名
                    // .md。`register_unnamed_file` 内部生成 id, 重命名磁盘
                    // 文件, 写 list.json。返回 (memo, new_abs_path)。
                    // caller 用 new_abs_path mark self-write, 抑制对新路径的
                    // Create/Modify 事件, 避免重复 reload 闪烁。
                    if let Ok(mf) = memo_file.read() {
                        match mf.register_unnamed_file(path) {
                            Ok((memo, new_abs_path)) => {
                                tracing::info!(
                                    "[MemoWatcher] registered unnamed: {} -> {}",
                                    path.display(),
                                    new_abs_path.display()
                                );
                                if let Some(w) = crate::commands::current_watcher(app) {
                                    if let Ok(g) = w.read() {
                                        g.mark_self_write(&new_abs_path);
                                    }
                                }
                                emit(
                                    app,
                                    MemoEvent::Created {
                                        memo,
                                        source: MemoChangeSource::ExternalTool,
                                    },
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "[MemoWatcher] register_unnamed_file failed for {}: {e}",
                                    path.display()
                                );
                            }
                        }
                    }
                }
            }
            FsEventKind::Remove => {
                Self::unregister_and_emit(app, memo_file, &event.path);
            }
            FsEventKind::Other => {
                // Access / Other — 忽略
            }
        }
    }

    fn unregister_and_emit(
        app: &AppHandle,
        memo_file: &Arc<std::sync::RwLock<MemoFile>>,
        path: &Path,
    ) {
        let Ok(mf) = memo_file.read() else {
            return;
        };
        // 先拿路径里的 id (有 `#xxxxxx` 后缀时), 不取 list.json 读,
        // 避免额外加锁 / 与 unregister 之间的 race。路径解析
        // 是纯函数, 不动 MemoFile 状态。
        let id = MemoFile::extract_memo_id_from_abs_path(path)
            .unwrap_or_default();
        if !mf.unregister_memo_by_path(path) {
            return;
        }
        let entry_path = path.display().to_string();
        // emit 带真实 id 的 Deleted, 让前端 handleMemoDeleted 能精准从
        // 列表 filter 掉 (避免 id=“” 时 filter 什么都不丢、只能靠
        // triggerRefresh 重拉补救)。 path 依然传出, 供会话点以 path 匹配。
        emit(
            app,
            MemoEvent::Deleted {
                id,
                path: entry_path,
            },
        );
    }
}
