# 语音转写翻译安卓应用

基于 Kivy 框架的安卓应用，支持语音录制、转写和翻译功能。

## 功能特点

- 📱 原生安卓应用界面
- 🎤 按住录音，松开自动停止
- 📝 自动语音转文字（基于 Azure OpenAI）
- 🌍 自动翻译为指定语言
- ⚙️ 右上角设置按钮配置 API Key
- 📊 实时显示转写和翻译结果

## 安装和运行

### 开发环境准备

1. **安装 Python 依赖**
   ```bash
   pip install -r requirements.txt
   ```

2. **Linux/Ubuntu 构建环境**
   ```bash
   # 安装系统依赖
   sudo apt update
   sudo apt install -y python3-pip python3-setuptools git zip unzip openjdk-8-jdk
   
   # 安装 Buildozer
   pip install buildozer
   
   # 安装 Android SDK/NDK 依赖
   sudo apt install -y build-essential libffi-dev libssl-dev libsqlite3-dev
   sudo apt install -y libffi-dev libssl-dev libjpeg-dev libsqlite3-dev
   sudo apt install -y libbz2-dev libexpat1-dev libgdbm-dev libncurses5-dev
   sudo apt install -y libreadline-dev libsqlite3-dev libssl-dev
   sudo apt install -y zlib1g-dev libffi-dev liblzma-dev python3-dev
   ```

### 配置 Azure OpenAI

1. 在 Azure 门户创建 OpenAI 资源
2. 获取 API Key 和 Endpoint
3. 在应用中点击右上角设置按钮配置：
   - Azure OpenAI API Key
   - Azure OpenAI Endpoint
   - 翻译目标语言（默认：中文）

### 构建 APK

#### 方法1：使用 Buildozer（推荐）

```bash
# 初始化 Buildozer（如果还没有 buildozer.spec）
buildozer init

# 构建调试 APK
buildozer android debug

# 构建发布 APK
buildozer android release

# 安装到设备
buildozer android deploy run
```

#### 方法2：使用 Python-for-Android

```bash
# 创建分发包
p4a apk --private . --package=com.example.voicetranscriber \
  --name "语音转写翻译" --version 1.0 \
  --bootstrap=sdl2 --requirements=python3,kivy,numpy,openai,sounddevice,soundfile \
  --arch=arm64-v8a --permissions=RECORD_AUDIO,WRITE_EXTERNAL_STORAGE,READ_EXTERNAL_STORAGE,INTERNET
```

### 在桌面测试

```bash
# 桌面环境测试
python main.py
```

## 文件结构

```
.
├── main.py              # 主应用文件
├── buildozer.spec       # Buildozer 构建配置
├── requirements.txt     # Python 依赖
├── config.json          # 应用配置文件（自动生成）
└── README.md           # 本说明文档
```

## 使用说明

1. **首次使用**：点击右上角设置按钮，配置 Azure OpenAI 的 API Key 和 Endpoint
2. **录音**：按住红色录音按钮开始录音，松开按钮自动停止并处理
3. **查看结果**：转写结果和翻译结果会分别显示在下方文本区域
4. **设置语言**：在设置中可以修改翻译目标语言

## 权限要求

应用需要以下权限：
- `RECORD_AUDIO`：录音权限
- `WRITE_EXTERNAL_STORAGE`：写入外部存储
- `READ_EXTERNAL_STORAGE`：读取外部存储
- `INTERNET`：网络访问权限

## 故障排除

### 常见问题

1. **音频录制失败**
   - 确保应用有录音权限
   - 检查设备麦克风是否正常工作
   - 确认已安装 `sounddevice` 和 `soundfile`

2. **转写失败**
   - 检查 Azure OpenAI API Key 和 Endpoint 是否正确
   - 确认网络连接正常
   - 检查音频文件是否有效

3. **构建失败**
   - 确保所有系统依赖已安装
   - 检查 Python 版本是否兼容
   - 尝试清理构建缓存：`buildozer android clean`

### Android 特定问题

1. **权限请求**
   - 首次启动时会自动请求必要权限
   - 如果拒绝权限，需要在系统设置中手动开启

2. **音频格式**
   - 使用 WAV 格式确保兼容性
   - 采样率：44.1kHz，单声道

## 开发说明

### 技术栈

- **UI 框架**：Kivy
- **音频处理**：sounddevice + soundfile
- **AI 服务**：Azure OpenAI (GPT-4o-audio-preview)
- **构建工具**：Buildozer
- **目标平台**：Android 5.0+ (API 21+)

### 自定义开发

可以通过修改以下部分来自定义应用：

1. **UI 样式**：修改 `main.py` 中的 Kivy 组件属性
2. **转写提示**：修改 `transcribe_audio_file` 方法中的系统提示
3. **翻译逻辑**：修改 `translate_text` 方法中的翻译提示
4. **音频参数**：调整录音采样率和通道数

## 许可证

MIT License - 详见 LICENSE 文件