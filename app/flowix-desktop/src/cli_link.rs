//! 首次启动时在 `~/.local/bin/flowix-cli` 建一个 symlink, 把内嵌 sidecar
//! 暴露到用户 `$PATH`, 这样装完桌面应用后终端能直接 `flowix-cli ...`。
//!
//! ## 设计
//!
//! - **幂等**: 每次启动都跑, 但只在该 symlink 不存在 / 指向错误目标 /
//!   已损坏时实际写盘。 用户手动删了下次启动自动恢复 ── 比 "marker file
//!   只跑一次" 鲁棒。
//! - **失败宽容**: 任何 I/O 错误 (权限 / 磁盘满 / 只读 fs) 都只
//!   `tracing::warn!`, 不 panic / 不 propagate ── CLI 装不上不影响 GUI。
//! - **范围**: `cfg(unix)` ── macOS + Linux。 Windows 上的等效实现
//!   (在 `%USERPROFILE%\bin\` 放 .bat / .cmd, 或者改注册表 PATH) 不
//!   在本模块范围 ── 项目当前以 macOS 为主要发布目标。
//!
//! ## 路径选择
//!
//! - **链接源 (target)**: `current_exe().parent().join("flowix-cli")` ──
//!   Tauri 2 的 `externalBin` 机制把 sidecar 放在主二进制旁边, dev
//!   (`app/target/<host>/debug/flowix-cli`) 跟 prod
//!   (`/Applications/Flowix.app/Contents/MacOS/flowix-cli`) 都是同
//!   layout。 跟 `commands::cli::resolve_sidecar_path` 的 prod 分支一致。
//! - **链接位置 (link)**: `$HOME/.local/bin/flowix-cli` ── XDG 用户级
//!   bin 目录。 macOS / 多数 Linux 发行版的 zsh / bash **默认** 不在
//!   `$PATH`, 用户需要 `export PATH="$HOME/.local/bin:$PATH"` 加进
//!   `~/.zshrc`。 我们不自动改 shell config (太激进), 只在 log 里
//!   提示。

use std::path::{Path, PathBuf};

/// 在用户级 bin 目录里建 `flowix-cli` symlink。 任何步骤失败都 `warn!`
/// 后返回, 不 panic / 不 propagate 错误。
pub fn ensure_cli_symlink() {
    let Some(home) = dirs::home_dir() else {
        tracing::warn!("[cli-link] home dir unavailable; skip symlink");
        return;
    };
    let bin_dir: PathBuf = home.join(".local").join("bin");
    let link = bin_dir.join("flowix-cli");

    let Some(target) = current_sidecar_path() else {
        tracing::debug!("[cli-link] sidecar not adjacent to current_exe; skip symlink");
        return;
    };

    if !target.exists() {
        tracing::debug!(
            "[cli-link] target {} does not exist; skip symlink",
            target.display()
        );
        return;
    }

    // 已有 symlink ── 看指向哪。
    match std::fs::read_link(&link) {
        Ok(existing) if paths_match(&existing, &target) => {
            tracing::debug!("[cli-link] {} already points to sidecar", link.display());
            return;
        }
        Ok(existing) => {
            // 指向别处 ── 删掉重建。 用户手动改过 symlink 我们也尊重
            // (写到跟 Flowix 同步更新的真源), 但 log 一下。
            tracing::info!(
                "[cli-link] {} pointed to {}; rewriting to {}",
                link.display(),
                existing.display(),
                target.display()
            );
            if let Err(e) = std::fs::remove_file(&link) {
                tracing::warn!(
                    "[cli-link] failed to remove stale symlink {}: {e}",
                    link.display()
                );
                return;
            }
        }
        Err(_) => {
            // 不是 symlink (可能不存在, 也可能是普通文件) ── 落到下面的
            // is_file() 分支去判别。
        }
    }

    // 链接位置被一个普通文件占了 ── 不能覆盖, 怕把用户脚本删了。
    if link.is_file() {
        tracing::warn!(
            "[cli-link] {} exists and is a regular file; not overwriting. \
             remove it manually if you want the symlink.",
            link.display()
        );
        return;
    }

    // 目录不存在就建。 `~/.local/bin` 在 macOS 默认不存在 ── 创了
    // 才能放 symlink。
    if !bin_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&bin_dir) {
            tracing::warn!(
                "[cli-link] failed to create {}: {e}; add ~/.local/bin to PATH manually",
                bin_dir.display()
            );
            return;
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        match symlink(&target, &link) {
            Ok(()) => tracing::info!(
                "[cli-link] symlinked {} → {} (add ~/.local/bin to $PATH if not already)",
                link.display(),
                target.display()
            ),
            Err(e) => tracing::warn!("[cli-link] symlink failed: {e}"),
        }
    }

    // Windows 上不做事 ── 留个占位, 以后补 (例如在 %USERPROFILE%\bin\
    // 放一个 .cmd shim 转调 sidecar)。
    #[cfg(not(unix))]
    {
        tracing::debug!("[cli-link] unix-only; skipped on this platform");
    }
}

/// 跟 `commands::cli::resolve_sidecar_path` 对齐 ── 两条候选路径,
/// 命中任一即可。 Prod 优先 (跟主二进制同目录), 然后 dev fallback
/// (`CARGO_MANIFEST_DIR/binaries/flowix-cli`)。 后者让 dev 模式下
/// 也能验证 symlink 行为 ── 链接会指向用户 checkout 里的 cargo 产物,
/// 切回 prod 安装包时, 下次启动会被 `paths_match` 检测到错指并重建。
fn current_sidecar_path() -> Option<PathBuf> {
    // 1. prod: sidecar 跟主二进制同目录 (Tauri 2 `externalBin` 布局)。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let prod = parent.join("flowix-cli");
            if prod.exists() {
                return Some(prod);
            }
        }
    }
    // 2. dev fallback: `app/flowix-desktop/binaries/flowix-cli` (构建时
    //    硬编码进二进制的 manifest 路径, build-cli.sh 维护的 symlink)。
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("flowix-cli");
    if dev.exists() {
        return Some(dev);
    }
    None
}

/// 比两个路径是否指向同一文件。 直接 `==` 不靠谱 (相对 / 绝对 / 中间
/// 段 `./` 之类), 退到 `canonicalize` 拿真实路径再比 ── 任何一边
/// resolve 失败 (broken symlink / 不存在) 都当 "不同", 由 caller 决定
/// 重写。
fn paths_match(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    matches!(
        (std::fs::canonicalize(a), std::fs::canonicalize(b)),
        (Ok(ref x), Ok(ref y)) if x == y
    )
}
