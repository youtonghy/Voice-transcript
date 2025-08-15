## 录音转写脚本说明

本目录提供两种方式使用 `gpt-4o-transcribe` 模型进行语音转写：

- `openai_transcribe_translate.py`：按热键开始/停止录音，自动分段、自动转写，可选翻译。
- `gpt4o_transcribe.py`：对已有音频文件做一次性转写的最小示例。

## 依赖
- Python 3.8+
- 一键安装：

```bash
pip install -r requirements.txt
```

- 也可按需安装：
  - 最少：`pip install openai`
  - 录音脚本需要：`pip install sounddevice soundfile numpy keyboard`
- 环境变量：`OPENAI_API_KEY=sk-...`（或在 `config.json` 中设置 `openai_api_key`）
- 可选代理/自定义基址：`OPENAI_BASE_URL`

## 热键录音与自动分段（openai_transcribe_translate.py）

特点与行为：
- 单键开关录音：按一次开始，再按一次停止（`record_key`）。
- 仅用 RMS 判断“开始/结束”录制，片段内保留完整原始音频（不丢静音帧）。
- 连续静音达到阈值（默认 1.0s）即自动切段并立即发起转写；拿到结果后立刻打印。
- 为避免开头丢字，段开始时会把此前最多 `pre_roll_seconds`（默认 1.0s）的原始音频一并纳入片段。
- 控制台输出：检测到语音开始打印“开始”；切段或停止打印“结束”；随后打印转写结果（以及可选翻译）。
- 文件存储：每段会先写入 `recordings/recording_*.wav`，转写完成后默认会删除音频文件（失败时保留）。
- 时长/大小：停止录音后打印该次录音的“时长/大小（MB）”。自动分段时为保持简洁，不额外打印该行。

使用步骤：
1) 将 `config.example.json` 复制为 `config.json` 并按需修改：

```json
{
  "record_key": "ctrl+alt",
  "device_id": null,
  "translate_language": "中文",
  "enable_translation": true,
  "silence_rms_threshold": 0.01,
  "min_silence_seconds": 1.0,
  "pre_roll_seconds": 1.0,
  "openai_api_key": "",
  "openai_base_url": ""
}
```

- `record_key`：录音开关快捷键（按一次开始/再按一次停止）。
- `device_id`：音频输入设备 ID，`null` 为默认设备。首次运行可交互选择并保存。
- `enable_translation`：是否启用翻译；若为 `false` 则不询问语言且不翻译。
- `translate_language`：启用翻译时的目标语言（默认中文）。
- `silence_rms_threshold`：RMS 静音阈值，越小越敏感。
- `min_silence_seconds`：连续静音达到该秒数即切段并转写。
- `pre_roll_seconds`：语音开始时向前包含的音频时长，避免丢第一个词。
- `openai_api_key`/`openai_base_url`：也可用环境变量 `OPENAI_API_KEY`/`OPENAI_BASE_URL`。

2) 运行：

```bash
python openai_transcribe_translate.py
```

3) 操作：
- 控制台会提示当前热键与设备信息。
- 按一次热键开始，检测到语音时打印“开始”；静音超过阈值自动打印“结束”，并立即发起转写、打印结果。
- 再按一次热键手动停止，会打印“结束”，随后对最后一段转写并打印，同时显示“时长/大小（MB）”。

## 文件转写示例（gpt4o_transcribe.py）

最小示例：

```python
from openai import OpenAI

client = OpenAI()
audio_file = open("/path/to/file/speech.mp3", "rb")

transcription = client.audio.transcriptions.create(
    model="gpt-4o-transcribe",
    file=audio_file,
    response_format="text"
)

print(transcription.text)
```

或直接执行：

```bash
OPENAI_API_KEY=sk-xxx python gpt4o_transcribe.py --file recordings/recording_20250101_120000.wav
```

> 提示：`gpt-4o-transcribe` 不需要任何系统提示词或额外说明，上传音频后会直接返回转写文本。
