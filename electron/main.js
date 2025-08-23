const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let settingsWindow;
let mediaTranscribeWindow;
// Python进程管理
let pythonProcess;
let mediaTranscribeProcess;
let pythonBuffer = ''; // 用于缓存不完整的JSON消息
let pythonReady = false;
let pendingMessages = []; // 缓存待发送的消息
let restartingPython = false; // 防止重复重启
let restartAfterUserStopPending = false; // 用户手动停止录音后待重启标记
let config = {
  openai_api_key: '',
  openai_base_url: '',
  enable_translation: true,
  translate_language: '中文',
  theater_mode: false
};

// 配置文件路径：开发环境使用项目目录；打包后使用用户目录
const isPackaged = app.isPackaged;
const userDataPath = app.getPath('userData');
const configPath = isPackaged
  ? path.join(userDataPath, 'config.json')
  : path.join(__dirname, 'config.json');

// 加载配置
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = { ...config, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

// 保存配置
function saveConfig() {
  try {
    // 确保目录存在（打包环境下在用户数据目录）
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('保存配置失败:', error);
  }
}

// 处理Python进程输出的函数
function processPythonOutput(data) {
  const dataStr = data.toString('utf8');
  console.log('Python原始输出:', dataStr);
  
  // 将新数据添加到缓冲区
  pythonBuffer += dataStr;
  
  // 尝试提取完整的JSON消息
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
          // 找到完整的JSON消息
          messages.push(currentMessage.trim());
          currentMessage = '';
        }
      }
    }
  }
  
  // 更新缓冲区，保留未完成的消息
  pythonBuffer = currentMessage;
  
  // 处理提取出的完整消息
  messages.forEach(messageStr => {
    if (messageStr) {
      try {
        const message = JSON.parse(messageStr);
        console.log('解析的Python消息:', message);
        
        // 检查是否是启动完成消息
        if (message.type === 'log' && message.message === '转写服务已启动，等待命令...') {
          pythonReady = true;
          console.log('Python服务已就绪，处理待发送消息');
          
          // 发送所有待发送的消息
          while (pendingMessages.length > 0) {
            const pendingMessage = pendingMessages.shift();
            sendToPythonDirect(pendingMessage);
          }
        }
        
        if (mainWindow) {
          mainWindow.webContents.send('python-message', message);
        }

        // 检测录音停止事件，用于按需重启服务
        if (message.type === 'recording_stopped') {
          console.log('检测到录音已停止事件');
          if (restartAfterUserStopPending) {
            console.log('用户请求的录音停止后重启标记为真，开始优雅重启');
            restartAfterUserStopPending = false;
            restartPythonServiceAfterStop();
          }
        }
      } catch (error) {
        console.error('JSON解析失败:', error);
        console.error('问题消息:', messageStr);
        
        // 发送原始消息作为日志
        if (mainWindow) {
          mainWindow.webContents.send('python-message', {
            type: 'log',
            level: 'warning',
            message: `Python输出解析失败: ${messageStr}`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  });
}

// 直接发送消息到Python（不检查状态）
function sendToPythonDirect(message) {
  try {
    const jsonMessage = JSON.stringify(message) + '\n';
    console.log('直接发送到Python:', jsonMessage.trim());
    pythonProcess.stdin.write(jsonMessage);
    return true;
  } catch (error) {
    console.error('直接发送消息失败:', error);
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
      title: '语音转写翻译工具',
      show: false // 先不显示，加载完成后再显示
    });

    mainWindow.loadFile('index.html');

    // 等待页面准备就绪后再显示窗口
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      console.log('窗口已显示');
    });

    // 开发模式下打开开发者工具
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // 添加错误处理
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('页面加载失败:', errorCode, errorDescription);
    });

  } catch (error) {
    console.error('创建窗口时发生错误:', error);
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
    title: '设置',
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
    title: '媒体文件转写',
    resizable: true
  });

  mediaTranscribeWindow.loadFile('media-transcribe.html');

  mediaTranscribeWindow.on('closed', () => {
    mediaTranscribeWindow = null;
  });
}

