"""
Model invocation helpers for transcription and translation.
Centralizes third-party model calls so transcribe_service.py stays focused on audio.
"""

from __future__ import annotations

import os
import re
from typing import Optional
import json
from datetime import datetime


def _file_url_from_path(path: str) -> str:
    """Return a file URI string compatible with DashScope on all platforms.

    Windows:  file://C:/path/file.wav
    POSIX:    file:///absolute/path/file.wav
    """
    try:
        abspath = os.path.abspath(path).replace('\\', '/')
        if os.name == 'nt':
            if re.match(r'^[A-Za-z]:/', abspath):
                return f"file://{abspath}"
            if abspath.startswith('//'):
                return f"file:{abspath}"
            return f"file://{abspath}"
        if not abspath.startswith('/'):
            abspath = '/' + abspath
        return f"file://{abspath}"
    except Exception:
        return f"file://{path}"


def _map_language_to_qwen_code(lang: Optional[str]) -> str:
    """Map human language names/codes to Qwen codes using ASCII-only matching."""
    if not lang:
        return ''
    l = str(lang).strip().lower().replace('_', '-')
    synonyms = {
        'zh': ['zh', 'zh-cn', 'zh-hans', 'zh-hant', 'cn', 'chinese', 'simplified chinese', 'traditional chinese'],
        'en': ['en', 'eng', 'english'],
        'ja': ['ja', 'jp', 'jpn', 'japanese'],
        'ko': ['ko', 'kr', 'kor', 'korean'],
        'es': ['es', 'spa', 'spanish', 'espanol'],
        'fr': ['fr', 'fra', 'fre', 'french'],
        'de': ['de', 'deu', 'ger', 'german', 'deutsch'],
        'it': ['it', 'ita', 'italian', 'italiano'],
        'pt': ['pt', 'por', 'portuguese', 'portugues'],
        'ru': ['ru', 'rus', 'russian'],
        'ar': ['ar', 'ara', 'arabic'],
        'hi': ['hi', 'hin', 'hindi'],
        'th': ['th', 'tha', 'thai'],
        'vi': ['vi', 'vie', 'vietnamese', 'vietnam'],
        'id': ['id', 'ind', 'indonesian', 'indonesia', 'indo'],
        'tr': ['tr', 'tur', 'turkish', 'turk'],
        'nl': ['nl', 'nld', 'dut', 'dutch', 'nederlands', 'neder'],
        'pl': ['pl', 'pol', 'polish', 'polski'],
        'uk': ['uk', 'ukr', 'ukrainian', 'ukrain'],
        'cs': ['cs', 'ces', 'czech'],
    }
    for code, names in synonyms.items():
        if l == code or l in names:
            return code
    return ''


# ---------------------------- OpenAI helpers ----------------------------

def _create_openai_client(api_key: Optional[str], base_url: Optional[str]):
    if not api_key:
        raise RuntimeError('Missing OpenAI API key')
    try:
        from openai import OpenAI as OpenAIClient  # type: ignore
    except Exception as e:
        raise RuntimeError('OpenAI SDK not installed') from e
    return OpenAIClient(api_key=api_key, base_url=base_url) if base_url else OpenAIClient(api_key=api_key)


def transcribe_openai(
    filepath: str,
    language: Optional[str],
    api_key: Optional[str],
    base_url: Optional[str],
    model: Optional[str] = None,
) -> Optional[str]:
    client = _create_openai_client(api_key, base_url)
    params = {
        'model': (model or 'gpt-4o-transcribe'),
        'file': None,
        'response_format': 'text',
    }
    if language and language != 'auto':
        params['prompt'] = f'Please only transcribe in {language}'
    with open(filepath, 'rb') as f:
        params['file'] = f
        result = client.audio.transcriptions.create(**params)
    return getattr(result, 'text', str(result))


def translate_openai(
    text: str,
    target_language: str,
    api_key: Optional[str],
    base_url: Optional[str],
    model: Optional[str] = None,
) -> Optional[str]:
    if not text or not text.strip():
        return None
    client = _create_openai_client(api_key, base_url)
    system_prompt = (
        f"You are a professional translation assistant. Translate user text to {target_language}.\n"
        "Requirements:\n"
        "1) Preserve tone and style\n2) Accurate and natural\n"
        f"3) If already in {target_language}, return as-is\n4) Return only the translation"
    )
    resp = client.chat.completions.create(
        model=(model or 'gpt-4o-mini'),
        messages=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': text},
        ],
        max_tokens=5000,
        temperature=0.1,
        top_p=0.95,
    )
    return resp.choices[0].message.content.strip()


def detect_language_openai(text: str, language1: str, language2: str, api_key: Optional[str], base_url: Optional[str]) -> str:
    client = _create_openai_client(api_key, base_url)
    system_prompt = (
        f"Detect whether the user text is in '{language1}' or '{language2}'.\n"
        f"Respond with exactly one word: either {language1} or {language2}."
    )
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': text[:4000]},
        ],
        max_tokens=4,
        temperature=0,
    )
    detected = resp.choices[0].message.content.strip()
    if detected == language1:
        return language2
    if detected == language2:
        return language1
    return language2


