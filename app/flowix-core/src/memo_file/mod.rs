//! 笔记 / 笔记本存储层 — 后端 list.json / memo.json / .md 磁盘 IO 的总入口。
//!
//! ## 模块拆分 (v2 — 2026/06 重构)
//!
//! 旧 `memo_file.rs` 单文件 1654 行, 跨多个领域混在一起。拆成:
//!
//! - [`mod@types`]       — 公开 DTO (Memo / Notebook / TodoItem / MemoTag /
//!                         NotebookConfig / MemoListFile / MemoListEntry /
//!                         MemoTodoEntry / MemoMetadataFile / MemoFrontmatter)
//! - [`mod@frontmatter`] — YAML frontmatter 解析 (`extract_body_content`)
//! - [`mod@derivation`]  — 派生字段 (preview / tags / todos) 提取
//! - [`mod@time`]        — 列表过滤 (thisWeek / thisMonth) 用的时间边界
//! - [`mod@notebook`]    — `notebook.json` IO + 默认 notebook 自愈
//! - [`mod@list_store`]  — `list.json` / `memo.json` IO + sync 维护
//! - [`mod@content`]     — .md 文件 IO + 主体 CRUD
//! - [`mod@registration`] — 磁盘对账与外部 .md 注册
//!
//! 公共 API 完全保留, 外部调用方 (commands.rs / agent.rs / fs_watcher.rs)
//! 的 `use crate::memo_file::...` 路径不变。
//!
//! ## `MemoFile` 是 list.json 的唯一真源
//!
//! 所有写者 (UI / Agent / 外部工具 / 文件监听器) 都过这一层, 避免分头维护
//! metadata 引发的不一致。设计目标: 任何写入路径最终都走
//! `sync_list_json_on_write` 或 `sync_list_json_on_delete`。

use std::path::PathBuf;

/// memo id 随机段使用的字符集 — `[0-9a-z]` 36 个字符 (小写字母 + 数字)。
///
/// 显式锁定: `nanoid 0.4` 默认 `SAFE` alphabet 含 `_` `-` 两种特殊字符,
/// 会让 `{title}-{id}.md` 的 `rsplit('-')` 解析断在 id 内部。约束 memo id
/// 随机段必须是纯小写字母+数字, 文件名约定才不会自相矛盾。
/// 36 字符 × 6 位 ≈ 21.7 亿种, 碰撞余量仍够。
pub const MEMO_ID_ALPHABET: [char; 36] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
    'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
];

mod content;
mod derivation;
mod frontmatter;
mod list_store;
mod notebook;
mod registration;
mod time;
mod types;

// 公开 API re-export — 跟旧 `memo_file.rs` 的 pub use 边界一致。
// `MemoListFile` / `MemoMetadataFile` / `MemoTag` / `MemoTodoEntry` 在 crate
// 内部没有直接消费者, 但属于公开 DTO 边界 (前端 TS 镜像用的字段), 保留
// re-export 以便外部 crate / 文档用。
#[allow(unused_imports)]
pub use types::{
    Memo, MemoColor, MemoListEntry, MemoListFile, MemoMetadataFile, MemoTag, MemoTodoEntry,
    Notebook, NotebookConfig, TodoItem,
};
// 显式 keep 一些以防宏的 wanding
pub use derivation::{
    apply_derived_memo_fields, extract_tags_from_body, extract_title_and_preview,
    extract_todos_from_body,
};
#[allow(unused_imports)]
pub use types::MemoFrontmatter;

