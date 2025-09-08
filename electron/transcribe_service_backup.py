#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Electron闊抽杞啓缈昏瘧鏈嶅姟
閫氳繃JSON娑堟伅涓嶦lectron涓昏繘绋嬮€氫俊
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

# 璁剧疆鏍囧噯杈撳嚭缂栫爜涓篣TF-8
def setup_console_encoding():
    """璁剧疆鎺у埗鍙扮紪鐮佷负UTF-8锛岀‘淇濅腑鏂囨纭樉绀?""
    try:
        # 璁剧疆鐜鍙橀噺
        os.environ['PYTHONIOENCODING'] = 'utf-8'
        
        # 閲嶆柊閰嶇疆鏍囧噯杈撳嚭娴?
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        
        # 渚濊禆 Electron 鍚姩鏃剁殑鐜鍙橀噺鍗冲彲锛涗笉鍐嶈皟鐢ㄥ閮?chcp 浠ュ姞蹇惎鍔?
                
    except Exception as e:
        # 濡傛灉缂栫爜璁剧疆澶辫触锛岃嚦灏戣褰曢敊璇?
        try:
            print(f"Console encoding setup failed: {e}", file=sys.stderr)
        except Exception:
            pass

# 鍦ㄥ鍏ユ椂灏辫缃紪鐮?
setup_console_encoding()

try:
    from openai import OpenAI as OpenAIClient
except Exception:
    OpenAIClient = None

# 閰嶇疆甯搁噺
SAMPLE_RATE = 44100  # 淇锛氫娇鐢ㄦ爣鍑嗛噰鏍风巼
CHANNELS = 1
DTYPE = 'float32'
OUTPUT_DIR = 'recordings'

# 鑷姩鍒嗘鍙傛暟
MIN_SILENCE_SEC_FOR_SPLIT = 1.0
SILENCE_RMS_THRESHOLD = 0.010
PRE_ROLL_SECONDS = 1.0

# 鍓у満妯″紡鍙傛暟
THEATER_MODE_TARGET_RMS = 0.05  # 鐩爣RMS闊抽噺
THEATER_MODE_MAX_GAIN = 10.0    # 鏈€澶ф斁澶у€嶆暟

# OpenAI閰嶇疆
OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
OPENAI_TRANSLATE_MODEL = "gpt-4o-mini"

# 鍏ㄥ眬鍙橀噺
openai_client = None
is_recording = False
audio_data = []
recording_thread = None
config = {}
initial_config_applied = False

# 閰嶇疆閫氳繃 Electron 鍒濆 update_config 涓嬪彂锛涗笉鍋氱儹鍔犺浇

# 鍒嗘妫€娴嬬浉鍏?
audio_lock = threading.Lock()
segment_frames = 0
silence_frames_contig = 0
split_requested = False
segment_index = 1
segment_active = False
new_segment_requested = False
pre_roll_chunks = []
pre_roll_frames = 0

# 缈昏瘧闃熷垪鐩稿叧
translation_queue = queue.PriorityQueue()  # 浣跨敤浼樺厛绾ч槦鍒楃‘淇濋『搴?
translation_worker_thread = None
translation_worker_running = False
translation_counter = 0  # 鐢ㄤ簬纭繚缈昏瘧椤哄簭
pending_translations = {}  # 瀛樺偍绛夊緟缈昏瘧鐨勪换鍔?{result_id: task_info}

def log_message(level, message):
    """鍙戦€佹棩蹇楁秷鎭埌Electron"""
    log_msg = {
        "type": "log",
        "level": level,
        "message": str(message),
        "timestamp": datetime.now().isoformat()
    }
    send_message(log_msg)
    
    # 鍚屾椂杈撳嚭鍒皊tderr鐢ㄤ簬璋冭瘯锛堝彧鍦ㄥ紑鍙戞ā寮忎笅锛?
    if os.environ.get('ELECTRON_DEBUG') == '1':
        try:
            timestamp = datetime.now().strftime('%H:%M:%S')
            level_tag = f"[{level.upper():5}]"
            debug_output = f"{timestamp} {level_tag} {message}"
            print(debug_output, file=sys.stderr, flush=True)
        except Exception:
            pass

def send_message(message):
    """鍙戦€佹秷鎭埌Electron涓昏繘绋?""
    try:
        json_str = json.dumps(message, ensure_ascii=False)
        print(json_str, flush=True)
        
        # 璋冭瘯妯″紡涓嬭緭鍑哄埌stderr锛屼究浜庡紑鍙戣€呮煡鐪?
        if os.environ.get('ELECTRON_DEBUG') == '1':
            msg_type = message.get('type', 'unknown')
            msg_content = message.get('message', '')
            if isinstance(msg_content, str) and len(msg_content) > 50:
                msg_content = msg_content[:50] + "..."
            debug_msg = f"[DEBUG] 鍙戦€佹秷鎭? {msg_type} - {msg_content}"
            print(debug_msg, file=sys.stderr, flush=True)
            
    except (OSError, IOError, BrokenPipeError) as e:
        # stdout宸插叧闂垨绠￠亾鏂紑锛岄潤榛樺拷鐣?
        # 杩欓€氬父鍙戠敓鍦‥lectron涓昏繘绋嬪叧闂椂
        pass
    except Exception as e:
        # 鍏朵粬寮傚父灏濊瘯鍐欏叆stderr锛屽鏋滀篃澶辫触鍒欓潤榛樺拷鐣?
        try:
            error_msg = f"鍙戦€佹秷鎭け璐? {e}"
            sys.stderr.write(f"{error_msg}\n")
            sys.stderr.flush()
        except (OSError, IOError, BrokenPipeError):
            pass

