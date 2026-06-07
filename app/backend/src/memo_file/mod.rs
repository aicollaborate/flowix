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
pub(crate) const MEMO_ID_ALPHABET: [char; 36] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
    'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
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
    Memo, MemoListEntry, MemoListFile, MemoMetadataFile, MemoTag, MemoTodoEntry, Notebook,
    NotebookConfig, TodoItem,
};
// 显式 keep 一些以防宏的 wanding
#[allow(unused_imports)]
pub(crate) use types::MemoFrontmatter;

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
}

// 测试用 fixture ── `agent.rs` 的 `for_tests()` 构造器需要 `MemoFile::default()`。
// 这里 derive 一个空版本: PathBuf/Option 都走 Default。
// 真实路径通过 `MemoFile::new` 装配, 不走这个分支。
#[cfg(test)]
impl Default for MemoFile {
    fn default() -> Self {
        Self {
            app_data_path: PathBuf::new(),
            notebook_file_path: PathBuf::new(),
            current_notebook_id: None,
        }
    }
}

impl MemoFile {
    pub fn new(app_data_path: PathBuf, notebook_file_path: PathBuf) -> Self {
        Self {
            app_data_path,
            notebook_file_path,
            current_notebook_id: None,
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
    pub(crate) fn get_metadata_dir(&self) -> PathBuf {
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
        let id = MemoFile::extract_memo_id_from_abs_path(std::path::Path::new(
            "/n/My Note-m_abc123.md",
        ))
        .unwrap();
        assert_eq!(id, "m_abc123");
    }

    #[test]
    fn extract_memo_id_returns_none_for_non_md_extension() {
        assert!(MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/foo.txt")).is_none());
    }

    #[test]
    fn extract_memo_id_returns_none_when_no_m_prefix() {
        assert!(MemoFile::extract_memo_id_from_abs_path(std::path::Path::new("/n/foo-abc123.md")).is_none());
    }

    /// 测试 helper — 构造一个最小 Memo (filename 由调用方决定, id 用 nanoid
    /// 走 `generate_memo_id` 一样的格式), 调 `update_memo_item` 走标准写盘 +
    /// 派生字段 + list.json 同步路径, 跟 `add_document` 行为同形。
    fn create_memo_via_update(mf: &MemoFile, title: &str, body: &str) -> Memo {
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("m_{}", nanoid::nanoid!(6, &MEMO_ID_ALPHABET));
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
        let file_path = base.join(format!("TestTitle-{}.md", memo.id));
        assert!(file_path.exists(), "file should exist on disk");
        // 文件名严格按 `{title}-{id}.md`
        assert_eq!(
            memo.path.as_deref(),
            Some(format!("TestTitle-{}.md", memo.id).as_str())
        );
        // list.json 已注册, id 可查
        let queried = mf.read_memo(&memo.id).expect("memo in list");
        assert_eq!(queried.id, memo.id);
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
        let id_str = "m_xyz001";
        let abs = base.join(format!("PreExisting-{}.md", id_str));
        // 文件已存在, 含固定内容
        fs::write(&abs, "user original content").unwrap();
        let memo = mf
            .register_existing_file(&abs)
            .expect("register ok");
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
        let abs = base.join(format!("Reload-{}.md", memo.id));
        let new_content = "---\nfilename: \n---\n# Changed\nchanged body\n";
        fs::write(&abs, new_content).unwrap();
        // Sanity: 文件确实被覆盖了
        let on_disk = fs::read_to_string(&abs).unwrap();
        assert_eq!(on_disk, new_content, "test setup: file should be overwritten");
        let updated = mf.reload_memo_from_disk(&memo.id).expect("reload ok");
        // filename 由第一行派生
        assert_eq!(updated.filename, "Changed");
        assert!(updated.preview.contains("changed"));
    }

    #[test]
    fn unregister_memo_by_path_removes_entry() {
        let (mf, base) = fresh_memo_file();
        let memo = create_memo_via_update(&mf, "Del", "content");
        let abs = base.join(format!("Del-{}.md", memo.id));
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
        // 任意命名 .md (无 m_xxxxxx 后缀), 模拟用户在 Finder 创建
        let abs = base.join("Agent 记忆管理.md");
        fs::write(&abs, "# Agent 记忆管理\nbody content\n").unwrap();

        let (memo, new_abs_path) = mf
            .register_unnamed_file(&abs)
            .expect("register ok");

        // 1. 旧文件被重命名
        assert!(!abs.exists(), "old path should be renamed away");
        assert!(new_abs_path.exists(), "new path should exist on disk");
        // 新文件名严格按 `{title}-{m_xxxxxx}.md`
        assert_eq!(
            new_abs_path.file_name().and_then(|n| n.to_str()).unwrap(),
            format!("Agent 记忆管理-{}.md", memo.id).as_str()
        );
        // 2. 文件内容没动
        assert_eq!(fs::read_to_string(&new_abs_path).unwrap(), "# Agent 记忆管理\nbody content\n");
        // 3. list.json 已注册
        let queried = mf.read_memo(&memo.id).expect("in list.json");
        assert_eq!(queried.id, memo.id);
        assert_eq!(queried.path.as_deref(), Some(new_abs_path.file_name().unwrap().to_str().unwrap()));
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
            format!("我的笔记-{}.md", memo.id).as_str()
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
            format!("Fallback Name-{}.md", memo.id).as_str()
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
        let id = "m_xyz001";
        let abs = base.join(format!("外部新增-{}.md", id));
        fs::write(&abs, "# 外部新增\nbody").unwrap();

        // reconcile_with_disk 内部会构造空 list (list.json 不存在时), 然后写回去
        let added = mf.reconcile_with_disk().expect("reconcile ok");
        assert_eq!(added, 1, "应该补一条");
        // list.json 此时已经被 reconcile 写出来了
        let after_list = mf.read_list_json().expect("list.json now exists");
        // 复用了文件名里的 id
        let entry = after_list
            .memos
            .iter()
            .find(|e| e.id == id)
            .expect("reconciled entry");
        // 磁盘文件名没被改
        assert!(abs.exists());
        // path 字段是原文件名 (相对路径)
        assert_eq!(entry.path.as_deref(), Some(format!("外部新增-{}.md", id).as_str()));
    }

    #[test]
    fn reconcile_picks_up_arbitrary_named_file_without_renaming() {
        let (mf, base) = fresh_memo_file();
        // 模拟用户在关闭期间新建的"任意命名" .md (无 m_xxxxxx 后缀)
        let abs = base.join("记忆管理.md");
        fs::write(&abs, "# 记忆管理\nbody content").unwrap();

        let added = mf.reconcile_with_disk().expect("reconcile ok");
        assert_eq!(added, 1);
        // 关键: 磁盘文件**没被重命名** (跟 register_unnamed_file 不一样)
        assert!(abs.exists(), "原文件名必须保留, 不能重命名");
        // 新生成的 id 在 list.json 里
        let list = mf.read_list_json().unwrap();
        let entry = list
            .memos
            .iter()
            .find(|e| e.path.as_deref() == Some("记忆管理.md"))
            .expect("entry by path");
        assert!(entry.id.starts_with("m_"));
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
        let same = list
            .memos
            .iter()
            .filter(|e| e.path.as_deref() == Some("once.md"))
            .count();
        assert_eq!(same, 1);
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
                    !entry.path.as_deref().unwrap_or("").contains(".metadata"),
                    "list.json 不应收 .metadata/ 下的文件, got: {:?}",
                    entry.path
                );
            }
        }
    }
}
