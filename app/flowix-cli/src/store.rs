//! CLI 命令实现 ── 在 `memo_file` 之上做薄包装。
//!
//! M1: `cmd_notebooks`
//! M2: `cmd_list` / `cmd_show`
//! M3: `cmd_new` (含编辑器集成)

use crate::{errors::CliError, fmt, paths};
use flowix_core::memo_file::{MemoFile, NotebookConfig};

/// 构造一个 `MemoFile`, 走 `paths::resolve()` 解析的数据目录。
pub fn open() -> Result<MemoFile, CliError> {
    let p = paths::resolve()?;
    Ok(MemoFile::new(p.app_data, p.notebook_file))
}

/// `flowix-cli notebooks --json` ── 输出 JSON 形式。
pub fn cmd_notebooks_json() -> Result<(), CliError> {
    let mf = open()?;
    let configs = mf.read_notebook_configs().unwrap_or_default();
    fmt::print_notebooks_json(&configs);
    Ok(())
}

/// `flowix-cli notebooks` ── 列出所有 notebook。
pub fn cmd_notebooks() -> Result<(), CliError> {
    let mf = open()?;
    let configs = mf.read_notebook_configs().unwrap_or_default();
    if configs.is_empty() {
        // 区分"配置文件不存在" vs "存在但解析失败"。
        // 当前 `read_notebook_configs` 用 `unwrap_or_default()` 吞错,
        // 区分不出来; 暂只覆盖"配置文件不存在"这一种最常见情况。
        let path = paths::resolve()?.notebook_file;
        if !path.exists() {
            return Err(CliError::NotFound(format!(
                "notebook config not found at {}",
                path.display()
            )));
        }
    }
    fmt::print_notebooks(&configs);
    Ok(())
}

/// 按 `name` 或 `id` 找 notebook。id 优先, 避免同名 notebook 歧义。
pub fn find_notebook<'a>(configs: &'a [NotebookConfig], key: &str) -> Option<&'a NotebookConfig> {
    configs
        .iter()
        .find(|c| c.id == key)
        .or_else(|| configs.iter().find(|c| c.name == key))
}

/// 给定 notebook key, 构造一个 set_current_notebook 完的 MemoFile。
fn open_in(notebook_key: &str) -> Result<(MemoFile, NotebookConfig), CliError> {
    let mf = open()?;
    let configs = mf.read_notebook_configs().unwrap_or_default();
    let nb = find_notebook(&configs, notebook_key)
        .ok_or_else(|| {
            CliError::NotFound(format!(
                "notebook `{notebook_key}` (try `flowix-cli notebooks` to list)"
            ))
        })?
        .clone();
    let mut mf = open()?;
    mf.set_current_notebook(Some(nb.id.clone()));
    Ok((mf, nb))
}

/// `flowix-cli list <notebook> --json` ── 输出 JSON 形式。
pub fn cmd_list_json(notebook_key: &str) -> Result<(), CliError> {
    let (mf, _nb) = open_in(notebook_key)?;
    let list = mf.read_list_json().unwrap_or_default();
    fmt::print_notes_json(&list.memos);
    Ok(())
}

/// `flowix-cli list <notebook>` ── 列出某 notebook 下的笔记。
pub fn cmd_list(notebook_key: &str) -> Result<(), CliError> {
    let (mf, _nb) = open_in(notebook_key)?;
    let list = mf.read_list_json().unwrap_or_default();
    fmt::print_notes(&list.memos);
    Ok(())
}