def amplify_audio_for_theater_mode(audio_data, target_rms=THEATER_MODE_TARGET_RMS):
    """
    涓哄墽鍦烘ā寮忔斁澶ч煶棰戝埌姝ｅ父璇磋瘽闊抽噺
    
    Args:
        audio_data: numpy鏁扮粍锛屽師濮嬮煶棰戞暟鎹?
        target_rms: 鐩爣RMS闊抽噺
    
    Returns:
        numpy鏁扮粍锛氭斁澶у悗鐨勯煶棰戞暟鎹?
    """
    if audio_data is None or len(audio_data) == 0:
        return audio_data
    
    try:
        # 璁＄畻褰撳墠RMS
        current_rms = np.sqrt(np.mean(np.square(audio_data)))
        
        # 濡傛灉褰撳墠闊抽噺宸茬粡澶熷ぇ锛屼笉闇€瑕佹斁澶?
        if current_rms >= target_rms:
            return audio_data
        
        # 璁＄畻闇€瑕佺殑澧炵泭
        if current_rms > 0:
            gain = target_rms / current_rms
            gain = min(gain, THEATER_MODE_MAX_GAIN)  # 闄愬埗鏈€澶у鐩?
        else:
            gain = 1.0
        
        # 搴旂敤澧炵泭
        amplified_audio = audio_data * gain
        
        # 闃叉鍓婃尝锛堥檺鍒跺湪-1鍒?涔嬮棿锛?
        amplified_audio = np.clip(amplified_audio, -1.0, 1.0)
        
        log_message("info", f"鍓у満妯″紡锛氶煶棰戞斁澶?{gain:.2f}x (RMS: {current_rms:.4f} -> {np.sqrt(np.mean(np.square(amplified_audio))):.4f})")
        
        return amplified_audio
        
    except Exception as e:
        log_message("error", f"闊抽鏀惧ぇ澶辫触: {e}")
        return audio_data

def ensure_output_dir():
    """纭繚杈撳嚭鐩綍瀛樺湪"""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        log_message("info", f"宸插垱寤哄綍闊崇洰褰? {OUTPUT_DIR}")

