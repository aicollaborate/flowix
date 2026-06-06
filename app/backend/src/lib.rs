mod agent;
mod commands;
mod global_meta_data;
mod memo_file;
mod prompt;
mod providers;
mod threads;
mod user_config;

use agent::AgentManager;
use commands::AppState;
use global_meta_data::GlobalMetaData;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager};
use threads::ThreadManager;

fn get_app_data_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("woopmemo")
}

fn get_user_config_dir(home_dir: &PathBuf) -> PathBuf {
    home_dir.join(".woop")
}

/// 把旧 SQLite `app.db` 里的 `app_state` 表一次性搬到
/// `~/.woop/global_meta_data.json`。读得到就写, 然后删老文件; 读不到或
/// 新文件已存在则不动 (避免覆盖用户数据)。
fn migrate_legacy_app_db(app_data_path: &PathBuf, target: &PathBuf) {
    let legacy = app_data_path.join("app.db");
    if !legacy.exists() || target.exists() {
        return;
    }
    let conn = match rusqlite::Connection::open(&legacy) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("failed to open legacy app.db: {e}");
            return;
        }
    };
    let mut stmt = match conn.prepare("SELECT key, value FROM app_state") {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("failed to query app_state: {e}");
            return;
        }
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    });
    let mut map = serde_json::Map::new();
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            map.insert(row.0, serde_json::Value::String(row.1));
        }
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(&map)
        .ok()
        .and_then(|c| std::fs::write(target, c).ok())
    {
        Some(_) => {
            let _ = std::fs::remove_file(&legacy);
            tracing::info!(
                "migrated app_state table from {} to {}",
                legacy.display(),
                target.display()
            );
        }
        None => {
            tracing::warn!("failed to write {}", target.display());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_path = get_app_data_path();
    std::fs::create_dir_all(&app_data_path).ok();

    let thread_db_path = app_data_path.join("thread.db");

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let user_config_dir = get_user_config_dir(&home_dir);
    let user_config = Arc::new(user_config::UserConfigStore::new(home_dir.clone()));

    // 笔记本配置走 ~/.woop/notebook.json, 与 preference.json / ai_config.json 同目录。
    // 旧版本写在 app_data_path/notebook.json, 这里做一次性迁移。
    let legacy_notebook_path = app_data_path.join("notebook.json");
    let notebook_file_path = user_config_dir.join("notebook.json");
    if legacy_notebook_path.exists() && !notebook_file_path.exists() {
        if let Err(e) = std::fs::create_dir_all(notebook_file_path.parent().unwrap()) {
            tracing::warn!("failed to create ~/.woop dir for notebook migration: {e}");
        } else if let Err(e) = std::fs::copy(&legacy_notebook_path, &notebook_file_path) {
            tracing::warn!("failed to migrate notebook.json: {e}");
        } else {
            let _ = std::fs::remove_file(&legacy_notebook_path);
            tracing::info!(
                "migrated notebook.json from {} to {}",
                legacy_notebook_path.display(),
                notebook_file_path.display()
            );
        }
    }

    let memo_file = memo_file::MemoFile::new(app_data_path.clone(), notebook_file_path);
    memo_file.init_default_notebook();

    // 全局元数据走 ~/.woop/global_meta_data.json, 旧版 SQLite app.db 一次性迁移。
    let global_meta_path = user_config_dir.join("global_meta_data.json");
    migrate_legacy_app_db(&app_data_path, &global_meta_path);
    let global_meta_data =
        GlobalMetaData::new(global_meta_path).expect("Failed to initialize global meta data");

    let app_state = AppState {
        user_config,
        global_meta_data,
        memo_file: RwLock::new(memo_file),
        agent_manager: tokio::sync::RwLock::new(AgentManager::new()),
        thread_manager: tokio::sync::RwLock::new(
            ThreadManager::new(thread_db_path).expect("Failed to initialize thread database"),
        ),
    };

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = commands::markdown_paths_from_args(args);
            if paths.is_empty() {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let _ = app.emit("external-markdown-opened", paths);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // 偏好 (JSON, 走 user_config)
            commands::get_preference,
            commands::set_preference,
            commands::get_ai_config,
            commands::set_ai_config,
            // 全局元数据 (JSON, 走 global_meta_data) — 仅用于 memo-list 等
            commands::get_setting,
            commands::get_all_settings,
            commands::set_setting,
            commands::set_multiple_settings,
            commands::delete_setting,
            commands::get_memos,
            commands::read_memo,
            commands::read_document,
            commands::write_document,
            commands::get_launch_open_files,
            commands::add_document,
            commands::import_external_document_to_memo,
            commands::update_memo_db,
            commands::delete_memo,
            commands::clear_memos,
            commands::favorite_memo,
            commands::unfavorite_memo,
            commands::get_all_tags,
            commands::create_memo_tag,
            commands::rename_memo_tag,
            commands::delete_memo_tag,
            commands::get_notebooks,
            commands::create_notebook,
            commands::update_notebook,
            commands::delete_notebook,
            commands::clear_notebooks,
            commands::set_current_notebook,
            commands::get_file_tree,
            commands::get_dir_children,
            commands::read_file,
            commands::write_file,
            commands::delete_file,
            commands::create_folder,
            commands::create_document,
            commands::select_directory,
            commands::select_files,
            commands::save_file_dialog,
            commands::write_export_file,
            commands::save_attachment,
            commands::save_attachment_content,
            commands::chat_with_agent,
            commands::chat_with_agent_stream,
            commands::thread_list,
            commands::thread_create,
            commands::thread_get,
            commands::thread_delete,
            commands::open_preferences_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
