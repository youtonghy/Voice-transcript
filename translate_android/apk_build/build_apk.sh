#!/bin/bash
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
