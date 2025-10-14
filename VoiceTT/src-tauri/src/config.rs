use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub openai_api_key: String,
    pub openai_base_url: String,
    pub openai_transcribe_model: String,
    pub openai_translate_model: String,
    pub gemini_api_key: String,
    pub gemini_translate_model: String,
    pub gemini_translate_system_prompt: String,
    pub conversation_title_system_prompt: String,
    pub summary_engine: String,
    pub openai_summary_model: String,
    pub gemini_summary_model: String,
    pub summary_system_prompt: String,
    pub optimize_engine: String,
    pub openai_optimize_model: String,
    pub gemini_optimize_model: String,
    pub optimize_system_prompt: String,
    pub recognition_engine: String,
    pub translation_engine: String,
    pub transcribe_source: String,
    pub soniox_api_key: String,
    pub dashscope_api_key: String,
    pub qwen3_asr_model: String,
    pub enable_translation: bool,
    pub translate_language: String,
    pub translation_mode: String,
    pub smart_language1: String,
    pub smart_language2: String,
    pub transcribe_language: String,
    pub silence_rms_threshold: f32,
    pub min_silence_seconds: f32,
    pub theater_mode: bool,
    pub app_language: String,
    pub voice_input_enabled: bool,
    pub voice_input_hotkey: String,
    pub voice_input_engine: String,
    pub voice_input_language: String,
    pub voice_input_translate: bool,
    pub voice_input_translate_language: String,
    pub python_path: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            openai_api_key: String::new(),
            openai_base_url: String::new(),
            openai_transcribe_model: "gpt-4o-transcribe".to_string(),
            openai_translate_model: "gpt-4o-mini".to_string(),
            gemini_api_key: String::new(),
            gemini_translate_model: "gemini-2.0-flash".to_string(),
            gemini_translate_system_prompt: DEFAULT_GEMINI_TRANSLATE_PROMPT.to_string(),
            conversation_title_system_prompt: DEFAULT_CONVERSATION_TITLE_PROMPT.to_string(),
            summary_engine: "openai".to_string(),
            openai_summary_model: "gpt-4o-mini".to_string(),
            gemini_summary_model: "gemini-2.0-flash".to_string(),
            summary_system_prompt: DEFAULT_SUMMARY_PROMPT.to_string(),
            optimize_engine: "openai".to_string(),
            openai_optimize_model: "gpt-4o-mini".to_string(),
            gemini_optimize_model: "gemini-2.0-flash".to_string(),
            optimize_system_prompt: DEFAULT_OPTIMIZE_PROMPT.to_string(),
            recognition_engine: "openai".to_string(),
            translation_engine: "openai".to_string(),
            transcribe_source: "openai".to_string(),
            soniox_api_key: String::new(),
            dashscope_api_key: String::new(),
            qwen3_asr_model: "qwen3-asr-flash".to_string(),
            enable_translation: true,
            translate_language: "Chinese".to_string(),
            translation_mode: "fixed".to_string(),
            smart_language1: "Chinese".to_string(),
            smart_language2: "English".to_string(),
            transcribe_language: "auto".to_string(),
            silence_rms_threshold: 0.010,
            min_silence_seconds: 1.0,
            theater_mode: false,
            app_language: "en".to_string(),
            voice_input_enabled: false,
            voice_input_hotkey: "F3".to_string(),
            voice_input_engine: "openai".to_string(),
            voice_input_language: "auto".to_string(),
            voice_input_translate: false,
            voice_input_translate_language: "Chinese".to_string(),
            python_path: String::new(),
        }
    }
}

pub const DEFAULT_GEMINI_TRANSLATE_PROMPT: &str = concat!(
    "You are a professional translation assistant.\n",
    "Translate user text into {{TARGET_LANGUAGE}}.\n",
    "Requirements:\n",
    "1) Preserve the tone and intent of the original text.\n",
    "2) Provide natural and fluent translations.\n",
    "3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.\n",
    "4) Respond with the translation only without additional commentary."
);

pub const DEFAULT_CONVERSATION_TITLE_PROMPT: &str = concat!(
    "You are a helpful assistant who writes concise conversation titles in {{TARGET_LANGUAGE}}.\n",
    "Summarize the provided conversation transcript into one short, descriptive sentence.\n",
    "Only return the title without extra commentary."
);

