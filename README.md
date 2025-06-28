# Voice-transcript

这是一个简单的使用python实现调用openai模型进行语音转文字的程序。

## 功能介绍

### 1. 实时录音转写 (realtime_transcribe.py)
连续录音并实时转写为文字，适合长时间的语音记录。

### 2. 按键录音 (openai_transcribe.py)
按下指定快捷键开始录音，松开快捷键停止录音并保存音频文件。

## 安装依赖

```bash
pip install -r requirements.txt
```

## 使用方法

### 按键录音脚本

```bash
python openai_transcribe.py
```

#### 功能特点：
- 🎯 **快捷键控制**：默认使用空格键，按住开始录音，松开停止录音
- 💾 **自动保存**：录音文件自动保存到 `recordings/` 目录
- 🎙️ **高质量录音**：支持多种音频设备和采样率
- ⏱️ **时间戳命名**：文件名包含录音时间，便于管理
- 🔧 **可配置**：可自定义快捷键、采样率等参数
- 🤖 **AI 转写**：集成 Azure OpenAI gpt-4o-audio-preview 模型，自动转写为文字
- ⌨️ **智能输入**：转写完成后自动输入到当前光标位置，如同语音输入法
- 💾 **设备记忆**：自动保存录音设备选择，下次启动无需重新配置
- 🗑️ **自动清理**：转写完成后自动删除临时音频文件

#### 配置选项：
在脚本顶部可以修改以下配置：

**录音配置：**
- `RECORD_KEY`：录音快捷键（默认：'space'）
- `SAMPLE_RATE`：采样率（默认：44100Hz）
- `CHANNELS`：声道数（默认：1，单声道）
- `OUTPUT_DIR`：输出目录（默认：'recordings'）
- `AUTO_INPUT_ENABLED`：自动输入功能（默认：True）

**Azure OpenAI 配置（通过 config.json）：**
- `azure_openai_api_key`：您的 Azure OpenAI API 密钥
- `azure_openai_endpoint`：您的 Azure OpenAI 服务端点

配置示例（在 config.json 中）：
```json
{
  "device_id": 1,
  "azure_openai_api_key": "your-api-key-here",
  "azure_openai_endpoint": "https://your-resource.openai.azure.com/"
}
```

#### 支持的快捷键格式：
- 单个键：`'space'`, `'f1'`, `'a'` 等
- 组合键：`'ctrl+r'`, `'alt+f1'`, `'shift+space'` 等

#### 使用步骤：

**首次使用（配置 Azure OpenAI）：**
1. 程序首次运行会自动创建 `config.json` 配置文件
2. 编辑 `config.json` 文件，添加您的 Azure OpenAI 配置：
   ```json
   {
     "device_id": null,
     "azure_openai_api_key": "您的API密钥",
     "azure_openai_endpoint": "https://您的资源名.openai.azure.com/"
   }
   ```
3. 也可以参考 `config.example.json` 示例文件

**运行录音：**
1. 运行脚本后，会自动检查 `config.json` 配置文件
2. **首次运行**：列出可用设备，选择后自动保存配置
3. **后续运行**：直接使用保存的设备，无需重新选择
4. 按住空格键（或自定义快捷键）开始录音，松开停止录音
5. 录音文件临时保存到 `recordings/` 目录
6. 如果配置了 Azure OpenAI，录音后会自动转写并显示文字结果
7. **智能输入**：转写完成后，程序会给您3秒时间切换到目标应用
8. 转写结果自动输入到当前光标位置（如文档、聊天框等）
9. 转写完成后自动删除临时音频文件
10. 按 Ctrl+C 退出程序

### 实时录音转写脚本

```bash
python realtime_transcribe.py
```

需要配置 OpenAI API Key 和 base_url。

## 系统要求

- Python 3.7+
- Windows/macOS/Linux
- 麦克风设备

## 注意事项

- 确保麦克风权限已开启
- Windows 用户可能需要以管理员权限运行脚本以使用键盘监听功能
- 录音文件为 WAV 格式，音质较高但文件较大
- Azure OpenAI 配置是可选的，不配置也可以正常录音
- 使用 Azure OpenAI 转写功能需要有效的 API 密钥和额度
- gpt-4o-audio-preview 模型支持多语言转写，会自动识别语言
- 自动输入功能需要管理员权限，如遇到权限问题可以禁用此功能
- 使用自动输入时，请确保目标应用处于活动状态并且光标已定位

## 配置文件

程序会在根目录自动创建 `config.json` 文件保存设置：

```json
{
  "device_id": 1,
  "azure_openai_api_key": "your-api-key-here",
  "azure_openai_endpoint": "https://your-resource.openai.azure.com/"
}
```

- `device_id`: 保存的录音设备ID（null 表示使用默认设备）
- `azure_openai_api_key`: Azure OpenAI API 密钥
- `azure_openai_endpoint`: Azure OpenAI 服务端点
- 如果设备不再可用，程序会自动重新询问并更新配置
- **安全提示**: config.json 包含敏感信息，请不要将其提交到代码仓库

## 自动输入功能

转写完成后，程序会：
1. 显示转写结果在控制台
2. 给您 3 秒时间切换到目标应用（如 Word、微信、浏览器等）
3. 自动将转写结果输入到当前光标位置
4. 适用于任何支持文本输入的应用程序

**使用技巧：**
- 录音前先将光标定位到目标位置
- 转写完成后快速切换到目标应用
- 如不需要自动输入，可在脚本中设置 `AUTO_INPUT_ENABLED = False`