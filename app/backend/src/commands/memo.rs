//! Memo / Doc IPC — 合并拆分前的 section 3+4+5+Doc。
//!
//! 凡是动 list.json / memo.json / .md 文件的 IPC 全进这里, 共 13 个:
//!
//! - **读取**: `get_memos` / `read_memo` / `search_memos` / `read_document` / `get_launch_open_files`
//! - **创建**: `add_document` / `import_external_document_to_memo`
//! - **更新**: `update_memo_db` / `write_document` / `favorite_memo` / `unfavorite_memo`
//! - **删除**: `delete_memo` / `clear_memos`
//!
//! 跨域 helper (`switch_notebook_and_rebuild` / `try_index_upsert` /
//! `mark_self_write_for` / `force_rebuild_index` /
//! `rebuild_index_in_background` / `strip_markdown_frontmatter` /
//! `title_from_markdown_content` / `try_index_remove`) 走 `super::helpers::*`。
//! 两个域内 helper (`extract_memo_id_from_path` / `generate_memo_id`) 留本文件。

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::memo_events::{self, MemoChangeSource, MemoEvent};
use crate::memo_file::{
    apply_derived_memo_fields, extract_tags_from_body, extract_title_and_preview,
    extract_todos_from_body, Memo, MemoColor, MemoFile, TodoItem,
};
use crate::search::MemoSearchHit;

use super::helpers::{
    force_rebuild_index, mark_self_write_for, rebuild_index_in_background,
    strip_markdown_frontmatter, switch_notebook_and_rebuild, title_from_markdown_content,
    try_index_remove, try_index_upsert,
};
use super::AppState;

