use base64::engine::general_purpose::STANDARD as Base64;
use base64::Engine;
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    audio::{encode_wav, AudioSegment},
    config::AppConfig,
    error::{AppError, AppResult},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOutput {
    pub segment_id: String,
    pub text: String,
    pub language: Option<String>,
    pub confidence: Option<f32>,
    pub duration_ms: u64,
}

#[derive(Clone)]
pub struct RecognitionRouter {
    client: Client,
}

impl RecognitionRouter {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn transcribe(
        &self,
        config: &AppConfig,
        segment: &AudioSegment,
    ) -> AppResult<TranscriptionOutput> {
        let wav = encode_wav(&segment.samples, segment.sample_rate)?;
        let engine = config
            .recognition_engine
            .trim()
            .to_lowercase();
        match engine.as_str() {
            "soniox" => self.transcribe_soniox(config, &wav, segment).await,
            "qwen" | "dashscope" => self.transcribe_qwen(config, &wav, segment).await,
            _ => self.transcribe_openai(config, &wav, segment).await,
        }
    }

    async fn transcribe_openai(
        &self,
        config: &AppConfig,
        wav: &[u8],
        segment: &AudioSegment,
    ) -> AppResult<TranscriptionOutput> {
        if config.openai_api_key.trim().is_empty() {
            return Err(AppError::RecognitionEngineMissing("openai".into()));
        }
        let base = if config.openai_base_url.trim().is_empty() {
            "https://api.openai.com"
        } else {
            config.openai_base_url.trim_end_matches('/')
        };
        let url = format!("{}/v1/audio/transcriptions", base);

        let mut form = multipart::Form::new()
            .part(
                "file",
                multipart::Part::bytes(wav.to_vec())
                    .file_name("segment.wav")
                    .mime_str("audio/wav")
                    .map_err(|err| AppError::Other(err.to_string()))?,
            )
            .text("model", config.openai_transcribe_model.clone());

        if config.transcribe_language.trim().to_lowercase() != "auto" {
            form = form.text("language", config.transcribe_language.clone());
        }

        let response = self
            .client
            .post(url)
            .bearer_auth(config.openai_api_key.trim())
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "OpenAI transcription failed ({status}): {body}"
            )));
        }

        let payload: serde_json::Value = response.json().await?;
        let text = payload
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let language = payload
            .get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let confidence = payload
            .get("confidence")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);

        Ok(TranscriptionOutput {
            segment_id: segment.id.to_string(),
            text,
            language,
            confidence,
            duration_ms: segment.duration_ms,
        })
    }

    async fn transcribe_soniox(
        &self,
        config: &AppConfig,
        wav: &[u8],
        segment: &AudioSegment,
    ) -> AppResult<TranscriptionOutput> {
        if config.soniox_api_key.trim().is_empty() {
            return Err(AppError::RecognitionEngineMissing("soniox".into()));
        }
        let url = "https://api.soniox.com/v1/audio:transcribe";
        let audio_base64 = Base64.encode(wav);
        let mut request = json!({
            "config": {
                "include_confidence": true,
                "enable_diarization": false,
                "language": if config.transcribe_language.trim().to_lowercase() == "auto" {
                    serde_json::Value::Null
                } else {
                    serde_json::Value::String(config.transcribe_language.clone())
                }
            },
            "audio": {
                "content": audio_base64
            }
        });

        if config.theater_mode {
            if let Some(map) = request.get_mut("config").and_then(|v| v.as_object_mut()) {
                map.insert("speed_boost".into(), serde_json::Value::Bool(true));
            }
        }

        let response = self
            .client
            .post(url)
            .bearer_auth(config.soniox_api_key.trim())
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "Soniox transcription failed ({status}): {body}"
            )));
        }

        let payload: serde_json::Value = response.json().await?;
        let results = payload
            .get("transcription")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut text_fragments = Vec::new();
        let mut confidences = Vec::new();
        for item in results {
            if let Some(value) = item.get("text").and_then(|v| v.as_str()) {
                text_fragments.push(value.trim().to_string());
            }
            if let Some(conf) = item.get("confidence").and_then(|v| v.as_f64()) {
                confidences.push(conf as f32);
            }
        }

        let confidence = if !confidences.is_empty() {
            Some(confidences.iter().copied().sum::<f32>() / confidences.len() as f32)
        } else {
            None
        };

        Ok(TranscriptionOutput {
            segment_id: segment.id.to_string(),
            text: text_fragments.join(" "),
            language: payload
                .get("language")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            confidence,
            duration_ms: segment.duration_ms,
        })
    }

    async fn transcribe_qwen(
        &self,
        config: &AppConfig,
        wav: &[u8],
        segment: &AudioSegment,
    ) -> AppResult<TranscriptionOutput> {
        if config.dashscope_api_key.trim().is_empty() {
            return Err(AppError::RecognitionEngineMissing("dashscope".into()));
        }

        let url =
            "https://dashscope.aliyuncs.com/api/v1/services/speech_recognition/recognize";
        let audio_base64 = Base64.encode(wav);

        let mut payload = json!({
            "model": config.qwen3_asr_model,
            "input": {
                "mode": "file",
                "format": "wav",
                "sample_rate": segment.sample_rate,
                "audio": audio_base64
            },
            "parameters": {}
        });

        if config.transcribe_language.trim().to_lowercase() != "auto" {
            if let Some(map) = payload
                .get_mut("parameters")
                .and_then(|v| v.as_object_mut())
            {
                map.insert(
                    "language".into(),
                    serde_json::Value::String(config.transcribe_language.clone()),
                );
            }
        }

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", config.dashscope_api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "DashScope transcription failed ({status}): {body}"
            )));
        }

        let data: serde_json::Value = response.json().await?;
        let result_text = data
            .pointer("/output/text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        Ok(TranscriptionOutput {
            segment_id: segment.id.to_string(),
            text: result_text,
            language: data
                .pointer("/output/language")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            confidence: data
                .pointer("/output/confidence")
                .and_then(|v| v.as_f64())
                .map(|v| v as f32),
            duration_ms: segment.duration_ms,
        })
    }
}

