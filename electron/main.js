const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let settingsWindow;
let pythonProcess;
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
    modal: true,
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

function startPythonService() {
  console.log('startPythonService called');
  
  if (pythonProcess) {
    console.log('正在终止现有Python进程...');
    pythonProcess.kill();
    pythonProcess = null;
  }

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

    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString('utf8').split('\n');
      console.log('Python输出:', data.toString('utf8'));
      
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const message = JSON.parse(line.trim());
            console.log('解析的Python消息:', message);
            if (mainWindow) {
              mainWindow.webContents.send('python-message', message);
            }
          } catch (error) {
            console.error('解析Python消息失败:', error);
            console.error('原始消息:', line);
            // 发送原始消息作为日志
            if (mainWindow) {
              mainWindow.webContents.send('python-message', {
                type: 'log',
                level: 'info',
                message: `Python输出: ${line.trim()}`,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      });
    });

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
      console.log('转写服务已成功启动');
      if (mainWindow) {
        mainWindow.webContents.send('python-message', {
          type: 'log',
          level: 'info',
          message: '转写服务已启动',
          timestamp: new Date().toISOString()
        });
      }
      
      // 发送初始配置
      setTimeout(() => {
        console.log('发送初始配置到转写服务:', config);
        sendToPython({ type: 'update_config', config });
      }, 1000);
    });
    
    return true;
  } catch (error) {
    console.error('启动转写服务失败:', error);
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

  try {
    const jsonMessage = JSON.stringify(message) + '\n';
    console.log('发送JSON消息:', jsonMessage.trim());
    pythonProcess.stdin.write(jsonMessage);
    console.log('消息发送成功');
    return true;
  } catch (error) {
    console.error('发送消息到转写服务失败:', error);
    if (mainWindow) {
      mainWindow.webContents.send('python-message', {
        type: 'log',
        level: 'error',
        message: `发送消息失败: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
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
  const result = sendToPython({ type: 'stop_recording' });
  console.log('停止录音命令发送结果:', result);
  return result;
});

ipcMain.handle('get-config', () => {
  console.log('收到获取配置请求，当前配置:', config);
  return config;
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
  console.log('收到打开设置请求');
  createSettingsWindow();
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
    
    return {
      success: success,
      error: success ? null : '启动转写服务失败'
    };
  } catch (error) {
    console.error('重启转写服务失败:', error);
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
          click: () => createSettingsWindow()
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

app.on('before-quit', () => {
  if (pythonProcess) {
    console.log('应用即将退出，终止转写服务');
    pythonProcess.kill();
  }
});