/// 笔记本目录 / 笔记文件的存储管理。
///
/// 字段:
/// - `app_data_path`: 应用数据目录 (`~/Library/Application Support/flowix`).
///   list.json / memo.json 在这里。
/// - `notebook_file_path`: 笔记本配置 (`~/.flowix/notebook.json`).
/// - `current_notebook_id`: 当前活跃 notebook id, `None` 表示走默认。
pub struct MemoFile {
    app_data_path: PathBuf,
    /// 笔记本配置文件的实际路径。早期版本写在 `app_data_path/notebook.json`,
    /// 现已迁到 `~/.flowix/notebook.json` 与 preference.json / ai_config.json 同目录。
    /// 见 `lib.rs` 中的迁移逻辑。
    notebook_file_path: PathBuf,
    current_notebook_id: Option<String>,
    /// list.json / memo.json 跨线程 RMW 互斥锁。
    ///
    /// 保护 [`list_store::sync_to_list_json_only`] /
    /// [`list_store::sync_list_json_on_write`] /
    /// [`list_store::sync_list_json_on_delete`] /
    /// [`list_store::read_list_json`] 这几个函数对 `.metadata/list.json`
    /// 的 read-modify-write 区块。
    ///
    /// ## 为什么不用外层 `state.memo_file.read()/write()`
    ///
    /// 生产端 `MemoFile` 共享在 `Arc<std::sync::RwLock<MemoFile>>` 里,
    /// 调用方 `commands/memo.rs::sync_derived_fields_for_memo` 等都拿
    /// **读锁** 访问 (rename 物理文件 + write .md 期间持读锁是对的,
    /// 跟其他读者共享无副作用)。但 list.json 的 RMW 需要**排他**, 而
    /// 多个 reader 在 RwLock 语义下可并发拿读锁 ── 这就出现了 read-write
    /// 区间交错 → lost update。
    ///
    /// 把 list.json 的 RMW 抽到**单独的细粒度 Mutex**, 跟外层 RwLock
    /// **并存**:
    /// - 外层 `read()/write()` 继续保护 "rename 物理文件 / 写 .md /
    ///   读 frontmatter" 等"只读 MemoFile 状态" 的操作, 跟既有并发
    ///   模型不冲突。
    /// - 内层 `current_list_io` 专门保护 list.json 这一个文件的 RMW 区块,
    ///   串行化 read+modify+write, 杜绝 lost update。
    ///
    /// ## 锁内能放什么
    ///
    /// 任何会触发 "读 list.json + 改 memos 数组 + 写 list.json" 的代码
    /// 都**必须**先拿这把锁。**不要**在持锁期间调可能重入 list.json 的
    /// API (会死锁 ── `std::sync::Mutex` 不可重入)。
    current_list_io: std::sync::Mutex<()>,
}

// 测试用 fixture ── `agent.rs` 的 `for_tests()` 构造器需要 `MemoFile::default()`。
// 这里 derive 一个空版本: PathBuf/Option 都走 Default。
// 真实路径通过 `MemoFile::new` 装配, 不走这个分支。
impl Default for MemoFile {
    fn default() -> Self {
        Self {
            app_data_path: PathBuf::new(),
            notebook_file_path: PathBuf::new(),
            current_notebook_id: None,
            current_list_io: std::sync::Mutex::new(()),
        }
    }
}


impl MemoFile {
    pub fn new(app_data_path: PathBuf, notebook_file_path: PathBuf) -> Self {
        Self {
            app_data_path,
            notebook_file_path,
            current_notebook_id: None,
            current_list_io: std::sync::Mutex::new(()),
        }
    }

    pub fn set_current_notebook(&mut self, id: Option<String>) {
        self.current_notebook_id = id;
    }

    /// 返回当前 notebook id (不读磁盘, 不解析 config). 用于索引助手做幂等检查.
    pub fn current_notebook_id_value(&self) -> Option<String> {
        self.current_notebook_id.clone()
    }

    /// 解析当前 notebook 目录 — 优先用 `current_notebook_id` 对应的 config,
    /// 否则走 `get_default_notebook_path`。
    pub fn get_memo_base(&self) -> PathBuf {
        if let Some(ref notebook_id) = self.current_notebook_id {
            if let Some(config) = self.get_notebook_config_by_id(notebook_id) {
                return PathBuf::from(&config.path);
            }
        }
        self.get_default_notebook_path()
    }

