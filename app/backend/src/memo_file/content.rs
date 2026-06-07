//! .md 文件 IO + 主体 CRUD — `read_memo` / `read_all_memos` / `read_all_memos_filtered` /
//! `read_all_memos_with_body` / `read_memo_with_body` / `update_memo_item` /
//! `delete_memo_file` / `find_memo_file_by_id` / `generate_unique_filename` /
//! `derived_tags`。
//!
//! 跟 list.json / memo.json 的区别: list.json 是 metadata 缓存, 这里 .md 是正文
//! 真源。`update_memo_item` 流程: 算出新 filename → 必要时 rename 旧文件 →
//! 写新文件 (含 YAML frontmatter + body) → 同步派生字段到 list.json。

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use super::derivation::apply_derived_memo_fields;
use super::frontmatter::FRONTMATTER_RE;
use super::time::{chrono_now, start_of_this_month, start_of_this_week};
use super::types::{Memo, MemoFrontmatter, MemoListEntry, MemoTag};
use super::MemoFile;

impl MemoFile {
    /// 算最终落盘的 .md 文件名: `{title}-{m_xxxxxx}.md`。
    /// title 空时用 `untitled-YYYY-MM-DD` 占位。文件名未变时早 return,
    /// 避免 `update_memo_item` 误触发 rename 链。
    fn generate_unique_filename(
        title: &str,
        memoid: &str,
        old_actual_filename: Option<&str>,
    ) -> String {
        let base = if title.is_empty() {
            chrono::Local::now().format("untitled-%Y-%m-%d").to_string()
        } else {
            title.to_string()
        };

        let filename = format!("{}-{}.md", base, memoid);

        // If unchanged, skip rename
        if Some(filename.as_str()) == old_actual_filename {
            return filename;
        }

        filename
    }

    /// 按 id 在 list.json 里查, 拼成绝对路径。
    /// 解析不到 (list.json 没记录) 或文件不在磁盘上 → None。
    /// 注: 这里用 list.json 的 `path` 字段而不是扫目录 — 速度恒定,
    /// 跟 "外部工具新建/重命名后 list.json 还没对账" 走 `reconcile_with_disk` 补齐。
    pub(crate) fn find_memo_file_by_id(&self, id: &str) -> Option<PathBuf> {
        if let Some(list) = self.read_list_json() {
            if let Some(entry) = list.memos.iter().find(|e| e.id == id) {
                if let Some(ref rel_path) = entry.path {
                    let base = self.get_memo_base();
                    let full_path = base.join(rel_path);
                    eprintln!(
                        "[find_memo_file_by_id] id: {}, path in list.json: {:?}, full_path: {}",
                        id,
                        rel_path,
                        full_path.display()
                    );
                    if full_path.exists() {
                        return Some(full_path);
                    }
                    eprintln!(
                        "[find_memo_file_by_id] File does not exist: {}",
                        full_path.display()
                    );
                }
            }
        }
        eprintln!("[find_memo_file_by_id] No file found for id: {}", id);
        None
    }

    /// 派生 tags — 扫所有 memo 的 `tags` 字段, 合并去重, 按 name lowercase 排序。
    /// 用在 `get_all_tags` Tauri 命令 (`commands.rs` 调), 每次都重算。
    pub fn derived_tags(&self) -> Vec<MemoTag> {
        let now = chrono::Utc::now().timestamp_millis();
        let mut seen = HashSet::new();
        let mut tags = Vec::new();

        for memo in self.read_all_memos() {
            for name in memo.tags {
                if seen.insert(name.clone()) {
                    tags.push(MemoTag {
                        id: name.clone(),
                        name,
                        created_at: now,
                    });
                }
            }
        }

        tags.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        tags
    }

