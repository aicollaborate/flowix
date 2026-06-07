# 待解决问题登记

> 状态：未排期，按"优先级"和"分类"组织
> 范围：Flowix 全栈（重点 `app/backend` 与 `app/frontend`）
> 最近更新：2026-06-07 — 继 P2-#2 / P2-#3 重构后整理

---

## 0. 已完成（保留索引）

| ID | 标题 | 完成时间 |
|---|---|---|
| P0-#1 | 跨调用工具调用链上下文丢失（tool_call 上下文未串入下一轮） | 已修 |
| P1-#3 | 100 cycles 无 error budget / stuck-in-loop 保护 | 已修 |
| P1-#3.5 | `thread_delete` 清理 `read_snapshots` + `tool_call_attempts` | 已修 |
| P1-#1 | `agent-chunk` 事件结构化（`AgentChunk` 枚举 + 9 变体） | 已修 |
| P2-#2 | `OpenAIProvider` 命名误导（实际是 OpenAI 兼容） | 已修 |
| P2-#3 | `DEFAULT_AGENT_ID` 字符串裸值 → `AgentId` newtype | 已修 |
| **P2-#2 (new)** | **AppState 反向依赖 → `AgentManager` 注入 3 个 `Arc<...>`** | **2026-06-07** |
| **P2-#3 (new)** | **`Result<_, String>` → thiserror（`ThreadError` / `UserConfigError` / `AgentError`）** | **2026-06-07** |

---

## 1. 优先级定义

- 🔴 **P1**：有生产可见风险或经济损失
- 🟡 **P2**：可观察的工程问题（性能/可维护性/开发体验）
- 🟢 **P3**：风格/小修/清理

---

## 2. 🔴 P1 — 仍有生产风险

### 2.1 token 预算缺失（P1-#2，**最优先**）

