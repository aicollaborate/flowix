use rllm::chat::Tool;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::{function_tool, ToolResult, ToolScope};

const DEFAULT_READ_LIMIT: usize = 20_000;
const MAX_READ_LIMIT: usize = 100_000;
const DEFAULT_LIST_LIMIT: usize = 200;
const MAX_LIST_LIMIT: usize = 1_000;
const DEFAULT_GREP_LIMIT: usize = 100;
const MAX_GREP_LIMIT: usize = 500;

pub fn read_tool() -> Tool {
    function_tool(
        "read",
        "Read a UTF-8 text file. Use offset and limit to inspect large files in chunks.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute path or path relative to the app process working directory." },
                "offset": { "type": "integer", "description": "Character offset to start reading from.", "minimum": 0 },
                "limit": { "type": "integer", "description": "Maximum characters to return.", "minimum": 1, "maximum": MAX_READ_LIMIT }
            },
            "required": ["path"]
        }),
    )
}

pub fn write_tool() -> Tool {
    function_tool(
        "write",
        "Write UTF-8 text to a file. Creates parent directories when create_dirs is true.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute path or path relative to the app process working directory." },
                "content": { "type": "string", "description": "Full text content to write or append." },
                "append": { "type": "boolean", "description": "Append instead of replacing the file.", "default": false },
                "create_dirs": { "type": "boolean", "description": "Create parent directories if missing.", "default": true }
            },
            "required": ["path", "content"]
        }),
    )
}

pub fn edit_tool() -> Tool {
    function_tool(
        "edit",
        "Replace exactly one literal text span in a UTF-8 file. The file must have been read in the current conversation, must be unchanged since that read, and old_string must appear exactly once.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute path or path relative to the app process working directory." },
                "old_string": { "type": "string", "description": "The exact literal text to replace. Whitespace and indentation must match exactly." },
                "new_string": { "type": "string", "description": "The replacement text." }
            },
            "required": ["path", "old_string", "new_string"]
        }),
    )
}

pub fn ls_tool() -> Tool {
    function_tool(
        "ls",
        "List files and directories at a path.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Directory path to list." },
                "limit": { "type": "integer", "description": "Maximum entries to return.", "minimum": 1, "maximum": MAX_LIST_LIMIT }
            },
            "required": ["path"]
        }),
    )
}

pub fn glob_tool() -> Tool {
    function_tool(
        "glob",
        "Find files by glob pattern. Supports patterns such as **/*.rs.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Glob pattern. Relative patterns are resolved from the app process working directory." },
                "limit": { "type": "integer", "description": "Maximum paths to return.", "minimum": 1, "maximum": MAX_LIST_LIMIT }
            },
            "required": ["pattern"]
        }),
    )
}

pub fn grep_tool() -> Tool {
    function_tool(
        "grep",
        "Search text files with a regular expression. For literal searches, escape regex metacharacters.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Regex pattern to search for." },
                "path": { "type": "string", "description": "File or directory to search." },
                "case_sensitive": { "type": "boolean", "description": "Whether matching is case sensitive.", "default": true },
                "limit": { "type": "integer", "description": "Maximum matches to return.", "minimum": 1, "maximum": MAX_GREP_LIMIT }
            },
            "required": ["pattern", "path"]
        }),
    )
}

pub async fn execute_tool(
    tool_name: &str,
    arguments: &str,
    read_snapshot: Option<&str>,
    scope: &ToolScope,
) -> ToolResult {
    match tool_name {
        "read" => read(arguments, scope).await,
        "write" => write(arguments, scope).await,
        "edit" => edit(arguments, read_snapshot, scope).await,
        "ls" => ls(arguments, scope).await,
        "glob" => glob_paths(arguments, scope).await,
        "grep" => grep(arguments, scope).await,
        _ => ToolResult::error(format!("Unknown filesystem tool: {}", tool_name)),
    }
}

