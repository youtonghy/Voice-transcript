# 语音转写翻译工具 (Electron版)

一个基于 Electron 和 Python 的桌面应用，提供实时语音录制、转写和翻译功能。

## 功能特性

- 🎤 **一键录音** - 简单的开始/停止录音操作
- 🔊 **智能分段** - 自动检测语音和静音，智能分段处理
- 📝 **实时转写** - 使用 OpenAI gpt-4o-transcribe 模型进行语音转文字
- 🌐 **多语言翻译** - 支持翻译到多种目标语言
- 🎨 **现代界面** - 美观的图形界面，实时日志显示
- ⚙️ **灵活配置** - 可配置 API 密钥、翻译设置等
- ⌨️ **快捷键支持** - F1开始录音，F2停止录音

## 界面预览

### 主界面
- 录音控制按钮
- 实时状态显示
- 日志输出窗口
- 转写和翻译结果显示

### 设置界面
- OpenAI API 配置
- 翻译语言设置
- 录音参数调整

## 安装要求

### 系统要求
- Node.js 16+ 
- Python 3.8+
- 支持的操作系统：Windows、macOS、Linux

### Python 依赖
```bash
pip install sounddevice soundfile numpy openai
```

### Node.js 依赖
```bash
npm install
```

## 快速开始

### 1. 克隆项目
```bash
git clone <项目地址>
cd electron
```

### 2. 安装依赖
```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
pip install sounddevice soundfile numpy openai
```

### 3. 配置 OpenAI API
- 启动应用后，点击"设置"按钮
- 输入您的 OpenAI API 密钥
- 可选择配置自定义 API 地址（支持兼容 OpenAI API 的服务）

### 4. 启动应用
```bash
npm start
```

## 使用方法

### 基本操作
1. **开始录音**：点击"🎤 开始录音"按钮或按 F1 键
2. **停止录音**：点击"⏹️ 停止录音"按钮或按 F2 键
3. **查看结果**：转写和翻译结果会实时显示在日志面板中

### 设置配置
1. **打开设置**：点击"⚙️ 设置"按钮或按 Ctrl+, 键
2. **API 配置**：
   - 输入 OpenAI API 密钥（必需）
   - 设置自定义 API 地址（可选）
   - 测试 API 连接
3. **翻译设置**：
   - 启用/禁用自动翻译
   - 选择目标语言
4. **录音设置**：
   - 调整静音检测阈值
   - 设置自动分段时长

### 快捷键
- `F1` - 开始录音
- `F2` - 停止录音  
- `Ctrl+,` - 打开设置
- `Ctrl+Q` - 退出程序

## 文件结构

```
electron/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本
├── index.html           # 主界面
├── renderer.js          # 主界面逻辑
├── settings.html        # 设置界面
├── settings.js          # 设置界面逻辑
├── transcribe_service.py # Python 转写服务
├── package.json         # Node.js 项目配置
├── config.json          # 应用配置文件（自动生成）
└── recordings/          # 临时录音文件目录（自动生成）
```

## 配置文件说明

应用会在当前目录生成 `config.json` 配置文件：

```json
{
  "openai_api_key": "your-api-key",
  "openai_base_url": "https://api.openai.com/v1",
  "enable_translation": true,
  "translate_language": "中文",
  "silence_rms_threshold": 0.01,
  "min_silence_seconds": 1.0
}
```

### 配置项说明
- `openai_api_key`: OpenAI API 密钥
- `openai_base_url`: API 服务地址
- `enable_translation`: 是否启用翻译功能
- `translate_language`: 翻译目标语言
- `silence_rms_threshold`: 静音检测阈值（0.005-0.02）
- `min_silence_seconds`: 自动分段的静音时长（秒）

## 开发模式

启动开发模式（会打开开发者工具）：
```bash
npm run dev
```

## 构建打包

本项目已内置基于 electron-builder 的打包配置，并支持将 Python 后端打包为独立可执行文件，从而在 Windows 上无需安装 Python。

### Windows 无 Python 依赖的打包

1) 安装依赖（在 Windows 上操作）

- Node.js 16+
- Python 3.8+，并安装以下包：
  ```bash
  pip install pyinstaller sounddevice soundfile numpy openai
  ```
- 安装 Node 依赖（首次）：
  ```bash
  npm install
  ```

2) 打包 Python 服务（生成独立 exe）

方式A：使用 npm 脚本（推荐）
```bat
npm run build:py:win
```

方式B：直接使用 PyInstaller（等价）
```bat
pyinstaller --noconsole --onefile --name transcribe_service transcribe_service.py
if not exist dist-python mkdir dist-python
if not exist dist-python\win mkdir dist-python\win
copy /Y dist\transcribe_service.exe dist-python\win\
```

开发提示：
- 在 Windows 开发环境中，如果在项目目录存在 `dist\transcribe_service.exe` 或 `dist-python\win\transcribe_service.exe`，Electron 启动时会优先直接运行该 exe，而不会调用系统 Python 解释器。

成功后会生成 `dist-python\win\transcribe_service.exe`，Electron 打包时会将其内置到应用中。

3) 打包 Windows 安装包/便携版

```bash
npm run dist:win
```

构建产物位于 `dist/`，包含安装器（NSIS）或便携包。

注意：如果你在非 Windows 环境打包 Windows 版本，建议在 Windows 主机或 CI 上进行，以确保 PyInstaller 和本地依赖的兼容性。

### 配置文件存放位置（打包后）

- 开发模式：项目目录下 `config.json`
- 打包后：系统用户数据目录（例如 Windows: `%AppData%/Voice Transcript/config.json`）


## 常见问题

### 1. Python 依赖安装失败
确保 Python 版本 3.8+，并尝试：
```bash
pip install --upgrade pip
pip install sounddevice soundfile numpy openai
```

### 2. 录音设备无法识别
- 检查系统录音设备权限
- 在设置中刷新设备列表
- 确保录音设备驱动正常

### 3. API 调用失败
- 检查 API 密钥是否正确
- 确认网络连接正常
- 验证 API 地址配置

### 4. 转写结果为空
- 检查录音音量是否足够
- 调整静音检测阈值
- 确保录音时长超过1秒

## 技术架构

- **前端**: Electron (HTML/CSS/JavaScript)
- **后端**: Python 3.8+
- **通信**: 进程间通信 (IPC) + JSON 消息
- **录音**: sounddevice + soundfile
- **转写**: OpenAI gpt-4o-transcribe
- **翻译**: OpenAI gpt-4o-mini

## 许可证

本项目采用 MIT 许可证，详见 LICENSE 文件。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进项目。

## 更新日志

### v1.0.0
- 初始版本
- 基本录音、转写、翻译功能
- 图形界面和设置页面
- 快捷键支持
