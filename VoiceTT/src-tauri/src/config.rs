use std::{fs, path::Path};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const DEFAULT_GEMINI_TRANSLATE_PROMPT: &str = r#"You are a professional translation assistant.
Translate user text into {{TARGET_LANGUAGE}}.
Requirements:
1) Preserve the tone and intent of the original text.
2) Provide natural and fluent translations.
3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.
4) Respond with the translation only without additional commentary."#;

pub const DEFAULT_CONVERSATION_TITLE_PROMPT: &str = r#"You are a helpful assistant who writes concise conversation titles in {{TARGET_LANGUAGE}}.
Summarize the provided conversation transcript into one short, descriptive sentence.
Only return the title without extra commentary."#;

pub const DEFAULT_SUMMARY_PROMPT: &str = r#"You are a helpful assistant who summarizes conversations in {{TARGET_LANGUAGE}}.
Review the provided transcript segments and produce a concise paragraph covering the important points.
Do not include system messages or safety policies; respond with summary text only."#;

pub const DEFAULT_OPTIMIZE_PROMPT: &str = r#"You are a friendly conversation coach.
Rewrite the provided text so it sounds natural, fluent, and conversational while keeping the original meaning.
Preserve key information, remain concise, and respond in the same language as the input.
Return only the rewritten text without commentary."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub python_path: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            openai_api_key: String::new(),
            openai_base_url: String::new(),
            openai_transcribe_model: "gpt-4o-transcribe".into(),
            openai_translate_model: "gpt-4o-mini".into(),
            gemini_api_key: String::new(),
            gemini_translate_model: "gemini-2.0-flash".into(),
            gemini_translate_system_prompt: DEFAULT_GEMINI_TRANSLATE_PROMPT.into(),
            conversation_title_system_prompt: DEFAULT_CONVERSATION_TITLE_PROMPT.into(),
            summary_engine: "openai".into(),
            openai_summary_model: "gpt-4o-mini".into(),
            gemini_summary_model: "gemini-2.0-flash".into(),
            summary_system_prompt: DEFAULT_SUMMARY_PROMPT.into(),
            optimize_engine: "openai".into(),
            openai_optimize_model: "gpt-4o-mini".into(),
            gemini_optimize_model: "gemini-2.0-flash".into(),
            optimize_system_prompt: DEFAULT_OPTIMIZE_PROMPT.into(),
            recognition_engine: "openai".into(),
            translation_engine: "openai".into(),
            transcribe_source: "openai".into(),
            soniox_api_key: String::new(),
            dashscope_api_key: String::new(),
            qwen3_asr_model: "qwen3-asr-flash".into(),
            enable_translation: true,
            translate_language: "Chinese".into(),
            translation_mode: "fixed".into(),
            smart_language1: "Chinese".into(),
            smart_language2: "English".into(),
            transcribe_language: "auto".into(),
            silence_rms_threshold: 0.010,
            min_silence_seconds: 1.0,
            theater_mode: false,
            app_language: "en".into(),
            voice_input_enabled: false,
            voice_input_hotkey: "F3".into(),
            voice_input_engine: "openai".into(),
            voice_input_language: "auto".into(),
            voice_input_translate: false,
            voice_input_translate_language: "Chinese".into(),
            python_path: None,
        }
    }
}

impl AppConfig {
    pub fn load_from(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let raw = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file at {}", path.display()))?;
        let mut config: AppConfig = serde_json::from_str(&raw)
            .with_context(|| format!("Failed to parse config file at {}", path.display()))?;

        config.hydrate_defaults();
        Ok(config)
    }

    pub fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create config directory {}", parent.display()))?;
        }

        let data = serde_json::to_string_pretty(self).context("Failed to serialize config")?;
        fs::write(path, data).with_context(|| format!("Failed to write config to {}", path.display()))
    }

    fn hydrate_defaults(&mut self) {
        if self.gemini_translate_model.trim().is_empty() {
            self.gemini_translate_model = "gemini-2.0-flash".into();
        }
        if self.gemini_translate_system_prompt.trim().is_empty() {
            self.gemini_translate_system_prompt = DEFAULT_GEMINI_TRANSLATE_PROMPT.into();
        }
        if self.conversation_title_system_prompt.trim().is_empty() {
            self.conversation_title_system_prompt = DEFAULT_CONVERSATION_TITLE_PROMPT.into();
        }
        if self.summary_engine.trim().is_empty() {
            self.summary_engine = self.translation_engine.clone();
            if self.summary_engine.trim().is_empty() {
                self.summary_engine = "openai".into();
            }
        }
        if self.openai_summary_model.trim().is_empty() {
            self.openai_summary_model = self.openai_translate_model.clone();
            if self.openai_summary_model.trim().is_empty() {
                self.openai_summary_model = "gpt-4o-mini".into();
            }
        }
        if self.gemini_summary_model.trim().is_empty() {
            self.gemini_summary_model = self.gemini_translate_model.clone();
            if self.gemini_summary_model.trim().is_empty() {
                self.gemini_summary_model = "gemini-2.0-flash".into();
            }
        }
        if self.summary_system_prompt.trim().is_empty() {
            self.summary_system_prompt = DEFAULT_SUMMARY_PROMPT.into();
        }
        if self.optimize_engine.trim().is_empty() {
            self.optimize_engine = if !self.summary_engine.trim().is_empty() {
                self.summary_engine.clone()
            } else if !self.translation_engine.trim().is_empty() {
                self.translation_engine.clone()
            } else {
                String::from("openai")
            };
        }
        if self.openai_optimize_model.trim().is_empty() {
            self.openai_optimize_model = if !self.openai_summary_model.trim().is_empty() {
                self.openai_summary_model.clone()
            } else {
                String::from("gpt-4o-mini")
            };
        }
        if self.gemini_optimize_model.trim().is_empty() {
            self.gemini_optimize_model = if !self.gemini_summary_model.trim().is_empty() {
                self.gemini_summary_model.clone()
            } else {
                String::from("gemini-2.0-flash")
            };
        }
        if self.optimize_system_prompt.trim().is_empty() {
            self.optimize_system_prompt = DEFAULT_OPTIMIZE_PROMPT.into();
        }
        if self.app_language.trim().is_empty() {
            self.app_language = "en".into();
        }
        if self.recognition_engine.trim().is_empty() && !self.transcribe_source.trim().is_empty() {
            self.recognition_engine = self.transcribe_source.clone();
        }
        if self.transcribe_source.trim().is_empty() && !self.recognition_engine.trim().is_empty() {
            self.transcribe_source = self.recognition_engine.clone();
        }
        if self.voice_input_hotkey.trim().is_empty() {
            self.voice_input_hotkey = "F3".into();
        }
        if self.voice_input_engine.trim().is_empty() {
            self.voice_input_engine = self.recognition_engine.clone();
            if self.voice_input_engine.trim().is_empty() {
                self.voice_input_engine = "openai".into();
            }
        }
        if self.voice_input_language.trim().is_empty() {
            self.voice_input_language = "auto".into();
        }
        if self.voice_input_translate_language.trim().is_empty() {
            self.voice_input_translate_language = self.translate_language.clone();
            if self.voice_input_translate_language.trim().is_empty() {
                self.voice_input_translate_language = "Chinese".into();
            }
        }
    }
}
