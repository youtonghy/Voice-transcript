#!/usr/bin/env python3
"""
创建 APK 文件的模拟脚本
由于环境限制，提供 APK 创建指导和模拟文件
"""

import os
import zipfile
import json
import base64
import shutil
from pathlib import Path

def create_apk_structure():
    """创建 APK 文件结构"""
    
    # 创建必要的目录结构
    apk_dirs = [
        'apk_build/assets',
        'apk_build/lib/arm64-v8a',
        'apk_build/lib/armeabi-v7a',
        'apk_build/res',
        'apk_build/smali',
        'apk_build/META-INF'
    ]
    
    for dir_path in apk_dirs:
        os.makedirs(dir_path, exist_ok=True)
    
    return apk_dirs

def create_android_manifest():
    """创建 AndroidManifest.xml"""
    manifest = '''<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.voicetranscriber"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk
        android:minSdkVersion="21"
        android:targetSdkVersion="33" />

    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:label="语音转写翻译"
        android:icon="@mipmap/ic_launcher"
        android:allowBackup="true"
        android:theme="@style/AppTheme">
        
        <activity
            android:name="org.kivy.android.PythonActivity"
            android:label="语音转写翻译"
            android:configChanges="mcc|mnc|locale|touchscreen|keyboard|keyboardHidden|navigation|orientation|screenLayout|fontScale|uiMode|screenSize|smallestScreenSize"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
'''
    
    with open('apk_build/AndroidManifest.xml', 'w', encoding='utf-8') as f:
        f.write(manifest)
    
    return manifest

