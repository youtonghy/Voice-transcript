mod app_state;
mod config;
mod conversation_store;
mod python;

use crate::python::{default_python_binary, resolve_python_root};
use app_state::{AppState, TrayContext};
use chrono::Local;
use config::AppConfig;
use conversation_store::ConversationStateModel;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuId, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{WebviewWindow, WebviewWindowBuilder};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewUrl};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::fs as tokio_fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const MEDIA_WINDOW_LABEL: &str = "media";
const VOICE_WINDOW_LABEL: &str = "voice";
const TRAY_ID: &str = "voicett-tray";
const TRAY_ITEM_TOGGLE_WINDOW: &str = "tray.toggle-window";
const TRAY_ITEM_TOGGLE_RECORDING: &str = "tray.toggle-recording";
const TRAY_ITEM_TOGGLE_VOICE: &str = "tray.toggle-voice";
const TRAY_ITEM_OPEN_SETTINGS: &str = "tray.open-settings";
const TRAY_ITEM_OPEN_MEDIA: &str = "tray.open-media";
const TRAY_ITEM_QUIT: &str = "tray.quit";
const LABEL_SHOW_MAIN: &str = "显示主界面";
const LABEL_HIDE_MAIN: &str = "隐藏主界面";
const LABEL_START_RECORDING: &str = "🎤 开始录音";
const LABEL_STOP_RECORDING: &str = "⏹️ 停止录音";
const LABEL_START_VOICE: &str = "🎙️ 开始语音输入";
const LABEL_STOP_VOICE: &str = "🛑 停止语音输入";
const LABEL_OPEN_SETTINGS: &str = "设置...";
const LABEL_OPEN_MEDIA: &str = "媒体转写...";
const LABEL_QUIT: &str = "退出";
const TOOLTIP_IDLE: &str = "语音转写";
const TOOLTIP_RECORDING: &str = "录音中";
const TOOLTIP_VOICE: &str = "语音输入中（再次按快捷键或托盘停止）";

#[derive(Debug, Serialize)]
pub struct ServiceStatus {
    pub running: bool,
    pub ready: bool,
}

#[derive(Debug, Serialize)]
struct FileStat {
    size: u64,
}

fn map_err<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let is_visible = window.is_visible().map_err(map_err)?;
        if is_visible {
            window.hide().map_err(map_err)?;
            let _ = window.set_skip_taskbar(true);
        } else {
            window.show().map_err(map_err)?;
            let _ = window.set_focus();
            let _ = window.set_skip_taskbar(false);
        }
        Ok(())
    } else {
        create_or_focus_window(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .map(|_| ())
            .map_err(map_err)
    }
}

fn load_tray_icon(app: &AppHandle, file_name: &str) -> Result<Image<'static>, String> {
    if let Ok(path) = app
        .path()
        .resolve(format!("icons/{file_name}"), BaseDirectory::Resource)
    {
        if let Ok(icon) = Image::from_path(&path) {
            return Ok(icon);
        }
    }
    app.default_window_icon()
        .cloned()
        .map(|icon| icon.to_owned())
        .ok_or_else(|| format!("failed to load tray icon: {file_name}"))
}

