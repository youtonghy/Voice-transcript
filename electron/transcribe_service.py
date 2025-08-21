#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Electron音频转写翻译服务
通过JSON消息与Electron主进程通信
"""

import sys
import json
import time
import threading
import os
import queue
import uuid
from datetime import datetime
import sounddevice as sd
import soundfile as sf
import numpy as np

# 设置标准输出编码为UTF-8
def setup_console_encoding():
    """设置控制台编码为UTF-8，确保中文正确显示"""
    try:
        # 设置环境变量
        os.environ['PYTHONIOENCODING'] = 'utf-8'
        
        # 重新配置标准输出流
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        
        # 对于Windows，尝试设置控制台代码页
        if sys.platform == 'win32':
            try:
                import subprocess
                subprocess.run(['chcp', '65001'], capture_output=True, shell=True)
            except Exception:
                pass
                
    except Exception as e:
        # 如果编码设置失败，至少记录错误
        try:
            print(f"Console encoding setup failed: {e}", file=sys.stderr)
        except Exception:
            pass

# 在导入时就设置编码
setup_console_encoding()

try:
    from openai import OpenAI as OpenAIClient
except Exception:
    OpenAIClient = None

# 配置常量
SAMPLE_RATE = 44100  # 修复：使用标准采样率
CHANNELS = 1
DTYPE = 'float32'
OUTPUT_DIR = 'recordings'

# 自动分段参数
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
SILENCE_RMS_THRESHOLD = 0.010
PRE_ROLL_SECONDS = 1.0

# 剧场模式参数
THEATER_MODE_TARGET_RMS = 0.05  # 目标RMS音量
THEATER_MODE_MAX_GAIN = 10.0    # 最大放大倍数

# OpenAI配置
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"

# 全局变量
openai_client = None
is_recording = False
audio_data = []
recording_thread = None
config = {}

# 分段检测相关
audio_lock = threading.Lock()
segment_frames = 0
silence_frames_contig = 0
split_requested = False
segment_index = 1
segment_active = False
new_segment_requested = False
pre_roll_chunks = []
pre_roll_frames = 0

# 翻译队列相关
translation_queue = queue.PriorityQueue()  # 使用优先级队列确保顺序
translation_worker_thread = None
translation_worker_running = False
translation_counter = 0  # 用于确保翻译顺序
pending_translations = {}  # 存储等待翻译的任务 {result_id: task_info}

def log_message(level, message):
    """发送日志消息到Electron"""
    log_msg = {
        "type": "log",
        "level": level,
        "message": str(message),
        "timestamp": datetime.now().isoformat()
    }
    send_message(log_msg)
    
    # 同时输出到stderr用于调试（只在开发模式下）
    if os.environ.get('ELECTRON_DEBUG') == '1':
        try:
            timestamp = datetime.now().strftime('%H:%M:%S')
            level_tag = f"[{level.upper():5}]"
            debug_output = f"{timestamp} {level_tag} {message}"
            print(debug_output, file=sys.stderr, flush=True)
        except Exception:
            pass

def send_message(message):
    """发送消息到Electron主进程"""
    try:
        json_str = json.dumps(message, ensure_ascii=False)
        print(json_str, flush=True)
        
        # 调试模式下输出到stderr，便于开发者查看
        if os.environ.get('ELECTRON_DEBUG') == '1':
            msg_type = message.get('type', 'unknown')
            msg_content = message.get('message', '')
            if isinstance(msg_content, str) and len(msg_content) > 50:
                msg_content = msg_content[:50] + "..."
            debug_msg = f"[DEBUG] 发送消息: {msg_type} - {msg_content}"
            print(debug_msg, file=sys.stderr, flush=True)
            
    except (OSError, IOError, BrokenPipeError) as e:
        # stdout已关闭或管道断开，静默忽略
        # 这通常发生在Electron主进程关闭时
        pass
    except Exception as e:
        # 其他异常尝试写入stderr，如果也失败则静默忽略
        try:
            error_msg = f"发送消息失败: {e}"
            sys.stderr.write(f"{error_msg}\n")
            sys.stderr.flush()
        except (OSError, IOError, BrokenPipeError):
            pass

def amplify_audio_for_theater_mode(audio_data, target_rms=THEATER_MODE_TARGET_RMS):
    """
    为剧场模式放大音频到正常说话音量
    
    Args:
        audio_data: numpy数组，原始音频数据
        target_rms: 目标RMS音量
    
    Returns:
        numpy数组：放大后的音频数据
    """
    if audio_data is None or len(audio_data) == 0:
        return audio_data
    
    try:
        # 计算当前RMS
        current_rms = np.sqrt(np.mean(np.square(audio_data)))
        
        # 如果当前音量已经够大，不需要放大
        if current_rms >= target_rms:
            return audio_data
        
        # 计算需要的增益
        if current_rms > 0:
            gain = target_rms / current_rms
            gain = min(gain, THEATER_MODE_MAX_GAIN)  # 限制最大增益
        else:
            gain = 1.0
        
        # 应用增益
        amplified_audio = audio_data * gain
        
        # 防止削波（限制在-1到1之间）
        amplified_audio = np.clip(amplified_audio, -1.0, 1.0)
        
        log_message("info", f"剧场模式：音频放大 {gain:.2f}x (RMS: {current_rms:.4f} -> {np.sqrt(np.mean(np.square(amplified_audio))):.4f})")
        
        return amplified_audio
        
    except Exception as e:
        log_message("error", f"音频放大失败: {e}")
        return audio_data

def ensure_output_dir():
    """确保输出目录存在"""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        log_message("info", f"已创建录音目录: {OUTPUT_DIR}")

def check_audio_device():
    """检查音频设备是否可用"""
    global SAMPLE_RATE
    
    try:
        # 检查默认输入设备
        device_info = sd.query_devices(kind='input')
        log_message("info", f"默认输入设备: {device_info['name']}")
        
        # 检查采样率是否支持
        try:
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"音频设备支持采样率 {SAMPLE_RATE}Hz")
            return True
        except Exception as e:
            log_message("warning", f"采样率 {SAMPLE_RATE}Hz 不支持，尝试 16000Hz: {e}")
            # 尝试降低采样率
            SAMPLE_RATE = 16000
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"使用采样率 {SAMPLE_RATE}Hz")
            return True
            
    except Exception as e:
        log_message("error", f"音频设备检查失败: {e}")
        return False

def init_openai_client():
    """初始化OpenAI客户端"""
    global openai_client
    
    if OpenAIClient is None:
        log_message("error", "未安装openai SDK，无法使用转写功能")
        return False

    api_key = config.get("openai_api_key")
    base_url = config.get("openai_base_url")

    if not api_key:
        log_message("error", "未设置API密钥，转写功能不可用")
        return False

    try:
        if base_url:
            openai_client = OpenAIClient(api_key=api_key, base_url=base_url)
        else:
            openai_client = OpenAIClient(api_key=api_key)
        log_message("info", "OpenAI客户端已初始化")
        return True
    except Exception as e:
        log_message("error", f"OpenAI客户端初始化失败: {e}")
        return False

def start_translation_worker():
    """启动翻译工作线程"""
    global translation_worker_thread, translation_worker_running, translation_counter
    
    if translation_worker_thread and translation_worker_thread.is_alive():
        return
    
    # 重置翻译计数器，确保从1开始
    translation_counter = 0
    
    translation_worker_running = True
    translation_worker_thread = threading.Thread(target=translation_worker, daemon=True)
    translation_worker_thread.start()
    log_message("info", "翻译队列工作线程已启动，将按顺序处理翻译任务")

def stop_translation_worker():
    """停止翻译工作线程"""
    global translation_worker_running
    translation_worker_running = False
    # 添加一个停止信号到队列（使用最高优先级确保能被及时处理）
    translation_queue.put((0, None))

def translation_worker():
    """翻译队列工作线程 - 按顺序处理翻译"""
    global translation_worker_running, translation_counter
    
    log_message("info", "翻译工作线程已启动，将按顺序处理翻译任务")
    next_expected_order = 1  # 下一个期望处理的顺序号
    
    while translation_worker_running:
        try:
            # 获取翻译任务，超时机制确保能响应停止信号
            try:
                priority, task = translation_queue.get(timeout=2)
            except queue.Empty:
                continue
            
            # 收到停止信号
            if task is None:
                break
                
            order, result_id, transcription, target_language = task
            
            # 检查是否是按顺序的任务
            if order == next_expected_order:
                # 正确顺序，立即处理
                log_message("info", f"处理翻译任务 #{order}: {result_id}")
                
                # 执行翻译
                translation = translate_text(transcription, target_language)
                
                if translation:
                    # 发送翻译更新消息
                    send_message({
                        "type": "translation_update",
                        "result_id": result_id,
                        "translation": translation.strip(),
                        "order": order,
                        "timestamp": datetime.now().isoformat()
                    })
                    log_message("info", f"翻译完成 #{order}: {result_id}")
                else:
                    log_message("warning", f"翻译失败 #{order}: {result_id}")
                
                next_expected_order += 1
                
                # 检查是否有等待的后续任务可以处理
                while True:
                    # 查找下一个顺序的任务
                    found_next = False
                    temp_queue = []
                    
                    # 从队列中查找下一个顺序的任务
                    while not translation_queue.empty():
                        try:
                            p, t = translation_queue.get_nowait()
                            if t is None:  # 停止信号
                                translation_queue.put((p, t))
                                break
                                
                            t_order = t[0]
                            if t_order == next_expected_order:
                                # 找到下一个任务
                                found_next = True
                                # 立即处理这个任务
                                _, t_result_id, t_transcription, t_target_language = t
                                log_message("info", f"处理等待的翻译任务 #{t_order}: {t_result_id}")
                                
                                t_translation = translate_text(t_transcription, t_target_language)
                                if t_translation:
                                    send_message({
                                        "type": "translation_update",
                                        "result_id": t_result_id,
                                        "translation": t_translation.strip(),
                                        "order": t_order,
                                        "timestamp": datetime.now().isoformat()
                                    })
                                    log_message("info", f"翻译完成 #{t_order}: {t_result_id}")
                                else:
                                    log_message("warning", f"翻译失败 #{t_order}: {t_result_id}")
                                
                                next_expected_order += 1
                                break
                            else:
                                # 不是下一个，放回临时列表
                                temp_queue.append((p, t))
                        except queue.Empty:
                            break
                    
                    # 将不匹配的任务放回队列
                    for item in temp_queue:
                        translation_queue.put(item)
                    
                    # 如果没有找到下一个任务，跳出循环
                    if not found_next:
                        break
            else:
                # 不是期望的顺序，重新放回队列等待
                translation_queue.put((priority, task))
                log_message("info", f"任务 #{order} 等待前序任务完成，当前期望 #{next_expected_order}")
                # 等待一会儿再检查
                time.sleep(0.1)
                
        except Exception as e:
            log_message("error", f"翻译工作线程错误: {e}")
            import traceback
            log_message("error", f"错误详情: {traceback.format_exc()}")
    
    log_message("info", "翻译工作线程已停止")

def queue_translation(result_id, transcription, target_language):
    """将翻译任务加入队列，确保按顺序处理"""
    global translation_counter
    
    if not target_language or not target_language.strip():
        return False, 0
    
    # 分配顺序号
    translation_counter += 1
    order = translation_counter
    
    # 创建任务，格式：(order, result_id, transcription, target_language)
    task = (order, result_id, transcription, target_language)
    
    try:
        # 使用优先级队列，优先级就是顺序号，确保按顺序处理
        translation_queue.put((order, task), timeout=1)
        log_message("info", f"翻译任务已加入队列 #{order}: {result_id}")
        return True, order
    except queue.Full:
        log_message("warning", f"翻译队列已满，跳过任务 #{order}: {result_id}")
        return False, order

def audio_callback(indata, frames, time, status):
    """音频录制回调函数"""
    global audio_data, segment_frames, silence_frames_contig, split_requested
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    
    if status:
        log_message("warning", f"录音状态: {status}")
    
    if not is_recording:
        return
    
    try:
        with audio_lock:
            try:
                # 确保输入数据是有效的numpy数组
                if indata is None or len(indata) == 0:
                    return
                    
                # 计算RMS音量
                rms = float(np.sqrt(np.mean(np.square(indata))))
            except Exception as e:
                log_message("warning", f"RMS计算失败: {e}")
                rms = 0.0

            # 非段内：维护预滚动缓冲
            if not segment_active:
                try:
                    pre_roll_chunks.append(indata.copy())
                    pre_roll_frames += frames
                    max_pre = int(PRE_ROLL_SECONDS * SAMPLE_RATE)
                    while pre_roll_frames > max_pre and pre_roll_chunks:
                        drop = pre_roll_chunks.pop(0)
                        pre_roll_frames -= len(drop)
                except Exception as e:
                    log_message("warning", f"预滚动缓冲处理失败: {e}")

            # 检测进入语音：开启新段
            if not segment_active and rms >= SILENCE_RMS_THRESHOLD:
                new_segment_requested = True
                segment_active = True
                segment_frames = 0
                silence_frames_contig = 0
                
                try:
                    # 发送语音活动开始消息
                    send_message({
                        "type": "voice_activity",
                        "active": True,
                        "timestamp": datetime.now().isoformat()
                    })
                    
                    # 合并预滚
                    if pre_roll_chunks:
                        for ch in pre_roll_chunks:
                            audio_data.append(ch)
                            segment_frames += len(ch)
                        pre_roll_chunks = []
                        pre_roll_frames = 0
                except Exception as e:
                    log_message("warning", f"语音活动处理失败: {e}")

            # 段内：保存原始数据
            if segment_active:
                try:
                    audio_data.append(indata.copy())
                    segment_frames += frames
                    if rms < SILENCE_RMS_THRESHOLD:
                        silence_frames_contig += frames
                        if silence_frames_contig >= int(MIN_SILENCE_SEC_FOR_SPLIT * SAMPLE_RATE):
                            split_requested = True
                            segment_active = False
                            # 发送语音活动结束消息
                            send_message({
                                "type": "voice_activity",
                                "active": False,
                                "timestamp": datetime.now().isoformat()
                            })
                    else:
                        silence_frames_contig = 0
                except Exception as e:
                    log_message("warning", f"音频数据处理失败: {e}")
                    
    except Exception as e:
        log_message("error", f"音频回调函数错误: {e}")
        # 不要重新抛出异常，这会导致CFFI错误

def start_recording():
    """开始录音"""
    global is_recording, audio_data, recording_thread
    global segment_frames, silence_frames_contig, split_requested, segment_index
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    global translation_counter
    
    if is_recording:
        log_message("warning", "录音已在进行中")
        return
    
    # 检查音频设备
    if not check_audio_device():
        log_message("error", "音频设备检查失败，无法开始录音")
        send_message({
            "type": "recording_error", 
            "message": "音频设备不可用，请检查麦克风权限和设备连接",
            "timestamp": datetime.now().isoformat()
        })
        return
    
    # 清空翻译队列，重置翻译计数器（为新的录音会话做准备）
    while not translation_queue.empty():
        try:
            translation_queue.get_nowait()
        except queue.Empty:
            break
    translation_counter = 0
    log_message("info", "翻译队列已清空，准备新的录音会话")
    
    is_recording = True
    
    with audio_lock:
        audio_data = []
        segment_frames = 0
        silence_frames_contig = 0
        split_requested = False
        segment_index = 1
    
    segment_active = False
    new_segment_requested = False
    pre_roll_chunks = []
    pre_roll_frames = 0
    
    recording_thread = threading.Thread(target=record_audio)
    recording_thread.start()
    
    log_message("info", "录音已开始")

def record_audio():
    """录音线程"""
    global is_recording, split_requested, segment_index, audio_data
    global new_segment_requested
    
    try:
        log_message("info", f"开始音频录制，采样率: {SAMPLE_RATE}Hz, 声道: {CHANNELS}")
        
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback,
            blocksize=1024  # 添加固定的块大小
        ) as stream:
            log_message("info", "音频流已启动")
            
            while is_recording:
                if new_segment_requested:
                    new_segment_requested = False
                
                if split_requested:
                    with audio_lock:
                        local_chunks = audio_data
                        audio_data = []
                        segment_frames = 0
                        silence_frames_contig = 0
                        split_requested = False
                        seg_idx = segment_index
                        segment_index += 1
                    
                    threading.Thread(
                        target=process_segment_chunks,
                        args=(local_chunks, seg_idx, True),
                        daemon=True,
                    ).start()
                
                sd.sleep(100)
                
    except sd.PortAudioError as e:
        error_msg = f"音频设备错误: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"音频设备错误，请检查麦克风权限或重启应用: {e}",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        error_msg = f"录音错误: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"录音发生未知错误: {e}",
            "timestamp": datetime.now().isoformat()
        })
    finally:
        log_message("info", "录音线程结束")

def stop_recording():
    """停止录音"""
    global is_recording, audio_data, recording_thread, segment_active
    
    if not is_recording:
        return
    
    is_recording = False
    
    if recording_thread and recording_thread.is_alive():
        recording_thread.join()
    
    if audio_data:
        save_audio_file()

def save_audio_file():
    """保存最后一段音频文件"""
    global audio_data
    with audio_lock:
        local_chunks = audio_data
        audio_data = []
    process_segment_chunks(local_chunks, None, False)

def process_segment_chunks(chunks, seg_idx=None, from_split=False):
    """处理音频块"""
    try:
        if not chunks:
            return
        combined_audio = np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
        process_combined_audio(combined_audio, seg_idx, from_split)
    except Exception as e:
        log_message("error", f"处理音频段时出错: {e}")

def process_combined_audio(combined_audio, seg_idx=None, from_split=False):
    """保存合并后的音频并转写翻译"""
    try:
        # 检查是否启用剧场模式
        theater_mode_enabled = config.get('theater_mode', False)
        
        # 如果启用剧场模式，先放大音频
        if theater_mode_enabled:
            combined_audio = amplify_audio_for_theater_mode(combined_audio)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if seg_idx is not None:
            filename = f"recording_{timestamp}_seg{seg_idx}.wav"
        else:
            filename = f"recording_{timestamp}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)

        sf.write(filepath, combined_audio, SAMPLE_RATE)

        # 转写音频
        transcription = transcribe_audio_file(filepath)
        if transcription:
            # 生成唯一的结果ID
            result_id = str(uuid.uuid4())
            
            # 检查是否启用翻译
            if config.get('enable_translation', True):
                target_language = config.get('translate_language', '中文')
                if target_language and target_language.strip():
                    # 异步排队翻译任务，获取翻译顺序
                    queue_success, translation_order = queue_translation(result_id, transcription, target_language)
                    
                    if queue_success:
                        # 立即发送转写结果（带翻译占位符和顺序信息）
                        send_message({
                            "type": "result",
                            "result_id": result_id,
                            "transcription": transcription.strip(),
                            "translation_pending": True,
                            "translation_order": translation_order,
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        # 翻译队列失败，发送无翻译的结果
                        send_message({
                            "type": "result_final",
                            "result_id": result_id,
                            "transcription": transcription.strip(),
                            "timestamp": datetime.now().isoformat()
                        })
                else:
                    # 未设置目标语言，只发送转写
                    send_message({
                        "type": "result",
                        "result_id": result_id,
                        "transcription": transcription.strip(),
                        "timestamp": datetime.now().isoformat()
                    })
            else:
                # 未启用翻译：直接发送转写
                send_message({
                    "type": "result",
                    "result_id": result_id,
                    "transcription": transcription.strip(),
                    "timestamp": datetime.now().isoformat()
                })

            # 删除音频文件
            try:
                os.remove(filepath)
            except Exception as delete_error:
                pass  # 静默删除失败
    except Exception as e:
        log_message("error", f"保存/转写音频文件时出错: {e}")

def translate_text(text, target_language="中文"):
    """翻译文本"""
    global openai_client
    
    if not openai_client or not text or not text.strip():
        return None
    
    try:
        system_prompt = f"""你是一个专业的翻译助手。请将用户提供的文本翻译为{target_language}。

