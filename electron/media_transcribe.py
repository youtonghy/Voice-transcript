#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Media file transcription and translation tool
Supports importing video/audio files, extracting audio, detecting valid speech segments (supports theater mode),
using OpenAI for transcription and translation, supports multi-threaded synchronous processing while maintaining order, supports one-click export to TXT
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

# Pre-parse and set ffmpeg path (support Nuitka onefile/standalone and development environment)
def _resolve_ffmpeg_path():
    try:
        # 1) Nuitka onefile extraction directory
        base_dir = os.environ.get("NUITKA_ONEFILE_TEMP")
        # 2) Executable directory (Nuitka/packaging scenario) or script directory (development scenario)
        if not base_dir:
            base_dir = os.path.dirname(getattr(sys, "executable", sys.argv[0]))

        # Common placement locations
        candidates = [
            os.path.join(base_dir, "ffmpeg", "ffmpeg.exe"),  # subdirectory ffmpeg/ffmpeg.exe
            os.path.join(base_dir, "ffmpeg.exe"),             # same directory ffmpeg.exe
        ]

        # Additional attempt: Electron project root (development mode)
        # When this script is run from electron directory, ffmpeg may be placed at the root of that directory
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
    # Prioritize setting imageio-ffmpeg environment variable, MoviePy will read it
    os.environ["IMAGEIO_FFMPEG_EXE"] = _ffmpeg_path

# Audio/video processing: unified use of FFmpeg to extract audio, no longer depends on MoviePy

# Model helpers
import modles

# scipy for audio resampling
try:
    from scipy import signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    signal = None

# Configuration constants
SAMPLE_RATE = 44100
CHANNELS = 1
DTYPE = 'float32'

# Auto-segmentation parameters
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
SILENCE_RMS_THRESHOLD = 0.010
PRE_ROLL_SECONDS = 1.0

# Theater mode parameters
THEATER_MODE_TARGET_RMS = 0.05
THEATER_MODE_MAX_GAIN = 10.0

# OpenAI configuration
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"

# Supported file formats
AUDIO_FORMATS = ['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a', '.wma']
VIDEO_FORMATS = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v']