async fn ensure_tray(app: &AppHandle, state: &AppState) -> Result<(), String> {
    {
        let existing = state.tray.lock().await;
        if existing.is_some() {
            drop(existing);
            refresh_tray(app, state).await?;
            return Ok(());
        }
    }

    let idle_icon = load_tray_icon(app, "icon.png")?;
    let recording_icon = load_tray_icon(app, "icon-recording.png")?;

    let main_visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);

    let toggle_window = MenuItem::with_id(
        app,
        TRAY_ITEM_TOGGLE_WINDOW,
        if main_visible {
            LABEL_HIDE_MAIN
        } else {
            LABEL_SHOW_MAIN
        },
        true,
        Option::<&str>::None,
    )
    .map_err(map_err)?;
    let toggle_recording = MenuItem::with_id(
        app,
        TRAY_ITEM_TOGGLE_RECORDING,
        if state.recording_active() {
            LABEL_STOP_RECORDING
        } else {
            LABEL_START_RECORDING
        },
        true,
        Option::<&str>::None,
    )
    .map_err(map_err)?;
    let toggle_voice = MenuItem::with_id(
        app,
        TRAY_ITEM_TOGGLE_VOICE,
        if state.voice_input_active() {
            LABEL_STOP_VOICE
        } else {
            LABEL_START_VOICE
        },
        true,
        Option::<&str>::None,
    )
    .map_err(map_err)?;
    let open_settings = MenuItem::with_id(
        app,
        TRAY_ITEM_OPEN_SETTINGS,
        LABEL_OPEN_SETTINGS,
        true,
        Option::<&str>::None,
    )
    .map_err(map_err)?;
    let open_media = MenuItem::with_id(
        app,
        TRAY_ITEM_OPEN_MEDIA,
        LABEL_OPEN_MEDIA,
        true,
        Option::<&str>::None,
    )
    .map_err(map_err)?;
    let quit_item = MenuItem::with_id(app, TRAY_ITEM_QUIT, LABEL_QUIT, true, Option::<&str>::None)
        .map_err(map_err)?;

    let menu = MenuBuilder::new(app)
        .item(&toggle_window)
        .separator()
        .item(&toggle_recording)
        .item(&toggle_voice)
        .separator()
        .item(&open_settings)
        .item(&open_media)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(map_err)?;

    let initial_icon = if state.voice_input_active() || state.recording_active() {
        recording_icon.clone()
    } else {
        idle_icon.clone()
    };
    let initial_tooltip = if state.voice_input_active() {
        TOOLTIP_VOICE
    } else if state.recording_active() {
        TOOLTIP_RECORDING
    } else {
        TOOLTIP_IDLE
    };

    let state_for_menu = state.clone();
    let tray_icon = TrayIconBuilder::with_id(TRAY_ID)
        .icon(initial_icon.clone())
        .menu(&menu)
        .tooltip(initial_tooltip)
        .on_menu_event(move |app_handle, event| {
            let id = event.id().clone();
            let state = state_for_menu.clone();
            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = handle_tray_menu_click(&app, &state, &id).await {
                    eprintln!("[tray] menu handler failed: {err}");
                }
            });
        })
        .on_tray_icon_event({
            let state = state.clone();
            move |tray, event| {
                if let TrayIconEvent::Click {
                    button,
                    button_state,
                    ..
                } = event
                {
                    if matches!(button, MouseButton::Left)
                        && matches!(button_state, MouseButtonState::Up)
                    {
                        let app = tray.app_handle().clone();
                        let state = state.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) = toggle_main_window(&app) {
                                eprintln!("[tray] toggle window failed: {err}");
                            }
                            if let Err(err) = refresh_tray(&app, &state).await {
                                eprintln!("[tray] refresh failed: {err}");
                            }
                        });
                    }
                }
            }
        })
        .build(app)
        .map_err(map_err)?;

    {
        let mut guard = state.tray.lock().await;
        *guard = Some(TrayContext {
            tray_icon: tray_icon.clone(),
            toggle_window: toggle_window.clone(),
            toggle_recording: toggle_recording.clone(),
            toggle_voice: toggle_voice.clone(),
            idle_icon: idle_icon.clone(),
            recording_icon: recording_icon.clone(),
        });
    }

    refresh_tray(app, state).await
}

async fn refresh_tray(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let guard = state.tray.lock().await;
    if let Some(ctx) = guard.as_ref() {
        let window_visible = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        ctx.toggle_window
            .set_text(if window_visible {
                LABEL_HIDE_MAIN
            } else {
                LABEL_SHOW_MAIN
            })
            .map_err(map_err)?;
        ctx.toggle_recording
            .set_text(if state.voice_input_active() {
                LABEL_STOP_RECORDING
            } else if state.recording_active() {
                LABEL_STOP_RECORDING
            } else {
                LABEL_START_RECORDING
            })
            .map_err(map_err)?;
        ctx.toggle_voice
            .set_text(if state.voice_input_active() {
                LABEL_STOP_VOICE
            } else {
                LABEL_START_VOICE
            })
            .map_err(map_err)?;
        let icon = if state.voice_input_active() || state.recording_active() {
            ctx.recording_icon.clone()
        } else {
            ctx.idle_icon.clone()
        };
        ctx.tray_icon.set_icon(Some(icon)).map_err(map_err)?;
        let tooltip = if state.voice_input_active() {
            TOOLTIP_VOICE
        } else if state.recording_active() {
            TOOLTIP_RECORDING
        } else {
            TOOLTIP_IDLE
        };
        ctx.tray_icon.set_tooltip(Some(tooltip)).map_err(map_err)?;
    }
    Ok(())
}

