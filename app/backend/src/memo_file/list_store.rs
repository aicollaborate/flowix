//! `list.json` / `memo.json` IO + 同步方法 — 维护 `.metadata/` 下两个元数据文件。
//!
//! - `list.json` — 全部 memo 的 metadata 数组 (`MemoListEntry`)。这是 `get_memos` /
//!   `search_memos` / `read_memo` 的真源, .md 文件 body 不在此缓存。
//! - `memo.json` — 跨 memo 的派生索引, 当前只存 `MemoTodoEntry` 列表 (按 memo_id
//!   索引, 用于 list 过滤 `todos`)。规模小, 全量 rewrite 无压力。
//!
//! 写策略: 单条 memo 写 → 整文件 read-modify-write, fsync/rename 暂未应用 (跟
//! `notebook.json` 一致), 风险类似 — 启动时 read 失败 `unwrap_or_default` 兜底。

use std::fs;

use super::types::{Memo, MemoListEntry, MemoListFile, MemoMetadataFile, MemoTodoEntry};
use super::MemoFile;

impl MemoFile {
    pub(crate) fn storage_title_from_filename(filename: &str) -> String {
        let safe_title = Self::sanitize_memo_filename_component(filename);
        if safe_title.is_empty() {
            chrono::Local::now().format("untitled-%Y-%m-%d").to_string()
        } else {
            safe_title
        }
    }

    pub(crate) fn get_list_json_path(&self) -> std::path::PathBuf {
        self.get_metadata_dir().join("list.json")
    }

    pub(crate) fn get_memo_json_path(&self) -> std::path::PathBuf {
        self.get_metadata_dir().join("memo.json")
    }

    pub(crate) fn read_list_json(&self) -> Option<MemoListFile> {
        let path = self.get_list_json_path();
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub(crate) fn write_list_json(&self, list: &MemoListFile) -> std::io::Result<()> {
        self.ensure_dirs()?;
        let content = serde_json::to_string_pretty(list).unwrap();
        fs::write(self.get_list_json_path(), content)
    }

    pub(crate) fn read_memo_json(&self) -> Option<MemoMetadataFile> {
        let path = self.get_memo_json_path();
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub(crate) fn write_memo_json(&self, metadata: &MemoMetadataFile) -> std::io::Result<()> {
        self.ensure_dirs()?;
        let content = serde_json::to_string_pretty(metadata).unwrap();
        fs::write(self.get_memo_json_path(), content)
    }

    pub(crate) fn memo_to_list_entry(memo: &Memo) -> MemoListEntry {
        MemoListEntry {
            id: memo.id.clone(),
            filename: Self::storage_title_from_filename(&memo.filename),
            preview: memo.preview.clone(),
            tags: memo.tags.clone(),
            todos: memo.todos.clone(),
            created_at: memo.created_at,
            updated_at: memo.updated_at,
            favorited: memo.favorited,
            icon: memo.icon.clone(),
            colors: memo.colors.clone(),
        }
    }

    pub(crate) fn list_entry_to_memo(entry: &MemoListEntry) -> Memo {
        let path = Self::generate_memo_filename(&entry.filename, &entry.id);
        Memo {
            id: entry.id.clone(),
            filename: entry.filename.clone(),
            preview: entry.preview.clone(),
            tags: entry.tags.clone(),
            todos: entry.todos.clone(),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            favorited: entry.favorited,
            icon: entry.icon.clone(),
            colors: entry.colors.clone(),
            path: Some(path),
        }
    }

    /// 写 list.json: 删旧条目, push 新条目, last_updated 戳当前。
    /// 顺带把 memo 的 todos 同步到 memo.json (派生索引)。
    pub(crate) fn sync_list_json_on_write(&self, memo: &Memo) -> std::io::Result<()> {
        let mut list = self.read_list_json().unwrap_or_default();

        list.memos.retain(|e| e.id != memo.id);
        list.memos.push(Self::memo_to_list_entry(memo));
        list.last_updated = chrono::Utc::now().timestamp_millis();

        self.write_list_json(&list)?;
        self.sync_memo_json_todos_on_write(memo)
    }

    /// 仅同步 list.json (不重写 .md), 用于 `favorite_memo` / `unfavorite_memo`
    /// 这类只改 list 字段的路径。
    pub fn sync_to_list_json_only(&self, memo: &Memo) -> std::io::Result<()> {
        self.sync_list_json_on_write(memo)
    }

    /// 写 memo.json 的 todos 部分: 删旧 memo_id 条目, 推入当前 todos。
    /// 保留 priority / timeRange / owner / assignee / createdAt / updatedAt
    /// (这些字段在更上层的 todo 面板里维护, 这里只做 ID 维度合并)。
    pub(crate) fn sync_memo_json_todos_on_write(&self, memo: &Memo) -> std::io::Result<()> {
        let mut metadata = self.read_memo_json().unwrap_or_default();
        let now = chrono::Utc::now().timestamp_millis();
        let existing_todos = metadata.todos.clone();

        metadata.todos.retain(|todo| todo.memo_id != memo.id);
        metadata.todos.extend(memo.todos.iter().map(|todo| {
            let existing = existing_todos
                .iter()
                .find(|entry| entry.memo_id == memo.id && entry.content == todo.content);

            let created_at = existing
                .map(|entry| entry.created_at)
                .unwrap_or(memo.created_at);
            let updated_at = existing
                .filter(|entry| entry.status == todo.status)
                .map(|entry| entry.updated_at)
                .unwrap_or(now);

            MemoTodoEntry {
                content: todo.content.clone(),
                status: todo.status.clone(),
                memo_id: memo.id.clone(),
                priority: existing
                    .map(|entry| entry.priority.clone())
                    .unwrap_or_default(),
                time_range: existing
                    .map(|entry| entry.time_range.clone())
                    .unwrap_or_default(),
                owner: existing
                    .map(|entry| entry.owner.clone())
                    .unwrap_or_default(),
                assignee: existing
                    .map(|entry| entry.assignee.clone())
                    .unwrap_or_default(),
                created_at,
                updated_at,
            }
        }));

        metadata.last_updated = now;
        self.write_memo_json(&metadata)
    }

    /// 删 list.json 的对应条目; 顺带删 memo.json 的 todos。
    pub(crate) fn sync_list_json_on_delete(&self, memo_id: &str) -> std::io::Result<()> {
        let mut list = match self.read_list_json() {
            Some(l) => l,
            None => return self.sync_memo_json_todos_on_delete(memo_id),
        };

        list.memos.retain(|e| e.id != memo_id);
        list.last_updated = chrono::Utc::now().timestamp_millis();

        self.write_list_json(&list)?;
        self.sync_memo_json_todos_on_delete(memo_id)
    }

    pub(crate) fn sync_memo_json_todos_on_delete(&self, memo_id: &str) -> std::io::Result<()> {
        let mut metadata = match self.read_memo_json() {
            Some(m) => m,
            None => return Ok(()),
        };

        metadata.todos.retain(|todo| todo.memo_id != memo_id);
        metadata.last_updated = chrono::Utc::now().timestamp_millis();

        self.write_memo_json(&metadata)
    }
}