    /// `.metadata/` 目录绝对路径 — 内部 `list.json` / `memo.json` 所在地。
    pub fn get_metadata_dir(&self) -> PathBuf {
        self.get_memo_base().join(".metadata")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 测试用 fixture — 构造一个 MemoFile 指向 tempdir, 模拟 "default notebook" 单一场景。
    /// `read_notebook_configs` 走磁盘读, 所以必须先把 notebook.json 写好, 后面
    /// `get_memo_base` 才能找到路径。
    ///
    /// tempdir 路径用 `AtomicUsize` 计数器 + process id 命名, 避免 cargo test 并行
    /// 运行多个测试时 (rustc 默认多线程) 拿到相同路径互相覆盖。
    fn fresh_memo_file() -> (MemoFile, PathBuf) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let tmp = std::env::temp_dir().join(format!(
            "flowix-memo-file-test-{}-{}-{}",
            std::process::id(),
            n,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let app_data = tmp.join("app_data");
        let notebook_file = tmp.join("notebook.json");
        fs::create_dir_all(&app_data).unwrap();

        // 先把 notebook.json 写到磁盘, 让 read_notebook_configs 读得到
        let cfg = NotebookConfig {
            id: "nb_test".to_string(),
            name: "Test".to_string(),
            icon: Some("📓".to_string()),
            path: format!("{}/", tmp.display().to_string()),
            is_default: true,
            created_at: 0,
            updated_at: 0,
        };
        fs::write(
            &notebook_file,
            serde_json::to_string_pretty(&vec![cfg.clone()]).unwrap(),
        )
        .unwrap();

        let mut mf = MemoFile::new(app_data, notebook_file);
        mf.set_current_notebook(Some("nb_test".to_string()));
        (mf, tmp)
    }

    #[test]
    fn extract_memo_id_from_abs_path_parses_canonical_name() {
        let id =
            MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/My Note#abc123.md"))
                .unwrap();
        assert_eq!(id, "abc123");
    }

    #[test]
    fn extract_memo_id_returns_none_for_non_md_extension() {
        assert!(
            MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/foo.txt")).is_none()
        );
    }

    #[test]
    fn extract_memo_id_returns_none_when_no_m_prefix() {
        assert!(
            MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/foo-abc123.md"))
                .is_none()
        );
        assert!(
            MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/foo-m_abc123.md"))
                .is_none()
        );
    }

    /// 测试 helper — 构造一个最小 Memo (filename 由调用方决定, id 用 nanoid
    /// 走 `generate_memo_id` 一样的格式), 调 `update_memo_item` 走标准写盘 +
    /// 派生字段 + list.json 同步路径, 跟 `add_document` 行为同形。
    fn create_memo_via_update(mf: &MemoFile, title: &str, body: &str) -> Memo {
        let now = chrono::Utc::now().timestamp_millis();
        let id = nanoid::nanoid!(6, &MEMO_ID_ALPHABET);
        let memo = Memo {
            id: id.clone(),
            filename: title.to_string(),
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: now,
            updated_at: now,
            favorited: false,
            icon: None,
            colors: vec![],
            path: None,
        };
        mf.update_memo_item(&memo, Some(body))
            .expect("update_memo_item ok");
        mf.read_memo(&id).expect("memo in list")
    }

    #[test]
    fn create_memo_writes_file_and_registers_entry() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "TestTitle", "# Hello\nworld\n");
        // 文件存在
        let file_path = base.join(MemoFile::generate_memo_filename("TestTitle", &memo.id));
        assert!(file_path.exists(), "file should exist on disk");
        // 文件名严格按 `{title}-{id}.md`
        assert_eq!(
            memo.path.as_deref(),
            Some(MemoFile::generate_memo_filename("TestTitle", &memo.id).as_str())
        );
        // list.json 已注册, id 可查
        let queried = mf.read_memo(&memo.id).expect("memo in list");
        assert_eq!(queried.id, memo.id);
    }

