const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, globalShortcut, Tray, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Windows-specific: avoid creating multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Global windows
let mainWindow = null;
let settingsWindow = null;
let mediaTranscribeWindow = null;
let voiceInputWindow = null;
let tray = null;
let isQuitting = false;

// Python service state
let pythonProcess = null;
let pythonReady = false;
let pythonBuffer = '';
let pendingMessages = []; // queued outbound messages until ready
let isRecordingFlag = false;
let isVoiceInputRecording = false;
let pendingVoiceInsert = new Map();
let voiceInsertAwaiting = false; // set true after stop pressed; insert on next final pieces
let lastVoiceTranscription = '';
let lastVoiceResultId = null;

// Config
const isPackaged = app.isPackaged;
const userDataPath = app.getPath('userData');
const configPath = isPackaged
  ? path.join(userDataPath, 'config.json')
  : path.join(__dirname, 'config.json');

const DEFAULT_GEMINI_TRANSLATE_PROMPT = [
  'You are a professional translation assistant.',
  'Translate user text into {{TARGET_LANGUAGE}}.',
  'Requirements:',
  '1) Preserve the tone and intent of the original text.',
  '2) Provide natural and fluent translations.',
  '3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.',
  '4) Respond with the translation only without additional commentary.'
].join('\n');

