//! Notebook IPC — 增删改查 + 切换当前 notebook。
//!
//! `set_current_notebook` 走 `switch_notebook_and_rebuild` helper, 触发
//! watcher rebind + 磁盘对账 + 后台索引 rebuild。

use tauri::{AppHandle, State};

use crate::memo_file::{Notebook, NotebookConfig};

use super::helpers::switch_notebook_and_rebuild;
use super::AppState;

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
    app: AppHandle,
) -> Option<Notebook> {
    // 先把 config 写好, 再走 helper 触发索引 rebuild.
    let now = chrono::Utc::now().timestamp_millis();
    let id = format!("nb_{}", now);

    let config = NotebookConfig {
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

    {
        let memo_file = state.memo_file.write().unwrap();
        let mut configs = memo_file.read_notebook_configs().unwrap_or_default();
        configs.push(config);
        memo_file.write_notebook_configs(&configs).ok()?;
    }

    // 触发后台索引 rebuild — 写完 config 后, 索引从空 list.json 开始
    switch_notebook_and_rebuild(state.inner(), &app, Some(id.clone()));

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
pub fn set_current_notebook(
    notebook_id: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) {
    // 走 switch_notebook_and_rebuild: 切 current_notebook_id + 触发后台 rebuild.
    // 同 notebook + 索引已加载时助手早 return, 等价于纯切换.
    switch_notebook_and_rebuild(state.inner(), &app, notebook_id);
}
