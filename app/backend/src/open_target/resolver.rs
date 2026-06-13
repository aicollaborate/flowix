//! `resolve_open_target` — 把 [`OpenTarget`] 解析成 [`ResolvedOpenTarget`]。
//!
//! 策略:
//! 1. 抽 memo_id (深链直接拿, 物理路径走 filename 解析)
//! 2. 走 `MemoFile::find_memo_file_by_id` 全 notebook 扫描
//! 3. 同 id 撞多个 notebook 时按 hint / is_default 兜底
//! 4. 拿 notebook metadata (id / name / path)
//! 5. 拼 absolute_path + filename (memo.title) 返回
//!
//! 失败模式: `ResolveError::NotFound` (id 不存在或 .md 被删) / `NoNotebook` (异常)。
//! 这两个都返回 `Err(...)`, IPC 命令层映射成 `null` 给前端 — 前端静默 return。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::commands::AppState;
use crate::memo_file::{MemoFile, NotebookConfig};

use super::parser::OpenTarget;

/// 已确认 memo, 可直接喂给前端 document-store。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedOpenTarget {
    pub memo_id: String,
    pub notebook_id: String,
    pub notebook_name: String,
    pub notebook_path: String,
    /// 绝对物理路径 (从 list.json 拼)
    pub absolute_path: String,
    /// memo filename (用于 stale check / 前端显示)
    pub memo_title: String,
}

#[derive(Debug, Error, Serialize)]
pub enum ResolveError {
    #[error("memo not found: {0}")]
    NotFound(String),
    #[error("notebook not found for memo: {0}")]
    NotebookNotFound(String),
    #[error("no memo id resolvable from target")]
    NoMemoId,
}

/// 把 [`OpenTarget`] 解析成 [`ResolvedOpenTarget`]。
///
/// 实现要点:
/// - memo_id 优先从 `OpenTarget` 自身取 (深链); 物理路径走 `find_memo_file_by_id`
///   双路径扫所有 notebook。
/// - notebook_hint 命中时优先用 hint 的 config; 否则扫到的结果里挑
///   `is_default` 那个; 多命中且没 hint → 第一个 (按 config 顺序)。
/// - **不做** notebook 切换副作用 — 把切换动作留给前端 `setCurrentNotebook` +
///   `setSelectedNotebook` 走 store。 后端只负责"找到这个 memo 在哪个 notebook"。
pub fn resolve_open_target(
    target: OpenTarget,
    state: &AppState,
) -> Result<ResolvedOpenTarget, ResolveError> {
    let memo_id = extract_memo_id(&target).ok_or(ResolveError::NoMemoId)?;

    // 拿当前 process 内 `MemoFile` 的 read guard + 所有 notebook configs。
    // 之后**释放** read guard 再做 IO 扫描, 避免持锁跨 await (这里没有 await
    // 但 fs::read_dir 在 Rust 锁规范里也是"快进快出")。
    let (configs, current_notebook_id) = {
        let memo_file = state.memo_file.read().unwrap();
        let configs = memo_file.read_notebook_configs().unwrap_or_default();
        let cur = memo_file.current_notebook_id_value();
        (configs, cur)
    };

    if configs.is_empty() {
        return Err(ResolveError::NotebookNotFound(memo_id.clone()));
    }

    // 1. 物理路径模式: 按 .md 绝对路径精确匹配 → 命中直接拿 notebook
    if let Some(abs_path) = target_physical_path(&target) {
        if let Some(cfg) = longest_prefix_notebook(&configs, &abs_path) {
            let memo_title =
                memo_title_from_disk(&cfg, &abs_path).unwrap_or_else(|| memo_id.clone());
            return Ok(ResolvedOpenTarget {
                memo_id: memo_id.clone(),
                notebook_id: cfg.id.clone(),
                notebook_name: cfg.name.clone(),
                notebook_path: cfg.path.clone(),
                absolute_path: abs_path,
                memo_title,
            });
        }
        // 物理路径精确匹配失败 → fallthrough 到全 notebook 扫 id
    }

    // 2. 全 notebook 扫 id ── 不切换 `current_notebook_id`, 而是直接按 notebook.path
    // 算文件存在。 用最朴素的 `read_dir` 扫根目录, 命中 + id 匹配即返回。
    let mut candidates: Vec<NotebookConfig> = Vec::new();
    for cfg in &configs {
        if notebook_contains_memo(cfg, &memo_id) {
            candidates.push(cfg.clone());
        }
    }

    // 恢复 current_notebook_id (虽然这里没改, 但要尊重调用前的状态, 避免污染
    // 后续 IPC 的 `switch_notebook_and_rebuild` 幂等守卫)。
    let _ = current_notebook_id; // mark as used

    if candidates.is_empty() {
        return Err(ResolveError::NotFound(memo_id));
    }

    // 3. 选 notebook: 优先 hint 命中, 否则 is_default, 否则第一个
    let chosen = pick_notebook(&candidates, target_notebook_hint(&target), &configs).clone();

    // 4. 拿到 memo 自身的 title (走 list.json, 真源)
    let memo_title = {
        let memo_file = state.memo_file.read().unwrap();
        memo_file.read_memo(&memo_id).map(|m| m.filename)
    }
    .unwrap_or_else(|| memo_id.clone());

    let abs_path = format!(
        "{}/{}#{}.md",
        chosen.path.trim_end_matches(['/', '\\']),
        memo_title,
        memo_id,
    );

    Ok(ResolvedOpenTarget {
        memo_id,
        notebook_id: chosen.id,
        notebook_name: chosen.name,
        notebook_path: chosen.path,
        absolute_path: abs_path,
        memo_title,
    })
}

