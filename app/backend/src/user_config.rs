use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::USER_CONFIG_DIR_NAME;

/// ~/.flowix/preference.json — 用户偏好设置
/// 字段全部 #[serde(default)], 文件损坏或缺失时回退到默认值。

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalizeConfig {
    #[serde(default)]
    pub custom_instruction: String,
    #[serde(default)]
    pub response_length: String,
    #[serde(default)]
    pub preferred_language: String,
    #[serde(default)]
    pub selected_tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatConfig {
    #[serde(default)]
    pub font_family: String,
    #[serde(default)]
    pub font_size: f64,
    #[serde(default)]
    pub line_height: f64,
    /// 文档编辑区最大宽度 (px) — 应用于 Tiptap ProseMirror max-width。
    /// 镜像前端 `FormatConfig.documentWidth`, 老 preference.json 没此字段
    /// 时由 `#[serde(default)]` 兜底为 0, 前端 sanitizeSettings 会用默认值覆盖。
    #[serde(default)]
    pub document_width: f64,
}

/// 合法主题枚举 — 替代原来的裸 `String`, 在 serde 边界上约束取值。
///
/// 序列化形式是小写字符串 (`"system"` / `"light"` / ...), 与前端 `ThemeId` 联合
/// 类型字面量一一对应; 老的 preference.json (字符串) 仍然兼容读取。
/// 任何不在 4 个变体里的字符串 (例如用户手改磁盘 / 未来客户端加新主题) 会在
/// 反序列化阶段直接报错, 不会写回内存 — 兜底由前端的 sanitizeTheme 兜底成 "system"。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
    Rock,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceFile {
    #[serde(default)]
    pub personalize: PersonalizeConfig,
    #[serde(default)]
    pub format: FormatConfig,
    #[serde(default)]
    pub theme: Theme,
    /// 快捷键用户覆盖层 — actionId → chord 字符串 (e.g. "Mod+Shift+K")。
    /// 镜像前端 `UserSettings.shortcuts`, 缺省走空 HashMap (即全部 action
    /// 走 `ActionDefinition::defaultBinding`)。老 preference.json 没此字段
    /// 时由 `#[serde(default)]` 兜底为空, 不抛错。
    #[serde(default)]
    pub shortcuts: HashMap<String, String>,
}

/// ~/.flowix/ai_config.json — AI 模型配置
///
/// `PartialEq` / `Eq` 派生用于 `AgentManager` 的缓存命中判定 (`agent.rs`
/// 里 `ensure_instance` 会用 `cached.config == config` 比较)。结构体只有
/// `String` 字段, 派生的 derive 足够。

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    /// 单次 `chat_stream` 调用跨所有 cycle 的 token 累计上限。`Usage` 由
    /// provider 在每个流的末尾单独 push 一次, agent 跨 cycle 累加 `total_tokens`,
    /// 超出即熔断并以 `AgentError::TokenBudget` 收口。`0` 表示不限制 (保留
    /// 历史行为, 也方便单测)。默认 180_000 ── 100 cycle × 1.8k token,
    /// 留出 reasoning + system_prompt 余量, 同时挡住"工具结果越喂越胖"型
    /// wallet drain。
    #[serde(default = "default_max_total_tokens")]
    pub max_total_tokens: u32,
}

fn default_max_total_tokens() -> u32 {
    180_000
}

