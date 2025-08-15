#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 OpenAI 官方格式的 gpt-4o-transcribe 进行语音转写。

示例（官方风格）：

from openai import OpenAI

client = OpenAI()
audio_file = open("/path/to/file/speech.mp3", "rb")

transcription = client.audio.transcriptions.create(
    model="gpt-4o-transcribe",
    file=audio_file,
    response_format="text"
)

print(transcription.text)

运行：
  OPENAI_API_KEY=sk-xxx python gpt4o_transcribe.py --file recordings/recording_xxx.wav
"""

import argparse
import os
import sys

try:
    from openai import OpenAI
except ImportError:
    print("未安装 openai 库。请先运行: pip install openai", file=sys.stderr)
    sys.exit(1)


def transcribe(file_path: str) -> str:
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"音频文件不存在: {file_path}")

    # 使用官方 SDK 客户端（需要设置环境变量 OPENAI_API_KEY）
    client = OpenAI()

    with open(file_path, "rb") as audio_file:
        # gpt-4o-transcribe 模型无需提示词，直接传文件即可
        result = client.audio.transcriptions.create(
            model="gpt-4o-transcribe",
            file=audio_file,
            response_format="text",
        )

    # 官方示例中使用 result.text，如果 SDK 返回的是纯文本，可直接打印
    return getattr(result, "text", str(result))


def main():
    parser = argparse.ArgumentParser(description="使用 gpt-4o-transcribe 转写音频文件")
    parser.add_argument("--file", required=True, help="待转写的音频文件路径，如 WAV/MP3/MP4/M4A 等")
    args = parser.parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        print("未检测到 OPENAI_API_KEY 环境变量。请先设置 OpenAI API Key。", file=sys.stderr)
        sys.exit(2)

    try:
        text = transcribe(args.file)
        print(text)
    except Exception as e:
        print(f"转写失败: {e}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()

