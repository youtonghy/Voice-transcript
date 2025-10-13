use serde::{Deserialize, Serialize};
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
    match fs::read_to_string(path) {
        Ok(content) => {
            let mut config: AppConfig = serde_json::from_str(&content).unwrap_or_default();
            normalize_config(&mut config);
            config
        }
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(path: &Path, config: &AppConfig) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    let json = serde_json::to_string_pretty(config)?;
    fs::write(path, json)?;
    Ok(())
}

fn normalize_config(config: &mut AppConfig) {
    if config.gemini_translate_model.trim().is_empty() {
        config.gemini_translate_model = "gemini-2.0-flash".to_string();
    }
    if config
        .gemini_translate_system_prompt
        .trim()
        .is_empty()
    {
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
    app_dir.join("config.json")
}
