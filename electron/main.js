const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
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

// Python service state
let pythonProcess = null;
let pythonReady = false;
let pythonBuffer = '';
let pendingMessages = []; // queued outbound messages until ready
let isRecordingFlag = false;

// Config
const isPackaged = app.isPackaged;
const userDataPath = app.getPath('userData');
const configPath = isPackaged
  ? path.join(userDataPath, 'config.json')
  : path.join(__dirname, 'config.json');

let config = {
  openai_api_key: '',
  openai_base_url: '',
  // Transcription source: 'openai' | 'soniox' | 'qwen3-asr'
  transcribe_source: 'openai',
  // Soniox API key (used when transcribe_source === 'soniox')
  soniox_api_key: '',
  // Qwen3-ASR (DashScope) API key (used when transcribe_source === 'qwen3-asr')
  dashscope_api_key: '',
  enable_translation: true,
  translate_language: 'Chinese',
  translation_mode: 'fixed',
  smart_language1: 'Chinese',
  smart_language2: 'English',
  transcribe_language: 'auto',
  silence_rms_threshold: 0.010,
  min_silence_seconds: 1.0,
  theater_mode: false
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(data);
      config = { ...config, ...parsed };
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSettingsWindow() {
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
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
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
        // Flush any queued messages
        while (pendingMessages.length > 0) {
          const msg = pendingMessages.shift();
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
        const source = config.transcribe_source || 'openai';
        const oai = !!(config.openai_api_key && config.openai_api_key.trim());
        const sxi = !!(config.soniox_api_key && config.soniox_api_key.trim());
        const qwn = !!((config.dashscope_api_key || config.qwen_api_key) && (config.dashscope_api_key || config.qwen_api_key).trim());
        console.log('[Main] Python spawned. Sending initial config:', { source, openaiKeySet: oai, sonioxKeySet: sxi, qwenKeySet: qwn });
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
ipcMain.handle('open-settings', async () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle('open-media-transcribe', async () => {
  createMediaTranscribeWindow();
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
      const qwn = !!((config.dashscope_api_key || config.qwen_api_key) && (config.dashscope_api_key || config.qwen_api_key).trim());
      console.log('[Main] Config saved:', { source, openaiKeySet: oai, sonioxKeySet: sxi, qwenKeySet: qwn });
      if (pythonProcess) console.log('[Main] Restart the backend (Ctrl+R or app relaunch) to apply provider changes.');
    } catch {}
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
      source: config.transcribe_source || 'openai',
      openaiKeySet: !!(config.openai_api_key && config.openai_api_key.trim()),
      sonioxKeySet: !!(config.soniox_api_key && config.soniox_api_key.trim()),
      qwenKeySet: !!((config.dashscope_api_key || config.qwen_api_key) && (config.dashscope_api_key || config.qwen_api_key).trim()),
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

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await stopPythonService(true);
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopPythonService(true);
});
