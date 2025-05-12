import io
import time
import threading

import sounddevice as sd
import soundfile as sf
import numpy as np
import openai

# -------- 配置 --------
# 创建 OpenAI 客户端实例
client = openai.OpenAI(
    api_key="",  # 替换为你的 API Key
    base_url="https://goapi.gptnb.ai/v1"
)
MODEL = "gpt-4o-transcribe"
DURATION = 5           # 每次录音段落的时长（秒）

# 控制录音的标志
recording = False

def list_audio_devices():
    """列出所有可用的音频设备及其支持的采样率和通道数"""
    print("\n可用的音频输入设备:")
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device['max_input_channels'] > 0:
            print(f"{i}: {device['name']} (输入通道: {device['max_input_channels']})")
            print(f"   默认采样率: {device['default_samplerate']}Hz")
    print()
    return devices

def get_supported_samplerate(device_id=None):
    """获取设备支持的采样率"""
    if device_id is not None:
        device_info = sd.query_devices(device_id, 'input')
        return int(device_info['default_samplerate'])
    # 使用默认设备
    return int(sd.query_devices(kind='input')['default_samplerate'])

def get_device_channels(device_id=None):
    """获取设备支持的通道数"""
    if device_id is not None:
        device_info = sd.query_devices(device_id, 'input')
        return device_info['max_input_channels']
    # 使用默认设备
    return sd.query_devices(kind='input')['max_input_channels']

def record_audio_segment(duration, fs, device=None):
    """录制音频片段"""
    channels = get_device_channels(device)
    try:
        audio = sd.rec(int(duration * fs), samplerate=fs, channels=channels, dtype='float32', device=device)
        sd.wait()  # 等待片段录制结束
        
        # 如果是立体声，转为单声道
        if channels > 1:
            audio = audio[:, 0]
            
        return audio
    except Exception as e:
        print(f"录音片段错误: {e}")
        return None

def transcribe_audio(audio_data, fs):
    """将音频转写为文本"""
    if audio_data is None:
        return "录音失败，无法转写"
        
    # 将音频写入内存 WAV
    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, audio_data, fs, format='WAV', subtype='PCM_16')
    wav_buffer.seek(0)

    # 调用 OpenAI 接口
    try:
        resp = client.audio.transcriptions.create(
            model=MODEL,
            file=("audio.wav", wav_buffer),
            response_format="text"  # 只返回纯文本
        )
        return resp
    except Exception as e:
        print(f"转写错误: {e}")
        return f"转写失败: {str(e)}"

def process_audio_segment(segment_count, audio, fs):
    """处理一个音频片段（转写并输出）"""
    # print(f"转写片段 #{segment_count}...")
    text = transcribe_audio(audio, fs)
    if text and text.strip():
        print(f"{text}")
    return text

def record_and_transcribe(fs, device=None):
    """录音并转写的主循环"""
    global recording
    recording = True
    segment_count = 0
    transcription_thread = None
    
    print("\n开始实时录音和转写，每个片段 {} 秒...".format(DURATION))
    print("按 Ctrl+C 停止")
    
    try:
        while recording:
            segment_count += 1
            # print(f"\n录制片段 #{segment_count}...")
            
            # 录制当前片段
            audio = record_audio_segment(DURATION, fs, device)
            # print(f"片段 #{segment_count} 录制完成")
            
            # 如果有上一个转写线程，等待它完成
            if transcription_thread is not None and transcription_thread.is_alive():
                transcription_thread.join()
            
            # 在新线程中处理这个片段
            if audio is not None:
                transcription_thread = threading.Thread(
                    target=process_audio_segment,
                    args=(segment_count, audio, fs)
                )
                transcription_thread.start()
            else:
                print(f"片段 #{segment_count} 录制失败，跳过转写")
    
    except KeyboardInterrupt:
        print("\n收到停止信号")
    except Exception as e:
        print(f"录音转写错误: {e}")
    
    # 等待最后一个转写线程完成
    if transcription_thread is not None and transcription_thread.is_alive():
        transcription_thread.join()
    
    recording = False
    print("录音转写结束")

def main():
    # 列出可用设备
    devices = list_audio_devices()
    
    # 让用户选择设备
    device_id = None
    try:
        device_id_input = input("请选择输入设备ID (按回车使用默认设备): ")
        if device_id_input.strip():
            device_id = int(device_id_input)
    except ValueError:
        device_id = None
    
    # 获取设备支持的采样率
    fs = get_supported_samplerate(device_id)
    print(f"使用设备支持的采样率: {fs}Hz")
    
    # 开始录音和转写
    record_and_transcribe(fs, device_id)
    
    print("程序已停止。")

if __name__ == "__main__":
    main()