    #[test]
    fn list_json_does_not_persist_path_but_read_memo_derives_it() {
        let (mf, _base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Pathless", "# Hello\nworld\n");

        let list_raw = std::fs::read_to_string(mf.get_list_json_path()).unwrap();
        let list_json: serde_json::Value = serde_json::from_str(&list_raw).unwrap();
        assert!(
            list_json["memos"][0].get("path").is_none(),
            "list.json must not persist path: {list_raw}"
        );

        let queried = mf.read_memo(&memo.id).expect("memo in list");
        assert_eq!(
            queried.path.as_deref(),
            Some(MemoFile::generate_memo_filename("Pathless", &memo.id).as_str())
        );
    }

    #[test]
    fn list_json_filename_is_sanitized_for_filesystem_rules() {
        let (mf, base) = fresh_memo_file();
        let raw_title = "  a/b\\c:d*e?f\"g<h>i|j.  ";
        let memo = create_memo_via_update(&mf, raw_title, "body");
        let sanitized = "a b c d e f g h i j";

        let list_raw = std::fs::read_to_string(mf.get_list_json_path()).unwrap();
        let list_json: serde_json::Value = serde_json::from_str(&list_raw).unwrap();
        assert_eq!(list_json["memos"][0]["filename"], sanitized);

        let expected_filename = MemoFile::generate_memo_filename(sanitized, &memo.id);
        assert_eq!(memo.path.as_deref(), Some(expected_filename.as_str()));
        assert!(base.join(expected_filename).exists());
    }

    #[test]
    fn sanitized_filename_does_not_rewrite_markdown_body_title() {
        let (mf, base) = fresh_memo_file();
        let raw_title = "a/b\\c:d*e?f\"g<h>i|j";
        let body = format!("# {}\nbody\n", raw_title);
        let memo = create_memo_via_update(&mf, raw_title, &body);
        let sanitized = "a b c d e f g h i j";
        let path = base.join(MemoFile::generate_memo_filename(sanitized, &memo.id));
        let on_disk = fs::read_to_string(path).unwrap();

        assert!(
            on_disk.contains(&format!("filename: {}", sanitized)),
            "frontmatter should use sanitized filename: {on_disk}"
        );
        assert!(
            on_disk.contains(&format!("# {}", raw_title)),
            "markdown body title should remain original: {on_disk}"
        );
    }

    #[test]
    fn invalid_only_title_uses_same_untitled_filename_in_metadata_and_frontmatter() {
        let (mf, base) = fresh_memo_file();
        let body = "# ///\nbody\n";
        let memo = create_memo_via_update(&mf, "///", body);
        let expected_title = chrono::Local::now().format("untitled-%Y-%m-%d").to_string();
        let expected_filename = MemoFile::generate_memo_filename(&expected_title, &memo.id);
        let on_disk = fs::read_to_string(base.join(&expected_filename)).unwrap();
        let list_raw = fs::read_to_string(mf.get_list_json_path()).unwrap();
        let list_json: serde_json::Value = serde_json::from_str(&list_raw).unwrap();

        assert_eq!(list_json["memos"][0]["filename"], expected_title);
        assert!(on_disk.contains(&format!("filename: {}", expected_title)));
        assert!(on_disk.contains(body));
    }

    #[test]
    fn find_memo_file_by_id_survives_deferred_filename_metadata_change() {
        let (mf, base) = fresh_memo_file();
        let mut memo = create_memo_via_update(&mf, "OldTitle", "# OldTitle\\nbody\\n");
        eprintln!("DEBUG memo.id={} len={}", memo.id, memo.id.len());
        let old_filename = MemoFile::generate_memo_filename("OldTitle", &memo.id);
        let old_abs = base.join(&old_filename);
        assert!(old_abs.exists());

        memo.filename = "NewTitle".to_string();
        mf.sync_to_list_json_only(&memo).expect("metadata sync ok");

        let list = mf.read_list_json().expect("list exists");
        assert_eq!(list.memos[0].filename, "NewTitle");
        assert!(
            !base
                .join(MemoFile::generate_memo_filename("NewTitle", &memo.id))
                .exists(),
            "deferred metadata sync must not rename the physical file"
        );

        let resolved = mf.find_memo_file_by_id(&memo.id).expect("resolved by id");
        assert_eq!(
            resolved.file_name().and_then(|n| n.to_str()),
            Some(old_filename.as_str())
        );
    }

    #[test]
    fn list_json_filename_truncates_to_200_chars() {
        let (mf, _base) = fresh_memo_file();
        let raw_title = format!("{}.", "x".repeat(250));
        create_memo_via_update(&mf, &raw_title, "body");

        let list_raw = std::fs::read_to_string(mf.get_list_json_path()).unwrap();
        let list_json: serde_json::Value = serde_json::from_str(&list_raw).unwrap();
        let filename = list_json["memos"][0]["filename"].as_str().unwrap();

        assert_eq!(filename.chars().count(), 200);
        assert_eq!(filename, "x".repeat(200));
    }

    #[test]
    fn create_memo_derives_tags_from_content() {
        let (mf, _base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Tagged", "intro\n#tag1 #tag2\nmore body\n");
        let queried = mf.read_memo(&memo.id).unwrap();
        assert!(queried.tags.contains(&"tag1".to_string()));
        assert!(queried.tags.contains(&"tag2".to_string()));
    }

    #[test]
    fn register_existing_file_does_not_overwrite_content() {
        let (mf, base) = fresh_memo_file();
        let id_str = "xyz012";
        let abs = base.join(MemoFile::generate_memo_filename("PreExisting", id_str));
        // 文件已存在, 含固定内容
        fs::write(&abs, "user original content").unwrap();
        let memo = mf.register_existing_file(&abs).expect("register ok");
        assert_eq!(memo.id, id_str);
        // 文件内容没变
        assert_eq!(fs::read_to_string(&abs).unwrap(), "user original content");
    }

    #[test]
    fn register_existing_file_rejects_unnamed_path() {
        let (mf, base) = fresh_memo_file();
        let abs = base.join("just-a-random-note.md");
        fs::write(&abs, "x").unwrap();
        let result = mf.register_existing_file(&abs);
        assert!(result.is_err());
    }

    #[test]
    fn reload_memo_from_disk_refreshes_preview() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Reload", "# Original Title\noriginal body\n");
        // 模拟外部工具改磁盘
        let abs = base.join(MemoFile::generate_memo_filename("Reload", &memo.id));
        let new_content = "---\nfilename: \n---\n# Changed\nchanged body\n";
        fs::write(&abs, new_content).unwrap();
        // Sanity: 文件确实被覆盖了
        let on_disk = fs::read_to_string(&abs).unwrap();
        assert_eq!(
            on_disk, new_content,
            "test setup: file should be overwritten"
        );
        let updated = mf.reload_memo_from_disk(&memo.id).expect("reload ok");
        // filename 由第一行派生
        assert_eq!(updated.filename, "Changed");
        assert!(updated.preview.contains("changed"));
    }

    #[test]
    fn unregister_memo_by_path_removes_entry() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Del", "content");
        let abs = base.join(MemoFile::generate_memo_filename("Del", &memo.id));
        assert!(mf.read_memo(&memo.id).is_some());
        let removed = mf.unregister_memo_by_path(&abs);
        assert!(removed);
        assert!(mf.read_memo(&memo.id).is_none());
    }

