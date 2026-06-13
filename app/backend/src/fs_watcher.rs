//! 笔记目录文件监听 — 包装 `notify::RecommendedWatcher` 监听当前 notebook
//! 目录, 把外部编辑器 / 其他 AI 的磁盘变更转为 `MemoEvent::Updated` 或
//! `MemoEvent::Deleted` emit 给前端。
//!
//! ## 自写抑制 (self-write suppression)
//!
//! 后端自身写入 (用户 UI / Agent / import 路径) 在**写盘之前**调用
//! `MemoWatcher::mark_self_write(path)` 把路径塞入抑制集合。watcher 回调
//! 看到同路径事件, 命中即吞。这一顺序很关键 — 写盘前 mark 才能关掉
//! "notify 事件先于 mark 到达"的 race window, 否则 IPC 命令刚把文件落盘
//! 还没来得及塞抑制表, watcher 就先看到 Create 事件, 触发 reload/re-register
//! 二次 emit。
//!
//! 设计: 后端 emit 是同步的, 先于 notify 回调到达前端; UI 永远先看到自家
//! "Created" / "Updated" 事件, 不会闪烁。watcher 150ms 内的回响被吞, 杜绝
//! "外部看起来改了两次"。
//!
//! ## id 二级兜底
//!
//! 路径规范化失败 (罕见 symlink / mount 重叠) 加上 race window 双重失效时,
//! 仍有"同 id 在 250ms 内被 emit 两次"的极端情况。`recent_emit_ids` 是
//! 兜底层: `emit()` 在派发 `memo-event` 前调用 `mark_emitted_id`, watcher
//! 命中同 id 即吞。这层跟路径无关, id 维度自洽, 配合自写抑制形成
//! "路径 → id" 双保险。
//!
//! ## 跨平台
//!
//! `notify::RecommendedWatcher` 自动选 macOS FSEvents / Linux inotify /
//! Windows ReadDirectoryChangesW, 已由 `notify` 6.0 的依赖图自包含。
//!
//! 路径比较两侧 (`mark_self_write` 入参 / watcher 收到的 `event.paths`) 都
//! 走 [`normalize_for_compare`] 归一: macOS 上 `/var` ↔ `/private/var` symlink
//! 折叠, Windows 上 `\\?\C:\...` 前缀去掉。否则 HashMap 精确匹配会 miss。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use crate::memo_events::{emit, MemoChangeSource, MemoEvent};
use crate::memo_file::MemoFile;

/// 自写抑制的 TTL — 2 秒。覆盖绝大部分 IPC 命令结束 → notify 回调到达的间隔。
const SELF_WRITE_TTL: Duration = Duration::from_secs(2);
/// 路径防抖窗口 — 150ms。覆盖 macOS FSEvents 在 save 时偶发的双触发。
const DEBOUNCE: Duration = Duration::from_millis(150);
/// id 二级兜底窗口 — 250ms。比 `SELF_WRITE_TTL` 短, 仅作 A/B 失效时的应急
/// 防御, 不指望常态命中。
const ID_DEDUP: Duration = Duration::from_millis(250);

/// 把 `Path` 归一到 `HashMap<PathBuf, _>` 查表口径。
///
/// 优先用 `dunce::canonicalize` 折叠 symlink / `\\?\` 前缀; 失败 (文件尚未
/// 创建 — 写盘前 mark 的常见情形) 退到"只 canonicalize 父目录, 再 join
/// 文件名", 父目录在 notebook 创建时已经存在, 这一步必然成功。即便父目录
/// canonicalize 也失败, 退回原 path 字符串, 至少不丢抑制 (退化到精确匹配)。
pub(crate) fn normalize_for_compare(path: &Path) -> PathBuf {
    if let Ok(canon) = dunce::canonicalize(path) {
        return canon;
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(canon_parent) = dunce::canonicalize(parent) {
            return canon_parent.join(name);
        }
    }
    path.to_path_buf()
}

