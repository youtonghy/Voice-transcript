const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let settingsWindow;
let mediaTranscribeWindow;
// Python杩涚▼绠＄悊
let pythonProcess;
let mediaTranscribeProcess;
let pythonBuffer = ''; // 鐢ㄤ簬缂撳瓨涓嶅畬鏁寸殑JSON娑堟伅
let pythonReady = false;
let pendingMessages = []; // 缂撳瓨寰呭彂閫佺殑娑堟伅
let restartingPython = false; // 闃叉閲嶅閲嶅惎
let restartAfterUserStopPending = false; // 鐢ㄦ埛鎵嬪姩鍋滄褰曢煶鍚庡緟閲嶅惎鏍囪
let config = {
  openai_api_key: '',
  openai_base_url: '',
  enable_translation: true,
  translate_language: '涓枃',
  theater_mode: false
};

// 閰嶇疆鏂囦欢璺緞锛氬紑鍙戠幆澧冧娇鐢ㄩ」鐩洰褰曪紱鎵撳寘鍚庝娇鐢ㄧ敤鎴风洰褰?const isPackaged = app.isPackaged;
const userDataPath = app.getPath('userData');
const configPath = isPackaged
  ? path.join(userDataPath, 'config.json')
  : path.join(__dirname, 'config.json');

// 鍔犺浇閰嶇疆
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = { ...config, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('鍔犺浇閰嶇疆澶辫触:', error);
  }
}

// 淇濆瓨閰嶇疆
function saveConfig() {
  try {
    // 纭繚鐩綍瀛樺湪锛堟墦鍖呯幆澧冧笅鍦ㄧ敤鎴锋暟鎹洰褰曪級
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('淇濆瓨閰嶇疆澶辫触:', error);
  }
}

// 澶勭悊Python杩涚▼杈撳嚭鐨勫嚱鏁?function processPythonOutput(data) {
  const dataStr = data.toString('utf8');
  console.log('Python鍘熷杈撳嚭:', dataStr);
  
  // 灏嗘柊鏁版嵁娣诲姞鍒扮紦鍐插尯
  pythonBuffer += dataStr;
  
  // 灏濊瘯鎻愬彇瀹屾暣鐨凧SON娑堟伅
  const messages = [];
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let currentMessage = '';
  
  for (let i = 0; i < pythonBuffer.length; i++) {
    const char = pythonBuffer[i];
    currentMessage += char;
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          // 鎵惧埌瀹屾暣鐨凧SON娑堟伅
          messages.push(currentMessage.trim());
          currentMessage = '';
        }
      }
    }
  }
  
  // 鏇存柊缂撳啿鍖猴紝淇濈暀鏈畬鎴愮殑娑堟伅
  pythonBuffer = currentMessage;
  
  // 澶勭悊鎻愬彇鍑虹殑瀹屾暣娑堟伅
  messages.forEach(messageStr => {
    if (messageStr) {
      try {
        const message = JSON.parse(messageStr);
        console.log('瑙ｆ瀽鐨凱ython娑堟伅:', message);
        
        // 妫€鏌ユ槸鍚︽槸鍚姩瀹屾垚娑堟伅
        if (message.type === 'log' && message.message === '杞啓鏈嶅姟宸插惎鍔紝绛夊緟鍛戒护...') {
          pythonReady = true;
          console.log('Python鏈嶅姟宸插氨缁紝澶勭悊寰呭彂閫佹秷鎭?);
          
          // 鍙戦€佹墍鏈夊緟鍙戦€佺殑娑堟伅
          while (pendingMessages.length > 0) {
            const pendingMessage = pendingMessages.shift();
            sendToPythonDirect(pendingMessage);
          }
        }
        
        if (mainWindow) {
          mainWindow.webContents.send('python-message', message);
        }

        // 妫€娴嬪綍闊冲仠姝簨浠讹紝鐢ㄤ簬鎸夐渶閲嶅惎鏈嶅姟
        if (message.type === 'recording_stopped') {
          console.log('妫€娴嬪埌褰曢煶宸插仠姝簨浠?);
          if (restartAfterUserStopPending) {
            console.log('鐢ㄦ埛璇锋眰鐨勫綍闊冲仠姝㈠悗閲嶅惎鏍囪涓虹湡锛屽紑濮嬩紭闆呴噸鍚?);
            restartAfterUserStopPending = false;
            restartPythonServiceAfterStop();
          }
        }
      } catch (error) {
        console.error('JSON瑙ｆ瀽澶辫触:', error);
        console.error('闂娑堟伅:', messageStr);
        
        // 鍙戦€佸師濮嬫秷鎭綔涓烘棩蹇?        if (mainWindow) {
          mainWindow.webContents.send('python-message', {
            type: 'log',
            level: 'warning',
            message: `Python杈撳嚭瑙ｆ瀽澶辫触: ${messageStr}`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  });
}

// 鐩存帴鍙戦€佹秷鎭埌Python锛堜笉妫€鏌ョ姸鎬侊級
function sendToPythonDirect(message) {
  try {
    const jsonMessage = JSON.stringify(message) + '\n';
    console.log('鐩存帴鍙戦€佸埌Python:', jsonMessage.trim());
    pythonProcess.stdin.write(jsonMessage);
    return true;
  } catch (error) {
    console.error('鐩存帴鍙戦€佹秷鎭け璐?', error);
    return false;
  }
}

function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, 'assets', 'icon.png'),
      title: '璇煶杞啓缈昏瘧宸ュ叿',
      show: false // 鍏堜笉鏄剧ず锛屽姞杞藉畬鎴愬悗鍐嶆樉绀?    });

    mainWindow.loadFile('index.html');

    // 绛夊緟椤甸潰鍑嗗灏辩华鍚庡啀鏄剧ず绐楀彛
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      console.log('绐楀彛宸叉樉绀?);
    });

    // 寮€鍙戞ā寮忎笅鎵撳紑寮€鍙戣€呭伐鍏?    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // 娣诲姞閿欒澶勭悊
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('椤甸潰鍔犺浇澶辫触:', errorCode, errorDescription);
    });

  } catch (error) {
    console.error('鍒涘缓绐楀彛鏃跺彂鐢熼敊璇?', error);
    app.quit();
  }
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '璁剧疆',
    resizable: false
  });

  settingsWindow.loadFile('settings.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createMediaTranscribeWindow() {
  if (mediaTranscribeWindow) {
    mediaTranscribeWindow.focus();
    return;
  }

  mediaTranscribeWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '濯掍綋鏂囦欢杞啓',
    resizable: true
  });

  mediaTranscribeWindow.loadFile('media-transcribe.html');

  mediaTranscribeWindow.on('closed', () => {
    mediaTranscribeWindow = null;
  });
}

