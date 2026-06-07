//! Tauri IPC 命令总入口 — 按业务域拆分到子模块。
//!
//! ## 拆分 (v2 — 2026/06 重构)
//!
//! 旧 `commands.rs` 单文件 1645 行, 52 个 `#[tauri::command]` 跨 12 个业务域
//! 混在一起。拆成:
//!
//! - [`mod@helpers`]   — 跨域 helper (索引 / notebook 切换 / 路径 scope / 自写抑制 / markdown 解析)
//! - [`mod@settings`]  — `~/.flowix/preference.json` + `ai_config.json` 读写
//! - [`mod@kv`]        — `global_meta_data.json` KV 存储
//! - [`mod@memo`]      — 笔记 CRUD + 搜索 + Doc 合并(动 list.json / .md 文件的全进这)
//! - [`mod@tag`]       — tag 派生 + (todo: 增删改 stub)
//! - [`mod@notebook`]  — notebook 切换 / 增删 / CRUD
//! - [`mod@file`]      — 任意文件的 in-notebook tree / read / write
//! - [`mod@dialog`]    — 原生 dialog + 附件保存 + base64
//! - [`mod@agent`]     — LLM 流式 chat + abort
//! - [`mod@thread`]    — 对话线程 CRUD
//! - [`mod@window`]    — preferences 窗口打开/聚焦
//!
//! ## 公共 API 保持不变
//!
//! `tauri::generate_handler![commands::xxx, ...]` (lib.rs:347-402) 与
//! `crate::commands::current_watcher` / `crate::commands::markdown_paths_from_args`
//! 的引用路径**全部不变** — 本文件 `pub use` 把每个子模块的 IPC 函数重新
//! 暴露到 `commands::xxx` 命名空间。
//!
//! ## `AppState` 是所有 IPC 命令的共享状态
//!
//! 子模块通过 `super::AppState` 访问, 在本文件定义, 字段全 `pub`, 各域
//! 自行约定"读 vs 写" — 例如 `memo_file` 写命令必拿 `write()`, 读命令 `read()`。

use std::sync::{Arc, RwLock};

use crate::agent::AgentManager;
use crate::global_meta_data::GlobalMetaData;
use crate::memo_file::MemoFile;
use crate::search::MemoIndex;
use crate::threads::ThreadManager;
use crate::user_config::UserConfigStore;

// ==================== AppState ====================

/// 应用状态 — 通过 `tauri::State<AppState>` 注入到 Tauri 命令。
///
/// `user_config` / `memo_file` / `thread_manager` 与 `agent_manager` 之间会共享
/// 引用 (例如 `AgentManager` 需要读写 thread_manager / memo_file), 共享形态是
/// `Arc<...>`, 不是 `Arc<RwLock<...>>` 套娃 ── `commands.rs` 与 `agent.rs` 各自
/// 持有一份 Arc 引用, 锁的位置 (RwLock) 在内部, 不在 Arc 上。
///
/// `search` / `global_meta_data` 没有跨模块需求, 保持原样 (无 Arc 包装)。
pub struct AppState {
    pub user_config: Arc<UserConfigStore>,
    /// 全局元数据 KV (notebook tag 顺序、隐藏状态等)。
    /// 存 `~/.flowix/global_meta_data.json`, 替代旧版 SQLite `app.db`。
    pub global_meta_data: GlobalMetaData,
    pub memo_file: Arc<RwLock<MemoFile>>,
    /// 当前 notebook 的全文搜索索引 (内存倒排). 切换 notebook 时 rebuild;
    /// 写命令增量 upsert/remove. 见 [`crate::search`].
    pub search: RwLock<MemoIndex>,
    pub agent_manager: Arc<AgentManager>,
    pub thread_manager: Arc<tokio::sync::RwLock<ThreadManager>>,
}

// ==================== 子模块 ====================

// 子模块一律 `pub` — `tauri::generate_handler![commands::<sub>::xxx]` 在
// `lib.rs::run()` 里走完整路径, 需要 `pub` 可见性。`#[tauri::command]` 宏
// 生成的 `__cmd__xxx` 兄弟宏也要求子模块是 `pub`, 否则宏解析不到。

pub mod helpers;
pub mod settings;
pub mod kv;
pub mod memo;
pub mod tag;
pub mod notebook;
pub mod file;
pub mod dialog;
pub mod agent;
pub mod thread;
pub mod window;

// ==================== IPC 命令 re-export ====================
//
// `tauri::generate_handler![commands::<sub>::xxx]` 在 `lib.rs::run()` 里走完整
// 路径, 所以 `pub use` re-export 不再被 IPC handler 用到。但有两个例外仍保留:
//
// - `current_watcher` — `fs_watcher.rs:250` 通过 `crate::commands::current_watcher`
//   调, 改这条路径会影响模块外消费者, 留 re-export 是为兼容。
// - `markdown_paths_from_args` — `lib.rs:324` 在 single_instance 闭包里通过
//   `commands::markdown_paths_from_args` 调, 同样留 re-export。
//
// 其他 IPC 都通过 `commands::<sub>::xxx` 走子模块路径直接访问, 不再 re-export。
// 想加新 IPC 不用动这个文件, 跟 memo_file 拆分后的风格保持一致。

// helpers (跨模块消费, 留 re-export)
pub use helpers::{current_watcher, markdown_paths_from_args};