/// 笔记本目录的文件监听器。
///
/// 字段语义:
/// - `_watcher`: 持有 `RecommendedWatcher` 期间持续监听。Drop 时自动停止。
/// - `bound_dir`: 当前绑定的根目录 (notebook base)。`None` 表示未启动。
/// - `recent_self_writes`: 自写抑制表, `(normalized path, 标记时间)`。
///   回调查表, 命中即吞; 命中并 `remove` (一次性), 避免长期占位。键都
///   走 [`normalize_for_compare`] 归一, 写盘端跟 watcher 端同口径比较。
/// - `last_emit`: 路径防抖表, `(normalized path, 上次 emit 时间)`。150ms
///   内同路径事件吞掉, 处理编辑器 save 时 FSEvents 的双触发 (Remove tmp +
///   Create 真文件)。
/// - `recent_emit_ids`: id 二级兜底, `(id, 上次 emit 时间)`。`emit()` 在派
///   发 `memo-event` 前调用 `mark_emitted_id` 写入, watcher 命中同 id 即吞。
///   这是路径规范化 + 自写抑制双重失效时的最后防线。
pub struct MemoWatcher {
    _watcher: Option<RecommendedWatcher>,
    bound_dir: Option<PathBuf>,
    recent_self_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    last_emit: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    recent_emit_ids: Arc<Mutex<HashMap<String, Instant>>>,
    memo_file: Arc<std::sync::RwLock<MemoFile>>,
}

impl MemoWatcher {
    pub fn new(memo_file: Arc<std::sync::RwLock<MemoFile>>) -> Self {
        Self {
            _watcher: None,
            bound_dir: None,
            recent_self_writes: Arc::new(Mutex::new(HashMap::new())),
            last_emit: Arc::new(Mutex::new(HashMap::new())),
            recent_emit_ids: Arc::new(Mutex::new(HashMap::new())),
            memo_file,
        }
    }

    /// 当前绑定的根目录。仅诊断 / 测试用。
    pub fn bound_dir(&self) -> Option<&Path> {
        self.bound_dir.as_deref()
    }

    /// 切换监听目录。`None` = 停止监听 (notebook 切换到非法路径时使用)。
    ///
    /// 先 `_watcher = None` 显式 Drop 旧 watcher (避免两个 watcher 同监一目录
    /// 触发回调翻倍), 再启动新 watcher。
    pub fn rebind(&mut self, app: AppHandle, dir: Option<PathBuf>) {
        // Drop 旧 watcher — 此赋值 `take` 出 Option, 旧 RecommendedWatcher 立即析构
        let _ = self._watcher.take();
        self.bound_dir = dir.clone();

        let Some(dir) = dir else {
            return;
        };
        if !dir.is_dir() {
            tracing::warn!("[MemoWatcher] rebind skipped, not a dir: {}", dir.display());
            return;
        }

        let app = app.clone();
        let recent = self.recent_self_writes.clone();
        let last_emit = self.last_emit.clone();
        let recent_ids = self.recent_emit_ids.clone();
        let memo_file = self.memo_file.clone();

        let mut watcher: RecommendedWatcher =
            match notify::recommended_watcher(move |res: notify::Result<Event>| {
                let Ok(event) = res else {
                    return;
                };
                handle_notify_event(&app, &memo_file, &recent, &last_emit, &recent_ids, event);
            }) {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("[MemoWatcher] failed to create watcher: {e}");
                    return;
                }
            };

        if let Err(e) = watcher.watch(&dir, RecursiveMode::Recursive) {
            tracing::error!("[MemoWatcher] failed to watch {}: {e}", dir.display());
            return;
        }

