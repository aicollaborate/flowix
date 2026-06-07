use rllm::chat::Tool;

use super::{function_tool, ToolResult};

pub fn list_notebooks_tool() -> Tool {
    function_tool(
        "list_notebooks",
        "List all available notebooks. Returns up to 10 notebooks with their id, name, and icon.",
        serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        }),
    )
}

pub async fn execute_tool(
    tool_name: &str,
    memo_file: &std::sync::RwLock<crate::memo_file::MemoFile>,
) -> ToolResult {
    match tool_name {
        "list_notebooks" => {
            let notebooks = memo_file
                .read()
                .unwrap()
                .read_notebook_configs()
                .unwrap_or_default();
            let result: Vec<_> = notebooks
                .into_iter()
                .take(10)
                .map(|c| {
                    serde_json::json!({
                        "id": c.id,
                        "name": c.name,
                        "icon": c.icon.unwrap_or_else(|| "note".to_string()),
                        "is_default": c.is_default,
                    })
                })
                .collect();
            ToolResult::success(result)
        }
        _ => ToolResult::error(format!("Unknown notebook tool: {}", tool_name)),
    }
}
