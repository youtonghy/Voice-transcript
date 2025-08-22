# Voice Transcript (Electron)

一个基于 Electron + Python 的跨平台桌面应用：实时录音 → 自动分段 → 语音转写 → 可选翻译，全流程一键完成。

> 适用于：会议纪要、直播听写、访谈整理、学习笔记、多语言听读辅助。

---
## 功能亮点
- 🎤 实时录音：支持一键开始/停止，快捷键 F1 / F2
- ✂️ 智能分段：静音检测 + 最小时长限制，避免半句截断
- 📝 高质量转写：调用 OpenAI gpt-4o-transcribe（可改自定义基地址）
- 🌐 自动翻译：可选启用，目标语言可配置（例：中文 / English / 日本語 ...）
- ⚙️ 自适应配置：阈值、静音时长、翻译、模型、API 地址可动态修改
- 📜 实时日志：界面中即时显示处理状态与结果
- 🧩 前后端解耦：Python 独立服务，可单独更新 / 替换
- 🛠️ 打包免 Python：Windows 下内置 Nuitka 产物，零依赖运行
- ⌨️ 快捷键支持：录音控制、设置、退出

---
## 目录速览
```
.
├── main.js                # Electron 主进程
├── preload.js             # 预加载（安全桥接）
├── renderer.js            # 主界面逻辑
├── index.html             # 主界面 UI
├── settings.html / .js    # 设置页面
├── transcribe_service.py  # Python 转写/翻译服务
├── openai_transcribe_translate.py # 可能的模型调用逻辑支持
├── config.json            # 运行期生成/更新（开发模式）
├── recordings/            # 临时分段 WAV 文件
├── dist-python/win/       # 打包后 Python EXE 存放
└── package.json           # 项目配置与脚本
```

---
## 快速开始 (开发模式)
### 1. 克隆仓库
```bash
git clone <your-repo-url>
cd Voice-transcript/electron
```
### 2. 安装 Node 依赖
```bash
npm install
```
### 3. 安装 Python 依赖（开发调试需要）
```bash
pip install --upgrade pip
pip install sounddevice soundfile numpy openai nuitka
```
### 4. 启动应用
```bash
npm start       # 普通启动
# 或
npm run dev     # 开启开发者工具
```
### 5. 首次配置
打开应用 → 进入【设置】 → 填写 OpenAI API Key（可选自定义 Base URL）→ 选择翻译语言 → 保存。

---
## 常用脚本 (package.json)
| 命令 | 说明 |
|------|------|
| npm start | 启动应用 |
| npm run dev | 启动并自动打开 DevTools |
| npm run build | 仅 Electron 打包（不含安装包差异平台产物定义）|
| npm run build:py:win | 使用 Nuitka 打包 Python 服务 (transcribe_service.exe) |
| npm run dist:win | 先打包 Python，再生成 Windows 安装包 (NSIS) |

---
## 配置说明
开发模式下生成 `config.json`；打包后迁移到系统用户数据目录：
- Windows: `%AppData%/Voice Transcript/config.json`
- macOS: `~/Library/Application Support/Voice Transcript/config.json`
- Linux: `~/.config/Voice Transcript/config.json`

示例：
```json
{
  "openai_api_key": "sk-***",
  "openai_base_url": "https://api.openai.com/v1",
  "enable_translation": true,
  "translate_language": "中文",
  "silence_rms_threshold": 0.01,
  "min_silence_seconds": 1.0
}
```
字段说明：
| 键 | 用途 | 建议范围 / 备注 |
|----|------|----------------|
| openai_api_key | OpenAI 或兼容服务密钥 | 必填（除非走本地模型改造） |
| openai_base_url | API 基地址 | 兼容自托管 / 中转服务 |
| enable_translation | 是否启用翻译 | false 仅输出原文 |
| translate_language | 翻译目标语言 | 例：中文 / English |
| silence_rms_threshold | 静音 RMS 阈值 | 0.005 ~ 0.02 越低越敏感 |
| min_silence_seconds | 判定分段静音时长 | 0.5 ~ 2.0 之间调优 |