async fn handle_tray_menu_click(
    app: &AppHandle,
    state: &AppState,
    id: &MenuId,
) -> Result<(), String> {
    match id.as_ref() {
        TRAY_ITEM_TOGGLE_WINDOW => {
            toggle_main_window(app)?;
        }
        TRAY_ITEM_TOGGLE_RECORDING => {
            if state.voice_input_active() {
                stop_voice_input_impl(app, state).await?;
            } else if state.recording_active() {
                stop_recording_impl(app, state).await?;
            } else {
                start_recording_impl(app, state).await?;
            }
        }
        TRAY_ITEM_TOGGLE_VOICE => {
            if state.voice_input_active() {
                stop_voice_input_impl(app, state).await?;
            } else {
                start_voice_input_impl(app, state).await?;
            }
        }
        TRAY_ITEM_OPEN_SETTINGS => {
            open_settings(app.clone(), None).await?;
        }
        TRAY_ITEM_OPEN_MEDIA => {
            open_media_transcribe(app.clone()).await?;
        }
        TRAY_ITEM_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
    refresh_tray(app, state).await
}

async fn toggle_voice_input_hotkey(app: &AppHandle, state: &AppState) -> Result<(), String> {
    if state.voice_input_active() {
        stop_voice_input_impl(app, state).await
    } else {
        start_voice_input_impl(app, state).await
    }
}

async fn apply_voice_shortcut(
    app: &AppHandle,
    state: &AppState,
    config: &AppConfig,
) -> Result<(), String> {
    let manager = app.global_shortcut();
    let mut guard = state.last_voice_shortcut.lock().await;
    if let Some(previous) = guard.take() {
        if let Err(err) = manager.unregister(previous.as_str()) {
            eprintln!("[shortcut] unregister failed: {err}");
        }
    }

    if !config.voice_input_enabled || config.voice_input_hotkey.trim().is_empty() {
        if state.voice_input_active() {
            let _ = stop_voice_input_impl(app, state).await;
        }
        refresh_tray(app, state).await?;
        return Ok(());
    }

    let accelerator = config.voice_input_hotkey.trim().to_string();
    let state_for_handler = state.clone();
    manager
        .on_shortcut(accelerator.as_str(), move |app_handle, _shortcut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                let state = state_for_handler.clone();
                let app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = toggle_voice_input_hotkey(&app, &state).await {
                        eprintln!("[shortcut] voice toggle failed: {err}");
                    }
                });
            }
        })
        .map_err(map_err)?;
    *guard = Some(accelerator);
    refresh_tray(app, state).await
}

async fn start_recording_impl(app: &AppHandle, state: &AppState) -> Result<(), String> {
    ensure_service_running(app, state).await?;
    state
        .python()
        .send(json!({ "type": "start_recording" }))
        .await
        .map_err(map_err)?;
    state.set_voice_input_active(false);
    state.set_recording_active(true);
    refresh_tray(app, state).await
}

async fn stop_recording_impl(app: &AppHandle, state: &AppState) -> Result<(), String> {
    state
        .python()
        .send(json!({ "type": "stop_recording" }))
        .await
        .map_err(map_err)?;
    state.set_recording_active(false);
    refresh_tray(app, state).await
}

async fn start_voice_input_impl(app: &AppHandle, state: &AppState) -> Result<(), String> {
    ensure_service_running(app, state).await?;
    let config = state.current_config().await;
    let engine = if !config.voice_input_engine.trim().is_empty() {
        config.voice_input_engine.clone()
    } else if !config.recognition_engine.trim().is_empty() {
        config.recognition_engine.clone()
    } else if !config.transcribe_source.trim().is_empty() {
        config.transcribe_source.clone()
    } else {
        "openai".to_string()
    };
    let language = if !config.voice_input_language.trim().is_empty() {
        config.voice_input_language.clone()
    } else {
        "auto".to_string()
    };
    let translate = config.voice_input_translate;
    let translate_language = if !config.voice_input_translate_language.trim().is_empty() {
        config.voice_input_translate_language.clone()
    } else if !config.translate_language.trim().is_empty() {
        config.translate_language.clone()
    } else {
        "Chinese".to_string()
    };
    state
        .python()
        .send(json!({
            "type": "start_voice_input",
            "override_source": engine,
            "transcribe_language": language,
            "translate": translate,
            "translate_language": translate_language
        }))
        .await
        .map_err(map_err)?;
    state.set_recording_active(true);
    state.set_voice_input_active(true);
    refresh_tray(app, state).await
}

async fn stop_voice_input_impl(app: &AppHandle, state: &AppState) -> Result<(), String> {
    state
        .python()
        .send(json!({ "type": "stop_voice_input" }))
        .await
        .map_err(map_err)?;
    state.set_voice_input_active(false);
    state.set_recording_active(false);
    refresh_tray(app, state).await
}

async fn handle_python_message(app: &AppHandle, state: &AppState, message: Value) {
    match message.get("type").and_then(|v| v.as_str()) {
        Some("recording_stopped") | Some("recording_error") => {
            state.set_recording_active(false);
            state.set_voice_input_active(false);
            if let Err(err) = refresh_tray(app, state).await {
                eprintln!("[tray] refresh failed: {err}");
            }
        }
        _ => {}
    }
}

async fn ensure_service_running(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let config = state.current_config().await;
    state.python().start(app, &config).await.map_err(map_err)?;
    Ok(())
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.current_config().await)
}

#[tauri::command]
async fn load_conversation_state(
    state: State<'_, AppState>,
) -> Result<ConversationStateModel, String> {
    let path = state.config_path();
    conversation_store::load_conversation_state(&path).map_err(map_err)
}

#[tauri::command]
async fn save_conversation_state(
    state: State<'_, AppState>,
    payload: ConversationStateModel,
) -> Result<(), String> {
    let path = state.config_path();
    conversation_store::save_conversation_state(&path, &payload).map_err(map_err)
}

#[tauri::command]
async fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    state.save_config(config.clone()).await.map_err(map_err)?;
    ensure_service_running(&app, &state).await?;
    state
        .python()
        .send_immediate(json!({
            "type": "update_config",
            "force": true,
            "config": config
        }))
        .await
        .map_err(map_err)?;
    if let Err(err) = apply_voice_shortcut(&app, &state, &config).await {
        eprintln!("[shortcut] failed to apply voice shortcut: {err}");
    }
    if let Err(err) = refresh_tray(&app, &state).await {
        eprintln!("[tray] refresh failed: {err}");
    }
    Ok(())
}

