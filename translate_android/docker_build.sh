#!/bin/bash
# Docker 构建脚本

echo "🐳 使用 Docker 构建 APK..."

# 构建 Docker 镜像
docker build -t voice-transcriber-builder .

# 运行容器并构建 APK
docker run -it --rm   -v $(pwd):/app   -v $(pwd)/bin:/app/bin   voice-transcriber-builder

echo "✅ 构建完成！APK 文件在 bin/ 目录中"