let config = {
  openai_api_key: '',
  openai_base_url: '',
  openai_transcribe_model: 'gpt-4o-transcribe',
  openai_translate_model: 'gpt-4o-mini',
  gemini_api_key: '',
  gemini_translate_model: 'gemini-2.0-flash',
  gemini_translate_system_prompt: DEFAULT_GEMINI_TRANSLATE_PROMPT,
  // Engines
  // recognition_engine: 'openai' | 'soniox'
  recognition_engine: 'openai',
  // translation_engine: 'openai' | 'gemini'
  translation_engine: 'openai',
  // Legacy compatibility for older builds
  transcribe_source: 'openai',
  // Soniox API key (used when transcribe_source === 'soniox')
  soniox_api_key: '',
  // Qwen3-ASR (DashScope)
  dashscope_api_key: '',
  qwen3_asr_model: 'qwen3-asr-flash',
  enable_translation: true,
  translate_language: 'Chinese',
  translation_mode: 'fixed',
  smart_language1: 'Chinese',
  smart_language2: 'English',
  transcribe_language: 'auto',
  silence_rms_threshold: 0.010,
  min_silence_seconds: 1.0,
  theater_mode: false,
  app_language: 'en',
  // Voice input defaults
  voice_input_enabled: false,
  voice_input_hotkey: 'F3',
  // Global toggle only: press to start, press again to stop
  voice_input_engine: 'openai',
  voice_input_language: 'auto',
  voice_input_translate: false,
  voice_input_translate_language: 'Chinese'
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(data);
      config = { ...config, ...parsed };
      if (!config.gemini_translate_model) {
        config.gemini_translate_model = 'gemini-2.0-flash';
      }
      if (!config.gemini_translate_system_prompt || !String(config.gemini_translate_system_prompt).trim()) {
        config.gemini_translate_system_prompt = DEFAULT_GEMINI_TRANSLATE_PROMPT;
      }
      // Backfill legacy -> new keys if needed
      if (!config.app_language) {
        config.app_language = 'en';
      }
      if (!config.recognition_engine && config.transcribe_source) {
        config.recognition_engine = config.transcribe_source;
      }
      if (!config.transcribe_source && config.recognition_engine) {
        config.transcribe_source = config.recognition_engine;
      }
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function saveConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// Global hotkey: toggle start/stop (only mode retained)
let lastVoiceHotkeyAt = 0; // simple debounce to avoid accidental double-fire
let lastVoiceStopAt = 0;   // small guard after stop to prevent bounce
function registerVoiceInputShortcut() {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  if (!config.voice_input_enabled) return;
  const acc = String(config.voice_input_hotkey || 'F3').trim();
  if (!acc) return;
  const ok = globalShortcut.register(acc, () => {
    const now = Date.now();
    if (now - lastVoiceHotkeyAt < 500) {
      // Ignore repeated callbacks within 500ms
      return;
    }
    lastVoiceHotkeyAt = now;
    console.log('[VoiceHotkey] pressed', acc, '(toggle)');
    if (!isVoiceInputRecording) handleVoiceHotkeyDown(); else handleVoiceHotkeyUp();
  });
  console.log('[VoiceHotkey] register', acc, ok ? 'OK' : 'FAILED');
}

// Hold mode (app focused only): detect keydown/keyup via before-input-event
// (Hold mode removed)

function handleVoiceHotkeyDown() {
  if (isVoiceInputRecording) return;
  const now = Date.now();
  if (now - lastVoiceStopAt < 200) {
    console.log('[VoiceHotkey] ignore start (debounce after stop)');
    return;
  }
  isVoiceInputRecording = true;
  // Clear any pending insertion state from previous session
  try { pendingVoiceInsert.clear(); } catch {}
  voiceInsertAwaiting = false;
  lastVoiceTranscription = '';
  lastVoiceResultId = null;
  try { loadConfig(); } catch {}
  if (!pythonProcess) {
    console.log('[VoiceHotkey] backend not running, starting...');
    startPythonService();
  }
  let voiceEngine = config.voice_input_engine || config.recognition_engine || config.transcribe_source || 'openai';
  const voiceLang = config.voice_input_language || 'auto';
  const wantTranslate = !!config.voice_input_translate;
  const translateLang = config.voice_input_translate_language || config.translate_language || 'Chinese';
  console.log('[VoiceHotkey] starting voice input:', { voiceEngine, voiceLang, wantTranslate, translateLang });
  // Push latest config before starting
  sendToPython({ type: 'update_config', force: true, config });
  const ok = sendToPython({
    type: 'start_voice_input',
    override_source: voiceEngine,
    transcribe_language: voiceLang,
    translate: wantTranslate,
    translate_language: translateLang
  });
  if (!ok) {
    console.warn('[VoiceHotkey] start_voice_input not sent (backend not ready yet). It will be queued if backend starts.');
  }
  try { updateTrayMenu(); } catch {}
}

function handleVoiceHotkeyUp() {
  if (!isVoiceInputRecording) return;
  isVoiceInputRecording = false;
  lastVoiceStopAt = Date.now();
  voiceInsertAwaiting = true;
  console.log('[VoiceInsert] stop pressed; will insert after final result. bufferedTranscriptionLen=', (lastVoiceTranscription||'').length);
  const ok = sendToPython({ type: 'stop_voice_input' });
  if (!ok) console.warn('[VoiceHotkey] stop_voice_input not sent (backend not ready)');
  try { updateTrayMenu(); } catch {}
}

function insertTextAtCursor(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  clipboard.writeText(text);
  if (process.platform === 'win32') {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"], { stdio: 'ignore' });
    ps.on('error', () => {});
  }
  console.log('[VoiceInsert] inserted text:', text.length > 60 ? (text.slice(0,60)+'...') : text);
  return true;
}

// Window creators
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 关闭按钮最小化到托盘
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      try { mainWindow.setSkipTaskbar(true); } catch {}
      try { updateTrayMenu(); } catch {}
      return;
    }
  });

  mainWindow.on('show', () => {
    try { mainWindow.setSkipTaskbar(false); } catch {}
    try { updateTrayMenu(); } catch {}
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSettingsWindow(section) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 720,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  if (section) {
    try {
      settingsWindow.loadFile(path.join(__dirname, 'settings.html'), { hash: String(section) });
    } catch (_) {
      settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    }
  } else {
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  }
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createMediaTranscribeWindow() {
  if (mediaTranscribeWindow && !mediaTranscribeWindow.isDestroyed()) {
    mediaTranscribeWindow.focus();
    return;
  }
  mediaTranscribeWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mediaTranscribeWindow.loadFile(path.join(__dirname, 'media-transcribe.html'));
  mediaTranscribeWindow.on('closed', () => {
    mediaTranscribeWindow = null;
  });
}

function createVoiceInputWindow() {
  if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
    voiceInputWindow.focus();
    return;
  }
  voiceInputWindow = new BrowserWindow({
    width: 720,
    height: 640,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  voiceInputWindow.loadFile(path.join(__dirname, 'voice-input.html'));
  voiceInputWindow.on('closed', () => {
    voiceInputWindow = null;
  });
}

// Python service management
function resolveTranscribeServicePath() {
  // Prefer compiled exe; fall back to configured python + script in dev
  const exeCandidates = [];
  if (isPackaged) {
    exeCandidates.push(path.join(process.resourcesPath, 'python', 'transcribe_service.exe'));
  } else {
    exeCandidates.push(path.join(__dirname, 'dist-python', 'win', 'transcribe_service.exe'));
    exeCandidates.push(path.join(__dirname, 'dist', 'transcribe_service.exe'));
  }
  for (const candidate of exeCandidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, args: [], useSystemPython: false };
    }
  }

  if (!isPackaged) {
    const scriptPath = path.join(__dirname, 'transcribe_service.py');
    const py = config.python_path;
    if (fs.existsSync(scriptPath) && py && fs.existsSync(py)) {
      return { command: py, args: [scriptPath], useSystemPython: true };
    }
  }
  return null;
}

function processPythonStdout(data) {
  const str = data.toString('utf8');
  pythonBuffer += str;

  // Extract complete JSON objects using brace counting
  const messages = [];
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let current = '';

  for (let i = 0; i < pythonBuffer.length; i++) {
    const ch = pythonBuffer[i];
    current += ch;
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') braceCount++;
      else if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
          messages.push(current.trim());
          current = '';
        }
      }
    }
  }

  pythonBuffer = current; // keep incomplete tail

  for (const m of messages) {
    if (!m) continue;
    try {
      const obj = JSON.parse(m);

      // Mark service ready on startup logs
      if (
        obj && obj.type === 'log' &&
        (String(obj.message || '').includes('Service started') ||
         String(obj.message || '').includes('waiting for commands'))
      ) {
        pythonReady = true;
        // Flush any queued messages with state-aware filtering
        while (pendingMessages.length > 0) {
          const msg = pendingMessages.shift();
          if (!msg || !msg.type) continue;
          if (msg.type === 'start_voice_input' && !isVoiceInputRecording) {
            console.log('[Main->Py] drop queued start_voice_input (not recording anymore)');
            continue;
          }
          if (msg.type === 'stop_voice_input' && isVoiceInputRecording === false) {
            console.log('[Main->Py] drop queued stop_voice_input (already stopped)');
            continue;
          }
          sendToPythonDirect(msg);
        }
      }

      // Mirror important logs to terminal for easier debugging
      if (obj && obj.type === 'log') {
        const lvl = String(obj.level || '').toLowerCase();
        const msg = String(obj.message || '');
        if (lvl === 'error') console.error('[PY]', msg);
        else if (lvl === 'warning' || lvl === 'warn') console.warn('[PY]', msg);
        else if (lvl === 'info') console.log('[PY]', msg);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-message', obj);
      }
      // Voice input insertion handler
      try { maybeHandleVoiceInputInsertion(obj); } catch {}
      // Extra terminal status for voice input context
      try {
        if (obj && obj.context === 'voice_input') {
          if (obj.type === 'log') console.log('[VoiceInput][PY-LOG]', obj.level, obj.message);
          if (obj.type === 'transcription_update') console.log('[VoiceInput] transcription:', (obj.transcription||'').slice(0,80));
          if (obj.type === 'translation_update') console.log('[VoiceInput] translation:', (obj.translation||'').slice(0,80));
          if (obj.type === 'recording_error') console.error('[VoiceInput] recording_error:', obj.message);
        }
      } catch {}
    } catch (e) {
      // Non-JSON or parse error; ignore
    }
  }
}