/// `flowix-cli show <id>` ── 读一条笔记到 stdout。
///
/// `<id>` 解析顺序 (见设计 §4.1):
/// 1. 完整 `nb#shortid` (用户从 list 输出直接复制粘贴) → 单 notebook 查
/// 2. 单段 shortid 扫所有 notebook
/// 3. 文件名 basename (去 .md) 扫所有 notebook
pub fn cmd_show(id_arg: &str) -> Result<(), CliError> {
    // 1. 完整 id (含 #): notebook key 是 # 前那段
    if id_arg.contains('#') {
        let nb_key = id_arg.split('#').next().unwrap_or("");
        let (mf, _nb) = open_in(nb_key)?;
        return print_one(&mf, id_arg);
    }

    // 扫所有 notebook
    let configs = open()?.read_notebook_configs().unwrap_or_default();

    // 2. 按 entry.id 完全匹配 (用户可能给了不带 # 的 shortid, 但需要短 id 完全等于 entry.id)
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            if list.memos.iter().any(|e| e.id == id_arg) {
                return print_one(&mf, id_arg);
            }
        }
    }

    // 3. 按 entry.id 末尾的 shortid (短于完整 id 的情形)
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if let Some((_, short)) = e.id.rsplit_once('#') {
                    if short == id_arg {
                        return print_one(&mf, &e.id);
                    }
                }
            }
        }
    }

    // 4. 按 filename basename (去 .md) 找
    let want_basename = id_arg.strip_suffix(".md").unwrap_or(id_arg);
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if e.filename == want_basename {
                    return print_one(&mf, &e.id);
                }
            }
        }
    }

    Err(CliError::NotFound(format!(
        "note `{id_arg}` not found (try `flowix-cli list <notebook>` to see IDs)"
    )))
}

/// `flowix-cli show <id> --json` ── 输出 JSON 形式。
pub fn cmd_show_json(id_arg: &str) -> Result<(), CliError> {
    // 复用 cmd_show 的 4 段 id 解析, 但最后调 print_one_json 而不是 print_one
    if id_arg.contains('#') {
        let nb_key = id_arg.split('#').next().unwrap_or("");
        let (mf, _) = open_in(nb_key)?;
        return print_one_json(&mf, id_arg);
    }
    let configs = open()?.read_notebook_configs().unwrap_or_default();
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            if list.memos.iter().any(|e| e.id == id_arg) {
                return print_one_json(&mf, id_arg);
            }
        }
    }
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if let Some((_, short)) = e.id.rsplit_once('#') {
                    if short == id_arg {
                        return print_one_json(&mf, &e.id);
                    }
                }
            }
        }
    }
    let want_basename = id_arg.strip_suffix(".md").unwrap_or(id_arg);
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if e.filename == want_basename {
                    return print_one_json(&mf, &e.id);
                }
            }
        }
    }
    Err(CliError::NotFound(format!("note `{id_arg}` not found")))
}

fn print_one_json(mf: &flowix_core::memo_file::MemoFile, id: &str) -> Result<(), CliError> {
    let list = mf
        .read_list_json()
        .ok_or_else(|| CliError::NotFound("list.json missing".into()))?;
    let entry = list
        .memos
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("note `{id}` not in list.json")))?;
    let shortid = id.rsplit_once('#').map(|(_, s)| s).unwrap_or(id);
    let file_path = mf
        .get_memo_base()
        .join(format!("{}#{}.md", entry.filename, shortid));
    let body = std::fs::read_to_string(&file_path)
        .map_err(|e| CliError::NotFound(format!("file missing: {e}")))?;
    fmt::print_note_json(&entry, &body);
    Ok(())
}

/// 在已知 notebook 内打印一条笔记。
///
/// 不走 `MemoFile::read_memo_with_body` ── 它的内部 `find_memo_file_by_id` 把
/// `entry.id` (完整 `nb_xxx#shortid`) 整个当 memoid 拼到文件名, 多一个 `#`,
/// 文件找不到。这是 desktop 端的预存 bug, CLI 侧自行派生正确路径。
fn print_one(mf: &MemoFile, id: &str) -> Result<(), CliError> {
    let list = mf
        .read_list_json()
        .ok_or_else(|| CliError::NotFound("list.json not readable in target notebook".into()))?;
    let entry = list
        .memos
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("note `{id}` not in list.json")))?;

    // filename 字段是 title (无 .md 无 #xxx), 文件名约定 "{title}#{6字符shortid}.md"
    let shortid = id.rsplit_once('#').map(|(_, s)| s).unwrap_or(id);
    let file_path = mf
        .get_memo_base()
        .join(format!("{}#{}.md", entry.filename, shortid));
    let body = std::fs::read_to_string(&file_path).map_err(|e| {
        CliError::NotFound(format!(
            "note `{}` listed but .md not found at {}: {e}",
            id,
            file_path.display()
        ))
    })?;
    fmt::print_note(&entry, &body);
    Ok(())
}

