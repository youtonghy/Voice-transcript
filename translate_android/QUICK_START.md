# 语音转写翻译安卓应用 - 快速开始

## 🚀 立即开始

### 1. 环境准备

**Linux (推荐 Ubuntu)**:
```bash
# 安装系统依赖
sudo apt update
sudo apt install -y python3-pip python3-setuptools git zip unzip openjdk-8-jdk
sudo apt install -y build-essential libffi-dev libssl-dev libsqlite3-dev
sudo apt install -y libffi-dev libssl-dev libjpeg-dev libsqlite3-dev pkg-config
sudo apt install -y libbz2-dev libexpat1-dev libgdbm-dev libncurses5-dev
sudo apt install -y libreadline-dev libsqlite3-dev libssl-dev zlib1g-dev
sudo apt install -y libffi-dev liblzma-dev python3-dev

# 安装 Python 依赖
pip3 install -r android_requirements.txt
```

### 2. 配置 Azure OpenAI

1. 创建 `config.json` 文件：
```json
{
  "azure_openai_api_key": "你的-api-key",
  "azure_openai_endpoint": "https://你的资源名.openai.azure.com/",
  "translate_language": "中文"
}
```

2. 在 Azure 门户创建 OpenAI 资源：
   - 创建 "Azure OpenAI" 资源
   - 部署 "gpt-4o-audio-preview" 模型
   - 部署 "gpt-4o-mini" 模型用于翻译
   - 获取 API Key 和 Endpoint

### 3. 构建 APK

#### 一键构建
```bash
# 赋予执行权限
chmod +x build_android.sh

# 运行构建脚本
./build_android.sh
```

#### 手动构建
```bash
# 调试版本
buildozer android debug

# 发布版本
buildozer android release

# 安装到设备
buildozer android deploy run
```

### 4. 测试应用

#### 桌面测试
```bash
# 安装桌面依赖
pip3 install kivy numpy openai sounddevice soundfile

# 运行桌面版本
python3 main.py
```

#### Android 测试
```bash
# 构建并安装
buildozer android debug deploy run
```

### 5. 文件结构

```
.
├── main.py              # 主应用代码
├── buildozer.spec       # Android 构建配置
├── config.json          # API 配置（需手动创建）
├── requirements.txt     # Python 依赖
├── android_requirements.txt  # Android 专用依赖
├── build_android.sh     # 一键构建脚本
├── test_app.py          # 功能测试脚本
└── README.md           # 详细文档
```

### 6. 使用说明

1. **首次启动**：授予录音和存储权限
2. **配置 API**：点击右上角 ⚙️ 设置按钮，输入 Azure OpenAI 配置
3. **录音**：按住红色按钮开始录音，松开自动停止
4. **查看结果**：转写和翻译结果会实时显示

### 7. 常见问题

**构建失败？**
```bash
# 清理并重新构建
buildozer android clean
buildozer android debug
```

**权限问题？**
- 确保在 Android 设置中授予应用所有必要权限
- 录音权限、存储权限、网络权限

**依赖问题？**
```bash
# 重新安装依赖
pip3 install --upgrade -r requirements.txt
```

### 8. 快速验证

运行测试脚本检查配置：
```bash
python3 test_app.py
```

### 9. 获取帮助

- 查看 `README.md` 获取详细文档
- 运行 `./build_android.sh` 获取交互式构建帮助
- 检查 `config.json` 确保 Azure 配置正确

## 🎯 下一步

1. 配置好 Azure OpenAI 后运行应用
2. 授予必要的权限
3. 开始录音并查看转写结果
4. 根据需要调整翻译语言设置