pub const DEFAULT_SUMMARY_PROMPT: &str = concat!(
    "You are a helpful assistant who summarizes conversations in {{TARGET_LANGUAGE}}.\n",
    "Review the provided transcript segments and produce a concise paragraph covering the important points.\n",
    "Do not include system messages or safety policies; respond with summary text only."
);

pub const DEFAULT_OPTIMIZE_PROMPT: &str = concat!(
    "You are a friendly conversation coach.\n",
    "Rewrite the provided text so it sounds natural, fluent, and conversational while keeping the original meaning.\n",
    "Preserve key information, remain concise, and respond in the same language as the input.\n",
    "Return only the rewritten text without commentary."
);

pub fn load_config(path: &Path) -> AppConfig {
    match load_config_internal(path) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("[config] failed to load config: {error:?}");
            AppConfig::default()
        }
    }
}

pub fn save_config(path: &Path, config: &AppConfig) -> anyhow::Result<()> {
    let mut normalized = config.clone();
    normalize_config(&mut normalized);
    let mut conn = open_or_create_connection(path)?;
    save_config_with_conn(&mut conn, &normalized)?;
    Ok(())
}

fn normalize_config(config: &mut AppConfig) {
    if config.gemini_translate_model.trim().is_empty() {
        config.gemini_translate_model = "gemini-2.0-flash".to_string();
    }
    if config.gemini_translate_system_prompt.trim().is_empty() {
        config.gemini_translate_system_prompt = DEFAULT_GEMINI_TRANSLATE_PROMPT.to_string();
    }
    if config.conversation_title_system_prompt.trim().is_empty() {
        config.conversation_title_system_prompt = DEFAULT_CONVERSATION_TITLE_PROMPT.to_string();
    }
    if config.summary_system_prompt.trim().is_empty() {
        config.summary_system_prompt = DEFAULT_SUMMARY_PROMPT.to_string();
    }
    if config.optimize_system_prompt.trim().is_empty() {
        config.optimize_system_prompt = DEFAULT_OPTIMIZE_PROMPT.to_string();
    }
    if config.summary_engine.trim().is_empty() {
        config.summary_engine = if !config.translation_engine.trim().is_empty() {
            config.translation_engine.clone()
        } else {
            "openai".to_string()
        };
    }
    if config.openai_summary_model.trim().is_empty() {
        config.openai_summary_model = config.openai_translate_model.clone();
    }
    if config.gemini_summary_model.trim().is_empty() {
        config.gemini_summary_model = config.gemini_translate_model.clone();
    }
    if config.optimize_engine.trim().is_empty() {
        config.optimize_engine = if !config.summary_engine.trim().is_empty() {
            config.summary_engine.clone()
        } else if !config.translation_engine.trim().is_empty() {
            config.translation_engine.clone()
        } else {
            "openai".to_string()
        };
    }
    if config.openai_optimize_model.trim().is_empty() {
        config.openai_optimize_model = config.openai_summary_model.clone();
    }
    if config.gemini_optimize_model.trim().is_empty() {
        config.gemini_optimize_model = config.gemini_summary_model.clone();
    }
    if config.app_language.trim().is_empty() {
        config.app_language = "en".to_string();
    }
    if config.recognition_engine.trim().is_empty() {
        config.recognition_engine = config.transcribe_source.clone();
    }
    if config.transcribe_source.trim().is_empty() {
        config.transcribe_source = config.recognition_engine.clone();
    }
}

pub fn config_path(app_dir: &Path) -> PathBuf {
    app_dir.join("config.sqlite")
}

pub(crate) fn open_or_create_connection(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create config directory {}", parent.display())
            })?;
        }
    }
    let conn = Connection::open(path)
        .with_context(|| format!("failed to open config database {}", path.display()))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .context("failed to create app_config table")?;
    Ok(conn)
}

fn load_config_internal(path: &Path) -> Result<AppConfig> {
    let mut conn = open_or_create_connection(path)?;
    let mut map = read_key_values(&conn)?;

    if map.is_empty() {
        if let Some(config) = migrate_from_json(path, &mut conn)? {
            return Ok(config);
        }
    }

    if map.is_empty() {
        let mut config = AppConfig::default();
        normalize_config(&mut config);
        return Ok(config);
    }

    let config = build_config_from_map(&mut map);
    Ok(config)
}