#[tauri::command]
async fn get_service_status(state: State<'_, AppState>) -> Result<ServiceStatus, String> {
    let python = state.python();
    let running = python.is_running().await;
    let ready = python.is_ready();
    Ok(ServiceStatus { running, ready })
}

#[tauri::command]
async fn restart_python_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state.current_config().await;
    state.python().restart(&app, &config).await.map_err(map_err)
}

#[tauri::command]
async fn start_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    start_recording_impl(&app, &state).await
}

#[tauri::command]
async fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_recording_impl(&app, &state).await
}

#[tauri::command]
async fn start_voice_input(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    start_voice_input_impl(&app, &state).await
}

#[tauri::command]
async fn stop_voice_input(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_voice_input_impl(&app, &state).await
}

#[tauri::command]
async fn stat_path(path: String) -> Result<Option<FileStat>, String> {
    match tokio_fs::metadata(&path).await {
        Ok(metadata) if metadata.is_file() => Ok(Some(FileStat {
            size: metadata.len(),
        })),
        Ok(_) => Ok(None),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(map_err(err)),
    }
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct TranslationPayload {
    #[serde(default)]
    transcription: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    result_id: Option<String>,
    #[serde(default)]
    resultId: Option<String>,
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    conversationId: Option<String>,
    #[serde(default)]
    entry_id: Option<String>,
    #[serde(default)]
    entryId: Option<String>,
    #[serde(default)]
    target_language: Option<String>,
    #[serde(default)]
    targetLanguage: Option<String>,
    #[serde(default)]
    context: Option<String>,
}

#[tauri::command]
async fn request_translation(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: TranslationPayload,
) -> Result<Value, String> {
    ensure_service_running(&app, &state).await?;
    let transcription = payload
        .transcription
        .or(payload.text)
        .map(|text| text.trim().to_string())
        .unwrap_or_default();
    if transcription.is_empty() {
        return Ok(json!({ "success": false, "error": "No text to translate" }));
    }
    let result_id = payload
        .result_id
        .or(payload.resultId)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let conversation_id = payload.conversation_id.or(payload.conversationId);
    let entry_id = payload.entry_id.or(payload.entryId);
    let config = state.current_config().await;
    let target_language = payload
        .target_language
        .or(payload.targetLanguage)
        .filter(|val| !val.trim().is_empty())
        .unwrap_or_else(|| config.translate_language.clone());

    let message = json!({
        "type": "translate_single",
        "result_id": result_id,
        "transcription": transcription,
        "target_language": target_language,
        "conversation_id": conversation_id,
        "entry_id": entry_id,
        "context": payload.context.unwrap_or_else(|| "manual".to_string())
    });
    state.python().send(message).await.map_err(map_err)?;
    Ok(json!({ "success": true, "resultId": result_id, "targetLanguage": target_language }))
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct OptimizePayload {
    text: Option<String>,
    conversation_id: Option<String>,
    conversationId: Option<String>,
    entry_id: Option<String>,
    entryId: Option<String>,
    request_id: Option<String>,
    requestId: Option<String>,
    target_language: Option<String>,
    targetLanguage: Option<String>,
    system_prompt: Option<String>,
    systemPrompt: Option<String>,
    context: Option<String>,
    max_tokens: Option<u32>,
    maxTokens: Option<u32>,
}

#[tauri::command]
async fn optimize_text(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: OptimizePayload,
) -> Result<Value, String> {
    ensure_service_running(&app, &state).await?;
    let text = payload.text.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Ok(json!({
            "type": "optimization_result",
            "request_id": null,
            "success": false,
            "reason": "empty"
        }));
    }
    let request_id = payload
        .request_id
        .or(payload.requestId)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let conversation_id = payload.conversation_id.or(payload.conversationId);
    let entry_id = payload.entry_id.or(payload.entryId);
    let target_language = payload
        .target_language
        .or(payload.targetLanguage)
        .filter(|val| !val.trim().is_empty());
    let system_prompt = payload
        .system_prompt
        .or(payload.systemPrompt)
        .filter(|val| !val.trim().is_empty());
    let context = payload.context.unwrap_or_else(|| "manual".to_string());
    let max_tokens = payload.max_tokens.or(payload.maxTokens).unwrap_or(320);

    let receiver = state
        .register_pending("optimization_result", &request_id)
        .await;
    let message = json!({
        "type": "optimize_text",
        "request_id": request_id,
        "conversation_id": conversation_id,
        "entry_id": entry_id,
        "text": text,
        "target_language": target_language,
        "system_prompt": system_prompt,
        "context": context,
        "max_tokens": max_tokens
    });

    if let Err(err) = state.python().send(message).await {
        state
            .cancel_pending("optimization_result", &request_id)
            .await;
        return Ok(json!({
            "type": "optimization_result",
            "request_id": request_id,
            "success": false,
            "reason": "unavailable",
            "error": err.to_string()
        }));
    }

    match timeout(Duration::from_secs(20), receiver).await {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(_)) => Ok(json!({
            "type": "optimization_result",
            "request_id": request_id,
            "success": false,
            "reason": "cancelled"
        })),
        Err(_) => {
            state
                .cancel_pending("optimization_result", &request_id)
                .await;
            Ok(json!({
                "type": "optimization_result",
                "request_id": request_id,
                "success": false,
                "reason": "timeout"
            }))
        }
    }
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct SummaryPayload {
    conversation_id: Option<String>,
    conversationId: Option<String>,
    segments: Vec<Value>,
    system_prompt: Option<String>,
    systemPrompt: Option<String>,
}

#[tauri::command]
async fn generate_summary(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SummaryPayload,
) -> Result<Value, String> {
    ensure_service_running(&app, &state).await?;
    if payload.segments.is_empty() {
        return Ok(json!({
            "type": "summary_result",
            "request_id": null,
            "success": false,
            "reason": "empty"
        }));
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let conversation_id = payload.conversation_id.or(payload.conversationId);
    let system_prompt = payload
        .system_prompt
        .or(payload.systemPrompt)
        .filter(|val| !val.trim().is_empty());
    let receiver = state.register_pending("summary_result", &request_id).await;

    let message = json!({
        "type": "generate_summary",
        "request_id": request_id,
        "conversation_id": conversation_id,
        "segments": payload.segments,
        "system_prompt": system_prompt
    });
    if let Err(err) = state.python().send(message).await {
        state.cancel_pending("summary_result", &request_id).await;
        return Ok(json!({
            "type": "summary_result",
            "request_id": request_id,
            "success": false,
            "reason": "unavailable",
            "error": err.to_string()
        }));
    }

    match timeout(Duration::from_secs(30), receiver).await {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(_)) => Ok(json!({
            "type": "summary_result",
            "request_id": request_id,
            "success": false,
            "reason": "cancelled"
        })),
        Err(_) => {
            state.cancel_pending("summary_result", &request_id).await;
            Ok(json!({
                "type": "summary_result",
                "request_id": request_id,
                "success": false,
                "reason": "timeout"
            }))
        }
    }
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct ConversationTitlePayload {
    conversation_id: Option<String>,
    conversationId: Option<String>,
    segments: Vec<Value>,
    target_language: Option<String>,
    targetLanguage: Option<String>,
    empty_title: Option<String>,
    emptyTitle: Option<String>,
    fallback_title: Option<String>,
    fallbackTitle: Option<String>,
    system_prompt: Option<String>,
    systemPrompt: Option<String>,
    updated_at: Option<String>,
    updatedAt: Option<String>,
}

#[tauri::command]
async fn summarize_conversation_title(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConversationTitlePayload,
) -> Result<Value, String> {
    ensure_service_running(&app, &state).await?;
    if payload.segments.is_empty() {
        let empty_title = payload
            .empty_title
            .or(payload.emptyTitle)
            .unwrap_or_default();
        let fallback_title = payload
            .fallback_title
            .or(payload.fallbackTitle)
            .unwrap_or_else(|| empty_title.clone());
        return Ok(json!({
            "type": "conversation_summary",
            "request_id": null,
            "title": fallback_title,
            "source": "empty"
        }));
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let conversation_id = payload.conversation_id.or(payload.conversationId);
    let target_language = payload
        .target_language
        .or(payload.targetLanguage)
        .unwrap_or_else(|| "Chinese".to_string());
    let empty_title = payload
        .empty_title
        .or(payload.emptyTitle)
        .unwrap_or_default();
    let fallback_title = payload
        .fallback_title
        .or(payload.fallbackTitle)
        .unwrap_or_else(|| empty_title.clone());
    let system_prompt = payload
        .system_prompt
        .or(payload.systemPrompt)
        .filter(|val| !val.trim().is_empty());
    let updated_at = payload.updated_at.or(payload.updatedAt);

    let receiver = state
        .register_pending("conversation_summary", &request_id)
        .await;

    let message = json!({
        "type": "summarize_conversation",
        "request_id": request_id,
        "conversation_id": conversation_id,
        "segments": payload.segments,
        "target_language": target_language,
        "empty_title": empty_title,
        "fallback_title": fallback_title,
        "system_prompt": system_prompt,
        "updated_at": updated_at
    });

    if let Err(err) = state.python().send(message).await {
        state
            .cancel_pending("conversation_summary", &request_id)
            .await;
        return Ok(json!({
            "type": "conversation_summary",
            "request_id": request_id,
            "title": fallback_title,
            "source": "unavailable",
            "error": err.to_string()
        }));
    }

    match timeout(Duration::from_secs(15), receiver).await {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(_)) => Ok(json!({
            "type": "conversation_summary",
            "request_id": request_id,
            "title": fallback_title,
            "source": "cancelled"
        })),
        Err(_) => {
            state
                .cancel_pending("conversation_summary", &request_id)
                .await;
            Ok(json!({
                "type": "conversation_summary",
                "request_id": request_id,
                "title": fallback_title,
                "source": "timeout"
            }))
        }
    }
}

#[tauri::command]
fn write_clipboard(app: AppHandle, text: String) -> Result<Value, String> {
    match app.clipboard().write_text(text) {
        Ok(_) => Ok(json!({ "success": true })),
        Err(err) => Ok(json!({ "success": false, "error": err.to_string() })),
    }
}

#[tauri::command]
async fn get_devices() -> Result<Vec<Value>, String> {
    Ok(Vec::new())
}

#[tauri::command]
async fn set_device(_device_id: Option<String>) -> Result<Value, String> {
    Ok(json!({ "success": true }))
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct PythonTestPayload {
    python_path: Option<String>,
    pythonPath: Option<String>,
}

#[tauri::command]
async fn test_python(payload: PythonTestPayload) -> Result<Value, String> {
    let path = payload
        .python_path
        .or(payload.pythonPath)
        .unwrap_or_default();
    if path.trim().is_empty() {
        return Ok(json!({ "success": false, "error": "No python path provided" }));
    }
    let output = tokio::process::Command::new(path.trim())
        .arg("--version")
        .output()
        .await
        .map_err(map_err)?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let version = if !stdout.is_empty() { stdout } else { stderr };
        Ok(json!({ "success": true, "version": version }))
    } else {
        Ok(json!({ "success": false, "error": "Process failed" }))
    }
}

#[tauri::command]
async fn restart_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state.current_config().await;
    state.python().restart(&app, &config).await.map_err(map_err)
}

#[derive(Debug, Deserialize)]
struct ExportResultEntry {
    transcription: Option<String>,
    translation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExportResultsPayload {
    results: Vec<ExportResultEntry>,
    #[serde(rename = "suggestedPath")]
    suggested_path_camel: Option<String>,
    suggested_path: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct ExportLogEntry {
    transcription: Option<String>,
    translation: Option<String>,
    #[serde(default)]
    includeTranslation: bool,
    #[serde(default)]
    include_translation: bool,
    timeText: Option<String>,
    time_text: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct ExportLogsPayload {
    entries: Vec<ExportLogEntry>,
}

fn resolve_documents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().app_config_dir())
        .map_err(map_err)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(map_err)?;
        }
    }
    Ok(())
}

