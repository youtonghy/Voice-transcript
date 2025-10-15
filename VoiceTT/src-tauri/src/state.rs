use std::{path::PathBuf, sync::Arc};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    config::AppConfig,
    services::TranscriptionService,
    store::ConversationStore,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub running: bool,
    pub ready: bool,
    pub is_recording: bool,
    pub mode: Option<String>,
}

impl Default for ServiceStatus {
    fn default() -> Self {
        Self {
            running: true,
            ready: true,
            is_recording: false,
            mode: None,
        }
    }
}

pub struct AppState {
    pub config_path: PathBuf,
    pub config: Arc<RwLock<AppConfig>>,
    pub status: Arc<RwLock<ServiceStatus>>,
    pub store: ConversationStore,
    pub transcription: TranscriptionService,
}

impl AppState {
    pub fn initialize(
        app: &AppHandle,
        config_path: PathBuf,
        config: AppConfig,
        store: ConversationStore,
    ) -> anyhow::Result<Self> {
        let config = Arc::new(RwLock::new(config));
        let status = Arc::new(RwLock::new(ServiceStatus::default()));
        let transcription = TranscriptionService::new(app.clone(), config.clone(), store.clone(), status.clone())?;

        Ok(Self {
            config_path,
            config,
            status,
            store,
            transcription,
        })
    }
}