#[derive(Serialize)]
pub struct GetMemosResponse {
    pub memos: Vec<Memo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemosResponse {
    pub hits: Vec<MemoSearchHit>,
    pub index_ready: bool,
}

// ==================== 域内 helper ====================

/// 从 `{title}#xxxxxx.md` 文件名解析 memo id. 解析不到 (非 memo 文件 /
/// 非 .md 后缀) 返回 None. 委托给 `MemoFile::extract_memo_id_from_abs_path`,
/// 跨模块保持单一真源。
fn extract_memo_id_from_path(file_path: &str) -> Option<String> {
    MemoFile::extract_memo_id_from_abs_path(std::path::Path::new(file_path))
}

fn generate_memo_id(memo_file: &MemoFile) -> String {
    // 随机段必须用纯字母+数字, 走共享 alphabet (见 `memo_file::MEMO_ID_ALPHABET`),
    // 不让 `nanoid 0.4` 默认 SAFE 里的 `_` / `-` 渗到 id 里。
    loop {
        let id = nanoid::nanoid!(6, &crate::memo_file::MEMO_ID_ALPHABET);
        if memo_file.read_memo(&id).is_none() {
            return id;
        }
    }
}

/// 写盘 / 改 metadata 后的"派生字段同步"收口 ── 一处完成
/// "读 memo → 应用派生 → 写 list.json → 重建搜索索引 → emit Updated"。
///
/// 共享给两条调用路径:
/// - [`update_memo_db`] 的 `defer_rename=true` 分支 (前端 metadata 同步)
/// - [`write_document`] 写盘成功且路径命中注册 memo 时 (前端编辑保存主路径)
///
/// 设计动机: 历史上 `update_memo_db` 派生 + `write_document` 写盘 是两条
/// 独立的 IPC, 前端 `useMemoMetadataSync` 在 `onSaved` 回调里"二次同步",
/// 引入双 IPC / 双 emit / 双 list.json 写。整合后写盘一侧自带派生同步,
/// list.json 一致性由后端单点保证, 前端 metadata 同步 hook 降级为兜底
/// (兼容性保留, 默认路径不再调)。
///
/// 入参:
/// - `content`: 调用方已知最新内容, 直接用作派生源 (写盘主路径, 避免再
///   `fs::read_to_string` 一次)。`None` 时回退到 `find_memo_file_by_id`
///   找盘上文件并读出 (兼容 `update_memo_db` 不带 content 的纯 metadata
///   路径)。
/// - `caller_filename` / `caller_preview`: 调用方显式提供的 filename /
///   preview (例如 `update_memo_db` 的 `Some(filename)` 路径)。非 None 时
///   直接写入, 跳开 `apply_derived_memo_fields` 内部 "filename 仅在空时
///   覆盖" 的保护。写盘主路径两个都传 None, 走默认派生语义。
///
/// 出参: 成功 + 派生 / emit 完成返回 `Ok(())`; 找不到 memo 或写 list.json
/// 失败返回 `Err` (调用方按"派生同步失败但不影响主路径"语义自行处理)。
fn sync_derived_fields_for_memo(
    state: &AppState,
    app: &AppHandle,
    id: &str,
    content: Option<&str>,
    caller_filename: Option<&str>,
    caller_preview: Option<&str>,
    sync_to_disk: bool,
) -> Result<Option<String>, String> {
    // 返回:
    // - `Ok(Some(content))` = 写盘成功, content 是磁盘上的最终内容
    //   (含 frontmatter + 派生 filename 写入的字段)。`write_document` 把
    //   它包进 `Option<String>` 返回前端, 让前端 `lastSavedContent` 跟磁盘
    //   严格一致 ── 修"rename 后下次保存 CAS 失败"的隐患 (caller 给的
    //   content 不含 frontmatter, 不能直接做 CAS 比对)。
    // - `Ok(None)` = metadata-only 路径 (`sync_to_disk=false`, 不动磁盘)。
    // - `Err(e)` = 写盘失败 (rename / fs::write 错误)。
    // 1. 读现有 memo + 找磁盘路径, 在锁内完成 list.json 读, 不持锁做 IO。
    let (mut memo, old_abs_path) = {
        let memo_file = state.memo_file.read().unwrap();
        let memo = memo_file
            .read_memo(id)
            .ok_or_else(|| format!("memo {id} not in list.json"))?;
        let abs_path = memo_file.find_memo_file_by_id(id);
        (memo, abs_path)
    };

    // 2. 拿派生源 content: 调用方已知优先, 否则读盘。
    let full_content: Option<String> = match content {
        Some(c) => Some(c.to_string()),
        None => old_abs_path
            .as_ref()
            .and_then(|path| fs::read_to_string(path).ok()),
    };

    // 3. 派生: 按 B 方案, filename / 物理文件名 / frontmatter 三个拷贝
    //    始终一致, 都跟 body 首行走。`caller_filename` 路径 (`update_memo_db`
    //    显式传 Some) 仍然优先: 给 `finalizeMemoFilename` 这类"用户显式锁
    //    定 title"的流程留口子, 不破坏其语义。
    if let Some(ref full) = full_content {
        // preview 总是重算 (B 方案下, "filename / 物理文件名 / frontmatter"
        // 三拷贝外的 preview / tags / todos 也是 body 派生源, 同样不享受
        // "仅空覆盖" 保护 ── 这些字段跟 body 内容强相关, 跟着内容走)。
        let (derived_title, derived_preview) = extract_title_and_preview(full);
        if let Some(f) = caller_filename {
            memo.filename = f.to_string();
        } else if !derived_title.is_empty() {
            memo.filename = derived_title;
        }
        if let Some(p) = caller_preview {
            memo.preview = p.to_string();
        } else {
            memo.preview = derived_preview;
        }
        memo.tags = extract_tags_from_body(full);
        memo.todos = extract_todos_from_body(full);
    } else if caller_filename.is_some() || caller_preview.is_some() {
        if let Some(f) = caller_filename {
            memo.filename = f.to_string();
        }
        if let Some(p) = caller_preview {
            memo.preview = p.to_string();
        }
        memo.updated_at = chrono::Utc::now().timestamp_millis();
    } else {
        memo.updated_at = chrono::Utc::now().timestamp_millis();
    }

    // 4. 三拷贝同步: 当 `sync_to_disk=true` (写盘主路径 `write_document` 走)
    //    时, 算 storage_title → target_filename, 必要时 rename + 重写
    //    frontmatter + 更新 list.json `path` 字段。"filename / 物理文件名 /
    //    frontmatter 三个拷贝始终一致" 在这一步收口。
    let new_abs_path: Option<std::path::PathBuf> = if sync_to_disk {
        let storage_title = MemoFile::storage_title_from_filename(&memo.filename);
        memo.filename = storage_title.clone();
        let target_filename = MemoFile::generate_memo_filename(&storage_title, id);
        let base = state.memo_file.read().unwrap().get_memo_base();
        let target_abs = base.join(&target_filename);

        // 把 caller 提供的 content 当 body ── 前端默认路径不写 frontmatter,
        // 但已经有 `useMemoMetadataSync` / `use-document-finalize` 兜底流程
        // 会写, 这里先剥掉 caller content 的前导 frontmatter, 再拼新 frontmatter。
        let body: String = if let Some(ref full) = full_content {
            strip_markdown_frontmatter(full).to_string()
        } else {
            String::new()
        };
        let fm = crate::memo_file::MemoFrontmatter {
            filename: storage_title.clone(),
        };
        let fm_yaml = serde_yaml::to_string(&fm).unwrap_or_default();
        let new_file_content = format!("---\n{}\n---\n{}", fm_yaml.trim(), body);

        // rename 旧 → 新 (如果需要)
        if let Some(ref old_path) = old_abs_path {
            if old_path != &target_abs && old_path.exists() {
                // mark 自写抑制新旧双侧, 避免 watcher notify 回响
                mark_self_write_for(app, old_path);
                mark_self_write_for(app, &target_abs);
                if let Err(e) = fs::rename(old_path, &target_abs) {
                    return Err(format!(
                        "rename {} -> {} failed: {e}",
                        old_path.display(),
                        target_abs.display()
                    ));
                }
            }
        }

        // 写文件 (新路径). 内容已包含新 frontmatter.
        if let Err(e) = fs::write(&target_abs, &new_file_content) {
            // 写失败时, 如果之前 rename 过, 尝试回滚
            if let Some(ref old_path) = old_abs_path {
                if old_path != &target_abs && target_abs.exists() {
                    let _ = fs::rename(&target_abs, old_path);
                }
            }
            return Err(format!(
                "write {} failed: {e}",
                target_abs.display()
            ));
        }

        memo.path = Some(target_filename.clone());
        Some(target_abs)
    } else {
        old_abs_path.clone()
    };

    // 5. 写 list.json + 同步 memo.json todos 索引。
    {
        let memo_file = state.memo_file.read().unwrap();
        memo_file
            .sync_to_list_json_only(&memo)
            .map_err(|e| format!("sync list.json failed: {e}"))?;
    }

    // 6. 重建搜索索引 + emit 一次 Updated (用新 path)。
    try_index_upsert(state, id);
    let path_str = new_abs_path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    memo_events::emit(
        app,
        MemoEvent::Updated {
            id: id.to_string(),
            path: path_str,
            source: MemoChangeSource::UserEdit,
        },
    );
    // 把 "已写盘的最终内容" 沿调用栈返回, 让 IPC 端能透传给前端。
    // metadata-only 路径 (sync_to_disk=false) 返回 None, 不暴露任何内容。
    if sync_to_disk {
        // sync_to_disk=true 块里 new_file_content 是 String, 这里需要
        // 把它也搬出来 ── 重新从盘读最稳 (rename 后路径可能已变), 避免
        // 持有 stale 引用。
        let on_disk = new_abs_path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok());
        Ok(on_disk)
    } else {
        Ok(None)
    }
}

