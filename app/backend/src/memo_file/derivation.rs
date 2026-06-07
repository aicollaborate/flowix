//! 派生字段提取 — `extract_tags_from_body` / `extract_todos_from_body` /
//! `extract_title_and_preview` / `apply_derived_memo_fields` / `strip_markdown` /
//! `is_blank_line`。
//!
//! 派生语义: memo 的 `filename` / `preview` / `tags` / `todos` 都可以从 .md body
//! 算出来, 写盘后由 [`apply_derived_memo_fields`] 同步回 list.json。这样 UI 列表
//! 不必每次都读 .md 文件 (大场景下 IO 减半), 同时保证"正文是真相, list.json 是
//! 派生缓存"。

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

use super::frontmatter::extract_body_content;
use super::types::{Memo, TodoItem};

/// 判定 markdown 行是否"语义空白" (空行 / 全空格 / HTML 实体 `&nbsp;` /
/// 不间断空格 U+00A0)。`is_blank_line` 用于过滤 title/preview/todo 提取前的源。
pub(crate) fn is_blank_line(line: &str) -> bool {
    line.replace("&nbsp;", "")
        .replace('\u{00a0}', "")
        .trim()
        .is_empty()
}

/// 去掉 markdown 装饰字符 (heading `#` / list `-*+` / quote `>` / checkbox `[ ]`
/// / link 包装 / 强调 `*_` / 反引号), 折叠连续空白为单空格, 留作 title 派生。
pub(crate) fn strip_markdown(text: &str) -> String {
    let mut value = text.trim().to_string();

    for prefix in ["#", "-", "*", "+", ">"] {
        while value.starts_with(prefix) {
            value = value[prefix.len()..].trim_start().to_string();
        }
    }

    for marker in ["[ ]", "[x]", "[X]"] {
        if value.starts_with(marker) {
            value = value[marker.len()..].trim_start().to_string();
        }
    }

    static MARKDOWN_LINK_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\[([^\]]+)\]\([^)]+\)").unwrap());
    static MARKDOWN_DECORATION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[*_`]").unwrap());
    static WHITESPACE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

    let value = MARKDOWN_LINK_RE.replace_all(&value, "$1");
    let value = MARKDOWN_DECORATION_RE.replace_all(&value, "");
    WHITESPACE_RE.replace_all(value.trim(), " ").to_string()
}

/// 提取 (title, preview): title = 第一条非空行 (经 `strip_markdown` 清洗),
/// preview = 第二条非空行 (取前 200 字符)。
pub(crate) fn extract_title_and_preview(content: &str) -> (String, String) {
    let body = extract_body_content(content);
    let lines: Vec<String> = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_blank_line(line))
        .map(strip_markdown)
        .filter(|line| !line.is_empty())
        .collect();

    let title = lines.first().cloned().unwrap_or_default();
    let preview = lines
        .get(1)
        .cloned()
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect();
    (title, preview)
}

/// 从 body 抽 `#tag` — 匹配行首或空白后的 `#` 后跟非空白 / 非标点字符。
/// 大小写敏感 (跟 markdown 风格一致); 重复 tag 去重。
pub(crate) fn extract_tags_from_body(content: &str) -> Vec<String> {
    static TAG_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?m)(^|[\s])#([^\s[:punct:]]+)").unwrap());

    let mut seen = HashSet::new();
    let mut tags = Vec::new();

    for captures in TAG_RE.captures_iter(extract_body_content(content)) {
        if let Some(tag) = captures.get(2).map(|m| m.as_str().trim().to_string()) {
            if !tag.is_empty() && seen.insert(tag.clone()) {
                tags.push(tag);
            }
        }
    }

    tags
}

/// 从 body 抽 `- [ ]` / `- [x]` 复选框条目 (todo items)。
pub(crate) fn extract_todos_from_body(content: &str) -> Vec<TodoItem> {
    static TODO_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?m)^\s*-\s*\[([ xX])\]\s*(.+)$").unwrap());

    TODO_RE
        .captures_iter(extract_body_content(content))
        .filter_map(|captures| {
            let content = captures.get(2)?.as_str().trim();
            if is_blank_line(content) {
                return None;
            }

            let checked = captures.get(1)?.as_str().eq_ignore_ascii_case("x");
            Some(TodoItem {
                content: content.to_string(),
                status: if checked { "completed" } else { "pending" }.to_string(),
            })
        })
        .collect()
}

/// 应用派生字段到 memo。`filename` 仅在为空时从 body 第一行覆盖 (用户显式设的
/// title 优先), `preview` / `tags` / `todos` 总是从 body 重算。
pub(crate) fn apply_derived_memo_fields(memo: &mut Memo, full_content: &str) {
    let (derived_title, preview) = extract_title_and_preview(full_content);
    if memo.filename.trim().is_empty() && !derived_title.is_empty() {
        memo.filename = derived_title;
    }
    memo.preview = preview;
    memo.tags = extract_tags_from_body(full_content);
    memo.todos = extract_todos_from_body(full_content);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_from_first_heading() {
        let (t, p) = extract_title_and_preview("# Hello\nworld\n");
        assert_eq!(t, "Hello");
        assert_eq!(p, "world");
    }

    #[test]
    fn preview_truncates_to_200_chars() {
        let body: String = "x".repeat(500);
        let (_, p) = extract_title_and_preview(&format!("# T\n{body}"));
        assert_eq!(p.chars().count(), 200);
    }

    #[test]
    fn tags_dedup_and_trim() {
        let v = extract_tags_from_body("#a #b #a");
        assert_eq!(v, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn todos_parse_checked_and_unchecked() {
        let v = extract_todos_from_body("- [ ] one\n- [x] two\n");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].status, "pending");
        assert_eq!(v[1].status, "completed");
    }
}
