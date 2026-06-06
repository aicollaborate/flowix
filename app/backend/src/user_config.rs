use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// ~/.woop/preference.json — 用户偏好设置
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
}

fn default_theme() -> String {
    "system".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceFile {
    #[serde(default)]
    pub personalize: PersonalizeConfig,
    #[serde(default)]
    pub format: FormatConfig,
    #[serde(default = "default_theme")]
    pub theme: String,
}

/// 手写 Default: theme 字段必须用 default_theme, 不能用 String::default() (= "")。
/// 派生宏 #[derive(Default)] 不会为单个字段调指定函数, 必须手工实现。
impl Default for PreferenceFile {
    fn default() -> Self {
        Self {
            personalize: PersonalizeConfig::default(),
            format: FormatConfig::default(),
            theme: default_theme(),
        }
    }
}

/// ~/.woop/ai_config.json — 智能体配置
///
/// `PartialEq` / `Eq` 派生用于 `AgentManager` 的缓存命中判定 (`agent.rs`
/// 里 `ensure_instance` 会用 `cached.config == config` 比较)。结构体只有
/// `String` 字段, 派生的 derive 足够。

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
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

impl UserConfigStore {
    /// 持锁失败的兜底: 锁中毒 (panic held it) 时仍返回 guard, 不让单点 panic
    /// 拖垮整个 Tauri 进程。中毒意味着 in-memory 状态可能处于不一致, 但
    /// 我们的 setter 写入顺序 (disk-first, 然后整体赋值) 让这种情况极少。
    fn read_preference(
        &self,
    ) -> std::sync::RwLockReadGuard<'_, PreferenceFile> {
        self.preference.read().unwrap_or_else(|poisoned| {
            tracing::error!("preference lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn write_preference(
        &self,
    ) -> std::sync::RwLockWriteGuard<'_, PreferenceFile> {
        self.preference.write().unwrap_or_else(|poisoned| {
            tracing::error!("preference lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn read_ai_config(
        &self,
    ) -> std::sync::RwLockReadGuard<'_, AiConfigFile> {
        self.ai_config.read().unwrap_or_else(|poisoned| {
            tracing::error!("ai_config lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn write_ai_config(
        &self,
    ) -> std::sync::RwLockWriteGuard<'_, AiConfigFile> {
        self.ai_config.write().unwrap_or_else(|poisoned| {
            tracing::error!("ai_config lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    pub fn new(home_dir: PathBuf) -> Self {
        let config_dir = home_dir.join(".woop");
        let _ = fs::create_dir_all(&config_dir);
        // ~/.woop 目录收紧到 0o700, 同机器其他用户进不来, 文件权限才有意义。
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
    pub fn set_preference(&self, p: PreferenceFile) -> std::io::Result<()> {
        let content = serde_json::to_string_pretty(&p)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let path = self.config_dir.join("preference.json");
        atomic_write_json(&path, &content)?;
        *self.write_preference() = p;
        Ok(())
    }

    pub fn get_ai_config(&self) -> AiConfigFile {
        self.read_ai_config().clone()
    }

    pub fn set_ai_config(&self, c: AiConfigFile) -> std::io::Result<()> {
        let content = serde_json::to_string_pretty(&c)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
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
fn atomic_write_json(path: &Path, content: &str) -> std::io::Result<()> {
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
