# Voice-transcript 王易转

一个使用 Python 与 OpenAI 模型进行语音转写/翻译的小工具集合。

## 目录结构

- `transcribe_translate`: 脚本主目录，包含更完整的使用说明与示例。详见 `transcribe_translate/README.md`。
- `transcribe_gui`: 图形界面程序（开发中）。当前仅为占位目录，功能持续迭代中。

## 快速开始（脚本）

1) 安装依赖：
```bash
pip install -r transcribe_translate/requirements.txt
```

2) 配置与运行（热键录音、自动分段、可选翻译）：
```bash
cd transcribe_translate
cp config.example.json config.json   # 首次使用可拷贝示例并按需修改
python openai_transcribe_translate.py
```

更多功能说明（参数、环境变量、文件转写示例等）请查看 `transcribe_translate/README.md`。

## 系统要求

- Python 3.8+
- Windows/macOS/Linux
- 麦克风设备（录音脚本）

## 注意

- 请妥善保管 API 密钥，避免提交到仓库。
- GUI 版本仍在开发中，后续会在 `transcribe_gui` 目录更新使用说明与安装方式。
