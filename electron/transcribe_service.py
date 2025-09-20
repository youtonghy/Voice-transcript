#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Electron Audio Transcription and Translation Service
Communicates with Electron main process via JSON messages
"""

import sys
import json
import time
import threading
import os
import re
import queue
import uuid
import math
from datetime import datetime
import sounddevice as sd
import soundfile as sf
import numpy as np

# Set standard output encoding to UTF-8
def setup_console_encoding():
    """Set console encoding to UTF-8 to ensure proper Chinese display"""
    try:
        # Set environment variable
        os.environ['PYTHONIOENCODING'] = 'utf-8'
        
        # Reconfigure standard output streams
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        
        # Rely on environment variables set during Electron startup; no longer call external chcp to speed up startup
                
    except Exception as e:
        # If encoding setup fails, at least log the error
        try:
            print(f"Console encoding setup failed: {e}", file=sys.stderr)
        except Exception:
            pass

# Set encoding on module import
setup_console_encoding()

import modles

# Configuration constants
SAMPLE_RATE = 44100  # Fixed: use standard sampling rate
CHANNELS = 1
DTYPE = 'float32'
OUTPUT_DIR = 'recordings'

# Auto-segmentation parameters
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
SILENCE_RMS_THRESHOLD = 0.010
PRE_ROLL_SECONDS = 1.0

# Theater mode parameters
THEATER_MODE_TARGET_RMS = 0.05  # Target RMS volume
THEATER_MODE_MAX_GAIN = 10.0    # Maximum amplification factor

# OpenAI configuration (defaults; can be overridden by config)
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"

DEFAULT_CONVERSATION_TITLE_PROMPT = (
    "You are a helpful assistant who writes concise, policy-compliant conversation titles in {{TARGET_LANGUAGE}}.\n"
    "Summarize the provided conversation transcript into one short, descriptive sentence.\n"
    "Do not repeat explicit phrases; if a safe title is impossible, respond exactly with 'Sensitive conversation'."
)

DEFAULT_EMPTY_CONVERSATION_TITLE = '空对话'
MAX_SUMMARY_SEGMENTS = 12
MAX_SUMMARY_TOTAL_CHARS = 4000
CONVERSATION_TITLE_MAX_TOKENS = 96

# Global variables
is_recording = False
audio_data = []
recording_thread = None
config = {}
initial_config_applied = False
simple_recording_mode = False  # Simple recording (no VAD), for voice input
current_recording_context = 'default'  # 'default' or 'voice_input'
override_source_for_recording = None
override_transcribe_language = None
override_translate = False
override_translate_language = None

# Configuration is sent via initial update_config from Electron; no hot reload

# Segmentation detection related
audio_lock = threading.Lock()
segment_frames = 0
silence_frames_contig = 0
split_requested = False
segment_index = 1
segment_active = False
new_segment_requested = False
pre_roll_chunks = []
pre_roll_frames = 0

# Translation queue related
translation_queue = queue.PriorityQueue()  # Use priority queue to ensure order
translation_worker_thread = None
translation_worker_running = False
translation_counter = 0  # Used to ensure translation order
translation_next_expected = 1  # Worker starts expecting this order
transcription_counter = 0  # Used to ensure transcription order/placeholders
pending_translations = {}  # Store pending translation tasks {result_id: task_info}
last_volume_emit = 0.0


def _sanitize_utf8_text(text):
    if not isinstance(text, str):
        return ''
    try:
        return text.encode('utf-8', 'ignore').decode('utf-8', 'ignore')
    except Exception:
        return ''.join(ch for ch in text if 0xD800 > ord(ch) or ord(ch) > 0xDFFF)

def log_message(level, message):
    """Send log message to Electron"""
    log_msg = {
        "type": "log",
        "level": level,
        "message": str(message),
        "timestamp": datetime.now().isoformat()
    }
    send_message(log_msg)
    
    # Also output to stderr for debugging (only in development mode)
    if os.environ.get('ELECTRON_DEBUG') == '1':
        try:
            timestamp = datetime.now().strftime('%H:%M:%S')
            level_tag = f"[{level.upper():5}]"
            debug_output = f"{timestamp} {level_tag} {message}"
            print(debug_output, file=sys.stderr, flush=True)
        except Exception:
            pass

def send_message(message):
    """Send message to Electron main process"""
    try:
        json_str = json.dumps(message, ensure_ascii=False)
        print(json_str, flush=True)
        
        # Debug mode output to stderr for developer viewing
        if os.environ.get('ELECTRON_DEBUG') == '1':
            msg_type = message.get('type', 'unknown')
            msg_content = message.get('message', '')
            if isinstance(msg_content, str) and len(msg_content) > 50:
                msg_content = msg_content[:50] + "..."
            debug_msg = f"[DEBUG] Sending message: {msg_type} - {msg_content}"
            print(debug_msg, file=sys.stderr, flush=True)
            
    except (OSError, IOError, BrokenPipeError) as e:
        # stdout is closed or pipe broken, ignore silently
        # This usually happens when Electron main process closes
        pass
    except Exception as e:
        # Other exceptions try to write to stderr, if that fails too then ignore silently
        try:
            error_msg = f"Failed to send message: {e}"
            sys.stderr.write(f"{error_msg}\n")
            sys.stderr.flush()
        except (OSError, IOError, BrokenPipeError):
            pass

def amplify_audio_for_theater_mode(audio_data, target_rms=THEATER_MODE_TARGET_RMS):
    """
    Amplify audio to normal speech volume for theater mode
    
    Args:
        audio_data: numpy array, raw audio data
        target_rms: target RMS volume
    
    Returns:
        numpy array: amplified audio data
    """
    if audio_data is None or len(audio_data) == 0:
        return audio_data
    
    try:
        # Calculate current RMS
        current_rms = np.sqrt(np.mean(np.square(audio_data)))
        
        # If current volume is already loud enough, no need to amplify
        if current_rms >= target_rms:
            return audio_data
        
        # Calculate required gain
        if current_rms > 0:
            gain = target_rms / current_rms
            gain = min(gain, THEATER_MODE_MAX_GAIN)  # Limit maximum gain
        else:
            gain = 1.0
        
        # Apply gain
        amplified_audio = audio_data * gain
        
        # Prevent clipping (limit between -1 and 1)
        amplified_audio = np.clip(amplified_audio, -1.0, 1.0)
        
        log_message("info", f"Theater mode: audio amplified {gain:.2f}x (RMS: {current_rms:.4f} -> {np.sqrt(np.mean(np.square(amplified_audio))):.4f})")
        
        return amplified_audio
        
    except Exception as e:
        log_message("error", f"Audio amplification failed: {e}")
        return audio_data

def ensure_output_dir():
    """Ensure output directory exists"""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        log_message("info", f"Created recording directory: {OUTPUT_DIR}")

def check_audio_device():
    """Check if audio device is available"""
    global SAMPLE_RATE
    
    try:
        # Check default input device
        device_info = sd.query_devices(kind='input')
        log_message("info", f"Default input device: {device_info['name']}")
        
        # Check if sampling rate is supported
        try:
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"Audio device supports sampling rate {SAMPLE_RATE}Hz")
            return True
        except Exception as e:
            log_message("warning", f"Sampling rate {SAMPLE_RATE}Hz not supported, trying 16000Hz: {e}")
            # Try lower sampling rate
            SAMPLE_RATE = 16000
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"Using sampling rate {SAMPLE_RATE}Hz")
            return True
            
    except Exception as e:
        log_message("error", f"Audio device check failed: {e}")
        return False

def init_openai_client():
    """Initialize OpenAI client"""
    global openai_client
    
    if OpenAIClient is None:
        log_message("error", "OpenAI SDK not installed, cannot use transcription feature")
        return False

    api_key = config.get("openai_api_key")
    base_url = config.get("openai_base_url")

    if not api_key:
        log_message("error", "OpenAI API key not set; OpenAI features unavailable")
        return False

    try:
        if base_url:
            openai_client = OpenAIClient(api_key=api_key, base_url=base_url)
        else:
            openai_client = OpenAIClient(api_key=api_key)
        log_message("info", "OpenAI client initialized")
        return True
    except Exception as e:
        log_message("error", f"OpenAI client initialization failed: {e}")
        return False

def transcribe_with_soniox(filepath):
    """Transcribe using Soniox via models module."""
    try:
        api_key = (
            os.environ.get('SONIOX_API_KEY')
            or (config.get('soniox_api_key') if isinstance(config, dict) else None)
        )
        return modles.transcribe_soniox(filepath, api_key)
    except Exception as e:
        log_message("error", f"Soniox transcription error: {e}")
        return None

def transcribe_with_qwen3_asr(filepath):
    """Transcribe using Qwen3-ASR (DashScope)."""
    try:
        api_key = (
            os.environ.get('DASHSCOPE_API_KEY')
            or (config.get('dashscope_api_key') if isinstance(config, dict) else None)
        )
        model = None
        try:
            if isinstance(config, dict):
                model = config.get('qwen3_asr_model') or 'qwen3-asr-flash'
        except Exception:
            model = 'qwen3-asr-flash'
        # Language: prefer auto (enable_lid) to avoid mismatch with UI labels
        language = None
        try:
            tl = (config.get('transcribe_language') if isinstance(config, dict) else None)
            if tl and str(tl).strip().lower() not in ('', 'auto', 'automatic'):
                # Pass through only if already a short code like 'zh'/'en'
                if len(tl) <= 4 and tl.isalpha():
                    language = tl
        except Exception:
            pass
        enable_lid = True
        enable_itn = False
        try:
            if isinstance(config, dict):
                if 'qwen3_asr_enable_lid' in config:
                    enable_lid = bool(config.get('qwen3_asr_enable_lid'))
                if 'qwen3_asr_enable_itn' in config:
                    enable_itn = bool(config.get('qwen3_asr_enable_itn'))
        except Exception:
            pass
        return modles.transcribe_qwen3_asr(
            filepath,
            api_key=api_key,
            model=model,
            language=language,
            enable_lid=enable_lid,
            enable_itn=enable_itn,
        )
    except Exception as e:
        log_message("error", f"Qwen3-ASR transcription error: {e}")
        return None

def _translate_text_openai(text, target_language):
    """Translate text via OpenAI using models module."""
    api_key = (config.get('openai_api_key') if isinstance(config, dict) else None) or os.environ.get('OPENAI_API_KEY')
    base_url = (config.get('openai_base_url') if isinstance(config, dict) else None) or os.environ.get('OPENAI_BASE_URL')
    try:
        model = None
        try:
            if isinstance(config, dict):
                model = config.get('openai_translate_model') or OPENAI_TRANSLATE_MODEL
        except Exception:
            model = OPENAI_TRANSLATE_MODEL
        return modles.translate_openai(text, target_language, api_key, base_url, model=model)
    except Exception as e:
        log_message('error', f'Translation error: {e}')
        return None


def _translate_text_gemini(text, target_language):
    """Translate text via Gemini using models module."""
    if isinstance(config, dict):
        api_key = config.get('gemini_api_key')
        model = config.get('gemini_translate_model')
        prompt = config.get('gemini_translate_system_prompt')
    else:
        api_key = None
        model = None
        prompt = None
    api_key = api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    try:
        return modles.translate_gemini(text, target_language, api_key, model=model, system_prompt=prompt)
    except Exception as e:
        log_message('error', f'Gemini translation error: {e}')
        return None


SUPPORTED_TRANSLATION_ENGINES = {'openai', 'gemini'}


def _get_translation_engine():
    """Get configured translation engine (defaults to openai)."""
    engine = 'openai'
    try:
        if isinstance(config, dict):
            candidate = config.get('translation_engine') or ''
            if isinstance(candidate, str):
                candidate = candidate.strip().lower()
                if candidate in SUPPORTED_TRANSLATION_ENGINES:
                    engine = candidate
    except Exception:
        pass
    return engine


def _translation_credentials_available(engine=None):
    """Return True when credentials are available for the given translation engine."""
    engine = engine or _get_translation_engine()
    if engine == 'gemini':
        key = None
        try:
            if isinstance(config, dict):
                key = config.get('gemini_api_key')
        except Exception:
            key = None
        if key and isinstance(key, str) and key.strip():
            return True
        return bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
    # default: openai
    key = None
    try:
        if isinstance(config, dict):
            key = config.get('openai_api_key')
    except Exception:
        key = None
    if key and isinstance(key, str) and key.strip():
        return True
    return bool(os.environ.get('OPENAI_API_KEY'))


def _translate_text_dispatch(text, target_language):
    engine = _get_translation_engine()
    if engine == 'gemini':
        return _translate_text_gemini(text, target_language)
    return _translate_text_openai(text, target_language)


def translate_text(text, target_language='Chinese'):
    """Translate text using the configured translation engine."""
    return _translate_text_dispatch(text, target_language)


def _build_summary_text(segments):
    if not isinstance(segments, list):
        return ''
    lines = []
    count = 0
    for item in segments:
        if count >= MAX_SUMMARY_SEGMENTS:
            break
        if not isinstance(item, dict):
            continue
        transcription = _sanitize_utf8_text(item.get('transcription') if isinstance(item.get('transcription'), str) else '')
        translation = _sanitize_utf8_text(item.get('translation') if isinstance(item.get('translation'), str) else '')
        parts = []
        if transcription and transcription.strip():
            parts.append(transcription.strip())
        if translation and translation.strip() and translation.strip() != transcription.strip():
            parts.append(f"Translation: {translation.strip()}")
        if not parts:
            continue
        count += 1
        lines.append(f"{count}. {' '.join(parts)}")
    summary_text = _sanitize_utf8_text('\n'.join(lines).strip())
    if len(summary_text) > MAX_SUMMARY_TOTAL_CHARS:
        summary_text = summary_text[:MAX_SUMMARY_TOTAL_CHARS]
    return summary_text


def _summarize_text_openai(segments_text, target_language, system_prompt):
    try:
        clean_text = _sanitize_utf8_text(segments_text)
        if not clean_text:
            return None
        api_key = None
        base_url = None
        model = OPENAI_TRANSLATE_MODEL
        if isinstance(config, dict):
            api_key = config.get('openai_api_key') or os.environ.get('OPENAI_API_KEY')
            base_url = config.get('openai_base_url') or os.environ.get('OPENAI_BASE_URL')
            model = config.get('openai_translate_model') or OPENAI_TRANSLATE_MODEL
        return modles.summarize_openai(
            clean_text,
            target_language,
            api_key,
            base_url,
            model=model,
            system_prompt=system_prompt,
            max_tokens=CONVERSATION_TITLE_MAX_TOKENS,
        )
    except Exception as exc:
        log_message('error', f'OpenAI conversation title error: {exc}')
        return None


def _summarize_text_gemini(segments_text, target_language, system_prompt):
    try:
        clean_text = _sanitize_utf8_text(segments_text)
        if not clean_text:
            return None
        api_key = None
        model = None
        if isinstance(config, dict):
            api_key = config.get('gemini_api_key') or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
            model = config.get('gemini_translate_model')
        return modles.summarize_gemini(
            clean_text,
            target_language,
            api_key,
            model=model,
            system_prompt=system_prompt,
            max_tokens=CONVERSATION_TITLE_MAX_TOKENS,
        )
    except Exception as exc:
        log_message('error', f'Gemini conversation title error: {exc}')
        return None


def _summarize_text_dispatch(segments_text, target_language, system_prompt):
    engine = _get_translation_engine()
    if engine == 'gemini':
        return _summarize_text_gemini(segments_text, target_language, system_prompt)
    return _summarize_text_openai(segments_text, target_language, system_prompt)


def determine_smart_translation_target(text, language1, language2):
    """Wrapper to select target language for smart translation using models (OpenAI)."""
    api_key = (config.get('openai_api_key') if isinstance(config, dict) else None) or os.environ.get('OPENAI_API_KEY')
    base_url = (config.get('openai_base_url') if isinstance(config, dict) else None) or os.environ.get('OPENAI_BASE_URL')
    try:
        target = modles.detect_language_openai(text, language1, language2, api_key, base_url)
        return target
    except Exception as e:
        log_message("error", f"Language detection error: {e}")
        return language2

# Ensure this function definition appears after any legacy variants in the file
def determine_smart_translation_target(text, language1, language2):
    """Determine target language using OpenAI models helper (override)."""
    api_key = (config.get('openai_api_key') if isinstance(config, dict) else None) or os.environ.get('OPENAI_API_KEY')
    base_url = (config.get('openai_base_url') if isinstance(config, dict) else None) or os.environ.get('OPENAI_BASE_URL')
    try:
        return modles.detect_language_openai(text, language1, language2, api_key, base_url)
    except Exception as e:
        log_message("error", f"Language detection error: {e}")
        return language2


def start_translation_worker():
    """Start translation worker thread"""
    global translation_worker_thread, translation_worker_running
    
    if translation_worker_thread and translation_worker_thread.is_alive():
        return
    
    translation_worker_running = True
    translation_worker_thread = threading.Thread(target=translation_worker, daemon=True)
    translation_worker_thread.start()
    log_message("info", "Translation queue worker thread started, will process translation tasks in order")

def stop_translation_worker():
    """Stop translation worker thread"""
    global translation_worker_running
    translation_worker_running = False
    # Add a stop signal to the queue (use highest priority to ensure it's processed immediately)
    try:
        translation_queue.put((0, None))
    except Exception:
        pass

    # Try to join existing thread (allow up to 3s; worker get timeout is 2s)
    try:
        global translation_worker_thread
        if translation_worker_thread and translation_worker_thread.is_alive():
            translation_worker_thread.join(timeout=3.0)
    except Exception:
        pass

def restart_translation_worker():
    """Restart translation worker and align expected order with current counter."""
    global translation_counter, translation_next_expected
    try:
        stop_translation_worker()
    except Exception:
        pass
    # Clear any queued items
    try:
        while not translation_queue.empty():
            try:
                translation_queue.get_nowait()
            except queue.Empty:
                break
    except Exception:
        pass
    # Continue order numbers across sessions; worker expects next after current counter
    try:
        translation_next_expected = int(translation_counter) + 1
    except Exception:
        translation_next_expected = 1
    start_translation_worker()

def translation_worker():
    """Translation queue worker thread - process translations in order"""
    global translation_worker_running, translation_counter, translation_next_expected
    
    log_message("info", "Translation worker thread started, will process translation tasks in order")
    try:
        next_expected_order = int(translation_next_expected) if translation_next_expected and translation_next_expected > 0 else 1
    except Exception:
        next_expected_order = 1  # Next expected order number
    log_message("info", f"Translation worker initial expected order: #{next_expected_order}")
    
    while translation_worker_running:
        try:
            # Get translation task, timeout mechanism ensures response to stop signals
            try:
                priority, task = translation_queue.get(timeout=2)
            except queue.Empty:
                continue
            
            # Received stop signal
            if task is None:
                break
                
            order, result_id, transcription, target_language, context = task
            
            # Check if this is the task in expected order
            if order == next_expected_order:
                # Correct order, process immediately
                log_message("info", f"Processing translation task #{order}: {result_id}")
                
                # Execute translation
                translation = _translate_text_dispatch(transcription, target_language)
                
                if translation:
                    # Send translation update message
                    t_payload = {
                        "type": "translation_update",
                        "result_id": result_id,
                        "translation": translation.strip(),
                        "order": order,
                        "timestamp": datetime.now().isoformat()
                    }
                    if context:
                        t_payload["context"] = context
                    send_message(t_payload)
                    log_message("info", f"Translation completed #{order}: {result_id}")
                else:
                    log_message("warning", f"Translation failed #{order}: {result_id}")
                
                next_expected_order += 1
                translation_next_expected = next_expected_order
                
                # Check if there are waiting follow-up tasks to process
                while True:
                    # Look for the next task in order
                    found_next = False
                    temp_queue = []
                    
                    # Find the next task in order from the queue
                    while not translation_queue.empty():
                        try:
                            p, t = translation_queue.get_nowait()
                            if t is None:  # Stop signal
                                translation_queue.put((p, t))
                                break
                                
                            t_order = t[0]
                            if t_order == next_expected_order:
                                # Found next task
                                found_next = True
                                # Process this task immediately
                                _, t_result_id, t_transcription, t_target_language, t_context = t
                                log_message("info", f"Processing waiting translation task #{t_order}: {t_result_id}")
                                
                                t_translation = _translate_text_dispatch(t_transcription, t_target_language)
                                if t_translation:
                                    t_payload2 = {
                                        "type": "translation_update",
                                        "result_id": t_result_id,
                                        "translation": t_translation.strip(),
                                        "order": t_order,
                                        "timestamp": datetime.now().isoformat()
                                    }
                                    if t_context:
                                        t_payload2["context"] = t_context
                                    send_message(t_payload2)
                                    log_message("info", f"Translation completed #{t_order}: {t_result_id}")
                                else:
                                    log_message("warning", f"Translation failed #{t_order}: {t_result_id}")
                                
                                next_expected_order += 1
                                translation_next_expected = next_expected_order
                                break
                            else:
                                # Not the next one, put back to temp list
                                temp_queue.append((p, t))
                        except queue.Empty:
                            break
                    
                    # Put non-matching tasks back to queue
                    for item in temp_queue:
                        translation_queue.put(item)
                    
                    # If no next task found, break the loop
                    if not found_next:
                        break
            else:
                # Not expected order, put back to queue to wait
                translation_queue.put((priority, task))
                log_message("info", f"Task #{order} waiting for previous tasks to complete, currently expecting #{next_expected_order}")
                # Wait a bit before checking again
                time.sleep(0.1)
                
        except Exception as e:
            log_message("error", f"Translation worker thread error: {e}")
            import traceback
            log_message("error", f"Error details: {traceback.format_exc()}")
    
    log_message("info", "Translation worker thread stopped")

def queue_translation(result_id, transcription, target_language, context=None):
    """Queue translation task, ensure processing in order"""
    global translation_counter
    
    if not target_language or not target_language.strip():
        return False, 0
    
    # Assign order number
    translation_counter += 1
    order = translation_counter
    
    # Create task, format: (order, result_id, transcription, target_language, context)
    task = (order, result_id, transcription, target_language, context)
    
    try:
        # Use priority queue, priority is order number, ensure processing in order
        translation_queue.put((order, task), timeout=1)
        log_message("info", f"Translation task queued #{order}: {result_id}")
        return True, order
    except queue.Full:
        log_message("warning", f"Translation queue full, skipping task #{order}: {result_id}")
        return False, order

def audio_callback(indata, frames, time_info, status):
    """Audio recording callback function"""
    global audio_data, segment_frames, silence_frames_contig, split_requested
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    global is_recording, last_volume_emit
    
    if status:
        log_message("warning", f"Recording status: {status}")
    
    if not is_recording:
        return

    try:
        with audio_lock:
            if indata is None or len(indata) == 0:
                return

            try:
                rms = float(np.sqrt(np.mean(np.square(indata))))
            except Exception as e:
                log_message("warning", f"RMS calculation failed: {e}")
                rms = 0.0

            try:
                now = time.time()
                if now - last_volume_emit >= 0.1:
                    last_volume_emit = now
                    if rms > 0:
                        db = 20.0 * math.log10(rms)
                    else:
                        db = -80.0
                    silence_db = 20.0 * math.log10(SILENCE_RMS_THRESHOLD) if SILENCE_RMS_THRESHOLD > 0 else -80.0
                    send_message({
                        "type": "volume_level",
                        "rms": rms,
                        "db": db,
                        "silence_rms": SILENCE_RMS_THRESHOLD,
                        "silence_db": silence_db,
                        "timestamp": datetime.now().isoformat()
                    })
            except Exception as e:
                log_message("warning", f"Volume message failed: {e}")

            if simple_recording_mode:
                try:
                    audio_data.append(indata.copy())
                except Exception as e:
                    log_message("warning", f"Simple mode append failed: {e}")
                return

            # Non-silent: maintain pre-roll buffer
            if not segment_active:
                try:
                    pre_roll_chunks.append(indata.copy())
                    pre_roll_frames += frames
                    max_pre = int(PRE_ROLL_SECONDS * SAMPLE_RATE)
                    while pre_roll_frames > max_pre and pre_roll_chunks:
                        drop = pre_roll_chunks.pop(0)
                        pre_roll_frames -= len(drop)
                except Exception as e:
                    log_message("warning", f"Pre-roll buffer handling failed: {e}")

            # Detect voice entry: start new segment
            if not segment_active and rms >= SILENCE_RMS_THRESHOLD:
                new_segment_requested = True
                segment_active = True
                segment_frames = 0
                silence_frames_contig = 0
                
                try:
                    # Send voice activity start message
                    send_message({
                        "type": "voice_activity",
                        "active": True,
                        "timestamp": datetime.now().isoformat()
                    })
                    
                    # Merge pre-roll
                    if pre_roll_chunks:
                        for ch in pre_roll_chunks:
                            audio_data.append(ch)
                            segment_frames += len(ch)
                        pre_roll_chunks = []
                        pre_roll_frames = 0
                except Exception as e:
                    log_message("warning", f"Voice activity handling failed: {e}")

            # Within segment: save raw data
            if segment_active:
                try:
                    audio_data.append(indata.copy())
                    segment_frames += frames
                    if rms < SILENCE_RMS_THRESHOLD:
                        silence_frames_contig += frames
                        if silence_frames_contig >= int(MIN_SILENCE_SEC_FOR_SPLIT * SAMPLE_RATE):
                            split_requested = True
                            segment_active = False
                            # Send voice activity end message
                            send_message({
                                "type": "voice_activity",
                                "active": False,
                                "timestamp": datetime.now().isoformat()
                            })
                    else:
                        silence_frames_contig = 0
                except Exception as e:
                    log_message("warning", f"Audio data processing failed: {e}")
                    
    except Exception as e:
        log_message("error", f"Audio callback function error: {e}")
        # Don't re-raise exception, this would cause CFFI error

def start_recording():
    """Start recording"""
    global is_recording, audio_data, recording_thread
    global segment_frames, silence_frames_contig, split_requested, segment_index
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    global translation_counter

    if is_recording:
        log_message("warning", "Recording already in progress")
        return

    # Trace start request parameters
    try:
        log_message("info", f"Start recording request (simple_mode={simple_recording_mode}, context={current_recording_context})")
    except Exception:
        pass

    # Check audio device
    if not check_audio_device():
        log_message("error", "Audio device check failed, cannot start recording")
        send_message({
            "type": "recording_error", 
            "message": "Audio device not available, please check microphone permissions and device connection",
            "timestamp": datetime.now().isoformat()
        })
        return
    
    # Reset translation worker/queue depending on context and overrides
    try:
        engine = _get_translation_engine()
        credentials_ok = _translation_credentials_available(engine)
        enable_flag = bool(config.get('enable_translation', True)) if isinstance(config, dict) else True
        if current_recording_context == 'voice_input':
            should_translate = bool(override_translate) and credentials_ok
            if override_translate and not credentials_ok:
                log_message('warning', f"Voice input translation requested but {engine} credentials are missing")
        else:
            should_translate = enable_flag and credentials_ok
            if enable_flag and not credentials_ok:
                log_message('warning', f"Translation enabled but {engine} credentials missing; translation skipped")
        if should_translate:
            restart_translation_worker()
            log_message("info", f"Translation worker restarted; next order will be #{translation_next_expected}")
        else:
            stop_translation_worker()
            # Clear any lingering queue items
            while not translation_queue.empty():
                try:
                    translation_queue.get_nowait()
                except queue.Empty:
                    break
            log_message("info", "Translation worker stopped (by context or config); cleared queue")
    except Exception as _e:
        log_message("warning", f"Failed to reset translation worker: {_e}")
    
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
    
    log_message("info", "Recording started")

def record_audio():
    """Recording thread"""
    global is_recording, split_requested, segment_index, audio_data
    global new_segment_requested
    
    try:
        log_message("info", f"Starting audio recording, sampling rate: {SAMPLE_RATE}Hz, channels: {CHANNELS}")
        
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback,
            blocksize=1024  # Add fixed block size
        ) as stream:
            log_message("info", "Audio stream started")
            
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
        error_msg = f"Audio device error: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"Audio device error, please check microphone permissions or restart application: {e}",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        error_msg = f"Recording error: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"Recording encountered unknown error: {e}",
            "timestamp": datetime.now().isoformat()
        })
    finally:
        log_message("info", "Recording thread ended")

def stop_recording():
    """Stop recording"""
    global is_recording, audio_data, recording_thread, segment_active
    
    if not is_recording:
        return
    
    is_recording = False
    
    if recording_thread and recording_thread.is_alive():
        recording_thread.join()
    
    if audio_data:
        save_audio_file()
    # Notify main process that recording has completely stopped (for external coordination restart)
    try:
        send_message({
            "type": "recording_stopped",
            "timestamp": datetime.now().isoformat()
        })
    except Exception:
        pass

def save_audio_file():
    """Save final audio segment"""
    global audio_data
    with audio_lock:
        local_chunks = audio_data
        audio_data = []
    process_segment_chunks(local_chunks, None, False)

def process_segment_chunks(chunks, seg_idx=None, from_split=False):
    """Process audio chunks with a placeholder-first flow"""
    global transcription_counter
    try:
        if not chunks:
            return
        combined_audio = np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
        duration_seconds = float(len(combined_audio)) / float(SAMPLE_RATE) if len(combined_audio) > 0 else 0.0
        recorded_at = datetime.now()

        # Assign result_id and order, send placeholder first to maintain ordering in UI
        transcription_counter += 1
        trans_order = transcription_counter
        result_id = str(uuid.uuid4())
        if not simple_recording_mode:
            try:
                payload = {
                    "type": "result",
                    "result_id": result_id,
                    "transcription": "",
                    "transcription_pending": True,
                    "transcription_order": trans_order,
                    "timestamp": recorded_at.isoformat(),
                    "recorded_at": recorded_at.isoformat(),
                    "duration_seconds": duration_seconds
                }
                if current_recording_context == 'voice_input':
                    payload["context"] = "voice_input"
                send_message(payload)
            except Exception:
                pass

        process_combined_audio(
            combined_audio,
            seg_idx,
            from_split,
            result_id=result_id,
            trans_order=trans_order,
            recorded_at=recorded_at,
            duration_seconds=duration_seconds
        )
    except Exception as e:
        log_message("error", f"Error processing audio segment: {e}")

def process_combined_audio(
    combined_audio,
    seg_idx=None,
    from_split=False,
    result_id=None,
    trans_order=None,
    recorded_at=None,
    duration_seconds=None
):
    """Save combined audio and transcribe/translate"""
    try:
        # Check if theater mode is enabled
        theater_mode_enabled = config.get('theater_mode', False)
        
        # If theater mode is enabled, amplify audio first
        if theater_mode_enabled:
            combined_audio = amplify_audio_for_theater_mode(combined_audio)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if seg_idx is not None:
            filename = f"recording_{timestamp}_seg{seg_idx}.wav"
        else:
            filename = f"recording_{timestamp}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)

        sf.write(filepath, combined_audio, SAMPLE_RATE)

        if recorded_at is None:
            recorded_at = datetime.now()
        if duration_seconds is None:
            duration_seconds = float(len(combined_audio)) / float(SAMPLE_RATE) if len(combined_audio) > 0 else 0.0

        # Transcribe audio, with possible overrides in voice-input simple mode
        original_source = None
        original_lang = None
        try:
            original_source = config.get('transcribe_source') if isinstance(config, dict) else None
            original_lang = config.get('transcribe_language') if isinstance(config, dict) else None
        except Exception:
            pass
        try:
            if override_source_for_recording:
                try: config['transcribe_source'] = override_source_for_recording
                except Exception: pass
            if override_transcribe_language:
                try: config['transcribe_language'] = override_transcribe_language
                except Exception: pass
            transcription = transcribe_audio_file(filepath)
        finally:
            try:
                if original_source is not None:
                    config['transcribe_source'] = original_source
            except Exception:
                pass
            try:
                if original_lang is not None:
                    config['transcribe_language'] = original_lang
            except Exception:
                pass
        if transcription:
            # Use existing result_id/order if provided (placeholder flow)
            if not result_id:
                result_id = str(uuid.uuid4())
            # Send transcription update to fill the placeholder
            try:
                payload = {
                    "type": "transcription_update",
                    "result_id": result_id,
                    "transcription": transcription.strip(),
                    "order": trans_order or 0,
                    "timestamp": recorded_at.isoformat(),
                    "recorded_at": recorded_at.isoformat(),
                    "duration_seconds": float(duration_seconds)
                }
                if current_recording_context == 'voice_input':
                    payload["context"] = "voice_input"
                send_message(payload)
            except Exception:
                pass

            # Translation policy
            if current_recording_context == 'voice_input':
                # Only translate when explicitly requested for voice input
                if override_translate:
                    target_language = override_translate_language or config.get('translate_language', 'Chinese')
                    if target_language and target_language.strip() and translation_worker_running:
                        ctx = ("voice_input" if current_recording_context == 'voice_input' else None)
                        queue_success, translation_order = queue_translation(result_id, transcription, target_language, context=ctx)
                        if queue_success:
                            log_message("info", f"VoiceInput: queued translation (order #{translation_order}) for result {result_id}")
            elif config.get('enable_translation', True):
                if not translation_worker_running:
                    # Translation worker not ready; skip queuing translation tasks for this result
                    pass
                else:
                    translation_mode = config.get('translation_mode', 'fixed')
                    
                    if translation_mode == 'smart':
                        # Smart translation mode
                        language1 = config.get('smart_language1', 'Chinese')
                        language2 = config.get('smart_language2', 'English')
                        
                        # Determine transcription text language and target translation
                        smart_target = determine_smart_translation_target(transcription, language1, language2)
                        
                        if smart_target:
                            # Asynchronously queue translation task, get translation order
                            ctx = ("voice_input" if current_recording_context == 'voice_input' else None)
                            queue_success, translation_order = queue_translation(result_id, transcription, smart_target, context=ctx)
                            
                            # For translation, we rely on translation_update later; placeholder already exists
                            # If queue fails, do nothing further here
                        else:
                            # Smart translation failed; keep transcription only
                            pass
                    else:
                        # Fixed translation mode (non-voice_input)
                        target_language = config.get('translate_language', 'Chinese')
                        if target_language and target_language.strip():
                            # Asynchronously queue translation task, get translation order
                            ctx = ("voice_input" if current_recording_context == 'voice_input' else None)
                            queue_success, translation_order = queue_translation(result_id, transcription, target_language, context=ctx)
                            # If queue fails, we keep transcription only
            else:
                # Translation not enabled: nothing else to do; placeholder already filled
                pass
        else:
            # No transcription produced
            try:
                req_src = None
                try:
                    req_src = override_source_for_recording if override_source_for_recording else (config.get('transcribe_source') if isinstance(config, dict) else None)
                except Exception:
                    req_src = None
                log_message("warning", f"Transcription empty (requested_source={req_src}, context={current_recording_context})")
            except Exception:
                pass

            # Delete audio file
            try:
                os.remove(filepath)
            except Exception as delete_error:
                pass  # Ignore silent deletion failure
    except Exception as e:
        log_message("error", f"Error saving/transcribing audio file: {e}")

def determine_smart_translation_target(text, language1, language2):
    """Determine target language for smart translation using models helper (OpenAI)."""
    api_key = (config.get('openai_api_key') if isinstance(config, dict) else None) or os.environ.get('OPENAI_API_KEY')
    base_url = (config.get('openai_base_url') if isinstance(config, dict) else None) or os.environ.get('OPENAI_BASE_URL')
    try:
        return modles.detect_language_openai(text, language1, language2, api_key, base_url)
    except Exception as e:
        log_message("error", f"Language detection failed: {e}")
        return language2

def translate_text(text, target_language="Chinese"):
    """Translate text via configured translation engine (override)."""
    return _translate_text_dispatch(text, target_language)

def transcribe_audio_file(filepath):
    """Transcribe audio file using selected source."""
    source = (config.get('transcribe_source') if isinstance(config, dict) else None) or 'openai'
    if source == 'soniox':
        log_message("info", "Transcribing via Soniox backend")
        return transcribe_with_soniox(filepath)
    if source in ('qwen3-asr', 'qwen', 'dashscope'):
        log_message("info", "Transcribing via Qwen3-ASR (DashScope)")
        return transcribe_with_qwen3_asr(filepath)

    # Default: OpenAI via models module
    try:
        transcribe_language = config.get('transcribe_language', 'auto')
        api_key = (config.get('openai_api_key') if isinstance(config, dict) else None) or os.environ.get('OPENAI_API_KEY')
        base_url = (config.get('openai_base_url') if isinstance(config, dict) else None) or os.environ.get('OPENAI_BASE_URL')
        model = None
        try:
            if isinstance(config, dict):
                model = config.get('openai_transcribe_model') or OPENAI_TRANSCRIBE_MODEL
        except Exception:
            model = OPENAI_TRANSCRIBE_MODEL
        return modles.transcribe_openai(filepath, transcribe_language, api_key, base_url, model=model)
    except Exception as e:
        log_message("error", f"Transcription failed: {e}")
        return None

def handle_message(message):
    """Handle messages from Electron"""
    global config
    
    try:
        msg_type = message.get("type")
        log_message("info", f"Handling message type: {msg_type}")
        
        if msg_type == "start_recording":
            log_message("info", "Executing start recording command")
            # Normal mode
            global simple_recording_mode, current_recording_context
            simple_recording_mode = False
            current_recording_context = 'default'
            start_recording()
        elif msg_type == "stop_recording":
            log_message("info", "Executing stop recording command")
            stop_recording()
        elif msg_type == "start_voice_input":
            log_message("info", "Start simple voice input recording")
            global override_source_for_recording, override_transcribe_language, override_translate, override_translate_language
            simple_recording_mode = True
            current_recording_context = 'voice_input'
            override_source_for_recording = message.get('override_source')
            override_transcribe_language = message.get('transcribe_language')
            override_translate = bool(message.get('translate', False))
            override_translate_language = message.get('translate_language')
            start_recording()
        elif msg_type == "stop_voice_input":
            log_message("info", "Stop simple voice input recording")
            stop_recording()
            # Reset overrides
            simple_recording_mode = False
            current_recording_context = 'default'
            override_source_for_recording = None
            override_transcribe_language = None
            override_translate = False
            override_translate_language = None
        elif msg_type == "summarize_conversation":
            request_id = message.get('request_id') or str(uuid.uuid4())
            conversation_id = message.get('conversation_id')
            segments = message.get('segments') if isinstance(message.get('segments'), list) else []
            empty_title = _sanitize_utf8_text(message.get('empty_title') if isinstance(message.get('empty_title'), str) else DEFAULT_EMPTY_CONVERSATION_TITLE)
            fallback_title = _sanitize_utf8_text(message.get('fallback_title') if isinstance(message.get('fallback_title'), str) else empty_title)
            target_language = _sanitize_utf8_text(message.get('target_language') if isinstance(message.get('target_language'), str) and message.get('target_language').strip() else 'Chinese')
            if not target_language:
                target_language = 'Chinese'
            system_prompt = message.get('system_prompt') if isinstance(message.get('system_prompt'), str) and message.get('system_prompt').strip() else None
            if not system_prompt:
                candidate_prompt = None
                if isinstance(config, dict):
                    candidate_prompt = config.get('conversation_title_system_prompt')
                if isinstance(candidate_prompt, str) and candidate_prompt.strip():
                    system_prompt = _sanitize_utf8_text(candidate_prompt.strip())
                else:
                    system_prompt = DEFAULT_CONVERSATION_TITLE_PROMPT
            elif isinstance(system_prompt, str):
                system_prompt = _sanitize_utf8_text(system_prompt) or DEFAULT_CONVERSATION_TITLE_PROMPT
            summary_text = _build_summary_text(segments)
            payload = {
                'type': 'conversation_summary',
                'request_id': request_id,
                'conversation_id': conversation_id,
                'context_updated_at': message.get('updated_at') if isinstance(message.get('updated_at'), str) else None,
            }
            if not summary_text:
                payload.update({'title': empty_title, 'source': 'empty'})
                send_message(payload)
                return
            engine = _get_translation_engine()
            if not _translation_credentials_available(engine):
                payload.update({'title': fallback_title, 'source': 'credentials_missing', 'engine': engine})
                send_message(payload)
                return
            try:
                title = _summarize_text_dispatch(summary_text, target_language, system_prompt)
                if isinstance(title, str) and title.strip():
                    cleaned = title.replace('\n', ' ').strip()
                else:
                    cleaned = ''
                if cleaned and len(cleaned) > 80:
                    cleaned = cleaned[:80].strip()
                if cleaned and cleaned.lower() == 'sensitive conversation':
                    cleaned = ''
                if cleaned and ('�' in cleaned or '??' in cleaned):
                    cleaned = ''
                final_title = cleaned if cleaned else fallback_title
                final_title = _sanitize_utf8_text(final_title)
                payload.update({
                    'title': final_title if final_title else empty_title,
                    'source': 'model' if cleaned else 'fallback',
                    'engine': engine,
                })
                send_message(payload)
            except Exception as exc:
                log_message('error', f'Conversation title generation failed: {exc}')
                safe_fallback = _sanitize_utf8_text(fallback_title) or empty_title
                payload.update({'title': safe_fallback, 'source': 'error', 'engine': engine})
                send_message(payload)
            return
        elif msg_type == "shutdown":
            # Graceful exit: if recording, stop first; then stop translation thread and exit
            log_message("info", "Received service shutdown command, preparing graceful exit")
            try:
                if is_recording:
                    stop_recording()
            except Exception:
                pass
            try:
                stop_translation_worker()
            except Exception:
                pass
            # Send about to exit notification
            try:
                send_message({
                    "type": "log",
                    "level": "info",
                    "message": "Received shutdown command, service will exit",
                    "timestamp": datetime.now().isoformat()
                })
            except Exception:
                pass
            # Trigger system exit, let main loop and finally cleanup handle the rest
            raise SystemExit(0)
        elif msg_type == "update_config":
            global initial_config_applied
            force = bool(message.get('force'))
            if initial_config_applied and not force:
                log_message("info", "Config update received while running; ignored (no force). Will apply on next start.")
                return
            new_config = message.get("config", {})
            log_message("info", f"Applying initial config keys: {list(new_config.keys())}")
            # Record old config to determine changes
            old_config = config.copy() if isinstance(config, dict) else {}
            config = new_config
            initial_config_applied = True
            try:
                if not isinstance(config, dict):
                    config = {}
                if 'conversation_title_system_prompt' not in config or not isinstance(config.get('conversation_title_system_prompt'), str) or not config.get('conversation_title_system_prompt').strip():
                    config['conversation_title_system_prompt'] = DEFAULT_CONVERSATION_TITLE_PROMPT
            except Exception:
                config['conversation_title_system_prompt'] = DEFAULT_CONVERSATION_TITLE_PROMPT
            try:
                src = config.get('transcribe_source', 'openai')
                oai_set = bool(config.get('openai_api_key') or os.environ.get('OPENAI_API_KEY'))
                sxi_set = bool(config.get('soniox_api_key') or os.environ.get('SONIOX_API_KEY'))
                gemini_set = bool(config.get('gemini_api_key') or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
                log_message("info", f"Config applied. transcribe_source={src}, openai_key_set={oai_set}, soniox_key_set={sxi_set}, gemini_key_set={gemini_set}")
            except Exception:
                pass

            # No model client pre-initialization needed after refactor
            success = True

            # Apply recording detection thresholds (initial)
            global SILENCE_RMS_THRESHOLD, MIN_SILENCE_SEC_FOR_SPLIT
            try:
                if 'silence_rms_threshold' in config and isinstance(config.get('silence_rms_threshold'), (int, float)):
                    SILENCE_RMS_THRESHOLD = float(config.get('silence_rms_threshold'))
                    log_message("info", f"Applied silence threshold: {SILENCE_RMS_THRESHOLD}")
                if 'min_silence_seconds' in config and isinstance(config.get('min_silence_seconds'), (int, float)):
                    MIN_SILENCE_SEC_FOR_SPLIT = float(config.get('min_silence_seconds'))
                    log_message("info", f"Applied min silence duration: {MIN_SILENCE_SEC_FOR_SPLIT}s")
            except Exception as _e:
                log_message("warning", f"Failed applying recording thresholds: {_e}")

            # Manage translation worker based on config (initial)
            enable_tr = config.get('enable_translation', True)
            global translation_worker_running
            engine = _get_translation_engine()
            credentials_ok = _translation_credentials_available(engine)
            translation_ready = bool(enable_tr) and credentials_ok
            if translation_ready:
                start_translation_worker()
                log_message('info', f"Translation worker ready (engine={engine})")
            else:
                if translation_worker_running:
                    stop_translation_worker()
                    reason = 'disabled'
                    if enable_tr and not credentials_ok:
                        reason = f'{engine} credentials missing'
                    log_message('info', f"Stopped translation worker ({reason})")
        else:
            log_message("warning", f"Unknown message type: {msg_type}")
            
    except Exception as e:
        log_message("error", f"Failed to handle message: {e}")
        import traceback
        log_message("error", f"Traceback: {traceback.format_exc()}")

def main():
    """Main function"""
    import traceback
    global is_recording, recording_thread
    
    # Encoding already set on module import, only check debug mode here
    debug_mode = os.environ.get('ELECTRON_DEBUG') == '1'
    if debug_mode:
        print("Debug mode enabled", file=sys.stderr, flush=True)
    
    try:
        ensure_output_dir()
        
        log_message("info", "Service is starting...")
        log_message("info", f"Python version: {sys.version}")
        log_message("info", f"Working directory: {os.getcwd()}")
        # Notify Electron that service is ready
        log_message("info", "Service started, waiting for commands...")
        
        # Skip startup audio device enumeration and dependency check, changed to check when recording starts
        
        # Read stdin messages
        line_count = 0
        for line in sys.stdin:
            line_count += 1
            line = line.strip()
            if not line:
                continue
                
            log_message("info", f"Received message {line_count}: {line[:100]}...")
            
            try:
                message = json.loads(line)
                log_message("info", f"Message parsed successfully: {message.get('type', 'unknown')}")
                handle_message(message)
            except json.JSONDecodeError as e:
                log_message("error", f"JSON parsing failed: {e}, original message: {line}")
            except Exception as e:
                log_message("error", f"Error handling message: {e}")
                log_message("error", f"Error details: {traceback.format_exc()}")
                
    except KeyboardInterrupt:
        # On interrupt signal, gracefully shutdown
        try:
            log_message("info", "Received interrupt signal, exiting...")
        except:
            pass
        # Stop recording
        if is_recording:
            try:
                is_recording = False
                if recording_thread and recording_thread.is_alive():
                    recording_thread.join(timeout=2)
            except:
                pass
        # Stop translation worker thread
        try:
            stop_translation_worker()
        except:
            pass
    except (BrokenPipeError, OSError) as e:
        # Pipe broken, usually main process is closed, exit directly
        # Stop translation worker thread
        try:
            stop_translation_worker()
        except:
            pass
    except Exception as e:
        try:
            log_message("error", f"Main function exception: {e}")
            log_message("error", f"Exception details: {traceback.format_exc()}")
        except:
            pass
        # Stop translation worker thread
        try:
            stop_translation_worker()
        except:
            pass
    finally:
        # Ensure translation worker thread stops
        try:
            stop_translation_worker()
        except:
            pass
        try:
            log_message("info", "Transcription service stopped")
        except:
            pass

if __name__ == "__main__":
    main()