function startPythonService() {
  console.log('startPythonService called');
  
  // 宸叉湁杩愯涓殑鏈嶅姟鍒欎笉閲嶅鍚姩锛屼繚鎸佸崟瀹炰緥
  if (pythonProcess) {
    console.log('妫€娴嬪埌宸叉湁杞啓鏈嶅姟杩涚▼锛岃烦杩囧惎鍔?);
    return true;
  }

  // 閲嶇疆鐘舵€?  pythonReady = false;
  pythonBuffer = '';
  pendingMessages = [];

  console.log('鍚姩杞啓鏈嶅姟...');
  const userCwd = isPackaged ? userDataPath : __dirname;
  
  // 浼樺厛瀵绘壘宸茬紪璇戠殑exe鏂囦欢
  let servicePath = null;
  let useSystemPython = false;
  
  // 鎸変紭鍏堢骇鎼滅储鍙墽琛屾枃浠?  const candidates = [];
  
  if (isPackaged) {
    // 鎵撳寘鍚庣幆澧冿細浠巖esources鐩綍鏌ユ壘
    candidates.push(path.join(process.resourcesPath, 'python', 'transcribe_service.exe'));
  } else {
    // 寮€鍙戠幆澧冿細浼樺厛浣跨敤宸茬紪璇戠殑exe
    candidates.push(path.join(__dirname, 'dist-python', 'win', 'transcribe_service.exe'));
    candidates.push(path.join(__dirname, 'dist', 'transcribe_service.exe'));
  }

  // 鏌ユ壘鍙敤鐨別xe鏂囦欢
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      servicePath = candidate;
      console.log('鎵惧埌杞啓鏈嶅姟鍙墽琛屾枃浠?', servicePath);
      break;
    }
  }

  // 濡傛灉娌℃湁鎵惧埌exe鏂囦欢锛屾墠鑰冭檻浣跨敤Python鑴氭湰锛堜粎鍦ㄥ紑鍙戞ā寮忎笅锛?  if (!servicePath && !isPackaged) {
    const pythonScript = path.join(__dirname, 'transcribe_service.py');
    if (fs.existsSync(pythonScript)) {
      // 鍙湁鍦ㄩ厤缃腑鏄庣‘鎸囧畾Python璺緞鏃舵墠浣跨敤鑴氭湰妯″紡
      const configPythonPath = config.python_path;
      if (configPythonPath) {
        servicePath = configPythonPath;
        useSystemPython = true;
        console.log('浣跨敤閰嶇疆鐨凱ython璺緞杩愯鑴氭湰:', configPythonPath, pythonScript);
      } else {
        console.warn('鏈壘鍒板彲鎵ц鏂囦欢锛屼笖鏈厤缃甈ython璺緞銆傝鍦ㄨ缃腑閰嶇疆Python璺緞鎴栬繍琛?npm run build:py:win 缂栬瘧鏈嶅姟銆?);
        if (mainWindow) {
          mainWindow.webContents.send('python-message', {
            type: 'log',
            level: 'error',
            message: '杞啓鏈嶅姟涓嶅彲鐢細鏈壘鍒板彲鎵ц鏂囦欢涓旀湭閰嶇疆Python璺緞銆傝鍦ㄨ缃腑閰嶇疆Python璺緞鎴栭噸鏂扮紪璇戞湇鍔°€?,
            timestamp: new Date().toISOString()
          });
        }
        return false;
      }
    }
  }

  if (!servicePath) {
    const errorMsg = '鏃犳硶鍚姩杞啓鏈嶅姟锛氭湭鎵惧埌鍙墽琛屾枃浠躲€傝杩愯 npm run build:py:win 缂栬瘧鏈嶅姟銆?;
    console.error(errorMsg);
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: errorMsg,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
  
  try {
    let spawnCmd, spawnArgs;
    
    if (useSystemPython) {
      spawnCmd = servicePath;
      spawnArgs = [path.join(__dirname, 'transcribe_service.py')];
    } else {
      spawnCmd = servicePath;
      spawnArgs = [];
    }
    
    console.log('鍚姩杞啓鏈嶅姟:', spawnCmd, spawnArgs);
    
    // 璁剧疆鐜鍙橀噺
    const processEnv = { 
      ...process.env, 
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    };
    
    // 濡傛灉鏄紑鍙戞ā寮忥紝鍚敤璋冭瘯鏃ュ織
    if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
      processEnv.ELECTRON_DEBUG = '1';
      console.log('璋冭瘯妯″紡宸插惎鐢紝Python鏈嶅姟灏嗚緭鍑鸿缁嗘棩蹇?);
    }
    
    pythonProcess = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: userCwd,
      env: processEnv
    });

    console.log('杞啓鏈嶅姟宸插惎鍔紝PID:', pythonProcess.pid);

    // 浣跨敤鏂扮殑杈撳嚭澶勭悊鍑芥暟
    pythonProcess.stdout.on('data', processPythonOutput);

    pythonProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString('utf8');
      console.error('Python stderr:', errorOutput);

      // 鍦ㄨ皟璇曟ā寮忎笅锛屾樉绀烘洿璇︾粏鐨剆tderr淇℃伅
      if (processEnv.ELECTRON_DEBUG === '1') {
        console.log('Python璋冭瘯淇℃伅:', errorOutput);
      }

      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python閿欒: ${errorOutput.trim()}`,
          timestamp: new Date().toISOString()
        });
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python杩涚▼鍚姩澶辫触:', error);
      pythonReady = false;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python杩涚▼鍚姩澶辫触: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      }
      pythonProcess = null;
    });

    pythonProcess.on('close', (code, signal) => {
      console.log(`Python杩涚▼閫€鍑猴紝浠ｇ爜: ${code}, 淇″彿: ${signal}`);
      pythonReady = false;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'warning',
          message: `杞啓鏈嶅姟宸插仠姝?(閫€鍑轰唬鐮? ${code}, 淇″彿: ${signal})`,
          timestamp: new Date().toISOString()
        });
      }
      pythonProcess = null;
    });

    pythonProcess.on('spawn', () => {
      console.log('杞啓鏈嶅姟杩涚▼宸插惎鍔紝绛夊緟鍒濆鍖栧畬鎴?..');
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'info',
          message: '杞啓鏈嶅姟杩涚▼宸插惎鍔?,
          timestamp: new Date().toISOString()
        });
      }

      // 绔嬪嵆鍙戦€佸垵濮嬮厤缃紱濡傛湭灏辩华灏嗚嚜鍔ㄥ叆闃?      console.log('鍙戦€佸垵濮嬮厤缃埌杞啓鏈嶅姟(绔嬪嵆):', config);
      sendToPython({ type: 'update_config', config });
    });

    return true;
  } catch (error) {
    console.error('鍚姩杞啓鏈嶅姟澶辫触:', error);
    pythonReady = false;
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: `鍚姩杞啓鏈嶅姟澶辫触: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
}