/// `flowix-cli new <notebook> [name | -]` ── 创建一条新笔记。
///
/// 三种模式:
/// - `new <nb> name`    → 调 $EDITOR, 初始内容带 `# name` 标题
/// - `new <nb> -`       → 从 stdin 读 body
/// - `new <nb>`         → 调 $EDITOR, 初始内容空
///
/// 写盘走 `MemoFile::update_memo_item` ── 自动同步 .md + list.json + 派生字段。
pub fn cmd_new(
    notebook_key: &str,
    name: Option<&str>,
    from_stdin: bool,
    json: bool,
) -> Result<(), CliError> {
    let (mf, nb) = open_in(notebook_key)?;

    // 1. 拿 body ── 三种来源: stdin / 编辑器带 name / 编辑器无 name
    let body = if from_stdin {
        read_stdin()?
    } else {
        let initial = match name {
            Some(n) => format!("# {n}\n\n"),
            None => String::new(),
        };
        crate::editor::edit_in_editor(&initial)?
    };

    // body 为空 → 不创建 (跟 `new` 的"用户至少敲了一个字符"语义对齐)
    if body.trim().is_empty() {
        return Err(CliError::Other("empty body, note not created".into()));
    }

    // 2. 派生 title ── 从 body 第一行非空内容提取, fallback 到 name 或 "untitled"
    let title = derive_title(&body, name);

    // 3. 构造 Memo ── id 用 nanoid 6 位 (跟 desktop 端 generate_memo_id 同格式)
    let now = chrono::Utc::now().timestamp_millis();
    let id = nanoid::nanoid!(6, &flowix_core::memo_file::MEMO_ID_ALPHABET);

    let memo = flowix_core::memo_file::Memo {
        id: id.clone(),
        filename: title.clone(),
        preview: String::new(), // update_memo_item 会从 body 派生
        tags: vec![],
        todos: vec![],
        created_at: now,
        updated_at: now,
        favorited: false,
        icon: None,
        colors: vec![],
        path: None,
    };

    // 4. 写盘 ── update_memo_item 走原子写, 同步 list.json + 派生字段
    mf.update_memo_item(&memo, Some(&body))
        .map_err(|e| CliError::Other(format!("failed to write memo: {e}")))?;

    // 5. 给用户反馈
    let file_path =
        mf.get_memo_base()
            .join(flowix_core::memo_file::MemoFile::generate_memo_filename(
                &title, &id,
            ));
    if json {
        let payload = serde_json::json!({
            "ok": true,
            "action": "created",
            "id": id,
            "notebook": nb.name,
            "title": title,
            "file": file_path.display().to_string(),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload)
                .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
        );
    } else {
        println!("created: {id}");
        println!("  notebook: {}", nb.name);
        println!("  title:    {title}");
        println!("  file:     {}", file_path.display());
    }
    Ok(())
}

fn read_stdin() -> Result<String, CliError> {
    use std::io::Read;
    let mut s = String::new();
    std::io::stdin()
        .read_to_string(&mut s)
        .map_err(CliError::Io)?;
    Ok(s)
}

/// 从 body 第一行非空内容提取 title, fallback 链:
/// body 第一行去掉 `# ` 前缀 → name 参数 → "untitled"
fn derive_title(body: &str, name: Option<&str>) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 去掉 Markdown 标题前缀
        let stripped = trimmed.trim_start_matches('#').trim();
        if !stripped.is_empty() {
            return stripped.chars().take(80).collect();
        }
    }
    name.unwrap_or("untitled").to_string()
}

