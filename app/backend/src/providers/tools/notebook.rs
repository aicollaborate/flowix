use rllm::chat::Tool;
use serde::Deserialize;

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

pub fn get_notebook_detail_tool() -> Tool {
    function_tool(
        "get_notebook_detail",
        "Get detailed information about a specific notebook including its memos. Requires notebook_id as input.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "notebook_id": {
                    "type": "string",
                    "description": "The unique identifier of the notebook"
                }
            },
            "required": ["notebook_id"]
        }),
    )
}

pub async fn execute_tool(
    tool_name: &str,
    arguments: &str,
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
        "get_notebook_detail" => {
            #[derive(Deserialize)]
            struct Args {
                notebook_id: String,
            }

            match serde_json::from_str::<Args>(arguments) {
                Ok(args) => {
                    let memo_file_guard = memo_file.read().unwrap();
                    let configs = memo_file_guard.read_notebook_configs().unwrap_or_default();
                    let config = configs.iter().find(|c| c.id == args.notebook_id).cloned();

                    if let Some(config) = config {
                        drop(memo_file_guard);
                        let mut memo_file_guard = memo_file.write().unwrap();
                        memo_file_guard.set_current_notebook(Some(args.notebook_id.clone()));
                        let memos = memo_file_guard.read_all_memos();
                        let memo_list: Vec<_> = memos
                            .iter()
                            .map(|m| {
                                serde_json::json!({
                                    "id": m.id,
                                    "filename": m.filename,
                                    "preview": m.preview,
                                    "tags": m.tags,
                                    "created_at": m.created_at,
                                    "updated_at": m.updated_at,
                                })
                            })
                            .collect();

                        ToolResult::success(serde_json::json!({
                            "notebook": {
                                "id": config.id,
                                "name": config.name,
                                "icon": config.icon,
                                "path": config.path,
                                "is_default": config.is_default,
                            },
                            "memos": memo_list,
                        }))
                    } else {
                        ToolResult::error("Notebook not found")
                    }
                }
                Err(e) => ToolResult::error(format!("Invalid arguments: {}", e)),
            }
        }
        _ => ToolResult::error(format!("Unknown notebook tool: {}", tool_name)),
    }
}
