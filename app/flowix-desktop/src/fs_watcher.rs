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
use std::time::Instant;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use crate::watcher::{
    filter::PathFilter, MemoEventProcessor, RawFsEvent, FsEventKind, WhitelistConfig,
    normalize_for_compare,
};
use crate::watcher::filter::{ID_DEDUP, SELF_WRITE_TTL};
use flowix_core::memo_file::MemoFile;

/// 自写抑制的 TTL — 2 秒。覆盖绝大部分 IPC 命令结束 → notify 回调到达的间隔。
/// 路径防抖窗口 — 150ms。覆盖 macOS FSEvents 在 save 时偶发的双触发。
/// id 二级兜底窗口 — 250ms。比 `SELF_WRITE_TTL` 短, 仅作 A/B 失效时的应急
/// 防御, 不指望常态命中。

/// 把 `Path` 归一到 `HashMap<PathBuf, _>` 查表口径。
///
/// 优先用 `dunce::canonicalize` 折叠 symlink / `\\?\` 前缀; 失败 (文件尚未
/// 创建 — 写盘前 mark 的常见情形) 退到"只 canonicalize 父目录, 再 join
/// 文件名", 父目录在 notebook 创建时已经存在, 这一步必然成功。即便父目录
/// canonicalize 也失败, 退回原 path 字符串, 至少不丢抑制 (退化到精确匹配)。
// 移至 `crate::watcher::path::normalize_for_compare` (PR2 共享给 filter 段)。

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
    /// PR1: 可配置白/黑名单。后续 PR 改为 `Arc<RwLock<WhitelistConfig>>`
    /// 支持运行时热更新。当前每实例持有一份 `WhitelistConfig::default()`。
    whitelist: Arc<std::sync::RwLock<WhitelistConfig>>,
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
            whitelist: Arc::new(std::sync::RwLock::new(WhitelistConfig::load_or_default())),
        }
    }

    /// 替换白名单配置。 `lib.rs::setup` 会在启动 + 热更新时调用,
    /// 中间以 `Arc<RwLock<WhitelistConfig>>` 共享。
    pub fn set_whitelist(&self, new_cfg: WhitelistConfig) {
        if let Ok(mut g) = self.whitelist.write() {
            *g = new_cfg;
        }
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
        let whitelist = self.whitelist.clone();

        let mut watcher: RecommendedWatcher =
            match notify::recommended_watcher(move |res: notify::Result<Event>| {
                let Ok(event) = res else {
                    return;
                };
                handle_notify_event(&app, &memo_file, &recent, &last_emit, &recent_ids, &whitelist, event);
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
    recent: &Arc<std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, std::time::Instant>>>,
    last_emit: &Arc<std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, std::time::Instant>>>,
    recent_ids: &Arc<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>>,
    whitelist: &Arc<std::sync::RwLock<WhitelistConfig>>,
    event: notify::Event,
) {
    let path_filter = PathFilter { whitelist: whitelist.clone() };
    for path in event.paths {
        // PR2: 跑 4 段 filter pipeline (whitelist / self-write / debounce / id-dedup),
        // 行为与原 5 段完全一致, 短路语义保留。
        let fs_kind = FsEventKind::from_notify(&event.kind);
        let raw = RawFsEvent::new(fs_kind, path.clone());
        match crate::watcher::filter::run_pipeline(
            &raw,
            recent,
            last_emit,
            recent_ids,
            &path_filter,
        ) {
            crate::watcher::event::FilterDecision::Pass => {}
            crate::watcher::event::FilterDecision::PassMutated(_) => {}
            crate::watcher::event::FilterDecision::Drop { reason } => {
                tracing::debug!(
                    "[MemoWatcher] pipeline dropped ({}): {}",
                    reason.label(),
                    path.display()
                );
                continue;
            }
        }

        // PR3: 业务下沉到 MemoEventProcessor, fs_watcher 只做采集 + 过滤。
        MemoEventProcessor::process(&raw, app, memo_file);
    }
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