// 测试覆盖说明 ── "派生 + 写 list.json" 这一段契约由 `memo_file` 模块
// 的现有测试覆盖 (典型如 `reload_memo_from_disk_refreshes_preview` /
// `sync_list_json_on_write_does_not_create_duplicates`)。本 helper 没有
// 单独的 cargo test: 它强依赖 `tauri::State<AppState>` + `AppHandle`,
// 起一个真 IPC 端到端测的设置成本与价值不匹配 ── 在 dev 环境跑一次
// 编辑器保存, 观察 list.json preview 立即更新, 即可验证本 helper 在
// `write_document` 路径下被正确调用。

fn resolve_document_path_for_io(file_path: &str, state: &AppState) -> std::path::PathBuf {
    let requested_path = Path::new(file_path);
    if let Some(memo_id) = extract_memo_id_from_path(file_path) {
        if let Some(actual_path) = state
            .memo_file
            .read()
            .unwrap()
            .find_memo_file_by_id(&memo_id)
        {
            return actual_path;
        }
    }
    requested_path.to_path_buf()
}

// ==================== 读取 ====================

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_memos(
    notebook_id: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    tag_id: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> GetMemosResponse {
    // 走 helper 切 notebook + 触发后台索引 rebuild. 这是搜索索引的主要触发点 —
    // 应用启动后第一次 get_memos (前端自然的数据加载路径) 会顺带把索引建好,
    // 用户首次搜索就能命中. helper 有幂等守卫, 同 notebook 重复调用零成本.
    switch_notebook_and_rebuild(state.inner(), &app, notebook_id);

    let memo_file = state.memo_file.read().unwrap();
    let memos = memo_file.read_all_memos_filtered(
        filter.as_deref().unwrap_or("all"),
        sort.as_deref().unwrap_or("createdAt"),
        tag_id.as_deref(),
    );
    GetMemosResponse { memos }
}

#[tauri::command]
pub fn read_memo(id: String, state: State<AppState>) -> Option<Memo> {
    state.memo_file.read().unwrap().read_memo(&id)
}

#[tauri::command]
pub fn read_document(file_path: String, state: State<AppState>) -> Option<String> {
    if !super::helpers::can_access_document_path(Path::new(&file_path), &state) {
        eprintln!("[read_document] refused out-of-scope path: {}", file_path);
        return None;
    }
    let io_path = resolve_document_path_for_io(&file_path, state.inner());
    fs::read_to_string(&io_path).ok()
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_document(
    file_path: String,
    content: String,
    expectedContent: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Option<String> {
    // 返回值:
    // - `Some(content)` = 写盘成功, content 是磁盘上的最终内容 (含 frontmatter
    //   / 派生 filename 写回的字段)。前端 `runOne` 用它更新 `lastSavedContent`,
    //   下次 saveDoc 的 CAS 跟磁盘一致 ── 修复 "rename 后下次保存 CAS 失败"
    //   的隐患 (caller 给的 content 不含 frontmatter, 不能直接做 CAS 比对)。
    // - `None` = 写盘失败 (路径非法 / CAS refuse / 写盘 error)。
    if !super::helpers::can_access_document_path(Path::new(&file_path), &state) {
        eprintln!("[write_document] refused out-of-scope path: {}", file_path);
        return None;
    }
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    let io_path = resolve_document_path_for_io(&file_path, state.inner());
    if let Some(parent) = io_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Some(expected_content) = expectedContent {
        match fs::read_to_string(&io_path) {
            Ok(current_content) if current_content == expected_content => {}
            Ok(_) => {
                eprintln!(
                    "[write_document] Refused stale write because {} changed on disk",
                    file_path
                );
                return None;
            }
            Err(e) => {
                eprintln!(
                    "[write_document] Failed to verify current content for {}: {}",
                    file_path, e
                );
                return None;
            }
        }
    }
    // CAS 校验通过, 写盘前先 mark — 关掉 notify 事件先于 mark 到达的 race
    // window。哪怕这里写盘失败, mark 留下的 2s TTL 是无害的 (watcher 命中
    // 即吞一个 noop 事件, 不会影响别的)。
    //
    // 路径命中 memo id (注册的 memo `.md`) 时, 不直接 fs::write, 交给
    // `sync_derived_fields_for_memo(sync_to_disk=true)` 统一收口:
    // 派生 title → 计算新物理文件名 → 必要时 rename 旧文件 → 写新 frontmatter
    // + body → 同步 list.json 三拷贝 (filename / path / 物理文件名 一致)。
    // 路径不命中 memo id (外部 .md 文件) 时, 走原 fs::write 路径, 不动
    // list.json / frontmatter / 物理文件名 (与"通用 markdown 写盘"语义一致)。
    let memo_id_for_sync = if extract_memo_id_from_path(&file_path).is_some() {
        mark_self_write_for(&app, Path::new(&file_path));
        mark_self_write_for(&app, &io_path);
        extract_memo_id_from_path(&file_path)
    } else {
        None
    };

    if let Some(ref memo_id) = memo_id_for_sync {
        // 注册 memo 主路径: 由 helper 决定写到哪里 (旧 / 新路径) ── 它
        // 内部会先 rename 再 fs::write, 一次完成。caller content 是
        // editor 序列化出来的 markdown body, helper 内部 strip 前导
        // frontmatter 并拼上新 frontmatter。helper 返回磁盘最终内容
        // (含 frontmatter), 沿 IPC 透传前端做 lastSavedContent。
        return match sync_derived_fields_for_memo(
            state.inner(),
            &app,
            memo_id,
            Some(&content),
            None,
            None,
            true,
        ) {
            Ok(Some(on_disk)) => Some(on_disk),
            Ok(None) => {
                // 不应发生: sync_to_disk=true 路径必返回 Some
                eprintln!("[write_document] helper returned None unexpectedly");
                None
            }
            Err(e) => {
                eprintln!(
                    "[write_document] derived sync failed for {memo_id}: {e}"
                );
                None
            }
        };
    }

    // 非 memo 路径: 原 fs::write。返回磁盘上的内容 (caller 写的).
    match fs::write(&io_path, &content) {
        Ok(_) => Some(content),
        Err(e) => {
            eprintln!("[write_document] Failed to write to {}: {}", file_path, e);
            None
        }
    }
}

#[tauri::command]
pub fn get_launch_open_files() -> Vec<String> {
    super::helpers::markdown_paths_from_args(std::env::args())
}

#[tauri::command]
pub fn search_memos(
    notebook_id: Option<String>,
    query: String,
    limit: Option<usize>,
    state: State<AppState>,
    app: AppHandle,
) -> SearchMemosResponse {
    // 防御: 调用方传入的 notebookId 跟索引归属不一致时返回空. 前端应先
    // 切到目标 notebook (会触发 rebuild) 再搜索.
    let idx = state.search.read().unwrap();
    if let Some(ref nb) = notebook_id {
        if idx.current_notebook() != Some(nb.as_str()) {
            let index_ready = idx.is_loaded();
            return SearchMemosResponse {
                hits: vec![],
                index_ready,
            };
        }
    }
    drop(idx);

    // 自愈: 索引未加载 (启动早期 / 切 notebook 后尚未 rebuild 完成), 后台触发一次.
    // 下一轮 search 会拿到真结果. 配合 helper 幂等守卫, 重复调用零成本.
    let needs_rebuild = {
        let idx = state.search.read().unwrap();
        let current_nb = state.memo_file.read().unwrap().current_notebook_id_value();
        !idx.is_loaded() || idx.current_notebook() != current_nb.as_deref()
    };
    if needs_rebuild {
        rebuild_index_in_background(state.inner(), &app);
    }

    let idx = state.search.read().unwrap();
    let index_ready = idx.is_loaded();
    let hits = idx.search(&query, limit.unwrap_or(30));
    SearchMemosResponse { hits, index_ready }
}

// ==================== 创建 ====================

#[tauri::command]
pub fn add_document(
    tag: Option<String>,
    notebook_id: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Memo {
    // 1. 切 notebook 上下文 (不持锁到写盘, 减少锁窗口)
    if let Some(ref id) = notebook_id {
        state
            .memo_file
            .write()
            .unwrap()
            .set_current_notebook(Some(id.clone()));
    }

    // 2. 算 id + 文件名 — 这两步在写盘前完成, 后面 mark_self_write 用得到
    let id = {
        let memo_file = state.memo_file.read().unwrap();
        generate_memo_id(&memo_file)
    };
    let now = chrono::Utc::now().timestamp_millis();
    let filename = chrono::Local::now().format("%Y-%m-%d").to_string();
    let memo_filename = MemoFile::generate_memo_filename(&filename, &id);

    // 3. 自写抑制提前到写盘前 — 关掉 "notify 事件先于 mark 到达" 的 race
    // window。这是补丁 A 的核心: mark 必须在 `update_memo_item` 之前调用。
    // 路径不存在, `mark_self_write_for` 走"canonicalize 父目录 + join 文件名"
    // 回退, 父目录一定存在, 这一步必然成功。
    let abs = state
        .memo_file
        .read()
        .unwrap()
        .get_memo_base()
        .join(&memo_filename);
    mark_self_write_for(&app, &abs);

    // 4. 写盘
    let memo = {
        let memo_file = state.memo_file.write().unwrap();
        let tag_line = tag.as_ref().map(|t| format!("#{}", t)).unwrap_or_default();
        let content = format!("# {}\n{}\n", filename, tag_line);
        let memo = Memo {
            id,
            filename,
            preview: String::new(),
            tags: vec![],
            todos: vec![],
            created_at: now,
            updated_at: now,
            favorited: false,
            icon: None,
            colors: vec![],
            path: Some(memo_filename),
        };
        if memo_file.update_memo_item(&memo, Some(&content)).is_err() {
            return memo;
        }
        memo_file.read_memo(&memo.id).unwrap_or(memo)
    };
    try_index_upsert(state.inner(), &memo.id);
    // memo-event: 让前端侧边栏立即出现新笔记
    memo_events::emit(
        &app,
        MemoEvent::Created {
            memo: memo.clone(),
            source: MemoChangeSource::UserNew,
        },
    );
    memo
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_external_document_to_memo(
    source_path: String,
    content: String,
    notebook_id: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Option<Memo> {
    if let Some(ref id) = notebook_id {
        state
            .memo_file
            .write()
            .unwrap()
            .set_current_notebook(Some(id.clone()));
    }

    // 跟 add_document 同形: 算 id + title, 预测最终文件名, 写盘前 mark。
    let source_name = Path::new(&source_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported Markdown");
    let title = title_from_markdown_content(&content, source_name);
    let body = strip_markdown_frontmatter(&content);
    let now = chrono::Utc::now().timestamp_millis();
    let id = {
        let memo_file = state.memo_file.read().unwrap();
        generate_memo_id(&memo_file)
    };
    let predicted_filename = MemoFile::generate_memo_filename(&title, &id);

    // 自写抑制提前
    let abs = state
        .memo_file
        .read()
        .unwrap()
        .get_memo_base()
        .join(&predicted_filename);
    mark_self_write_for(&app, &abs);

    let memo = {
        let memo_file = state.memo_file.write().unwrap();
        let memo = Memo {
            id,
            filename: title,
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

        memo_file.update_memo_item(&memo, Some(body)).ok()?;
        memo_file.read_memo(&memo.id).or_else(|| Some(memo))
    };
    if let Some(m) = &memo {
        try_index_upsert(state.inner(), &m.id);
        // memo-event
        memo_events::emit(
            &app,
            MemoEvent::Created {
                memo: m.clone(),
                source: MemoChangeSource::UserImport,
            },
        );
    }
    memo
}

// ==================== 更新 ====================

#[tauri::command]
pub fn update_memo_db(
    id: String,
    filename: Option<String>,
    content: Option<String>,
    _tags: Option<Vec<String>>,
    _todos: Option<Vec<TodoItem>>,
    preview: Option<String>,
    defer_rename: Option<bool>,
    state: State<AppState>,
    app: AppHandle,
) -> bool {
    let defer_rename = defer_rename.unwrap_or(true);

    if defer_rename {
        return sync_derived_fields_for_memo(
            state.inner(),
            &app,
            &id,
            content.as_deref(),
            filename.as_deref(),
            preview.as_deref(),
            false,  // 不动磁盘: 这条路径仅更新 list.json, 物理文件名 / frontmatter 维持原样
        )
        .is_ok();
    }

    let (current_memo, current_abs_path) = {
        let memo_file = state.memo_file.read().unwrap();
        (
            memo_file.read_memo(&id),
            memo_file.find_memo_file_by_id(&id),
        )
    };
    let current_content = content.as_deref().map(str::to_string).or_else(|| {
        current_abs_path
            .as_ref()
            .and_then(|path| fs::read_to_string(path).ok())
    });
    let derived_filename = if filename.is_none() {
        current_content.as_deref().and_then(|full_content| {
            let (derived_title, _) = extract_title_and_preview(full_content);
            (!derived_title.is_empty()).then_some(derived_title)
        })
    } else {
        None
    };
    let predicted_filename_source = filename
        .as_deref()
        .or(derived_filename.as_deref())
        .or(current_memo.as_ref().map(|m| m.filename.as_str()));

    // 写盘前预测最终 .md 路径, 提前 mark 自写抑制。
    // 规则: `update_memo_item` 在 `filename` 变化时会重命名为
    // `{filename}-{id}.md`; 不变则保留旧路径。无论哪种, 我们用预测值塞
    // 抑制表, 写盘后 notify 回响都会命中。
    if let Some(ref path) = current_abs_path {
        mark_self_write_for(&app, path);
    }

    let predicted_filename = predicted_filename_source
        .map(|f| MemoFile::generate_memo_filename(f, &id))
        .unwrap_or_default();
    if !predicted_filename.is_empty() {
        let abs = state
            .memo_file
            .read()
            .unwrap()
            .get_memo_base()
            .join(&predicted_filename);
        mark_self_write_for(&app, &abs);
    }

    let ok = {
        let memo_file = state.memo_file.read().unwrap();
        let mut memo = match current_memo {
            Some(m) => m,
            None => return false,
        };

        if let Some(t) = filename.or(derived_filename) {
            memo.filename = t;
        }
        if let Some(p) = preview {
            memo.preview = p;
        }
        if let Some(full_content) = current_content.as_deref() {
            apply_derived_memo_fields(&mut memo, full_content);
        }
        memo.updated_at = chrono::Utc::now().timestamp_millis();

        // Tags and todos are memo-derived indexes. Refresh the memo index from the
        // current markdown body instead of trusting frontend-supplied derived data.
        memo_file
            .update_memo_item(&memo, content.as_deref())
            .is_ok()
    };
    // `expectedContent` 校验失败 / 写盘错误都走不到这里 — 索引更新天然只在
    // 硬盘确实写盘之后发生.
    if ok {
        try_index_upsert(state.inner(), &id);
        // memo-event (Updated 携带最新 path, 便于前端 path-match)
        let abs_path = state
            .memo_file
            .read()
            .unwrap()
            .find_memo_file_by_id(&id)
            .map(|p| p.display().to_string());
        memo_events::emit(
            &app,
            MemoEvent::Updated {
                id,
                path: abs_path.unwrap_or_default(),
                source: MemoChangeSource::UserEdit,
            },
        );
    }
    ok
}

#[tauri::command]
pub fn finalize_memo_filename(id: String, state: State<AppState>, app: AppHandle) -> bool {
    let (current_memo, current_abs_path) = {
        let memo_file = state.memo_file.read().unwrap();
        (
            memo_file.read_memo(&id),
            memo_file.find_memo_file_by_id(&id),
        )
    };
    let current_content = current_abs_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok());
    let (mut memo, current_content) = match (current_memo, current_content) {
        (Some(memo), Some(content)) => (memo, content),
        _ => return false,
    };

    let (derived_title, _) = extract_title_and_preview(&current_content);
    if !derived_title.is_empty() {
        memo.filename = derived_title;
    }
    apply_derived_memo_fields(&mut memo, &current_content);
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    if let Some(ref path) = current_abs_path {
        mark_self_write_for(&app, path);
    }
    let predicted_filename = MemoFile::generate_memo_filename(&memo.filename, &id);
    let predicted_abs = state
        .memo_file
        .read()
        .unwrap()
        .get_memo_base()
        .join(&predicted_filename);
    mark_self_write_for(&app, &predicted_abs);

    let ok = {
        let memo_file = state.memo_file.read().unwrap();
        let current_body = strip_markdown_frontmatter(&current_content);
        memo_file
            .update_memo_item(&memo, Some(current_body))
            .is_ok()
    };

    if ok {
        try_index_upsert(state.inner(), &id);
        let abs_path = state
            .memo_file
            .read()
            .unwrap()
            .find_memo_file_by_id(&id)
            .map(|p| p.display().to_string());
        memo_events::emit(
            &app,
            MemoEvent::Updated {
                id,
                path: abs_path.unwrap_or_default(),
                source: MemoChangeSource::UserEdit,
            },
        );
    }

    ok
}

#[tauri::command]
pub fn favorite_memo(id: String, state: State<AppState>, app: AppHandle) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    memo.favorited = true;
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    let ok = memo_file.sync_to_list_json_only(&memo).is_ok();
    if ok {
        let abs_path = memo_file
            .find_memo_file_by_id(&id)
            .map(|p| p.display().to_string());
        if let Some(ref path) = abs_path {
            mark_self_write_for(&app, Path::new(path));
        }
        memo_events::emit(
            &app,
            MemoEvent::Updated {
                id,
                path: abs_path.unwrap_or_default(),
                source: MemoChangeSource::UserEdit,
            },
        );
    }
    ok
}

#[tauri::command]
pub fn unfavorite_memo(id: String, state: State<AppState>, app: AppHandle) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    memo.favorited = false;
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    let ok = memo_file.sync_to_list_json_only(&memo).is_ok();
    if ok {
        let abs_path = memo_file
            .find_memo_file_by_id(&id)
            .map(|p| p.display().to_string());
        if let Some(ref path) = abs_path {
            mark_self_write_for(&app, Path::new(path));
        }
        memo_events::emit(
            &app,
            MemoEvent::Updated {
                id,
                path: abs_path.unwrap_or_default(),
                source: MemoChangeSource::UserEdit,
            },
        );
    }
    ok
}

#[tauri::command]
pub fn set_memo_colors(
    id: String,
    colors: Vec<MemoColor>,
    state: State<AppState>,
    app: AppHandle,
) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    memo.colors = colors;
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    let ok = memo_file.sync_to_list_json_only(&memo).is_ok();
    if ok {
        let abs_path = memo_file
            .find_memo_file_by_id(&id)
            .map(|p| p.display().to_string());
        if let Some(ref path) = abs_path {
            mark_self_write_for(&app, Path::new(path));
        }
        memo_events::emit(
            &app,
            MemoEvent::Updated {
                id,
                path: abs_path.unwrap_or_default(),
                source: MemoChangeSource::UserEdit,
            },
        );
    }
    ok
}

// ==================== 删除 ====================

#[tauri::command]
pub fn delete_memo(id: String, state: State<AppState>, app: AppHandle) -> bool {
    try_index_remove(state.inner(), &id);
    // 在删之前先拿一下 path, 用于 memo-event payload
    let abs_path = state
        .memo_file
        .read()
        .unwrap()
        .find_memo_file_by_id(&id)
        .map(|p| p.display().to_string());
    // 自写抑制提前到删盘前 — 删盘触发 notify Remove 事件, watcher 命中
    // 抑制表后只走 unregister_and_emit 一次, 不会让 unregister_memo_by_path
    // 跟 mark 顺序颠倒。
    if let Some(ref path) = abs_path {
        mark_self_write_for(&app, Path::new(path));
    }
    let ok = state.memo_file.write().unwrap().delete_memo_file(&id);
    if ok {
        memo_events::emit(
            &app,
            MemoEvent::Deleted {
                id,
                path: abs_path.unwrap_or_default(),
            },
        );
    }
    ok
}

#[tauri::command]
pub fn clear_memos(notebook_id: Option<String>, state: State<AppState>, app: AppHandle) -> bool {
    let mut deleted_paths: Vec<(String, String)> = Vec::new();
    let success = {
        let mut memo_file = state.memo_file.write().unwrap();
        if let Some(ref id) = notebook_id {
            memo_file.set_current_notebook(Some(id.clone()));
        }
        let memos = memo_file.read_all_memos_filtered("all", "createdAt", None);
        let mut success = true;
        for memo in memos {
            let abs_path = memo_file
                .find_memo_file_by_id(&memo.id)
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            // 删盘前 mark — 每个待删路径都塞抑制表
            if !abs_path.is_empty() {
                mark_self_write_for(&app, Path::new(&abs_path));
            }
            if !memo_file.delete_memo_file(&memo.id) {
                success = false;
                continue;
            }
            deleted_paths.push((memo.id, abs_path));
        }
        success
    };
    // clear_memos 让当前 notebook 索引全部过期, 强制 rebuild (后台异步).
    if success {
        force_rebuild_index(state.inner(), &app);
    }
    // 给前端发 N 个 Deleted 事件 (统一协议, 不引入新的 BulkCleared 变体)
    for (id, path) in &deleted_paths {
        memo_events::emit(
            &app,
            MemoEvent::Deleted {
                id: id.clone(),
                path: path.clone(),
            },
        );
    }
    success
}
