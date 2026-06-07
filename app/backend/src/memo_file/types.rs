//! 公开 DTO 类型 — `Memo` / `Notebook` / `TodoItem` / `MemoTag` /
//! `NotebookConfig` / `MemoListFile` / `MemoListEntry` / `MemoTodoEntry` /
//! `MemoMetadataFile` / `MemoFrontmatter`。
//!
//! 拆分理由: 旧 `memo_file.rs` 把全部 DTO 堆在文件顶部, 跟 IO/CRUD/registration
//! 混在一起, 1654 行 god module。DTO 是稳定边界 (前端 TS 镜像直接读这些字段),
//! 单独放 `types.rs` 后改 IO 不影响类型签名。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memo {
    pub id: String,
    pub filename: String,
    #[serde(rename = "preview")]
    pub preview: String,
    #[serde(rename = "tags")]
    pub tags: Vec<String>,
    #[serde(rename = "todos")]
    pub todos: Vec<TodoItem>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub favorited: bool,
    pub icon: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoTag {
    pub id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notebook {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub path: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookConfig {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub path: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

// ============================================
// Memo List Entry (for .metadata/list.json)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MemoFrontmatter {
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoListEntry {
    pub id: String,
    pub filename: String,
    pub preview: String,
    pub tags: Vec<String>,
    pub todos: Vec<TodoItem>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub favorited: bool,
    #[serde(rename = "icon")]
    pub icon: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoListFile {
    pub version: u32,
    pub last_updated: i64,
    pub memos: Vec<MemoListEntry>,
}

impl Default for MemoListFile {
    fn default() -> Self {
        Self {
            version: 1,
            last_updated: chrono::Utc::now().timestamp_millis(),
            memos: Vec::new(),
        }
    }
}

// ============================================
// Notebook-level memo metadata (for .metadata/memo.json)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoTodoEntry {
    pub content: String,
    pub status: String,
    #[serde(rename = "memoId")]
    pub memo_id: String,
    pub priority: String,
    #[serde(rename = "timeRange")]
    pub time_range: String,
    pub owner: String,
    pub assignee: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoMetadataFile {
    pub version: u32,
    pub last_updated: i64,
    pub todos: Vec<MemoTodoEntry>,
}

impl Default for MemoMetadataFile {
    fn default() -> Self {
        Self {
            version: 1,
            last_updated: chrono::Utc::now().timestamp_millis(),
            todos: Vec::new(),
        }
    }
}
