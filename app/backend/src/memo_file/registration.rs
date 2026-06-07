//! 磁盘对账与注册 — 把外部 .md 文件纳入 list.json 管理。
//!
//! 5 个方法覆盖三类场景:
//! - **`extract_memo_id_from_abs_path`**: 静态文件名解析, 跨模块共用
//!   (`commands.rs` / `fs_watcher.rs` 都走它)。
//! - **`register_existing_file` / `register_unnamed_file`**: 单文件注册。
//!   命名规范 (`{title}-{m_xxxxxx}.md`) 文件 → 复用 id, 不重命名; 任意命名 → 生成
//!   id + 重命名为规范名 (失败回滚)。
//! - **`reconcile_with_disk`**: 启动时全量扫当前 notebook 目录, 补齐 list.json 缺失
//!   条目。**不**重命名磁盘文件, 保留外部工具的句柄。
//! - **`reload_memo_from_disk`**: 重新读 .md 派生 preview / tags / todos, 同步到
//!   list.json。watcher 命中外部工具改磁盘时调用。
//! - **`unregister_memo_by_path`**: 按文件路径删 list.json 条目 (.md 删除由 caller 负责)。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::derivation::apply_derived_memo_fields;
use super::types::Memo;
use super::MemoFile;

impl MemoFile {
    /// 内部 id 生成 — 与 `commands.rs::generate_memo_id` 同形 (`m_<6>`)。
    /// 之所以在 `MemoFile` 里复制一份: 避免反向依赖 `commands` 模块 (历史
    /// 教训, `AgentManager` 早前就因为反向依赖被拆掉)。
    ///
    /// 字符集约束: 随机段必须用纯字母+数字, 走共享 `super::MEMO_ID_ALPHABET`
    /// (见 `mod.rs` 顶部), 不让 `nanoid 0.4` 默认 `SAFE` 里的 `_` / `-` 渗到 id 里
    /// 破坏 `{title}-{id}.md` 的 `rsplit('-')` 解析。
    fn generate_memo_id() -> String {
        let id = nanoid::nanoid!(6, &super::MEMO_ID_ALPHABET);
        format!("m_{}", id)
    }

    /// 从绝对路径 `/.../{title}-{m_xxxxxx}.md` 抽出 memo id, 用于 watcher
    /// 命中外部 .md 时定位 list.json 条目。失败返回 None (非 memo 文件)。
    pub fn extract_memo_id_from_abs_path(abs_path: &Path) -> Option<String> {
        let name = abs_path.file_name().and_then(|n| n.to_str())?;
        let stem = name.strip_suffix(".md")?;
        stem.rsplit('-')
            .next()
            .filter(|s| s.starts_with("m_") && !s.is_empty())
            .map(|s| s.to_string())
    }