def check_audio_device():
    """妫€鏌ラ煶棰戣澶囨槸鍚﹀彲鐢?""
    global SAMPLE_RATE
    
    try:
        # 妫€鏌ラ粯璁よ緭鍏ヨ澶?
        device_info = sd.query_devices(kind='input')
        log_message("info", f"榛樿杈撳叆璁惧: {device_info['name']}")
        
        # 妫€鏌ラ噰鏍风巼鏄惁鏀寔
        try:
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"闊抽璁惧鏀寔閲囨牱鐜?{SAMPLE_RATE}Hz")
            return True
        except Exception as e:
            log_message("warning", f"閲囨牱鐜?{SAMPLE_RATE}Hz 涓嶆敮鎸侊紝灏濊瘯 16000Hz: {e}")
            # 灏濊瘯闄嶄綆閲囨牱鐜?
            SAMPLE_RATE = 16000
            sd.check_input_settings(device=None, channels=CHANNELS, dtype=DTYPE, samplerate=SAMPLE_RATE)
            log_message("info", f"浣跨敤閲囨牱鐜?{SAMPLE_RATE}Hz")
            return True
            
    except Exception as e:
        log_message("error", f"闊抽璁惧妫€鏌ュけ璐? {e}")
        return False

def init_openai_client():
    """鍒濆鍖朞penAI瀹㈡埛绔?""
    global openai_client
    
    if OpenAIClient is None:
        log_message("error", "鏈畨瑁卭penai SDK锛屾棤娉曚娇鐢ㄨ浆鍐欏姛鑳?)
        return False

    api_key = config.get("openai_api_key")
    base_url = config.get("openai_base_url")

    if not api_key:
        log_message("error", "鏈缃瓵PI瀵嗛挜锛岃浆鍐欏姛鑳戒笉鍙敤")
        return False

    try:
        if base_url:
            openai_client = OpenAIClient(api_key=api_key, base_url=base_url)
        else:
            openai_client = OpenAIClient(api_key=api_key)
        log_message("info", "OpenAI瀹㈡埛绔凡鍒濆鍖?)
        return True
    except Exception as e:
        log_message("error", f"OpenAI瀹㈡埛绔垵濮嬪寲澶辫触: {e}")
        return False


def start_translation_worker():
    """鍚姩缈昏瘧宸ヤ綔绾跨▼"""
    global translation_worker_thread, translation_worker_running, translation_counter
    
    if translation_worker_thread and translation_worker_thread.is_alive():
        return
    
    # 閲嶇疆缈昏瘧璁℃暟鍣紝纭繚浠?寮€濮?
    translation_counter = 0
    
    translation_worker_running = True
    translation_worker_thread = threading.Thread(target=translation_worker, daemon=True)
    translation_worker_thread.start()
    log_message("info", "缈昏瘧闃熷垪宸ヤ綔绾跨▼宸插惎鍔紝灏嗘寜椤哄簭澶勭悊缈昏瘧浠诲姟")

def stop_translation_worker():
    """鍋滄缈昏瘧宸ヤ綔绾跨▼"""
    global translation_worker_running
    translation_worker_running = False
    # 娣诲姞涓€涓仠姝俊鍙峰埌闃熷垪锛堜娇鐢ㄦ渶楂樹紭鍏堢骇纭繚鑳借鍙婃椂澶勭悊锛?
    translation_queue.put((0, None))

def translation_worker():
    """缈昏瘧闃熷垪宸ヤ綔绾跨▼ - 鎸夐『搴忓鐞嗙炕璇?""
    global translation_worker_running, translation_counter
    
    log_message("info", "缈昏瘧宸ヤ綔绾跨▼宸插惎鍔紝灏嗘寜椤哄簭澶勭悊缈昏瘧浠诲姟")
    next_expected_order = 1  # 涓嬩竴涓湡鏈涘鐞嗙殑椤哄簭鍙?
    
    while translation_worker_running:
        try:
            # 鑾峰彇缈昏瘧浠诲姟锛岃秴鏃舵満鍒剁‘淇濊兘鍝嶅簲鍋滄淇″彿
            try:
                priority, task = translation_queue.get(timeout=2)
            except queue.Empty:
                continue
            
            # 鏀跺埌鍋滄淇″彿
            if task is None:
                break
                
            order, result_id, transcription, target_language = task
            
            # 妫€鏌ユ槸鍚︽槸鎸夐『搴忕殑浠诲姟
            if order == next_expected_order:
                # 姝ｇ‘椤哄簭锛岀珛鍗冲鐞?
                log_message("info", f"澶勭悊缈昏瘧浠诲姟 #{order}: {result_id}")
                
                # 鎵ц缈昏瘧
                translation = translate_text(transcription, target_language)
                
                if translation:
                    # 鍙戦€佺炕璇戞洿鏂版秷鎭?
                    send_message({
                        "type": "translation_update",
                        "result_id": result_id,
                        "translation": translation.strip(),
                        "order": order,
                        "timestamp": datetime.now().isoformat()
                    })
                    log_message("info", f"缈昏瘧瀹屾垚 #{order}: {result_id}")
                else:
                    log_message("warning", f"缈昏瘧澶辫触 #{order}: {result_id}")
                
                next_expected_order += 1
                
                # 妫€鏌ユ槸鍚︽湁绛夊緟鐨勫悗缁换鍔″彲浠ュ鐞?
                while True:
                    # 鏌ユ壘涓嬩竴涓『搴忕殑浠诲姟
                    found_next = False
                    temp_queue = []
                    
                    # 浠庨槦鍒椾腑鏌ユ壘涓嬩竴涓『搴忕殑浠诲姟
                    while not translation_queue.empty():
                        try:
                            p, t = translation_queue.get_nowait()
                            if t is None:  # 鍋滄淇″彿
                                translation_queue.put((p, t))
                                break
                                
                            t_order = t[0]
                            if t_order == next_expected_order:
                                # 鎵惧埌涓嬩竴涓换鍔?
                                found_next = True
                                # 绔嬪嵆澶勭悊杩欎釜浠诲姟
                                _, t_result_id, t_transcription, t_target_language = t
                                log_message("info", f"澶勭悊绛夊緟鐨勭炕璇戜换鍔?#{t_order}: {t_result_id}")
                                
                                t_translation = translate_text(t_transcription, t_target_language)
                                if t_translation:
                                    send_message({
                                        "type": "translation_update",
                                        "result_id": t_result_id,
                                        "translation": t_translation.strip(),
                                        "order": t_order,
                                        "timestamp": datetime.now().isoformat()
                                    })
                                    log_message("info", f"缈昏瘧瀹屾垚 #{t_order}: {t_result_id}")
                                else:
                                    log_message("warning", f"缈昏瘧澶辫触 #{t_order}: {t_result_id}")
                                
                                next_expected_order += 1
                                break
                            else:
                                # 涓嶆槸涓嬩竴涓紝鏀惧洖涓存椂鍒楄〃
                                temp_queue.append((p, t))
                        except queue.Empty:
                            break
                    
                    # 灏嗕笉鍖归厤鐨勪换鍔℃斁鍥為槦鍒?
                    for item in temp_queue:
                        translation_queue.put(item)
                    
                    # 濡傛灉娌℃湁鎵惧埌涓嬩竴涓换鍔★紝璺冲嚭寰幆
                    if not found_next:
                        break
            else:
                # 涓嶆槸鏈熸湜鐨勯『搴忥紝閲嶆柊鏀惧洖闃熷垪绛夊緟
                translation_queue.put((priority, task))
                log_message("info", f"浠诲姟 #{order} 绛夊緟鍓嶅簭浠诲姟瀹屾垚锛屽綋鍓嶆湡鏈?#{next_expected_order}")
                # 绛夊緟涓€浼氬効鍐嶆鏌?
                time.sleep(0.1)
                
        except Exception as e:
            log_message("error", f"缈昏瘧宸ヤ綔绾跨▼閿欒: {e}")
            import traceback
            log_message("error", f"閿欒璇︽儏: {traceback.format_exc()}")
    
    log_message("info", "缈昏瘧宸ヤ綔绾跨▼宸插仠姝?)

def queue_translation(result_id, transcription, target_language):
    """灏嗙炕璇戜换鍔″姞鍏ラ槦鍒楋紝纭繚鎸夐『搴忓鐞?""
    global translation_counter
    
    if not target_language or not target_language.strip():
        return False, 0
    
    # 鍒嗛厤椤哄簭鍙?
    translation_counter += 1
    order = translation_counter
    
    # 鍒涘缓浠诲姟锛屾牸寮忥細(order, result_id, transcription, target_language)
    task = (order, result_id, transcription, target_language)
    
    try:
        # 浣跨敤浼樺厛绾ч槦鍒楋紝浼樺厛绾у氨鏄『搴忓彿锛岀‘淇濇寜椤哄簭澶勭悊
        translation_queue.put((order, task), timeout=1)
        log_message("info", f"缈昏瘧浠诲姟宸插姞鍏ラ槦鍒?#{order}: {result_id}")
        return True, order
    except queue.Full:
        log_message("warning", f"缈昏瘧闃熷垪宸叉弧锛岃烦杩囦换鍔?#{order}: {result_id}")
        return False, order

def audio_callback(indata, frames, time, status):
    """闊抽褰曞埗鍥炶皟鍑芥暟"""
    global audio_data, segment_frames, silence_frames_contig, split_requested
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    global is_recording
    
    if status:
        log_message("warning", f"褰曢煶鐘舵€? {status}")
    
    if not is_recording:
        return
    
    try:
        with audio_lock:
            try:
                # 纭繚杈撳叆鏁版嵁鏄湁鏁堢殑numpy鏁扮粍
                if indata is None or len(indata) == 0:
                    return
                    
                # 璁＄畻RMS闊抽噺
                rms = float(np.sqrt(np.mean(np.square(indata))))
            except Exception as e:
                log_message("warning", f"RMS璁＄畻澶辫触: {e}")
                rms = 0.0

            # 闈炴鍐咃細缁存姢棰勬粴鍔ㄧ紦鍐?
            if not segment_active:
                try:
                    pre_roll_chunks.append(indata.copy())
                    pre_roll_frames += frames
                    max_pre = int(PRE_ROLL_SECONDS * SAMPLE_RATE)
                    while pre_roll_frames > max_pre and pre_roll_chunks:
                        drop = pre_roll_chunks.pop(0)
                        pre_roll_frames -= len(drop)
                except Exception as e:
                    log_message("warning", f"棰勬粴鍔ㄧ紦鍐插鐞嗗け璐? {e}")

            # 妫€娴嬭繘鍏ヨ闊筹細寮€鍚柊娈?
            if not segment_active and rms >= SILENCE_RMS_THRESHOLD:
                new_segment_requested = True
                segment_active = True
                segment_frames = 0
                silence_frames_contig = 0
                
                try:
                    # 鍙戦€佽闊虫椿鍔ㄥ紑濮嬫秷鎭?
                    send_message({
                        "type": "voice_activity",
                        "active": True,
                        "timestamp": datetime.now().isoformat()
                    })
                    
                    # 鍚堝苟棰勬粴
                    if pre_roll_chunks:
                        for ch in pre_roll_chunks:
                            audio_data.append(ch)
                            segment_frames += len(ch)
                        pre_roll_chunks = []
                        pre_roll_frames = 0
                except Exception as e:
                    log_message("warning", f"璇煶娲诲姩澶勭悊澶辫触: {e}")

            # 娈靛唴锛氫繚瀛樺師濮嬫暟鎹?
            if segment_active:
                try:
                    audio_data.append(indata.copy())
                    segment_frames += frames
                    if rms < SILENCE_RMS_THRESHOLD:
                        silence_frames_contig += frames
                        if silence_frames_contig >= int(MIN_SILENCE_SEC_FOR_SPLIT * SAMPLE_RATE):
                            split_requested = True
                            segment_active = False
                            # 鍙戦€佽闊虫椿鍔ㄧ粨鏉熸秷鎭?
                            send_message({
                                "type": "voice_activity",
                                "active": False,
                                "timestamp": datetime.now().isoformat()
                            })
                    else:
                        silence_frames_contig = 0
                except Exception as e:
                    log_message("warning", f"闊抽鏁版嵁澶勭悊澶辫触: {e}")
                    
    except Exception as e:
        log_message("error", f"闊抽鍥炶皟鍑芥暟閿欒: {e}")
        # 涓嶈閲嶆柊鎶涘嚭寮傚父锛岃繖浼氬鑷碈FFI閿欒

def start_recording():
    """寮€濮嬪綍闊?""
    global is_recording, audio_data, recording_thread
    global segment_frames, silence_frames_contig, split_requested, segment_index
    global segment_active, new_segment_requested, pre_roll_chunks, pre_roll_frames
    global translation_counter
    
    if is_recording:
        log_message("warning", "褰曢煶宸插湪杩涜涓?)
        return
    
    # 妫€鏌ラ煶棰戣澶?
    if not check_audio_device():
        log_message("error", "闊抽璁惧妫€鏌ュけ璐ワ紝鏃犳硶寮€濮嬪綍闊?)
        send_message({
            "type": "recording_error", 
            "message": "闊抽璁惧涓嶅彲鐢紝璇锋鏌ラ害鍏嬮鏉冮檺鍜岃澶囪繛鎺?,
            "timestamp": datetime.now().isoformat()
        })
        return
    
    # 娓呯┖缈昏瘧闃熷垪锛岄噸缃炕璇戣鏁板櫒锛堜负鏂扮殑褰曢煶浼氳瘽鍋氬噯澶囷級
    while not translation_queue.empty():
        try:
            translation_queue.get_nowait()
        except queue.Empty:
            break
    translation_counter = 0
    log_message("info", "缈昏瘧闃熷垪宸叉竻绌猴紝鍑嗗鏂扮殑褰曢煶浼氳瘽")
    
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
    
    log_message("info", "褰曢煶宸插紑濮?)

def record_audio():
    """褰曢煶绾跨▼"""
    global is_recording, split_requested, segment_index, audio_data
    global new_segment_requested
    
    try:
        log_message("info", f"寮€濮嬮煶棰戝綍鍒讹紝閲囨牱鐜? {SAMPLE_RATE}Hz, 澹伴亾: {CHANNELS}")
        
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback,
            blocksize=1024  # 娣诲姞鍥哄畾鐨勫潡澶у皬
        ) as stream:
            log_message("info", "闊抽娴佸凡鍚姩")
            
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
        error_msg = f"闊抽璁惧閿欒: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"闊抽璁惧閿欒锛岃妫€鏌ラ害鍏嬮鏉冮檺鎴栭噸鍚簲鐢? {e}",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        error_msg = f"褰曢煶閿欒: {e}"
        log_message("error", error_msg)
        send_message({
            "type": "recording_error",
            "message": f"褰曢煶鍙戠敓鏈煡閿欒: {e}",
            "timestamp": datetime.now().isoformat()
        })
    finally:
        log_message("info", "褰曢煶绾跨▼缁撴潫")

def stop_recording():
    """鍋滄褰曢煶"""
    global is_recording, audio_data, recording_thread, segment_active
    
    if not is_recording:
        return
    
    is_recording = False
    
    if recording_thread and recording_thread.is_alive():
        recording_thread.join()
    
    if audio_data:
        save_audio_file()
    # 閫氱煡涓昏繘绋嬪綍闊冲凡瀹屽叏鍋滄锛堢敤浜庡閮ㄥ崗璋冮噸鍚級
    try:
        send_message({
            "type": "recording_stopped",
            "timestamp": datetime.now().isoformat()
        })
    except Exception:
        pass

def save_audio_file():
    """淇濆瓨鏈€鍚庝竴娈甸煶棰戞枃浠?""
    global audio_data
    with audio_lock:
        local_chunks = audio_data
        audio_data = []
    process_segment_chunks(local_chunks, None, False)

def process_segment_chunks(chunks, seg_idx=None, from_split=False):
    """澶勭悊闊抽鍧?""
    try:
        if not chunks:
            return
        combined_audio = np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
        process_combined_audio(combined_audio, seg_idx, from_split)
    except Exception as e:
        log_message("error", f"澶勭悊闊抽娈垫椂鍑洪敊: {e}")

def process_combined_audio(combined_audio, seg_idx=None, from_split=False):
    """淇濆瓨鍚堝苟鍚庣殑闊抽骞惰浆鍐欑炕璇?""
    try:
        # 妫€鏌ユ槸鍚﹀惎鐢ㄥ墽鍦烘ā寮?
        theater_mode_enabled = config.get('theater_mode', False)
        
        # 濡傛灉鍚敤鍓у満妯″紡锛屽厛鏀惧ぇ闊抽
        if theater_mode_enabled:
            combined_audio = amplify_audio_for_theater_mode(combined_audio)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if seg_idx is not None:
            filename = f"recording_{timestamp}_seg{seg_idx}.wav"
        else:
            filename = f"recording_{timestamp}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)

        sf.write(filepath, combined_audio, SAMPLE_RATE)

        # 杞啓闊抽
        transcription = transcribe_audio_file(filepath)
        if transcription:
            # 鐢熸垚鍞竴鐨勭粨鏋淚D
            result_id = str(uuid.uuid4())
            
            # 妫€鏌ユ槸鍚﹀惎鐢ㄧ炕璇?
            if config.get('enable_translation', True):
                translation_mode = config.get('translation_mode', 'fixed')
                
                if translation_mode == 'smart':
                    # 鏅鸿兘缈昏瘧妯″紡
                    language1 = config.get('smart_language1', '涓枃')
                    language2 = config.get('smart_language2', 'English')
                    
                    # 鍒ゆ柇杞綍鏂囨湰鐨勮瑷€骞剁‘瀹氱炕璇戠洰鏍?
                    smart_target = determine_smart_translation_target(transcription, language1, language2)
                    
                    if smart_target:
                        # 寮傛鎺掗槦缈昏瘧浠诲姟锛岃幏鍙栫炕璇戦『搴?
                        queue_success, translation_order = queue_translation(result_id, transcription, smart_target)
                        
                        if queue_success:
                            # 绔嬪嵆鍙戦€佽浆鍐欑粨鏋滐紙甯︾炕璇戝崰浣嶇鍜岄『搴忎俊鎭級
                            send_message({
                                "type": "result",
                                "result_id": result_id,
                                "transcription": transcription.strip(),
                                "translation_pending": True,
                                "translation_order": translation_order,
                                "smart_translation": True,
                                "detected_language": language1 if smart_target == language2 else language2,
                                "target_language": smart_target,
                                "timestamp": datetime.now().isoformat()
                            })
                        else:
                            # 缈昏瘧闃熷垪澶辫触锛屽彂閫佹棤缈昏瘧鐨勭粨鏋?
                            send_message({
                                "type": "result_final",
                                "result_id": result_id,
                                "transcription": transcription.strip(),
                                "timestamp": datetime.now().isoformat()
                            })
                    else:
                        # 鏅鸿兘缈昏瘧澶辫触锛屽彧鍙戦€佽浆鍐?
                        send_message({
                            "type": "result",
                            "result_id": result_id,
                            "transcription": transcription.strip(),
                            "timestamp": datetime.now().isoformat()
                        })
                else:
                    # 鍥哄畾缈昏瘧妯″紡锛堝師鏈夐€昏緫锛?
                    target_language = config.get('translate_language', '涓枃')
                    if target_language and target_language.strip():
                        # 寮傛鎺掗槦缈昏瘧浠诲姟锛岃幏鍙栫炕璇戦『搴?
                        queue_success, translation_order = queue_translation(result_id, transcription, target_language)
                        
                        if queue_success:
                            # 绔嬪嵆鍙戦€佽浆鍐欑粨鏋滐紙甯︾炕璇戝崰浣嶇鍜岄『搴忎俊鎭級
                            send_message({
                                "type": "result",
                                "result_id": result_id,
                                "transcription": transcription.strip(),
                                "translation_pending": True,
                                "translation_order": translation_order,
                                "timestamp": datetime.now().isoformat()
                            })
                        else:
                            # 缈昏瘧闃熷垪澶辫触锛屽彂閫佹棤缈昏瘧鐨勭粨鏋?
                            send_message({
                                "type": "result_final",
                                "result_id": result_id,
                                "transcription": transcription.strip(),
                                "timestamp": datetime.now().isoformat()
                            })
                    else:
                        # 鏈缃洰鏍囪瑷€锛屽彧鍙戦€佽浆鍐?
                        send_message({
                            "type": "result",
                            "result_id": result_id,
                            "transcription": transcription.strip(),
                            "timestamp": datetime.now().isoformat()
                        })
            else:
                # 鏈惎鐢ㄧ炕璇戯細鐩存帴鍙戦€佽浆鍐?
                send_message({
                    "type": "result",
                    "result_id": result_id,
                    "transcription": transcription.strip(),
                    "timestamp": datetime.now().isoformat()
                })

            # 鍒犻櫎闊抽鏂囦欢
            try:
                os.remove(filepath)
            except Exception as delete_error:
                pass  # 闈欓粯鍒犻櫎澶辫触
    except Exception as e:
        log_message("error", f"淇濆瓨/杞啓闊抽鏂囦欢鏃跺嚭閿? {e}")

def determine_smart_translation_target(text, language1, language2):
    """
    鏅鸿兘缈昏瘧锛氬垽鏂枃鏈瑷€骞惰繑鍥炵洰鏍囩炕璇戣瑷€
    
    Args:
        text: 瑕佺炕璇戠殑鏂囨湰
        language1: 鏅鸿兘缈昏瘧璇█1
        language2: 鏅鸿兘缈昏瘧璇█2
    
    Returns:
        鐩爣缈昏瘧璇█锛屽鏋滄棤娉曞垽鏂垯杩斿洖None
    """
    global openai_client
    
    if not openai_client or not text or not text.strip():
        return None
    
    try:
        # 浣跨敤OpenAI鏉ュ垽鏂枃鏈殑涓昏璇█
        detection_prompt = f"""璇峰垽鏂互涓嬫枃鏈富瑕佷娇鐢ㄧ殑鏄摢绉嶈瑷€锛屽彧闇€瑕佸洖绛旇瑷€鍚嶇О銆?

鍙€夎瑷€锛歿language1}銆亄language2}

濡傛灉鏂囨湰涓昏鏄瘂language1}锛岃鍥炵瓟"{language1}"
濡傛灉鏂囨湰涓昏鏄瘂language2}锛岃鍥炵瓟"{language2}"
濡傛灉鏃犳硶鍒ゆ柇鎴栧寘鍚绉嶈瑷€锛岃鍥炵瓟"鏈煡"

鏂囨湰锛歿text}"""

        response = openai_client.chat.completions.create(
            model=OPENAI_TRANSLATE_MODEL,
            messages=[
                {"role": "system", "content": "浣犳槸涓€涓笓涓氱殑璇█璇嗗埆鍔╂墜銆?},
                {"role": "user", "content": detection_prompt}
            ],
            max_tokens=50,
            temperature=0.1,
            top_p=0.95,
            frequency_penalty=0,
            presence_penalty=0,
            stop=None,
            stream=False
        )
        
        detected_language = response.choices[0].message.content.strip()
        log_message("info", f"妫€娴嬪埌鏂囨湰璇█: {detected_language}")
        
        # 鏍规嵁妫€娴嬬粨鏋滆繑鍥炵洰鏍囩炕璇戣瑷€
        if detected_language == language1:
            return language2
        elif detected_language == language2:
            return language1
        else:
            # 鏃犳硶鍒ゆ柇璇█锛岄粯璁ょ炕璇戜负璇█2
            log_message("warning", f"鏃犳硶鍑嗙‘鍒ゆ柇璇█锛岄粯璁ょ炕璇戜负: {language2}")
            return language2
            
    except Exception as e:
        log_message("error", f"璇█妫€娴嬪け璐? {e}")
        # 鍑洪敊鏃堕粯璁ょ炕璇戜负璇█2
        return language2

def translate_text(text, target_language="涓枃"):
    """缈昏瘧鏂囨湰"""
    global openai_client
    
    if not openai_client or not text or not text.strip():
        return None
    
    try:
        system_prompt = f"""浣犳槸涓€涓笓涓氱殑缈昏瘧鍔╂墜銆傝灏嗙敤鎴锋彁渚涚殑鏂囨湰缈昏瘧涓簕target_language}銆?

缈昏瘧瑕佹眰锛?
1. 淇濇寔鍘熸枃鐨勮姘斿拰椋庢牸
2. 纭繚缈昏瘧鍑嗙‘鑷劧
3. 濡傛灉鍘熸枃宸茬粡鏄瘂target_language}锛岃鐩存帴杩斿洖鍘熸枃
4. 鍙繑鍥炵炕璇戠粨鏋滐紝涓嶈娣诲姞浠讳綍瑙ｉ噴鎴栬鏄?""

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
        log_message("error", f"缈昏瘧澶辫触: {e}")
        return None

def transcribe_audio_file(filepath):
    """杞啓闊抽鏂囦欢"""
    global openai_client

    if openai_client is None:
        log_message("error", "OpenAI瀹㈡埛绔湭閰嶇疆锛屾棤娉曡浆鍐?)
        return None

    try:
        # 鑾峰彇杞綍璇█璁剧疆
        transcribe_language = config.get('transcribe_language', 'auto')
        
        # 鍑嗗杞綍鍙傛暟
        transcribe_params = {
            "model": OPENAI_TRANSCRIBE_MODEL,
            "file": None,  # 灏嗗湪涓嬮潰璁剧疆
            "response_format": "text",
        }
        
        # 濡傛灉璁剧疆浜嗙壒瀹氱殑杞綍璇█锛屾坊鍔犳彁绀鸿瘝
        if transcribe_language and transcribe_language != 'auto':
            transcribe_params["prompt"] = f"璇峰彧杞綍涓簕transcribe_language}"
            log_message("info", f"浣跨敤杞綍璇█: {transcribe_language}")
        
        with open(filepath, "rb") as audio_file:
            transcribe_params["file"] = audio_file
            result = openai_client.audio.transcriptions.create(**transcribe_params)
        
        return getattr(result, "text", str(result))
    except Exception as e:
        log_message("error", f"杞啓澶辫触: {e}")
        return None

def handle_message(message):
    """澶勭悊鏉ヨ嚜Electron鐨勬秷鎭?""
    global config
    
    try:
        msg_type = message.get("type")
        log_message("info", f"澶勭悊娑堟伅绫诲瀷: {msg_type}")
        
        if msg_type == "start_recording":
            log_message("info", "鎵ц寮€濮嬪綍闊冲懡浠?)
            start_recording()
        elif msg_type == "stop_recording":
            log_message("info", "鎵ц鍋滄褰曢煶鍛戒护")
            stop_recording()
        elif msg_type == "shutdown":
            # 浼橀泤閫€鍑猴細鑻ュ湪褰曢煶锛屽厛鍋滄锛涚劧鍚庡仠姝㈢炕璇戠嚎绋嬪苟閫€鍑?
            log_message("info", "鏀跺埌鍏抽棴鏈嶅姟鍛戒护锛屽噯澶囦紭闆呴€€鍑?)
            try:
                if is_recording:
                    stop_recording()
            except Exception:
                pass
            try:
                stop_translation_worker()
            except Exception:
                pass
            # 鍙戦€佸嵆灏嗛€€鍑烘彁绀?
            try:
                send_message({
                    "type": "log",
                    "level": "info",
                    "message": "鏀跺埌鍏抽棴鍛戒护锛屾湇鍔″嵆灏嗛€€鍑?,
                    "timestamp": datetime.now().isoformat()
                })
            except Exception:
                pass
            # 瑙﹀彂绯荤粺閫€鍑猴紝璁╀富寰幆鍜宖inally娓呯悊鏀跺熬
            raise SystemExit(0)
        elif msg_type == "update_config":
            global initial_config_applied
            if initial_config_applied:
                log_message("info", "Config update received while running; saved to file and will apply on next start.")
                return
            new_config = message.get("config", {})
            log_message("info", f"Applying initial config keys: {list(new_config.keys())}")
            # 璁板綍鏃ч厤缃互鍒ゆ柇鍙樻洿
            old_config = config.copy() if isinstance(config, dict) else {}
            config = new_config
            initial_config_applied = True

            # Re-init OpenAI client only if key or base URL changed
            need_reinit = (
                old_config.get('openai_api_key') != config.get('openai_api_key') or
                old_config.get('openai_base_url') != config.get('openai_base_url')
            )
            if need_reinit or (OpenAIClient is not None and (openai_client is None)):
                success = init_openai_client()
                log_message("info", f"OpenAI client init result: {success}")
            else:
                success = openai_client is not None

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
            if success and enable_tr:
                start_translation_worker()
            else:
                if translation_worker_running:
                    stop_translation_worker()
                    log_message("info", "Stopped translation worker (disabled by config)")
        else:
            log_message("warning", f"Unknown message type: {msg_type}")
            
    except Exception as e:
        log_message("error", f"Failed to handle message: {e}")
        import traceback
        log_message("error", f"Traceback: {traceback.format_exc()}")

def main():
    """涓诲嚱鏁?""
    import traceback
    global is_recording, recording_thread
    
    # 缂栫爜宸茬粡鍦ㄦā鍧楀鍏ユ椂璁剧疆锛岃繖閲屽彧妫€鏌ヨ皟璇曟ā寮?
    debug_mode = os.environ.get('ELECTRON_DEBUG') == '1'
    if debug_mode:
        print("璋冭瘯妯″紡宸插惎鐢?, file=sys.stderr, flush=True)
    
    try:
        ensure_output_dir()
        
        log_message("info", "Service is starting...")
        log_message("info", f"Python version: {sys.version}")
        log_message("info", f"Working directory: {os.getcwd()}")
        # Notify Electron that service is ready
        log_message("info", "Service started, waiting for commands...")
        
        # 鐪佺暐鍚姩鏃剁殑闊抽璁惧鏋氫妇鍜屼緷璧栨鏌ワ紝鏀逛负鍦ㄥ紑濮嬪綍闊虫椂妫€鏌?
        
        # 璇诲彇stdin娑堟伅
        line_count = 0
        for line in sys.stdin:
            line_count += 1
            line = line.strip()
            if not line:
                continue
                
            log_message("info", f"鏀跺埌绗瑊line_count}鏉℃秷鎭? {line[:100]}...")
            
            try:
                message = json.loads(line)
                log_message("info", f"瑙ｆ瀽娑堟伅鎴愬姛: {message.get('type', 'unknown')}")
                handle_message(message)
            except json.JSONDecodeError as e:
                log_message("error", f"JSON瑙ｆ瀽澶辫触: {e}, 鍘熷娑堟伅: {line}")
            except Exception as e:
                log_message("error", f"澶勭悊娑堟伅鏃跺嚭閿? {e}")
                log_message("error", f"閿欒璇︽儏: {traceback.format_exc()}")
                
    except KeyboardInterrupt:
        # 鏀跺埌涓柇淇″彿鏃讹紝浼橀泤鍏抽棴
        try:
            log_message("info", "鏀跺埌涓柇淇″彿锛屾鍦ㄩ€€鍑?..")
        except:
            pass
        # 鍋滄褰曢煶
        if is_recording:
            try:
                is_recording = False
                if recording_thread and recording_thread.is_alive():
                    recording_thread.join(timeout=2)
            except:
                pass
        # 鍋滄缈昏瘧宸ヤ綔绾跨▼
        try:
            stop_translation_worker()
        except:
            pass
    except (BrokenPipeError, OSError) as e:
        # 绠￠亾鏂紑锛岄€氬父鏄富杩涚▼宸插叧闂紝鐩存帴閫€鍑?
        # 鍋滄缈昏瘧宸ヤ綔绾跨▼
        try:
            stop_translation_worker()
        except:
            pass
    except Exception as e:
        try:
            log_message("error", f"涓诲嚱鏁板紓甯? {e}")
            log_message("error", f"寮傚父璇︽儏: {traceback.format_exc()}")
        except:
            pass
        # 鍋滄缈昏瘧宸ヤ綔绾跨▼
        try:
            stop_translation_worker()
        except:
            pass
    finally:
        # 纭繚缈昏瘧宸ヤ綔绾跨▼鍋滄
        try:
            stop_translation_worker()
        except:
            pass
        try:
            log_message("info", "杞啓鏈嶅姟宸插仠姝?)
        except:
            pass

if __name__ == "__main__":
    main()