#[derive(Clone)]
pub struct LanguageService {
    client: Client,
}

impl LanguageService {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn translate(
        &self,
        config: &AppConfig,
        text: &str,
        target_language: &str,
        context: Option<&str>,
    ) -> AppResult<String> {
        let engine = config.translation_engine.trim().to_lowercase();
        match engine.as_str() {
            "gemini" => {
                let prompt = config.gemini_translate_system_prompt.trim();
                let system_prompt = if prompt.is_empty() { None } else { Some(prompt) };
                self.call_gemini(
                    &config.gemini_api_key,
                    &config.gemini_translate_model,
                    system_prompt,
                    text,
                    Some(target_language),
                    context,
                )
                .await
            }
            _ => {
                if config.openai_api_key.trim().is_empty() {
                    return Err(AppError::TranslationEngineMissing("openai".into()));
                }
                self.call_openai_chat(
                    &config.openai_api_key,
                    config
                        .openai_base_url
                        .trim(),
                    &config.openai_translate_model,
                    Some(format!(
                        "You are a professional translator. Translate the user message into {}. Respond with translation only.",
                        target_language
                    )),
                    text,
                )
                .await
            }
        }
    }

    pub async fn summarize(
        &self,
        config: &AppConfig,
        text: &str,
        target_language: &str,
    ) -> AppResult<String> {
        let engine = config.summary_engine.trim().to_lowercase();
        let prompt = Some(
            config
                .summary_system_prompt
                .clone()
                .replace("{{TARGET_LANGUAGE}}", target_language),
        );
        match engine.as_str() {
            "gemini" => {
                let prompt_trimmed = prompt
                    .as_ref()
                    .map(|p| p.trim())
                    .unwrap_or("");
                let prompt_opt = if prompt_trimmed.is_empty() {
                    None
                } else {
                    Some(prompt_trimmed)
                };
                self.call_gemini(
                    &config.gemini_api_key,
                    &config.gemini_summary_model,
                    prompt_opt,
                    text,
                    None,
                    None,
                )
                .await
            }
            _ => {
                if config.openai_api_key.trim().is_empty() {
                    return Err(AppError::SummaryEngineMissing("openai".into()));
                }
                self.call_openai_chat(
                    &config.openai_api_key,
                    config.openai_base_url.trim(),
                    &config.openai_summary_model,
                    prompt.as_deref(),
                    text,
                )
                .await
            }
        }
    }

