# Architecture and Stability Review

Date: 2026-06-08

Scope: Flowix frontend and backend source under `app/frontend` and `app/backend`.

## Summary

This review found several architecture and stability risks. The highest-priority issue is that backend tests do not currently compile, which means the backend regression safety net is broken. The frontend build passes, but the production bundle has large chunk warnings.

## Findings

### 1. Backend tests do not compile

Priority: P0

Locations:

- `app/backend/src/search.rs:486`
- `app/backend/src/search.rs:663`
- `app/backend/src/search.rs:691`
- `app/backend/src/search.rs:730`
- `app/backend/src/memo_file/types.rs:80`

Problem:

`MemoListEntry` now includes `path: Option<String>`, but multiple test fixtures in `search.rs` still construct `MemoListEntry` without the `path` field.

Impact:

This blocks `cargo test` at compile time. It also shows that DTO evolution is not being caught consistently across runtime code, tests, and IPC-facing types.

Verification:

`cargo test` fails with:

```text
missing field `path` in initializer of `memo_file::types::MemoListEntry`
```

### 2. IPC type boundary is weak on the frontend

Priority: P1

Locations:

- `app/frontend/lib/tauri/client.ts:97`
- `app/frontend/lib/tauri/client.ts:103`
- `app/frontend/lib/tauri/client.ts:135`
- `app/frontend/lib/tauri/client.ts:147`

Problem:

The frontend RPC wrapper uses many `any` return types for Tauri commands. Rust DTO changes can pass through TypeScript without compile-time feedback.

Impact:

Backend model changes can silently break UI assumptions. The `MemoListEntry.path` issue is an example of a broader type synchronization risk.

Suggested direction:

Replace `any` with explicit frontend mirror types, or generate TypeScript bindings from Rust IPC DTOs.

### 3. Many IPC commands erase failure details

Priority: P1

Locations:

- `app/backend/src/commands/file.rs:112`
- `app/backend/src/commands/file.rs:125`
- `app/backend/src/commands/file.rs:142`

Problem:

Several commands return `Option<T>` or `bool` instead of structured errors. For example, file read/write/delete failures collapse into `None` or `false`.

Impact:

The frontend cannot distinguish permission refusal, missing files, encoding failures, disk errors, or path-scope errors. This reduces debuggability and produces weaker user-facing error messages.

Suggested direction:

Use command-specific error enums and return `Result<T, CommandError>`, then map errors consistently at the Tauri boundary.

### 4. Memo event emit failures are swallowed

Priority: P2

Location:

- `app/backend/src/memo_events.rs:67`
- `app/backend/src/memo_events.rs:76`

Problem:

`memo_events::emit` calls `app.emit(...)` and discards the result with `let _ =`.

Impact:

If the frontend listener is disconnected or the event channel fails, memo data may change without the UI refreshing, and the backend leaves no diagnostic trace.

Suggested direction:

Mirror the `agent-chunk` pattern: wrap event emission in a helper that logs `warn` on failure while keeping the business path non-blocking.

### 5. Runtime lock poisoning can amplify failures

Priority: P2

Example locations:

- `app/backend/src/lib.rs:311`
- `app/backend/src/commands/memo.rs:82`
- `app/backend/src/commands/helpers.rs:70`

Problem:

Business command paths use many `RwLock::read().unwrap()` and `RwLock::write().unwrap()` calls.

Impact:

If one code path panics while holding a lock, future commands can panic when unwrapping the poisoned lock. In a desktop app, this can turn one localized failure into broader app instability.

Suggested direction:

Convert lock acquisition failures into structured command errors, or centralize lock access through helper functions that handle poisoning intentionally.

### 6. Frontend bundle is too large

Priority: P2

Location:

- `vite.config.ts:8`

Problem:

The frontend build passes, but Vite reports large production chunks. Notable output includes:

- `main-layout` around 5.49 MB
- `ts.worker` around 7.01 MB
- multiple Monaco/Shiki language chunks over the 500 KB warning threshold

Impact:

Large chunks can hurt cold start, memory use, and window open latency in Tauri.

Suggested direction:

Introduce route/component-level dynamic imports and `build.rollupOptions.output.manualChunks`, especially around Monaco, Shiki languages, Mermaid, and editor-heavy panels.

## Verification Commands

Frontend:

```powershell
npm.cmd run build
```

Result: passed, with large chunk warnings.

Backend:

```powershell
cargo test
```

Result: failed during compilation due to missing `MemoListEntry.path` in `search.rs` test fixtures.