fn resolve_path(path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn clamp_limit(value: Option<usize>, default: usize, max: usize) -> usize {
    value.unwrap_or(default).clamp(1, max)
}

fn ensure_allowed(scope: &ToolScope, path: &Path) -> Result<(), ToolResult> {
    if scope.is_allowed(path) {
        Ok(())
    } else {
        // Include the canonical default notebook path so the LLM can
        // self-correct when it tries a stale path (e.g. the
        // pre-rename `~/Documents/woop notebook`).
        let hint = format!(
            " Hint: the current default notebook is at '{}'. If your target is inside it, retry with that path.",
            scope.default_root().display()
        );
        Err(ToolResult::error(format!(
            "Path is outside the registered notebook scope: {}.{}",
            path.display(),
            hint
        )))
    }
}

async fn read(arguments: &str, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    let path = resolve_path(&args.path);
    if let Err(result) = ensure_allowed(scope, &path) {
        return result;
    }
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) => {
            // When the file is missing, append a hint pointing at the
            // default notebook so the LLM doesn't keep guessing at the
            // same wrong path.
            let hint = if !scope.default_root().as_os_str().is_empty() {
                format!(
                    " Default notebook is at {}.",
                    scope.default_root().display()
                )
            } else {
                String::new()
            };
            return ToolResult::error(format!("Failed to read {}: {}.{}", path.display(), e, hint));
        }
    };

    let offset = args.offset.unwrap_or(0);
    let limit = clamp_limit(args.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
    let total_chars = content.chars().count();
    let text: String = content.chars().skip(offset).take(limit).collect();

    ToolResult::success(serde_json::json!({
        "path": path.display().to_string(),
        "content": text,
        "offset": offset,
        "returned_chars": text.chars().count(),
        "total_chars": total_chars,
        "truncated": offset + limit < total_chars,
    }))
}

async fn write(arguments: &str, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        path: String,
        content: String,
        append: Option<bool>,
        create_dirs: Option<bool>,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    let path = resolve_path(&args.path);
    if let Err(result) = ensure_allowed(scope, &path) {
        return result;
    }
    if args.create_dirs.unwrap_or(true) {
        if let Some(parent) = path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                return ToolResult::error(format!(
                    "Failed to create parent directory {}: {}",
                    parent.display(),
                    e
                ));
            }
        }
    }

    let result = if args.append.unwrap_or(false) {
        use std::io::Write;
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| file.write_all(args.content.as_bytes()))
    } else {
        fs::write(&path, args.content.as_bytes())
    };

    match result {
        Ok(()) => ToolResult::success(serde_json::json!({
            "path": path.display().to_string(),
            "bytes_written": args.content.len(),
            "append": args.append.unwrap_or(false),
        })),
        Err(e) => ToolResult::error(format!("Failed to write {}: {}", path.display(), e)),
    }
}

async fn edit(arguments: &str, read_snapshot: Option<&str>, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        path: String,
        old_string: String,
        new_string: String,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    if args.old_string.is_empty() {
        return ToolResult::error("old_string cannot be empty");
    }

    let snapshot = match read_snapshot {
        Some(snapshot) => snapshot,
        None => {
            return ToolResult::error(
                "File must be read in the current conversation before using edit",
            )
        }
    };

    let path = resolve_path(&args.path);
    if let Err(result) = ensure_allowed(scope, &path) {
        return result;
    }
    let current = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) => return ToolResult::error(format!("Failed to read {}: {}", path.display(), e)),
    };

    if current != snapshot {
        return ToolResult::error(format!(
            "File changed on disk since it was last read in this conversation: {}",
            path.display()
        ));
    }

    let matches = current.matches(&args.old_string).count();
    if matches == 0 {
        return ToolResult::error(
            "old_string was not found exactly. Whitespace, indentation, and line endings must match",
        );
    }
    if matches > 1 {
        return ToolResult::error(format!(
            "old_string matched {} times. Provide a longer old_string with more surrounding context",
            matches
        ));
    }

    let updated = current.replacen(&args.old_string, &args.new_string, 1);
    match fs::write(&path, updated.as_bytes()) {
        Ok(()) => ToolResult::success(serde_json::json!({
            "path": path.display().to_string(),
            "old_bytes": args.old_string.len(),
            "new_bytes": args.new_string.len(),
            "bytes_written": updated.len(),
        })),
        Err(e) => ToolResult::error(format!("Failed to write {}: {}", path.display(), e)),
    }
}

