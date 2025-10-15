use std::{fs::File, sync::Arc};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::DecoderOptions,
        errors::Error as SymphoniaError,
        formats::FormatOptions,
        io::MediaSourceStream,
        meta::MetadataOptions,
    },
    default::{get_codecs, get_probe},
};

use crate::{
    audio::{AudioSegment, Recorder, RecorderConfig},
    config::AppConfig,
    engines::{LanguageService, RecognitionRouter},
    error::{AppError, AppResult},
    state::ServiceStatus,
    store::{ConversationStore, EntryKind, NewEntry},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingMode {
    Default,
    VoiceInput,
}

impl RecordingMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RecordingMode::Default => "default",
            RecordingMode::VoiceInput => "voice_input",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RecordingContext {
    pub mode: RecordingMode,
    pub translate: Option<bool>,
    pub translate_language: Option<String>,
    pub override_recognition_engine: Option<String>,
    pub override_transcribe_language: Option<String>,
}

impl Default for RecordingContext {
    fn default() -> Self {
        Self {
            mode: RecordingMode::Default,
            translate: None,
            translate_language: None,
            override_recognition_engine: None,
            override_transcribe_language: None,
        }
    }
}

#[derive(Clone)]
pub struct TranscriptionService {
    inner: Arc<TranscriptionInner>,
}

struct TranscriptionInner {
    app: AppHandle,
    recognition: RecognitionRouter,
    language: LanguageService,
    store: ConversationStore,
    config: Arc<parking_lot::RwLock<AppConfig>>,
    status: Arc<parking_lot::RwLock<ServiceStatus>>,
    active: Mutex<Option<ActiveSession>>, // Guarded by mutex to manage lifecycle
}

struct ActiveSession {
    metadata: Arc<SessionMetadata>,
    handle: Option<crate::audio::RecordingHandle>,
}

#[derive(Clone)]
struct SessionMetadata {
    conversation_id: String,
    mode: RecordingMode,
    translate: bool,
    translate_language: String,
    override_recognition_engine: Option<String>,
    override_transcribe_language: Option<String>,
}

#[derive(Debug, Serialize)]
struct SegmentEventPayload<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "conversationId")]
    conversation_id: &'a str,
    #[serde(rename = "segmentId")]
    segment_id: &'a str,
    #[serde(rename = "entryId")]
    entry_id: &'a str,
    text: &'a str,
    language: Option<&'a str>,
    confidence: Option<f32>,
    #[serde(rename = "durationMs")]
    duration_ms: u64,
    mode: &'a str,
}

#[derive(Debug, Serialize)]
struct TranslationEventPayload<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "conversationId")]
    conversation_id: &'a str,
    #[serde(rename = "segmentId")]
    segment_id: &'a str,
    #[serde(rename = "entryId")]
    entry_id: &'a str,
    translation: &'a str,
    #[serde(rename = "targetLanguage")]
    target_language: &'a str,
    mode: &'a str,
}

impl TranscriptionService {
    pub fn new(
        app: AppHandle,
        config: Arc<parking_lot::RwLock<AppConfig>>,
        store: ConversationStore,
        status: Arc<parking_lot::RwLock<ServiceStatus>>,
    ) -> AppResult<Self> {
        Ok(Self {
            inner: Arc::new(TranscriptionInner {
                app,
                recognition: RecognitionRouter::new(),
                language: LanguageService::new(),
                store,
                config,
                status,
                active: Mutex::new(None),
            }),
        })
    }

    pub fn is_recording(&self) -> bool {
        self.inner.active.lock().is_some()
    }

    pub fn status(&self) -> ServiceStatus {
        self.inner.status.read().clone()
    }

