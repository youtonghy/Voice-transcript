# VoiceTT

![](https://github.com/youtonghy/Voice-transcript/blob/dev/electron/PixPin_2025-09-25_14-05-47.png?raw=true)

## 项目简介

https://vtt.tokisantike.net/

VoiceTT 桌面版基于 Electron 与 Python 后端,移动端基于React Native。它支持实时录音、自动分段、语音转写以及可选翻译，让会议记录、访谈整理和学习笔记更高效。

## 核心特性
- 一键录音与停止，自动保存临时音频片段
- 静音检测结合最小时长限制，避免不完整分段
- 调用可配置的 OpenAI, Soniox, Qwen 等兼容接口进行语音识别
- 可选翻译功能，支持多语言输出
- 通过 设置 界面即时修改阈值、模型和 API 设置
- 支持媒体快速翻译
- 支持语音输入

## 下载

请前往[Releases](https://github.com/youtonghy/VoiceTT/releases)页面下载

## 开发计划

- [x] 图形化
- [x] 原生开发
- [ ] 适配苹果全家桶
- [ ] 改用现代编程语言开发
- [ ] 支持本地模型
- [ ] 集成语音输入法
- [ ] ...

## 快速开始

1. 安装依赖
   ```
   npm install
   ```
2. 启动开发环境
   ```
   npm start
   ```
3. 首次启动后在設定界面填写 API Key、基地址和翻译选项。