    /// 把一个磁盘上已存在的 .md 注册为 memo, 不覆盖文件内容。
    /// 适用场景: Agent `write` 工具新建的 `{title}-{m_xxxxxx}.md` 文件;
    /// 外部工具在 notebook 目录里按命名约定新建 .md 后 watcher 观察到。
    ///
    /// 失败: 路径非 `m_xxxxxx` 后缀 (不视为合法 memo 文件); 其它 IO 错。
    /// 已注册的 id 走 `reload_memo_from_disk` 路径, 不重复 push。
    pub fn register_existing_file(&self, abs_path: &Path) -> Result<Memo, String> {
        let Some(id) = Self::extract_memo_id_from_abs_path(abs_path) else {
            return Err("path is not a named memo file (no `m_xxxxxx` suffix)".to_string());
        };
        if !abs_path.exists() {
            return Err(format!("file not found: {}", abs_path.display()));
        }

        // 防止 list.json 已经有一条同 id 的 — `sync_list_json_on_write` 是
        // retain + push, 同 id 会覆盖而不是重复, 但要保证 filename 跟磁盘一致。
        if self.read_memo(&id).is_some() {
            // 已经注册过; 走 reload 路径, 不重复 push (timestamp 变化也不要紧)
            return self.reload_memo_from_disk(&id);
        }

        let now = chrono::Utc::now().timestamp_millis();
        let content = fs::read_to_string(abs_path).map_err(|e| e.to_string())?;
        let mut memo = Memo {
            id: id.clone(),
            filename: String::new(),
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: now,
            updated_at: now,
            favorited: false,
            icon: None,
            path: abs_path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string()),
        };
        apply_derived_memo_fields(&mut memo, &content);
        MemoFile::sync_list_json_on_write(self, &memo)
            .map_err(|e| format!("sync list.json failed: {e}"))?;
        Ok(memo)
    }

    /// 把一个**任意命名**的 .md 文件注册为 memo, 并按 `{title}-{m_xxxxxx}.md`
    /// 规范重命名磁盘文件。适用: 外部工具 / 用户在 notebook 目录里手动创建一个
    /// 无 `m_xxxxxx` 后缀的 .md (例如 `Agent 记忆管理.md`), watcher 抽不出
    /// id, 走本路径接管。
    ///
    /// 三件事:
    /// 1. 生成新 memo id (`m_xxxxxx`)。
    /// 2. **重命名磁盘文件**为 `{title}-{m_xxxxxx}.md` — 跟 `update_memo_item`
    ///    路径下文件命名约定同形, 保证后续 watcher 事件能抽 id 走正常 reload。
    /// 3. 写 list.json + memo.json, 返回新建的 `Memo` 及**新**绝对路径。
    ///
    /// 重命名后 caller 应 mark_self_write(新路径) — watcher 的后续 Create /
    /// Modify 事件会按新路径到达, 抑制它们避免循环。
    ///
    /// 失败: 路径非 .md 后缀; 文件不存在; 重命名 IO 错; list.json 写错。
    pub fn register_unnamed_file(
        &self,
        abs_path: &Path,
    ) -> Result<(Memo, PathBuf), String> {
        if !abs_path.exists() {
            return Err(format!("file not found: {}", abs_path.display()));
        }
        let is_md = abs_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| {
                let lower = e.to_ascii_lowercase();
                lower == "md" || lower == "markdown"
            })
            .unwrap_or(false);
        if !is_md {
            return Err(format!("not a markdown file: {}", abs_path.display()));
        }

        let content = fs::read_to_string(abs_path).map_err(|e| e.to_string())?;

        // 派生 title: 用 apply_derived_memo_fields 的同样语义, 但从 body 第一行剥
        // `#`。若 body 完全是空的, 回退到 file_stem。
        let id = Self::generate_memo_id();
        let now = chrono::Utc::now().timestamp_millis();

        // 临时 memo 仅用于拿派生 title (apply_derived_memo_fields 内部 sanitize
        // 标题, 去控制字符等), 再丢弃。不直接给用户返回, 因为最终 memo 还得用
        // 重命名后的 filename 路径。
        let mut scratch = Memo {
            id: String::new(),
            filename: String::new(),
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: now,
            updated_at: now,
            favorited: false,
            icon: None,
            path: None,
        };
        apply_derived_memo_fields(&mut scratch, &content);
        let derived_filename = scratch.filename;
        // fallback: body 没法派生 title (空文件 / 无可见内容) → 用 file_stem
        let title = if derived_filename.trim().is_empty() {
            abs_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("untitled")
                .trim()
                .to_string()
        } else {
            derived_filename
        };

        // 跟 generate_unique_filename 同形: `{title}-{m_xxxxxx}.md`
        let new_filename = format!("{}-{}.md", title, id);
        let new_abs_path = abs_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(&new_filename);

        // 重命名磁盘文件 — list.json 写错时回滚, 避免文件跟 list 失同步
        if let Err(e) = fs::rename(abs_path, &new_abs_path) {
            return Err(format!("rename {} -> {} failed: {e}", abs_path.display(), new_abs_path.display()));
        }

        let memo = Memo {
            id: id.clone(),
            filename: title,
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: now,
            updated_at: now,
            favorited: false,
            icon: None,
            path: Some(new_filename.clone()),
        };

        if let Err(e) = MemoFile::sync_list_json_on_write(self, &memo) {
            // list.json 写失败, 回滚磁盘重命名
            let _ = fs::rename(&new_abs_path, abs_path);
            return Err(format!("sync list.json failed: {e}"));
        }

        // 重新读一遍拿派生后的最终态 (filename / preview / tags / todos)
        // sync_list_json_on_write 不返回更新后的 memo, 走 read_memo
        let final_memo = self
            .read_memo(&id)
            .unwrap_or(memo);
        Ok((final_memo, new_abs_path))
    }

    /// 跟磁盘对账: 扫当前 notebook 目录里所有 .md 文件, 把 list.json 里没记录的
    /// 补进来, 写回 list.json + memo.json。
    ///
    /// 用途: 解决"应用关闭期间用户在外部新建 / 移动 .md 进来, 重启后 list.json
    /// 没记录, watcher 也帮不上忙 (notify 不回放历史事件)"的冷启动 gap。
    ///
    /// 行为:
    /// - **不重命名磁盘文件** —— 跟 `register_unnamed_file` 的关键区别。
    ///   用户在别的工具里编辑 `记忆管理.md` 时, 文件名不能被改, 否则那个
    ///   工具的句柄失效。任意命名的 .md 直接以原文件名入 list.json, 后续
    ///   Flowix 编辑器保存时再走 `update_memo_item` 的 `generate_unique_filename`
    ///   一次性规范化。
    /// - 已经在 list.json 里的 .md 跳过 (按 `path` 字段去重)。
    /// - 命名规范 `{title}-{m_xxxxxx}.md` → 复用文件名里的 id。
    /// - 任意命名 .md → 生成新 id, `path` 字段保留原文件名。
    /// - `.metadata/` 目录跳过 (list.json / memo.json 在那里, 不当成 memo)。
    ///
    /// 返回: 补进 list.json 的新条目数。出错 (IO / JSON) 不 panic, 单个文件错
    /// 跳过继续。
    pub fn reconcile_with_disk(&self) -> Result<usize, String> {
        let base = self.get_memo_base();
        if !base.exists() {
            return Ok(0);
        }

        let mut list = self.read_list_json().unwrap_or_default();
        let existing_paths: HashSet<String> = list
            .memos
            .iter()
            .filter_map(|e| e.path.clone())
            .collect();

        let mut added = 0usize;
        let entries = match fs::read_dir(&base) {
            Ok(e) => e,
            Err(e) => return Err(format!("read_dir failed: {e}")),
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            // 仅 .md / .markdown 文件
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
            // 跳过 .metadata/ 目录 (list.json / memo.json 不当 memo)
            if path
                .components()
                .any(|c| c.as_os_str() == ".metadata")
            {
                continue;
            }
            // 计算相对路径 (用于 list.json 的 `path` 字段)
            let rel = match path.strip_prefix(&base) {
                Ok(p) => p.to_string_lossy().to_string(),
                Err(_) => continue,
            };
            // 已经在 list.json 里? 跳过
            if existing_paths.contains(&rel) {
                continue;
            }
            // 读文件 + 派生字段
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // 跳过不可读
            };
            // 决定 id: 文件名带 m_xxxxxx 后缀就复用, 否则生成新
            let id = Self::extract_memo_id_from_abs_path(&path)
                .unwrap_or_else(|| Self::generate_memo_id());
            let now = chrono::Utc::now().timestamp_millis();
            let mut memo = Memo {
                id: id.clone(),
                filename: String::new(),
                preview: String::new(),
                tags: vec![],
                todos: vec![],
                created_at: now,
                updated_at: now,
                favorited: false,
                icon: None,
                path: Some(rel.clone()),
            };
            apply_derived_memo_fields(&mut memo, &content);
            list.memos.push(MemoFile::memo_to_list_entry(&memo));
            added += 1;
        }

        if added == 0 {
            return Ok(0);
        }
        list.last_updated = chrono::Utc::now().timestamp_millis();
        self.write_list_json(&list)
            .map_err(|e| format!("write_list_json failed: {e}"))?;
        // 同步 .metadata/memo.json (todos 索引, 给 list 筛选用)
        // sync_list_json_on_write 里有这部分, 但我们直接 push list, 走同样的补救
        for entry in &list.memos {
            // 把每个新加的 memo 的 todos 写进 memo.json
            if entry.todos.is_empty() {
                continue;
            }
            let _ = self.sync_memo_json_todos_on_write(&Memo {
                id: entry.id.clone(),
                filename: entry.filename.clone(),
                preview: entry.preview.clone(),
                tags: entry.tags.clone(),
                todos: entry.todos.clone(),
                created_at: entry.created_at,
                updated_at: entry.updated_at,
                favorited: entry.favorited,
                icon: entry.icon.clone(),
                path: entry.path.clone(),
            });
        }
        Ok(added)
    }

    /// 重新读磁盘内容, 派生 preview / tags / todos / `updatedAt`, 同步到
    /// list.json。用于 watcher 看到外部工具修改了已注册笔记。
    ///
    /// 注意: `apply_derived_memo_fields` 仅在 `filename` 为空时覆盖, 这是
    /// `update_memo_item` 路径下"用户显式设的 title 优先"语义。本方法要的是
    /// "重新派生", 所以先清空 filename, 让派生函数能从第一行 body 算出新 title。
    pub fn reload_memo_from_disk(&self, id: &str) -> Result<Memo, String> {
        let mut memo = self
            .read_memo(id)
            .ok_or_else(|| format!("memo {id} not in list.json"))?;
        let path = self
            .find_memo_file_by_id(id)
            .ok_or_else(|| format!("file for memo {id} not found"))?;
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

        memo.filename = String::new();
        apply_derived_memo_fields(&mut memo, &content);
        memo.updated_at = chrono::Utc::now().timestamp_millis();

        MemoFile::sync_list_json_on_write(self, &memo)
            .map_err(|e| format!("sync list.json failed: {e}"))?;
        Ok(memo)
    }

    /// 通过文件路径找对应 memo id 并从 list.json 移除条目 (.md 文件本身的
    /// 删除由调用方负责 — 这个 watcher 不 rm 文件, 怕 race; `delete_memo_file`
    /// 才负责 rm)。
    /// 返回 true 表示真的有条目被移除, false = list.json 里查不到这个路径。
    pub fn unregister_memo_by_path(&self, abs_path: &Path) -> bool {
        let Some(id) = Self::extract_memo_id_from_abs_path(abs_path) else {
            return false;
        };
        // 通过 list.json 间接查, 不需要解 memo.json
        if self.read_memo(&id).is_none() {
            return false;
        }
        MemoFile::sync_list_json_on_delete(self, &id).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归测试: `generate_memo_id` 随机段只允许 `[0-9a-z]`, 严禁大写字母 /
    /// `_` / `-` / 其它特殊字符, 否则会破坏 `{title}-{id}.md` 的 `rsplit('-')`
    /// 解析。跑 50 次覆盖 nanoid 抽样空间。
    #[test]
    fn generate_memo_id_random_segment_is_lowercase_alphanumeric() {
        for _ in 0..50 {
            let id = MemoFile::generate_memo_id();
            assert!(id.starts_with("m_"), "prefix 必须是 m_, got {id}");
            let random = &id[2..];
            assert_eq!(random.len(), 6, "随机段必须 6 位, got {id}");
            assert!(
                random.chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()),
                "随机段含非小写字母+数字字符: {id}"
            );
        }
    }
}