fn migrate_from_json(path: &Path, conn: &mut Connection) -> Result<Option<AppConfig>> {
    let legacy_path = path.with_extension("json");
    if !legacy_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&legacy_path).with_context(|| {
        format!(
            "failed to read legacy config file {}",
            legacy_path.display()
        )
    })?;
    let mut config: AppConfig =
        serde_json::from_str(&content).unwrap_or_else(|_| AppConfig::default());
    normalize_config(&mut config);
    save_config_with_conn(conn, &config)?;
    Ok(Some(config))
}

fn read_key_values(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_config")
        .context("failed to prepare config query")?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .context("failed to iterate config rows")?;

    let mut map = HashMap::new();
    for entry in rows {
        let (key, value) = entry?;
        map.insert(key, value);
    }
    Ok(map)
}

fn save_config_with_conn(conn: &mut Connection, config: &AppConfig) -> Result<()> {
    let entries = config_to_entries(config);
    let tx = conn
        .transaction()
        .context("failed to open config transaction")?;
    for (key, value) in entries {
        tx.execute(
            "INSERT INTO app_config (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .with_context(|| format!("failed to persist config key {}", key))?;
    }
    tx.commit().context("failed to commit config transaction")?;
    Ok(())
}

fn config_to_entries(config: &AppConfig) -> Vec<(&'static str, String)> {
    vec![
        ("openai_api_key", config.openai_api_key.clone()),
        ("openai_base_url", config.openai_base_url.clone()),
        (
            "openai_transcribe_model",
            config.openai_transcribe_model.clone(),
        ),
        (
            "openai_translate_model",
            config.openai_translate_model.clone(),
        ),
        ("gemini_api_key", config.gemini_api_key.clone()),
        (
            "gemini_translate_model",
            config.gemini_translate_model.clone(),
        ),
        (
            "gemini_translate_system_prompt",
            config.gemini_translate_system_prompt.clone(),
        ),
        (
            "conversation_title_system_prompt",
            config.conversation_title_system_prompt.clone(),
        ),
        ("summary_engine", config.summary_engine.clone()),
        ("openai_summary_model", config.openai_summary_model.clone()),
        ("gemini_summary_model", config.gemini_summary_model.clone()),
        (
            "summary_system_prompt",
            config.summary_system_prompt.clone(),
        ),
        ("optimize_engine", config.optimize_engine.clone()),
        (
            "openai_optimize_model",
            config.openai_optimize_model.clone(),
        ),
        (
            "gemini_optimize_model",
            config.gemini_optimize_model.clone(),
        ),
        (
            "optimize_system_prompt",
            config.optimize_system_prompt.clone(),
        ),
        ("recognition_engine", config.recognition_engine.clone()),
        ("translation_engine", config.translation_engine.clone()),
        ("transcribe_source", config.transcribe_source.clone()),
        ("soniox_api_key", config.soniox_api_key.clone()),
        ("dashscope_api_key", config.dashscope_api_key.clone()),
        ("qwen3_asr_model", config.qwen3_asr_model.clone()),
        ("enable_translation", config.enable_translation.to_string()),
        ("translate_language", config.translate_language.clone()),
        ("translation_mode", config.translation_mode.clone()),
        ("smart_language1", config.smart_language1.clone()),
        ("smart_language2", config.smart_language2.clone()),
        ("transcribe_language", config.transcribe_language.clone()),
        (
            "silence_rms_threshold",
            config.silence_rms_threshold.to_string(),
        ),
        (
            "min_silence_seconds",
            config.min_silence_seconds.to_string(),
        ),
        ("theater_mode", config.theater_mode.to_string()),
        ("app_language", config.app_language.clone()),
        (
            "voice_input_enabled",
            config.voice_input_enabled.to_string(),
        ),
        ("voice_input_hotkey", config.voice_input_hotkey.clone()),
        ("voice_input_engine", config.voice_input_engine.clone()),
        ("voice_input_language", config.voice_input_language.clone()),
        (
            "voice_input_translate",
            config.voice_input_translate.to_string(),
        ),
        (
            "voice_input_translate_language",
            config.voice_input_translate_language.clone(),
        ),
        ("python_path", config.python_path.clone()),
    ]
}

fn build_config_from_map(map: &mut HashMap<String, String>) -> AppConfig {
    let mut config = AppConfig::default();

    if let Some(value) = map.remove("openai_api_key") {
        config.openai_api_key = value;
    }
    if let Some(value) = map.remove("openai_base_url") {
        config.openai_base_url = value;
    }
    if let Some(value) = map.remove("openai_transcribe_model") {
        config.openai_transcribe_model = value;
    }
    if let Some(value) = map.remove("openai_translate_model") {
        config.openai_translate_model = value;
    }
    if let Some(value) = map.remove("gemini_api_key") {
        config.gemini_api_key = value;
    }
    if let Some(value) = map.remove("gemini_translate_model") {
        config.gemini_translate_model = value;
    }
    if let Some(value) = map.remove("gemini_translate_system_prompt") {
        config.gemini_translate_system_prompt = value;
    }
    if let Some(value) = map.remove("conversation_title_system_prompt") {
        config.conversation_title_system_prompt = value;
    }
    if let Some(value) = map.remove("summary_engine") {
        config.summary_engine = value;
    }
    if let Some(value) = map.remove("openai_summary_model") {
        config.openai_summary_model = value;
    }
    if let Some(value) = map.remove("gemini_summary_model") {
        config.gemini_summary_model = value;
    }
    if let Some(value) = map.remove("summary_system_prompt") {
        config.summary_system_prompt = value;
    }
    if let Some(value) = map.remove("optimize_engine") {
        config.optimize_engine = value;
    }
    if let Some(value) = map.remove("openai_optimize_model") {
        config.openai_optimize_model = value;
    }
    if let Some(value) = map.remove("gemini_optimize_model") {
        config.gemini_optimize_model = value;
    }
    if let Some(value) = map.remove("optimize_system_prompt") {
        config.optimize_system_prompt = value;
    }
    if let Some(value) = map.remove("recognition_engine") {
        config.recognition_engine = value;
    }
    if let Some(value) = map.remove("translation_engine") {
        config.translation_engine = value;
    }
    if let Some(value) = map.remove("transcribe_source") {
        config.transcribe_source = value;
    }
    if let Some(value) = map.remove("soniox_api_key") {
        config.soniox_api_key = value;
    }
    if let Some(value) = map.remove("dashscope_api_key") {
        config.dashscope_api_key = value;
    }
    if let Some(value) = map.remove("qwen3_asr_model") {
        config.qwen3_asr_model = value;
    }
    if let Some(value) = map.remove("enable_translation") {
        config.enable_translation = parse_bool(&value, config.enable_translation);
    }
    if let Some(value) = map.remove("translate_language") {
        config.translate_language = value;
    }
    if let Some(value) = map.remove("translation_mode") {
        config.translation_mode = value;
    }
    if let Some(value) = map.remove("smart_language1") {
        config.smart_language1 = value;
    }
    if let Some(value) = map.remove("smart_language2") {
        config.smart_language2 = value;
    }
    if let Some(value) = map.remove("transcribe_language") {
        config.transcribe_language = value;
    }
    if let Some(value) = map.remove("silence_rms_threshold") {
        if let Ok(parsed) = value.parse::<f32>() {
            config.silence_rms_threshold = parsed;
        }
    }
    if let Some(value) = map.remove("min_silence_seconds") {
        if let Ok(parsed) = value.parse::<f32>() {
            config.min_silence_seconds = parsed;
        }
    }
    if let Some(value) = map.remove("theater_mode") {
        config.theater_mode = parse_bool(&value, config.theater_mode);
    }
    if let Some(value) = map.remove("app_language") {
        config.app_language = value;
    }
    if let Some(value) = map.remove("voice_input_enabled") {
        config.voice_input_enabled = parse_bool(&value, config.voice_input_enabled);
    }
    if let Some(value) = map.remove("voice_input_hotkey") {
        config.voice_input_hotkey = value;
    }
    if let Some(value) = map.remove("voice_input_engine") {
        config.voice_input_engine = value;
    }
    if let Some(value) = map.remove("voice_input_language") {
        config.voice_input_language = value;
    }
    if let Some(value) = map.remove("voice_input_translate") {
        config.voice_input_translate = parse_bool(&value, config.voice_input_translate);
    }
    if let Some(value) = map.remove("voice_input_translate_language") {
        config.voice_input_translate_language = value;
    }
    if let Some(value) = map.remove("python_path") {
        config.python_path = value;
    }

    normalize_config(&mut config);
    config
}

fn parse_bool(value: &str, fallback: bool) -> bool {
    match value.trim().to_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => fallback,
    }
}