    /// 读 list.json 全表, 转 `Memo`, 按 `created_at` 倒序。
    /// 缺省走磁盘扫描 `.md` 文件 (filename `{title}-{m_xxxxxx}.md`) 兜底,
    /// 适用 list.json 缺失场景 (例如首次启动, 但 reconcile 还没跑)。
    pub fn read_all_memos(&self) -> Vec<Memo> {
        let _ = self.ensure_dirs();

        let base = self.get_memo_base();
        if !base.exists() {
            return Vec::new();
        }

        // Try reading from list.json first - no file I/O needed
        if let Some(list) = self.read_list_json() {
            let mut memos: Vec<Memo> = list
                .memos
                .into_iter()
                .filter(|entry| !entry.id.is_empty())
                .map(|entry| MemoFile::list_entry_to_memo(&entry))
                .collect();

            memos.sort_by_key(|b| std::cmp::Reverse(b.created_at));
            return memos;
        }

        // Fallback: scan .md files directly
        let mut memos = Vec::new();
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        // Filename format: "{title}-{id}.md", id starts with "m_"
                        if let Some(id) = name
                            .rsplit('-')
                            .next()
                            .filter(|s| s.starts_with("m_"))
                            .map(|s| s.to_string())
                        {
                            let rel_path = path
                                .strip_prefix(&base)
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .to_string();
                            let now = chrono::Utc::now().timestamp_millis();
                            memos.push(Memo {
                                id,
                                filename: name
                                    .trim_end_matches(".md")
                                    .rsplit('-')
                                    .next()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                                preview: String::new(),
                                tags: vec![],
                                todos: vec![],
                                created_at: now,
                                updated_at: now,
                                favorited: false,
                                icon: None,
                                path: Some(rel_path),
                            });
                        }
                    }
                }
            }
        }

        memos.sort_by_key(|b| std::cmp::Reverse(b.created_at));

        memos
    }

    /// 按 `filter` + `sort` + `tag_id` 过滤 read_all_memos 结果。
    /// 过滤: "all" / "todos" / "favorited" / "tagged" / "thisWeek" / "thisMonth"。
    /// 排序: "createdAt" / "updatedAt"; 在 `all` 视图下 favorited 当作 pin (置顶)。
    pub fn read_all_memos_filtered(
        &self,
        filter: &str,
        sort: &str,
        tag_id: Option<&str>,
    ) -> Vec<Memo> {
        let all_memos = self.read_all_memos();

        // Compute time-range boundaries once so time-based filters can share them.
        let now = chrono_now();
        let week_start = start_of_this_week(now);
        let month_start = start_of_this_month(now);

        // Filter
        let filtered: Vec<Memo> = match filter {
            "todos" => all_memos
                .into_iter()
                .filter(|m| !m.todos.is_empty())
                .collect(),
            "favorited" => all_memos.into_iter().filter(|m| m.favorited).collect(),
            "tagged" => {
                if let Some(tid) = tag_id {
                    all_memos
                        .into_iter()
                        .filter(|m| m.tags.contains(&tid.to_string()))
                        .collect()
                } else {
                    all_memos
                        .into_iter()
                        .filter(|m| !m.tags.is_empty())
                        .collect()
                }
            }
            "thisWeek" => all_memos
                .into_iter()
                .filter(|m| m.created_at >= week_start && m.created_at <= now)
                .collect(),
            // "thisMonth" intentionally uses month_start (the 1st of the month) rather
            // than week_start, so memos created earlier in the month are still visible.
            // Because month_start <= week_start, anything in thisWeek is also in thisMonth.
            "thisMonth" => all_memos
                .into_iter()
                .filter(|m| m.created_at >= month_start && m.created_at <= now)
                .collect(),
            _ => all_memos, // "all" - no filter
        };

        // Sort. In the main list, favorited memos behave as pinned items.
        match sort {
            "updatedAt" => {
                let mut sorted = filtered;
                sorted.sort_by(|a, b| {
                    if filter == "all" {
                        b.favorited
                            .cmp(&a.favorited)
                            .then_with(|| b.updated_at.cmp(&a.updated_at))
                    } else {
                        b.updated_at.cmp(&a.updated_at)
                    }
                });
                sorted
            }
            _ => {
                // "createdAt" or default
                let mut sorted = filtered;
                sorted.sort_by(|a, b| {
                    if filter == "all" {
                        b.favorited
                            .cmp(&a.favorited)
                            .then_with(|| b.created_at.cmp(&a.created_at))
                    } else {
                        b.created_at.cmp(&a.created_at)
                    }
                });
                sorted
            }
        }
    }

    /// 按 id 读 list.json 里的单条 memo。文件 body 不读, 只 metadata。
    pub fn read_memo(&self, id: &str) -> Option<Memo> {
        let list = self.read_list_json()?;
        let entry = list.memos.iter().find(|e| e.id == id)?;
        Some(MemoFile::list_entry_to_memo(entry))
    }

    /// 读出当前 notebook 全部 memos 的 metadata + 完整 .md 原始内容。
    /// 读失败的 entry 用空串占位 (保留索引, 只是搜不到正文)。
    /// 用于 `search.rs` 全量 rebuild。
    pub fn read_all_memos_with_body(&self) -> Vec<(MemoListEntry, String)> {
        let list = match self.read_list_json() {
            Some(l) => l,
            None => return Vec::new(),
        };
        let base = self.get_memo_base();
        list.memos
            .into_iter()
            .filter(|e| !e.id.is_empty())
            .map(|entry| {
                let path = entry
                    .path
                    .as_deref()
                    .map(|rel| base.join(rel))
                    .unwrap_or_else(|| base.join(format!("{}-{}.md", entry.filename, entry.id)));
                let body = fs::read_to_string(&path).unwrap_or_default();
                (entry, body)
            })
            .collect()
    }

    /// 读单条 memo 的 metadata + 完整 .md 原始内容. id 不存在或 .md 读不到都返回 None.
    /// 用于 `search.rs` 增量 upsert.
    pub fn read_memo_with_body(&self, id: &str) -> Option<(MemoListEntry, String)> {
        let list = self.read_list_json()?;
        let entry = list.memos.iter().find(|e| e.id == id)?.clone();
        let path = self
            .find_memo_file_by_id(id)
            .unwrap_or_else(|| {
                let base = self.get_memo_base();
                base.join(format!("{}-{}.md", entry.filename, entry.id))
            });
        let body = fs::read_to_string(&path).ok()?;
        Some((entry, body))
    }

    /// 写一条 memo 的 .md 文件 + 同步 list.json. 步骤:
    /// 1. 找旧 .md 路径 (`find_memo_file_by_id`), 拿到旧 filename
    /// 2. 算新 filename (`generate_unique_filename`), 必要时 `fs::rename` 旧 → 新
    /// 3. 写新文件 (YAML frontmatter + body)
    /// 4. 同步派生字段 (preview / tags / todos) 到 list.json
    ///
    /// 已知风险: rename 成功但 list.json 写失败时, 文件已改名、list 没更新,
    /// 短暂不一致窗口。`reconcile_with_disk` 在下次切换 notebook 时会修复。
    /// 跟 `register_unnamed_file` 的"失败回滚"路径不一一对应, 后续可统一。
    pub fn update_memo_item(&self, memo: &Memo, content: Option<&str>) -> std::io::Result<String> {
        self.ensure_dirs()?;

        // Find old file path using list.json + filename
        let old_file_path = self.find_memo_file_by_id(&memo.id);
        let old_actual_filename: Option<String> = old_file_path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .map(|s| s.to_string());

        // Generate filename from memo.filename (title, without .md extension)
        let new_filename = Self::generate_unique_filename(
            &memo.filename,
            &memo.id,
            old_actual_filename.as_deref(),
        );
        eprintln!("[update_memo_item] id: {}, memo.filename: {}, old_actual_filename: {:?}, new_filename: {}", memo.id, memo.filename, old_actual_filename, new_filename);

        // If old file exists and filename changed, rename it
        if let Some(ref old_path) = old_file_path {
            if let Some(old_name) = old_path.file_name().and_then(|n| n.to_str()) {
                if old_name != new_filename && old_path.exists() {
                    let new_path = self.get_memo_base().join(&new_filename);
                    eprintln!(
                        "[update_memo_item] Renaming file: {} -> {}",
                        old_path.display(),
                        new_path.display()
                    );
                    fs::rename(old_path, &new_path)?;
                }
            }
        }

        let file_path = self.get_memo_base().join(&new_filename);

        let fm = MemoFrontmatter {
            filename: memo.filename.clone(),
        };

        let fm_yaml = serde_yaml::to_string(&fm).unwrap_or_default();
        let file_content = if let Some(c) = content {
            format!("---\n{}\n---\n{}", fm_yaml.trim(), c)
        } else {
            let existing = fs::read_to_string(&file_path).unwrap_or_default();
            if let Some(captures) = FRONTMATTER_RE.captures(&existing) {
                let body = captures.get(2).map(|m| m.as_str()).unwrap_or("");
                format!("---\n{}\n---\n{}", fm_yaml.trim(), body)
            } else {
                format!("---\n{}\n---\n{}", fm_yaml.trim(), existing)
            }
        };

        fs::write(&file_path, &file_content)?;

        // Set relative path for list.json sync
        let mut memo_to_sync = memo.clone();
        memo_to_sync.path = Some(new_filename.clone());
        apply_derived_memo_fields(&mut memo_to_sync, &file_content);

        // Sync list.json with memo.filename (display title, no memoid)
        MemoFile::sync_list_json_on_write(self, &memo_to_sync)?;

        Ok(new_filename)
    }

    /// 删 .md 文件 + 同步 list.json / memo.json。`find_memo_file_by_id` 找不到时
    /// 返回 false (调用方应当把这种 id 视为已经删除)。
    pub fn delete_memo_file(&self, id: &str) -> bool {
        if let Some(path) = self.find_memo_file_by_id(id) {
            let result = fs::remove_file(path).is_ok();

            // Sync list.json
            if result {
                let _ = MemoFile::sync_list_json_on_delete(self, id);
            }

            result
        } else {
            false
        }
    }
}
