use crate::config::{config_path, load_config, save_config, AppConfig};
use crate::python::{resolve_python_root, PythonManager};
use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::image::Image;
use tauri::menu::MenuItem;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Manager, Wry};
use tokio::sync::{Mutex, RwLock};

#[derive(Clone)]
pub struct AppState {
    config_path: PathBuf,
    config: Arc<RwLock<AppConfig>>,
    python: PythonManager,
    pending_responses: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
    recording_active: Arc<AtomicBool>,
    voice_input_active: Arc<AtomicBool>,
    pub tray: Arc<Mutex<Option<TrayContext>>>,
    pub last_voice_shortcut: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub async fn initialize(app: &AppHandle) -> Result<Self> {
        let app_dir = app.path().app_config_dir()?;
        let config_path = config_path(&app_dir);
        let config = load_config(&config_path);
        let python_root = resolve_python_root(app);
        let python = PythonManager::new(python_root);
        let pending_responses: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        Ok(Self {
            config_path,
            config: Arc::new(RwLock::new(config)),
            python,
            pending_responses,
            recording_active: Arc::new(AtomicBool::new(false)),
            voice_input_active: Arc::new(AtomicBool::new(false)),
            tray: Arc::new(Mutex::new(None)),
            last_voice_shortcut: Arc::new(Mutex::new(None)),
        })
    }

    pub fn python(&self) -> PythonManager {
        self.python.clone()
    }

    pub async fn current_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    pub async fn save_config(&self, new_config: AppConfig) -> Result<()> {
        {
            let mut guard = self.config.write().await;
            *guard = new_config.clone();
        }
        save_config(&self.config_path, &new_config)?;
        Ok(())
    }

    pub async fn register_pending(
        &self,
        response_type: &str,
        request_id: &str,
    ) -> tokio::sync::oneshot::Receiver<Value> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let key = format!("{response_type}:{request_id}");
        self.pending_responses.lock().await.insert(key, tx);
        rx
    }

    pub async fn cancel_pending(&self, response_type: &str, request_id: &str) {
        let key = format!("{response_type}:{request_id}");
        self.pending_responses.lock().await.remove(&key);
    }

    pub async fn dispatch_pending_message(&self, message: Value) {
        dispatch_pending(Arc::clone(&self.pending_responses), message).await;
    }

    pub fn set_recording_active(&self, active: bool) {
        self.recording_active.store(active, Ordering::SeqCst);
    }

    pub fn recording_active(&self) -> bool {
        self.recording_active.load(Ordering::SeqCst)
    }

    pub fn set_voice_input_active(&self, active: bool) {
        self.voice_input_active.store(active, Ordering::SeqCst);
    }

    pub fn voice_input_active(&self) -> bool {
        self.voice_input_active.load(Ordering::SeqCst)
    }
}

async fn dispatch_pending(
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
    message: Value,
) {
    let (resp_type, request_id) = match (
        message.get("type").and_then(|v| v.as_str()),
        message.get("request_id").and_then(|v| v.as_str()),
    ) {
        (Some(t), Some(id)) => (t.to_string(), id.to_string()),
        _ => return,
    };
    let key = format!("{resp_type}:{request_id}");
    if let Some(sender) = pending.lock().await.remove(&key) {
        let _ = sender.send(message);
    }
}

#[derive(Clone)]
pub struct TrayContext {
    pub tray_icon: TrayIcon<Wry>,
    pub toggle_window: MenuItem<Wry>,
    pub toggle_recording: MenuItem<Wry>,
    pub toggle_voice: MenuItem<Wry>,
    pub idle_icon: Image<'static>,
    pub recording_icon: Image<'static>,
}
