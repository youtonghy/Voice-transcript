#!/usr/bin/env python3
"""
替代构建方案 - 由于环境限制，提供 APK 构建的指导方案
"""

import os
import json
import shutil
import subprocess
import sys
from pathlib import Path

def create_prebuilt_apk_guide():
    """创建预构建 APK 指南"""
    
    guide_content = """
# 预构建 APK 获取指南

由于当前环境限制，无法直接构建 APK，以下是获取和使用 APK 的完整指南：

## 🚀 获取 APK 的三种方法

### 方法1：使用 Google Colab 构建 (推荐)

1. **打开 Google Colab**:
   - 访问 https://colab.research.google.com/
   - 创建新的笔记本

2. **运行构建脚本**:
   ```python
   # 在 Colab 中运行
   !git clone https://github.com/your-repo/voice-transcriber-android.git
   %cd voice-transcriber-android
   
   # 安装依赖
   !apt update && apt install -y python3-pip openjdk-8-jdk
   !pip install buildozer cython
   
   # 构建 APK
   !buildozer android debug
   
   # 下载 APK
   from google.colab import files
   files.download('bin/voicetranscriber-debug.apk')
   ```

### 方法2：使用 Replit 构建

1. **访问 Replit**: https://replit.com/
2. **创建 Python 项目**
3. **上传项目文件**
4. **在 Shell 中运行**:
   ```bash
   pip install buildozer
   buildozer android debug
   ```

### 方法3：本地 Linux 构建 (Ubuntu/Debian)

#### 系统要求
- Ubuntu 20.04+ 或 Debian 10+
- 至少 8GB RAM
- 20GB 可用磁盘空间

#### 安装步骤
```bash
# 1. 安装系统依赖
sudo apt update
sudo apt install -y python3-pip python3-setuptools git zip unzip openjdk-8-jdk
sudo apt install -y build-essential libffi-dev libssl-dev libsqlite3-dev pkg-config
sudo apt install -y libjpeg-dev libbz2-dev libexpat1-dev libgdbm-dev libncurses5-dev
sudo apt install -y libreadline-dev zlib1g-dev libffi-dev liblzma-dev python3-dev

# 2. 安装 Python 工具
pip3 install --user buildozer cython kivy numpy openai sounddevice soundfile

# 3. 设置环境变量
echo 'export PATH=$PATH:~/.local/bin' >> ~/.bashrc
source ~/.bashrc

# 4. 构建 APK
cd /path/to/project
buildozer android debug

# 5. APK 位置
# APK 将生成在: bin/voicetranscriber-debug.apk
```

## 📱 应用安装和使用

### 安装 APK
1. **启用未知来源**: 设置 > 安全 > 允许未知来源
2. **传输 APK**: 通过 USB、蓝牙或云存储传输
3. **安装应用**: 点击 APK 文件安装

### 首次使用
1. **授予权限**: 允许录音、存储和网络权限
2. **配置 API**: 点击右上角设置按钮 ⚙️
3. **输入配置**:
   - Azure OpenAI API Key
   - Azure OpenAI Endpoint
   - 翻译目标语言
4. **开始录音**: 按住红色按钮录音，松开自动处理

## 🔧 配置文件模板

创建 `config.json`:
```json
{
  "azure_openai_api_key": "your-azure-openai-key-here",
  "azure_openai_endpoint": "https://your-resource-name.openai.azure.com/",
  "translate_language": "中文"
}
```

## 📋 Azure OpenAI 设置指南

### 1. 创建资源
- 访问 https://portal.azure.com
- 创建 "Azure OpenAI" 资源
- 选择区域和定价层

### 2. 部署模型
- 在 Azure OpenAI Studio 中部署:
  - `gpt-4o-audio-preview` (用于语音转写)
  - `gpt-4o-mini` (用于翻译)

### 3. 获取凭据
- 从 Azure 门户获取:
  - API Key (从资源的"密钥和终结点")
  - Endpoint URL

## 🚀 一键构建脚本

使用提供的构建脚本:
```bash
chmod +x build_android.sh
./build_android.sh
```

## 📦 预构建 APK 下载

由于环境限制，你可以:

1. **使用提供的脚本**: `build_android.sh`
2. **云端构建**: Google Colab 或 Replit
3. **本地构建**: 按照 Ubuntu 指南

## 🐛 常见问题解决

### 构建失败
```bash
# 清理并重新构建
buildozer android clean
buildozer android debug
```

### 权限问题
- 确保 AndroidManifest.xml 包含必要权限
- 在 Android 设置中手动授予权限

### 音频问题
- 检查设备麦克风权限
- 确认音频驱动正常

## 🔗 资源链接

- [Buildozer 文档](https://buildozer.readthedocs.io/)
- [Kivy 文档](https://kivy.org/doc/stable/)
- [Azure OpenAI 文档](https://learn.microsoft.com/azure/ai-services/openai/)

## 📧 支持

如需预构建 APK 或技术支持，请:
1. 按照上述指南自行构建
2. 使用云端构建服务
3. 联系开发者获取构建好的 APK

---
**注意**: 由于当前环境限制，无法直接生成 APK 文件，但提供了完整的构建指南和替代方案。
"""

    # 保存指南
    with open('APK_BUILD_GUIDE.md', 'w', encoding='utf-8') as f:
        f.write(guide_content)
    
    print("📋 APK 构建指南已创建: APK_BUILD_GUIDE.md")
    
    return guide_content

