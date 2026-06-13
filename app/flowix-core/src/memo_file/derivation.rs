//! 派生字段提取 — `extract_tags_from_body` / `extract_todos_from_body` /
//! `extract_title_and_preview` / `apply_derived_memo_fields` / `strip_markdown` /
//! `is_blank_line` / `strip_block_node_lines`。
//!
//! 派生语义: memo 的 `filename` / `preview` / `tags` / `todos` 都可以从 .md body
//! 算出来, 写盘后由 [`apply_derived_memo_fields`] 同步回 list.json。这样 UI 列表
//! 不必每次都读 .md 文件 (大场景下 IO 减半), 同时保证"正文是真相, list.json 是
//! 派生缓存"。
//!
//! ## 块节点过滤档案 (`BLOCK_NODE_FILTERS`)
//!
//! Tiptap 自定义节点 (例如 `agent-thread-card`) 在 markdown 序列化时会产出一段
//! 非用户语义的元数据 (节点属性 / 围栏 marker), 不应进入 filename / preview 派生。
//! 所有需要在 title / preview 流水线里剔除的节点形态都登记在
//! [`BLOCK_NODE_FILTERS`] 这个**单点配置**里: filename (经
//! [`extract_title_and_preview`]) 和 preview 共用一次过滤, 加新节点时只动
//! 这一处。
//!
//! 节点可能出现的两种形态:
//! - **单行**: `::node-name{attrs}` (整行, 行 trim 后整行匹配即视为节点)
//! - **围栏**: `:::node-name ... :::` (跨行, 整段跳过)

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

use super::frontmatter::extract_body_content;
use super::types::{Memo, TodoItem};

/// 判定 markdown 行是否"语义空白" (空行 / 全空格 / HTML 实体 `&nbsp;` /
/// 不间断空格 U+00A0)。`is_blank_line` 用于过滤 title/preview/todo 提取前的源。
pub fn is_blank_line(line: &str) -> bool {
    line.replace("&nbsp;", "")
        .replace('\u{00a0}', "")
        .trim()
        .is_empty()
}

/// 去掉 markdown 装饰字符 (heading `#` / list `-*+` / quote `>` / checkbox `[ ]`
/// / link 包装 / 强调 `*_` / 反引号), 折叠连续空白为单空格, 留作 title 派生。
pub fn strip_markdown(text: &str) -> String {
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

// ---------------------------------------------------------------------------
// 块节点过滤档案
// ---------------------------------------------------------------------------

/// `::agent-thread-card{threadId="..." title="..." agentId="..." collapsed="..."}`
/// ── 由 Tiptap `extensions/agent-thread-card.tsx` 的 `renderMarkdown` 序列化
/// 出来的单行节点形态。行 trim 后整行匹配视为"该行属于块节点, 派生时跳过"。
static AGENT_THREAD_CARD_LINE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^::agent-thread-card(?:\{[^}]*\})?$").unwrap());

/// `:::agent-thread-card ... :::` ── 围栏形态, 用于节点将来扩展出 body 时的
/// markdown 往返。命中整段 (跨多行) 一并跳过。
static AGENT_THREAD_CARD_FENCE_RE: Lazy<Regex> = Lazy::new(|| {
    // 围栏开闭允许行首缩进 ── 与单行形态的"trim 后整行匹配"保持对称, 未来
    // 节点出现在 list item / blockquote 等缩进上下文里也能被剥掉。
    Regex::new(r"(?m)^[ \t]*:::agent-thread-card[^\n]*\n[\s\S]*?\n[ \t]*:::[ \t]*$").unwrap()
});

/// 块节点过滤档案 ── 集中登记需要在 title / preview 派生前剔除的 Tiptap
/// 自定义节点序列化形态。filename 和 preview 都经由
/// [`extract_title_and_preview`], 因此**单点配置, 一处生效**。新节点只需要
/// 在此 push 一项 [`BlockNodeFilter`]。
struct BlockNodeFilter {
    /// 可读标识 (日志 / 调试用)。当前无 in-process 读取路径, 但保留以便
    /// 后续接入结构化日志 / 调试输出时不需要改 array 形态。
    #[allow(dead_code)]
    name: &'static str,
    /// 行级判定: 传入 trim 后的整行, 返回 `true` 表示该行属于此块节点, 跳过。
    is_block_line: fn(&str) -> bool,
    /// 围栏剥离: 若节点存在围栏形态, 给出"在文本中剥掉所有围栏实例"的函数;
    /// 不存在则传 `None`。
    strip_fences: Option<fn(&str) -> String>,
}

static BLOCK_NODE_FILTERS: &[BlockNodeFilter] = &[BlockNodeFilter {
    name: "agent-thread-card",
    is_block_line: |line| AGENT_THREAD_CARD_LINE_RE.is_match(line),
    strip_fences: Some(|input| {
        AGENT_THREAD_CARD_FENCE_RE
            .replace_all(input, "")
            .into_owned()
    }),
}];