async fn ls(arguments: &str, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        path: String,
        limit: Option<usize>,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    let path = resolve_path(&args.path);
    if let Err(result) = ensure_allowed(scope, &path) {
        return result;
    }
    let limit = clamp_limit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(e) => return ToolResult::error(format!("Failed to list {}: {}", path.display(), e)),
    };

    let mut result = Vec::new();
    for entry in entries.take(limit) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let meta = entry.metadata().ok();
        result.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "path": entry.path().display().to_string(),
            "is_dir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            "is_file": meta.as_ref().map(|m| m.is_file()).unwrap_or(false),
            "size": meta.as_ref().map(|m| m.len()),
        }));
    }

    ToolResult::success(serde_json::json!({
        "path": path.display().to_string(),
        "entries": result,
        "limit": limit,
    }))
}

async fn glob_paths(arguments: &str, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        pattern: String,
        limit: Option<usize>,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    let pattern = if Path::new(&args.pattern).is_absolute() {
        args.pattern
    } else {
        resolve_path(&args.pattern).display().to_string()
    };
    let limit = clamp_limit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    let paths = match glob::glob(&pattern) {
        Ok(paths) => paths,
        Err(e) => return ToolResult::error(format!("Invalid glob pattern: {}", e)),
    };

    let matches: Vec<_> = paths
        .filter_map(Result::ok)
        .filter(|path| scope.is_allowed(path))
        .take(limit)
        .map(|path| path.display().to_string())
        .collect();

    ToolResult::success(serde_json::json!({
        "pattern": pattern,
        "matches": matches,
        "limit": limit,
    }))
}

async fn grep(arguments: &str, scope: &ToolScope) -> ToolResult {
    #[derive(Deserialize)]
    struct Args {
        pattern: String,
        path: String,
        case_sensitive: Option<bool>,
        limit: Option<usize>,
    }

    let args = match serde_json::from_str::<Args>(arguments) {
        Ok(args) => args,
        Err(e) => return ToolResult::error(format!("Invalid arguments: {}", e)),
    };

    let regex_pattern = if args.case_sensitive.unwrap_or(true) {
        args.pattern
    } else {
        format!("(?i){}", args.pattern)
    };
    let regex = match regex::Regex::new(&regex_pattern) {
        Ok(regex) => regex,
        Err(e) => return ToolResult::error(format!("Invalid regex: {}", e)),
    };

    let root = resolve_path(&args.path);
    if let Err(result) = ensure_allowed(scope, &root) {
        return result;
    }
    let limit = clamp_limit(args.limit, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT);
    let mut matches = Vec::new();

    let files: Vec<PathBuf> = if root.is_file() {
        vec![root.clone()]
    } else {
        WalkDir::new(&root)
            .max_depth(8)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.path().to_path_buf())
            .collect()
    };

    'files: for file in files {
        let content = match fs::read_to_string(&file) {
            Ok(content) => content,
            Err(_) => continue,
        };
        for (line_index, line) in content.lines().enumerate() {
            if regex.is_match(line) {
                matches.push(serde_json::json!({
                    "path": file.display().to_string(),
                    "line": line_index + 1,
                    "text": line,
                }));
                if matches.len() >= limit {
                    break 'files;
                }
            }
        }
    }

    ToolResult::success(serde_json::json!({
        "path": root.display().to_string(),
        "matches": matches,
        "limit": limit,
    }))
}
