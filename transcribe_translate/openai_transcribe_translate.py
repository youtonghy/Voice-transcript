#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按快捷键录音并转写翻译脚本
按下指定的快捷键开始/停止录音（单击切换），录音结束后自动转写并可选翻译。
"""

import time
import threading
import os
import json
from datetime import datetime
import sounddevice as sd
import soundfile as sf
import numpy as np
import keyboard
try:
    # OpenAI 官方客户端（用于转写与翻译）
    from openai import OpenAI as OpenAIClient
except Exception:
    OpenAIClient = None

# -------- 配置 --------
# 录音快捷键将从 config.json 文件中读取
SAMPLE_RATE = 44100   # 采样率
CHANNELS = 1          # 单声道
DTYPE = 'float32'     # 数据类型
OUTPUT_DIR = 'recordings'  # 录音文件输出目录

# 自动分段参数（满足：连续静音>=阈值 即切分）
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
# 简单能量阈值（RMS），低于此视为静音
SILENCE_RMS_THRESHOLD = 0.010
# 片段开始时向前包含的预滚动时长（秒），用于避免漏掉第一个词
PRE_ROLL_SECONDS = 1.0

# 全局变量（将从配置文件加载）
RECORD_KEY = 'ctrl+alt'  # 默认录音快捷键（按一下开始/再按一下停止）

DEFAULT_TARGET_LANGUAGE = "中文"  # 默认翻译目标语言

# -------- OpenAI 配置（用于转写与翻译）--------
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"
openai_client = None

# 全局变量
is_recording = False
audio_data = []  # 当前段的音频块列表
recording_thread = None
last_toggle_time = 0.0

# 分段检测相关
audio_lock = threading.Lock()
print_lock = threading.Lock()
segment_frames = 0
silence_frames_contig = 0
split_requested = False
segment_index = 1
segment_active = False           # 是否处于语音段内
new_segment_requested = False    # 请求开始新段（用于在主循环中打印“开始”）
pre_roll_chunks = []             # 段前缓冲：静音时累计的原始数据
pre_roll_frames = 0              # 段前缓冲帧数

def ensure_output_dir():
    """确保输出目录存在"""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"已创建录音目录: {OUTPUT_DIR}")

def load_config():
    """读取配置文件"""
    config_file = "config.json"
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return config
        except Exception as e:
            print(f"读取配置文件失败: {e}")
            return {}
    return {}

def save_config(config):
    """保存配置文件"""
    config_file = "config.json"
    try:
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"配置已保存到 {config_file}")
    except Exception as e:
        print(f"保存配置文件失败: {e}")

def init_openai_client(config):
    """初始化 OpenAI 官方客户端（用于 gpt-4o-transcribe 与翻译）"""
    global openai_client
    
    if OpenAIClient is None:
        print("未安装 openai 官方 SDK，无法使用 gpt-4o-transcribe。可运行: pip install openai")
        openai_client = None
        return False

    # 优先从环境变量读取
    api_key = os.environ.get("OPENAI_API_KEY") or config.get("openai_api_key")
    base_url = os.environ.get("OPENAI_BASE_URL") or config.get("openai_base_url")

    if not api_key:
        print("未检测到 OPENAI_API_KEY，gpt-4o-transcribe 将不可用。")
        openai_client = None
        return False

    try:
        if base_url:
            openai_client = OpenAIClient(api_key=api_key, base_url=base_url)
        else:
            openai_client = OpenAIClient(api_key=api_key)
        print("OpenAI 客户端已初始化")
        return True
    except Exception as e:
        print(f"OpenAI 客户端初始化失败: {e}")
        openai_client = None
        return False

def list_audio_devices():
    """列出所有可用的音频输入设备"""
    print("\n可用的音频输入设备:")
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device['max_input_channels'] > 0:
            print(f"  {i}: {device['name']} (输入通道: {device['max_input_channels']})")
    print()

def get_device_info(device_id=None):
    """获取设备信息"""
    if device_id is not None:
        device_info = sd.query_devices(device_id, 'input')
        sample_rate = int(device_info['default_samplerate'])
        max_channels = device_info['max_input_channels']
    else:
        device_info = sd.query_devices(kind='input')
        sample_rate = int(device_info['default_samplerate'])
        max_channels = device_info['max_input_channels']
    
    return sample_rate, max_channels

def audio_callback(indata, frames, time, status):
    """音频录制回调函数"""
    global audio_data, segment_frames, silence_frames_contig, split_requested
    if status:
        print(f"录音状态: {status}")
    
    if is_recording:
        # 将音频数据添加到列表中，并统计能量与静音时长
        with audio_lock:
            # 计算当前块的 RMS
            try:
                rms = float(np.sqrt(np.mean(np.square(indata))))
            except Exception:
                rms = 0.0

            # 仅用 RMS 决定开始/结束；段内不丢弃任何帧
            global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames

            # 非段内：维护预滚动缓冲（静音区也保留，不超过 PRE_ROLL_SECONDS）
            if not segment_active:
                pre_roll_chunks.append(indata.copy())
                pre_roll_frames += frames
                max_pre = int(PRE_ROLL_SECONDS * SAMPLE_RATE)
                while pre_roll_frames > max_pre and pre_roll_chunks:
                    drop = pre_roll_chunks.pop(0)
                    pre_roll_frames -= len(drop)

            # 检测进入语音：开启新段，并把预滚动缓冲并入段
            if not segment_active and rms >= SILENCE_RMS_THRESHOLD:
                new_segment_requested = True
                segment_active = True
                # 初始化段统计
                segment_frames = 0
                silence_frames_contig = 0
                # 合并预滚
                if pre_roll_chunks:
                    for ch in pre_roll_chunks:
                        audio_data.append(ch)
                        segment_frames += len(ch)
                    pre_roll_chunks = []
                    pre_roll_frames = 0

            # 段内：无论静音与否，保存原始数据
            if segment_active:
                audio_data.append(indata.copy())
                segment_frames += frames
                if rms < SILENCE_RMS_THRESHOLD:
                    silence_frames_contig += frames
                    if silence_frames_contig >= int(MIN_SILENCE_SEC_FOR_SPLIT * SAMPLE_RATE):
                        split_requested = True
                        segment_active = False
                else:
                    silence_frames_contig = 0

def start_recording():
    """开始录音"""
    global is_recording, audio_data, recording_thread
    global segment_frames, silence_frames_contig, split_requested, segment_index
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    
    if is_recording:
        return
    
    # 不立即打印红点；等待检测到非静音后再在主循环中打印
    is_recording = True
    with audio_lock:
        audio_data = []
        segment_frames = 0
        silence_frames_contig = 0
        split_requested = False
        segment_index = 1
    # 段状态初始化：静音中，等待语音出现时开始新段
    segment_active = False
    new_segment_requested = False
    pre_roll_chunks = []
    pre_roll_frames = 0
    
    
    # 在新线程中开始录音
    recording_thread = threading.Thread(target=record_audio)
    recording_thread.start()

def record_audio():
    """录音线程"""
    global is_recording, split_requested, segment_index, audio_data
    global new_segment_requested
    
    try:
        # 使用选定的设备录音
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback
        ):
            while is_recording:
                # 如果有新段请求：打印“开始”
                if new_segment_requested:
                    # with print_lock:
                        # print("开始")
                    new_segment_requested = False
                # 处理分段请求（避免在回调内做重操作）
                if split_requested:
                    # 取出当前段并清空，开始下一段
                    with audio_lock:
                        local_chunks = audio_data
                        audio_data = []
                        # 重置计数
                        from_split = True
                        # 重置统计变量
                        global segment_frames, silence_frames_contig
                        segment_frames = 0
                        silence_frames_contig = 0
                        split_requested = False
                        seg_idx = segment_index
                        segment_index += 1
                    # 段结束时打印“结束”
                    # with print_lock:
                    #     print("结束")
                    # 在后台处理该段，避免阻塞录音
                    threading.Thread(
                        target=process_segment_chunks,
                        args=(local_chunks, seg_idx, from_split),
                        daemon=True,
                    ).start()
                sd.sleep(100)  # 检查间隔
    except Exception as e:
        print(f"录音错误: {e}")

def stop_recording():
    """停止录音并保存文件"""
    global is_recording, audio_data, recording_thread, segment_active
    
    if not is_recording:
        return
    
    # 打印结束标记（如果当前有正在录的段或尚有音频未保存）
    # with print_lock:
    #     if segment_active or audio_data:
    #         print("结束")
    is_recording = False
    
    # 等待录音线程结束
    if recording_thread and recording_thread.is_alive():
        recording_thread.join()
    
    # 保存最后一段音频
    had_audio = False
    if audio_data:
        save_audio_file()
        had_audio = True
    if not had_audio:
            print("没有录制到音频数据")

def save_audio_file():
    """保存最后一段音频文件（在停止时调用）"""
    global audio_data
    # 复制后清空，避免重复使用
    with audio_lock:
        local_chunks = audio_data
        audio_data = []
    process_segment_chunks(local_chunks, None, from_split=False)

def process_segment_chunks(chunks, seg_idx=None, from_split=False):
    """将音频块合并、保存、转写/翻译并清理"""
    try:
        if not chunks:
            print("没有音频数据可保存")
            return
        combined_audio = np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
        process_combined_audio(combined_audio, seg_idx, from_split=from_split)
    except Exception as e:
        print(f"处理音频段时出错: {e}")

def process_combined_audio(combined_audio: np.ndarray, seg_idx=None, from_split: bool=False):
    """保存合并后的音频数组并转写翻译"""
    try:
        # 生成文件名（使用时间戳 + 段号）
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if seg_idx is not None:
            filename = f"recording_{timestamp}_seg{seg_idx}.wav"
        else:
            filename = f"recording_{timestamp}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)

        # 保存为 WAV 文件
        sf.write(filepath, combined_audio, SAMPLE_RATE)

        duration = len(combined_audio) / SAMPLE_RATE
        size_bytes = os.path.getsize(filepath)
        size_mb = size_bytes / (1024 * 1024)
        with print_lock:
            if not from_split:
                print(f"时长: {duration:.2f}s  大小: {size_mb:.2f} MB")

        # 自动进行音频转写
        transcription = transcribe_audio_file(filepath)
        if transcription:
            # 加载配置以获取翻译语言设置与开关
            config = load_config()
            target_language = config.get('translate_language', DEFAULT_TARGET_LANGUAGE)
            enable_translation = config.get('enable_translation', True)

            # 精简输出：仅两行，第一行转写，第二行翻译（若启用）
            lines = [transcription.strip()]
            if enable_translation and target_language and target_language.strip():
                translation = translate_text(transcription, target_language)
                if translation:
                    lines.append(translation.strip())

            # 立即输出（无论是否由分段触发），紧跟在“结束”之后
            with print_lock:
                for line in lines:
                    print(line)

            # 转写完成后删除音频文件
            try:
                os.remove(filepath)
            except Exception as delete_error:
                print(f"删除音频文件失败: {delete_error}")
        else:
            print("转写失败，保留音频文件")
    except Exception as e:
        print(f"保存/转写音频文件时出错: {e}")



def translate_text(text, target_language=DEFAULT_TARGET_LANGUAGE):
    """使用 OpenAI 翻译文本"""
    global openai_client
    
    if not openai_client:
        # 精简输出：避免冗余提示
        return None
    
    if not text or not text.strip():
        print("没有文本需要翻译")
        return None
    
    # 精简输出：不打印进行中提示
    
    try:
        # 准备翻译提示
        system_prompt = f"""你是一个专业的翻译助手。请将用户提供的文本翻译为{target_language}。