    pub fn start(&self, context: RecordingContext) -> AppResult<String> {
        let mut guard = self.inner.active.lock();
        if guard.is_some() {
            return Err(AppError::RecordingAlreadyRunning);
        }

        let config_snapshot = self.inner.config.read().clone();

        let recorder_config = RecorderConfig {
            silence_threshold: config_snapshot.silence_rms_threshold,
            min_silence: config_snapshot.min_silence_seconds,
            max_segment_duration: 12.0,
            preferred_sample_rate: None,
        };

        let translate = context
            .translate
            .unwrap_or(config_snapshot.enable_translation);
        let translate_language = context
            .translate_language
            .or_else(|| Some(config_snapshot.translate_language.clone()))
            .unwrap_or_else(|| "Chinese".to_string());

        let conversation = self
            .inner
            .store
            .create_conversation(None)?;

        let metadata = Arc::new(SessionMetadata {
            conversation_id: conversation.id.clone(),
            mode: context.mode,
            translate,
            translate_language,
            override_recognition_engine: context.override_recognition_engine.clone(),
            override_transcribe_language: context.override_transcribe_language.clone(),
        });

        let app_handle = self.inner.app.clone();
        let recognition = self.inner.recognition.clone();
        let language = self.inner.language.clone();
        let store = self.inner.store.clone();
        let config_handle = self.inner.config.clone();
        let metadata_clone = metadata.clone();

        let recorder = Recorder::new(recorder_config);
        let callback = Arc::new(move |segment: AudioSegment| {
            let metadata = metadata_clone.clone();
            let recognition = recognition.clone();
            let language = language.clone();
            let store = store.clone();
            let app = app_handle.clone();
            let config_handle = config_handle.clone();

            tauri::async_runtime::spawn(async move {
                let result = process_segment(
                    recognition,
                    language,
                    store,
                    app,
                    config_handle,
                    metadata,
                    segment,
                )
                .await;

                if let Err(err) = result {
                    eprintln!("segment processing failed: {err}");
                }
            });
        });

        let handle = recorder.start(callback)?;

        *self.inner.status.write() = ServiceStatus {
            running: true,
            ready: true,
            is_recording: true,
            mode: Some(context.mode.as_str().to_string()),
        };

        *guard = Some(ActiveSession {
            metadata,
            handle: Some(handle),
        });

        Ok(conversation.id)
    }

    pub async fn stop(&self) -> AppResult<Option<String>> {
        let active = self.inner.active.lock().take();
        let mut session = active.ok_or(AppError::RecordingNotRunning)?;
        if let Some(handle) = session.handle.take() {
            handle.stop();
        }

        *self.inner.status.write() = ServiceStatus {
            running: true,
            ready: true,
            is_recording: false,
            mode: None,
        };

        if session.metadata.mode == RecordingMode::Default {
            let config_snapshot = self.inner.config.read().clone();
            let store = self.inner.store.clone();
            let conversation_id = session.metadata.conversation_id.clone();
            let language_service = self.inner.language.clone();
            let summary_language = config_snapshot.translate_language.clone();

            let entries = tauri::async_runtime::spawn_blocking(move || {
                store.entries_for_conversation(&conversation_id, None)
            })
            .await
            .map_err(|err| AppError::Other(err.to_string()))??;

            if entries.is_empty() {
                return Ok(None);
            }

            let mut transcript = String::new();
            for entry in &entries {
                if entry.kind == EntryKind::Transcription {
                    transcript.push_str(&entry.text);
                    transcript.push('\n');
                }
            }

            if transcript.trim().is_empty() {
                return Ok(None);
            }

            let summary = language_service
                .summarize(&config_snapshot, &transcript, &summary_language)
                .await?;

            let store_clone = self.inner.store.clone();
            let conversation_id_clone = session.metadata.conversation_id.clone();
            let summary_for_store = summary.clone();
            tauri::async_runtime::spawn_blocking(move || {
                store_clone.append_entry(NewEntry {
                    conversation_id: &conversation_id_clone,
                    kind: EntryKind::Summary,
                    text: &summary_for_store,
                    translated_text: None,
                    language: Some(summary_language.as_str()),
                    metadata: None,
                })
            })
            .await
            .map_err(|err| AppError::Other(err.to_string()))??;

            let payload = json!({
                "type": "summary",
                "conversationId": session.metadata.conversation_id,
                "summary": summary,
            });
            let _ = self.inner.app.emit("transcription-event", payload);
            Ok(Some(summary))
        } else {
            Ok(None)
        }
    }