翻译要求：
1. 保持原文的语气和风格
2. 确保翻译准确自然
3. 如果原文已经是{target_language}，请直接返回原文
4. 只返回翻译结果，不要添加任何解释或说明"""

        chat_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ]
        
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
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        log_message("error", f"翻译失败: {e}")
        return None

def transcribe_audio_file(filepath):
    """转写音频文件"""
    global openai_client

    if openai_client is None:
        log_message("error", "OpenAI客户端未配置，无法转写")
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
        log_message("error", f"转写失败: {e}")
        return None

def handle_message(message):
    """处理来自Electron的消息"""
    global config
    
    try:
        msg_type = message.get("type")
        log_message("info", f"处理消息类型: {msg_type}")
        
        if msg_type == "start_recording":
            log_message("info", "执行开始录音命令")
            start_recording()
        elif msg_type == "stop_recording":
            log_message("info", "执行停止录音命令")
            stop_recording()
        elif msg_type == "update_config":
            new_config = message.get("config", {})
            log_message("info", f"更新配置: {list(new_config.keys())}")
            config = new_config
            # 重新初始化OpenAI客户端
            success = init_openai_client()
            log_message("info", f"OpenAI客户端初始化结果: {success}")
            # 如果启用翻译且OpenAI配置成功，启动翻译工作线程
            if success and config.get('enable_translation', True):
                start_translation_worker()
        else:
            log_message("warning", f"未知消息类型: {msg_type}")
            
    except Exception as e:
        log_message("error", f"处理消息失败: {e}")
        import traceback
        log_message("error", f"错误详情: {traceback.format_exc()}")

def main():
    """主函数"""
    import sys
    import traceback
    
    # 编码已经在模块导入时设置，这里只检查调试模式
    debug_mode = os.environ.get('ELECTRON_DEBUG') == '1'
    if debug_mode:
        print("调试模式已启用", file=sys.stderr, flush=True)
    
    try:
        ensure_output_dir()
        
        log_message("info", "转写服务正在启动...")
        log_message("info", f"Python版本: {sys.version}")
        log_message("info", f"工作目录: {os.getcwd()}")
        
        # 检查必要的依赖
        try:
            import sounddevice as sd_test
            log_message("info", "sounddevice 模块加载成功")
        except ImportError as e:
            log_message("error", f"sounddevice 模块导入失败: {e}")
            
        try:
            import soundfile as sf_test
            log_message("info", "soundfile 模块加载成功")
        except ImportError as e:
            log_message("error", f"soundfile 模块导入失败: {e}")
            
        try:
            import numpy as np_test
            log_message("info", "numpy 模块加载成功")
        except ImportError as e:
            log_message("error", f"numpy 模块导入失败: {e}")
        
        if OpenAIClient is not None:
            log_message("info", "openai 模块加载成功")
        else:
            log_message("warning", "openai 模块未安装或导入失败")
        
        # 初始化音频设备检查
        try:
            log_message("info", "检查音频设备...")
            devices = sd.query_devices()
            log_message("info", f"找到 {len(devices)} 个音频设备")
            
            # 显示默认设备信息
            default_input = sd.query_devices(kind='input')
            if default_input:
                log_message("info", f"默认输入设备: {default_input.get('name', 'Unknown')}")
            else:
                log_message("warning", "未找到默认输入设备")
                
        except Exception as e:
            log_message("warning", f"音频设备检查失败: {e}")
        
        log_message("info", "转写服务已启动，等待命令...")
        
        # 读取stdin消息
        line_count = 0
        for line in sys.stdin:
            line_count += 1
            line = line.strip()
            if not line:
                continue
                
            log_message("info", f"收到第{line_count}条消息: {line[:100]}...")
            
            try:
                message = json.loads(line)
                log_message("info", f"解析消息成功: {message.get('type', 'unknown')}")
                handle_message(message)
            except json.JSONDecodeError as e:
                log_message("error", f"JSON解析失败: {e}, 原始消息: {line}")
            except Exception as e:
                log_message("error", f"处理消息时出错: {e}")
                log_message("error", f"错误详情: {traceback.format_exc()}")
                
    except KeyboardInterrupt:
        # 收到中断信号时，优雅关闭
        try:
            log_message("info", "收到中断信号，正在退出...")
        except:
            pass
        # 停止录音
        if is_recording:
            try:
                is_recording = False
                if recording_thread and recording_thread.is_alive():
                    recording_thread.join(timeout=2)
            except:
                pass
        # 停止翻译工作线程
        try:
            stop_translation_worker()
        except:
            pass
    except (BrokenPipeError, OSError) as e:
        # 管道断开，通常是主进程已关闭，直接退出
        # 停止翻译工作线程
        try:
            stop_translation_worker()
        except:
            pass
    except Exception as e:
        try:
            log_message("error", f"主函数异常: {e}")
            log_message("error", f"异常详情: {traceback.format_exc()}")
        except:
            pass
        # 停止翻译工作线程
        try:
            stop_translation_worker()
        except:
            pass
    finally:
        # 确保翻译工作线程停止
        try:
            stop_translation_worker()
        except:
            pass
        try:
            log_message("info", "转写服务已停止")
        except:
            pass

if __name__ == "__main__":
    main()