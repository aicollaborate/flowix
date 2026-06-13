mod agent;
mod agent_access;
mod commands;
mod fs_watcher;
mod global_meta_data;
mod memo_events;
mod memo_file;
mod open_target;
mod path_scope;
mod prompt;
mod providers;
mod search;
mod threads;
mod user_config;

use agent::AgentManager;
use agent_access::AgentAccessStore;
use commands::AppState;
use global_meta_data::GlobalMetaData;
use search::{BigramTokenizer, MemoIndex};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager};
use threads::ThreadManager;

/// 用户配置目录名 (~/.<NAME>/ 下放 preference.json / ai_config.json /
/// notebook.json / global_meta_data.json)。原 WoopMemo 时代叫 `.woop`,
/// 2026/06 品牌重塑后改为 `.flowix`。 旧目录由 `migrate_legacy_woop_dirs`
/// 一次性迁移, 见 `run()`。
pub const USER_CONFIG_DIR_NAME: &str = ".flowix";

/// 桌面应用数据目录名 (在 `dirs::data_dir()` 之下, macOS:
/// `~/Library/Application Support/<NAME>/`)。 旧 WoopMemo 时代叫
/// `woopmemo`, 现统一为 `flowix`。
pub const APP_DATA_DIR_NAME: &str = "flowix";

fn get_app_data_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(APP_DATA_DIR_NAME)
}

fn get_user_config_dir(home_dir: &PathBuf) -> PathBuf {
    home_dir.join(USER_CONFIG_DIR_NAME)
}

/// 把旧 SQLite `app.db` 里的 `app_state` 表一次性搬到
/// `~/.flowix/global_meta_data.json`。读得到就写, 然后删老文件; 读不到或
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
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
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

/// 递归复制目录 (文件覆盖, 子目录递归创建)。 简单实现, 假设源都是
/// 普通文件 / 目录, 遇到 symlink 走 `fs::copy` 的跟随语义。
/// 仅用于一次性用户数据迁移, 不替代通用备份工具。
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// 把 WoopMemo 时代的用户数据目录一次性搬到 Flowix 位置。 三个目标:
///   1. `~/.woop/`                → `~/.flowix/`
///   2. `<data_dir>/woopmemo/`    → `<data_dir>/flowix/`
///   3. `~/Documents/woop notebook/` → `~/Documents/flowix/`
///
/// 触发条件: 旧目录存在 **且** 新目录不存在 (避免覆盖)。 任何步骤
/// 出错都 `tracing::warn!` 但不中断启动 — 用户数据在原位仍然可读。
/// **此操作不可逆**: 旧目录在 copy 成功后被 `remove_dir_all` 删除。
fn migrate_legacy_woop_dirs(home_dir: &PathBuf, app_data_path: &PathBuf) {
    // 1. ~/.woop/ → ~/.flowix/
    let old_cfg = home_dir.join(".woop");
    let new_cfg = home_dir.join(USER_CONFIG_DIR_NAME);
    if old_cfg.exists() && !new_cfg.exists() {
        match copy_dir_recursive(&old_cfg, &new_cfg) {
            Ok(()) => {
                if let Err(e) = std::fs::remove_dir_all(&old_cfg) {
                    tracing::warn!("failed to remove legacy ~/.woop after copy: {e}");
                } else {
                    tracing::info!("migrated ~/.woop → ~/.flowix");
                }
            }
            Err(e) => tracing::warn!("failed to copy ~/.woop → ~/.flowix: {e}"),
        }
    }

    // 2. <data_dir>/woopmemo/ → <app_data_path>
    //    app_data_path 此时已是 data_dir.join(APP_DATA_DIR_NAME) = data_dir/flowix。
    if let Some(parent) = app_data_path.parent() {
        let old_data = parent.join("woopmemo");
        if old_data.exists() && !app_data_path.exists() {
            match copy_dir_recursive(&old_data, app_data_path) {
                Ok(()) => {
                    if let Err(e) = std::fs::remove_dir_all(&old_data) {
                        tracing::warn!("failed to remove legacy app data dir: {e}");
                    } else {
                        tracing::info!(
                            "migrated {} → {}",
                            old_data.display(),
                            app_data_path.display()
                        );
                    }
                }
                Err(e) => tracing::warn!("failed to copy app data dir: {e}"),
            }
        }
    }

    // 3. ~/Documents/woop notebook/ → ~/Documents/flowix/
    if let Some(docs) = dirs::document_dir() {
        let old_nb = docs.join("woop notebook");
        let new_nb = docs.join("flowix");
        if old_nb.exists() && !new_nb.exists() {
            match copy_dir_recursive(&old_nb, &new_nb) {
                Ok(()) => {
                    if let Err(e) = std::fs::remove_dir_all(&old_nb) {
                        tracing::warn!("failed to remove legacy notebook dir: {e}");
                    } else {
                        tracing::info!("migrated ~/Documents/woop notebook → ~/Documents/flowix");
                    }
                }
                Err(e) => tracing::warn!("failed to copy notebook dir: {e}"),
            }
        }
    }

    // 4. notebook.json path rewrite. Step 3 moves the directory but
    //    notebook.json's `path` field still points at the old location,
    //    so the agent ends up trying to read from a deleted directory and
    //    `ToolScope` registers the wrong path as the only allowed root.
    rewrite_legacy_notebook_paths(home_dir);
}

