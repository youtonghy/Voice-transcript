#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
媒体文件转写翻译工具
支持导入视频/音频文件，提取音频，检测有效说话片段（支持剧场模式），
使用OpenAI进行转写和翻译，支持多线程同步处理并保持顺序，支持一键导出TXT
"""

import os
import sys
import json
import time
import threading
import queue
import uuid
import tempfile
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import numpy as np
import soundfile as sf

# 预先解析并设置 ffmpeg 路径（支持 Nuitka onefile/standalone 与开发环境）
def _resolve_ffmpeg_path():
    try:
        # 1) Nuitka onefile 解包目录
        base_dir = os.environ.get("NUITKA_ONEFILE_TEMP")
        # 2) 可执行文件所在目录（Nuitka/打包场景）或脚本目录（开发场景）
        if not base_dir:
            base_dir = os.path.dirname(getattr(sys, "executable", sys.argv[0]))

        # 常见放置位置
        candidates = [
            os.path.join(base_dir, "ffmpeg", "ffmpeg.exe"),  # 子目录 ffmpeg/ffmpeg.exe
            os.path.join(base_dir, "ffmpeg.exe"),             # 同目录 ffmpeg.exe
        ]

        # 额外尝试：Electron 项目根目录（开发模式）
        # 当此脚本位于 electron 目录中运行时，ffmpeg 可能放在该目录根部
        project_root = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.join(project_root, "ffmpeg.exe"))

        for c in candidates:
            if os.path.exists(c):
                return c
    except Exception:
        pass
    return None

_ffmpeg_path = _resolve_ffmpeg_path()
if _ffmpeg_path and not os.environ.get("IMAGEIO_FFMPEG_EXE"):
    # 优先设置 imageio-ffmpeg 环境变量，MoviePy 会读取它
    os.environ["IMAGEIO_FFMPEG_EXE"] = _ffmpeg_path

# 音频/视频处理：统一使用 FFmpeg 抽音频，不再依赖 MoviePy

# OpenAI客户端
try:
    from openai import OpenAI as OpenAIClient
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    print("警告: openai SDK未安装，无法使用转写功能。运行: pip install openai")

# scipy用于音频重采样
try:
    from scipy import signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    signal = None

# 配置常量
SAMPLE_RATE = 44100
CHANNELS = 1
DTYPE = 'float32'

# 自动分段参数
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
SILENCE_RMS_THRESHOLD = 0.010
PRE_ROLL_SECONDS = 1.0

# 剧场模式参数
THEATER_MODE_TARGET_RMS = 0.05
THEATER_MODE_MAX_GAIN = 10.0

# OpenAI配置
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"

# 支持的文件格式
AUDIO_FORMATS = ['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a', '.wma']
VIDEO_FORMATS = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v']

class MediaProcessor:
    """媒体文件处理器"""
    
    def __init__(self):
        self.openai_client = None
        self.config = self.load_config()
        self.init_openai_client()
        
        # 线程管理
        self.processing_queue = queue.PriorityQueue()
        self.translation_queue = queue.PriorityQueue()
        self.worker_threads = []
        self.translation_threads = []
        self.shutdown_event = threading.Event()
        
        # 结果存储
        self.results = {}  # {task_id: {order, transcription, translation, status}}
        self.results_lock = threading.Lock()
        self.task_counter = 0
        self.translation_counter = 0
        
        # 导出数据
        self.export_data = []
        self.export_lock = threading.Lock()

    def load_config(self) -> Dict[str, Any]:
        """加载配置文件"""
        config_file = "config.json"
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"读取配置文件失败: {e}")
        return {}

    def init_openai_client(self) -> bool:
        """初始化OpenAI客户端"""
        if not OPENAI_AVAILABLE:
            return False
            
        api_key = os.environ.get("OPENAI_API_KEY") or self.config.get("openai_api_key")
        base_url = os.environ.get("OPENAI_BASE_URL") or self.config.get("openai_base_url")

        if not api_key:
            return False

        try:
            if base_url:
                self.openai_client = OpenAIClient(api_key=api_key, base_url=base_url)
            else:
                self.openai_client = OpenAIClient(api_key=api_key)
            return True
        except Exception as e:
            print(f"OpenAI客户端初始化失败: {e}")
            return False

    def extract_audio_from_video(self, video_path: str, output_path: str = None) -> Optional[str]:
        """从视频文件提取音频（使用FFmpeg）"""
        # 使用 FFmpeg 直接抽取为 WAV 单声道 44.1kHz
        ffmpeg_path = os.environ.get("IMAGEIO_FFMPEG_EXE") or _ffmpeg_path or "ffmpeg"
        try:
            if output_path is None:
                temp_dir = tempfile.mkdtemp()
                output_path = os.path.join(temp_dir, "extracted_audio.wav")

            cmd = [
                ffmpeg_path,
                "-y",
                "-i", video_path,
                "-vn",
                "-ac", str(CHANNELS),
                "-ar", str(SAMPLE_RATE),
                "-f", "wav",
                output_path
            ]
            import subprocess
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if proc.returncode == 0 and os.path.exists(output_path):
                return output_path
            else:
                err = proc.stderr.decode("utf-8", errors="ignore")
                print(f"FFmpeg提取音频失败: {err}")
        except Exception as e:
            print(f"FFmpeg调用失败: {e}")

        return None

    def simple_resample(self, audio_data: np.ndarray, original_rate: int, target_rate: int) -> np.ndarray:
        """简单的音频重采样（线性插值）"""
        try:
            if original_rate == target_rate:
                return audio_data
            
            # 计算重采样比例
            ratio = target_rate / original_rate
            new_length = int(len(audio_data) * ratio)
            
            # 使用线性插值进行重采样
            original_indices = np.arange(len(audio_data))
            new_indices = np.linspace(0, len(audio_data) - 1, new_length)
            resampled_audio = np.interp(new_indices, original_indices, audio_data)
            
            return resampled_audio.astype(np.float32)
            
        except Exception as e:
            print(f"简单重采样失败: {e}")
            return audio_data

    def load_audio_file(self, file_path: str) -> Tuple[Optional[np.ndarray], Optional[int]]:
        """加载音频文件"""
        try:
            audio_data, sample_rate = sf.read(file_path)
            
            # 转换为单声道
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)
            
            # 重采样到目标采样率
            if sample_rate != SAMPLE_RATE:
                if SCIPY_AVAILABLE and signal is not None:
                    try:
                        num_samples = int(len(audio_data) * SAMPLE_RATE / sample_rate)
                        audio_data = signal.resample(audio_data, num_samples)
                        print(f"音频重采样(scipy): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
                    except Exception as e:
                        print(f"scipy重采样失败，使用简单重采样: {e}")
                        audio_data = self.simple_resample(audio_data, sample_rate, SAMPLE_RATE)
                        print(f"音频重采样(简单): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
                else:
                    # 使用简单重采样作为备选方案
                    audio_data = self.simple_resample(audio_data, sample_rate, SAMPLE_RATE)
                    print(f"音频重采样(简单): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
            
            return audio_data.astype(np.float32), SAMPLE_RATE
            
        except Exception as e:
            print(f"音频文件加载失败: {e}")
            return None, None

    def amplify_audio_for_theater_mode(self, audio_data: np.ndarray, target_rms: float = THEATER_MODE_TARGET_RMS) -> np.ndarray:
        """剧场模式音频放大"""
        if audio_data is None or len(audio_data) == 0:
            return audio_data
        
        try:
            # 计算当前RMS
            current_rms = np.sqrt(np.mean(np.square(audio_data)))
            
            if current_rms >= target_rms:
                return audio_data
            
            # 计算增益
            if current_rms > 0:
                gain = target_rms / current_rms
                gain = min(gain, THEATER_MODE_MAX_GAIN)
            else:
                gain = 1.0
            
            # 应用增益并防止削波
            amplified_audio = audio_data * gain
            amplified_audio = np.clip(amplified_audio, -1.0, 1.0)
            
            print(f"剧场模式：音频放大 {gain:.2f}x (RMS: {current_rms:.4f} -> {np.sqrt(np.mean(np.square(amplified_audio))):.4f})")
            
            return amplified_audio
            
        except Exception as e:
            print(f"音频放大失败: {e}")
            return audio_data

    def detect_speech_segments(self, audio_data: np.ndarray, sample_rate: int, theater_mode: bool = False) -> List[Tuple[int, int]]:
        """检测有效说话片段"""
        if theater_mode:
            audio_data = self.amplify_audio_for_theater_mode(audio_data)
        
        segments = []
        
        # 计算RMS窗口
        window_size = int(0.1 * sample_rate)  # 100ms窗口
        hop_size = int(0.05 * sample_rate)    # 50ms跳跃
        
        rms_values = []
        for i in range(0, len(audio_data) - window_size, hop_size):
            window = audio_data[i:i + window_size]
            rms = np.sqrt(np.mean(np.square(window)))
            rms_values.append(rms)
        
        # 检测语音段
        is_speech = [rms > SILENCE_RMS_THRESHOLD for rms in rms_values]
        
        # 找到语音段的开始和结束
        in_segment = False
        segment_start = 0
        silence_frames = 0
        min_silence_frames = int(MIN_SILENCE_SEC_FOR_SPLIT / (hop_size / sample_rate))
        pre_roll_frames = int(PRE_ROLL_SECONDS / (hop_size / sample_rate))
        
        for i, speech in enumerate(is_speech):
            if speech and not in_segment:
                # 语音开始
                segment_start = max(0, i - pre_roll_frames)
                in_segment = True
                silence_frames = 0
            elif not speech and in_segment:
                # 静音
                silence_frames += 1
                if silence_frames >= min_silence_frames:
                    # 语音段结束
                    segment_end = i
                    start_sample = segment_start * hop_size
                    end_sample = min(segment_end * hop_size + window_size, len(audio_data))
                    
                    # 只保存足够长的段
                    if end_sample - start_sample > sample_rate * 0.5:  # 至少0.5秒
                        segments.append((start_sample, end_sample))
                    
                    in_segment = False
                    silence_frames = 0
            elif speech and in_segment:
                # 继续语音
                silence_frames = 0
        
        # 处理最后一个段
        if in_segment:
            segment_end = len(is_speech)
            start_sample = segment_start * hop_size
            end_sample = len(audio_data)
            if end_sample - start_sample > sample_rate * 0.5:
                segments.append((start_sample, end_sample))
        
        return segments

    def transcribe_audio_segment(self, audio_segment: np.ndarray, segment_id: str) -> Optional[str]:
        """转写音频段"""
        if not self.openai_client:
            return None
        
        try:
            # 保存为临时文件
            temp_dir = tempfile.mkdtemp()
            temp_file = os.path.join(temp_dir, f"segment_{segment_id}.wav")
            
            sf.write(temp_file, audio_segment, SAMPLE_RATE)
            
            # 调用OpenAI转写
            with open(temp_file, "rb") as audio_file:
                result = self.openai_client.audio.transcriptions.create(
                    model=OPENAI_TRANSCRIBE_MODEL,
                    file=audio_file,
                    response_format="text",
                )
            
            transcription = getattr(result, "text", str(result)).strip()
            
            # 清理临时文件
            try:
                os.unlink(temp_file)
                os.rmdir(temp_dir)
            except:
                pass
            
            return transcription
            
        except Exception as e:
            print(f"转写失败 {segment_id}: {e}")
            return None

    def translate_text(self, text: str, target_language: str = "中文") -> Optional[str]:
        """翻译文本"""
        if not self.openai_client or not text.strip():
            return None
        
        try:
            system_prompt = f"""你是一个专业的翻译助手。请将用户提供的文本翻译为{target_language}。

