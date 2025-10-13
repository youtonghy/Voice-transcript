use crate::config::AppConfig;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tauri::async_runtime::JoinHandle;

#[derive(Clone)]
pub struct PythonManager {
    python_root: PathBuf,
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    ready: Arc<AtomicBool>,
    pending: Arc<Mutex<Vec<Value>>>,
    tasks: Arc<Mutex<Vec<JoinHandle<()>>>>,
    message_handler: Arc<Mutex<Arc<dyn Fn(Value) + Send + Sync + 'static>>>,
}

impl PythonManager {
    pub fn new(python_root: PathBuf) -> Self {
        Self {
            python_root,
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            ready: Arc::new(AtomicBool::new(false)),
            pending: Arc::new(Mutex::new(Vec::new())),
            tasks: Arc::new(Mutex::new(Vec::new())),
            message_handler: Arc::new(Mutex::new(Arc::new(|_| {}))),
        }
    }

    pub async fn set_message_handler<F>(&self, handler: F)
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        *self.message_handler.lock().await = Arc::new(handler);
    }

    pub async fn start(&self, app: &AppHandle, config: &AppConfig) -> Result<()> {
        let mut child_guard = self.child.lock().await;
        if child_guard.is_some() {
            return Ok(());
        }

        let command = resolve_transcribe_command(&self.python_root, config)?;
        let mut cmd = Command::new(&command.program);
        for arg in &command.args {
            cmd.arg(arg);
        }
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd.current_dir(determine_working_dir(app, &self.python_root)?);
        cmd.env("PYTHONUNBUFFERED", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");

        let mut child = cmd.spawn().context("failed to spawn python service")?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdin = child.stdin.take();

        *self.stdin.lock().await = stdin;
        self.ready.store(false, Ordering::SeqCst);
        self.pending.lock().await.clear();

        if let Some(stdout) = stdout {
            let manager = self.clone();
            let app_handle = app.clone();
            let handle = tauri::async_runtime::spawn(async move {
                if let Err(err) = pump_stdout(stdout, manager, app_handle).await {
                    eprintln!("[python] stdout pump failed: {err:?}");
                }
            });
            self.tasks.lock().await.push(handle);
        }

        if let Some(stderr) = stderr {
            let app_handle = app.clone();
            let handle = tauri::async_runtime::spawn(async move {
                if let Err(err) = pump_stderr(stderr, app_handle).await {
                    eprintln!("[python] stderr pump failed: {err:?}");
                }
            });
            self.tasks.lock().await.push(handle);
        }

        *child_guard = Some(child);

        // Push initial config immediately
        let config_message = serde_json::json!({
            "type": "update_config",
            "force": true,
            "config": config,
        });
        // Ignore error here; it will queue if stdin not ready yet.
        let _ = self.send_immediate(config_message).await;
        Ok(())
    }

    pub async fn stop(&self) -> Result<()> {
        {
            let mut tasks = self.tasks.lock().await;
            for handle in tasks.drain(..) {
                handle.abort();
            }
        }
        if let Some(mut child) = self.child.lock().await.take() {
            if let Err(err) = child.kill().await {
                eprintln!("[python] failed to kill child: {err:?}");
            }
        }
        *self.stdin.lock().await = None;
        self.ready.store(false, Ordering::SeqCst);
        self.pending.lock().await.clear();
        Ok(())
    }

    pub async fn restart(&self, app: &AppHandle, config: &AppConfig) -> Result<()> {
        self.stop().await?;
        self.start(app, config).await
    }

    pub async fn is_running(&self) -> bool {
        self.child.lock().await.is_some()
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub async fn send(&self, message: Value) -> Result<()> {
        if self.is_ready() {
            self.write_now(&message).await
        } else {
            self.pending.lock().await.push(message);
            Ok(())
        }
    }

    pub async fn send_immediate(&self, message: Value) -> Result<()> {
        self.write_now(&message).await
    }

    async fn write_now(&self, message: &Value) -> Result<()> {
        let json = serde_json::to_string(message)?;
        let mut guard = self.stdin.lock().await;
        if let Some(stdin) = guard.as_mut() {
            stdin.write_all(json.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
            Ok(())
        } else {
            Err(anyhow!("python stdin not available"))
        }
    }

    async fn flush_pending(&self) -> Result<()> {
        let mut pending = self.pending.lock().await;
        if pending.is_empty() {
            return Ok(());
        }
        let mut drained = Vec::new();
        drained.append(&mut *pending);
        drop(pending);
        for msg in drained {
            self.write_now(&msg).await?;
        }
        Ok(())
    }

    async fn mark_ready(&self) -> Result<()> {
        let was_ready = self.ready.swap(true, Ordering::SeqCst);
        if !was_ready {
            self.flush_pending().await?;
        }
        Ok(())
    }
}

struct PythonCommand {
    program: PathBuf,
    args: Vec<String>,
}

fn resolve_transcribe_command(root: &Path, config: &AppConfig) -> Result<PythonCommand> {
    let script = root.join("transcribe_service.py");
    if !script.exists() {
        return Err(anyhow!(
            "transcribe_service.py not found at {}",
            script.display()
        ));
    }
    let program = if !config.python_path.trim().is_empty() {
        PathBuf::from(config.python_path.trim())
    } else {
        PathBuf::from(default_python_binary())
    };
    Ok(PythonCommand {
        program,
        args: vec![script
            .to_str()
            .ok_or_else(|| anyhow!("invalid script path"))?
            .to_string()],
    })
}

fn determine_working_dir(app: &AppHandle, root: &Path) -> Result<PathBuf> {
    if let Ok(dir) = app.path().app_data_dir() {
        if dir.exists() {
            return Ok(dir);
        }
    }
    Ok(root.to_path_buf())
}

pub fn default_python_binary() -> String {
    if cfg!(target_os = "windows") {
        "python.exe".to_string()
    } else {
        "python3".to_string()
    }
}

async fn pump_stdout(mut stdout: ChildStdout, manager: PythonManager, app: AppHandle) -> Result<()> {
    let mut reader = BufReader::new(&mut stdout).lines();
    while let Some(line) = reader.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => {
                if is_ready_signal(&value) {
                    if let Err(err) = manager.mark_ready().await {
                        eprintln!("[python] failed to mark ready: {err:?}");
                    }
                }
                if let Err(err) = app.emit("python-message", value.clone()) {
                    eprintln!("[python] failed to emit message: {err:?}");
                }
                handle_special_responses(&manager, &app, &value).await;
                manager.dispatch_message(value).await;
            }
            Err(_) => {
                eprintln!("[python] invalid JSON: {trimmed}");
            }
        }
    }
    Ok(())
}