/// `flowix-cli delete <id>` ── 删除一条笔记 (.md + list.json entry)。
///
/// 跟 `show` 一样支持 4 种 id 解析: 完整 / 短 / filename / 找不到。
pub fn cmd_delete(id_arg: &str, json: bool) -> Result<(), CliError> {
    // 跟 cmd_show 一样的解析
    let (mf, full_id) = resolve_id(id_arg)?;
    let list = mf
        .read_list_json()
        .ok_or_else(|| CliError::NotFound("list.json missing".into()))?;
    let entry = list
        .memos
        .iter()
        .find(|e| e.id == full_id)
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("note `{full_id}` not in list.json")))?;

    // 派生 .md 路径 (绕过 desktop 端 find_memo_file_by_id 预存 bug)
    let shortid = full_id.rsplit_once('#').map(|(_, s)| s).unwrap_or(&full_id);
    let file_path = mf
        .get_memo_base()
        .join(format!("{}#{}.md", entry.filename, shortid));

    // 1. 删 .md (如果存在)
    let removed_file = file_path.exists() && std::fs::remove_file(&file_path).is_ok();

    // 2. 同步 list.json ── 直接读 -> 过滤 -> 写回
    let mut list = list;
    let before = list.memos.len();
    list.memos.retain(|e| e.id != full_id);
    let after = list.memos.len();
    let wrote_list = if before != after {
        // 写回 list.json (走原子写, 但 CLI 这边没现成 helper, 简单 write)
        // 桌面端 update_memo_item 写 list.json 是用 serde_json + fs::write
        let path = mf.get_memo_base().join(".metadata").join("list.json");
        if let Ok(s) = serde_json::to_string_pretty(&list) {
            std::fs::write(&path, s).is_ok()
        } else {
            false
        }
    } else {
        false
    };

    if json {
        let payload = serde_json::json!({
            "ok": true,
            "action": "deleted",
            "id": full_id,
            "file": file_path.display().to_string(),
            "file_removed": removed_file,
            "list_entries_removed": before - after,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload)
                .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
        );
    } else {
        println!("deleted: {full_id}");
        println!("  notebook:  {}", entry.id.split('#').next().unwrap_or(""));
        println!(
            "  file:      {} ({})",
            file_path.display(),
            if removed_file {
                "removed"
            } else {
                "not on disk"
            }
        );
        println!("  list.json: {} entries removed", before - after);
    }
    if !wrote_list && before != after {
        return Err(CliError::Other(
            "deleted .md but failed to update list.json".into(),
        ));
    }
    Ok(())
}

/// 复用 cmd_show 的 4 段 id 解析, 返回 (MemoFile, 完整 id)。
fn resolve_id(id_arg: &str) -> Result<(flowix_core::memo_file::MemoFile, String), CliError> {
    if id_arg.contains('#') {
        let nb_key = id_arg.split('#').next().unwrap_or("");
        let (mf, _) = open_in(nb_key)?;
        return Ok((mf, id_arg.to_string()));
    }
    let configs = open()?.read_notebook_configs().unwrap_or_default();
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            if list.memos.iter().any(|e| e.id == id_arg) {
                return Ok((mf, id_arg.to_string()));
            }
        }
    }
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if let Some((_, short)) = e.id.rsplit_once('#') {
                    if short == id_arg {
                        return Ok((mf, e.id.clone()));
                    }
                }
            }
        }
    }
    let want_basename = id_arg.strip_suffix(".md").unwrap_or(id_arg);
    for nb in &configs {
        let (mf, _) = open_in(&nb.id)?;
        if let Some(list) = mf.read_list_json() {
            for e in &list.memos {
                if e.filename == want_basename {
                    return Ok((mf, e.id.clone()));
                }
            }
        }
    }
    Err(CliError::NotFound(format!("note `{id_arg}` not found")))
}