**症状**：`Usage` 在 [openai_compatible.rs:178-184](app/backend/src/providers/openai_compatible.rs#L178) 解析后**完全没用**。`max_cycles = 100` × 60s timeout = 单次对话 100 分钟 + 巨量 token 无上限。

**修法**（现状下最划算 —— 错误事件已结构化 + `AgentError` enum 已就位）：
- 累计每次 stream 末尾的 `Usage.total_tokens`
- 超过阈值（`ai_config.json` 加 `max_total_tokens`，默认 100k）就 break
- 走 `AgentError::TokenBudget(u32)` 透传 → `.map_err(|e| e.to_string())` 给前端
- 前端在 `agent-chunk` 收到 `Error` 块时按 message 字符串识别

**估时**：半天
**风险**：低（加新 enum 变体，零侵入）
**影响**：直接砍掉最大一笔不可见成本

---

## 3. 🟡 P2 — 可观察的工程问题

### 3.1 `is_loading` panic 后不归零

**位置**：[agent.rs:848](app/backend/src/agent.rs#L848) (`persist_tool_call` 写 `is_loading: Some(true)`)

**症状**：如果 `execute_tool_for_thread` (L493-501) panic 或新增错误路径导致 `persist_tool_result` (L515-521) 没跑到，loading 状态卡死 —— 前端对应工具调用行一直转圈。

**修法**：
- `Drop` guard（推荐）：在 `persist_tool_call` 之后用 RAII 结构守卫，drop 时检查 is_loading 状态
- 或在 `execute_tool_for_thread` 失败路径里显式 `update_tool_result` 写 `is_loading = false`

**估时**：1 小时
**风险**：低

### 3.2 `format!("user_{}", timestamp_millis)` 撞主键风险

**位置**：[agent.rs:601, 729, 760, 808](app/backend/src/agent.rs#L601) 等 4 处

**症状**：高并发下同毫秒内多次 `send` 触发的助手/用户/工具/推理消息可能撞 PRIMARY KEY（thread_messages.id）。当前单实例单用户几乎不会触发，但前端的"快速重发"按钮可命中。

**修法**：
- 加 `uuid` crate
- 4 处全部改 `Uuid::new_v4().to_string()`
- 数据库列保持 `TEXT` 不变

**估时**：2 小时
**风险**：低

### 3.3 `let _ = app_handle.emit(...)` 错误被吞

**位置**：[agent.rs:440, 449, 477, 502, 540, 586, 700](app/backend/src/agent.rs#L440) — **7 处**

**症状**：忽略 emit 错误。前端订阅断了整个 agent 流静默失败 —— 用户看不到 LLM 响应，但后端 stream 继续跑、token 照花。

**修法**：
- 改 `if let Err(e) = app_handle.emit("agent-chunk", &chunk) { tracing::warn!(error = %e, chunk = ?chunk, "emit failed"); }`
- 或封装一个 `emit_chunk(&app_handle, chunk)` helper，错误统一打 warn

**估时**：1 小时
**风险**：极低

### 3.4 `serde(rename_all = "camelCase")` 不一致

**位置**：[commands.rs:714](app/backend/src/commands.rs#L714)、[agent.rs:102](app/backend/src/agent.rs#L102)、[threads.rs:21, 31](app/backend/src/threads.rs#L21)

**症状**：4 处有，跨 IPC 的 struct 没用。前端有部分类型（如 `AgentChunk`）没标记 → wire 形状是 snake_case，但前端 `agent.ts` 解析 camelCase → 解析失败。

**修法**：对所有跨 IPC 边界的 struct 显式加 `#[serde(rename_all = "camelCase")]`。核对清单：
- [ ] `AgentChunk` 全部 9 变体（agent.rs:88-122）
- [ ] `AgentChatResponse`（commands.rs）
- [ ] `MemoMetadata`（memo_file.rs）
- [ ] 所有 `Tauri::ipc::IpcResponse` 返回类型

**估时**：半天
**风险**：低（wire 形状变更需要前后端同步改）

### 3.5 `AgentManager` 无 `Drop` impl

**位置**：[agent.rs](app/backend/src/agent.rs) struct 定义

**症状**：Tauri 进程退出时 `instance: tokio::sync::RwLock<Option<CachedInstance>>` 里的 `CachedInstance`（含 rllm client / reqwest HTTP client）不 graceful shutdown。可能造成：
- 在飞请求被截断
- 连接池未 flush

**修法**：
```rust
impl Drop for AgentManager {
    fn drop(&mut self) {
        tracing::info!("[AgentManager] dropping");
        // 锁取不到不阻塞; 有 active stream 也不强行 cancel (留给 reqwest 自销毁)
    }
}
```
或更激进：在 `Drop` 里 spawn 一个 short-lived runtime 调 `client.close()`。

**估时**：1-2 小时
**风险**：低

### 3.6 `types/index.ts:198-208` 残留未用的 `StreamEvent` 副本

**位置**：[types/index.ts:198-208, 288-294](app/frontend/types/index.ts#L198)

**症状**：P1-#1 重构时 `types/agent.ts` 里那份 `StreamEvent` 已删（被 `AgentChunk` 替代），但 `types/index.ts` 仍有同款未用副本（9 个子接口） + `StreamEventPayload`。前端 `grep "StreamEvent"` 已无引用，是 dead code。

**修法**：
- 删 [types/index.ts:198-208](app/frontend/types/index.ts#L198) `StreamEvent` 副本
- 删 [types/index.ts:288-294](app/frontend/types/index.ts#L288) `StreamEventPayload`

**估时**：5 分钟
**风险**：极低

---

## 4. 🟢 P3 — 测试债

### 4.1 `persisted_to_llm` 7 个分支无单测

**位置**：[agent.rs:183-231](app/backend/src/agent.rs#L183)

**症状**：`persisted_to_llm` 把 `ChatMessage` 翻译成 `LlmChatMessage`，7 个分支（user / assistant-with-tool_calls / assistant-without-tool_calls / assistant-null-tool_calls / assistant-bad-shape / tool-with-data / tool-without-data / other）。**一条单测都没有**。

**修法**：表驱动测试。7 个 input ChatMessage + 7 个 expected LlmChatMessage，断言相等。

**估时**：半天
**风险**：极低

### 4.2 `prepare_messages` 4 个 `MessageType` 分支无单测

**位置**：[openai_compatible.rs:320-378](app/backend/src/providers/openai_compatible.rs#L320)

**症状**：`prepare_messages` 把 LLM 内部消息翻译成 OpenAI API 格式，4 个变体（ToolResult / ToolUse / Text / unsupported）+ 系统消息注入。**全无单测**。

**修法**：表驱动测试。每个变体一个 fixture。

**估时**：半天
**风险**：极低

### 4.3 `flush_assistant_message_with_tool_calls` 无单测

**位置**：[agent.rs:759-805](app/backend/src/agent.rs#L759)

**症状**：合并写助手文本+tool_calls，序列化 OpenAI 格式 JSON。涉及 `tool_calls: Option<serde_json::Value>` 字段（PR-B 引入）的 round-trip。

**修法**：mock `ThreadManager` + `UserConfigStore`，断言调用序列 + 落库数据。

**估时**：半天
**风险**：低

### 4.4 `ALTER TABLE` 迁移日志级别太低

**位置**：[threads.rs:164](app/backend/src/threads.rs#L164) (`tracing::debug!`)

**症状**：旧库升级时 `tool_calls` 列添加失败，**用户看不到任何提示**。如果 `tracing-subscriber` 配置 RUST_LOG=info，吞了。

**修法**：成功迁移后改 `tracing::info!("[ThreadManager] tool_calls column added")`。

**估时**：5 分钟
**风险**：极低

---

## 5. 🆕 P2 — 本次重构浮现

### 5.1 `ThreadInfo.agent_id: String` 还没改成 `AgentId`

**位置**：[threads.rs:24](app/backend/src/threads.rs#L24)

**症状**：P2-#3 (new) 只改了 `default_agent_id()` 常量 + `AgentError` 包装，没改 storage 层。`ThreadInfo.agent_id` 仍是裸 `String`，与 `AgentId` newtype 不一致 —— 整条 agent_id 链路（`DEFAULT_AGENT_ID` → 内部函数 → storage）类型不闭环。

**修法**（独立 PR）：
- `ThreadInfo.agent_id: AgentId` + `#[serde(transparent)]` 保持 wire 形状 `agentId: String`
- `ThreadManager::create_thread(agent_id: AgentId, ...)`
- `row.get(1)?` 处加 `AgentId(...)` 包装
- `params![]` 处用 `agent_id.0.clone()` 拆开

**估时**：半天
**风险**：低（单文件 + 类型一致性强约束）

---

## 6. 📋 低优先级

### 6.1 `commands.rs` 内 helpers 仍 `Result<_, String>`

**位置**：[commands.rs:256](app/backend/src/commands.rs#L256) `unique_attachment_path`、[commands.rs:1229](app/backend/src/commands.rs#L1229) `base64_decode`

**症状**：本次 PR-B 没碰 —— 2 个调用方，不值得建 `CommandError` enum。plan 中标 out of scope。

**修法**：跳过；或单独 PR。

**估时**：不修 / 1 小时
**风险**：极低

### 6.2 `MemoError` 跳过

**位置**：[memo_file.rs](app/backend/src/memo_file.rs)

**症状**：plan 中列了 `MemoError`，但 explore 后确认 `memo_file.rs` 全部是 `std::io::Result`，已结构化。`agent.rs` 调 `execute_tool` 拿的是 `ToolResult` 结构，不是 `Result`。

**修法**：跳过。

---

## 7. 修复顺序建议

| 优先级 | 任务 | 估时 | 风险 |
|---|---|---|---|
| **P1-#1** | token 预算（加 `AgentError::TokenBudget` 变体）| 半天 | 低 |
| **#4.1 + #4.2 + #4.3** | P0 修复补单测（`persisted_to_llm` + `prepare_messages` + `flush_*`）| 1.5 天 | 极低 |
| **#5.1** | `ThreadInfo.agent_id` 改 `AgentId` | 半天 | 低 |
| **#3.6, #4.4** | 删 `types/index.ts` 残留 + ALTER TABLE 日志 | 5 分钟 | 极低 |
| **#3.2** | 撞主键风险（`user_*` 改 uuid）| 2 小时 | 低 |
| **#3.1, #3.3, #3.4, #3.5** | 小修（`is_loading` / `emit` / `serde` / `Drop`）| 1 天 | 低 |

### 推荐三件套（按 ROI 排）

1. **#P1-#1 token 预算** —— 现有 `AgentError` enum 干净落点，配上 Tauri 边界 `.map_err` 一路通畅。**直接砍掉最大一笔不可见成本**。
2. **#4.1-#4.3 P0 修复补单测** —— 那批代码（`persisted_to_llm` 7 个分支 + `prepare_messages` 4 个分支 + `flush_*`）现在完全裸跑，无任何回归网，未来重构一改就翻车。
3. **#5.1 `ThreadInfo.agent_id` 改 `AgentId`** —— 闭合本次 `AgentId` newtype 重构的最后一环，让整个 agent_id 全链路类型安全。

---

## 8. 上下文索引

- 完成项设计：[P2-#2 / P2-#3 重构方案](.claude/plans/functional-imagining-ripple.md)
- 主题系统问题：[theme-refactor.md](theme-refactor.md)
- 后端模块：[`app/backend/src/agent.rs`](../app/backend/src/agent.rs)、[`app/backend/src/threads.rs`](../app/backend/src/threads.rs)、[`app/backend/src/commands.rs`](../app/backend/src/commands.rs)