---
## 使用指南
1. F1 或 “开始录音” → 开始捕获麦克风音频
2. 后台实时缓存并监测音量 → 静音 + 达到最小时长后切分段
3. 每段发送至 Python 服务 → 调用 OpenAI 转写
4. 若开启翻译 → 翻译文本合并展示
5. 界面日志区持续刷新 → 可复制结果
6. F2 或 “停止录音” → 停止新分段，收尾处理

快捷键：
| 快捷键 | 功能 |
|--------|------|
| F1 | 开始录音 |
| F2 | 停止录音 |
| Ctrl + , | 打开设置 |
| Ctrl + Q | 退出应用 |

---
## 打包与分发
### 1. 打包独立 Python 后端 (Windows)
```bash
npm run build:py:win
# 结果: dist-python/win/transcribe_service.exe
```
### 2. 生成 Windows 安装包 / 可分发版本
```bash
npm run dist:win
# 产物: dist/ 下的安装程序 (NSIS)
```
其他平台（需自行补充 Nuitka 构建脚本）：
```bash
# 示例（需根据平台调整）
nuitka --onefile --disable-console transcribe_service.py
npm run build
```
> 跨平台打包包含本地音频库差异，建议在目标平台或对应 CI Runner 上构建。

---
## 工作原理概览
1. Electron 主进程拉起窗口 + 预加载脚本隔离上下文
2. Renderer 捕获用户操作，录音（Web Audio / 麦克风）→ 写入临时 WAV
3. 录音分段触发时，通过子进程/可执行文件调用 Python EXE
4. Python 使用 soundfile / numpy 读取音频 → 调用 OpenAI 语音模型（gpt-4o-transcribe）
5. 获得文本后可二次调用文本模型（gpt-4o-mini 或同类）完成翻译
6. 结果通过 IPC 回传渲染层 → 日志区展示 & 聚合输出

---
## 调优建议
| 目标 | 可调整项 | 策略 |
|------|----------|------|
| 减少误分段 | min_silence_seconds ↑ | 设为 1.2 - 1.5s |
| 更灵敏开启/结束 | silence_rms_threshold ↓ | 0.008 → 0.006 |
| 翻译更地道 | 模型/提示词 | 修改 Python 中翻译调用逻辑 |
| 降低成本 | 关闭翻译 / 减少段数 | 更长分段 + 后处理 |

---
## 常见问题 (FAQ)
Q: 转写为空？
A: 音量过低 / 段太短，调低阈值或延长讲话；确认麦克风权限。

Q: 翻译很慢？
A: 同段需要两次模型调用，可关闭翻译或改用更快模型。

Q: Windows 无法录音？
A: 系统声音设置里授予麦克风权限；确认没有被其他软件独占。

Q: 自定义 API 服务？
A: 在设置里修改 Base URL，并确保接口遵循 OpenAI 兼容格式。

Q: 如何清理临时音频？
A: recordings/ 目录可安全删除（运行中删除需谨慎）。

---
## 安全 & 隐私
- API Key 仅保存在本地配置文件，不上传
- 未内置外部遥测 / 埋点
- 如需企业合规，可将 openai_base_url 指向内网代理

---
## 未来路线 (Roadmap)
- [ ] 多模型选择下拉
- [ ] 批量导出 (TXT / SRT / Markdown)
- [ ] 自定义热键配置
- [ ] 段级时间戳同步
- [ ] 自动更新检查
- [ ] 翻译缓存与增量提示

欢迎提出 Issue / PR！

---
## 贡献指南
1. Fork / 创建分支
2. 提交规范化 Commit（建议 feat: / fix: / docs: 前缀）
3. PR 说明动机 & 截图（UI改动）
4. 确保本地可运行，无严重 Lint / 语法错误

---
## 许可证
MIT © 2025 youtonghy

---
## 版本初始说明
v1.0.0: 基础录音 / 分段 / 转写 / 翻译 / 快捷键 / 设置完成。

---
> 如果你觉得这个项目有帮助，欢迎 Star 支持 :)