/// One-shot rewrite of `~/.flowix/notebook.json` rows whose `path` still
/// contains the legacy `Documents/woop notebook` prefix. Idempotent —
/// only rows that mention `woop notebook` are touched. A no-op when the
/// file is absent or not deserializable as `Vec<NotebookConfig>`.
fn rewrite_legacy_notebook_paths(home_dir: &Path) {
    let Some(docs) = dirs::document_dir() else {
        return;
    };
    let old_prefix = docs.join("woop notebook");
    let new_prefix = docs.join("flowix");
    let notebook_path = home_dir.join(USER_CONFIG_DIR_NAME).join("notebook.json");
    let Ok(content) = std::fs::read_to_string(&notebook_path) else {
        return;
    };
    let Ok(mut configs) = serde_json::from_str::<Vec<memo_file::NotebookConfig>>(&content) else {
        tracing::debug!("notebook.json present but not deserializable as Vec<NotebookConfig>");
        return;
    };
    let old_segment = old_prefix.to_string_lossy().to_string();
    let new_segment = new_prefix.to_string_lossy().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let rewritten = configs
        .iter_mut()
        .filter(|cfg| cfg.path.contains(&old_segment) || cfg.path.contains("woop notebook"))
        .map(|cfg| {
            cfg.path = cfg
                .path
                .replace(&old_segment, &new_segment)
                .replace("woop notebook", "flowix");
            cfg.updated_at = now;
        })
        .count();
    if rewritten == 0 {
        return;
    }
    let serialized = match serde_json::to_string_pretty(&configs) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("failed to serialize notebook.json for rewrite: {e}");
            return;
        }
    };
    if let Err(e) = std::fs::write(&notebook_path, serialized) {
        tracing::warn!("failed to rewrite notebook.json paths: {e}");
    } else {
        tracing::info!(
            "rewrote {} legacy 'woop notebook' path(s) in notebook.json",
            rewritten
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_path = get_app_data_path();
    std::fs::create_dir_all(&app_data_path).ok();

    let thread_db_path = app_data_path.join("thread.db");

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));

    // 启动时一次性迁移 WoopMemo → Flowix 数据目录。 必须早于 user_config_dir
    // / user_config 初始化, 否则 UserConfigStore 会建一个空的 ~/.flowix/,
    // migrate 检测到新目录已存在就跳过, 旧 ~/.woop/ 数据被遗漏。
    migrate_legacy_woop_dirs(&home_dir, &app_data_path);

    let user_config_dir = get_user_config_dir(&home_dir);
    let user_config = Arc::new(user_config::UserConfigStore::new(home_dir.clone()));

    // 笔记本配置走 ~/.flowix/notebook.json, 与 preference.json / ai_config.json 同目录。
    // 旧版本写在 app_data_path/notebook.json, 这里做一次性迁移。
    let legacy_notebook_path = app_data_path.join("notebook.json");
    let notebook_file_path = user_config_dir.join("notebook.json");
    if legacy_notebook_path.exists() && !notebook_file_path.exists() {
        if let Err(e) = std::fs::create_dir_all(notebook_file_path.parent().unwrap()) {
            tracing::warn!("failed to create ~/.flowix dir for notebook migration: {e}");
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

    // 全局元数据走 ~/.flowix/global_meta_data.json, 旧版 SQLite app.db 一次性迁移。
    let global_meta_path = user_config_dir.join("global_meta_data.json");
    migrate_legacy_app_db(&app_data_path, &global_meta_path);
    let global_meta_data =
        GlobalMetaData::new(global_meta_path).expect("Failed to initialize global meta data");

    // 三个需要与 AgentManager 共享的依赖, 提前建好 Arc 再 clone。
    // refcount 期望: user_config=2 (AppState + AgentManager), thread_manager=2,
    // memo_file=2 ── 见 `commands.rs::AppState` 注释。
    let memo_file_arc = Arc::new(RwLock::new(memo_file));
    let thread_manager_arc = Arc::new(tokio::sync::RwLock::new(
        ThreadManager::new(thread_db_path).expect("Failed to initialize thread database"),
    ));
    // 启动时一次性清理孤儿 is_loading=1 行 ── 解决"上次进程在 tool_use
    // 落盘后被 SIGKILL / 强退, 下次启动看到转圈卡死工具行"的问题。 详见
    // `ThreadManager::clear_all_loading` 注释。`run()` 此时还在 tauri
    // runtime 起来之前, 不能 `.await`, 所以是同步方法 (内部单条
    // UPDATE, 没有真实异步工作)。读锁足够: clear 只走 UPDATE, 不会
    // 与正常 add_message / update_tool_result 冲突 (后者写同一行的 0,
    // 后到写后赢, 两条路径殊途同归)。
    {
        let manager = thread_manager_arc.blocking_read();
        match manager.clear_all_loading() {
            Ok(0) => tracing::debug!("[Startup] no orphan is_loading=1 rows"),
            Ok(n) => tracing::info!("[Startup] cleared {n} orphan is_loading=1 rows"),
            Err(e) => tracing::warn!("[Startup] clear_all_loading failed: {e}"),
        }
    }
    let user_config_arc = user_config.clone();

    // Agent 可访问目录 store ── 必须在 `notebook_file_path` 与 `memo_file_arc`
    // 都就绪之后构造 (新 store 会读 `notebook.json` 播种 + 对账)。
    let agent_access_arc = Arc::new(AgentAccessStore::new(
        user_config_dir.clone(),
        &*memo_file_arc.read().unwrap(),
    ));

    let app_state = AppState {
        user_config: user_config_arc.clone(),
        global_meta_data,
        memo_file: memo_file_arc.clone(),
        search: RwLock::new(MemoIndex::new(Arc::new(BigramTokenizer))),
        agent_manager: Arc::new(AgentManager::new(
            user_config_arc,
            thread_manager_arc.clone(),
            memo_file_arc.clone(),
            agent_access_arc.clone(),
        )),
        thread_manager: thread_manager_arc,
        agent_access: agent_access_arc,
    };

    // 笔记本目录文件监听器 — 把外部编辑器 / 其他 AI 的磁盘变更转成
    // `memo-event` 推前端。绑定到启动时的当前 notebook 目录, 切换 notebook
    // 时由 commands::switch_notebook_and_rebuild 负责 rebind。`AppHandle` 在
    // `run()` 阶段拿不到, 实际 rebind 在 .setup() 闭包里完成。
    let memo_watcher = Arc::new(RwLock::new(fs_watcher::MemoWatcher::new(
        memo_file_arc.clone(),
    )));

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 二次启动: 区分 markdown 文件路径与 flowix:// 深链
            //   1. 走 markdown 路径 (跟原行为一致, 用 external-markdown-opened)
            //   2. 走 flowix:// 深链 (用 open_memo_by_target 解析后 emit flowix:open-target)
            // 两个通道可以同时触发 (用户用 `xdg-open foo.md flowix://memo/abc123` 启动)。
            let paths = commands::markdown_paths_from_args(args.clone());
            if !paths.is_empty() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
                let _ = app.emit("external-markdown-opened", paths);
            }
            let state = app.state::<commands::AppState>();
            for arg in args {
                if let Ok(target) = open_target::parse_open_target(&arg) {
                    if let Ok(resolved) =
                        open_target::resolve_open_target(target, state.inner())
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                        let _ = app.emit("flowix:open-target", &resolved);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(app_state)
        .manage(memo_watcher.clone())
        .setup(move |app| {
            // 启动时绑定到当前 notebook 目录。后续切 notebook 由
            // commands::switch_notebook_and_rebuild 触发 rebind。
            let initial_dir = memo_file_arc.read().unwrap().get_memo_base();
            memo_watcher
                .write()
                .unwrap()
                .rebind(app.handle().clone(), Some(initial_dir));

            // 注册 flowix:// scheme 到当前用户 (开发期, 每次启动都注册一次幂等)。
            // 正式打包后, `tauri.conf.json` 的 `bundle.deepLink.desktop.schemes`
            // 会由 OS installer 接管, 这条 register 仍然能补漏 (e.g. 解包 app
            // 后双击, scheme 还没在 LaunchServices 注册)。
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("flowix");
            }

            // macOS / Windows: OS 把深链投到 running app, 通过 deep-link 插件
            // 提供的 on_open_url 回调派发。 Linux 上由 argv 路径承担, 见上。
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let state = app_handle.state::<commands::AppState>();
                    for url in event.urls() {
                        let raw = url.as_str();
                        if let Ok(target) = open_target::parse_open_target(raw) {
                            if let Ok(resolved) =
                                open_target::resolve_open_target(target, state.inner())
                            {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.set_focus();
                                    let _ = window.unminimize();
                                }
                                let _ = app_handle.emit("flowix:open-target", &resolved);
                            }
                        }
                    }
                });
            }

            // 冷启动: 深链也可能经由 argv 走到 (Linux 上标准做法, macOS 上偶发)。
            let state = app.state::<commands::AppState>();
            for arg in std::env::args().skip(1) {
                if let Ok(target) = open_target::parse_open_target(&arg) {
                    if let Ok(resolved) =
                        open_target::resolve_open_target(target, state.inner())
                    {
                        let _ = app.emit("flowix:open-target", &resolved);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 偏好 (JSON, 走 user_config)
            commands::settings::get_preference,
            commands::settings::set_preference,
            commands::settings::get_ai_config,
            commands::settings::set_ai_config,
            // agent 可访问目录 (JSON, 走 agent_access)
            commands::agent_access::get_agent_access,
            commands::agent_access::set_agent_access,
            // 全局元数据 (JSON, 走 global_meta_data) — 仅用于 memo-list 等
            commands::kv::get_setting,
            commands::kv::get_all_settings,
            commands::kv::set_setting,
            commands::kv::set_multiple_settings,
            commands::kv::delete_setting,
            // 笔记 / Doc (13 个, 合并 section 3+4+5+Doc)
            commands::memo::get_memos,
            commands::memo::read_memo,
            commands::memo::read_document,
            commands::memo::write_document,
            commands::memo::get_launch_open_files,
            commands::memo::add_document,
            commands::memo::import_external_document_to_memo,
            commands::memo::update_memo_db,
            commands::memo::finalize_memo_filename,
            commands::memo::delete_memo,
            commands::memo::clear_memos,
            commands::memo::favorite_memo,
            commands::memo::unfavorite_memo,
            commands::memo::set_memo_colors,
            commands::memo::search_memos,
            // tag
            commands::tag::get_all_tags,
            commands::tag::create_memo_tag,
            commands::tag::rename_memo_tag,
            commands::tag::delete_memo_tag,
            // notebook
            commands::notebook::get_notebooks,
            commands::notebook::create_notebook,
            commands::notebook::update_notebook,
            commands::notebook::delete_notebook,
            commands::notebook::clear_notebooks,
            commands::notebook::set_current_notebook,
            // file
            commands::file::get_file_tree,
            commands::file::get_dir_children,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::delete_file,
            commands::file::create_folder,
            commands::file::create_document,
            // dialog
            commands::dialog::select_directory,
            commands::dialog::select_files,
            commands::dialog::save_file_dialog,
            commands::dialog::write_export_file,
            commands::dialog::save_attachment,
            commands::dialog::save_attachment_content,
            // agent
            commands::agent::chat_with_agent_stream,
            commands::agent::stop_agent_stream,
            commands::agent::agent_running_threads,
            // thread
            commands::thread::thread_list,
            commands::thread::thread_create,
            commands::thread::thread_get,
            commands::thread::thread_delete,
            commands::thread::thread_update_title,
            // window
            commands::window::open_preferences_window,
            // 全局"通过链接打开笔记"入口 ── 接收 URL / 物理路径, 解析 + emit
            open_target::handler::open_memo_by_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
