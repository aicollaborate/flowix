//! CLI 统一错误类型。
//!
//! 5 个变体对应 5 个退出码 (见 `exit_code` 方法):
//! - `Usage`           -> 2  参数 / 用法错
//! - `NotFound`        -> 3  notebook / id 找不到
//! - `Io`              -> 4  磁盘 IO 失败
//! - `EditorCancelled` -> 5  编辑器退出非 0
//! - `Other`           -> 1  未分类
//!
//! M1 阶段只用到 `Usage` 和 `Io`, 其他变体在 M2/M3 引入对应命令时使用。

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CliError {
    #[error("{0}")]
    Usage(String),

    #[error("{0}")]
    NotFound(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("editor cancelled")]
    EditorCancelled,

    #[error("{0}")]
    Other(String),
}

impl CliError {
    /// 映射到进程退出码。
    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Usage(_) => 2,
            CliError::NotFound(_) => 3,
            CliError::Io(_) => 4,
            CliError::EditorCancelled => 5,
            CliError::Other(_) => 1,
        }
    }
}
