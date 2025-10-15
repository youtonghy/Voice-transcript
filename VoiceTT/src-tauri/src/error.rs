use std::io;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Audio input device not available")]
    NoAudioInputDevice,
    #[error("Recording already in progress")]
    RecordingAlreadyRunning,
    #[error("No active recording session")]
    RecordingNotRunning,
    #[error("Recognition engine not configured: {0}")]
    RecognitionEngineMissing(String),
    #[error("Translation engine not configured: {0}")]
    TranslationEngineMissing(String),
    #[error("Summary engine not configured: {0}")]
    SummaryEngineMissing(String),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Other(value.to_string())
    }
}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}