    pub async fn optimize(
        &self,
        config: &AppConfig,
        text: &str,
    ) -> AppResult<String> {
        let engine = config.optimize_engine.trim().to_lowercase();
        let prompt = Some(config.optimize_system_prompt.clone());
        match engine.as_str() {
            "gemini" => {
                let prompt_trimmed = prompt
                    .as_ref()
                    .map(|p| p.trim())
                    .unwrap_or("");
                let prompt_opt = if prompt_trimmed.is_empty() {
                    None
                } else {
                    Some(prompt_trimmed)
                };
                self.call_gemini(
                    &config.gemini_api_key,
                    &config.gemini_optimize_model,
                    prompt_opt,
                    text,
                    None,
                    None,
                )
                .await
            }
            _ => {
                if config.openai_api_key.trim().is_empty() {
                    return Err(AppError::TranslationEngineMissing("openai".into()));
                }
                self.call_openai_chat(
                    &config.openai_api_key,
                    config.openai_base_url.trim(),
                    &config.openai_optimize_model,
                    prompt.as_deref(),
                    text,
                )
                .await
            }
        }
    }

    async fn call_openai_chat(
        &self,
        api_key: &str,
        base_url: &str,
        model: &str,
        system_prompt: Option<impl AsRef<str>>,
        user_text: &str,
    ) -> AppResult<String> {
        if api_key.trim().is_empty() {
            return Err(AppError::TranslationEngineMissing("openai".into()));
        }

        let base = if base_url.is_empty() {
            "https://api.openai.com"
        } else {
            base_url.trim_end_matches('/')
        };
        let url = format!("{}/v1/chat/completions", base);

        let mut messages = Vec::new();
        if let Some(prompt) = system_prompt {
            messages.push(json!({
                "role": "system",
                "content": prompt.as_ref()
            }));
        }
        messages.push(json!({
            "role": "user",
            "content": user_text
        }));

        let body = json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2
        });

        let response = self
            .client
            .post(url)
            .bearer_auth(api_key.trim())
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "OpenAI request failed ({status}): {body}"
            )));
        }

        let payload: serde_json::Value = response.json().await?;
        let message = payload
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        Ok(message)
    }

    async fn call_gemini(
        &self,
        api_key: &str,
        model: &str,
        system_prompt: Option<&str>,
        user_text: &str,
        target_language: Option<&str>,
        context: Option<&str>,
    ) -> AppResult<String> {
        if api_key.trim().is_empty() {
            return Err(AppError::TranslationEngineMissing("gemini".into()));
        }
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );

        let mut system_instruction = Vec::new();
        if let Some(prompt) = system_prompt {
            system_instruction.push(json!({"text": prompt}));
        }
        if let Some(lang) = target_language {
            system_instruction.push(json!({"text": format!("Respond in {}.", lang)}));
        }
        if let Some(ctx) = context {
            system_instruction.push(json!({"text": format!("Context: {}", ctx)}));
        }

        let body = json!({
            "systemInstruction": {
                "parts": system_instruction
            },
            "contents": [{
                "role": "user",
                "parts": [{
                    "text": user_text
                }]
            }]
        });

        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "Gemini request failed ({status}): {body}"
            )));
        }

        let payload: serde_json::Value = response.json().await?;
        let text = payload
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        Ok(text)
    }
}
