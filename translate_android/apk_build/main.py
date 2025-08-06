#!/usr/bin/env python3
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