function sendToPython(message) {
  console.log('鍑嗗鍙戦€佹秷鎭埌杞啓鏈嶅姟:', message);

  if (!pythonProcess) {
    console.error('杞啓鏈嶅姟杩涚▼涓嶅瓨鍦紝鏃犳硶鍙戦€佹秷鎭?);
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: '杞啓鏈嶅姟鏈惎鍔紝鏃犳硶鍙戦€佸懡浠?,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  if (!pythonProcess.stdin) {
    console.error('杞啓鏈嶅姟杩涚▼stdin涓嶅彲鐢?);
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: '杞啓鏈嶅姟閫氫俊绠￠亾涓嶅彲鐢?,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  // 濡傛灉Python鏈嶅姟鏈氨缁紝灏嗘秷鎭姞鍏ュ緟鍙戦€侀槦鍒?  if (!pythonReady) {
    console.log('Python鏈嶅姟鏈氨缁紝娑堟伅鍔犲叆寰呭彂閫侀槦鍒?);
    pendingMessages.push(message);
    return true;
  }

  return sendToPythonDirect(message);
}

// 鐢ㄦ埛鎵嬪姩鍋滄褰曢煶鍚庤Е鍙戠殑浼橀泤閲嶅惎閫昏緫
function restartPythonServiceAfterStop() {
  if (!pythonProcess) {
    console.log('杞啓鏈嶅姟杩涚▼涓嶅瓨鍦紝鐩存帴鍚姩鏂板疄渚?);
    startPythonService();
    return;
  }

  if (restartingPython) {
    console.log('閲嶅惎涓紝蹇界暐閲嶅瑙﹀彂');
    return;
  }

  restartingPython = true;
  try {
    console.log('鍙戦€佸叧闂懡浠や互浼橀泤閫€鍑鸿浆鍐欐湇鍔?);
    // 灏濊瘯浼橀泤鍏抽棴
    sendToPythonDirect({ type: 'shutdown' });
  } catch (e) {
    console.warn('鍙戦€佸叧闂懡浠ゅけ璐ワ紝鏀逛负鐩存帴缁堟:', e.message);
  }

  let closed = false;
  const onClose = () => {
    if (closed) return;
    closed = true;
    console.log('鏃ц浆鍐欐湇鍔″凡閫€鍑猴紝鍑嗗閲嶅惎');
    pythonProcess = null;
    setTimeout(() => {
      const ok = startPythonService();
      restartingPython = false;
      console.log('閲嶅惎缁撴灉:', ok);
    }, 500);
  };

  // 涓€娆℃€х洃鍚叧闂?  const closeHandler = (code, signal) => {
    console.log('鏀跺埌杞啓鏈嶅姟鍏抽棴浜嬩欢(閲嶅惎娴佺▼):', code, signal);
    if (pythonProcess) {
      pythonProcess.removeListener('close', closeHandler);
    }
    onClose();
  };
  if (pythonProcess) {
    pythonProcess.once('close', closeHandler);
  }

  // 瓒呮椂寮哄埗鍏抽棴
  setTimeout(() => {
    if (!closed) {
      console.warn('绛夊緟浼橀泤鍏抽棴瓒呮椂锛屽己鍒剁粓姝㈣繘绋?);
      try {
        pythonProcess && pythonProcess.kill();
      } catch (e) {}
    }
  }, 5000);
}

// IPC浜嬩欢澶勭悊
ipcMain.handle('start-recording', () => {
  console.log('鏀跺埌寮€濮嬪綍闊宠姹?);
  const result = sendToPython({ type: 'start_recording' });
  console.log('寮€濮嬪綍闊冲懡浠ゅ彂閫佺粨鏋?', result);
  return result;
});

ipcMain.handle('stop-recording', () => {
  console.log('鏀跺埌鍋滄褰曢煶璇锋眰');
  restartAfterUserStopPending = true; // 鏍囪鐢ㄦ埛鎵嬪姩鍋滄锛屽綍闊冲仠姝㈠悗灏嗛噸鍚湇鍔?  const result = sendToPython({ type: 'stop_recording' });
  console.log('鍋滄褰曢煶鍛戒护鍙戦€佺粨鏋?', result);
  return result;
});

ipcMain.handle('get-config', () => {
  console.log('鏀跺埌鑾峰彇閰嶇疆璇锋眰锛屽綋鍓嶉厤缃?', config);
  return config;
});

// 鎻愪緵鍚庣鏈嶅姟鐘舵€佺粰娓叉煋杩涚▼锛岄伩鍏嶉〉闈㈠垏鎹㈠悗璇垽涓衡€滅瓑寰呮湇鍔″惎鍔ㄢ€?ipcMain.handle('get-service-status', () => {
  return {
    running: !!pythonProcess,
    ready: pythonReady,
    pid: pythonProcess ? pythonProcess.pid : null
  };
});

ipcMain.handle('save-config', (event, newConfig) => {
  console.log('鏀跺埌淇濆瓨閰嶇疆璇锋眰:', newConfig);
  config = { ...config, ...newConfig };
  saveConfig();
  console.log('閰嶇疆宸蹭繚瀛橈紝鍙戦€佸埌Python:', config);
  const result = sendToPython({ type: 'update_config', config });
  console.log('閰嶇疆鏇存柊鍛戒护鍙戦€佺粨鏋?', result);
  return true;
});

ipcMain.handle('open-settings', () => {
  console.log('鏀跺埌鎵撳紑璁剧疆璇锋眰锛堢嫭绔嬬獥鍙ｏ級');
  createSettingsWindow();
});

ipcMain.handle('open-media-transcribe', () => {
  console.log('鏀跺埌鎵撳紑濯掍綋杞啓璇锋眰锛堢嫭绔嬬獥鍙ｏ級');
  createMediaTranscribeWindow();
});

ipcMain.handle('test-python', async (event, pythonPath) => {
  console.log('鏀跺埌Python娴嬭瘯璇锋眰:', pythonPath);

  // 濡傛灉娌℃湁鎻愪緵Python璺緞锛屾彁绀虹敤鎴疯繖鏄彲閫夌殑
  if (!pythonPath) {
    return {
      success: true,
      version: '浣跨敤宸茬紪璇戠殑杞啓鏈嶅姟锛屾棤闇€Python鐜',
      message: '搴旂敤灏嗕娇鐢ㄩ缂栬瘧鐨勮浆鍐欐湇鍔★紝Python鐜閰嶇疆鏄彲閫夌殑銆?
    };
  }

  return new Promise((resolve) => {
    const testCmd = pythonPath;
    const testProcess = spawn(testCmd, ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });

    let output = '';
    let error = '';

    testProcess.stdout.on('data', (data) => {
      output += data.toString('utf8');
    });

    testProcess.stderr.on('data', (data) => {
      error += data.toString('utf8');
    });

    testProcess.on('close', (code) => {
      if (code === 0) {
        const version = output.trim() || error.trim(); // 鏈変簺Python鐗堟湰杈撳嚭鍒皊tderr
        resolve({
          success: true,
          version: version,
          message: 'Python鐜鍙敤锛屼絾搴旂敤灏嗕紭鍏堜娇鐢ㄩ缂栬瘧鏈嶅姟銆?
        });
      } else {
        resolve({
          success: false,
          error: error.trim() || `杩涚▼閫€鍑轰唬鐮? ${code}`,
          message: 'Python娴嬭瘯澶辫触锛屼絾涓嶅奖鍝嶄娇鐢ㄩ缂栬瘧鐨勮浆鍐欐湇鍔°€?
        });
      }
    });

    testProcess.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        message: 'Python涓嶅彲鐢紝浣嗗簲鐢ㄥ皢浣跨敤棰勭紪璇戠殑杞啓鏈嶅姟銆?
      });
    });

    // 5绉掕秴鏃?    setTimeout(() => {
      testProcess.kill();
      resolve({
        success: false,
        error: '娴嬭瘯瓒呮椂',
        message: 'Python娴嬭瘯瓒呮椂锛屼絾涓嶅奖鍝嶄娇鐢ㄩ缂栬瘧鐨勮浆鍐欐湇鍔°€?
      });
    }, 5000);
  });
});