class MediaProcessor:
    """Media file processor"""
    
    def __init__(self):
        self.config = self.load_config()
        
        # Thread management
        self.processing_queue = queue.PriorityQueue()
        self.translation_queue = queue.PriorityQueue()
        self.worker_threads = []
        self.translation_threads = []
        self.shutdown_event = threading.Event()
        
        # Result storage
        self.results = {}  # {task_id: {order, transcription, translation, status}}
        self.results_lock = threading.Lock()
        self.task_counter = 0
        self.translation_counter = 0
        
        # Export data
        self.export_data = []
        self.export_lock = threading.Lock()

    def load_config(self) -> Dict[str, Any]:
        """Load configuration file"""
        config_file = "config.json"
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Failed to read configuration file: {e}")
        return {}

    def init_openai_client(self) -> bool:
        """Deprecated: models are invoked via modles.py on demand."""
        return True

    def extract_audio_from_video(self, video_path: str, output_path: str = None) -> Optional[str]:
        """Extract audio from video file (using FFmpeg)"""
        # Use FFmpeg to directly extract as WAV mono 44.1kHz
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
                print(f"FFmpeg audio extraction failed: {err}")
        except Exception as e:
            print(f"FFmpeg call failed: {e}")

        return None

    def simple_resample(self, audio_data: np.ndarray, original_rate: int, target_rate: int) -> np.ndarray:
        """Simple audio resampling (linear interpolation)"""
        try:
            if original_rate == target_rate:
                return audio_data
            
            # Calculate resampling ratio
            ratio = target_rate / original_rate
            new_length = int(len(audio_data) * ratio)
            
            # Use linear interpolation for resampling
            original_indices = np.arange(len(audio_data))
            new_indices = np.linspace(0, len(audio_data) - 1, new_length)
            resampled_audio = np.interp(new_indices, original_indices, audio_data)
            
            return resampled_audio.astype(np.float32)
            
        except Exception as e:
            print(f"Simple resampling failed: {e}")
            return audio_data

    def load_audio_file(self, file_path: str) -> Tuple[Optional[np.ndarray], Optional[int]]:
        """Load audio file"""
        try:
            audio_data, sample_rate = sf.read(file_path)
            
            # Convert to mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)
            
            # Resample to target sample rate
            if sample_rate != SAMPLE_RATE:
                if SCIPY_AVAILABLE and signal is not None:
                    try:
                        num_samples = int(len(audio_data) * SAMPLE_RATE / sample_rate)
                        audio_data = signal.resample(audio_data, num_samples)
                        print(f"Audio resampled (scipy): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
                    except Exception as e:
                        print(f"scipy resampling failed, using simple resampling: {e}")
                        audio_data = self.simple_resample(audio_data, sample_rate, SAMPLE_RATE)
                        print(f"Audio resampled (simple): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
                else:
                    # Use simple resampling as fallback
                    audio_data = self.simple_resample(audio_data, sample_rate, SAMPLE_RATE)
                    print(f"Audio resampled (simple): {sample_rate}Hz -> {SAMPLE_RATE}Hz")
            
            return audio_data.astype(np.float32), SAMPLE_RATE
            
        except Exception as e:
            print(f"Audio file loading failed: {e}")
            return None, None

    def amplify_audio_for_theater_mode(self, audio_data: np.ndarray, target_rms: float = THEATER_MODE_TARGET_RMS) -> np.ndarray:
        """Theater mode audio amplification"""
        if audio_data is None or len(audio_data) == 0:
            return audio_data
        
        try:
            # Calculate current RMS
            current_rms = np.sqrt(np.mean(np.square(audio_data)))
            
            if current_rms >= target_rms:
                return audio_data
            
            # Calculate gain
            if current_rms > 0:
                gain = target_rms / current_rms
                gain = min(gain, THEATER_MODE_MAX_GAIN)
            else:
                gain = 1.0
            
            # Apply gain and prevent clipping
            amplified_audio = audio_data * gain
            amplified_audio = np.clip(amplified_audio, -1.0, 1.0)
            
            print(f"Theater mode: audio amplified {gain:.2f}x (RMS: {current_rms:.4f} -> {np.sqrt(np.mean(np.square(amplified_audio))):.4f})")
            
            return amplified_audio
            
        except Exception as e:
            print(f"Audio amplification failed: {e}")
            return audio_data

    def detect_speech_segments(self, audio_data: np.ndarray, sample_rate: int, theater_mode: bool = False) -> List[Tuple[int, int]]:
        """Detect valid speech segments"""
        if theater_mode:
            audio_data = self.amplify_audio_for_theater_mode(audio_data)
        
        segments = []
        
        # Calculate RMS window
        window_size = int(0.1 * sample_rate)  # 100ms window
        hop_size = int(0.05 * sample_rate)    # 50ms hop
        
        rms_values = []
        for i in range(0, len(audio_data) - window_size, hop_size):
            window = audio_data[i:i + window_size]
            rms = np.sqrt(np.mean(np.square(window)))
            rms_values.append(rms)
        
        # Detect speech segments
        is_speech = [rms > SILENCE_RMS_THRESHOLD for rms in rms_values]
        
        # Find start and end of speech segments
        in_segment = False
        segment_start = 0
        silence_frames = 0
        min_silence_frames = int(MIN_SILENCE_SEC_FOR_SPLIT / (hop_size / sample_rate))
        pre_roll_frames = int(PRE_ROLL_SECONDS / (hop_size / sample_rate))
        
        for i, speech in enumerate(is_speech):
            if speech and not in_segment:
                # Speech starts
                segment_start = max(0, i - pre_roll_frames)
                in_segment = True
                silence_frames = 0
            elif not speech and in_segment:
                # Silence
                silence_frames += 1
                if silence_frames >= min_silence_frames:
                    # Speech segment ends
                    segment_end = i
                    start_sample = segment_start * hop_size
                    end_sample = min(segment_end * hop_size + window_size, len(audio_data))
                    
                    # Only save segments that are long enough
                    if end_sample - start_sample > sample_rate * 0.5:  # At least 0.5 seconds
                        segments.append((start_sample, end_sample))
                    
                    in_segment = False
                    silence_frames = 0
            elif speech and in_segment:
                # Continue speech
                silence_frames = 0
        
        # Handle last segment
        if in_segment:
            segment_end = len(is_speech)
            start_sample = segment_start * hop_size
            end_sample = len(audio_data)
            if end_sample - start_sample > sample_rate * 0.5:
                segments.append((start_sample, end_sample))
        
        return segments

    def transcribe_audio_segment(self, audio_segment: np.ndarray, segment_id: str) -> Optional[str]:
        """Transcribe audio segment via OpenAI using central models helper"""
        
        try:
            # Save as temporary file
            temp_dir = tempfile.mkdtemp()
            temp_file = os.path.join(temp_dir, f"segment_{segment_id}.wav")
            
            sf.write(temp_file, audio_segment, SAMPLE_RATE)
            
            # Call transcription via models helper
            api_key = os.environ.get("OPENAI_API_KEY") or self.config.get("openai_api_key")
            base_url = os.environ.get("OPENAI_BASE_URL") or self.config.get("openai_base_url")
            model = None
            try:
                model = (self.config.get('openai_transcribe_model') or OPENAI_TRANSCRIBE_MODEL)
            except Exception:
                model = OPENAI_TRANSCRIBE_MODEL
            transcription = modles.transcribe_openai(temp_file, 'auto', api_key, base_url, model=model)
            transcription = (transcription or '').strip()
            
            # Clean up temporary file
            try:
                os.unlink(temp_file)
                os.rmdir(temp_dir)
            except:
                pass
            
            return transcription
            
        except Exception as e:
            print(f"Transcription failed {segment_id}: {e}")
            return None

    def translate_text(self, text: str, target_language: str = "中文") -> Optional[str]:
        """Translate text"""
        if not text.strip():
            return None

        try:
            api_key = os.environ.get("OPENAI_API_KEY") or self.config.get("openai_api_key")
            base_url = os.environ.get("OPENAI_BASE_URL") or self.config.get("openai_base_url")
            model = None
            try:
                model = (self.config.get('openai_translate_model') or OPENAI_TRANSLATE_MODEL)
            except Exception:
                model = OPENAI_TRANSLATE_MODEL
            return modles.translate_openai(text, target_language, api_key, base_url, model=model)
        except Exception as e:
            print(f"Translation failed: {e}")
            return None

        try:
            system_prompt = f"""You are a professional translation assistant. Please translate the text provided by the user to {target_language}.

Translation requirements:
1. Maintain the tone and style of the original text
2. Ensure accurate and natural translation
3. If the original text is already in {target_language}, please return the original text directly
4. Only return the translation result, do not add any explanations or comments"""

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
            print(f"Translation failed: {e}")
            return None

    def process_file(self, file_path: str, theater_mode: bool = False, enable_translation: bool = True, target_language: str = "中文", progress_callback=None) -> bool:
        """Process media file"""
        try:
            print(f"Starting to process file: {file_path}")
            
            # Reset counters and results
            self.task_counter = 0
            self.translation_counter = 0
            self.results.clear()
            self.export_data.clear()
            
            # Check file type and extract audio
            file_ext = Path(file_path).suffix.lower()
            
            if file_ext in VIDEO_FORMATS:
                print("Detected video file, using FFmpeg to extract audio...")
                if progress_callback:
                    progress_callback("Extracting audio...")

                audio_path = self.extract_audio_from_video(file_path)
                if not audio_path:
                    print("Audio extraction failed")
                    return False
                cleanup_audio = True
            elif file_ext in AUDIO_FORMATS:
                print("Detected audio file")
                audio_path = file_path
                cleanup_audio = False
            else:
                print(f"Unsupported file format: {file_ext}")
                return False
            
            # Load audio
            print("Loading audio file...")
            if progress_callback:
                progress_callback("Loading audio...")
            
            audio_data, sample_rate = self.load_audio_file(audio_path)
            if audio_data is None:
                print("Audio loading failed")
                if cleanup_audio:
                    try:
                        os.unlink(audio_path)
                        os.rmdir(os.path.dirname(audio_path))
                    except:
                        pass
                return False
            
            # Detect speech segments
            print("Detecting speech segments...")
            if progress_callback:
                progress_callback("Detecting speech segments...")
            
            segments = self.detect_speech_segments(audio_data, sample_rate, theater_mode)
            print(f"Detected {len(segments)} speech segments")
            
            if not segments:
                print("No valid speech segments detected")
                if cleanup_audio:
                    try:
                        os.unlink(audio_path)
                        os.rmdir(os.path.dirname(audio_path))
                    except:
                        pass
                return False
            
            # Start worker threads
            self.start_worker_threads(enable_translation, target_language)
            
            # Add speech segments to processing queue
            for i, (start, end) in enumerate(segments):
                segment_audio = audio_data[start:end]
                task_id = str(uuid.uuid4())
                order = i + 1
                
                self.task_counter += 1
                
                # Add to processing queue
                self.processing_queue.put((order, {
                    'task_id': task_id,
                    'order': order,
                    'audio_segment': segment_audio,
                    'enable_translation': enable_translation,
                    'target_language': target_language,
                    'progress_callback': progress_callback
                }))
                
                # Initialize results
                with self.results_lock:
                    self.results[task_id] = {
                        'order': order,
                        'transcription': None,
                        'translation': None,
                        'status': 'queued'
                    }
            
            # Wait for all tasks to complete
            total_tasks = len(segments)
            completed_tasks = 0
            
            while completed_tasks < total_tasks:
                time.sleep(0.1)
                with self.results_lock:
                    completed_tasks = sum(1 for result in self.results.values() 
                                        if result['status'] == 'completed')
                
                if progress_callback:
                    progress = (completed_tasks / total_tasks) * 100
                    progress_callback(f"Processing progress: {completed_tasks}/{total_tasks} ({progress:.1f}%)")
            
            # Stop worker threads
            self.stop_worker_threads()
            
            # Organize export data
            self.prepare_export_data()
            
            # Clean up temporary audio file
            if cleanup_audio:
                try:
                    os.unlink(audio_path)
                    os.rmdir(os.path.dirname(audio_path))
                except:
                    pass
            
            print("File processing completed")
            if progress_callback:
                progress_callback("Processing completed")
            
            return True
            
        except Exception as e:
            print(f"File processing failed: {e}")
            if progress_callback:
                progress_callback(f"Processing failed: {e}")
            return False

    def start_worker_threads(self, enable_translation: bool, target_language: str):
        """Start worker threads"""
        self.shutdown_event.clear()
        
        # Start transcription threads
        for i in range(2):  # 2 transcription threads
            thread = threading.Thread(target=self.transcription_worker, daemon=True)
            thread.start()
            self.worker_threads.append(thread)
        
        # Start translation threads
        if enable_translation:
            for i in range(1):  # 1 translation thread (to ensure order)
                thread = threading.Thread(target=self.translation_worker, args=(target_language,), daemon=True)
                thread.start()
                self.translation_threads.append(thread)

    def stop_worker_threads(self):
        """Stop worker threads"""
        self.shutdown_event.set()
        
        # Add stop signals to queues
        for _ in self.worker_threads:
            self.processing_queue.put((float('inf'), None))
        
        for _ in self.translation_threads:
            self.translation_queue.put((float('inf'), None))
        
        # Wait for threads to finish
        for thread in self.worker_threads:
            thread.join(timeout=5)
        
        for thread in self.translation_threads:
            thread.join(timeout=5)
        
        self.worker_threads.clear()
        self.translation_threads.clear()

    def transcription_worker(self):
        """Transcription worker thread"""
        while not self.shutdown_event.is_set():
            try:
                priority, task = self.processing_queue.get(timeout=1)
                
                if task is None:  # Stop signal
                    break
                
                task_id = task['task_id']
                order = task['order']
                audio_segment = task['audio_segment']
                enable_translation = task['enable_translation']
                target_language = task['target_language']
                progress_callback = task.get('progress_callback')
                
                # Update status
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['status'] = 'transcribing'
                
                # Execute transcription
                transcription = self.transcribe_audio_segment(audio_segment, task_id)
                
                if transcription:
                    # Update transcription result
                    with self.results_lock:
                        if task_id in self.results:
                            self.results[task_id]['transcription'] = transcription
                    
                    print(f"Transcription completed #{order}: {transcription[:50]}...")
                    
                    # If translation enabled, add to translation queue
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
                        # No translation needed, mark as completed
                        with self.results_lock:
                            if task_id in self.results:
                                self.results[task_id]['status'] = 'completed'
                else:
                    print(f"Transcription failed #{order}")
                    with self.results_lock:
                        if task_id in self.results:
                            self.results[task_id]['status'] = 'failed'
                
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Transcription thread error: {e}")

    def translation_worker(self, target_language: str):
        """Translation worker thread"""
        while not self.shutdown_event.is_set():
            try:
                priority, task = self.translation_queue.get(timeout=1)
                
                if task is None:  # Stop signal
                    break
                
                task_id = task['task_id']
                order = task['order']
                transcription = task['transcription']
                
                # Update status
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['status'] = 'translating'
                
                # Execute translation
                translation = self.translate_text(transcription, target_language)
                
                # Update results
                with self.results_lock:
                    if task_id in self.results:
                        self.results[task_id]['translation'] = translation
                        self.results[task_id]['status'] = 'completed'
                
                if translation:
                    print(f"Translation completed #{order}: {translation[:50]}...")
                else:
                    print(f"Translation failed #{order}")
                
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Translation thread error: {e}")

    def prepare_export_data(self):
        """Prepare export data"""
        with self.results_lock:
            # Sort by order
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
        """Export results to TXT file"""
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
            
            print(f"Results exported to: {output_path}")
            return True
            
        except Exception as e:
            print(f"Export failed: {e}")
            return False

    def get_results(self) -> List[Dict[str, Any]]:
        """Get processing results"""
        with self.results_lock:
            return self.export_data.copy()


class MediaTranscribeGUI:
    """Graphical interface"""
    
    def __init__(self):
        self.processor = MediaProcessor()
        self.setup_gui()
        
    def setup_gui(self):
        """Set up graphical interface"""
        self.root = tk.Tk()
        self.root.title("媒体文件转写翻译工具")
        self.root.geometry("800x600")
        
        # File selection area
        file_frame = ttk.Frame(self.root)
        file_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(file_frame, text="选择文件:").pack(side=tk.LEFT)
        self.file_path_var = tk.StringVar()
        ttk.Entry(file_frame, textvariable=self.file_path_var, width=50).pack(side=tk.LEFT, padx=5)
        ttk.Button(file_frame, text="浏览", command=self.browse_file).pack(side=tk.LEFT)
        
        # Settings area
        settings_frame = ttk.LabelFrame(self.root, text="设置")
        settings_frame.pack(fill=tk.X, padx=10, pady=5)
        
        # Theater mode
        self.theater_mode_var = tk.BooleanVar()
        ttk.Checkbutton(settings_frame, text="启用剧场模式（音频增强）", 
                       variable=self.theater_mode_var).pack(anchor=tk.W)
        
        # Translation settings
        translate_frame = ttk.Frame(settings_frame)
        translate_frame.pack(fill=tk.X, pady=2)
        
        self.enable_translation_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(translate_frame, text="启用翻译", 
                       variable=self.enable_translation_var).pack(side=tk.LEFT)
        
        ttk.Label(translate_frame, text="目标语言:").pack(side=tk.LEFT, padx=(20, 5))
        self.target_language_var = tk.StringVar(value="中文")
        ttk.Entry(translate_frame, textvariable=self.target_language_var, width=15).pack(side=tk.LEFT)
        
        # Control buttons
        control_frame = ttk.Frame(self.root)
        control_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Button(control_frame, text="开始处理", command=self.start_processing).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="导出TXT", command=self.export_txt).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="清除结果", command=self.clear_results).pack(side=tk.LEFT, padx=5)
        
        # Progress bar
        self.progress_var = tk.StringVar(value="就绪")
        ttk.Label(self.root, textvariable=self.progress_var).pack(pady=2)
        
        # Results display area
        result_frame = ttk.LabelFrame(self.root, text="处理结果")
        result_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, wrap=tk.WORD)
        self.result_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
    def browse_file(self):
        """Browse files"""
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
        """Start processing"""
        file_path = self.file_path_var.get().strip()
        if not file_path:
            messagebox.showerror("错误", "请选择文件")
            return
        
        if not os.path.exists(file_path):
            messagebox.showerror("错误", "文件不存在")
            return
        
        # Check OpenAI configuration
        if not self.processor.openai_client:
            messagebox.showerror("错误", "OpenAI客户端未配置，请检查API密钥设置")
            return
        
        # Clear previous results
        self.clear_results()
        
        # Process in new thread
        threading.Thread(target=self._process_file, daemon=True).start()
    
    def _process_file(self):
        """Process file (background thread)"""
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
                # Update display results
                self.root.after(0, self.update_results_display)
            else:
                self.root.after(0, lambda: messagebox.showerror("错误", "文件处理失败"))
                
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("错误", f"处理异常: {e}"))
    
    def update_results_display(self):
        """Update results display"""
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
        """Export TXT"""
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
        """Clear results"""
        self.result_text.delete(1.0, tk.END)
        self.processor.results.clear()
        self.processor.export_data.clear()
        self.progress_var.set("就绪")
    
    def run(self):
        """Run interface"""
        self.root.mainloop()