function startPythonService() {
  // Reset state
  pythonReady = false;
  pythonBuffer = '';
  pendingMessages = [];

  const resolved = resolveTranscribeServicePath();
  if (!resolved) {
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: 'No runnable Python service found. Build EXE or configure python_path.',
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  const { command, args } = resolved;

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8'
  };
  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
    env.ELECTRON_DEBUG = '1';
  }

  try {
    const cwd = isPackaged ? userDataPath : __dirname;
    pythonProcess = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env });

    pythonProcess.stdout.on('data', processPythonStdout);
    pythonProcess.stderr.on('data', (data) => {
      const errStr = data.toString('utf8');
      try { console.error('[PY-STDERR]', errStr.trim()); } catch {}
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python stderr: ${errStr.trim()}`,
          timestamp: new Date().toISOString()
        });
      }
    });
    pythonProcess.on('spawn', () => {
      // Send initial config immediately on spawn
      try {
        const source = config.recognition_engine || config.transcribe_source || 'openai';
        const oai = !!(config.openai_api_key && config.openai_api_key.trim());
        const sxi = !!(config.soniox_api_key && config.soniox_api_key.trim());
      const dsc = !!(config.dashscope_api_key && config.dashscope_api_key.trim());
      console.log('[Main] Python spawned. Sending initial config:', { source, openaiKeySet: oai, sonioxKeySet: sxi, dashscopeKeySet: dsc });
      } catch {}
      sendToPythonDirect({ type: 'update_config', config });
    });
    pythonProcess.on('error', (err) => {
      pythonReady = false;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python process failed to start: ${err.message}`,
          timestamp: new Date().toISOString()
        });
      }
    });
    pythonProcess.on('close', (code, signal) => {
      pythonReady = false;
      pythonProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'warning',
          message: `Transcription service exited (code: ${code}, signal: ${signal})`,
          timestamp: new Date().toISOString()
        });
      }
    });
    return true;
  } catch (err) {
    pythonReady = false;
    pythonProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: `Failed to start transcription service: ${err.message}`,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
}

