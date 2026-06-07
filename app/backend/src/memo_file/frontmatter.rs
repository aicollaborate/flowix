//! Markdown frontmatter 解析 — 提取 `---\n...\n---\n` 之外的 body 文本。
//!
//! 与 `search.rs::strip_frontmatter` 行为同形 (都把 YAML frontmatter 切掉) 但实现
//! 路径不同: 本文件走 `once_cell::Lazy<Regex>`, search.rs 走手写切片。
//! 之所以独立: CRUD / frontmatter 生成 (`update_memo_item`) 走这里, 搜索
//! 重建走 search.rs。两者边界条件 (CRLF / LF) 保持一致 (`update_memo_item` 写
//! 出去的 frontmatter 用 `\n`, search 解析时 `\n` 和 `\r\n` 都接受)。

use once_cell::sync::Lazy;
use regex::Regex;

pub(crate) static FRONTMATTER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^---\n([\s\S]*?)\n---\n?([\s\S]*)$").unwrap());

/// 切掉 YAML frontmatter 块, 返回剩余 body。
///
/// 输入示例:
/// ```
/// ---
/// filename: Hello
/// ---
/// # Hello
/// body
/// ```
/// 返回 `"# Hello\nbody\n"`。
pub(crate) fn extract_body_content(content: &str) -> &str {
    if let Some(captures) = FRONTMATTER_RE.captures(content) {
        captures.get(2).map(|m| m.as_str()).unwrap_or("")
    } else {
        content
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_body_after_frontmatter() {
        let md = "---\nfilename: x\n---\n# Title\nbody\n";
        assert_eq!(extract_body_content(md), "# Title\nbody\n");
    }

    #[test]
    fn returns_unchanged_when_no_frontmatter() {
        let md = "# Title\nbody\n";
        assert_eq!(extract_body_content(md), md);
    }

    #[test]
    fn returns_empty_when_only_frontmatter() {
        let md = "---\nfilename: x\n---\n";
        assert_eq!(extract_body_content(md), "");
    }
}
