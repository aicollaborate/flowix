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
    pub fn storage_title_from_filename(filename: &str) -> String {
        let safe_title = Self::sanitize_memo_filename_component(filename);
        if safe_title.is_empty() {
            chrono::Local::now().format("untitled-%Y-%m-%d").to_string()
        } else {
            safe_title
        }
    }

    pub fn get_list_json_path(&self) -> std::path::PathBuf {
        self.get_metadata_dir().join("list.json")
    }

    pub fn get_memo_json_path(&self) -> std::path::PathBuf {
        self.get_metadata_dir().join("memo.json")
    }

    pub fn read_list_json(&self) -> Option<MemoListFile> {
        // 见 [`MemoFile::current_list_io`] ── 调用方**必须**已持有
        // `current_list_io` 锁再调本函数 (高层 RMW 包装: 
        // `sync_list_json_on_write` / `sync_list_json_on_delete`)。本函数
        // 不自己拿锁, 否则会死锁 (`std::sync::Mutex` 不可重入)。
        //
        // 锁理由: read → modify → write 跨线程交错导致 lost update; 详见
        // 集成测试 `concurrent_sync_to_list_json_only_loses_entries`。
        let path = self.get_list_json_path();
        if !path.exists() {
            return None;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[list.json] read failed: {e}");
                return None;
            }
        };
        match serde_json::from_str(&content) {
            Ok(l) => Some(l),
            Err(e) => {
                // 解析失败时把坏文件挪到 .corrupt 备份,下次 save 不会覆盖它。
                // 管理员可以从备份恢复,或 reconcile 时扫 .md 重建。
                let backup = path.with_extension("json.corrupt");
                let _ = fs::rename(&path, &backup);
                eprintln!(
                    "[list.json] parse failed: {e}, moved to {}",
                    backup.display()
                );
                None
            }
        }
    }

    pub fn write_list_json(&self, list: &MemoListFile) -> std::io::Result<()> {
        // 同 `read_list_json`: 调用方**必须**已持有 `current_list_io` 锁。
        // 本函数不做实际 IO 的并发控制, 只走 `atomic_write_json` 一次
        // tmp + fsync + rename。跨函数 RMW 串行化由高层包装负责。
        let content = serde_json::to_string_pretty(list).unwrap();
        self.atomic_write_json("list.json", &content)
    }

    pub fn read_memo_json(&self) -> Option<MemoMetadataFile> {
        let path = self.get_memo_json_path();
        if !path.exists() {
            return None;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[memo.json] read failed: {e}");
                return None;
            }
        };
        match serde_json::from_str(&content) {
            Ok(m) => Some(m),
            Err(e) => {
                let backup = path.with_extension("json.corrupt");
                let _ = fs::rename(&path, &backup);
                eprintln!(
                    "[memo.json] parse failed: {e}, moved to {}",
                    backup.display()
                );
                None
            }
        }
    }

    pub fn write_memo_json(&self, metadata: &MemoMetadataFile) -> std::io::Result<()> {
        let content = serde_json::to_string_pretty(metadata).unwrap();
        self.atomic_write_json("memo.json", &content)
    }


    /// 原子写: 写临时文件 → fsync → rename, 中途崩溃看到的永远是完整旧文件或
    /// 完整新文件。比 `fs::write` 的"打开-截断-写"安全,代价仅一次 fsync
    /// (< 1ms on SSD)。
    fn atomic_write_json(&self, filename: &str, content: &str) -> std::io::Result<()> {
        self.ensure_dirs()?;
        let final_path = self.get_metadata_dir().join(filename);
        let tmp_path = final_path.with_extension(format!(
            "tmp.{}.{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        {
            use std::io::Write;
            let mut f = fs::File::create(&tmp_path)?;
            f.write_all(content.as_bytes())?;
            f.sync_all()?;
        }
        fs::rename(&tmp_path, &final_path)
    }

    pub fn memo_to_list_entry(memo: &Memo) -> MemoListEntry {
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

    pub fn list_entry_to_memo(entry: &MemoListEntry) -> Memo {
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
    ///
    /// 锁住整个 RMW 区块 ── `read_list_json` (持锁) + 内存改 + 
    /// `write_list_json` (持锁) 必须串行化, 否则两个 thread 都基于
    /// 同一份 read 视图 modify, 后写者覆盖前写者的 push → lost update。
    /// 见 `concurrent_sync_to_list_json_only_loses_entries` 集成测试。
    ///
    /// **不在锁内调 sync_memo_json_todos_on_write** ── 那走的是 
    /// `memo.json`, 跟 list.json 是**不同的文件**, 各自的 IO 可独立
    /// 并发; 锁 list.json 时把 memo.json 一起锁会增加无谓的串行化。
    pub fn sync_list_json_on_write(&self, memo: &Memo) -> std::io::Result<()> {
        {
            let _guard = self.current_list_io.lock().expect("list_io poisoned");
            let mut list = self.read_list_json().unwrap_or_default();

            list.memos.retain(|e| e.id != memo.id);
            list.memos.push(Self::memo_to_list_entry(memo));
            list.last_updated = chrono::Utc::now().timestamp_millis();

            self.write_list_json(&list)?;
        }
        // memo.json 单独写, 不在 list_io 锁内
        self.sync_memo_json_todos_on_write(memo)
    }

    /// 仅同步 list.json (不重写 .md), 用于 `favorite_memo` / `unfavorite_memo`
    /// 这类只改 list 字段的路径。锁语义跟 `sync_list_json_on_write` 一致。
    pub fn sync_to_list_json_only(&self, memo: &Memo) -> std::io::Result<()> {
        self.sync_list_json_on_write(memo)
    }

    /// 写 memo.json 的 todos 部分: 删旧 memo_id 条目, 推入当前 todos。
    /// 保留 priority / timeRange / owner / assignee / createdAt / updatedAt
    /// (这些字段在更上层的 todo 面板里维护, 这里只做 ID 维度合并)。
    pub fn sync_memo_json_todos_on_write(&self, memo: &Memo) -> std::io::Result<()> {
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
    ///
    /// 锁住 RMW 区块 ── 跟 `sync_list_json_on_write` 共用 list_io 锁,
    /// 串行化 read+modify+write。两个 thread 各自基于相同 read 视图删
    /// 不同 id 的场景 (lost update) 在这把锁下消失。
    pub fn sync_list_json_on_delete(&self, memo_id: &str) -> std::io::Result<()> {
        {
            let _guard = self.current_list_io.lock().expect("list_io poisoned");
            let mut list = match self.read_list_json() {
                Some(l) => l,
                None => return self.sync_memo_json_todos_on_delete(memo_id),
            };

            list.memos.retain(|e| e.id != memo_id);
            list.last_updated = chrono::Utc::now().timestamp_millis();

            self.write_list_json(&list)?;
        }
        // memo.json 单独写, 不在 list_io 锁内
        self.sync_memo_json_todos_on_delete(memo_id)
    }

    pub fn sync_memo_json_todos_on_delete(&self, memo_id: &str) -> std::io::Result<()> {
        let mut metadata = match self.read_memo_json() {
            Some(m) => m,
            None => return Ok(()),
        };

        metadata.todos.retain(|todo| todo.memo_id != memo_id);
        metadata.last_updated = chrono::Utc::now().timestamp_millis();

        self.write_memo_json(&metadata)
    }
}
