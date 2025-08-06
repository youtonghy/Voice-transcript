# 语音转写翻译 APK 安装指南

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
