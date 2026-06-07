//! Agent tools.

use rllm::chat::Tool;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod filesystem;
mod notebook;

/// Tool result type for returning data from tool executions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl ToolResult {
    pub fn success(data: impl Serialize) -> Self {
        Self {
            success: true,
            data: Some(serde_json::to_value(data).unwrap_or(serde_json::Value::Null)),
            error: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

fn function_tool(name: &str, description: &str, parameters: serde_json::Value) -> Tool {
    Tool {
        tool_type: "function".to_string(),
        function: rllm::chat::FunctionTool {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
        cache_control: None,
    }
}

/// Get all available tools registered to the agent.
pub fn get_all_tools() -> Vec<Tool> {
    vec![
        notebook::list_notebooks_tool(),
        filesystem::read_tool(),
        filesystem::write_tool(),
        filesystem::edit_tool(),
        filesystem::ls_tool(),
        filesystem::glob_tool(),
        filesystem::grep_tool(),
    ]
}

#[derive(Clone, Debug)]
pub struct ToolScope {
    allowed_roots: Vec<PathBuf>,
    /// Canonical default notebook path (e.g. `~/Documents/flowix` on macOS).
    /// Held separately so the read / scope tools can hint the *correct*
    /// path when the LLM tries one that's outside the registered scope —
    /// typically a stale `~/Documents/woop notebook` from before the
    /// 2026/06 brand rename. See `MemoFile::get_default_notebook_path`.
    default_root: PathBuf,
}

impl ToolScope {
    pub fn from_memo_file(memo_file: &std::sync::RwLock<crate::memo_file::MemoFile>) -> Self {
        let (allowed_roots, default_root) = memo_file
            .read()
            .map(|guard| {
                (
                    guard.registered_notebook_paths(),
                    guard.get_default_notebook_path(),
                )
            })
            .unwrap_or_else(|_| (Vec::new(), PathBuf::new()));
        Self {
            allowed_roots,
            default_root,
        }
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        self.allowed_roots
            .iter()
            .any(|root| crate::path_scope::path_is_inside(path, root))
    }

    /// Canonical default notebook path. Use this to construct error
    /// messages that tell the LLM where the *real* notebook is.
    pub fn default_root(&self) -> &Path {
        &self.default_root
    }
}

/// Execute a tool by name with the given arguments.
pub async fn execute_tool(
    tool_name: &str,
    arguments: &str,
    memo_file: &std::sync::RwLock<crate::memo_file::MemoFile>,
    read_snapshot: Option<&str>,
) -> ToolResult {
    let scope = ToolScope::from_memo_file(memo_file);
    match tool_name {
        "list_notebooks" => {
            notebook::execute_tool(tool_name, memo_file).await
        }
        "read" | "write" | "edit" | "ls" | "glob" | "grep" => {
            filesystem::execute_tool(tool_name, arguments, read_snapshot, &scope).await
        }
        "bash" => ToolResult::error("Shell execution is disabled for AI agents"),
        _ => ToolResult::error(format!("Unknown tool: {}", tool_name)),
    }
}
