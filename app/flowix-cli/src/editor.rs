//! `$EDITOR` / `$VISUAL` 集成 ── 给 `flowix-cli new` 在没传 --content / stdin 时用。
//!
//! 行为:
//! 1. 优先级: `$VISUAL` > `$EDITOR` > 平台默认 (macOS `vim`, 其他 `vi`)
//! 2. 把 `initial` 写到 tempdir 下的 `flowix-{uuid}.md` 文件
//! 3. spawn 编辑器, 阻塞等退出
//! 4. 编辑器非 0 退出 → 返回 `CliError::EditorCancelled`
//! 5. 编辑器成功 → 读回文件内容 (整段, 含 frontmatter 之外的 body)
//!
//! 文件命名带 `.md` 后缀 ── 一些编辑器 (VSCode) 根据扩展名选 syntax highlighting。

use std::io::Write;
use std::path::PathBuf;

use crate::errors::CliError;

pub fn edit_in_editor(initial: &str) -> Result<String, CliError> {
    let editor = pick_editor();

    let tmp_path = make_tempfile(initial)?;

    let status = std::process::Command::new(&editor)
        .arg(&tmp_path)
        .status()
        .map_err(|e| CliError::Other(format!("failed to spawn editor `{editor}`: {e}")))?;

    if !status.success() {
        // 清理临时文件
        let _ = std::fs::remove_file(&tmp_path);
        return Err(CliError::EditorCancelled);
    }

    let body = std::fs::read_to_string(&tmp_path).map_err(CliError::Io)?;

    // 编辑器退出后清理 ── tempdir 是系统管理的, 但我们主动删以免
    // 临时目录里堆一堆 flowix-{uuid}.md。
    let _ = std::fs::remove_file(&tmp_path);

    Ok(body)
}

fn pick_editor() -> String {
    std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "macos")]
            {
                "vim".to_string()
            }
            #[cfg(not(target_os = "macos"))]
            {
                "vi".to_string()
            }
        })
}

fn make_tempfile(initial: &str) -> Result<PathBuf, CliError> {
    let mut tmp = tempfile::Builder::new()
        .prefix("flowix-")
        .suffix(".md")
        .tempfile()
        .map_err(CliError::Io)?;
    tmp.write_all(initial.as_bytes()).map_err(CliError::Io)?;
    tmp.flush().map_err(CliError::Io)?;

    // 把 NamedTempFile 转成普通 PathBuf, 因为我们要在编辑器关闭后读回。
    // `into_temp_path()` 拿到 PathBuf + 标记, drop 时自动删 ── 但我们
    // 上面会主动删, 所以这里 `keep` 拿普通 PathBuf。
    let (_, path) = tmp
        .keep()
        .map_err(|e| CliError::Other(format!("failed to keep tempfile: {e}")))?;
    Ok(path)
}
