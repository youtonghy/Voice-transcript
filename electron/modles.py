"""
Model invocation helpers for transcription and translation.
Centralizes third-party model calls so transcribe_service.py stays focused on audio.
"""

from __future__ import annotations

import os
from typing import Optional
import json
from datetime import datetime


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


# ---------------------------- Qwen3-ASR (DashScope) ----------------------------

def _to_file_uri(path: str) -> str:
    try:
        if not path:
            return path
        p = os.path.abspath(path)
        p = p.replace('\\', '/')
        # Ensure triple slash for Windows drive paths
        if ':' in p[:3]:
            return f"file:///{p}"
        # Posix absolute
        if p.startswith('/'):
            return f"file://{p}"
        return f"file:///{p}"
    except Exception:
        return f"file://{path}"


def transcribe_qwen3_asr(
    filepath: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    language: Optional[str] = None,
    enable_lid: bool = True,
    enable_itn: bool = False,
) -> Optional[str]:
    key = api_key or os.environ.get('DASHSCOPE_API_KEY')
    if not key:
        raise RuntimeError('Missing DASHSCOPE_API_KEY (DashScope)')
    try:
        import dashscope  # type: ignore
    except Exception as e:
        raise RuntimeError('DashScope SDK (dashscope) not installed') from e

    file_uri = _to_file_uri(filepath)
    messages = [
        {"role": "system", "content": [{"text": ""}]},
        {"role": "user", "content": [{"audio": file_uri}]},
    ]
    asr_opts = {
        "enable_lid": bool(enable_lid),
        "enable_itn": bool(enable_itn),
    }
    # Only pass language if caller provides code like 'zh'/'en'; otherwise rely on LID
    if language and language.lower() not in ("auto", "automatic"):
        asr_opts["language"] = language
    resp = dashscope.MultiModalConversation.call(
        api_key=key,
        model=(model or 'qwen3-asr-flash'),
        messages=messages,
        result_format='message',
        asr_options=asr_opts,
    )
    # Parse message content -> first text part
    try:
        choices = (resp or {}).get('output', {}).get('choices', [])
        if not choices:
            # Some versions may expose attributes
            output = getattr(resp, 'output', None)
            if output and isinstance(output, dict):
                choices = output.get('choices', [])
        if choices:
            msg = choices[0].get('message') or {}
            content = msg.get('content') or []
            # Find first text entry
            for item in content:
                t = item.get('text') if isinstance(item, dict) else None
                if t and str(t).strip():
                    return str(t).strip()
    except Exception:
        pass
    # Fallback: stringify response
    try:
        return json.dumps(resp, ensure_ascii=False)
    except Exception:
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