function sendToPythonDirect(message) {
  try {
    if (!pythonProcess || !pythonProcess.stdin) return false;
    try {
      if (message && message.type) {
        console.log('[Main->Py]', message.type);
      }
    } catch {}
    pythonProcess.stdin.write(JSON.stringify(message) + '\n', 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

function sendToPython(message) {
  if (!pythonProcess) {
    return false;
  }
  if (!pythonReady) {
    pendingMessages.push(message);
    return true;
  }
  return sendToPythonDirect(message);
}

async function stopPythonService(graceful = true) {
  return new Promise((resolve) => {
    if (!pythonProcess) return resolve(true);

    const proc = pythonProcess;
    const done = () => resolve(true);

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
    }, 2500);

    proc.once('close', () => {
      clearTimeout(timeout);
      done();
    });

    try {
      if (graceful) {
        sendToPythonDirect({ type: 'shutdown' });
      } else {
        proc.kill();
      }
    } catch (_) {
      try { proc.kill(); } catch (__) {}
    }
  });
}

// IPC Handlers - app/windows
ipcMain.handle('open-settings', async (_event, section) => {
  createSettingsWindow(section);
  return true;
});

ipcMain.handle('open-media-transcribe', async () => {
  createMediaTranscribeWindow();
  return true;
});

ipcMain.handle('open-voice-input-settings', async () => {
  createVoiceInputWindow();
  return true;
});

// IPC Handlers - config
ipcMain.handle('get-config', async () => {
  return config;
});

ipcMain.handle('save-config', async (_event, newConfig) => {
  try {
    config = { ...config, ...(newConfig || {}) };
    saveConfig();
    try {
      const source = config.transcribe_source || 'openai';
      const oai = !!(config.openai_api_key && config.openai_api_key.trim());
      const sxi = !!(config.soniox_api_key && config.soniox_api_key.trim());
      const gem = !!(config.gemini_api_key && config.gemini_api_key.trim());
      console.log('[Main] Config saved:', { source, openaiKeySet: oai, sonioxKeySet: sxi, geminiKeySet: gem });
      if (pythonProcess) console.log('[Main] Restart the backend (Ctrl+R or app relaunch) to apply provider changes.');
    } catch {}
    try { registerVoiceInputShortcut(); } catch {}
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// IPC Handlers - service status
ipcMain.handle('get-service-status', async () => {
  return { running: !!pythonProcess, ready: !!pythonReady };
});

ipcMain.handle('restart-python-service', async () => {
  await stopPythonService(true);
  const ok = startPythonService();
  return { success: ok };
});

// IPC Handlers - recording
ipcMain.handle('start-recording', async () => {
  if (!pythonProcess) {
    startPythonService();
  }
  // Reload config from disk before starting and push to backend
  try {
    loadConfig();
    console.log('[Main] Reloaded config before start:', {
      source: config.recognition_engine || config.transcribe_source || 'openai',
      openaiKeySet: !!(config.openai_api_key && config.openai_api_key.trim()),
      sonioxKeySet: !!(config.soniox_api_key && config.soniox_api_key.trim()),
      dashscopeKeySet: !!(config.dashscope_api_key && config.dashscope_api_key.trim()),
    });
    sendToPython({ type: 'update_config', force: true, config });
  } catch (e) {
    console.warn('[Main] Failed to reload config before start:', e && e.message);
  }
  const ok = sendToPython({ type: 'start_recording' });
  if (ok) isRecordingFlag = true;
  return ok;
});

ipcMain.handle('stop-recording', async () => {
  const ok = sendToPython({ type: 'stop_recording' });
  if (ok) isRecordingFlag = false;
  return ok;
});

// Optional explicit voice-input control from renderer
ipcMain.handle('start-voice-input', async () => {
  handleVoiceHotkeyDown();
  return true;
});
ipcMain.handle('stop-voice-input', async () => {
  handleVoiceHotkeyUp();
  return true;
});

// IPC Handlers - audio devices (stub)
ipcMain.handle('get-devices', async () => {
  // No direct device enumeration in main; return empty list for now
  return [];
});
ipcMain.handle('set-device', async (_event, _deviceId) => {
  // Not implemented in backend; accept and store if needed
  return { success: true };
});

// IPC Handlers - python path test
ipcMain.handle('test-python', async (_event, pythonPath) => {
  return new Promise((resolve) => {
    try {
      const test = spawn(pythonPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      test.stdout.on('data', d => { out += d.toString('utf8'); });
      test.stderr.on('data', d => { err += d.toString('utf8'); });
      test.on('close', (code) => {
        if (code === 0) resolve({ success: true, version: (out || err).trim() });
        else resolve({ success: false, error: (out || err).trim() });
      });
      test.on('error', (e) => resolve({ success: false, error: e.message }));
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

// IPC Handlers - media transcription helpers
ipcMain.handle('select-media-file', async () => {
  const win = mediaTranscribeWindow || mainWindow;
  if (!win) return { canceled: true };
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Media File',
    properties: ['openFile'],
    filters: [
      { name: 'Audio/Video', extensions: ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm', 'm4v'] }
    ]
  });
  return result;
});

ipcMain.handle('select-output-path', async (_event, { baseName } = {}) => {
  const win = mediaTranscribeWindow || mainWindow;
  if (!win) return { canceled: true };
  const defaultName = (baseName ? baseName.replace(/\.[^/.]+$/, '') : 'output') + '.txt';
  const result = await dialog.showSaveDialog(win, {
    title: 'Select Output Path',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  return result;
});

function resolveMediaExe() {
  const exeCandidates = [];
  if (isPackaged) {
    exeCandidates.push(path.join(process.resourcesPath, 'python', 'media_transcribe.exe'));
  } else {
    exeCandidates.push(path.join(__dirname, 'dist-python', 'win', 'media_transcribe.exe'));
    exeCandidates.push(path.join(__dirname, 'dist', 'media_transcribe.exe'));
  }
  for (const c of exeCandidates) {
    if (fs.existsSync(c)) return { command: c, args: [], useSystemPython: false };
  }
  if (!isPackaged) {
    const script = path.join(__dirname, 'media_transcribe.py');
    const py = config.python_path;
    if (fs.existsSync(script) && py && fs.existsSync(py)) {
      return { command: py, args: [script], useSystemPython: true };
    }
  }
  return null;
}

function parseExportTxtToResults(txtContent) {
  // Parse the exported TXT back into a results array [{transcription, translation}]
  const lines = txtContent.split(/\r?\n/);
  const results = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Detect segment header (non-digits followed by number colon), e.g., "Segment 1:" or localized variant
    if (/^\D+\s+\d+:$/.test(line)) {
      if (current) results.push(current);
      current = { transcription: '', translation: '' };
      continue;
    }
    // For subsequent lines within a segment, treat first colon-separated value as content
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const value = line.slice(idx + 1).trim();
      if (current) {
        if (!current.transcription) current.transcription = value;
        else if (!current.translation) current.translation = value;
      }
    }
  }
  if (current) results.push(current);
  return results.filter(r => r && r.transcription);
}

ipcMain.handle('process-media-file', async (_event, { filePath, settings }) => {
  const win = mediaTranscribeWindow || mainWindow;
  if (!win) return { success: false, error: 'No active window' };
  try {
    const resolved = resolveMediaExe();
    if (!resolved) return { success: false, error: 'No runnable media_transcribe found' };

    const outPath = settings && settings.outputPath ? settings.outputPath : path.join(app.getPath('documents'), 'transcribe.txt');
    const args = [];
    // Build CLI args
    if (resolved.useSystemPython) {
      // When running script with python, the first arg (script) is in resolved.args
    }
    args.push(...resolved.args);
    args.push('--file', filePath);
    args.push('--output', outPath);
    const source = (config && (config.recognition_engine || config.transcribe_source)) || 'openai';
    if (source) {
      args.push('--source', String(source));
    }
    if (settings && settings.enableTranslation) args.push('--translate');
    if (settings && settings.targetLanguage) {
      args.push('--language', settings.targetLanguage);
    }
    if (settings && settings.theaterMode) args.push('--theater-mode');

  const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' };
  const cwd = isPackaged ? userDataPath : __dirname;

  const child = spawn(resolved.command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env });

  let stdoutBuf = '';
  child.stdout.on('data', (data) => {
    stdoutBuf += data.toString('utf8');
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (text.startsWith('Progress: ')) {
        const msg = text.replace(/^Progress:\s*/, '');
        win.webContents.send('media-progress', { type: 'progress', message: msg });
      } else if (text.startsWith('Processing completed')) {
        win.webContents.send('media-progress', { type: 'complete' });
      } else if (text.startsWith('Error:')) {
        win.webContents.send('media-progress', { type: 'error', message: text });
      } else if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
        try { console.log('[media]', text); } catch {}
      }
    }
  });
    child.stderr.on('data', (data) => {
      const errLine = data.toString('utf8').trim();
      if (errLine) win.webContents.send('media-progress', { type: 'error', message: errLine });
    });

    return await new Promise((resolve) => {
      child.on('close', async (code) => {
        if (code === 0) {
          // Parse the exported TXT to populate UI results
          try {
            const content = fs.readFileSync(outPath, 'utf8');
            const results = parseExportTxtToResults(content);
            for (const r of results) {
              win.webContents.send('media-progress', { type: 'result', transcription: r.transcription, translation: r.translation });
            }
            win.webContents.send('media-progress', { type: 'complete' });
          } catch (e) {
            // Ignore parse errors
          }
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `media_transcribe exited with code ${code}` });
        }
      });
      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

ipcMain.handle('export-results', async (_event, { results, outputPath }) => {
  try {
    if (!Array.isArray(results) || !results.length) {
      // If empty, still return success if output file already exists
      if (outputPath && fs.existsSync(outputPath)) return { success: true, exportPath: outputPath };
      return { success: false, error: 'No results to export' };
    }
    const lines = [];
    lines.push('Transcription & Translation Results');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('==================================================');
    lines.push('');
    results.forEach((r, i) => {
      lines.push(`Segment ${i + 1}:`);
      lines.push(`Transcription: ${r.transcription || ''}`);
      if (r.translation) lines.push(`Translation: ${r.translation}`);
      lines.push('');
    });
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
    return { success: true, exportPath: outputPath };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// App lifecycle
function setupAppMenu() {
  // Minimal menu to keep default shortcuts working; can be customized later
  const template = [
    {
      label: 'App',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  setupAppMenu();
  startPythonService();
  // Register global shortcut (toggle)
  registerVoiceInputShortcut();
  // Hold mode removed; global toggle works regardless of focus
  // Create tray icon for background mode
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 保持后台驻留：不因窗口全关而退出
app.on('window-all-closed', async () => {
  // no-op: keep running in tray
});

app.on('before-quit', async () => {
  isQuitting = true;
  await stopPythonService(true);
  try { globalShortcut.unregisterAll(); } catch {}
});

// Handle voice input insertion based on backend messages
function maybeHandleVoiceInputInsertion(obj) {
  try {
    if (!obj || obj.context !== 'voice_input') return;
    const translateOn = !!config.voice_input_translate;
    // Always keep latest transcription for fallback
    if (obj.type === 'transcription_update') {
      if (typeof obj.transcription === 'string' && obj.transcription.trim()) {
        lastVoiceTranscription = obj.transcription.trim();
        if (obj.result_id) lastVoiceResultId = obj.result_id;
        console.log('[VoiceInsert] transcription_update received. len=', lastVoiceTranscription.length, 'awaiting=', voiceInsertAwaiting);
      }
    }

    // Only insert after the user has stopped recording (toggle end)
    if (isVoiceInputRecording) return;

    if (obj.type === 'result') {
      const t = (typeof obj.transcription === 'string') ? obj.transcription.trim() : '';
      if (!translateOn) {
        if (t) {
          console.log('[VoiceInsert] inserting transcription from result. len=', t.length);
          insertTextAtCursor(t);
          voiceInsertAwaiting = false;
        } else {
          console.log('[VoiceInsert] result has no transcription; will fallback to buffered transcription if available. len=', (lastVoiceTranscription||'').length);
          if (lastVoiceTranscription) {
            insertTextAtCursor(lastVoiceTranscription);
            voiceInsertAwaiting = false;
          }
        }
      } else if (obj.result_id) {
        pendingVoiceInsert.set(obj.result_id, { wantTranslation: true });
        console.log('[VoiceInsert] result received; waiting translation for result_id=', obj.result_id);
      }
    } else if (obj.type === 'translation_update') {
      const text = (typeof obj.translation === 'string') ? obj.translation.trim() : '';
      const hasPending = obj.result_id && pendingVoiceInsert.has(obj.result_id);
      // In voice_input simple mode, backend does not emit 'result'; accept translation directly after stop
      if (translateOn && voiceInsertAwaiting && text) {
        console.log('[VoiceInsert] inserting translation (direct post-stop). result_id=', obj.result_id || '(none)', ' len=', text.length);
        insertTextAtCursor(text);
        if (obj.result_id) pendingVoiceInsert.delete(obj.result_id);
        voiceInsertAwaiting = false;
      } else if (hasPending) {
        const info = pendingVoiceInsert.get(obj.result_id);
        if (info && info.wantTranslation && text) {
          console.log('[VoiceInsert] inserting translation for result_id=', obj.result_id, ' len=', text.length);
          insertTextAtCursor(text);
          pendingVoiceInsert.delete(obj.result_id);
          voiceInsertAwaiting = false;
        }
      }
    } else if (obj.type === 'transcription_update') {
      // If no translation requested, and we are awaiting insert, use the first update after stop as final
      if (!translateOn && voiceInsertAwaiting && lastVoiceTranscription) {
        console.log('[VoiceInsert] inserting transcription from update (post-stop). len=', lastVoiceTranscription.length);
        insertTextAtCursor(lastVoiceTranscription);
        voiceInsertAwaiting = false;
      }
    } else if (obj.type === 'recording_stopped') {
      // Fallback: if stop occurred and we never got a post-stop update, insert buffered transcription
      if (!translateOn && voiceInsertAwaiting && lastVoiceTranscription) {
        console.log('[VoiceInsert] inserting transcription on recording_stopped fallback. len=', lastVoiceTranscription.length);
        insertTextAtCursor(lastVoiceTranscription);
        voiceInsertAwaiting = false;
      } else if (translateOn && voiceInsertAwaiting) {
        console.log('[VoiceInsert] waiting for translation after recording_stopped; pending ids=', pendingVoiceInsert.size);
      }
      try { isRecordingFlag = false; updateTrayMenu(); } catch {}
    }
  } catch (e) {
    try { console.warn('[VoiceInsert] error:', e && e.message); } catch {}
  }
}

// 托盘与后台驻留
function resolveTrayIconPath() {
  // 优先使用 .ico（Windows），其他平台用 .png
  const ico = path.join(__dirname, 'assets', 'icons', 'icon.ico');
  const png = path.join(__dirname, 'assets', 'icons', 'icon.png');
  try {
    if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
    if (fs.existsSync(png)) return png;
    if (fs.existsSync(ico)) return ico;
  } catch {}
  // 打包后可能位于 resourcesPath 下（需根据实际打包配置调整）
  try {
    const pIco = path.join(process.resourcesPath || '', 'assets', 'icons', 'icon.ico');
    const pPng = path.join(process.resourcesPath || '', 'assets', 'icons', 'icon.png');
    if (process.platform === 'win32' && fs.existsSync(pIco)) return pIco;
    if (fs.existsSync(pPng)) return pPng;
    if (fs.existsSync(pIco)) return pIco;
  } catch {}
  return null;
}

function getTrayMenuTemplate() {
  const hasWindow = !!(mainWindow && !mainWindow.isDestroyed());
  const isShown = hasWindow && mainWindow.isVisible();
  const items = [];
  items.push({
    label: isShown ? '隐藏主界面' : '显示主界面',
    click: () => {
      if (!mainWindow) {
        createMainWindow();
      } else {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
          try { mainWindow.setSkipTaskbar(true); } catch {}
        } else {
          mainWindow.show();
          try { mainWindow.setSkipTaskbar(false); } catch {}
        }
      }
      try { updateTrayMenu(); } catch {}
    }
  });

  items.push({ type: 'separator' });

  // 录音切换
  items.push({
    label: isRecordingFlag ? '⏹️ 停止录音' : '🎤 开始录音',
    click: async () => {
      if (isRecordingFlag) {
        try { sendToPython({ type: 'stop_recording' }); isRecordingFlag = false; } catch {}
        try { updateTrayMenu(); } catch {}
      } else {
        try {
          if (!pythonProcess) startPythonService();
          try { loadConfig(); sendToPython({ type: 'update_config', force: true, config }); } catch {}
          const ok = sendToPython({ type: 'start_recording' });
          if (ok) isRecordingFlag = true;
        } catch {}
        try { updateTrayMenu(); } catch {}
      }
    }
  });

  // 语音输入切换（全局热键外的托盘开关）
  items.push({
    label: isVoiceInputRecording ? '🛑 停止语音输入' : '🎙️ 开始语音输入',
    click: () => {
      if (isVoiceInputRecording) handleVoiceHotkeyUp(); else handleVoiceHotkeyDown();
      try { updateTrayMenu(); } catch {}
    }
  });

  items.push({ type: 'separator' });

  items.push({
    label: '设置...',
    click: () => createSettingsWindow()
  });
  items.push({
    label: '媒体转写...',
    click: () => createMediaTranscribeWindow()
  });

  items.push({ type: 'separator' });

  items.push({
    label: '退出',
    click: async () => {
      isQuitting = true;
      try { if (tray && tray.destroy) tray.destroy(); } catch {}
      try { await stopPythonService(true); } catch {}
      try { globalShortcut.unregisterAll(); } catch {}
      app.quit();
    }
  });

  return items;
}

function updateTrayMenu() {
  if (!tray) return;
  try {
    const template = getTrayMenuTemplate();
    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);
    const tip = isVoiceInputRecording
      ? '语音输入中（再次按快捷键或托盘停止）'
      : (isRecordingFlag ? '录音中' : '语音转写');
    tray.setToolTip(tip);
  } catch (e) {
    try { console.warn('[Tray] update failed:', e && e.message); } catch {}
  }
}

function createTray() {
  try {
    const iconPath = resolveTrayIconPath();
    const image = iconPath ? nativeImage.createFromPath(iconPath) : null;
    tray = new Tray(image || undefined);
    tray.setToolTip('语音转写');
    tray.on('click', () => {
      // 单击切换显示/隐藏
      if (!mainWindow) {
        createMainWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
        try { mainWindow.setSkipTaskbar(true); } catch {}
      } else {
        mainWindow.show();
        try { mainWindow.setSkipTaskbar(false); } catch {}
      }
      updateTrayMenu();
    });
    updateTrayMenu();
  } catch (e) {
    try { console.warn('[Tray] create failed:', e && e.message); } catch {}
  }
}