# ---------------------------- Qwen (DashScope) ----------------------------

def _extract_text_from_qwen_output_struct(output: dict) -> Optional[str]:
    """Extract plain text from Qwen 'output' structure.

    Expected structure (per SDK examples):
    {
      "choices": [
        {
          "finish_reason": "stop",
          "message": {
            "content": [ {"text": "..."}, ... ]
          }
        }
      ]
    }
    Also supports direct fields like output["text"] or output["output_text"].
    """
    try:
        if not isinstance(output, dict):
            return None
        # Direct fields first
        direct = output.get('text') or output.get('output_text')
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        choices = output.get('choices')
        if isinstance(choices, list) and choices:
            for ch in choices:
                if not isinstance(ch, dict):
                    continue
                msg = ch.get('message')
                if not isinstance(msg, dict):
                    continue
                content = msg.get('content')
                if isinstance(content, list):
                    parts = []
                    for item in content:
                        if isinstance(item, dict):
                            txt = item.get('text') or item.get('content') or ''
                            if isinstance(txt, str) and txt.strip():
                                parts.append(txt.strip())
                        elif isinstance(item, str) and item.strip():
                            parts.append(item.strip())
                    if parts:
                        return '\n'.join(parts).strip()
                elif isinstance(content, str) and content.strip():
                    return content.strip()
        return None
    except Exception:
        return None


def transcribe_qwen(filepath: str, language: Optional[str], api_key: Optional[str]) -> Optional[str]:
    """Transcribe audio using Qwen3-ASR per Qwen3-ASR.py sample.

    - Uses dashscope.MultiModalConversation with model 'qwen3-asr-flash'
    - Builds file:// URI for local audio
    - Enables LID and ITN; sets language when provided
    - Returns plain transcription text if available, else None
    """
    # Prefer provided key; fall back to environment like Qwen3-ASR.py
    key = api_key or os.getenv('DASHSCOPE_API_KEY')
    if not key:
        return None

    try:
        import dashscope  # type: ignore
    except Exception:
        return None

    audio_uri = _file_url_from_path(filepath)
    messages = [
        {"role": "system", "content": [{"text": ""}]},
        {"role": "user", "content": [{"audio": audio_uri}]},
    ]
    asr_options = {"enable_lid": True, "enable_itn": True}
    code = _map_language_to_qwen_code(language)
    if code:
        asr_options["language"] = code

    try:
        response = dashscope.MultiModalConversation.call(
            api_key=key,
            model="qwen3-asr-flash",
            messages=messages,
            result_format="message",
            asr_options=asr_options,
        )
    except Exception:
        return None

    # Coerce SDK response to a dict-like 'output' and extract text
    output = None
    try:
        out_attr = getattr(response, 'output', None)
        if isinstance(out_attr, dict):
            output = out_attr
        elif isinstance(response, dict) and isinstance(response.get('output'), dict):
            output = response.get('output')
        else:
            # Sometimes the SDK stringifies to JSON
            try:
                as_str = str(response)
                obj = json.loads(as_str)
                if isinstance(obj, dict) and isinstance(obj.get('output'), dict):
                    output = obj.get('output')
            except Exception:
                output = None
    except Exception:
        output = None

    text = _extract_text_from_qwen_output_struct(output) if output is not None else None
    if text:
        return text

    # Log full raw response JSON to stdout for debugging if no text extracted
    try:
        raw = None
        if output is not None:
            raw = output
        else:
            try:
                raw = json.loads(str(response))
            except Exception:
                try:
                    raw = response.__dict__
                except Exception:
                    raw = str(response)
        msg = {
            "type": "log",
            "level": "info",
            "message": "Qwen raw response: " + (json.dumps(raw, ensure_ascii=False) if not isinstance(raw, str) else raw),
            "timestamp": datetime.now().isoformat()
        }
        print(json.dumps(msg, ensure_ascii=False), flush=True)
    except Exception:
        pass

    return None


# ---------------------------- Soniox ----------------------------

def transcribe_soniox(filepath: str, api_key: Optional[str]) -> Optional[str]:
    key = api_key or os.environ.get('SONIOX_API_KEY')
    if not key:
        raise RuntimeError('Missing SONIOX_API_KEY')
    try:
        import importlib
        import sys as _sys
        exe_dir = os.path.dirname(getattr(__import__('sys'), 'executable', __file__))
        if exe_dir and exe_dir not in _sys.path:
            _sys.path.insert(0, exe_dir)
        cwd = os.getcwd()
        if cwd and cwd not in _sys.path:
            _sys.path.insert(0, cwd)
        sr = importlib.import_module('soniox_realtime')
        for name in ('transcribe_file', 'transcribe_wav_file', 'transcribe_wav', 'transcribe', 'recognize_file'):
            fn = getattr(sr, name, None)
            if callable(fn):
                try:
                    return fn(filepath, key)
                except TypeError:
                    os.environ['SONIOX_API_KEY'] = key
                    return fn(filepath)
    except ModuleNotFoundError:
        pass
    raise RuntimeError('Soniox helper/SDK not available')