翻译要求：
1. 保持原文的语气和风格
2. 确保翻译准确自然
3. 如果原文已经是{target_language}，请直接返回原文
4. 只返回翻译结果，不要添加任何解释或说明"""

            response = self.openai_client.chat.completions.create(
                model=OPENAI_TRANSLATE_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                max_tokens=5000,
                temperature=0.1,
                top_p=0.95,
                frequency_penalty=0,
                presence_penalty=0,
                stream=False
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"翻译失败: {e}")
            return None

    def process_file(self, file_path: str, theater_mode: bool = False, enable_translation: bool = True, target_language: str = "中文", progress_callback=None) -> bool:
        """处理媒体文件"""
        try:
            print(f"开始处理文件: {file_path}")
            
            # 重置计数器和结果
            self.task_counter = 0
            self.translation_counter = 0
            self.results.clear()
            self.export_data.clear()
            
            # 检查文件类型并提取音频
            file_ext = Path(file_path).suffix.lower()
            
            if file_ext in VIDEO_FORMATS:
                print("检测到视频文件，使用FFmpeg提取音频...")
                if progress_callback:
                    progress_callback("提取音频中...")

                audio_path = self.extract_audio_from_video(file_path)
                if not audio_path:
                    print("音频提取失败")
                    return False
                cleanup_audio = True
            elif file_ext in AUDIO_FORMATS:
                print("检测到音频文件")
                audio_path = file_path
                cleanup_audio = False
            else:
                print(f"不支持的文件格式: {file_ext}")
                return False
            
            # 加载音频
            print("加载音频文件...")
            if progress_callback:
                progress_callback("加载音频中...")
            
            audio_data, sample_rate = self.load_audio_file(audio_path)
            if audio_data is None:
                print("音频加载失败")
                if cleanup_audio:
                    try:
                        os.unlink(audio_path)
                        os.rmdir(os.path.dirname(audio_path))
                    except:
                        pass
                return False
            
            # 检测语音段
            print("检测语音段...")
            if progress_callback:
                progress_callback("检测语音段中...")
            
            segments = self.detect_speech_segments(audio_data, sample_rate, theater_mode)
            print(f"检测到 {len(segments)} 个语音段")
            
            if not segments:
                print("未检测到有效语音段")
                if cleanup_audio:
                    try:
                        os.unlink(audio_path)
                        os.rmdir(os.path.dirname(audio_path))
                    except:
                        pass
                return False
            
            # 启动工作线程
            self.start_worker_threads(enable_translation, target_language)
            
            # 将语音段加入处理队列
            for i, (start, end) in enumerate(segments):
                segment_audio = audio_data[start:end]
                task_id = str(uuid.uuid4())
                order = i + 1
                
                self.task_counter += 1
                
                # 添加到处理队列
                self.processing_queue.put((order, {
                    'task_id': task_id,
                    'order': order,
                    'audio_segment': segment_audio,
                    'enable_translation': enable_translation,
                    'target_language': target_language,
                    'progress_callback': progress_callback
                }))
                
                # 初始化结果
                with self.results_lock:
                    self.results[task_id] = {
                        'order': order,
                        'transcription': None,
                        'translation': None,
                        'status': 'queued'
                    }
            
            # 等待所有任务完成
            total_tasks = len(segments)
            completed_tasks = 0
            
            while completed_tasks < total_tasks:
                time.sleep(0.1)
                with self.results_lock:
                    completed_tasks = sum(1 for result in self.results.values() 
                                        if result['status'] == 'completed')
                
                if progress_callback:
                    progress = (completed_tasks / total_tasks) * 100
                    progress_callback(f"处理进度: {completed_tasks}/{total_tasks} ({progress:.1f}%)")
            
            # 停止工作线程
            self.stop_worker_threads()
            
            # 整理导出数据
            self.prepare_export_data()
            
            # 清理临时音频文件
            if cleanup_audio:
                try:
                    os.unlink(audio_path)
                    os.rmdir(os.path.dirname(audio_path))
                except:
                    pass
            
            print("文件处理完成")
            if progress_callback:
                progress_callback("处理完成")
            
            return True
            
        except Exception as e:
            print(f"文件处理失败: {e}")
            if progress_callback:
                progress_callback(f"处理失败: {e}")
            return False

    def start_worker_threads(self, enable_translation: bool, target_language: str):
        """启动工作线程"""
        self.shutdown_event.clear()
        
        # 启动转写线程
        for i in range(2):  # 2个转写线程
            thread = threading.Thread(target=self.transcription_worker, daemon=True)
            thread.start()
            self.worker_threads.append(thread)
        
        # 启动翻译线程
        if enable_translation:
            for i in range(1):  # 1个翻译线程（保证顺序）
                thread = threading.Thread(target=self.translation_worker, args=(target_language,), daemon=True)
                thread.start()
                self.translation_threads.append(thread)

    def stop_worker_threads(self):
        """停止工作线程"""
        self.shutdown_event.set()
        
        # 添加停止信号到队列
        for _ in self.worker_threads:
            self.processing_queue.put((float('inf'), None))
        
        for _ in self.translation_threads:
            self.translation_queue.put((float('inf'), None))
        
        # 等待线程结束
        for thread in self.worker_threads:
            thread.join(timeout=5)
        
        for thread in self.translation_threads:
            thread.join(timeout=5)
        
        self.worker_threads.clear()
        self.translation_threads.clear()

    def transcription_worker(self):
        """转写工作线程"""
        while not self.shutdown_event.is_set():
            try:
                priority, task = self.processing_queue.get(timeout=1)
                
                if task is None:  # 停止信号
                    break
                
                task_id = task['task_id']
                order = task['order']
                audio_segment = task['audio_segment']
                enable_translation = task['enable_translation']
                target_language = task['target_language']
                progress_callback = task.get('progress_callback')
                
                # 更新状态
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['status'] = 'transcribing'
                
                # 执行转写
                transcription = self.transcribe_audio_segment(audio_segment, task_id)
                
                if transcription:
                    # 更新转写结果
                    with self.results_lock:
                        if task_id in self.results:
                            self.results[task_id]['transcription'] = transcription
                    
                    print(f"转写完成 #{order}: {transcription[:50]}...")
                    
                    # 如果启用翻译，加入翻译队列
                    if enable_translation and target_language:
                        self.translation_counter += 1
                        translation_order = self.translation_counter
                        
                        self.translation_queue.put((translation_order, {
                            'task_id': task_id,
                            'order': order,
                            'transcription': transcription,
                            'target_language': target_language
                        }))
                    else:
                        # 不需要翻译，标记为完成
                        with self.results_lock:
                            if task_id in self.results:
                                self.results[task_id]['status'] = 'completed'
                else:
                    print(f"转写失败 #{order}")
                    with self.results_lock:
                        if task_id in self.results:
                            self.results[task_id]['status'] = 'failed'
                
            except queue.Empty:
                continue
            except Exception as e:
                print(f"转写线程错误: {e}")

    def translation_worker(self, target_language: str):
        """翻译工作线程"""
        while not self.shutdown_event.is_set():
            try:
                priority, task = self.translation_queue.get(timeout=1)
                
                if task is None:  # 停止信号
                    break
                
                task_id = task['task_id']
                order = task['order']
                transcription = task['transcription']
                
                # 更新状态
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['status'] = 'translating'
                
                # 执行翻译
                translation = self.translate_text(transcription, target_language)
                
                # 更新结果
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['translation'] = translation
                        self.results[task_id]['status'] = 'completed'
                
                if translation:
                    print(f"翻译完成 #{order}: {translation[:50]}...")
                else:
                    print(f"翻译失败 #{order}")
                
            except queue.Empty:
                continue
            except Exception as e:
                print(f"翻译线程错误: {e}")

    def prepare_export_data(self):
        """准备导出数据"""
        with self.results_lock:
            # 按顺序排序
            sorted_results = sorted(self.results.items(), key=lambda x: x[1]['order'])
            
            self.export_data.clear()
            for task_id, result in sorted_results:
                if result['status'] == 'completed' and result['transcription']:
                    entry = {
                        'order': result['order'],
                        'transcription': result['transcription'],
                        'translation': result.get('translation', ''),
                        'timestamp': datetime.now().isoformat()
                    }
                    self.export_data.append(entry)

    def export_to_txt(self, output_path: str) -> bool:
        """导出结果到TXT文件"""
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(f"转写翻译结果\n")
                f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("=" * 50 + "\n\n")
                
                for entry in self.export_data:
                    f.write(f"段落 {entry['order']}:\n")
                    f.write(f"原文: {entry['transcription']}\n")
                    if entry['translation']:
                        f.write(f"翻译: {entry['translation']}\n")
                    f.write("\n")
            
            print(f"结果已导出到: {output_path}")
            return True
            
        except Exception as e:
            print(f"导出失败: {e}")
            return False

    def get_results(self) -> List[Dict[str, Any]]:
        """获取处理结果"""
        with self.results_lock:
            return self.export_data.copy()


class MediaTranscribeGUI:
    """图形界面"""
    
    def __init__(self):
        self.processor = MediaProcessor()
        self.setup_gui()
        
    def setup_gui(self):
        """设置图形界面"""
        self.root = tk.Tk()
        self.root.title("媒体文件转写翻译工具")
        self.root.geometry("800x600")
        
        # 文件选择区域
        file_frame = ttk.Frame(self.root)
        file_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(file_frame, text="选择文件:").pack(side=tk.LEFT)
        self.file_path_var = tk.StringVar()
        ttk.Entry(file_frame, textvariable=self.file_path_var, width=50).pack(side=tk.LEFT, padx=5)
        ttk.Button(file_frame, text="浏览", command=self.browse_file).pack(side=tk.LEFT)
        
        # 设置区域
        settings_frame = ttk.LabelFrame(self.root, text="设置")
        settings_frame.pack(fill=tk.X, padx=10, pady=5)
        
        # 剧场模式
        self.theater_mode_var = tk.BooleanVar()
        ttk.Checkbutton(settings_frame, text="启用剧场模式（音频增强）", 
                       variable=self.theater_mode_var).pack(anchor=tk.W)
        
        # 翻译设置
        translate_frame = ttk.Frame(settings_frame)
        translate_frame.pack(fill=tk.X, pady=2)
        
        self.enable_translation_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(translate_frame, text="启用翻译", 
                       variable=self.enable_translation_var).pack(side=tk.LEFT)
        
        ttk.Label(translate_frame, text="目标语言:").pack(side=tk.LEFT, padx=(20, 5))
        self.target_language_var = tk.StringVar(value="中文")
        ttk.Entry(translate_frame, textvariable=self.target_language_var, width=15).pack(side=tk.LEFT)
        
        # 控制按钮
        control_frame = ttk.Frame(self.root)
        control_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Button(control_frame, text="开始处理", command=self.start_processing).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="导出TXT", command=self.export_txt).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="清除结果", command=self.clear_results).pack(side=tk.LEFT, padx=5)
        
        # 进度条
        self.progress_var = tk.StringVar(value="就绪")
        ttk.Label(self.root, textvariable=self.progress_var).pack(pady=2)
        
        # 结果显示区域
        result_frame = ttk.LabelFrame(self.root, text="处理结果")
        result_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, wrap=tk.WORD)
        self.result_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
    def browse_file(self):
        """浏览文件"""
        filetypes = [
            ("所有支持的文件", " ".join([f"*{ext}" for ext in AUDIO_FORMATS + VIDEO_FORMATS])),
            ("音频文件", " ".join([f"*{ext}" for ext in AUDIO_FORMATS])),
            ("视频文件", " ".join([f"*{ext}" for ext in VIDEO_FORMATS])),
            ("所有文件", "*.*")
        ]
        
        filename = filedialog.askopenfilename(filetypes=filetypes)
        if filename:
            self.file_path_var.set(filename)
    
    def start_processing(self):
        """开始处理"""
        file_path = self.file_path_var.get().strip()
        if not file_path:
            messagebox.showerror("错误", "请选择文件")
            return
        
        if not os.path.exists(file_path):
            messagebox.showerror("错误", "文件不存在")
            return
        
        # 检查OpenAI配置
        if not self.processor.openai_client:
            messagebox.showerror("错误", "OpenAI客户端未配置，请检查API密钥设置")
            return
        
        # 清除之前的结果
        self.clear_results()
        
        # 在新线程中处理
        threading.Thread(target=self._process_file, daemon=True).start()
    
    def _process_file(self):
        """处理文件（后台线程）"""
        try:
            file_path = self.file_path_var.get().strip()
            theater_mode = self.theater_mode_var.get()
            enable_translation = self.enable_translation_var.get()
            target_language = self.target_language_var.get().strip() or "中文"
            
            def progress_callback(message):
                self.root.after(0, lambda: self.progress_var.set(message))
            
            success = self.processor.process_file(
                file_path=file_path,
                theater_mode=theater_mode,
                enable_translation=enable_translation,
                target_language=target_language,
                progress_callback=progress_callback
            )
            
            if success:
                # 更新显示结果
                self.root.after(0, self.update_results_display)
            else:
                self.root.after(0, lambda: messagebox.showerror("错误", "文件处理失败"))
                
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("错误", f"处理异常: {e}"))
    
    def update_results_display(self):
        """更新结果显示"""
        results = self.processor.get_results()
        
        self.result_text.delete(1.0, tk.END)
        
        for entry in results:
            self.result_text.insert(tk.END, f"段落 {entry['order']}:\n")
            self.result_text.insert(tk.END, f"原文: {entry['transcription']}\n")
            if entry['translation']:
                self.result_text.insert(tk.END, f"翻译: {entry['translation']}\n")
            self.result_text.insert(tk.END, "\n")
        
        self.result_text.see(tk.END)
    
    def export_txt(self):
        """导出TXT"""
        results = self.processor.get_results()
        if not results:
            messagebox.showwarning("警告", "没有可导出的结果")
            return
        
        filename = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("文本文件", "*.txt"), ("所有文件", "*.*")]
        )
        
        if filename:
            if self.processor.export_to_txt(filename):
                messagebox.showinfo("成功", f"结果已导出到: {filename}")
            else:
                messagebox.showerror("错误", "导出失败")
    
    def clear_results(self):
        """清除结果"""
        self.result_text.delete(1.0, tk.END)
        self.processor.results.clear()
        self.processor.export_data.clear()
        self.progress_var.set("就绪")
    
    def run(self):
        """运行界面"""
        self.root.mainloop()


def main():
    """主函数"""
    import argparse
    import sys
    
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description='媒体文件转写翻译工具')
    parser.add_argument('--file', help='输入媒体文件路径')
    parser.add_argument('--output', help='输出文件路径')
    parser.add_argument('--translate', action='store_true', help='启用翻译')
    parser.add_argument('--language', default='中文', help='目标翻译语言')
    parser.add_argument('--theater-mode', action='store_true', help='启用剧场模式')
    parser.add_argument('--gui', action='store_true', help='启动图形界面模式')
    
    # 解析参数，如果没有参数则默认启动GUI
    if len(sys.argv) == 1:
        args = argparse.Namespace(gui=True, file=None, output=None, translate=False, language='中文', theater_mode=False)
    else:
        args = parser.parse_args()
    
    # 如果指定了GUI模式或者没有提供必要的命令行参数，启动图形界面
    if args.gui or not args.file or not args.output:
        print("媒体文件转写翻译工具")
        print("=" * 40)
        
        # 检查依赖
        missing_deps = []
        optional_deps = []
        
        # 不再强制依赖 moviepy；视频处理使用 FFmpeg
        if not OPENAI_AVAILABLE:
            missing_deps.append("openai")
        if not SCIPY_AVAILABLE:
            optional_deps.append("scipy")
        
        if missing_deps:
            print("错误: 缺少以下必需依赖包:")
            for dep in missing_deps:
                print(f"  - {dep}")
            print("\n请运行以下命令安装:")
            print(f"pip install {' '.join(missing_deps)}")
            
        if optional_deps:
            print("\n可选依赖包:")
            for dep in optional_deps:
                print(f"  - {dep} (推荐安装，用于更好的音频重采样)")
            print(f"安装命令: pip install {' '.join(optional_deps)}")
            
        # FFmpeg 提示
        if not _ffmpeg_path:
            print("\n提示: 未检测到内置 ffmpeg，可在以下位置放置 ffmpeg.exe：")
            print("  - 应用根目录或 electron 根目录")
            print("  - 与 media_transcribe.exe 同目录或其 ffmpeg 子目录")
            print("若系统 PATH 中已有 ffmpeg 也可直接使用。仅处理音频文件时可忽略。")

        if missing_deps or optional_deps or not _ffmpeg_path:
            print("\n程序将以当前可用功能运行...\n")
        
        # 启动GUI
        try:
            app = MediaTranscribeGUI()
            app.run()
        except KeyboardInterrupt:
            print("\n程序退出")
        except Exception as e:
            print(f"程序异常: {e}")
        return
    
    # 命令行模式：处理单个文件
    print(f"开始处理文件: {args.file}")
    print(f"输出路径: {args.output}")
    print(f"启用翻译: {args.translate}")
    print(f"剧场模式: {getattr(args, 'theater_mode', False)}")
    
    # 检查文件是否存在
    if not os.path.exists(args.file):
        print(f"错误: 文件不存在 - {args.file}")
        sys.exit(1)
    
    # 检查文件大小
    try:
        file_size = os.path.getsize(args.file)
        print(f"文件大小: {file_size / 1024 / 1024:.2f} MB")
    except Exception as e:
        print(f"警告: 无法获取文件大小 - {e}")
    
    try:
        # 创建处理器
        processor = MediaProcessor()
        
        if not processor.openai_client:
            print("错误: OpenAI客户端未配置，请设置API密钥")
            sys.exit(1)
        
        # 处理文件
        def progress_callback(message):
            print(f"进度: {message}")
        
        success = processor.process_file(
            file_path=args.file,
            theater_mode=getattr(args, 'theater_mode', False),
            enable_translation=args.translate,
            target_language=args.language,
            progress_callback=progress_callback
        )
        
        if success:
            # 导出结果
            if processor.export_to_txt(args.output):
                print(f"处理完成，结果已保存到: {args.output}")
            else:
                print("导出失败")
                sys.exit(1)
        else:
            print("文件处理失败")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n用户中断处理")
        sys.exit(1)
    except Exception as e:
        print(f"处理失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