fn parse_export_txt_to_results(content: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let mut transcription = String::new();
    let mut translation = String::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("Segment ") && trimmed.ends_with(':') {
            if !transcription.is_empty() || !translation.is_empty() {
                results.push((transcription.clone(), translation.clone()));
            }
            transcription.clear();
            translation.clear();
            continue;
        }
        if let Some(idx) = trimmed.find(':') {
            let value = trimmed[idx + 1..].trim();
            if transcription.is_empty() {
                transcription = value.to_string();
            } else if translation.is_empty() {
                translation = value.to_string();
            }
        }
    }
    if !transcription.is_empty() || !translation.is_empty() {
        results.push((transcription, translation));
    }
    results
}

fn timestamped_filename(prefix: &str) -> String {
    let now = Local::now();
    format!("{}-{}.txt", prefix, now.format("%Y%m%d-%H%M%S"))
}

#[tauri::command]
async fn process_media_file(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ProcessMediaPayload,
) -> Result<Value, String> {
    let file_path = PathBuf::from(payload.file_path.clone());
    if !file_path.exists() {
        return Ok(json!({ "success": false, "error": "File not found" }));
    }

    let window = match app.get_webview_window(MEDIA_WINDOW_LABEL) {
        Some(win) => win,
        None => {
            return Ok(json!({ "success": false, "error": "Media window unavailable" }));
        }
    };

    let settings = payload.settings.unwrap_or_default();
    let config = state.current_config().await;
    let python_root = resolve_python_root(&app);
    let script = python_root.join("media_transcribe.py");
    if !script.exists() {
        return Ok(json!({ "success": false, "error": "media_transcribe.py not found" }));
    }

    let python_cmd = if !config.python_path.trim().is_empty() {
        config.python_path.trim().to_string()
    } else {
        default_python_binary()
    };

    let mut command = if Path::new(&python_cmd).exists() {
        Command::new(&python_cmd)
    } else {
        Command::new(python_cmd.clone())
    };

    let output_path = if let Some(path) = settings.output_path() {
        PathBuf::from(path)
    } else {
        let mut base = resolve_documents_dir(&app)?;
        base.push(timestamped_filename("transcribe"));
        base
    };
    ensure_parent_dir(&output_path)?;

    let mut args: Vec<String> = Vec::new();
    args.push(script.to_string_lossy().to_string());
    args.push("--file".into());
    args.push(file_path.to_string_lossy().to_string());
    args.push("--output".into());
    args.push(output_path.to_string_lossy().to_string());

    let source = {
        let trimmed_recognition = config.recognition_engine.trim();
        if !trimmed_recognition.is_empty() {
            trimmed_recognition.to_string()
        } else {
            let trimmed_source = config.transcribe_source.trim();
            if trimmed_source.is_empty() {
                "openai".to_string()
            } else {
                trimmed_source.to_string()
            }
        }
    };
    if !source.trim().is_empty() {
        args.push("--source".into());
        args.push(source);
    }
    if settings.enable_translation() {
        args.push("--translate".into());
        if let Some(language) = settings.target_language() {
            if !language.trim().is_empty() {
                args.push("--language".into());
                args.push(language);
            }
        }
    }
    if settings.theater_mode() {
        args.push("--theater-mode".into());
    }

    command
        .current_dir(&python_root)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");

    let mut child = command.spawn().map_err(map_err)?;

    if let Some(stdout) = child.stdout.take() {
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.starts_with("Progress: ") {
                    let message = trimmed.trim_start_matches("Progress: ").trim();
                    let _ = window_clone.emit(
                        "media-progress",
                        json!({ "type": "progress", "message": message }),
                    );
                } else if trimmed.starts_with("Processing completed") {
                    let _ = window_clone.emit("media-progress", json!({ "type": "complete" }));
                } else if trimmed.starts_with("Error:") {
                    let _ = window_clone.emit(
                        "media-progress",
                        json!({ "type": "error", "message": trimmed }),
                    );
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let _ = window_clone.emit(
                        "media-progress",
                        json!({ "type": "error", "message": trimmed }),
                    );
                }
            }
        });
    }

    let status = child.wait().await.map_err(map_err)?;
    if status.success() {
        if let Ok(content) = tokio_fs::read_to_string(&output_path).await {
            for (transcription, translation) in parse_export_txt_to_results(&content) {
                let _ = window.emit(
                    "media-progress",
                    json!({
                        "type": "result",
                        "transcription": transcription,
                        "translation": translation,
                    }),
                );
            }
        }
        let _ = window.emit("media-progress", json!({ "type": "complete" }));
        Ok(json!({
            "success": true,
            "outputPath": output_path.to_string_lossy(),
        }))
    } else {
        let message = format!("media_transcribe exited with code {:?}", status.code());
        let _ = window.emit(
            "media-progress",
            json!({ "type": "error", "message": &message }),
        );
        Ok(json!({ "success": false, "error": message }))
    }
}