// 手写 Default 而非 `#[derive(Default)]`: 派生实现走 `<u32 as Default>::default()`
// 给到 0, 不读 `default_max_total_tokens()` ── 那条函数只对 JSON 反序列化
// (`#[serde(default = "...")]`) 生效。两条路径必须给到同一个兜底值, 否则
// "刚启动未读盘" 与 "老 config.json 缺字段" 行为分裂 ── 前者会拿到 budget=0
// 等于不限, 后者会拿到 180_000。
impl Default for AiModelConfig {
    fn default() -> Self {
        Self {
            provider: String::new(),
            model: String::new(),
            api_url: String::new(),
            api_key: String::new(),
            max_total_tokens: default_max_total_tokens(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigFile {
    #[serde(default)]
    pub model: AiModelConfig,
}

/// 全局用户配置存储。启动时一次性从磁盘读入内存, 写操作先落盘再更内存。
pub struct UserConfigStore {
    config_dir: PathBuf,
    preference: RwLock<PreferenceFile>,
    ai_config: RwLock<AiConfigFile>,
}

/// 用户配置 (`preference.json` / `ai_config.json`) 写盘错误。`Io` 自动从
/// `std::io::Error` 转, `Json` 从 `serde_json::Error` 转 ── 之前用
/// `io::Error::new(io::ErrorKind::Other, e)` 手动包装的写法可以删掉, 让
/// `?` 一步到位。
#[derive(Debug, thiserror::Error)]
pub enum UserConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

impl UserConfigStore {
    /// 持锁失败的兜底: 锁中毒 (panic held it) 时仍返回 guard, 不让单点 panic
    /// 拖垮整个 Tauri 进程。中毒意味着 in-memory 状态可能处于不一致, 但
    /// 我们的 setter 写入顺序 (disk-first, 然后整体赋值) 让这种情况极少。
    fn read_preference(&self) -> std::sync::RwLockReadGuard<'_, PreferenceFile> {
        self.preference.read().unwrap_or_else(|poisoned| {
            tracing::error!("preference lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn write_preference(&self) -> std::sync::RwLockWriteGuard<'_, PreferenceFile> {
        self.preference.write().unwrap_or_else(|poisoned| {
            tracing::error!("preference lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn read_ai_config(&self) -> std::sync::RwLockReadGuard<'_, AiConfigFile> {
        self.ai_config.read().unwrap_or_else(|poisoned| {
            tracing::error!("ai_config lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn write_ai_config(&self) -> std::sync::RwLockWriteGuard<'_, AiConfigFile> {
        self.ai_config.write().unwrap_or_else(|poisoned| {
            tracing::error!("ai_config lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    pub fn new(home_dir: PathBuf) -> Self {
        let config_dir = home_dir.join(USER_CONFIG_DIR_NAME);
        let _ = fs::create_dir_all(&config_dir);
        // ~/.flowix 目录收紧到 0o700, 同机器其他用户进不来, 文件权限才有意义。
        set_dir_owner_only_perms(&config_dir);

        let preference = Self::read_preference_from_disk(&config_dir).unwrap_or_default();
        let ai_config = Self::read_ai_config_from_disk(&config_dir).unwrap_or_default();
        Self {
            config_dir,
            preference: RwLock::new(preference),
            ai_config: RwLock::new(ai_config),
        }
    }

    #[allow(dead_code)]
    pub fn config_dir(&self) -> &PathBuf {
        &self.config_dir
    }

    pub fn get_preference(&self) -> PreferenceFile {
        self.read_preference().clone()
    }

    /// 先把 JSON 落盘 (tmp + fsync + rename, 0o600), 成功后才更新内存。
    /// 任一写步骤失败 → 内存保持旧值, 磁盘保持旧文件, 不出现"内存新磁盘旧"或
    /// "半写截断"的损坏状态。
    pub fn set_preference(&self, p: PreferenceFile) -> Result<(), UserConfigError> {
        let content = serde_json::to_string_pretty(&p)?;
        let path = self.config_dir.join("preference.json");
        atomic_write_json(&path, &content)?;
        *self.write_preference() = p;
        Ok(())
    }

    pub fn get_ai_config(&self) -> AiConfigFile {
        self.read_ai_config().clone()
    }

    pub fn set_ai_config(&self, c: AiConfigFile) -> Result<(), UserConfigError> {
        let content = serde_json::to_string_pretty(&c)?;
        let path = self.config_dir.join("ai_config.json");
        atomic_write_json(&path, &content)?;
        *self.write_ai_config() = c;
        Ok(())
    }

    fn read_preference_from_disk(dir: &PathBuf) -> Option<PreferenceFile> {
        let path = dir.join("preference.json");
        if !path.exists() {
            return None;
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    fn read_ai_config_from_disk(dir: &PathBuf) -> Option<AiConfigFile> {
        let path = dir.join("ai_config.json");
        if !path.exists() {
            return None;
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }
}

/// 原子写 JSON: 写 .tmp → fsync → 0o600 → rename 到目标。
/// 失败时 .tmp 残留由下次启动覆盖, 不影响主文件。
///
/// `pub(crate)` — `agent_access` 等同形态的 JSON 配置文件 (与 preference.json /
/// ai_config.json 同目录) 复用这个落盘逻辑, 不复制第二份。
pub(crate) fn atomic_write_json(path: &Path, content: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    // 写完即设 0o600, 避免 rename 过程中出现"世界可读"的中间态
    set_file_owner_only_perms(&tmp);
    fs::rename(&tmp, path)?;
    // rename 之后再 chmod 一次, 覆盖目标文件权限 (POSIX rename 保留 source 权限)
    set_file_owner_only_perms(path);
    Ok(())
}

#[cfg(unix)]
fn set_file_owner_only_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    let _ = std::fs::set_permissions(path, perms);
}

#[cfg(not(unix))]
fn set_file_owner_only_perms(_path: &Path) {}

#[cfg(unix)]
fn set_dir_owner_only_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.is_dir() {
            let perms = std::fs::Permissions::from_mode(0o700);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

#[cfg(not(unix))]
fn set_dir_owner_only_perms(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_total_tokens_default_is_180k() {
        // 默认 180k ── 100 cycle × 1.8k token, 留出 reasoning + system_prompt
        // 余量。改默认值时这条单测必须同步改。
        let cfg = AiModelConfig::default();
        assert_eq!(cfg.max_total_tokens, 180_000);
    }

    #[test]
    fn max_total_tokens_round_trips_through_json() {
        let cfg = AiModelConfig {
            provider: "openai".into(),
            model: "gpt-4o".into(),
            api_url: "https://x".into(),
            api_key: "k".into(),
            max_total_tokens: 50_000,
        };
        let s = serde_json::to_string(&cfg).unwrap();
        // camelCase 形状 ── 与前端 AiModelConfig 类型一致。
        assert!(s.contains("\"maxTotalTokens\":50000"), "got: {s}");
        let back: AiModelConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back.max_total_tokens, 50_000);
        assert_eq!(back.model, "gpt-4o");
    }

    #[test]
    fn legacy_ai_config_without_max_total_tokens_loads_with_default() {
        // 老 `~/.flowix/ai_config.json` 没这字段 ── 必须能反序列化, 落到
        // 默认 180_000, 不能让用户首启后突然多了一个 None / 0 熔断。
        let legacy = r#"{
            "provider": "openai",
            "model": "gpt-4o",
            "apiUrl": "https://x",
            "apiKey": "k"
        }"#;
        let cfg: AiModelConfig = serde_json::from_str(legacy).unwrap();
        assert_eq!(cfg.max_total_tokens, 180_000);
    }
}