    pub async fn translate_text(
        &self,
        conversation_id: String,
        text: String,
        target_language: String,
    ) -> AppResult<String> {
        let config_snapshot = self.inner.config.read().clone();
        let translation = self
            .inner
            .language
            .translate(&config_snapshot, &text, &target_language, Some("manual"))
            .await?;

        let store_clone = self.inner.store.clone();
        let conversation_id_store = conversation_id.clone();
        let text_store = text.clone();
        let translation_store = translation.clone();
        let target_language_store = target_language.clone();
        tauri::async_runtime::spawn_blocking(move || {
            store_clone.append_entry(NewEntry {
                conversation_id: &conversation_id_store,
                kind: EntryKind::Translation,
                text: &text_store,
                translated_text: Some(&translation_store),
                language: Some(&target_language_store),
                metadata: None,
            })
        })
        .await
        .map_err(|err| AppError::Other(err.to_string()))??;

        Ok(translation)
    }

    pub async fn optimize_text(&self, text: String) -> AppResult<String> {
        let config_snapshot = self.inner.config.read().clone();
        self.inner.language.optimize(&config_snapshot, &text).await
    }

    pub async fn summarize_text(
        &self,
        text: String,
        target_language: String,
    ) -> AppResult<String> {
        let config_snapshot = self.inner.config.read().clone();
        self.inner
            .language
            .summarize(&config_snapshot, &text, &target_language)
            .await
    }

    pub async fn process_media_file(
        &self,
        path: String,
        translate: bool,
        target_language: Option<String>,
    ) -> AppResult<String> {
        let config_snapshot = self.inner.config.read().clone();
        let recorder_config = RecorderConfig {
            silence_threshold: config_snapshot.silence_rms_threshold,
            min_silence: config_snapshot.min_silence_seconds,
            max_segment_duration: 12.0,
            preferred_sample_rate: None,
        };

        let data = tauri::async_runtime::spawn_blocking({
            let path = path.clone();
            move || decode_audio_file(&path)
        })
        .await
        .map_err(|err| AppError::Other(err.to_string()))??;

        let (samples, sample_rate) = data;
        if samples.is_empty() {
            return Err(AppError::Other("Media file contains no audio".into()));
        }

        let conversation = self
            .inner
            .store
            .create_conversation(Some("Media Transcription"))?;

        let metadata = Arc::new(SessionMetadata {
            conversation_id: conversation.id.clone(),
            mode: RecordingMode::Default,
            translate,
            translate_language: target_language
                .unwrap_or_else(|| config_snapshot.translate_language.clone()),
            override_recognition_engine: None,
            override_transcribe_language: None,
        });

        let segments = crate::audio::segment_audio(&samples, sample_rate, &recorder_config);
        let total_segments = segments.len().max(1);

        for (idx, segment) in segments.into_iter().enumerate() {
            let progress = json!({
                "type": "media_progress",
                "conversationId": conversation.id,
                "current": idx + 1,
                "total": total_segments,
            });
            let _ = self.inner.app.emit("media-event", progress);
            process_segment(
                self.inner.recognition.clone(),
                self.inner.language.clone(),
                self.inner.store.clone(),
                self.inner.app.clone(),
                self.inner.config.clone(),
                metadata.clone(),
                segment,
            )
            .await?;
        }

        let _ = self.inner.app.emit(
            "media-event",
            json!({
                "type": "media_complete",
                "conversationId": conversation.id,
            }),
        );

        Ok(conversation.id)
    }
}