fn extract_memo_id(target: &OpenTarget) -> Option<String> {
    match target {
        OpenTarget::DeepLink { memo_id, .. } => memo_id.clone(),
        OpenTarget::PhysicalPath { memo_id, .. } => memo_id.clone(),
    }
}

fn target_physical_path(target: &OpenTarget) -> Option<String> {
    match target {
        OpenTarget::PhysicalPath { path, .. } => Some(path.clone()),
        OpenTarget::DeepLink { physical_path, .. } => physical_path.clone(),
    }
}

fn target_notebook_hint(target: &OpenTarget) -> Option<String> {
    match target {
        OpenTarget::DeepLink { notebook_hint, .. } => notebook_hint.clone(),
        OpenTarget::PhysicalPath { .. } => None,
    }
}

fn longest_prefix_notebook(configs: &[NotebookConfig], abs_path: &str) -> Option<NotebookConfig> {
    let mut best: Option<(usize, &NotebookConfig)> = None;
    for cfg in configs {
        let prefix = cfg.path.trim_end_matches(['/', '\\']);
        if abs_path.starts_with(prefix) {
            let len = prefix.len();
            if best.map_or(true, |(l, _)| len > l) {
                best = Some((len, cfg));
            }
        }
    }
    best.map(|(_, cfg)| cfg.clone())
}

fn notebook_contains_memo(cfg: &NotebookConfig, memo_id: &str) -> bool {
    let base = Path::new(cfg.path.trim_end_matches(['/', '\\']));
    let entries = match fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
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
        if MemoFile::extract_memo_id_from_abs_path(&path).as_deref() == Some(memo_id) {
            return true;
        }
    }
    false
}

fn memo_title_from_disk(_cfg: &NotebookConfig, abs_path: &str) -> Option<String> {
    let p = Path::new(abs_path);
    let name = p.file_name()?.to_str()?;
    MemoFile::memo_title_from_filename(name)
}