/// `flowix-cli search <query> [--notebook <name|id>]` ── 跨 notebook 全文搜索。
///
/// 每次都全量 rebuild 索引 (CLI 是 stateless 一次性进程, 不维护增量索引)。
/// 默认在所有 notebook 搜; `--notebook` 限定单个。
pub fn cmd_search(
    query: &str,
    notebook_filter: Option<&str>,
    limit: usize,
    json: bool,
) -> Result<(), CliError> {
    use flowix_core::search::{BigramTokenizer, MemoIndex};
    use std::sync::Arc;

    if query.trim().is_empty() {
        return Err(CliError::Usage("search query cannot be empty".into()));
    }

    let mf = open()?;
    let configs = mf.read_notebook_configs().unwrap_or_default();

    // 过滤 notebooks
    let targets: Vec<_> = match notebook_filter {
        Some(name) => configs
            .iter()
            .filter(|c| c.name == name || c.id == name)
            .collect(),
        None => configs.iter().collect(),
    };

    if targets.is_empty() {
        return Err(CliError::NotFound(format!(
            "no notebooks matched filter `{notebook_filter:?}`"
        )));
    }

    let tokenizer = Arc::new(BigramTokenizer);
    let mut all_hits: Vec<(String, String, String, f32, String)> = Vec::new(); // (nb_name, id, title, score, snippet)

    for nb in targets {
        let mut nb_mf = open()?;
        nb_mf.set_current_notebook(Some(nb.id.clone()));

        // 拿全量 memos + body
        let items = nb_mf.read_all_memos_with_body();
        if items.is_empty() {
            continue;
        }
        let mut index = MemoIndex::new(tokenizer.clone());
        index.rebuild(nb.id.clone(), items);
        let hits = index.search(query, limit);
        for h in hits {
            // 拿完整 metadata (search.rs 返的 MemoSearchHit 含 snippet 但不一定有 nb_name / title)
            // 我们直接搜 read_all_memos_with_body 拿 title
            // 简化: 从 snippet 上下文里抓 title
            all_hits.push((
                nb.name.clone(),
                h.id.clone(),
                h.filename.clone(),
                h.score,
                h.snippet.clone(),
            ));
        }
    }

    // 排序: 按 score 降序, 然后 notebook_name, 然后 id
    all_hits.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));

    if all_hits.is_empty() {
        if json {
            let payload = serde_json::json!({
                "ok": true,
                "action": "search",
                "query": query,
                "matches": [],
                "total": 0,
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&payload)
                    .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
            );
        } else {
            println!("(no matches for `{query}`)");
        }
        return Ok(());
    }

    if json {
        let total = all_hits.len();
        let payload_matches: Vec<serde_json::Value> = all_hits
            .iter()
            .take(limit)
            .map(|(nb, id, title, score, snippet)| {
                serde_json::json!({
                    "notebook": nb,
                    "id": id,
                    "title": title,
                    "score": score,
                    "snippet": snippet,
                })
            })
            .collect();
        let payload = serde_json::json!({
            "ok": true,
            "action": "search",
            "query": query,
            "matches": payload_matches,
            "total": total,
            "shown": payload_matches.len(),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload)
                .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
        );
    } else {
        for (nb, id, _title, _score, snippet) in all_hits.iter().take(limit) {
            println!("[{}] {} ", nb, id);
            println!("    {}", snippet);
        }
        println!("\n{} match(es)", all_hits.len().min(limit));
    }
    Ok(())
}

/// `flowix-cli edit <id>` ── 在 $EDITOR 里编辑现有笔记, 保存后写回。
///
/// 流程: id 解析 -> 读 .md 原文 -> 调 editor -> 写回 -> 走 update_memo_item
/// 同步 list.json (派生 preview / tags / todos)。
pub fn cmd_edit(id_arg: &str, json: bool) -> Result<(), CliError> {
    let (mf, full_id) = resolve_id(id_arg)?;
    let list = mf
        .read_list_json()
        .ok_or_else(|| CliError::NotFound("list.json missing".into()))?;
    let entry = list
        .memos
        .iter()
        .find(|e| e.id == full_id)
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("note `{full_id}` not in list.json")))?;

    // 读现有 .md 原文 (含 frontmatter)
    let shortid = full_id.rsplit_once('#').map(|(_, s)| s).unwrap_or(&full_id);
    let file_path = mf
        .get_memo_base()
        .join(format!("{}#{}.md", entry.filename, shortid));
    let initial = std::fs::read_to_string(&file_path).map_err(|e| {
        CliError::NotFound(format!("file not found at {}: {e}", file_path.display()))
    })?;

    // 调 editor
    let edited = crate::editor::edit_in_editor(&initial)?;

    // 编辑器没动 -> 不写盘, 提示用户
    if edited == initial {
        if json {
            let payload = serde_json::json!({
                "ok": true,
                "action": "edited",
                "id": full_id,
                "changed": false,
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&payload)
                    .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
            );
        } else {
            println!("(no changes)");
        }
        return Ok(());
    }

    // 写回: 走 update_memo_item 同步 list.json + 派生字段
    let now = chrono::Utc::now().timestamp_millis();
    let memo = flowix_core::memo_file::Memo {
        id: full_id.clone(),
        filename: entry.filename.clone(),
        preview: String::new(), // update_memo_item 会从 body 派生
        tags: entry.tags.clone(),
        todos: entry.todos.clone(),
        created_at: entry.created_at,
        updated_at: now,
        favorited: entry.favorited,
        icon: entry.icon.clone(),
        colors: entry.colors.clone(),
        path: None,
    };
    mf.update_memo_item(&memo, Some(&edited))
        .map_err(|e| CliError::Other(format!("failed to write memo: {e}")))?;

    if json {
        let payload = serde_json::json!({
            "ok": true,
            "action": "edited",
            "id": full_id,
            "file": file_path.display().to_string(),
            "changed": true,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload)
                .map_err(|e| CliError::Other(format!("json serialize: {e}")))?
        );
    } else {
        println!("edited: {full_id}");
        println!("  file:  {}", file_path.display());
    }
    Ok(())
}