fn prepare_export_path(
    app: &AppHandle,
    suggested: Option<String>,
    prefix: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = suggested {
        if !path.trim().is_empty() {
            let buf = PathBuf::from(path);
            if buf.is_absolute() {
                ensure_parent_dir(&buf)?;
                return Ok(buf);
            }
        }
    }
    let mut base = resolve_documents_dir(app)?;
    let file_name = timestamped_filename(prefix);
    base.push(file_name);
    ensure_parent_dir(&base)?;
    Ok(base)
}

#[tauri::command]
async fn export_results(app: AppHandle, payload: ExportResultsPayload) -> Result<Value, String> {
    if payload.results.is_empty() {
        return Ok(json!({ "success": false, "error": "No results to export" }));
    }
    let suggested = payload.suggested_path_camel.or(payload.suggested_path);
    let target = prepare_export_path(&app, suggested, "conversation")?;

    let mut lines = Vec::with_capacity(payload.results.len() * 4 + 4);
    lines.push(String::from("Transcription & Translation Results"));
    lines.push(format!("Generated: {}", Local::now().to_rfc3339()));
    lines.push(String::from(
        "==================================================",
    ));
    lines.push(String::new());

    for (index, entry) in payload.results.iter().enumerate() {
        lines.push(format!("Segment {}:", index + 1));
        lines.push(format!(
            "Transcription: {}",
            entry.transcription.as_deref().unwrap_or("")
        ));
        if let Some(translation) = entry.translation.as_ref() {
            if !translation.trim().is_empty() {
                lines.push(format!("Translation: {}", translation));
            }
        }
        lines.push(String::new());
    }

    fs::write(&target, lines.join("\n")).map_err(map_err)?;
    Ok(json!({
        "success": true,
        "exportPath": target.to_string_lossy()
    }))
}