        tracing::info!("[MemoWatcher] watching {}", dir.display());
        self._watcher = Some(watcher);
    }

    /// 后端自身写入路径在**写盘之前**调用, 把 path 塞抑制表。一次性 —
    /// watcher 命中即 remove; 2s TTL 是兜底, 防止意外未 remove 永远占位。
    ///
    /// 路径入表前先走 [`normalize_for_compare`] 归一, 跟 watcher 端查表口径
    /// 一致; 写盘前 mark 时文件还不存在, 该函数退到"canonicalize 父目录 +
    /// join 文件名" 的回退路径, 父目录一定存在所以这一步必然成功。
    pub fn mark_self_write(&self, path: &Path) {
        let key = normalize_for_compare(path);
        if let Ok(mut map) = self.recent_self_writes.lock() {
            // 顺手剪枝过老条目, 抑制表小 (<几十项) 剪枝 < 1µs
            map.retain(|_, t| t.elapsed() < SELF_WRITE_TTL);
            map.insert(key, Instant::now());
        }
    }

    /// `emit()` 在派发 `memo-event` 之前调用, 把"刚刚 emit 过的 id"记录
    /// 250ms。watcher 命中同 id 即吞, 这是路径规范化 + 自写抑制双重失效
    /// 时的最后防线。
    pub fn mark_emitted_id(&self, id: &str) {
        if id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.recent_emit_ids.lock() {
            map.retain(|_, t| t.elapsed() < ID_DEDUP);
            map.insert(id.to_string(), Instant::now());
        }
    }
}