function startPythonService() {
  console.log('startPythonService called');
  
  // 已有运行中的服务则不重复启动，保持单实例
  if (pythonProcess) {
    console.log('检测到已有转写服务进程，跳过启动');
    return true;
  }

  // 重置状态
  pythonReady = false;
  pythonBuffer = '';
  pendingMessages = [];

  console.log('启动转写服务...');
  const userCwd = isPackaged ? userDataPath : __dirname;
  
  // 优先寻找已编译的exe文件
  let servicePath = null;
  let useSystemPython = false;
  
  // 按优先级搜索可执行文件
  const candidates = [];
  
  if (isPackaged) {
    // 打包后环境：从resources目录查找
    candidates.push(path.join(process.resourcesPath, 'python', 'transcribe_service.exe'));
  } else {
    // 开发环境：优先使用已编译的exe
    candidates.push(path.join(__dirname, 'dist-python', 'win', 'transcribe_service.exe'));
    candidates.push(path.join(__dirname, 'dist', 'transcribe_service.exe'));
  }

  // 查找可用的exe文件
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      servicePath = candidate;
      console.log('找到转写服务可执行文件:', servicePath);
      break;
    }
  }

  // 如果没有找到exe文件，才考虑使用Python脚本（仅在开发模式下）
  if (!servicePath && !isPackaged) {
    const pythonScript = path.join(__dirname, 'transcribe_service.py');
    if (fs.existsSync(pythonScript)) {
      // 只有在配置中明确指定Python路径时才使用脚本模式
      const configPythonPath = config.python_path;
      if (configPythonPath) {
        servicePath = configPythonPath;
        useSystemPython = true;
        console.log('使用配置的Python路径运行脚本:', configPythonPath, pythonScript);
      } else {
        console.warn('未找到可执行文件，且未配置Python路径。请在设置中配置Python路径或运行 npm run build:py:win 编译服务。');
        if (mainWindow) {
          mainWindow.webContents.send('python-message', {
            type: 'log',
            level: 'error',
            message: '转写服务不可用：未找到可执行文件且未配置Python路径。请在设置中配置Python路径或重新编译服务。',
            timestamp: new Date().toISOString()
          });
        }
        return false;
      }
    }
  }

  if (!servicePath) {
    const errorMsg = '无法启动转写服务：未找到可执行文件。请运行 npm run build:py:win 编译服务。';
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
    
    console.log('启动转写服务:', spawnCmd, spawnArgs);
    
    // 设置环境变量
    const processEnv = { 
      ...process.env, 
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    };
    
    // 如果是开发模式，启用调试日志
    if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
      processEnv.ELECTRON_DEBUG = '1';
      console.log('调试模式已启用，Python服务将输出详细日志');
    }
    
    pythonProcess = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: userCwd,
      env: processEnv
    });

    console.log('转写服务已启动，PID:', pythonProcess.pid);

    // 使用新的输出处理函数
    pythonProcess.stdout.on('data', processPythonOutput);

    pythonProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString('utf8');
      console.error('Python stderr:', errorOutput);

      // 在调试模式下，显示更详细的stderr信息
      if (processEnv.ELECTRON_DEBUG === '1') {
        console.log('Python调试信息:', errorOutput);
      }

      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python错误: ${errorOutput.trim()}`,
          timestamp: new Date().toISOString()
        });
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Python进程启动失败:', error);
      pythonReady = false;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'error',
          message: `Python进程启动失败: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      }
      pythonProcess = null;
    });

    pythonProcess.on('close', (code, signal) => {
      console.log(`Python进程退出，代码: ${code}, 信号: ${signal}`);
      pythonReady = false;
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'warning',
          message: `转写服务已停止 (退出代码: ${code}, 信号: ${signal})`,
          timestamp: new Date().toISOString()
        });
      }
      pythonProcess = null;
    });

    pythonProcess.on('spawn', () => {
      console.log('转写服务进程已启动，等待初始化完成...');
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'info',
          message: '转写服务进程已启动',
          timestamp: new Date().toISOString()
        });
      }

      // 立即发送初始配置；如未就绪将自动入队
      console.log('发送初始配置到转写服务(立即):', config);
      sendToPython({ type: 'update_config', config });
    });

    return true;
  } catch (error) {
    console.error('启动转写服务失败:', error);
    pythonReady = false;
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: `启动转写服务失败: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
}

function sendToPython(message) {
  console.log('准备发送消息到转写服务:', message);

  if (!pythonProcess) {
    console.error('转写服务进程不存在，无法发送消息');
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: '转写服务未启动，无法发送命令',
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  if (!pythonProcess.stdin) {
    console.error('转写服务进程stdin不可用');
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: '转写服务通信管道不可用',
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  // 如果Python服务未就绪，将消息加入待发送队列
  if (!pythonReady) {
    console.log('Python服务未就绪，消息加入待发送队列');
    pendingMessages.push(message);
    return true;
  }

  return sendToPythonDirect(message);
}

// 用户手动停止录音后触发的优雅重启逻辑
function restartPythonServiceAfterStop() {
  if (!pythonProcess) {
    console.log('转写服务进程不存在，直接启动新实例');
    startPythonService();
    return;
  }

  if (restartingPython) {
    console.log('重启中，忽略重复触发');
    return;
  }

  restartingPython = true;
  try {
    console.log('发送关闭命令以优雅退出转写服务');
    // 尝试优雅关闭
    sendToPythonDirect({ type: 'shutdown' });
  } catch (e) {
    console.warn('发送关闭命令失败，改为直接终止:', e.message);
  }

  let closed = false;
  const onClose = () => {
    if (closed) return;
    closed = true;
    console.log('旧转写服务已退出，准备重启');
    pythonProcess = null;
    setTimeout(() => {
      const ok = startPythonService();
      restartingPython = false;
      console.log('重启结果:', ok);
    }, 500);
  };

  // 一次性监听关闭
  const closeHandler = (code, signal) => {
    console.log('收到转写服务关闭事件(重启流程):', code, signal);
    if (pythonProcess) {
      pythonProcess.removeListener('close', closeHandler);
    }
    onClose();
  };
  if (pythonProcess) {
    pythonProcess.once('close', closeHandler);
  }

  // 超时强制关闭
  setTimeout(() => {
    if (!closed) {
      console.warn('等待优雅关闭超时，强制终止进程');
      try {
        pythonProcess && pythonProcess.kill();
      } catch (e) {}
    }
  }, 5000);
}

// IPC事件处理
ipcMain.handle('start-recording', () => {
  console.log('收到开始录音请求');
  const result = sendToPython({ type: 'start_recording' });
  console.log('开始录音命令发送结果:', result);
  return result;
});

ipcMain.handle('stop-recording', () => {
  console.log('收到停止录音请求');
  restartAfterUserStopPending = true; // 标记用户手动停止，录音停止后将重启服务
  const result = sendToPython({ type: 'stop_recording' });
  console.log('停止录音命令发送结果:', result);
  return result;
});

ipcMain.handle('get-config', () => {
  console.log('收到获取配置请求，当前配置:', config);
  return config;
});

// 提供后端服务状态给渲染进程，避免页面切换后误判为“等待服务启动”
ipcMain.handle('get-service-status', () => {
  return {
    running: !!pythonProcess,
    ready: pythonReady,
    pid: pythonProcess ? pythonProcess.pid : null
  };
});

ipcMain.handle('save-config', (event, newConfig) => {
  console.log('收到保存配置请求:', newConfig);
  config = { ...config, ...newConfig };
  saveConfig();
  console.log('配置已保存，发送到Python:', config);
  const result = sendToPython({ type: 'update_config', config });
  console.log('配置更新命令发送结果:', result);
  return true;
});

ipcMain.handle('open-settings', () => {
  console.log('收到打开设置请求（独立窗口）');
  createSettingsWindow();
});

ipcMain.handle('open-media-transcribe', () => {
  console.log('收到打开媒体转写请求（独立窗口）');
  createMediaTranscribeWindow();
});

ipcMain.handle('test-python', async (event, pythonPath) => {
  console.log('收到Python测试请求:', pythonPath);

  // 如果没有提供Python路径，提示用户这是可选的
  if (!pythonPath) {
    return {
      success: true,
      version: '使用已编译的转写服务，无需Python环境',
      message: '应用将使用预编译的转写服务，Python环境配置是可选的。'
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
        const version = output.trim() || error.trim(); // 有些Python版本输出到stderr
        resolve({
          success: true,
          version: version,
          message: 'Python环境可用，但应用将优先使用预编译服务。'
        });
      } else {
        resolve({
          success: false,
          error: error.trim() || `进程退出代码: ${code}`,
          message: 'Python测试失败，但不影响使用预编译的转写服务。'
        });
      }
    });

    testProcess.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        message: 'Python不可用，但应用将使用预编译的转写服务。'
      });
    });

    // 5秒超时
    setTimeout(() => {
      testProcess.kill();
      resolve({
        success: false,
        error: '测试超时',
        message: 'Python测试超时，但不影响使用预编译的转写服务。'
      });
    }, 5000);
  });
});

ipcMain.handle('restart-python-service', async (event) => {
  console.log('收到重启转写服务请求');

  try {
    if (restartingPython) {
      console.log('重启操作正在进行，忽略重复请求');
      return { success: false, error: '正在重启中' };
    }
    restartingPython = true;
    // 停止现有服务
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
      console.log('已停止现有转写服务');
    }

    // 等待一秒
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 重新启动服务
    const success = startPythonService();
    restartingPython = false;

    return {
      success: success,
      error: success ? null : '启动转写服务失败'
    };
  } catch (error) {
    console.error('重启转写服务失败:', error);
    restartingPython = false;
    return {
      success: false,
      error: error.message
    };
  }
});

// 创建菜单
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '录音',
      submenu: [
        {
          label: '开始录音',
          accelerator: 'F1',
          click: () => {
            sendToPython({ type: 'start_recording' });
          }
        },
        {
          label: '停止录音',
          accelerator: 'F2',
          click: () => {
            restartAfterUserStopPending = true;
            sendToPython({ type: 'stop_recording' });
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            const aboutWindow = new BrowserWindow({
              width: 400,
              height: 300,
              parent: mainWindow,
              modal: true,
              resizable: false,
              title: '关于'
            });
            aboutWindow.loadURL(`data:text/html;charset=utf-8,
              <html>
                <head><title>关于</title></head>
                <body style="font-family: Arial; padding: 20px; text-align: center;">
                  <h2>语音转写翻译工具</h2>
                  <p>版本: 1.0.0</p>
                  <p>基于 OpenAI API 的语音转写和翻译工具</p>
                  <p>使用 Electron + Python 开发</p>
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
        { label: '关于 ' + app.getName(), role: 'about' },
        { type: 'separator' },
        { label: '服务', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: '隐藏 ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
        { label: '隐藏其他', accelerator: 'Command+Shift+H', role: 'hideothers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出', accelerator: 'Command+Q', click: () => app.quit() }
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
    // 不要立即退出，让用户看到错误信息
  }

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
    console.log('应用退出，终止转写服务');
    pythonProcess.kill();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 媒体转写相关IPC处理
ipcMain.handle('process-media-file', async (event, params) => {
  console.log('收到媒体文件处理请求:', params);
  
  try {
    const { filePath, settings } = params;
    
    console.log('检查文件路径:', filePath);
    
    if (!filePath || filePath.trim() === '') {
      throw new Error('文件路径为空');
    }
    
    if (!fs.existsSync(filePath)) {
      console.error('文件不存在:', filePath);
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    // 检查文件大小
    const stats = fs.statSync(filePath);
    console.log('文件信息:', {
      path: filePath,
      size: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2) + 'MB'
    });

    // 发送开始处理消息
    if (mainWindow) {
      mainWindow.webContents.send('media-progress', {
        type: 'progress',
        message: `开始处理文件: ${filePath.split('\\').pop().split('/').pop()}`,
        progress: 0
      });
    }

    // 启动媒体转写Python进程
    const result = await startMediaTranscribeProcess(filePath, settings);
    
    return result;
    
  } catch (error) {
    console.error('媒体文件处理失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('select-media-file', async (event) => {
  console.log('收到选择媒体文件请求');
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择媒体文件',
      filters: [
        { 
          name: '所有支持的媒体文件', 
          extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm', 'm4v', 'wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'wma'] 
        },
        { 
          name: '视频文件', 
          extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm', 'm4v'] 
        },
        { 
          name: '音频文件', 
          extensions: ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'wma'] 
        },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    return result;
    
  } catch (error) {
    console.error('选择媒体文件失败:', error);
    return {
      canceled: true,
      error: error.message
    };
  }
});

ipcMain.handle('select-output-path', async (event, params) => {
  console.log('收到选择输出路径请求');
  
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
      title: '选择保存位置',
      defaultPath: `${defaultBase}.txt`,
      filters: [
        { name: '文本文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    
    return result;
    
  } catch (error) {
    console.error('选择输出路径失败:', error);
    return {
      canceled: true,
      error: error.message
    };
  }
});

ipcMain.handle('export-results', async (event, params) => {
  console.log('收到导出结果请求:', params);
  
  try {
    const { results, outputPath } = params;
    
    if (!results || results.length === 0) {
      throw new Error('没有可导出的结果');
    }

    // 构建导出内容
    let content = `转写翻译结果\n`;
    content += `生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
    content += '=' + '='.repeat(50) + '\n\n';
    
    results.forEach((result, index) => {
      content += `段落 ${index + 1}:\n`;
      content += `原文: ${result.transcription || ''}\n`;
      if (result.translation) {
        content += `翻译: ${result.translation}\n`;
      }
      content += '\n';
    });

    // 写入文件
    fs.writeFileSync(outputPath, content, 'utf8');
    
    console.log('结果已导出到:', outputPath);
    
    return {
      success: true,
      exportPath: outputPath
    };
    
  } catch (error) {
    console.error('导出结果失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 启动媒体转写Python进程
async function startMediaTranscribeProcess(filePath, settings) {
  return new Promise((resolve, reject) => {
    try {
      // 终止现有的媒体转写进程
      if (mediaTranscribeProcess) {
        mediaTranscribeProcess.kill();
        mediaTranscribeProcess = null;
      }

      const userCwd = isPackaged ? userDataPath : __dirname;
      
      // 优先寻找已编译的exe文件
      let servicePath = null;
      let useSystemPython = false;
      
      // 按优先级搜索可执行文件
      const candidates = [];
      
      if (isPackaged) {
        // 打包后环境：从resources目录查找
        candidates.push(path.join(process.resourcesPath, 'python', 'media_transcribe.exe'));
      } else {
        // 开发环境：优先使用已编译的exe
        candidates.push(path.join(__dirname, 'dist-python', 'win', 'media_transcribe.exe'));
        candidates.push(path.join(__dirname, 'dist', 'media_transcribe.exe'));
      }

      // 查找可用的exe文件
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          servicePath = candidate;
          console.log('找到媒体转写服务可执行文件:', servicePath);
          break;
        }
      }

      // 如果没有找到exe文件，才考虑使用Python脚本（仅在开发模式下）
      if (!servicePath && !isPackaged) {
        const pythonScript = path.join(__dirname, 'media_transcribe.py');
        if (fs.existsSync(pythonScript)) {
          // 只有在配置中明确指定Python路径时才使用脚本模式
          const configPythonPath = config.python_path;
          if (configPythonPath) {
            servicePath = configPythonPath;
            useSystemPython = true;
            console.log('使用配置的Python路径运行媒体转写脚本:', configPythonPath, pythonScript);
          } else {
            console.warn('未找到媒体转写可执行文件，且未配置Python路径。请运行 npm run build:py:win 编译服务。');
            throw new Error('媒体转写服务不可用：未找到可执行文件且未配置Python路径。');
          }
        }
      }

      if (!servicePath) {
        throw new Error('无法启动媒体转写服务：未找到可执行文件。请运行 npm run build:py:win 编译服务。');
      }

      console.log('启动媒体转写进程...');

      // 构建命令行参数
      // 若未提供输出文件名，则按“源文件名_transcription_result.txt”生成到同目录
      let outputPath = settings.outputPath;
      if (!outputPath || String(outputPath).trim() === '') {
        try {
          const parsed = path.parse(filePath);
          outputPath = path.join(parsed.dir, `${parsed.name}_transcription_result.txt`);
          console.log('未提供输出路径，自动生成:', outputPath);
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

      // 设置环境变量
      const processEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      };

      // 指定本地 ffmpeg.exe 路径，优先使用项目根目录或打包目录中的文件
      try {
        const ffmpegCandidates = [];
        // 开发环境：项目根目录
        ffmpegCandidates.push(path.join(__dirname, 'ffmpeg.exe'));
        ffmpegCandidates.push(path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'));

        // 若 exe 同目录存在（例如手动放到 dist-python/win/）
        try {
          const serviceDir = path.dirname(servicePath);
          ffmpegCandidates.push(path.join(serviceDir, 'ffmpeg.exe'));
          ffmpegCandidates.push(path.join(serviceDir, 'ffmpeg', 'ffmpeg.exe'));
        } catch (e) {
          // ignore
        }

        // 打包环境：resources/python 下（与 .exe 一起分发）
        if (isPackaged) {
          ffmpegCandidates.push(path.join(process.resourcesPath, 'python', 'ffmpeg.exe'));
          ffmpegCandidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
        }

        for (const c of ffmpegCandidates) {
          if (c && fs.existsSync(c)) {
            processEnv.IMAGEIO_FFMPEG_EXE = c;
            console.log('使用本地 ffmpeg:', c);
            break;
          }
        }
      } catch (e) {
        console.warn('设置本地 ffmpeg 路径失败:', e.message);
      }

      // 添加OpenAI配置
      if (config.openai_api_key) {
        processEnv.OPENAI_API_KEY = config.openai_api_key;
      }
      if (config.openai_base_url) {
        processEnv.OPENAI_BASE_URL = config.openai_base_url;
      }

      console.log('启动媒体转写服务:', spawnCmd, spawnArgs);

      mediaTranscribeProcess = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: userCwd,
        env: processEnv
      });

      console.log('媒体转写进程已启动，PID:', mediaTranscribeProcess.pid);

      let outputBuffer = '';
      let hasResults = false;
      let stderrBuffer = '';

      mediaTranscribeProcess.stdout.on('data', (data) => {
        const output = data.toString('utf8');
        console.log('媒体转写输出:', output);
        
        outputBuffer += output;
        
        // 解析进度和结果
        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || ''; // 保留最后一行（可能不完整）
        
        lines.forEach(line => {
          line = line.trim();
          if (!line) return;
          
          // 尝试解析JSON消息
          try {
            const message = JSON.parse(line);
            if (mainWindow) {
              mainWindow.webContents.send('media-progress', message);
            }
            if (message.type === 'result') {
              hasResults = true;
            }
          } catch (e) {
            // 不是JSON，作为普通日志处理
            if (line.includes('段落') || line.includes('转写') || line.includes('翻译') || line.includes('进度') || line.includes('完成')) {
              if (mainWindow) {
                mainWindow.webContents.send('media-progress', {
                  type: 'progress',
                  message: line,
                  progress: 50
                });
              }
              if (line.includes('转写完成') || line.includes('翻译完成')) {
                hasResults = true;
              }
            }
          }
        });
      });

      mediaTranscribeProcess.stderr.on('data', (data) => {
        const chunk = data.toString('utf8');
        stderrBuffer += chunk;
        
        // 按行处理，过滤 FFmpeg 的正常日志，保留明显错误
        const lines = chunk.split('\n');
        lines.forEach(rawLine => {
          const line = String(rawLine || '').trim();
          if (!line) return;

          const isError = /(error|failed|traceback|not found|invalid)/i.test(line);
          if (isError) {
            console.error('媒体转写错误:', line);
            if (mainWindow) {
              mainWindow.webContents.send('media-progress', {
                type: 'error',
                message: line
              });
            }
          } else {
            // 将非致命信息作为进度/日志展示，避免造成“错误”误报
            if (mainWindow) {
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
        console.error('媒体转写进程启动失败:', error);
        reject(new Error(`进程启动失败: ${error.message}`));
      });

      mediaTranscribeProcess.on('close', (code, signal) => {
        console.log(`媒体转写进程退出，代码: ${code}, 信号: ${signal}`);
        
        if (code === 0) {
          // 成功完成
          if (mainWindow) {
            mainWindow.webContents.send('media-progress', {
              type: 'complete',
              message: '处理完成',
              progress: 100
            });
          }
          resolve({
            success: true,
            hasResults: hasResults
          });
        } else {
          // 处理失败
          const tail = stderrBuffer.split(/\r?\n/).filter(Boolean).slice(-10).join('\n');
          const errorMsg = `处理失败，退出代码: ${code}${tail ? `\n详情: ${tail}` : ''}`;
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

      // 设置超时（30分钟）
      setTimeout(() => {
        if (mediaTranscribeProcess) {
          mediaTranscribeProcess.kill();
          reject(new Error('处理超时'));
        }
      }, 30 * 60 * 1000);

    } catch (error) {
      console.error('启动媒体转写进程失败:', error);
      reject(error);
    }
  });
}

app.on('before-quit', () => {
  if (pythonProcess) {
    console.log('应用即将退出，终止转写服务');
    pythonProcess.kill();
  }
  
  if (mediaTranscribeProcess) {
    console.log('应用即将退出，终止媒体转写进程');
    mediaTranscribeProcess.kill();
  }
});