/// 在 title / preview 派生前剥离所有已登记的块节点 (围栏优先剥, 然后按行
/// 剔除单行形态)。返回的字符串已不含块节点元数据, 可直接交给原有的
/// "取首行 / 第二行" 逻辑。
///
/// **不变量 (改本函数时务必保持) ──**
///
/// 1. **围栏优先**: 围栏剥离在行级剔除之前完成, 反复 `replace_all` 到稳定。
///    这样围栏内残留的"看起来像单行节点"的字符串也不会被行级阶段误剥。
/// 2. **行级判定基于 trim 后整行**: 调用 `is_block_line` 前必须先 `trim()`,
///    以兼容复制粘贴 / 缩进场景。这与单行正则 `^...$` 的"整字符串匹配"
///    语义保持对称 (即 `<truncated-line-of-node>` 作为唯一内容)。
/// 3. **缩进容忍**: 围栏的开闭 marker (`:::`) 与单行节点 (`::name...`)
///    都允许 `[ \t]*` 前导空白 ── 节点出现在 list / blockquote 嵌套里也能
///    命中。这条与产品当前 Tiptap 序列化形态 (顶层无缩进) 一致, 但作为
///    防御性行为保留。
fn strip_block_node_lines(body: &str) -> String {
    // 1. 围栏剥离 ── 反复 replace 直到稳定, 处理相邻 / 多次出现的围栏块。
    let mut current = body.to_string();
    for filter in BLOCK_NODE_FILTERS {
        let Some(strip) = filter.strip_fences else {
            continue;
        };
        let mut prev = String::new();
        while prev != current {
            prev = current.clone();
            current = strip(&current);
        }
    }

    // 2. 行级剔除 ── trim 后整行命中任一过滤器即丢。
    let kept: Vec<&str> = current
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !BLOCK_NODE_FILTERS
                .iter()
                .any(|filter| (filter.is_block_line)(trimmed))
        })
        .collect();
    kept.join("\n")
}

/// 提取 (title, preview): title = 第一条非空行 (经 `strip_markdown` 清洗),
/// preview = 第二条非空行 (取前 200 字符)。
///
/// 两条规则之前先经过 [`strip_block_node_lines`] ── 任何已登记的 Tiptap 自定
/// 义节点 (`::agent-thread-card{...}` / `:::agent-thread-card ... :::`) 都不会
/// 占据首行或第二行, 也就不会泄漏到 `filename` (title) 或 `preview` 里。
pub fn extract_title_and_preview(content: &str) -> (String, String) {
    let body = strip_block_node_lines(extract_body_content(content));
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
pub fn extract_tags_from_body(content: &str) -> Vec<String> {
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
pub fn extract_todos_from_body(content: &str) -> Vec<TodoItem> {
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
pub fn apply_derived_memo_fields(memo: &mut Memo, full_content: &str) {
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

    /// `::agent-thread-card{...}` 作为单行节点出现在 body 顶部时, 不应
    /// 占用首行 (filename) 也不应霸占第二行 (preview)。
    #[test]
    fn agent_thread_card_single_line_is_skipped_for_title_and_preview() {
        let md = "\
::agent-thread-card{threadId=\"abc\" title=\"AI 对话\" agentId=\"flowix\" collapsed=\"false\"}
# Real title
real preview line
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview line");
    }

    /// 围栏形态 `:::agent-thread-card ... :::` 同样要在 title / preview 之前
    /// 整段剥离 ── 围栏里夹的多行文本不能算入首行/第二行。
    #[test]
    fn agent_thread_card_fenced_block_is_skipped_for_title_and_preview() {
        let md = "\
:::agent-thread-card
some internal line
:::
# Real title
real preview line
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview line");
    }

    /// 围栏允许行首缩进 (A 项: 防御 list / blockquote 嵌套场景) ──
    /// 开闭 marker 前置 [ \t]* 必须命中。
    #[test]
    fn fenced_agent_thread_card_with_leading_indent_is_stripped() {
        let md = "\
    :::agent-thread-card
    internal line
    :::
# Real title
real preview line
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview line");
    }

    /// 多段围栏紧邻出现时也都要剥离 ── 不能只剥第一段。
    #[test]
    fn adjacent_fenced_agent_thread_cards_are_all_stripped() {
        let md = "\
:::agent-thread-card
foo
:::
:::agent-thread-card
bar
:::
# Real title
real preview
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview");
    }

    /// 缩进的单行节点 (复制粘贴常见) ── 行级剔除应基于 trim 后整行,
    /// 不应被前置空白漏掉。
    #[test]
    fn indented_single_line_agent_thread_card_is_stripped() {
        let md = "\
    ::agent-thread-card{threadId=\"x\" title=\"t\" agentId=\"a\" collapsed=\"false\"}
# Real title
real preview
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview");
    }

    /// 多张节点堆叠时也都要剥离 ── 不能只剥第一张。
    #[test]
    fn stacked_agent_thread_cards_are_all_stripped() {
        let md = "\
::agent-thread-card{threadId=\"a\" title=\"A\" agentId=\"x\" collapsed=\"false\"}
::agent-thread-card{threadId=\"b\" title=\"B\" agentId=\"x\" collapsed=\"false\"}
# Real title
real preview
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "Real title");
        assert_eq!(p, "real preview");
    }

    /// 纯节点文档 (没有任何用户文本) 派生出的 title / preview 都应为空 ──
    /// 不应把节点 attribute 串当作 title 写进 list.json。
    #[test]
    fn card_only_document_yields_empty_title_and_preview() {
        let md = "\
::agent-thread-card{threadId=\"abc\" title=\"AI 对话\" agentId=\"flowix\" collapsed=\"false\"}
";
        let (t, p) = extract_title_and_preview(md);
        assert_eq!(t, "");
        assert_eq!(p, "");
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
