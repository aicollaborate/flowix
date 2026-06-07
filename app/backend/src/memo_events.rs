//! 统一笔记事件总线 — 所有"写者" (用户 UI / Agent / 外部工具) 在改完磁盘后
//! 都 emit 这一个事件, 前端一个 `listen()` 派发到 store + 编辑器。
//!
//! 设计要点:
//! - 单一事件名 `MEMO_EVENT`, `#[serde(tag = "kind")]` 内部区分 `created` /
//!   `updated` / `deleted`。复用 [`crate::agent::AgentChunk`] 的判别式 enum 模式。
//! - `MemoChangeSource` 是 informational, 不影响路由。前端不用它分支, 仅供
//!   日志 / toast / 自写抑制的二次判断使用。
//! - 旧事件 `agent-document-updated` 由 [`crate::agent`] 的 `edit` 工具触发,
//!   本次重构废弃, 改由本模块的 `Updated` 变体承载。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::fs_watcher::MemoWatcher;
use crate::memo_file::Memo;

pub const MEMO_EVENT: &str = "memo-event";

/// 写者标识 — 仅 informational, 前端不用于分支路由。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum MemoChangeSource {
    /// 用户点 "+" 新建空笔记
    UserNew,
    /// "Save to Memo" 按钮导入外部文件
    UserImport,
    /// 用户在编辑器保存, 走 `update_memo_db` / `write_document`
    UserEdit,
    /// Agent 的 `edit` 工具
    AgentEdit,
    /// Agent 的 `write` 工具 (新建或覆写)
    AgentWrite,
    /// 外部编辑器 / 其他 AI 改磁盘, 文件监听器观察到
    ExternalTool,
}

/// 笔记事件。前端 `useMemoEvents` 收到后按 `kind` 派发到 store action。
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MemoEvent {
    /// 新笔记落盘 (新建 / 拖拽 / 粘贴 / Agent write 新文件 / import)
    Created { memo: Memo, source: MemoChangeSource },
    /// 现有笔记的 preview / tags / todos / `updatedAt` 变化 (用户编辑 / Agent
    /// edit / 外部工具改磁盘 / 收藏状态变化)。`path` 用于前端编辑器 path 匹配。
    Updated {
        id: String,
        path: String,
        source: MemoChangeSource,
    },
    /// 笔记被删除 (用户删除 / `clear_memos` / 外部工具 rm 文件)
    Deleted { id: String, path: String },
}

impl MemoEvent {
    /// 事件关联的 memo id。Deleted 总是有 id; Created 从 memo 里拿; Updated
    /// 直接读字段。没有 id (例如 unregister_memo_by_path 后的 Deleted) 返回
    /// 空串, 调用方据此跳过 `mark_emitted_id`。
    pub(crate) fn memo_id(&self) -> &str {
        match self {
            MemoEvent::Created { memo, .. } => &memo.id,
            MemoEvent::Updated { id, .. } => id,
            MemoEvent::Deleted { id, .. } => id,
        }
    }
}

/// 触发 emit 的薄包装。失败不 panic (let _ = 吞掉 emit 错误, 跟 `agent-chunk`
/// 的 emit 风格保持一致 — IPC 通道关闭时不该让业务逻辑崩)。
///
/// 顺带做一件事: 把事件 id 写进 watcher 的 `recent_emit_ids`, 给 watcher
/// 一个"我刚 emit 过这个 id" 的 250ms 时间窗。这样即便 `mark_self_write`
/// 的路径规范化失败, 仍能靠 id 二级兜底吞掉自家 notify 回响。集中挂这里
/// 是因为 emit 入口单一, 不需要在每个 IPC 命令手写 hook。
pub fn emit(app: &AppHandle, event: MemoEvent) {
    let id = event.memo_id();
    if !id.is_empty() {
        if let Some(watcher) = app.try_state::<std::sync::Arc<std::sync::RwLock<MemoWatcher>>>() {
            if let Ok(g) = watcher.read() {
                g.mark_emitted_id(id);
            }
        }
    }
    let _ = app.emit(MEMO_EVENT, &event);
}

#[cfg(test)]
mod tests {
    //! serde wire-format 测试 — 保证与前端 TypeScript 镜像 (app/frontend/types/memo.ts)
    //! 的硬契约。`kind` 必须是 snake_case, 字段命名 (memo/id/path/source) 是
    //! 跨 IPC 边界的硬约定, 不要随便改。

    use super::*;
    use crate::memo_file::Memo;

    fn sample_memo() -> Memo {
        Memo {
            id: "m_abc123".to_string(),
            filename: "Sample".to_string(),
            preview: "preview text".to_string(),
            tags: vec!["t1".to_string()],
            todos: vec![],
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            favorited: false,
            icon: None,
            path: Some("Sample-m_abc123.md".to_string()),
        }
    }

    #[test]
    fn created_serializes_with_snake_case_tag_and_camelcase_memo() {
        let event = MemoEvent::Created {
            memo: sample_memo(),
            source: MemoChangeSource::UserNew,
        };
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["kind"], "created");
        assert_eq!(v["source"], "user_new");
        // memo 字段保持 camelCase (Memo struct 自身用 #[serde(rename = "createdAt")] 等)
        assert_eq!(v["memo"]["id"], "m_abc123");
        assert_eq!(v["memo"]["filename"], "Sample");
        assert_eq!(v["memo"]["createdAt"], 1_700_000_000_000i64);
    }

    #[test]
    fn updated_serializes_with_snake_case_tag() {
        let event = MemoEvent::Updated {
            id: "m_abc".to_string(),
            path: "/tmp/foo.md".to_string(),
            source: MemoChangeSource::AgentEdit,
        };
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["kind"], "updated");
        assert_eq!(v["id"], "m_abc");
        assert_eq!(v["path"], "/tmp/foo.md");
        assert_eq!(v["source"], "agent_edit");
    }

    #[test]
    fn deleted_serializes_with_snake_case_tag() {
        let event = MemoEvent::Deleted {
            id: "m_abc".to_string(),
            path: "/tmp/foo.md".to_string(),
        };
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["kind"], "deleted");
        assert_eq!(v["id"], "m_abc");
        assert_eq!(v["path"], "/tmp/foo.md");
    }

    #[test]
    fn all_sources_have_snake_case_strings() {
        // 防止日后加新 source 时漏掉 rename_all 导致 IPC 失配
        for (variant, expected) in [
            (MemoChangeSource::UserNew, "user_new"),
            (MemoChangeSource::UserImport, "user_import"),
            (MemoChangeSource::UserEdit, "user_edit"),
            (MemoChangeSource::AgentEdit, "agent_edit"),
            (MemoChangeSource::AgentWrite, "agent_write"),
            (MemoChangeSource::ExternalTool, "external_tool"),
        ] {
            let s: String = serde_json::to_value(&variant)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string();
            assert_eq!(s, expected, "source variant wire mismatch");
        }
    }
}