fn pick_notebook<'a>(
    candidates: &'a [NotebookConfig],
    hint: Option<String>,
    all_configs: &[NotebookConfig],
) -> &'a NotebookConfig {
    // 1. hint 命中
    if let Some(h) = hint {
        if let Some(c) = candidates.iter().find(|cfg| cfg.id == h) {
            return c;
        }
    }
    // 2. is_default 命中
    for cfg in all_configs {
        if cfg.is_default {
            if let Some(c) = candidates.iter().find(|c| c.id == cfg.id) {
                return c;
            }
        }
    }
    // 3. 第一个候选
    &candidates[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::AppState;
    use crate::memo_file::NotebookConfig;
    use std::path::PathBuf;
    use std::sync::{Arc, RwLock};

    fn fresh_state() -> (AppState, PathBuf) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let tmp = std::env::temp_dir().join(format!(
            "flowix-open-target-test-{}-{}-{}",
            std::process::id(),
            n,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let app_data = tmp.join("app_data");
        let notebook_file = tmp.join("notebook.json");
        std::fs::create_dir_all(&app_data).unwrap();

        let cfg = NotebookConfig {
            id: "nb_default".to_string(),
            name: "Default".to_string(),
            icon: None,
            path: format!("{}/", tmp.display()),
            is_default: true,
            created_at: 0,
            updated_at: 0,
        };
        std::fs::write(
            &notebook_file,
            serde_json::to_string_pretty(&vec![cfg]).unwrap(),
        )
        .unwrap();

        let mut memo_file = MemoFile::new(app_data, notebook_file);
        memo_file.set_current_notebook(Some("nb_default".to_string()));
        // 写一个 memo 进 list.json + .md
        let id = "vex4v9";
        let title = "Test Note";
        let memo = crate::memo_file::Memo {
            id: id.to_string(),
            filename: title.to_string(),
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: 0,
            updated_at: 0,
            favorited: false,
            icon: None,
            colors: vec![],
            path: None,
        };
        memo_file
            .update_memo_item(&memo, Some("body"))
            .expect("update ok");

        let state = AppState {
            user_config: Arc::new(crate::user_config::UserConfigStore::new(
                std::env::temp_dir(),
            )),
            global_meta_data: crate::global_meta_data::GlobalMetaData::new(
                std::env::temp_dir().join("global_meta.json"),
            )
            .expect("init"),
            memo_file: Arc::new(RwLock::new(memo_file)),
            search: RwLock::new(crate::search::MemoIndex::new(Arc::new(
                crate::search::BigramTokenizer,
            ))),
            agent_manager: Arc::new(crate::agent::AgentManager::for_tests()),
            thread_manager: Arc::new(tokio::sync::RwLock::new(
                crate::threads::ThreadManager::new(std::env::temp_dir().join("thread.db"))
                    .expect("init"),
            )),
            agent_access: Arc::new(crate::agent_access::AgentAccessStore::new(
                std::env::temp_dir(),
                &MemoFile::new(std::env::temp_dir().join("ad2"), std::env::temp_dir().join("nb2")),
            )),
        };
        (state, tmp)
    }

    #[test]
    fn resolve_physical_path_finds_memo_in_default_notebook() {
        let (state, base) = fresh_state();
        let abs_path = base.join("Test Note#vex4v9.md");
        let target = OpenTarget::PhysicalPath {
            path: abs_path.to_string_lossy().to_string(),
            memo_id: Some("vex4v9".to_string()),
        };
        let r = resolve_open_target(target, &state).expect("resolve");
        assert_eq!(r.memo_id, "vex4v9");
        assert_eq!(r.notebook_id, "nb_default");
        assert_eq!(r.memo_title, "Test Note");
    }

    #[test]
    fn resolve_deep_link_finds_memo_in_default_notebook() {
        let (state, _base) = fresh_state();
        let target = OpenTarget::DeepLink {
            url: "flowix://memo/vex4v9".to_string(),
            memo_id: Some("vex4v9".to_string()),
            notebook_hint: None,
            physical_path: None,
        };
        let r = resolve_open_target(target, &state).expect("resolve");
        assert_eq!(r.memo_id, "vex4v9");
        assert_eq!(r.notebook_id, "nb_default");
    }

    #[test]
    fn resolve_returns_error_when_memo_missing() {
        let (state, _base) = fresh_state();
        let target = OpenTarget::DeepLink {
            url: "flowix://memo/zzz99x".to_string(),
            memo_id: Some("zzz99x".to_string()),
            notebook_hint: None,
            physical_path: None,
        };
        let err = resolve_open_target(target, &state).unwrap_err();
        assert!(matches!(err, ResolveError::NotFound(_)));
    }

    #[test]
    fn resolve_returns_error_when_target_has_no_memo_id() {
        let (state, _base) = fresh_state();
        let target = OpenTarget::PhysicalPath {
            path: "/some/random.md".to_string(),
            memo_id: None,
        };
        let err = resolve_open_target(target, &state).unwrap_err();
        assert!(matches!(err, ResolveError::NoMemoId));
    }
}