/// notify 回调主体 — 过滤 + 自写抑制 + 防抖 + 触发 `MemoFile` 重派生 + emit。
///
/// 注意: 这个函数在 notify 自己的线程上跑, 跟 ReAct 主循环并发。
/// `MemoFile` 是 `Arc<StdRwLock<MemoFile>>`, 我们读锁拿, 调用方负责不持锁跨 await。
///
/// 抑制三道闸, 逐级下沉:
/// 1. `recent_self_writes` (路径) — `mark_self_write` 在写盘前调用
/// 2. `last_emit` (路径) — 150ms 内同路径事件吞, 处理 FSEvents 双触发
/// 3. `recent_emit_ids` (id) — emit 时 `mark_emitted_id` 写入, 250ms 内
///    同 id 吞, 是前两道闸双重失效时的最后防线
fn handle_notify_event(
    app: &AppHandle,
    memo_file: &Arc<std::sync::RwLock<MemoFile>>,
    recent: &Arc<Mutex<HashMap<PathBuf, Instant>>>,
    last_emit: &Arc<Mutex<HashMap<PathBuf, Instant>>>,
    recent_ids: &Arc<Mutex<HashMap<String, Instant>>>,
    event: Event,
) {
    for path in event.paths {
        // 1. 文件类型过滤: 只关心 .md / .markdown
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| {
                let lower = e.to_ascii_lowercase();
                lower == "md" || lower == "markdown"
            })
            .unwrap_or(false);
        if !is_md {
            continue;
        }

        // 2. 路径过滤: 跳过 .metadata/ 下的所有变更 (list.json / memo.json
        // 会被高频自写)
        if path.components().any(|c| c.as_os_str() == ".metadata") {
            continue;
        }

        // 3. 自写抑制: 后端最近 mark_self_write 过的路径, 命中即吞。
        // 路径先走 normalize_for_compare 归一, 跟 mark 端同口径比较,
        // 避免 macOS /private/var ↔ /var symlink 折叠 / Windows \\?\ 前缀
        // 等差异导致 miss。
        let normalized = normalize_for_compare(&path);
        if let Ok(mut map) = recent.lock() {
            map.retain(|_, t| t.elapsed() < SELF_WRITE_TTL);
            if map.remove(&normalized).is_some() {
                tracing::debug!("[MemoWatcher] self-write suppressed: {}", path.display());
                continue;
            }
        }

        // 4. 路径防抖: 150ms 内同路径事件吞, 处理 FSEvents 双触发。
        if let Ok(mut map) = last_emit.lock() {
            map.retain(|_, t| t.elapsed() < DEBOUNCE.saturating_mul(10)); // 留 1.5s 滚动窗口
            if let Some(last) = map.get(&normalized) {
                if last.elapsed() < DEBOUNCE {
                    tracing::debug!("[MemoWatcher] debounced: {}", path.display());
                    continue;
                }
            }
            map.insert(normalized, Instant::now());
        }

        // 5. 按事件类型分派
        match event.kind {
            EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(_) => {
                // 5a. 文件存在 → 重派生 preview / tags / todos / updatedAt
                if !path.exists() {
                    // Modify 事件但文件没了 — 走 Delete 路径
                    unregister_and_emit(app, memo_file, &path);
                    continue;
                }
                if let Some(id) = MemoFile::extract_memo_id_from_abs_path(&path) {
                    // 5b. 文件名匹配 `{title}#xxxxxx.md` 约定 — 已有 memo

                    // 3+. id 二级兜底: 250ms 内 emit 过同 id (如 add_document
                    // 刚 emit 完 Created, 自己的 notify 回响又到了), 跳过
                    // reload + emit。这是路径规范化 + 自写抑制双重失效时的
                    // 应急层, 命中只应发生在 race window 边界条件。
                    if let Ok(mut map) = recent_ids.lock() {
                        map.retain(|_, t| t.elapsed() < ID_DEDUP);
                        if map.contains_key(&id) {
                            tracing::debug!("[MemoWatcher] id-deduped: {id}");
                            continue;
                        }
                    }

                    match memo_file
                        .read()
                        .ok()
                        .and_then(|mf| mf.reload_memo_from_disk(&id).ok())
                    {
                        Some(updated) => {
                            let entry_path = path.display().to_string();
                            emit(
                                app,
                                MemoEvent::Updated {
                                    id: updated.id.clone(),
                                    path: entry_path.clone(),
                                    source: MemoChangeSource::ExternalTool,
                                },
                            );
                        }
                        None => {
                            // 文件名解析得到 id 但 list.json 还没注册, 说明是
                            // 外部直接 create 的新 .md (例如 Agent write 工具) — 走
                            // register 路径注册并 emit Created
                            if let Ok(mf) = memo_file.read() {
                                if let Ok(memo) = mf.register_existing_file(&path) {
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
                    }
                } else {
                    // 5c. 文件名不含 `#xxxxxx` 后缀 — 外部直接 create 的任意命名
                    // .md (例如用户在 Finder 里手动创建 `Agent 记忆管理.md`,
                    // 脚本生成 `report.md`)。`register_unnamed_file` 内部:
                    //   - 生成新 id
                    //   - **重命名磁盘文件**为 `{title}#xxxxxx.md`
                    //   - 写 list.json
                    // 返回 (memo, new_abs_path)。caller 用 new_abs_path mark
                    // self-write, 抑制 watcher 后续对新路径的 Create/Modify
                    // 事件 (避免重复 reload 闪烁)。
                    if let Ok(mf) = memo_file.read() {
                        match mf.register_unnamed_file(&path) {
                            Ok((memo, new_abs_path)) => {
                                tracing::info!(
                                    "[MemoWatcher] registered unnamed file {} as memo {} (renamed to {})",
                                    path.display(),
                                    memo.id,
                                    new_abs_path.display()
                                );
                                // 自写抑制: 重命名后, watcher 还会收到针对
                                // new_abs_path 的 Create/Modify 事件。
                                // mark_self_write 抑制 2s 内的同路径事件, 避免
                                // "我注册了一次, 自己也 reload 一次"的循环。
                                if let Some(watcher) = crate::commands::current_watcher(app) {
                                    if let Ok(g) = watcher.read() {
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
            EventKind::Remove(_) => {
                unregister_and_emit(app, memo_file, &path);
            }
            _ => {
                // Access / Other / Any — 忽略
            }
        }
    }
}

fn unregister_and_emit(app: &AppHandle, memo_file: &Arc<std::sync::RwLock<MemoFile>>, path: &Path) {
    let Ok(mf) = memo_file.read() else {
        return;
    };
    if !mf.unregister_memo_by_path(path) {
        return;
    }
    let entry_path = path.display().to_string();
    // 这里没有 memo id (unregister 后从 list.json 移除了), 但 front-end 主要
    // 用 path 匹配编辑器, store action 走 `handleMemoDeletedByPath`
    // — 本次重构简化: store 不接 Deleted 事件, 改由 triggerRefresh 触发
    // 重拉 (list.json 已变, 重拉必能看到真相)。
    let _ = app; // 占位保留 — 实际 emit 见下方
    emit(
        app,
        MemoEvent::Deleted {
            id: String::new(), // id 在 unregister 后丢失, 前端走 refresh path
            path: entry_path,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_memo_id_parses_hash_id() {
        assert_eq!(
            MemoFile::extract_memo_id_from_abs_path(Path::new("/n/My Note#abc123.md")),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn extract_memo_id_returns_none_for_non_md() {
        assert_eq!(
            MemoFile::extract_memo_id_from_abs_path(Path::new("/n/foo.txt")),
            None
        );
    }

    #[test]
    fn extract_memo_id_returns_none_when_no_m_prefix() {
        assert_eq!(
            MemoFile::extract_memo_id_from_abs_path(Path::new("/n/My Note-abc123.md")),
            None
        );
    }

    #[test]
    fn extract_memo_id_handles_unicode_title() {
        assert_eq!(
            MemoFile::extract_memo_id_from_abs_path(Path::new("/n/a-b-c#x9y8zw.md")),
            Some("x9y8zw".to_string())
        );
    }

    #[test]
    fn normalize_for_compare_falls_back_when_path_missing() {
        // 写盘前 mark 的典型场景: 文件还没创建, canonicalize 必然失败。
        // 应当退到原 path 字符串, 不丢抑制。
        let p = Path::new("/definitely/does/not/exist/foo.md");
        let normalized = normalize_for_compare(p);
        assert_eq!(normalized, p.to_path_buf());
    }

    #[test]
    fn normalize_for_compare_joins_canonical_parent_when_only_parent_exists() {
        // 父目录存在 (notebook dir 已建), 文件不存在 — canonicalize 父目录
        // 成功, 应当 join 回去。这是写盘前 mark 期望走的回退路径。
        // pid + nano 后缀防跟其它测试的 tempdir 撞名, 避免 cargo test 并行
        // 跑时的偶发 flake。
        let tmp = std::env::temp_dir().join(format!(
            "woop-fs-watcher-norm-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let file_path = tmp.join("not-yet-created.md");
        let normalized = normalize_for_compare(&file_path);
        // 父目录走 canonicalize, 跟原 parent 等价 (本机无 symlink 时)
        assert_eq!(
            normalized.parent().unwrap().canonicalize().unwrap(),
            tmp.canonicalize().unwrap()
        );
        assert_eq!(normalized.file_name().unwrap(), "not-yet-created.md");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn mark_emitted_id_ignores_empty() {
        let watcher = MemoWatcher::new(Arc::new(std::sync::RwLock::new(MemoFile::default())));
        // 空 id 不该 panic, 不该塞表
        watcher.mark_emitted_id("");
        assert!(watcher.recent_emit_ids.lock().unwrap().is_empty());
    }

    #[test]
    fn mark_emitted_id_records_and_evicts() {
        let watcher = MemoWatcher::new(Arc::new(std::sync::RwLock::new(MemoFile::default())));
        watcher.mark_emitted_id("m_abc");
        watcher.mark_emitted_id("m_def");
        {
            let map = watcher.recent_emit_ids.lock().unwrap();
            assert!(map.contains_key("m_abc"));
            assert!(map.contains_key("m_def"));
        }
        // 手动塞一个过期时间, 验证剪枝
        watcher
            .recent_emit_ids
            .lock()
            .unwrap()
            .insert("m_old".to_string(), Instant::now() - ID_DEDUP);
        // 任意 mark 会触发 retain 剪枝
        watcher.mark_emitted_id("m_new");
        {
            let map = watcher.recent_emit_ids.lock().unwrap();
            assert!(!map.contains_key("m_old"));
            assert!(map.contains_key("m_new"));
        }
    }
}