async fn process_segment(
    recognition: RecognitionRouter,
    language: LanguageService,
    store: ConversationStore,
    app: AppHandle,
    config: Arc<parking_lot::RwLock<AppConfig>>,
    metadata: Arc<SessionMetadata>,
    segment: AudioSegment,
) -> AppResult<()> {
    let mut config_snapshot = config.read().clone();
    if let Some(engine) = &metadata.override_recognition_engine {
        config_snapshot.recognition_engine = engine.clone();
    }
    if let Some(language) = &metadata.override_transcribe_language {
        config_snapshot.transcribe_language = language.clone();
    }

    let transcription = recognition.transcribe(&config_snapshot, &segment).await?;

    let entry = tauri::async_runtime::spawn_blocking({
        let store = store.clone();
        let conversation_id = metadata.conversation_id.clone();
        let text = transcription.text.clone();
        let language = transcription.language.clone();
        move || {
            store.append_entry(NewEntry {
                conversation_id: &conversation_id,
                kind: EntryKind::Transcription,
                text: &text,
                translated_text: None,
                language: language.as_deref(),
                metadata: None,
            })
        }
    })
    .await
    .map_err(|err| AppError::Other(err.to_string()))??;

        let payload = SegmentEventPayload {
            kind: "segment",
            conversation_id: &metadata.conversation_id,
            segment_id: &transcription.segment_id,
            entry_id: &entry.id,
            text: &transcription.text,
        language: transcription.language.as_deref(),
        confidence: transcription.confidence,
        duration_ms: transcription.duration_ms,
        mode: metadata.mode.as_str(),
    };
    let _ = app.emit("transcription-event", &payload);

    if metadata.translate {
        let target_language = metadata.translate_language.clone();
        let translation = language
            .translate(&config_snapshot, &transcription.text, &target_language, Some(metadata.mode.as_str()))
            .await?;

        let translation_entry = tauri::async_runtime::spawn_blocking({
            let store = store.clone();
            let conversation_id = metadata.conversation_id.clone();
            let text_for_store = transcription.text.clone();
            let translation_for_store = translation.clone();
            let target_language_for_store = target_language.clone();
            move || {
                store.append_entry(NewEntry {
                    conversation_id: &conversation_id,
                    kind: EntryKind::Translation,
                    text: &text_for_store,
                    translated_text: Some(&translation_for_store),
                    language: Some(&target_language_for_store),
                    metadata: None,
                })
            }
        })
        .await
        .map_err(|err| AppError::Other(err.to_string()))??;

        let translation_payload = TranslationEventPayload {
            kind: "translation",
            conversation_id: &metadata.conversation_id,
            segment_id: &transcription.segment_id,
            entry_id: &translation_entry.id,
            translation: translation_entry.translated_text.as_deref().unwrap_or(""),
            target_language: &metadata.translate_language,
            mode: metadata.mode.as_str(),
        };
        let _ = app.emit("transcription-event", &translation_payload);

        if metadata.mode == RecordingMode::VoiceInput {
            let payload = json!({
                "type": "voice_input",
                "conversationId": metadata.conversation_id,
                "segmentId": transcription.segment_id,
                "transcription": transcription.text,
                "translation": translation,
                "language": metadata.translate_language,
            });
            let _ = app.emit("transcription-event", payload);
        }
    } else if metadata.mode == RecordingMode::VoiceInput {
        let payload = json!({
            "type": "voice_input",
            "conversationId": metadata.conversation_id,
            "segmentId": transcription.segment_id,
            "transcription": transcription.text,
            "language": transcription.language,
        });
        let _ = app.emit("transcription-event", payload);
    }

    Ok(())
}

fn decode_audio_file(path: &str) -> AppResult<(Vec<f32>, u32)> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = get_probe()
        .format(
            &Default::default(),
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|err| AppError::Other(err.to_string()))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| AppError::Other("No audio track found".into()))?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let mut decoder = get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|err| AppError::Other(err.to_string()))?;

    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| AppError::Other("Audio sample rate unavailable".into()))? as u32;

    let mut samples = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => return Err(AppError::Other(err.to_string())),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(AppError::Other(err.to_string())),
        };

        let spec = *decoded.spec();
        let mut sample_buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buffer.copy_interleaved_ref(decoded);
        append_samples(spec.channels.count() as usize, sample_buffer.samples(), &mut samples);
    }

    Ok((samples, sample_rate))
}

fn append_samples(channels: usize, data: &[f32], output: &mut Vec<f32>) {
    if channels == 0 {
        return;
    }
    for frame in data.chunks(channels) {
        let sum: f32 = frame.iter().copied().sum();
        output.push(sum / channels as f32);
    }
}