/// `flowix-cli completion <shell>` ── 输出 shell 补全脚本到 stdout。
///
/// 支持:
/// - `bash`  ── 标准 bash 补全
/// - `zsh`   ── bash 同源, zsh 兼容 bashcompinit
/// - `fish`  ── fish 专属 (更简单)
///
/// 用法:
///   # bash
///   source <(flowix-cli completion bash)
///
///   # zsh
///   flowix-cli completion zsh > \"\\\"$fpath[1]/_flowix-cli\\\"\"
///
///   # fish
///   flowix-cli completion fish | source
pub fn cmd_completion(shell: &str) -> Result<(), CliError> {
    let script = match shell {
        "bash" | "zsh" => bash_completion(),
        "fish" => fish_completion(),
        other => {
            return Err(CliError::Usage(format!(
                "unknown shell: `{other}` (use bash/zsh/fish)"
            )))
        }
    };
    print!("{script}");
    Ok(())
}

fn bash_completion() -> String {
    // 简版: 只补子命令 + 第一个位置参数 (id / notebook name) 不补 (因为不固定)
    r#"# flowix-cli bash completion
# 安装: source <(flowix-cli completion bash)

_flowix-cli() {
    local cur prev cmds
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    cmds="notebooks list show new delete edit search completion --help --version --json"

    if [[ ${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "${cmds}" -- "${cur}") )
        return 0
    fi

    # 第二位置参数: -j / --json (全局 flag)
    if [[ "${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "--json -j --help -h --version -V" -- "${cur}") )
        return 0
    fi

    # search 后面可能跟 --notebook <name>, --limit <n>
    if [[ "${prev}" == "--notebook" ]] || [[ "${prev}" == "-n" ]]; then
        # 静态列表 ── 不实时读 ~/.flowix (避免补全慢)
        COMPREPLY=()
        return 0
    fi

    return 0
}

complete -F _flowix-cli flowix-cli
"#
    .to_string()
}

fn fish_completion() -> String {
    r#"# flowix-cli fish completion
# 安装: flowix-cli completion fish | source

function __flowix-cli_complete
    set -l args (commandline -opc)
    set -l cur (commandline -ct)

    if test (count $args) -eq 1
        echo "notebooks\tList all notebooks"
        echo "list\tList notes in a notebook"
        echo "show\tPrint a note to stdout"
        echo "new\tCreate a new note"
        echo "delete\tDelete a note"
        echo "edit\tEdit a note in \$EDITOR"
        echo "search\tFull-text search"
        echo "completion\tPrint shell completion script"
        return
    end

    if string match -q -- "--*" $cur; or string match -q "-*" $cur
        echo "--json"
        echo "-j"
        echo "--help"
        echo "-h"
        echo "--version"
        return
    end
end

complete -c flowix-cli -f -a "(__flowix-cli_complete)"
"#
    .to_string()
}
