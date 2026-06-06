use crate::agent::{
    AgentChatResponse, AgentManager, AgentUserMessage, DEFAULT_AGENT_ID,
};
use crate::global_meta_data::GlobalMetaData;
use crate::memo_file::{Memo, MemoFile, Notebook, TodoItem};
use crate::threads::{ChatMessage, ThreadInfo, ThreadManager};
use crate::user_config::{AiConfigFile, PreferenceFile, UserConfigStore};
use base64::Engine;
use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub user_config: Arc<UserConfigStore>,
    /// 全局元数据 KV (notebook tag 顺序、隐藏状态等)。
    /// 存 `~/.woop/global_meta_data.json`, 替代旧版 SQLite `app.db`。
    pub global_meta_data: GlobalMetaData,
    pub memo_file: RwLock<MemoFile>,
    pub agent_manager: tokio::sync::RwLock<AgentManager>,
    pub thread_manager: tokio::sync::RwLock<ThreadManager>,
}

fn is_markdown_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
        && path.is_file()
}

pub fn markdown_paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter_map(|arg| {
            let path = Path::new(&arg);
            if is_markdown_file_path(path) {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

fn strip_markdown_frontmatter(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("---") else {
        return content;
    };
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'));
    let Some(rest) = rest else {
        return content;
    };

    if let Some(index) = rest.find("\r\n---\r\n") {
        return &rest[index + "\r\n---\r\n".len()..];
    }
    if let Some(index) = rest.find("\n---\n") {
        return &rest[index + "\n---\n".len()..];
    }

    content
}

fn title_from_markdown_content(content: &str, fallback: &str) -> String {
    strip_markdown_frontmatter(content)
        .lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .map(|line| {
            line.trim_start_matches('#')
                .trim()
                .trim_matches(|c| matches!(c, '*' | '_' | '`'))
                .trim()
                .to_string()
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn canonical_existing_or_parent(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path).ok();
    }

    let parent = path.parent()?;
    let canonical_parent = fs::canonicalize(parent).ok()?;
    Some(canonical_parent.join(path.file_name()?))
}

fn path_is_inside(path: &Path, root: &Path) -> bool {
    let Some(path) = canonical_existing_or_parent(path) else {
        return false;
    };
    let Some(root) = canonical_existing_or_parent(root) else {
        return false;
    };
    path.starts_with(root)
}

fn is_registered_notebook_path(path: &Path, state: &State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    memo_file
        .registered_notebook_paths()
        .iter()
        .any(|root| path_is_inside(path, root))
}

fn is_markdown_like(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn can_access_document_path(path: &Path, state: &State<AppState>) -> bool {
    is_registered_notebook_path(path, state) || is_markdown_like(path)
}

fn can_access_scoped_file(
    file_path: &Path,
    space_path: Option<&str>,
    state: &State<AppState>,
) -> bool {
    let Some(space_path) = space_path else {
        return false;
    };
    let root = Path::new(space_path);
    is_registered_notebook_path(root, state) && path_is_inside(file_path, root)
}

fn sanitize_attachment_file_name(name: &str) -> String {
    let leaf = Path::new(name)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment");

    let sanitized: String = leaf
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();

    let sanitized = sanitized.trim_matches(|ch| matches!(ch, ' ' | '.'));
    if sanitized.is_empty() {
        "attachment".to_string()
    } else {
        sanitized.to_string()
    }
}

fn unique_attachment_path(attachments_dir: &Path, requested_name: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_attachment_file_name(requested_name);
    let candidate = attachments_dir.join(&safe_name);
    if !path_is_inside(&candidate, attachments_dir) {
        return Err("Invalid attachment path".to_string());
    }
    if !candidate.exists() {
        return Ok(candidate);
    }

    let safe_path = Path::new(&safe_name);
    let stem = safe_path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment");
    let ext = safe_path.extension().and_then(OsStr::to_str);

    for index in 1..10_000 {
        let file_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{}_{}.{}", stem, index, ext),
            _ => format!("{}_{}", stem, index),
        };
        let candidate = attachments_dir.join(file_name);
        if !path_is_inside(&candidate, attachments_dir) {
            return Err("Invalid attachment path".to_string());
        }
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Unable to allocate attachment file name".to_string())
}

// ==================== Settings Commands ====================

/// 跨窗口同步事件 — 任一窗口成功写入偏好 / AI 配置后 emit, 其它窗口
/// (主窗口 / 偏好窗口 / 未来的多窗口) 收到后从磁盘重新 load。
/// 解决: 两个 Tauri 窗口各跑独立 React 树 + 独立 zustand store, 一边
/// 改动另一边看不到的问题。
const USER_CONFIG_CHANGED_EVENT: &str = "user-config-changed";

/// 用户偏好 (preference.json) — 走 ~/.woop/preference.json
#[tauri::command]
pub fn get_preference(state: State<AppState>) -> PreferenceFile {
    state.user_config.get_preference()
}

#[tauri::command]
pub fn set_preference(
    preference: PreferenceFile,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .user_config
        .set_preference(preference)
        .map(|_| app.emit(USER_CONFIG_CHANGED_EVENT, "preference").map_err(|e| e.to_string()))
        .map_err(|e| e.to_string())?
}

/// 智能体配置 (ai_config.json) — 走 ~/.woop/ai_config.json
#[tauri::command]
pub fn get_ai_config(state: State<AppState>) -> AiConfigFile {
    state.user_config.get_ai_config()
}

#[tauri::command]
pub fn set_ai_config(
    config: AiConfigFile,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .user_config
        .set_ai_config(config)
        .map(|_| app.emit(USER_CONFIG_CHANGED_EVENT, "ai_config").map_err(|e| e.to_string()))
        .map_err(|e| e.to_string())?
}

// ==================== App State Commands (KV 存储, 非偏好) ====================
// 用于 memo-list 存每个 notebook 的 tag 顺序 / 隐藏状态等。
// 保留原 settings.* 命令名 + 旧签名, 避免破坏前端调用方。

#[derive(Serialize)]
pub struct GetSettingResponse {
    pub value: Option<String>,
}

#[tauri::command]
pub fn get_setting(key: String, state: State<AppState>) -> GetSettingResponse {
    GetSettingResponse {
        value: state.global_meta_data.get(&key),
    }
}

#[derive(Serialize)]
pub struct GetAllSettingsResponse {
    pub settings: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn get_all_settings(state: State<AppState>) -> GetAllSettingsResponse {
    let mut map = std::collections::HashMap::new();
    for (k, v) in state.global_meta_data.get_all() {
        map.insert(k, v);
    }
    GetAllSettingsResponse { settings: map }
}

#[tauri::command]
pub fn set_setting(key: String, value: String, state: State<AppState>) -> Result<(), String> {
    // 现有 set/delete 是 fire-and-forget, 内部已 warn 但不返回错误。
    // 这里返回 Ok 让前端能 await; 真正的磁盘错误仍在 tracing 日志里。
    state.global_meta_data.set(&key, &value);
    Ok(())
}

#[tauri::command]
pub fn set_multiple_settings(
    settings: std::collections::HashMap<String, String>,
    state: State<AppState>,
) -> Result<(), String> {
    for (key, value) in settings {
        state.global_meta_data.set(&key, &value);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_setting(key: String, state: State<AppState>) -> Result<bool, String> {
    Ok(state.global_meta_data.delete(&key))
}

// ==================== Memo Commands ====================

#[derive(Serialize)]
pub struct GetMemosResponse {
    pub memos: Vec<Memo>,
}

#[tauri::command]
pub fn get_memos(
    notebook_id: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    tag_id: Option<String>,
    state: State<AppState>,
) -> GetMemosResponse {
    let mut memo_file = state.memo_file.write().unwrap();
    if let Some(ref id) = notebook_id {
        memo_file.set_current_notebook(Some(id.clone()));
    }
    let memos = memo_file.read_all_memos_filtered(
        filter.as_deref().unwrap_or("all"),
        sort.as_deref().unwrap_or("createdAt"),
        tag_id.as_deref(),
    );
    GetMemosResponse { memos }
}

// ==================== Doc Commands ====================

#[tauri::command]
pub fn read_document(file_path: String, state: State<AppState>) -> Option<String> {
    eprintln!("[read_document] file_path: {}", file_path);
    if !can_access_document_path(Path::new(&file_path), &state) {
        eprintln!("[read_document] refused out-of-scope path: {}", file_path);
        return None;
    }
    let result = fs::read_to_string(&file_path);
    eprintln!("[read_document] result: {:?}", result.is_ok());
    result.ok()
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_document(
    file_path: String,
    content: String,
    expectedContent: Option<String>,
    state: State<AppState>,
) -> bool {
    if !can_access_document_path(Path::new(&file_path), &state) {
        eprintln!("[write_document] refused out-of-scope path: {}", file_path);
        return false;
    }
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Some(expected_content) = expectedContent {
        match fs::read_to_string(&file_path) {
            Ok(current_content) if current_content == expected_content => {}
            Ok(_) => {
                eprintln!(
                    "[write_document] Refused stale write because {} changed on disk",
                    file_path
                );
                return false;
            }
            Err(e) => {
                eprintln!(
                    "[write_document] Failed to verify current content for {}: {}",
                    file_path, e
                );
                return false;
            }
        }
    }
    match fs::write(&file_path, &content) {
        Ok(_) => true,
        Err(e) => {
            eprintln!("[write_document] Failed to write to {}: {}", file_path, e);
            false
        }
    }
}

#[tauri::command]
pub fn get_launch_open_files() -> Vec<String> {
    markdown_paths_from_args(std::env::args())
}

// ==================== Memo Commands ====================

#[tauri::command]
pub fn read_memo(id: String, state: State<AppState>) -> Option<Memo> {
    state.memo_file.read().unwrap().read_memo(&id)
}

fn generate_memo_id() -> String {
    let id = nanoid::nanoid!(6);
    format!("m_{}", id)
}

#[tauri::command]
pub fn add_document(
    tag: Option<String>,
    notebook_id: Option<String>,
    state: State<AppState>,
) -> Memo {
    let mut memo_file = state.memo_file.write().unwrap();
    if let Some(ref id) = notebook_id {
        memo_file.set_current_notebook(Some(id.clone()));
    }

    let id = generate_memo_id();
    let now = chrono::Utc::now().timestamp_millis();
    let filename = chrono::Local::now().format("%Y-%m-%d").to_string();
    let tag_line = tag.as_ref().map(|t| format!("#{}", t)).unwrap_or_default();
    let content = format!("# {}\n{}\n", filename, tag_line);

    // Compute relative path before update_memo_item (which generates filename with id suffix)
    let memo_filename = format!("{}-{}.md", filename, id);
    let path = Some(memo_filename.clone());

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
        path,
    };

    if memo_file.update_memo_item(&memo, Some(&content)).is_err() {
        return memo;
    }
    memo_file.read_memo(&memo.id).unwrap_or(memo)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_external_document_to_memo(
    source_path: String,
    content: String,
    notebook_id: Option<String>,
    state: State<AppState>,
) -> Option<Memo> {
    let mut memo_file = state.memo_file.write().unwrap();
    if let Some(ref id) = notebook_id {
        memo_file.set_current_notebook(Some(id.clone()));
    }

    let source_name = Path::new(&source_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported Markdown");
    let title = title_from_markdown_content(&content, source_name);
    let body = strip_markdown_frontmatter(&content);
    let now = chrono::Utc::now().timestamp_millis();
    let id = generate_memo_id();

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
        path: None,
    };

    memo_file.update_memo_item(&memo, Some(body)).ok()?;
    memo_file.read_memo(&memo.id).or_else(|| Some(memo))
}

#[tauri::command]
pub fn update_memo_db(
    id: String,
    filename: Option<String>,
    content: Option<String>,
    _tags: Option<Vec<String>>,
    _todos: Option<Vec<TodoItem>>,
    preview: Option<String>,
    state: State<AppState>,
) -> bool {
    eprintln!("[update_memo_db] id: {}, filename: {:?}", id, filename);
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    if let Some(t) = filename {
        memo.filename = t;
    }
    if let Some(p) = preview {
        memo.preview = p;
    }
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    // Tags and todos are memo-derived indexes. Refresh the memo index from the
    // current markdown body instead of trusting frontend-supplied derived data.
    memo_file
        .update_memo_item(&memo, content.as_deref())
        .is_ok()
}

#[tauri::command]
pub fn delete_memo(id: String, state: State<AppState>) -> bool {
    state.memo_file.write().unwrap().delete_memo_file(&id)
}

#[tauri::command]
pub fn clear_memos(notebook_id: Option<String>, state: State<AppState>) -> bool {
    let mut memo_file = state.memo_file.write().unwrap();
    if let Some(ref id) = notebook_id {
        memo_file.set_current_notebook(Some(id.clone()));
    }
    let memos = memo_file.read_all_memos_filtered("all", "createdAt", None);
    let mut success = true;
    for memo in memos {
        if !memo_file.delete_memo_file(&memo.id) {
            success = false;
        }
    }
    success
}

#[tauri::command]
pub fn favorite_memo(id: String, state: State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    memo.favorited = true;
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    memo_file.sync_to_list_json_only(&memo).is_ok()
}

#[tauri::command]
pub fn unfavorite_memo(id: String, state: State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut memo = match memo_file.read_memo(&id) {
        Some(m) => m,
        None => return false,
    };

    memo.favorited = false;
    memo.updated_at = chrono::Utc::now().timestamp_millis();

    memo_file.sync_to_list_json_only(&memo).is_ok()
}

// ==================== Tag Commands ====================

#[derive(Serialize)]
pub struct GetAllTagsResponse {
    pub tags: Vec<TagWithId>,
}

#[derive(Serialize)]
pub struct TagWithId {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> GetAllTagsResponse {
    let tags = state.memo_file.read().unwrap().derived_tags();
    GetAllTagsResponse {
        tags: tags
            .into_iter()
            .map(|t| TagWithId {
                id: t.id,
                name: t.name,
            })
            .collect(),
    }
}

#[tauri::command]
pub fn create_memo_tag(name: String, state: State<AppState>) -> Option<TagWithId> {
    let exists = state
        .memo_file
        .read()
        .unwrap()
        .derived_tags()
        .into_iter()
        .any(|tag| tag.name.eq_ignore_ascii_case(&name));

    exists.then(|| TagWithId {
        id: name.clone(),
        name,
    })
}

#[tauri::command]
pub fn rename_memo_tag(_id: String, _name: String, _state: State<AppState>) -> Option<TagWithId> {
    None
}

#[tauri::command]
pub fn delete_memo_tag(_id: String, _state: State<AppState>) -> bool {
    false
}

// ==================== Notebook Commands ====================

#[tauri::command]
pub fn get_notebooks(state: State<AppState>) -> Vec<Notebook> {
    state
        .memo_file
        .read()
        .unwrap()
        .read_notebook_configs()
        .unwrap_or_default()
        .into_iter()
        .map(|c| Notebook {
            id: c.id,
            name: c.name,
            icon: c.icon.unwrap_or_else(|| "📓".to_string()),
            path: c.path,
            created_at: c.created_at,
            updated_at: c.updated_at,
            is_default: c.is_default,
        })
        .collect()
}

#[tauri::command]
pub fn create_notebook(
    name: String,
    path: String,
    icon: Option<String>,
    state: State<AppState>,
) -> Option<Notebook> {
    let mut memo_file = state.memo_file.write().unwrap();

    let now = chrono::Utc::now().timestamp_millis();
    let id = format!("nb_{}", now);

    let config = crate::memo_file::NotebookConfig {
        id: id.clone(),
        name: name.clone(),
        icon: icon.clone().or_else(|| Some("📓".to_string())),
        path: if path.ends_with('/') {
            path.clone()
        } else {
            format!("{}/", path)
        },
        is_default: false,
        created_at: now,
        updated_at: now,
    };

    let mut configs = memo_file.read_notebook_configs().unwrap_or_default();
    configs.push(config);

    memo_file.write_notebook_configs(&configs).ok()?;

    memo_file.set_current_notebook(Some(id.clone()));

    Some(Notebook {
        id,
        name,
        path,
        icon: icon.unwrap_or_else(|| "📓".to_string()),
        created_at: now,
        updated_at: now,
        is_default: false,
    })
}

#[tauri::command]
pub fn update_notebook(
    id: String,
    name: Option<String>,
    icon: Option<String>,
    state: State<AppState>,
) -> Option<Notebook> {
    let memo_file = state.memo_file.read().unwrap();
    let mut configs = memo_file.read_notebook_configs().ok()?;

    let index = configs.iter().position(|c| c.id == id)?;

    if let Some(n) = name {
        configs[index].name = n;
    }
    if let Some(i) = icon {
        configs[index].icon = Some(i);
    }
    configs[index].updated_at = chrono::Utc::now().timestamp_millis();

    memo_file.write_notebook_configs(&configs).ok()?;

    let c = &configs[index];
    Some(Notebook {
        id: c.id.clone(),
        name: c.name.clone(),
        path: c.path.clone(),
        icon: c.icon.clone().unwrap_or_else(|| "📓".to_string()),
        created_at: c.created_at,
        updated_at: c.updated_at,
        is_default: c.is_default,
    })
}

#[tauri::command]
pub fn delete_notebook(id: String, state: State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut configs = memo_file.read_notebook_configs().unwrap_or_default();

    let index = match configs.iter().position(|c| c.id == id && !c.is_default) {
        Some(idx) => idx,
        None => return false,
    };
    configs.remove(index);

    memo_file.write_notebook_configs(&configs).is_ok()
}

#[tauri::command]
pub fn clear_notebooks(state: State<AppState>) -> bool {
    let memo_file = state.memo_file.read().unwrap();
    let mut configs = memo_file.read_notebook_configs().unwrap_or_default();

    configs.retain(|c| c.is_default);

    memo_file.write_notebook_configs(&configs).is_ok()
}

#[tauri::command]
pub fn set_current_notebook(notebook_id: Option<String>, state: State<AppState>) {
    state
        .memo_file
        .write()
        .unwrap()
        .set_current_notebook(notebook_id);
}

// ==================== File Commands ====================

#[derive(Serialize)]
pub struct DocTreeItem {
    pub id: String,
    pub full_path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub parent_id: Option<String>,
    pub children: Option<Vec<DocTreeItem>>,
}

fn generate_stable_id(full_path: &str) -> String {
    format!(
        "file-{}",
        full_path.replace(['\\', '/', '#', '%', '?', '&'], "_")
    )
}

fn read_dir_recursive(dir_path: &std::path::Path, parent_id: Option<String>) -> Vec<DocTreeItem> {
    let mut items = Vec::new();

    if !dir_path.exists() {
        return items;
    }

    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files
            if name.starts_with('.') {
                continue;
            }

            let is_dir = path.is_dir();
            let item = DocTreeItem {
                id: generate_stable_id(&path.to_string_lossy()),
                full_path: path.to_string_lossy().to_string(),
                name,
                item_type: if is_dir {
                    "folder".to_string()
                } else {
                    "document".to_string()
                },
                parent_id: parent_id.clone(),
                children: if is_dir {
                    Some(read_dir_recursive(&path, None))
                } else {
                    None
                },
            };

            items.push(item);
        }
    }

    // Sort: folders first, then by name
    items.sort_by(|a, b| {
        if a.item_type != b.item_type {
            if a.item_type == "folder" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.cmp(&b.name)
        }
    });

    items
}

#[tauri::command]
pub fn get_file_tree(space_path: String, state: State<AppState>) -> Option<Vec<DocTreeItem>> {
    let path = std::path::Path::new(&space_path);
    if !path.exists() || !is_registered_notebook_path(path, &state) {
        return None;
    }
    Some(read_dir_recursive(path, None))
}

#[tauri::command]
pub fn get_dir_children(dir_path: String, state: State<AppState>) -> Vec<DocTreeItem> {
    let path = std::path::Path::new(&dir_path);
    if !path.exists() || !is_registered_notebook_path(path, &state) {
        return vec![];
    }
    read_dir_recursive(path, None)
}

#[tauri::command]
pub fn read_file(
    file_path: String,
    space_path: Option<String>,
    state: State<AppState>,
) -> Option<String> {
    if !can_access_scoped_file(Path::new(&file_path), space_path.as_deref(), &state) {
        eprintln!("[read_file] refused out-of-scope path: {}", file_path);
        return None;
    }
    std::fs::read_to_string(&file_path).ok()
}

#[tauri::command]
pub fn write_file(
    file_path: String,
    content: String,
    _skip_validation: Option<bool>,
    space_path: Option<String>,
    state: State<AppState>,
) -> bool {
    if !can_access_scoped_file(Path::new(&file_path), space_path.as_deref(), &state) {
        eprintln!("[write_file] refused out-of-scope path: {}", file_path);
        return false;
    }
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&file_path, content).is_ok()
}

#[tauri::command]
pub fn delete_file(file_path: String, space_path: Option<String>, state: State<AppState>) -> bool {
    if !can_access_scoped_file(Path::new(&file_path), space_path.as_deref(), &state) {
        eprintln!("[delete_file] refused out-of-scope path: {}", file_path);
        return false;
    }
    std::fs::remove_file(&file_path).is_ok()
}

#[tauri::command]
pub fn create_folder(
    space_path: String,
    name: String,
    _parent_id: Option<String>,
    state: State<AppState>,
) -> Option<DocTreeItem> {
    let target_path = std::path::Path::new(&space_path).join(&name);
    if !is_registered_notebook_path(Path::new(&space_path), &state)
        || !path_is_inside(&target_path, Path::new(&space_path))
    {
        eprintln!(
            "[create_folder] refused out-of-scope path: {}",
            target_path.display()
        );
        return None;
    }
    std::fs::create_dir_all(&target_path).ok()?;

    Some(DocTreeItem {
        id: generate_stable_id(&target_path.to_string_lossy()),
        full_path: target_path.to_string_lossy().to_string(),
        name,
        item_type: "folder".to_string(),
        parent_id: None,
        children: Some(vec![]),
    })
}

#[tauri::command]
pub fn create_document(
    space_path: String,
    name: String,
    _parent_id: Option<String>,
    state: State<AppState>,
) -> Option<DocTreeItem> {
    let file_name = if name.ends_with(".md") {
        name.clone()
    } else {
        format!("{}.md", name)
    };
    let target_path = std::path::Path::new(&space_path).join(&file_name);
    if !is_registered_notebook_path(Path::new(&space_path), &state)
        || !path_is_inside(&target_path, Path::new(&space_path))
    {
        eprintln!(
            "[create_document] refused out-of-scope path: {}",
            target_path.display()
        );
        return None;
    }
    std::fs::write(&target_path, "").ok()?;

    Some(DocTreeItem {
        id: generate_stable_id(&target_path.to_string_lossy()),
        full_path: target_path.to_string_lossy().to_string(),
        name: file_name,
        item_type: "document".to_string(),
        parent_id: None,
        children: None,
    })
}

// ==================== Dialog Commands ====================

#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Option<String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;
    use tokio::task;

    let (tx, rx) = mpsc::channel();

    // Run blocking dialog in a background thread to avoid freezing the UI
    let handle = app.clone();
    task::spawn_blocking(move || {
        let result = handle
            .dialog()
            .file()
            .set_title("选择笔记本文件夹")
            .blocking_pick_folder()
            .map(|p| p.to_string());
        tx.send(result).ok();
    });

    rx.recv().ok().flatten()
}

#[tauri::command]
pub async fn save_attachment(
    source_path: String,
    notebook_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    {
        let mut memo_file = state.memo_file.write().unwrap();
        if let Some(ref id) = notebook_id {
            memo_file.set_current_notebook(Some(id.clone()));
        }
    }

    let attachments_dir = state
        .memo_file
        .read()
        .unwrap()
        .get_memo_base()
        .join("attachments");
    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    let source = std::path::Path::new(&source_path);
    let file_name = source
        .file_name()
        .ok_or("Invalid file name")?
        .to_str()
        .ok_or("Invalid file name")?;
    let dest_path = unique_attachment_path(&attachments_dir, file_name)?;

    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    Ok(Some(dest_path.to_str().unwrap().to_string()))
}

#[tauri::command]
pub async fn save_attachment_content(
    content: String,
    file_name: String,
    notebook_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    {
        let mut memo_file = state.memo_file.write().unwrap();
        if let Some(ref id) = notebook_id {
            memo_file.set_current_notebook(Some(id.clone()));
        }
    }

    let attachments_dir = state
        .memo_file
        .read()
        .unwrap()
        .get_memo_base()
        .join("attachments");
    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    let dest_path = unique_attachment_path(&attachments_dir, &file_name)?;

    // Decode base64 content and write to file
    let decoded = base64_decode(&content).map_err(|e| format!("Failed to decode base64: {}", e))?;
    fs::write(&dest_path, decoded).map_err(|e| e.to_string())?;

    Ok(Some(dest_path.to_str().unwrap().to_string()))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Handle both standard base64 and URL-safe base64
    let input = input.replace('-', "+").replace('_', "/");
    let padding = match input.len() % 4 {
        2 => "==",
        3 => "=",
        _ => "",
    };
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(format!("{}{}", input, padding))
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    Ok(decoded)
}

#[tauri::command]
pub async fn select_files(app: tauri::AppHandle) -> Option<Vec<String>> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;
    use tokio::task;

    let (tx, rx) = mpsc::channel();

    let handle = app.clone();
    task::spawn_blocking(move || {
        let result = handle
            .dialog()
            .file()
            .add_filter(
                "Attachments",
                &[
                    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "doc", "docx", "xls",
                    "xlsx", "ppt", "pptx", "txt", "md", "csv", "json", "mp3", "wav", "ogg", "mp4",
                    "webm", "mov", "avi", "zip", "rar", "7z", "tar", "gz",
                ],
            )
            .set_title("选择图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
            .add_filter("All files", &["*"])
            .blocking_pick_files()
            .map(|paths| paths.into_iter().map(|p| p.to_string()).collect());
        tx.send(result).ok();
    });

    rx.recv().ok().flatten()
}

#[tauri::command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    suggested_name: Option<String>,
    filters: Option<Vec<Vec<String>>>,
) -> Option<String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;
    use tokio::task;

    let (tx, rx) = mpsc::channel();

    let handle = app.clone();
    let suggested = suggested_name.unwrap_or_else(|| "Untitled".to_string());
    let filter_list = filters.unwrap_or_default();

    task::spawn_blocking(move || {
        let mut builder = handle
            .dialog()
            .file()
            .set_title("保存文件")
            .set_file_name(&suggested);

        for filter in &filter_list {
            if filter.is_empty() {
                continue;
            }
            let name = filter[0].clone();
            let exts: Vec<&str> = filter.iter().skip(1).map(|s| s.as_str()).collect();
            if !exts.is_empty() {
                builder = builder.add_filter(&name, &exts);
            }
        }

        let result = builder.blocking_save_file().map(|p| p.to_string());
        tx.send(result).ok();
    });

    rx.recv().ok().flatten()
}

fn write_bytes_to_path(file_path: &str, bytes: &[u8]) -> bool {
    if file_path.trim().is_empty() {
        return false;
    }
    let path = Path::new(file_path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(path, bytes).is_ok()
}

#[tauri::command]
pub fn write_export_file(file_path: String, content: String) -> bool {
    write_bytes_to_path(&file_path, content.as_bytes())
}

// ==================== Agent Commands ====================
//
// Agent 的配置真源是 ~/.woop/ai_config.json (经 `set_ai_config` 命令落盘)。
// 后端按需从 `UserConfigStore` 拉取并在 `AgentManager` 里缓存 provider 实例,
// 前端不再 init agent / 提交模型信息, 只发起 chat / thread 操作。

#[tauri::command]
#[allow(non_snake_case)]
pub async fn chat_with_agent(
    threadId: String,
    message: AgentUserMessage,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AgentChatResponse, String> {
    let manager = state.agent_manager.read().await;
    manager
        .chat(&threadId, message, &state, &app_handle)
        .await
        .map(|response| AgentChatResponse { response })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn chat_with_agent_stream(
    threadId: String,
    message: AgentUserMessage,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AgentChatResponse, String> {
    tracing::info!(
        "[Command] chat_with_agent_stream called for thread: {}",
        threadId
    );
    let manager = state.agent_manager.read().await;
    let result = manager
        .chat_stream(&threadId, message, &state, &app_handle)
        .await;
    tracing::info!(
        "[Command] chat_with_agent_stream result: {:?}",
        result.is_ok()
    );
    result.map(|response| AgentChatResponse { response })
}

// ==================== Thread Commands ====================

#[tauri::command]
pub async fn thread_list(state: State<'_, AppState>) -> Result<Vec<ThreadInfo>, String> {
    let manager = state.thread_manager.read().await;
    manager.list_threads().await
}

#[tauri::command]
pub async fn thread_create(
    title: String,
    state: State<'_, AppState>,
) -> Result<ThreadInfo, String> {
    let manager = state.thread_manager.read().await;
    // agent_id 列保留以兼容旧 schema, 统一用 DEFAULT_AGENT_ID 占位 ─ 见 agent.rs。
    manager
        .create_thread(DEFAULT_AGENT_ID.to_string(), title)
        .await
}

#[derive(Serialize)]
pub struct GetThreadResponse {
    pub messages: Vec<ChatMessage>,
}

#[tauri::command]
pub async fn thread_get(
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<GetThreadResponse, String> {
    let manager = state.thread_manager.read().await;
    match manager.get_thread(&thread_id).await? {
        Some(thread) => Ok(GetThreadResponse {
            messages: thread.messages,
        }),
        None => Err("Thread not found".to_string()),
    }
}

#[tauri::command]
pub async fn thread_delete(thread_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let manager = state.thread_manager.read().await;
    manager.delete_thread(&thread_id).await
}

// ==================== Window Commands ====================

#[tauri::command]
pub async fn open_preferences_window(
    app: tauri::AppHandle,
    tab: Option<String>,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let url = match tab {
        Some(t) => format!("index.html#preferences/{}", t),
        None => "index.html#preferences".to_string(),
    };

    // Check if window already exists
    if let Some(window) = app.get_webview_window("preferences") {
        window.set_focus().ok();
        window
            .eval(format!(
                "window.location.hash = '{}';",
                url.split('#').next_back().unwrap_or("")
            ))
            .ok();
        return Ok(());
    }

    let builder =
        WebviewWindowBuilder::new(&app, "preferences", tauri::WebviewUrl::App(url.into()))
            .title("Preferences")
            .inner_size(800.0, 600.0)
            .center();

    // macOS: use the same overlay title bar style as the main window so the
    // app-rendered drag region is contiguous with the system-rendered traffic
    // lights, instead of stacking a second native title strip on top. The
    // traffic light cluster is positioned at x=18, y=25 — mirroring the main
    // window (`app/backend/tauri.conf.json`) so both windows visually share
    // the same origin and stay centered within the 48px (`h-12`) drag bar.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(
            tauri::LogicalPosition::new(18.0, 25.0),
        ));

    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);

    let _window = builder.build().map_err(|e| e.to_string())?;

    Ok(())
}