ipcMain.handle('restart-python-service', async (event) => {
  console.log('鏀跺埌閲嶅惎杞啓鏈嶅姟璇锋眰');

  try {
    if (restartingPython) {
      console.log('閲嶅惎鎿嶄綔姝ｅ湪杩涜锛屽拷鐣ラ噸澶嶈姹?);
      return { success: false, error: '姝ｅ湪閲嶅惎涓? };
    }
    restartingPython = true;
    // 鍋滄鐜版湁鏈嶅姟
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
      console.log('宸插仠姝㈢幇鏈夎浆鍐欐湇鍔?);
    }

    // 绛夊緟涓€绉?    await new Promise(resolve => setTimeout(resolve, 1000));

    // 閲嶆柊鍚姩鏈嶅姟
    const success = startPythonService();
    restartingPython = false;

    return {
      success: success,
      error: success ? null : '鍚姩杞啓鏈嶅姟澶辫触'
    };
  } catch (error) {
    console.error('閲嶅惎杞啓鏈嶅姟澶辫触:', error);
    restartingPython = false;
    return {
      success: false,
      error: error.message
    };
  }
});

// 鍒涘缓鑿滃崟
function createMenu() {
  const template = [
    {
      label: '鏂囦欢',
      submenu: [
        {
          label: '璁剧疆',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: '閫€鍑?,
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '褰曢煶',
      submenu: [
        {
          label: '寮€濮嬪綍闊?,
          accelerator: 'F1',
          click: () => {
            sendToPython({ type: 'start_recording' });
          }
        },
        {
          label: '鍋滄褰曢煶',
          accelerator: 'F2',
          click: () => {
            restartAfterUserStopPending = true;
            sendToPython({ type: 'stop_recording' });
          }
        }
      ]
    },
    {
      label: '甯姪',
      submenu: [
        {
          label: '鍏充簬',
          click: () => {
            const aboutWindow = new BrowserWindow({
              width: 400,
              height: 300,
              parent: mainWindow,
              modal: true,
              resizable: false,
              title: '鍏充簬'
            });
            aboutWindow.loadURL(`data:text/html;charset=utf-8,
              <html>
                <head><title>鍏充簬</title></head>
                <body style="font-family: Arial; padding: 20px; text-align: center;">
                  <h2>璇煶杞啓缈昏瘧宸ュ叿</h2>
                  <p>鐗堟湰: 1.0.0</p>
                  <p>鍩轰簬 OpenAI API 鐨勮闊宠浆鍐欏拰缈昏瘧宸ュ叿</p>
                  <p>浣跨敤 Electron + Python 寮€鍙?/p>
                </body>
              </html>
            `);
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: '鍏充簬 ' + app.getName(), role: 'about' },
        { type: 'separator' },
        { label: '鏈嶅姟', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: '闅愯棌 ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
        { label: '闅愯棌鍏朵粬', accelerator: 'Command+Shift+H', role: 'hideothers' },
        { label: '鏄剧ず鍏ㄩ儴', role: 'unhide' },
        { type: 'separator' },
        { label: '閫€鍑?, accelerator: 'Command+Q', click: () => app.quit() }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  console.log('Electron app is ready');
  console.log('Current working directory:', process.cwd());
  console.log('__dirname:', __dirname);

  try {
    console.log('Loading config...');
    loadConfig();
    console.log('Creating window...');
    createWindow();
    console.log('Creating menu...');
    createMenu();
    console.log('Starting transcription service...');
    const serviceStarted = startPythonService();
    console.log('Transcription service started:', serviceStarted);
  } catch (error) {
    console.error('Error during app initialization:', error);
    // 涓嶈绔嬪嵆閫€鍑猴紝璁╃敤鎴风湅鍒伴敊璇俊鎭?  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(error => {
  console.error('Error when app ready:', error);
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    console.log('搴旂敤閫€鍑猴紝缁堟杞啓鏈嶅姟');
    pythonProcess.kill();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 濯掍綋杞啓鐩稿叧IPC澶勭悊
ipcMain.handle('process-media-file', async (event, params) => {
  console.log('鏀跺埌濯掍綋鏂囦欢澶勭悊璇锋眰:', params);
  
  try {
    const { filePath, settings } = params;
    
    console.log('妫€鏌ユ枃浠惰矾寰?', filePath);
    
    if (!filePath || filePath.trim() === '') {
      throw new Error('鏂囦欢璺緞涓虹┖');
    }
    
    if (!fs.existsSync(filePath)) {
      console.error('鏂囦欢涓嶅瓨鍦?', filePath);
      throw new Error(`鏂囦欢涓嶅瓨鍦? ${filePath}`);
    }
    
    // 妫€鏌ユ枃浠跺ぇ灏?    const stats = fs.statSync(filePath);
    console.log('鏂囦欢淇℃伅:', {
      path: filePath,
      size: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2) + 'MB'
    });

    // 鍙戦€佸紑濮嬪鐞嗘秷鎭?    if (mainWindow) {
      mainWindow.webContents.send('media-progress', {
        type: 'progress',
        message: `寮€濮嬪鐞嗘枃浠? ${filePath.split('\\').pop().split('/').pop()}`,
        progress: 0
      });
    }

    // 鍚姩濯掍綋杞啓Python杩涚▼
    const result = await startMediaTranscribeProcess(filePath, settings);
    
    return result;
    
  } catch (error) {
    console.error('濯掍綋鏂囦欢澶勭悊澶辫触:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('select-media-file', async (event) => {
  console.log('鏀跺埌閫夋嫨濯掍綋鏂囦欢璇锋眰');
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '閫夋嫨濯掍綋鏂囦欢',
      filters: [
        { 
          name: '鎵€鏈夋敮鎸佺殑濯掍綋鏂囦欢', 
          extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm', 'm4v', 'wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'wma'] 
        },
        { 
          name: '瑙嗛鏂囦欢', 
          extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm', 'm4v'] 
        },
        { 
          name: '闊抽鏂囦欢', 
          extensions: ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'wma'] 
        },
        { name: '鎵€鏈夋枃浠?, extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    return result;
    
  } catch (error) {
    console.error('閫夋嫨濯掍綋鏂囦欢澶辫触:', error);
    return {
      canceled: true,
      error: error.message
    };
  }
});

ipcMain.handle('select-output-path', async (event, params) => {
  console.log('鏀跺埌閫夋嫨杈撳嚭璺緞璇锋眰');
  
  try {
    const baseName = params && params.baseName ? params.baseName : '';
    let defaultBase = 'transcription_result';
    try {
      if (baseName && typeof baseName === 'string') {
        const parsed = path.parse(baseName);
        if (parsed && parsed.name) {
          defaultBase = `${parsed.name}_transcription_result`;
        }
      }
    } catch (e) {
      // ignore parse errors
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '閫夋嫨淇濆瓨浣嶇疆',
      defaultPath: `${defaultBase}.txt`,
      filters: [
        { name: '鏂囨湰鏂囦欢', extensions: ['txt'] },
        { name: '鎵€鏈夋枃浠?, extensions: ['*'] }
      ]
    });
    
    return result;
    
  } catch (error) {
    console.error('閫夋嫨杈撳嚭璺緞澶辫触:', error);
    return {
      canceled: true,
      error: error.message
    };
  }
});

ipcMain.handle('export-results', async (event, params) => {
  console.log('鏀跺埌瀵煎嚭缁撴灉璇锋眰:', params);
  
  try {
    const { results, outputPath } = params;
    
    if (!results || results.length === 0) {
      throw new Error('娌℃湁鍙鍑虹殑缁撴灉');
    }

    // 鏋勫缓瀵煎嚭鍐呭
    let content = `杞啓缈昏瘧缁撴灉\n`;
    content += `鐢熸垚鏃堕棿: ${new Date().toLocaleString('zh-CN')}\n`;
    content += '=' + '='.repeat(50) + '\n\n';
    
    results.forEach((result, index) => {
      content += `娈佃惤 ${index + 1}:\n`;
      content += `鍘熸枃: ${result.transcription || ''}\n`;
      if (result.translation) {
        content += `缈昏瘧: ${result.translation}\n`;
      }
      content += '\n';
    });

    // 鍐欏叆鏂囦欢
    fs.writeFileSync(outputPath, content, 'utf8');
    
    console.log('缁撴灉宸插鍑哄埌:', outputPath);
    
    return {
      success: true,
      exportPath: outputPath
    };
    
  } catch (error) {
    console.error('瀵煎嚭缁撴灉澶辫触:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 鍚姩濯掍綋杞啓Python杩涚▼
async function startMediaTranscribeProcess(filePath, settings) {
  return new Promise((resolve, reject) => {
    try {
      // 缁堟鐜版湁鐨勫獟浣撹浆鍐欒繘绋?      if (mediaTranscribeProcess) {
        mediaTranscribeProcess.kill();
        mediaTranscribeProcess = null;
      }

      const userCwd = isPackaged ? userDataPath : __dirname;
      
      // 浼樺厛瀵绘壘宸茬紪璇戠殑exe鏂囦欢
      let servicePath = null;
      let useSystemPython = false;
      
      // 鎸変紭鍏堢骇鎼滅储鍙墽琛屾枃浠?      const candidates = [];
      
      if (isPackaged) {
        // 鎵撳寘鍚庣幆澧冿細浠巖esources鐩綍鏌ユ壘
        candidates.push(path.join(process.resourcesPath, 'python', 'media_transcribe.exe'));
      } else {
        // 寮€鍙戠幆澧冿細浼樺厛浣跨敤宸茬紪璇戠殑exe
        candidates.push(path.join(__dirname, 'dist-python', 'win', 'media_transcribe.exe'));
        candidates.push(path.join(__dirname, 'dist', 'media_transcribe.exe'));
      }

      // 鏌ユ壘鍙敤鐨別xe鏂囦欢
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          servicePath = candidate;
          console.log('鎵惧埌濯掍綋杞啓鏈嶅姟鍙墽琛屾枃浠?', servicePath);
          break;
        }
      }

      // 濡傛灉娌℃湁鎵惧埌exe鏂囦欢锛屾墠鑰冭檻浣跨敤Python鑴氭湰锛堜粎鍦ㄥ紑鍙戞ā寮忎笅锛?      if (!servicePath && !isPackaged) {
        const pythonScript = path.join(__dirname, 'media_transcribe.py');
        if (fs.existsSync(pythonScript)) {
          // 鍙湁鍦ㄩ厤缃腑鏄庣‘鎸囧畾Python璺緞鏃舵墠浣跨敤鑴氭湰妯″紡
          const configPythonPath = config.python_path;
          if (configPythonPath) {
            servicePath = configPythonPath;
            useSystemPython = true;
            console.log('浣跨敤閰嶇疆鐨凱ython璺緞杩愯濯掍綋杞啓鑴氭湰:', configPythonPath, pythonScript);
          } else {
            console.warn('鏈壘鍒板獟浣撹浆鍐欏彲鎵ц鏂囦欢锛屼笖鏈厤缃甈ython璺緞銆傝杩愯 npm run build:py:win 缂栬瘧鏈嶅姟銆?);
            throw new Error('濯掍綋杞啓鏈嶅姟涓嶅彲鐢細鏈壘鍒板彲鎵ц鏂囦欢涓旀湭閰嶇疆Python璺緞銆?);
          }
        }
      }

      if (!servicePath) {
        throw new Error('鏃犳硶鍚姩濯掍綋杞啓鏈嶅姟锛氭湭鎵惧埌鍙墽琛屾枃浠躲€傝杩愯 npm run build:py:win 缂栬瘧鏈嶅姟銆?);
      }

      console.log('鍚姩濯掍綋杞啓杩涚▼...');

      // 鏋勫缓鍛戒护琛屽弬鏁?      // 鑻ユ湭鎻愪緵杈撳嚭鏂囦欢鍚嶏紝鍒欐寜鈥滄簮鏂囦欢鍚峗transcription_result.txt鈥濈敓鎴愬埌鍚岀洰褰?      let outputPath = settings.outputPath;
      if (!outputPath || String(outputPath).trim() === '') {
        try {
          const parsed = path.parse(filePath);
          outputPath = path.join(parsed.dir, `${parsed.name}_transcription_result.txt`);
          console.log('鏈彁渚涜緭鍑鸿矾寰勶紝鑷姩鐢熸垚:', outputPath);
        } catch (e) {
          outputPath = 'transcription_result.txt';
        }
      }
      let spawnCmd, spawnArgs;
      
      if (useSystemPython) {
        spawnCmd = servicePath;
        spawnArgs = [
          path.join(__dirname, 'media_transcribe.py'),
          '--file', filePath,
          '--output', outputPath
        ];
      } else {
        spawnCmd = servicePath;
        spawnArgs = [
          '--file', filePath,
          '--output', outputPath
        ];
      }

      if (settings.enableTranslation) {
        spawnArgs.push('--translate');
        if (settings.targetLanguage) {
          spawnArgs.push('--language', settings.targetLanguage);
        }
      }

      if (settings.theaterMode) {
        spawnArgs.push('--theater-mode');
      }

      // 璁剧疆鐜鍙橀噺
      const processEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      };

      // 鎸囧畾鏈湴 ffmpeg.exe 璺緞锛屼紭鍏堜娇鐢ㄩ」鐩牴鐩綍鎴栨墦鍖呯洰褰曚腑鐨勬枃浠?      try {
        const ffmpegCandidates = [];
        // 寮€鍙戠幆澧冿細椤圭洰鏍圭洰褰?        ffmpegCandidates.push(path.join(__dirname, 'ffmpeg.exe'));
        ffmpegCandidates.push(path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'));

        // 鑻?exe 鍚岀洰褰曞瓨鍦紙渚嬪鎵嬪姩鏀惧埌 dist-python/win/锛?        try {
          const serviceDir = path.dirname(servicePath);
          ffmpegCandidates.push(path.join(serviceDir, 'ffmpeg.exe'));
          ffmpegCandidates.push(path.join(serviceDir, 'ffmpeg', 'ffmpeg.exe'));
        } catch (e) {
          // ignore
        }

        // 鎵撳寘鐜锛歳esources/python 涓嬶紙涓?.exe 涓€璧峰垎鍙戯級
        if (isPackaged) {
          ffmpegCandidates.push(path.join(process.resourcesPath, 'python', 'ffmpeg.exe'));
          ffmpegCandidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
        }

        for (const c of ffmpegCandidates) {
          if (c && fs.existsSync(c)) {
            processEnv.IMAGEIO_FFMPEG_EXE = c;
            console.log('浣跨敤鏈湴 ffmpeg:', c);
            break;
          }
        }
      } catch (e) {
        console.warn('璁剧疆鏈湴 ffmpeg 璺緞澶辫触:', e.message);
      }

      // 娣诲姞OpenAI閰嶇疆
      if (config.openai_api_key) {
        processEnv.OPENAI_API_KEY = config.openai_api_key;
      }
      if (config.openai_base_url) {
        processEnv.OPENAI_BASE_URL = config.openai_base_url;
      }

      console.log('鍚姩濯掍綋杞啓鏈嶅姟:', spawnCmd, spawnArgs);

      mediaTranscribeProcess = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: userCwd,
        env: processEnv
      });

      console.log('濯掍綋杞啓杩涚▼宸插惎鍔紝PID:', mediaTranscribeProcess.pid);

      let outputBuffer = '';
      let hasResults = false;
      let stderrBuffer = '';

      mediaTranscribeProcess.stdout.on('data', (data) => {
        const output = data.toString('utf8');
        console.log('濯掍綋杞啓杈撳嚭:', output);
        
        outputBuffer += output;
        
        // 瑙ｆ瀽杩涘害鍜岀粨鏋?        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || ''; // 淇濈暀鏈€鍚庝竴琛岋紙鍙兘涓嶅畬鏁达級
        
        lines.forEach(line => {
          line = line.trim();
          if (!line) return;
          
          // 灏濊瘯瑙ｆ瀽JSON娑堟伅
          try {
            const message = JSON.parse(line);
            if (mainWindow) {
              mainWindow.webContents.send('media-progress', message);
            }
            if (message.type === 'result') {
              hasResults = true;
            }
          } catch (e) {
            // 涓嶆槸JSON锛屼綔涓烘櫘閫氭棩蹇楀鐞?            if (line.includes('娈佃惤') || line.includes('杞啓') || line.includes('缈昏瘧') || line.includes('杩涘害') || line.includes('瀹屾垚')) {
              if (mainWindow) {
                mainWindow.webContents.send('media-progress', {
                  type: 'progress',
                  message: line,
                  progress: 50
                });
              }
              if (line.includes('杞啓瀹屾垚') || line.includes('缈昏瘧瀹屾垚')) {
                hasResults = true;
              }
            }
          }
        });
      });

      mediaTranscribeProcess.stderr.on('data', (data) => {
        const chunk = data.toString('utf8');
        stderrBuffer += chunk;
        
        // 鎸夎澶勭悊锛岃繃婊?FFmpeg 鐨勬甯告棩蹇楋紝淇濈暀鏄庢樉閿欒
        const lines = chunk.split('\n');
        lines.forEach(rawLine => {
          const line = String(rawLine || '').trim();
          if (!line) return;

          const isError = /(error|failed|traceback|not found|invalid)/i.test(line);
          if (isError) {
            console.error('濯掍綋杞啓閿欒:', line);
            if (mainWindow) {
              mainWindow.webContents.send('media-progress', {
                type: 'error',
                message: line
              });
            }
          } else {
            // 灏嗛潪鑷村懡淇℃伅浣滀负杩涘害/鏃ュ織灞曠ず锛岄伩鍏嶉€犳垚鈥滈敊璇€濊鎶?            if (mainWindow) {
              mainWindow.webContents.send('media-progress', {
                type: 'progress',
                message: line,
                progress: 50
              });
            }
          }
        });
      });

      mediaTranscribeProcess.on('error', (error) => {
        console.error('濯掍綋杞啓杩涚▼鍚姩澶辫触:', error);
        reject(new Error(`杩涚▼鍚姩澶辫触: ${error.message}`));
      });

      mediaTranscribeProcess.on('close', (code, signal) => {
        console.log(`濯掍綋杞啓杩涚▼閫€鍑猴紝浠ｇ爜: ${code}, 淇″彿: ${signal}`);
        
        if (code === 0) {
          // 鎴愬姛瀹屾垚
          if (mainWindow) {
            mainWindow.webContents.send('media-progress', {
              type: 'complete',
              message: '澶勭悊瀹屾垚',
              progress: 100
            });
          }
          resolve({
            success: true,
            hasResults: hasResults
          });
        } else {
          // 澶勭悊澶辫触
          const tail = stderrBuffer.split(/\r?\n/).filter(Boolean).slice(-10).join('\n');
          const errorMsg = `澶勭悊澶辫触锛岄€€鍑轰唬鐮? ${code}${tail ? `\n璇︽儏: ${tail}` : ''}`;
          if (mainWindow) {
            mainWindow.webContents.send('media-progress', {
              type: 'error',
              message: errorMsg
            });
          }
          reject(new Error(errorMsg));
        }
        
        mediaTranscribeProcess = null;
      });

      // 璁剧疆瓒呮椂锛?0鍒嗛挓锛?      setTimeout(() => {
        if (mediaTranscribeProcess) {
          mediaTranscribeProcess.kill();
          reject(new Error('澶勭悊瓒呮椂'));
        }
      }, 30 * 60 * 1000);

    } catch (error) {
      console.error('鍚姩濯掍綋杞啓杩涚▼澶辫触:', error);
      reject(error);
    }
  });
}

app.on('before-quit', () => {
  if (pythonProcess) {
    console.log('搴旂敤鍗冲皢閫€鍑猴紝缁堟杞啓鏈嶅姟');
    pythonProcess.kill();
  }
  
  if (mediaTranscribeProcess) {
    console.log('搴旂敤鍗冲皢閫€鍑猴紝缁堟濯掍綋杞啓杩涚▼');
    mediaTranscribeProcess.kill();
  }
});