#[tauri::command]
async fn export_logs(app: AppHandle, payload: ExportLogsPayload) -> Result<Value, String> {
    if payload.entries.is_empty() {
        return Ok(json!({ "success": false, "error": "No logs to export" }));
    }
    let target = prepare_export_path(&app, None, "transcript")?;

    let mut segments = Vec::with_capacity(payload.entries.len());
    for entry in payload.entries {
        let mut lines = Vec::new();
        if let Some(transcription) = entry.transcription {
            if !transcription.trim().is_empty() {
                lines.push(transcription);
            }
        }
        let include_translation = entry.includeTranslation || entry.include_translation;
        if include_translation {
            if let Some(translation) = entry.translation {
                if !translation.trim().is_empty() {
                    lines.push(translation);
                }
            }
        }
        if let Some(time_text) = entry.timeText.or(entry.time_text) {
            if !time_text.trim().is_empty() {
                lines.push(time_text);
            }
        }
        if !lines.is_empty() {
            segments.push(lines.join("\n"));
        }
    }

    if segments.is_empty() {
        return Ok(json!({ "success": false, "error": "No logs to export" }));
    }

    fs::write(&target, segments.join("\n\n")).map_err(map_err)?;
    Ok(json!({
        "success": true,
        "exportPath": target.to_string_lossy()
    }))
}