翻译要求：
1. 保持原文的语气和风格
2. 确保翻译准确自然
3. 如果原文已经是{target_language}，请直接返回原文
4. 只返回翻译结果，不要添加任何解释或说明"""

        chat_messages = [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": text
            }
        ]
        
        # 调用翻译模型
        response = openai_client.chat.completions.create(
            model=OPENAI_TRANSLATE_MODEL,
            messages=chat_messages,
            max_tokens=5000,
            temperature=0.1,
            top_p=0.95,
            frequency_penalty=0,
            presence_penalty=0,
            stop=None,
            stream=False
        )
        
        translation = response.choices[0].message.content.strip()
        return translation
        
    except Exception as e:
        print(f"翻译失败: {e}")
        return None

def transcribe_audio_file(filepath):
    """使用 OpenAI gpt-4o-transcribe 转写音频文件。"""
    global openai_client

    # 精简输出：不打印进行中提示

    if openai_client is None:
        print("OpenAI 客户端未配置，无法转写")
        return None

    try:
        with open(filepath, "rb") as audio_file:
            result = openai_client.audio.transcriptions.create(
                model=OPENAI_TRANSCRIBE_MODEL,
                file=audio_file,
                response_format="text",
            )
        return getattr(result, "text", str(result))
    except Exception as e:
        print(f"gpt-4o-transcribe 转写失败: {e}")
        return None

def on_toggle_hotkey():
    """切换录音（按一下开始，再按一下停止）"""
    global last_toggle_time
    now = time.time()
    # 简单去抖，避免一次按键触发两次
    if now - last_toggle_time < 0.4:
        return
    last_toggle_time = now
    if is_recording:
        stop_recording()
    else:
        start_recording()

def setup_keyboard_listener():
    """设置键盘监听"""
    print(f"按 '{RECORD_KEY}' 开始/停止录音")
    print("录音文件将保存到 recordings/ 目录")
    print("按 Ctrl+C 退出程序")
    
    # 仅注册单一切换型快捷键
    try:
        keyboard.add_hotkey(RECORD_KEY, on_toggle_hotkey, suppress=False, timeout=2)
    except Exception:
        pass

def main():
    """主函数"""
    print("按快捷键录音程序")
    print("=" * 40)
    
    # 确保输出目录存在
    ensure_output_dir()
    
    # 加载配置
    config = load_config()
    saved_device_id = config.get('device_id')
    
    # 加载录音快捷键配置
    global RECORD_KEY
    RECORD_KEY = config.get('record_key', RECORD_KEY)
    print(f"录音快捷键: {RECORD_KEY}")
    
    # 初始化 OpenAI 客户端
    openai_initialized = init_openai_client(config)

    if not openai_initialized:
        print("   如果只需要录音功能，可以忽略此提示")
        print("   要启用 AI 转写与翻译，请配置 OpenAI:")
        print('   设置环境变量或在 config.json 中写入 "OPENAI_API_KEY" / "openai_api_key"')
        print()
    else:
        enable_translation = config.get('enable_translation', True)
        if enable_translation:
            print("   录音后将自动转写为文字并翻译（使用 OpenAI）")

            # 显示当前翻译语言（如已设置）
            if 'translate_language' in config and str(config.get('translate_language', '')).strip():
                current_translate_language = config.get('translate_language')
                print(f"   当前翻译目标语言: {current_translate_language}")
            else:
                # 未设置语言且启用了翻译，询问一次
                try:
                    change_language = input("设置翻译语言? (输入语言名或按回车使用默认中文): ").strip()
                    if change_language:
                        config['translate_language'] = change_language
                        save_config(config)
                        print(f"翻译语言已更新为: {change_language}")
                except KeyboardInterrupt:
                    print("\n跳过语言设置")
            print()
        else:
            print("   录音后将自动转写为文字（未启用翻译）")

    # 读取静音阈值与静音时长配置（可选）
    global SILENCE_RMS_THRESHOLD, MIN_SILENCE_SEC_FOR_SPLIT, PRE_ROLL_SECONDS
    try:
        v = config.get('silence_rms_threshold')
        if v is not None:
            SILENCE_RMS_THRESHOLD = float(v)
    except Exception:
        pass
    try:
        v = config.get('min_silence_seconds')
        if v is not None:
            MIN_SILENCE_SEC_FOR_SPLIT = float(v)
    except Exception:
        pass
    try:
        v = config.get('pre_roll_seconds')
        if v is not None:
            PRE_ROLL_SECONDS = max(0.0, float(v))
    except Exception:
        pass
    
    device_id = None
    
    if saved_device_id is not None:
        # 检查保存的设备是否仍然存在
        try:
            devices = sd.query_devices()
            if saved_device_id < len(devices) and devices[saved_device_id]['max_input_channels'] > 0:
                device_name = devices[saved_device_id]['name']
                print(f"使用已保存的录音设备: [{saved_device_id}] {device_name}")
                device_id = saved_device_id
            else:
                print("保存的设备不再可用，请重新选择")
                saved_device_id = None
        except Exception as e:
            print(f"检查保存的设备时出错: {e}")
            saved_device_id = None
    
    if saved_device_id is None:
        # 列出可用设备并询问用户选择
        list_audio_devices()
        
        try:
            device_input = input("请选择输入设备ID (按回车使用默认设备): ").strip()
            if device_input:
                device_id = int(device_input)
                # 验证设备是否有效
                devices = sd.query_devices()
                if device_id < len(devices) and devices[device_id]['max_input_channels'] > 0:
                    # 保存用户选择到配置文件
                    config['device_id'] = device_id
                    config['record_key'] = RECORD_KEY
                    if 'translate_language' not in config:
                        config['translate_language'] = DEFAULT_TARGET_LANGUAGE
                    save_config(config)
                else:
                    print("无效的设备ID，使用默认设备")
                    device_id = None
            else:
                # 用户选择默认设备，保存这个选择
                config['device_id'] = None
                config['record_key'] = RECORD_KEY
                if 'translate_language' not in config:
                    config['translate_language'] = DEFAULT_TARGET_LANGUAGE
                save_config(config)
        except ValueError:
            print("输入无效，使用默认设备")
            device_id = None
            config['device_id'] = None
            config['record_key'] = RECORD_KEY
            if 'translate_language' not in config:
                config['translate_language'] = DEFAULT_TARGET_LANGUAGE
            save_config(config)
    
    # 获取设备信息并调整参数
    global SAMPLE_RATE, CHANNELS
    try:
        device_sample_rate, max_channels = get_device_info(device_id)
        print(f"设备默认采样率: {device_sample_rate}Hz")
        print(f"设备最大通道数: {max_channels}")
        
        # 使用设备的默认采样率
        SAMPLE_RATE = device_sample_rate
        
        # 确保通道数不超过设备支持的最大值
        if CHANNELS > max_channels:
            CHANNELS = max_channels
            
        # 设置默认输入设备
        if device_id is not None:
            sd.default.device[0] = device_id
            
    except Exception as e:
        print(f"获取设备信息失败: {e}，使用默认设置")
    
    print(f"使用采样率: {SAMPLE_RATE}Hz, 通道数: {CHANNELS}")
    print()
    
    # 设置键盘监听
    setup_keyboard_listener()
    
    try:
        # 保持程序运行
        keyboard.wait()
    except KeyboardInterrupt:
        print("\n程序退出")
    finally:
        # 如果正在录音，停止录音
        if is_recording:
            stop_recording()

if __name__ == "__main__":
    main()