def main():
    """Main function"""
    import argparse
    import sys
    
    # Create command line argument parser
    parser = argparse.ArgumentParser(description='Media file transcription and translation tool')
    parser.add_argument('--file', help='Input media file path')
    parser.add_argument('--output', help='Output file path')
    parser.add_argument('--translate', action='store_true', help='Enable translation')
    parser.add_argument('--language', default='中文', help='Target translation language')
    parser.add_argument('--theater-mode', action='store_true', help='Enable theater mode')
    parser.add_argument('--gui', action='store_true', help='Launch GUI mode')
    
    # Parse arguments, default to GUI if no arguments provided
    if len(sys.argv) == 1:
        args = argparse.Namespace(gui=True, file=None, output=None, translate=False, language='中文', theater_mode=False)
    else:
        args = parser.parse_args()
    
    # If GUI mode is specified or necessary command line arguments are not provided, launch graphical interface
    if args.gui or not args.file or not args.output:
        print("Media File Transcription and Translation Tool")
        print("=" * 40)
        
        # Check dependencies
        missing_deps = []
        optional_deps = []
        
        # No longer force dependency on moviepy; video processing uses FFmpeg
        if not OPENAI_AVAILABLE:
            missing_deps.append("openai")
        if not SCIPY_AVAILABLE:
            optional_deps.append("scipy")
        
        if missing_deps:
            print("Error: Missing required dependencies:")
            for dep in missing_deps:
                print(f"  - {dep}")
            print("\nPlease run the following command to install:")
            print(f"pip install {' '.join(missing_deps)}")
            
        if optional_deps:
            print("\nOptional dependencies:")
            for dep in optional_deps:
                print(f"  - {dep} (recommended for better audio resampling)")
            print(f"Install command: pip install {' '.join(optional_deps)}")
            
        # FFmpeg prompt
        if not _ffmpeg_path:
            print("\nNote: Built-in ffmpeg not detected, you can place ffmpeg.exe at:")
            print("  - Application root or electron root directory")
            print("  - Same directory as media_transcribe.exe or its ffmpeg subdirectory")
            print("If ffmpeg is already in system PATH, it can be used directly. Can be ignored when processing audio files only.")

        if missing_deps or optional_deps or not _ffmpeg_path:
            print("\nProgram will run with currently available features...\n")
        
        # Launch GUI
        try:
            app = MediaTranscribeGUI()
            app.run()
        except KeyboardInterrupt:
            print("\nProgram exited")
        except Exception as e:
            print(f"Program exception: {e}")
        return
    
    # Command line mode: process single file
    print(f"Starting to process file: {args.file}")
    print(f"Output path: {args.output}")
    print(f"Translation enabled: {args.translate}")
    print(f"Theater mode: {getattr(args, 'theater_mode', False)}")
    
    # Check if file exists
    if not os.path.exists(args.file):
        print(f"Error: File does not exist - {args.file}")
        sys.exit(1)
    
    # Check file size
    try:
        file_size = os.path.getsize(args.file)
        print(f"File size: {file_size / 1024 / 1024:.2f} MB")
    except Exception as e:
        print(f"Warning: Unable to get file size - {e}")
    
    try:
        # Create processor
        processor = MediaProcessor()
        
        if not processor.openai_client:
            print("Error: OpenAI client not configured, please set API key")
            sys.exit(1)
        
        # Process file
        def progress_callback(message):
            print(f"Progress: {message}")
        
        success = processor.process_file(
            file_path=args.file,
            theater_mode=getattr(args, 'theater_mode', False),
            enable_translation=args.translate,
            target_language=args.language,
            progress_callback=progress_callback
        )
        
        if success:
            # Export results
            if processor.export_to_txt(args.output):
                print(f"Processing completed, results saved to: {args.output}")
            else:
                print("Export failed")
                sys.exit(1)
        else:
            print("File processing failed")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\nUser interrupted processing")
        sys.exit(1)
    except Exception as e:
        print(f"Processing failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