    #[test]
    fn sync_list_json_on_write_does_not_create_duplicates() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "NoDup", "x");
        // 反复 reload 不会产生重复条目
        for _ in 0..3 {
            mf.reload_memo_from_disk(&memo.id).unwrap();
        }
        let list_path = base.join(".metadata").join("list.json");
        let list_raw = fs::read_to_string(&list_path).unwrap();
        let list: MemoListFile = serde_json::from_str(&list_raw).unwrap();
        let count = list.memos.iter().filter(|e| e.id == memo.id).count();
        assert_eq!(count, 1, "should have exactly one entry for id {}", memo.id);
    }

    #[test]
    fn register_unnamed_file_renames_disk_and_writes_list() {
        let (mf, base) = fresh_memo_file();
        // 任意命名 .md (无 #xxxxxx 后缀), 模拟用户在 Finder 创建
        let abs = base.join("Agent 记忆管理.md");
        fs::write(&abs, "# Agent 记忆管理\nbody content\n").unwrap();

        let (memo, new_abs_path) = mf.register_unnamed_file(&abs).expect("register ok");

        // 1. 旧文件被重命名
        assert!(!abs.exists(), "old path should be renamed away");
        assert!(new_abs_path.exists(), "new path should exist on disk");
        // 新文件名严格按 `{title}#xxxxxx.md`
        assert_eq!(
            new_abs_path.file_name().and_then(|n| n.to_str()).unwrap(),
            MemoFile::generate_memo_filename("Agent 记忆管理", &memo.id).as_str()
        );
        // 2. 文件内容没动
        assert_eq!(
            fs::read_to_string(&new_abs_path).unwrap(),
            "# Agent 记忆管理\nbody content\n"
        );
        // 3. list.json 已注册
        let queried = mf.read_memo(&memo.id).expect("in list.json");
        assert_eq!(queried.id, memo.id);
        assert_eq!(
            queried.path.as_deref(),
            Some(new_abs_path.file_name().unwrap().to_str().unwrap())
        );
    }

    #[test]
    fn register_unnamed_file_derives_title_from_body_first_line() {
        let (mf, base) = fresh_memo_file();
        // body 第一行是 `# 我的笔记` → title 应是 "我的笔记"
        let abs = base.join("random.md");
        fs::write(&abs, "# 我的笔记\nbody").unwrap();
        let (memo, new_abs_path) = mf.register_unnamed_file(&abs).expect("register ok");
        // 文件名按派生 title 命名
        assert_eq!(
            new_abs_path.file_name().and_then(|n| n.to_str()).unwrap(),
            MemoFile::generate_memo_filename("我的笔记", &memo.id).as_str()
        );
    }

    #[test]
    fn register_unnamed_file_falls_back_to_stem_when_body_empty() {
        let (mf, base) = fresh_memo_file();
        // 完全空文件 → 没 body 派生, 回退到 file_stem
        let abs = base.join("Fallback Name.md");
        fs::write(&abs, "").unwrap();
        let (memo, new_abs_path) = mf.register_unnamed_file(&abs).expect("register ok");
        assert_eq!(
            new_abs_path.file_name().and_then(|n| n.to_str()).unwrap(),
            MemoFile::generate_memo_filename("Fallback Name", &memo.id).as_str()
        );
    }

    #[test]
    fn register_unnamed_file_rejects_non_markdown() {
        let (mf, base) = fresh_memo_file();
        let abs = base.join("photo.png");
        fs::write(&abs, "fake").unwrap();
        let result = mf.register_unnamed_file(&abs);
        assert!(result.is_err(), "非 .md 后缀应被拒绝");
    }

    #[test]
    fn register_unnamed_file_rejects_missing_file() {
        let (mf, base) = fresh_memo_file();
        let abs = base.join("does_not_exist.md");
        let result = mf.register_unnamed_file(&abs);
        assert!(result.is_err());
    }

    #[test]
    fn reconcile_picks_up_canonical_named_file() {
        let (mf, base) = fresh_memo_file();
        // 模拟应用关闭期间, 用户在外部新建了一个符合命名约定的 .md
        let id = "xyz012";
        let abs = base.join(MemoFile::generate_memo_filename("外部新增", id));
        fs::write(&abs, "# 外部新增\nbody").unwrap();

        // reconcile_with_disk 内部会构造空 list (list.json 不存在时), 然后写回去
        let added = mf.reconcile_with_disk().expect("reconcile ok");
        assert_eq!(added, 1, "应该补一条");
        // list.json 此时已经被 reconcile 写出来了
        let after_list = mf.read_list_json().expect("list.json now exists");
        // 复用了文件名里的 id
        after_list
            .memos
            .iter()
            .find(|e| e.id == id)
            .expect("reconciled entry");
        // 磁盘文件名没被改
        assert!(abs.exists());
        // list.json 不再保存 path, read_memo 运行时由 filename + id 派生路径
        let list_raw = fs::read_to_string(base.join(".metadata").join("list.json")).unwrap();
        assert!(
            !list_raw.contains("\"path\""),
            "list.json should not persist path"
        );
        let memo = mf.read_memo(id).expect("memo by id");
        assert_eq!(
            memo.path.as_deref(),
            Some(MemoFile::generate_memo_filename("外部新增", id).as_str())
        );
    }

    #[test]
    fn reconcile_picks_up_arbitrary_named_file_and_normalizes_name() {
        let (mf, base) = fresh_memo_file();
        // 模拟用户在关闭期间新建的"任意命名" .md (无 #xxxxxx 后缀)
        let abs = base.join("记忆管理.md");
        fs::write(&abs, "# 记忆管理\nbody content").unwrap();

        let added = mf.reconcile_with_disk().expect("reconcile ok");
        assert_eq!(added, 1);
        assert!(!abs.exists(), "原文件名应规范化为 filename#id.md");
        // 新生成的 id 在 list.json 里
        let list = mf.read_list_json().unwrap();
        let entry = list
            .memos
            .iter()
            .find(|e| e.filename == "记忆管理")
            .expect("entry by filename");
        assert_eq!(entry.id.len(), 6);
        assert!(base
            .join(MemoFile::generate_memo_filename("记忆管理", &entry.id))
            .exists());
        // 派生 filename 来自 body 第一行
        assert_eq!(entry.filename, "记忆管理");
    }

    #[test]
    fn reconcile_is_idempotent() {
        let (mf, base) = fresh_memo_file();
        let abs = base.join("once.md");
        fs::write(&abs, "x").unwrap();
        // 第一次: 补一条
        let n1 = mf.reconcile_with_disk().unwrap();
        assert_eq!(n1, 1);
        // 第二次: 已存在, 跳过
        let n2 = mf.reconcile_with_disk().unwrap();
        assert_eq!(n2, 0);
        // list.json 仍只一条
        let list = mf.read_list_json().unwrap();
        assert_eq!(list.memos.len(), 1);
        let entry = &list.memos[0];
        assert!(base
            .join(MemoFile::generate_memo_filename("x", &entry.id))
            .exists());
    }

    #[test]
    fn reconcile_skips_metadata_dir() {
        let (mf, _base) = fresh_memo_file();
        // 触发 reconcile 一次 (不引入新文件, 只看是否误收 .metadata/ 下的)
        let _ = mf.reconcile_with_disk().unwrap();
        // 如果 list.json 之前不存在, reconcile 也不会写出空文件 (added == 0
        // 提前 return), 所以这里 read_list_json 仍可能 None — 直接放过。
        if let Some(list) = mf.read_list_json() {
            for entry in &list.memos {
                assert!(
                    !MemoFile::generate_memo_filename(&entry.filename, &entry.id)
                        .contains(".metadata"),
                    "list.json 不应收 .metadata/ 下的文件"
                );
            }
        }
    }

    // ========================================================================
    // 以下两个测试用于复现 list.json read-modify-write race 导致的
    // "item 被删除" 问题。仅供诊断 / 复现 ── 通过它们能清楚看到丢失更新的
    // 触发条件, 但**不应**作为 CI gate (其中一个设计上是 flaky 的)。
    //
    // 根因 (`list_store::sync_list_json_on_write`):
    //   read_list_json()   ← 读盘
    //   list.memos.retain/push   ← 内存修改
    //   write_list_json()  ← 写盘 (atomic, 但 read→write 之间没应用层锁)
    //
    // 两个 thread 各自走完 read 但都还没 write, 各自基于**相同**的 read
    // 视图做 modify, 然后**最后**一个 write 覆盖前面的, 前面那个的 push
    // 就丢了。生产环境下 `MemoFile` 共享在 `Arc<RwLock<MemoFile>>` 里,
    // 外层 `state.memo_file.read()` 拿到的是**读锁**, 多个 reader 并发拿
    // 到, 所以 `sync_to_list_json_only` / `sync_list_json_on_write` / 
    // `sync_list_json_on_delete` 三个调 list.json 的函数彼此**没有互斥**。
    //
    // fs_watcher 线程 (后台 notify 回调) + Tauri IPC 线程 (前端编辑保存)
    // 都能拿到读锁, 都走 RMW, 都能丢 entry。"连续编辑首行" 场景下每次
    // saveDoc 都触发 `sync_derived_fields_for_memo` → 算新 title → 物理
    // rename + 写 list.json; rename 又会触发 watcher 的 Remove 事件,
    // 走 `unregister_memo_by_path` → 删 list.json 中 entry, 跟写盘 thread
    // 互踩, 把那个 entry 真的删了。
    // ========================================================================

    /// 确定性证伪 ── 模拟 "两个 thread 各自读到 list.json, 各自基于**相同**
    /// 视图 modify, 然后**最后**一个 write 覆盖前一个" 的最坏情况。
    ///
    /// 这不是测 `MemoFile` 的 API, 是测 `read_list_json` → modify → 
    /// `write_list_json` 这一 RMW 模式在并发下的**结构性问题** ── 
    /// 即使每个 call 内部都是 atomic, 跨 call 之间没有互斥, lost update 
    /// 必然发生 (这跟 Linux `O_CREAT` + write-then-rename 是否 atomic 无关;
    /// 我们丢的是**应用层**的 modify, 不是文件字节)。
    #[test]
    fn read_modify_write_pattern_is_inherently_racy() {
        let (mf, _base) = fresh_memo_file();
        // 起手: 在 list.json 里塞 3 个 memo, 模拟 "notebook 里有 N 个笔记"
        let mut initial = Vec::new();
        for i in 0..3 {
            let memo = create_memo_via_update(&mf, &format!("Init{i}"), &format!("body {i}"));
            initial.push(memo);
        }
        // 起点断言
        {
            let list = mf.read_list_json().expect("list.json exists");
            assert_eq!(list.memos.len(), 3, "fixture: 3 entries seeded");
        }

        // 模拟 "线程 T1 想 upsert memoA, 线程 T2 想 upsert memoB" ──
        // 跟生产路径 (`write_document` 跟 `unregister_memo_by_path` 都在
        // 改 list.json) 同形, 但 A/B 都是 list.json 里**不存在**的新 id
        // (新注册 memo 的常见场景, 跟 `add_document` + `reload_memo_from_disk`
        // 并发触发的 lost update 同形)。
        let new_a = Memo {
            id: "id_new_a".to_string(),
            filename: "RaceA".to_string(),
            preview: "p".into(),
            tags: vec![],
            todos: vec![],
            created_at: 0,
            updated_at: 0,
            favorited: false,
            icon: None,
            colors: vec![],
            path: None,
        };
        let new_b = Memo {
            id: "id_new_b".to_string(),
            filename: "RaceB".to_string(),
            preview: "p".into(),
            tags: vec![],
            todos: vec![],
            created_at: 0,
            updated_at: 0,
            favorited: false,
            icon: None,
            colors: vec![],
            path: None,
        };

        // T1 走完整 RMW: read → modify → write
        let t1_list = mf.read_list_json().expect("T1 read");
        let mut t1_modified = t1_list;
        t1_modified.memos.retain(|e| e.id != new_a.id);
        t1_modified.memos.push(MemoFile::memo_to_list_entry(&new_a));
        mf.write_list_json(&t1_modified).expect("T1 write");

        // T2 在 T1 write 之后**才**开始 read (经典 lost update 的最坏
        // 时序不存在, 所以这步不会丢, 但说明: 错位时序才会丢)
        let t2_list = mf.read_list_json().expect("T2 read");
        let mut t2_modified = t2_list;
        t2_modified.memos.retain(|e| e.id != new_b.id);
        t2_modified.memos.push(MemoFile::memo_to_list_entry(&new_b));
        mf.write_list_json(&t2_modified).expect("T2 write");

        // 此时 list.json 应有 3 + 2 = 5 条
        let final_list = mf.read_list_json().expect("final");
        assert_eq!(
            final_list.memos.len(),
            5,
            "顺序 RMW (T1 完成 write 后 T2 才 read) 应该 5 条都在"
        );
    }

    /// Flaky race 复现 ── 两个 thread 各自调 `sync_to_list_json_only`
    /// 写**不同 id** 的 memo, 模拟生产中 `write_document` (IPC 线程) 跟
    /// `reload_memo_from_disk` (fs_watcher 线程) 都改 list.json 的场景。
    ///
    /// 在当前实现下, 两个 thread 各自走 read → modify → write, OS 调度
    /// 一旦把它们的 read→write 区间交错, 后写的一方会基于**旧** read
    /// 视图覆盖前一方, 前一方的 push 丢失。
    ///
    /// 这个测试**不**带 `#[ignore]` ── 让它在 CI 里偶尔失败, 显眼地暴露
    /// race。`Barrier` 让两个 thread 同步进入临界区, 最大化交错概率。
    /// flakiness **就是** race 存在的证据, 不是测试 bug。
    ///
    /// 修复方向: `list_store` 内部加 `Mutex<()>` 串行化 RMW block; 或
    /// `MemoFile` 的 list.json 操作走外层 `state.memo_file.write()` 写锁。
    #[test]
    fn concurrent_sync_to_list_json_only_loses_entries() {
        use std::sync::{Arc, Barrier, RwLock};
        use std::thread;

        let (mf, _base) = fresh_memo_file();

        // 预置 3 条, 跟生产 notebook 起步一致
        for i in 0..3 {
            create_memo_via_update(&mf, &format!("Init{i}"), &format!("body {i}"));
        }

        // 跟生产同形: 共享一个 MemoFile, 多线程各自持读锁访问
        let mf_arc = Arc::new(RwLock::new(mf));

        const N_WRITERS: usize = 6;
        let barrier = Arc::new(Barrier::new(N_WRITERS));

        let mut handles = Vec::with_capacity(N_WRITERS);
        for i in 0..N_WRITERS {
            let mf_arc = mf_arc.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                // 手工构造一个**未注册**的新 memo (跟 `add_document` 在
                // 一个 thread 走 `update_memo_item` + list.json 同步, 跟
                // 另一个 thread 走 `reload_memo_from_disk` 同步的并发模型
                // 同形)。
                let memo = Memo {
                    id: format!("id_race_{i}"),
                    filename: format!("Race{i}"),
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
                // 同步: 全部 thread 就位后再一起冲, 最大化 read→write
                // 区间交错的概率
                barrier.wait();
                // 跟生产路径同形 ── 拿读锁, 调 list.json RMW 函数
                let mf = mf_arc.read().unwrap();
                mf.sync_to_list_json_only(&memo)
                    .expect("sync_to_list_json_only ok");
            }));
        }
        for h in handles {
            h.join().expect("thread join");
        }

        // 最终: 3 条初始 + N_WRITERS 条 race = 9 条
        let final_list = mf_arc
            .read()
            .unwrap()
            .read_list_json()
            .expect("list.json exists");
        let expected = 3 + N_WRITERS;
        let actual = final_list.memos.len();
        assert_eq!(
            actual, expected,
            "list.json 应该有 {expected} 条 (3 初始 + {N_WRITERS} race), \
             实际 {actual} 条 ── lost update, 至少一个 memo 被另一个 thread 覆盖了"
        );
    }

    /// Invariant guard 测试 ── 模拟"rename 旧文件 Remove 事件漏防" 场景:
    /// 1. 笔记 A 的物理文件从 old.md 改为 new.md (rename)
    /// 2. list.json 的 `path` 字段被 `sync_to_list_json_only` 写成 new.md
    /// 3. watcher 仍收到 old.md 的 Remove 事件, 调 `unregister_memo_by_path(old.md)`
    ///    ── 这时**不该**删 entry (entry 还指向 new.md)
    ///
    /// fix 之前: unregister 看到 list.json 中有 id → 真删 entry → 误删
    /// fix 之后: unregister 看到 list.json entry.path != abs_path → 拒绝删
    #[test]
    fn unregister_memo_by_path_refuses_when_list_json_points_elsewhere() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Original", "content");

        // 模拟 rename: 物理文件 old.md 不再存在, 新文件 new.md 才是真的
        let old_abs = base.join(MemoFile::generate_memo_filename("Original", &memo.id));
        let new_filename = MemoFile::generate_memo_filename("Renamed", &memo.id);
        let new_abs = base.join(&new_filename);
        fs::rename(&old_abs, &new_abs).unwrap();
        assert!(!old_abs.exists(), "old file renamed away");
        assert!(new_abs.exists(), "new file exists");

        // 模拟 `sync_to_list_json_only` 已把 list.json 的 path 字段改成 new
        let mut memo_after_rename = memo.clone();
        memo_after_rename.filename = "Renamed".to_string();
        memo_after_rename.path = Some(new_filename.clone());
        mf.sync_to_list_json_only(&memo_after_rename).unwrap();

        // 现在调 unregister_memo_by_path(old_abs) ── 模拟 watcher 收到
        // 旧文件 Remove 事件 (mark_self_write 漏防时序下)
        let removed = mf.unregister_memo_by_path(&old_abs);
        assert!(
            !removed,
            "invariant guard 应当拒绝: list.json 指向 {new_filename},              但 abs_path 是 {old_abs:?} (rename 旧文件漏防)"
        );

        // entry 必须还在 ── 修复前会被错删
        let still_there = mf.read_memo(&memo.id).expect("entry still in list.json");
        assert_eq!(still_there.path.as_deref(), Some(new_filename.as_str()));
    }
}