def create_resources():
    """创建基础资源文件"""
    
    # 创建基础资源
    res_content = {
        'strings.xml': '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">语音转写翻译</string>
</resources>
''',
        'colors.xml': '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#FF5722</color>
    <color name="colorPrimaryDark">#E64A19</color>
    <color name="colorAccent">#FF9800</color>
</resources>
''',
        'styles.xml': '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>
</resources>
'''
    }
    
    # 创建 res/values 目录
    os.makedirs('apk_build/res/values', exist_ok=True)
    
    for filename, content in res_content.items():
        with open(f'apk_build/res/values/{filename}', 'w', encoding='utf-8') as f:
            f.write(content)
    
    return res_content

def create_python_loader():
    """创建 Python 加载器"""
    
    loader_script = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音转写翻译 APK 主程序
"""

import sys
import os

# 添加路径
sys.path.insert(0, os.path.join(os.environ['ANDROID_ARGUMENT']))

# 导入主应用
from voicetranscriber import VoiceTranscriberApp

if __name__ == '__main__':
    VoiceTranscriberApp().run()
'''
    
    with open('apk_build/main.py', 'w', encoding='utf-8') as f:
        f.write(loader_script)
    
    return loader_script

def create_apk_metadata():
    """创建 APK 元数据"""
    
    metadata = {
        "app_name": "语音转写翻译",
        "package_name": "com.example.voicetranscriber",
        "version_code": 1,
        "version_name": "1.0.0",
        "min_sdk": 21,
        "target_sdk": 33,
        "permissions": [
            "RECORD_AUDIO",
            "WRITE_EXTERNAL_STORAGE",
            "READ_EXTERNAL_STORAGE",
            "INTERNET"
        ],
        "features": [
            "语音录制",
            "语音转文字",
            "自动翻译",
            "本地配置管理"
        ]
    }
    
    with open('apk_build/apk_metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    
    return metadata

def create_install_guide():
    """创建安装指南"""
    
    guide = '''# 语音转写翻译 APK 安装指南

## 📱 安装步骤

### 1. 获取 APK
由于环境限制，请使用以下方法之一：

#### 方法A：Google Colab 构建
1. 打开 https://colab.research.google.com/
2. 运行提供的 Colab 脚本
3. 下载生成的 APK 文件

#### 方法B：本地构建
1. 在 Ubuntu 系统上运行：
   ```bash
   sudo apt install buildozer
   buildozer android debug
   ```

#### 方法C：使用预构建 APK
- 联系开发者获取最新版本
- 或从发布页面下载

### 2. 安装 APK
1. **启用未知来源**：
   - 设置 → 安全 → 允许未知来源应用
   
2. **安装应用**：
   - 找到下载的 APK 文件
   - 点击安装

### 3. 首次使用
1. **授予权限**：
   - 录音权限
   - 存储权限
   - 网络权限

2. **配置 API**：
   - 点击右上角 ⚙️ 设置按钮
   - 输入 Azure OpenAI API Key
   - 输入 Endpoint URL
   - 选择翻译目标语言

### 4. 使用应用
1. **录音**：按住红色按钮开始录音
2. **停止**：松开按钮自动处理
3. **查看结果**：转写和翻译结果实时显示

## 🔧 配置示例

创建 `config.json` 文件：
```json
{
  "azure_openai_api_key": "your-api-key-here",
  "azure_openai_endpoint": "https://your-resource.openai.azure.com/",
  "translate_language": "中文"
}
```

## 📋 Azure OpenAI 设置

1. **创建资源**：
   - 访问 https://portal.azure.com
   - 创建 "Azure OpenAI" 资源

2. **部署模型**：
   - 部署 `gpt-4o-audio-preview`（语音转写）
   - 部署 `gpt-4o-mini`（文本翻译）

3. **获取凭据**：
   - 从 "密钥和终结点" 获取 API Key
   - 复制 Endpoint URL

## 🚀 快速开始

1. 下载 APK 文件
2. 安装并授予权限
3. 配置 Azure OpenAI
4. 开始使用语音转写翻译功能

## 📞 技术支持

如有问题，请检查：
- 网络连接
- API 配置正确性
- 权限设置
- 应用日志
'''
    
    with open('INSTALL_GUIDE.md', 'w', encoding='utf-8') as f:
        f.write(guide)
    
    return guide

def main():
    """主函数 - 创建 APK 构建环境"""
    
    print("🔧 创建 APK 构建环境...")
    
    # 清理旧的构建
    if os.path.exists('apk_build'):
        import shutil
        shutil.rmtree('apk_build')
    
    # 创建目录结构
    create_apk_structure()
    
    # 创建必要文件
    create_android_manifest()
    create_resources()
    create_python_loader()
    create_apk_metadata()
    create_install_guide()
    
    # 复制主应用
    shutil.copy('voicetranscriber.py', 'apk_build/voicetranscriber.py')
    shutil.copy('simple_buildozer.spec', 'apk_build/buildozer.spec')
    
    # 创建配置文件
    config = {
        "azure_openai_api_key": "请在此输入你的 Azure OpenAI API Key",
        "azure_openai_endpoint": "https://你的资源名.openai.azure.com/",
        "translate_language": "中文"
    }
    
    with open('apk_build/config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    # 创建构建脚本
    build_script = '''#!/bin/bash
# APK 构建脚本

echo "🚀 开始构建语音转写翻译 APK..."

# 检查 buildozer
if ! command -v buildozer &> /dev/null; then
    echo "📦 安装 buildozer..."
    pip3 install --user buildozer cython
fi

# 进入构建目录
cd apk_build

# 复制主文件
cp voicetranscriber.py main.py

# 构建 APK
echo "🏗️  构建 APK..."
buildozer android debug

echo "✅ 构建完成！"
echo "📱 APK 文件位置: bin/voicetranscriber-debug.apk"
'''
    
    with open('apk_build/build_apk.sh', 'w', encoding='utf-8') as f:
        f.write(build_script)
    
    os.chmod('apk_build/build_apk.sh', 0o755)
    
    # 创建 Google Colab 脚本
    colab_script = '''# Google Colab 构建脚本
# 在 https://colab.research.google.com/ 中运行

!apt-get update -y
!apt-get install -y python3-pip openjdk-8-jdk build-essential \
    libffi-dev libssl-dev libsqlite3-dev pkg-config libjpeg-dev

!pip install buildozer cython kivy numpy

# 克隆项目
!git clone https://github.com/yourusername/voice-transcriber-android.git
%cd voice-transcriber-android

# 构建 APK
!buildozer android debug

# 下载 APK
from google.colab import files
import glob

apk_files = glob.glob('bin/*.apk')
if apk_files:
    files.download(apk_files[0])
    print("✅ APK 已下载！")
else:
    print("❌ APK 构建失败")
'''
    
    with open('build_in_colab.ipynb', 'w', encoding='utf-8') as f:
        f.write(colab_script)
    
    print("\n" + "="*60)
    print("📦 APK 构建环境已创建完成!")
    print("="*60)
    
    print("\n📁 文件结构:")
    for root, dirs, files in os.walk('apk_build'):
        level = root.replace('apk_build', '').count(os.sep)
        indent = ' ' * 2 * level
        print(f"{indent}{os.path.basename(root)}/")
        subindent = ' ' * 2 * (level + 1)
        for file in files[:5]:  # 只显示前5个文件
            print(f"{subindent}{file}")
        if len(files) > 5:
            print(f"{subindent}... 还有 {len(files)-5} 个文件")
    
    print(f"\n🚀 构建步骤:")
    print("1. 复制项目到 Ubuntu 系统")
    print("2. 运行: cd apk_build && ./build_apk.sh")
    print("3. 或使用 Google Colab: 上传 build_in_colab.ipynb")
    print("4. APK 将生成在: apk_build/bin/voicetranscriber-debug.apk")
    
    print(f"\n📱 文件大小:")
    total_size = 0
    for root, dirs, files in os.walk('apk_build'):
        for file in files:
            file_path = os.path.join(root, file)
            total_size += os.path.getsize(file_path)
    
    print(f"总大小: {total_size/1024:.1f} KB")
    
    # 创建压缩包
    with zipfile.ZipFile('voice-transcriber-apk-source.zip', 'w') as zipf:
        for root, dirs, files in os.walk('apk_build'):
            for file in files:
                file_path = os.path.join(root, file)
                arc_path = os.path.relpath(file_path, 'apk_build')
                zipf.write(file_path, arc_path)
    
    print(f"\n📦 源码包已创建: voice-transcriber-apk-source.zip")
    
    return "apk_build/"

if __name__ == "__main__":
    build_dir = main()