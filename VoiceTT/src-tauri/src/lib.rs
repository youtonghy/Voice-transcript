mod audio;
mod config;
mod error;
mod engines;
mod services;
mod state;
mod store;

use config::AppConfig;
use error::AppError;
use services::{RecordingContext, RecordingMode};
use state::AppState;
use store::{Conversation, ConversationEntry};

use anyhow::anyhow;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
struct StartRecordingOptions {
    translate: Option<bool>,
    translate_language: Option<String>,
    recognition_engine: Option<String>,
    transcribe_language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MediaTranscribeOptions {
    path: String,
    translate: Option<bool>,
    target_language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TranslationRequest {
    conversation_id: String,
    text: String,
    target_language: String,
}

#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().clone())
}

#[tauri::command]
async fn save_config(state: tauri::State<'_, AppState>, config: AppConfig) -> Result<(), String> {
    {
        let mut guard = state.config.write();
        *guard = config.clone();
    }
    config
        .save_to(&state.config_path)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_service_status(state: tauri::State<'_, AppState>) -> Result<state::ServiceStatus, String> {
    Ok(state.status.read().clone())
}

#[tauri::command]
async fn start_recording(
    state: tauri::State<'_, AppState>,
    options: Option<StartRecordingOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or(StartRecordingOptions {
        translate: None,
        translate_language: None,
        recognition_engine: None,
        transcribe_language: None,
    });

    let context = RecordingContext {
        mode: RecordingMode::Default,
        translate: options.translate,
        translate_language: options.translate_language,
        override_recognition_engine: options.recognition_engine,
        override_transcribe_language: options.transcribe_language,
    };

    state
        .transcription
        .start(context)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn stop_recording(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    state.transcription.stop().await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn start_voice_input(
    state: tauri::State<'_, AppState>,
    options: Option<StartRecordingOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or(StartRecordingOptions {
        translate: None,
        translate_language: None,
        recognition_engine: None,
        transcribe_language: None,
    });

    let context = RecordingContext {
        mode: RecordingMode::VoiceInput,
        translate: options.translate,
        translate_language: options.translate_language,
        override_recognition_engine: options.recognition_engine,
        override_transcribe_language: options.transcribe_language,
    };

    state
        .transcription
        .start(context)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn stop_voice_input(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    state.transcription.stop().await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_conversations(state: tauri::State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state
        .store
        .list_conversations()
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_conversation_entries(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    limit: Option<usize>,
) -> Result<Vec<ConversationEntry>, String> {
    state
        .store
        .entries_for_conversation(&conversation_id, limit)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn rename_conversation(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    state
        .store
        .update_conversation_title(&conversation_id, &title)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn pin_conversation(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    pinned: bool,
) -> Result<(), String> {
    state
        .store
        .set_pinned(&conversation_id, pinned)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn delete_conversation(state: tauri::State<'_, AppState>, conversation_id: String) -> Result<(), String> {
    state
        .store
        .delete_conversation(&conversation_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn request_translation(
    state: tauri::State<'_, AppState>,
    options: TranslationRequest,
) -> Result<String, String> {
    state
        .transcription
        .translate_text(options.conversation_id, options.text, options.target_language)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn optimize_text(state: tauri::State<'_, AppState>, text: String) -> Result<String, String> {
    state
        .transcription
        .optimize_text(text)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn summarize_text(
    state: tauri::State<'_, AppState>,
    text: String,
    target_language: String,
) -> Result<String, String> {
    state
        .transcription
        .summarize_text(text, target_language)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn process_media_file(
    state: tauri::State<'_, AppState>,
    options: MediaTranscribeOptions,
) -> Result<String, String> {
    state
        .transcription
        .process_media_file(
            options.path,
            options.translate.unwrap_or(true),
            options.target_language,
        )
        .await
        .map_err(|err| err.to_string())
}

fn setup_state(app: &AppHandle) -> Result<AppState, AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| AppError::Other(err.to_string()))?;
    std::fs::create_dir_all(&config_dir)
        .map_err(|err| AppError::Other(err.to_string()))?;
    let config_path = config_dir.join("config.json");
    let config = AppConfig::load_from(&config_path)
        .map_err(|err| AppError::Other(err.to_string()))?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Other(err.to_string()))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| AppError::Other(err.to_string()))?;
    let db_path = data_dir.join("voice_transcript.db");
    let store = store::ConversationStore::new(db_path)?;

    AppState::initialize(app, config_path, config, store)
        .map_err(|err| AppError::Other(err.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let state = setup_state(&app.handle()).map_err(|err| anyhow!(err.to_string()))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_service_status,
            start_recording,
            stop_recording,
            start_voice_input,
            stop_voice_input,
            get_conversations,
            get_conversation_entries,
            rename_conversation,
            pin_conversation,
            delete_conversation,
            request_translation,
            optimize_text,
            summarize_text,
            process_media_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
