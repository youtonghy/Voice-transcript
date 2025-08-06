#!/bin/bash

# 语音转写翻译安卓应用构建脚本

echo "🚀 开始构建语音转写翻译安卓应用..."

# 检查系统
echo "📋 检查系统环境..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "✅ Linux 系统检测通过"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "✅ macOS 系统检测通过"
else
    echo "❌ 不支持的操作系统: $OSTYPE"
    exit 1
fi

# 检查 Python
echo "🐍 检查 Python 环境..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安装"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo "✅ Python 版本: $PYTHON_VERSION"

# 检查 Buildozer
echo "🔨 检查 Buildozer..."
if ! command -v buildozer &> /dev/null; then
    echo "📦 安装 Buildozer..."
    pip3 install buildozer
fi

# 检查依赖
echo "📦 安装 Python 依赖..."
pip3 install -r requirements.txt

# 创建必要的目录
echo "📁 创建项目目录..."
mkdir -p bin
mkdir -p .buildozer

# 检查配置文件
if [ ! -f "config.json" ]; then
    echo "⚙️  创建默认配置文件..."
    cat > config.json << EOF
{
  "azure_openai_api_key": "",
  "azure_openai_endpoint": "",
  "translate_language": "中文"
}
EOF
fi

# 构建 APK
echo "🏗️  开始构建 APK..."
echo "选择构建类型:"
echo "1) 调试版本 (debug)"
echo "2) 发布版本 (release)"
echo "3) 仅构建不安装 (build only)"

read -p "请选择 (1/2/3): " build_choice

case $build_choice in
    1)
        echo "🔧 构建调试版本..."
        buildozer android debug
        ;;
    2)
        echo "📦 构建发布版本..."
        buildozer android release
        ;;
    3)
        echo "🏗️  仅构建 APK..."
        buildozer android debug
        ;;
    *)
        echo "❌ 无效选择，退出"
        exit 1
        ;;
esac

# 检查构建结果
if [ $? -eq 0 ]; then
    echo "✅ 构建成功!"
    echo "📂 APK 文件位置:"
    find bin -name "*.apk" -exec ls -lh {} \;
    
    # 询问是否安装到设备
    read -p "是否安装到连接的 Android 设备? (y/n): " install_choice
    if [[ $install_choice == [Yy]* ]]; then
        echo "📱 安装到设备..."
        buildozer android deploy run
    fi
else
    echo "❌ 构建失败，请检查错误信息"
    exit 1
fi

echo "🎉 构建完成!"