def create_docker_build_script():
    """创建 Docker 构建脚本"""
    
    dockerfile = '''FROM ubuntu:20.04

# 避免交互式配置
ENV DEBIAN_FRONTEND=noninteractive

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-setuptools \
    git \
    zip \
    unzip \
    openjdk-8-jdk \
    build-essential \
    libffi-dev \
    libssl-dev \
    libsqlite3-dev \
    pkg-config \
    libjpeg-dev \
    libbz2-dev \
    libexpat1-dev \
    libgdbm-dev \
    libncurses5-dev \
    libreadline-dev \
    zlib1g-dev \
    libffi-dev \
    liblzma-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
RUN pip3 install --no-cache-dir buildozer cython kivy numpy openai sounddevice soundfile

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 设置环境变量
ENV PATH=$PATH:/root/.local/bin

# 构建命令
CMD ["buildozer", "android", "debug"]
'''

    build_script = '''#!/bin/bash
# Docker 构建脚本

echo "🐳 使用 Docker 构建 APK..."

# 构建 Docker 镜像
docker build -t voice-transcriber-builder .

# 运行容器并构建 APK
docker run -it --rm \
  -v $(pwd):/app \
  -v $(pwd)/bin:/app/bin \
  voice-transcriber-builder

echo "✅ 构建完成！APK 文件在 bin/ 目录中"
'''

    with open('Dockerfile', 'w') as f:
        f.write(dockerfile)
    
    with open('docker_build.sh', 'w') as f:
        f.write(build_script)
    
    os.chmod('docker_build.sh', 0o755)
    
    print("🐳 Docker 构建文件已创建")
    print("  - Dockerfile")
    print("  - docker_build.sh")

def create_github_actions_workflow():
    """创建 GitHub Actions 工作流"""
    
    workflow_dir = '.github/workflows'
    os.makedirs(workflow_dir, exist_ok=True)
    
    workflow = '''name: Build Android APK

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.8'
    
    - name: Install system dependencies
      run: |
        sudo apt-get update
        sudo apt-get install -y python3-pip openjdk-8-jdk build-essential \
          libffi-dev libssl-dev libsqlite3-dev pkg-config libjpeg-dev
    
    - name: Install buildozer
      run: |
        pip install --user buildozer cython
        echo "$HOME/.local/bin" >> $GITHUB_PATH
    
    - name: Build APK
      run: |
        buildozer android debug
    
    - name: Upload APK
      uses: actions/upload-artifact@v3
      with:
        name: voicetranscriber-apk
        path: bin/*.apk
'''

    with open(f'{workflow_dir}/build.yml', 'w') as f:
        f.write(workflow)
    
    print("🔄 GitHub Actions 工作流已创建")

if __name__ == "__main__":
    print("🔧 创建 APK 构建解决方案...")
    
    # 创建所有构建方案
    guide = create_prebuilt_apk_guide()
    create_docker_build_script()
    create_github_actions_workflow()
    
    print("\n" + "="*50)
    print("📦 APK 构建解决方案已准备完成!")
    print("="*50)
    print("\n可用选项:")
    print("1. 查看 APK_BUILD_GUIDE.md - 完整构建指南")
    print("2. 使用 Dockerfile - Docker 容器构建")
    print("3. 使用 GitHub Actions - 云端自动构建")
    print("4. 使用 build_android.sh - 本地一键构建")
    
    print("\n📱 由于环境限制，推荐方法:")
    print("1. Google Colab (最简单)")
    print("2. 本地 Ubuntu 系统")
    print("3. 使用提供的 Docker 方案")