#[derive(Debug, Deserialize, Clone, Default)]
struct MediaSettings {
    #[serde(alias = "enableTranslation")]
    enable_translation: Option<bool>,
    #[serde(alias = "targetLanguage")]
    target_language: Option<String>,
    #[serde(alias = "theaterMode")]
    theater_mode: Option<bool>,
    #[serde(alias = "outputPath")]
    output_path: Option<String>,
}

impl MediaSettings {
    fn enable_translation(&self) -> bool {
        self.enable_translation.unwrap_or(true)
    }
    fn target_language(&self) -> Option<String> {
        self.target_language.clone()
    }
    fn theater_mode(&self) -> bool {
        self.theater_mode.unwrap_or(false)
    }
    fn output_path(&self) -> Option<String> {
        self.output_path.clone()
    }
}

#[derive(Debug, Deserialize)]
struct ProcessMediaPayload {
    #[serde(alias = "filePath")]
    file_path: String,
    settings: Option<MediaSettings>,
}

#[derive(Debug, Deserialize)]
struct WindowControlPayload {
    action: String,
}

#[tauri::command]
async fn window_control(app: AppHandle, payload: WindowControlPayload) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        match payload.action.as_str() {
            "minimize" => {
                window.minimize().map_err(map_err)?;
            }
            "toggle-maximize" => {
                if window.is_maximized().unwrap_or(false) {
                    window.unmaximize().map_err(map_err)?;
                } else {
                    window.maximize().map_err(map_err)?;
                }
            }
            "close" => {
                window.close().map_err(map_err)?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn create_or_focus_window(
    app: &AppHandle,
    label: &str,
    url: WebviewUrl,
) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        window.show()?;
        window.set_focus()?;
        return Ok(window);
    }
    WebviewWindowBuilder::new(app, label, url).center().build()
}

#[tauri::command]
async fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    let mut url = String::from("index.html#settings");
    if let Some(section) = section {
        url.push_str(&format!("?section={}", section));
    }
    create_or_focus_window(&app, SETTINGS_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
async fn open_media_transcribe(app: AppHandle) -> Result<(), String> {
    create_or_focus_window(
        &app,
        MEDIA_WINDOW_LABEL,
        WebviewUrl::App("index.html#media".into()),
    )
    .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
async fn open_voice_input_settings(app: AppHandle) -> Result<(), String> {
    create_or_focus_window(
        &app,
        VOICE_WINDOW_LABEL,
        WebviewUrl::App("index.html#voice".into()),
    )
    .map_err(map_err)?;
    Ok(())
}

fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let state = tauri::async_runtime::block_on(AppState::initialize(&app_handle))?;
    let python = state.python();
    let handler_python = python.clone();
    let state_for_handler = state.clone();
    let app_for_handler = app_handle.clone();
    tauri::async_runtime::block_on(async move {
        handler_python
            .set_message_handler(move |message| {
                let state = state_for_handler.clone();
                let app = app_for_handler.clone();
                tauri::async_runtime::spawn(async move {
                    state.dispatch_pending_message(message.clone()).await;
                    handle_python_message(&app, &state, message).await;
                });
            })
            .await;
    });
    let config = tauri::async_runtime::block_on(state.current_config());
    app.manage(state.clone());

    let app_handle_for_python = app_handle.clone();
    let config_for_python = config.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = python
            .start(&app_handle_for_python, &config_for_python)
            .await
        {
            eprintln!("[setup] failed to start python service: {err:?}");
        }
    });

    let app_handle_for_tray = app_handle.clone();
    let state_for_tray = state.clone();
    let config_for_shortcut = config.clone();
    tauri::async_runtime::block_on(async {
        if let Err(err) = ensure_tray(&app_handle_for_tray, &state_for_tray).await {
            eprintln!("[tray] failed to initialize tray: {err}");
        }
        if let Err(err) =
            apply_voice_shortcut(&app_handle_for_tray, &state_for_tray, &config_for_shortcut).await
        {
            eprintln!("[shortcut] failed to set initial voice shortcut: {err}");
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_service_status,
            restart_python_service,
            start_recording,
            stop_recording,
            start_voice_input,
            stop_voice_input,
            request_translation,
            optimize_text,
            process_media_file,
            generate_summary,
            summarize_conversation_title,
            export_results,
            export_logs,
            stat_path,
            write_clipboard,
            get_devices,
            set_device,
            test_python,
            restart_service,
            load_conversation_state,
            save_conversation_state,
            window_control,
            open_settings,
            open_media_transcribe,
            open_voice_input_settings
        ])
        .setup(|app| setup_app(app))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