async fn pump_stderr(mut stderr: ChildStderr, app: AppHandle) -> Result<()> {
    let mut reader = BufReader::new(&mut stderr).lines();
    while let Some(line) = reader.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        eprintln!("[python][stderr] {trimmed}");
        let payload = serde_json::json!({
            "type": "log",
            "level": "error",
            "message": trimmed,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        let _ = app.emit("python-message", payload);
    }
    Ok(())
}

fn is_ready_signal(value: &Value) -> bool {
    if !value.is_object() {
        return false;
    }
    match (value.get("type"), value.get("message")) {
        (Some(t), Some(message)) if t == "log" => {
            if let Some(text) = message.as_str() {
                return text.contains("Service started") || text.contains("waiting for commands");
            }
            false
        }
        _ => false,
    }
}

async fn handle_special_responses(_manager: &PythonManager, app: &AppHandle, value: &Value) {
    if let Some(resp_type) = value.get("type").and_then(|v| v.as_str()) {
        match resp_type {
            "conversation_summary" | "summary_result" | "optimization_result" => {
                if let Some(request_id) = value.get("request_id").and_then(|v| v.as_str()) {
                    let payload = value.clone();
                    let _ = app.emit(
                        &format!("python-response::{resp_type}::{request_id}"),
                        payload,
                    );
                }
            }
            _ => {}
        }
    }
}

impl PythonManager {
    async fn dispatch_message(&self, value: Value) {
        let handler = self.message_handler.lock().await.clone();
        (handler)(value);
    }
}

pub fn resolve_python_root(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("python");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src-tauri")
        .join("resources")
        .join("python")
}
