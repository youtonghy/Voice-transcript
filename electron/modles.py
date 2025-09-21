"""
Model invocation helpers for transcription and translation.
Centralizes third-party model calls so transcribe_service.py stays focused on audio.
"""

from __future__ import annotations

import os
from typing import Optional
import json
from datetime import datetime
import urllib.request
import urllib.error
import urllib.parse


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


def optimize_openai(
    text: str,
    api_key: Optional[str],
    base_url: Optional[str],
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    if not text or not text.strip():
        return None
    client = _create_openai_client(api_key, base_url)
    prompt = (system_prompt or DEFAULT_OPTIMIZE_PROMPT).strip() or DEFAULT_OPTIMIZE_PROMPT
    resp = client.chat.completions.create(
        model=(model or 'gpt-4o-mini'),
        messages=[
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': text.strip()},
        ],
        max_tokens=800,
        temperature=0.25,
        top_p=0.9,
    )
    content = resp.choices[0].message.content if resp.choices else None
    if isinstance(content, str):
        try:
            return content.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
        except Exception:
            return ''.join(ch for ch in content if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    return None


def summarize_openai(
    segments_text: str,
    target_language: Optional[str],
    api_key: Optional[str],
    base_url: Optional[str],
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    max_tokens: int = 120,
) -> Optional[str]:
    if not segments_text or not segments_text.strip():
        return None
    client = _create_openai_client(api_key, base_url)
    prompt = (system_prompt or '').strip()
    if target_language:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', target_language)
    prompt = prompt or (
        'You are an assistant who writes concise, policy-compliant conversation titles in {{TARGET_LANGUAGE}}.\n'
        'Summarize the provided transcript into one short sentence. Return only the title.'
    )
    if target_language and '{{TARGET_LANGUAGE}}' in prompt:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', target_language)
    elif '{{TARGET_LANGUAGE}}' in prompt:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', 'the requested language')
    resp = client.chat.completions.create(
        model=(model or 'gpt-4o-mini'),
        messages=[
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': segments_text.strip()},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
        top_p=0.9,
    )
    content = resp.choices[0].message.content if resp.choices else None
    if isinstance(content, str):
        try:
            return content.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
        except Exception:
            return ''.join(ch for ch in content if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    return None


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

# ---------------------------- Gemini ----------------------------

DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
DEFAULT_GEMINI_SYSTEM_PROMPT = (
    'You are a professional translation assistant. Translate user text into {{TARGET_LANGUAGE}}.\n'
    'Requirements:\n'
    '1) Preserve the tone and intent of the original text.\n'
    '2) Ensure the translation is natural and fluent.\n'
    '3) If the input is already in {{TARGET_LANGUAGE}}, return it unchanged.\n'
    '4) Respond with the translation only without additional commentary.'
)

DEFAULT_OPTIMIZE_PROMPT = (
    'You are a friendly conversation coach.\n'
    'Rewrite the provided text so it sounds natural, fluent, and conversational while keeping the original meaning.\n'
    'Return only the rewritten sentence without additional commentary.'
)


def translate_gemini(
    text: str,
    target_language: str,
    api_key: Optional[str],
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    if not text or not text.strip():
        return None
    key = api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not key:
        raise RuntimeError('Missing Gemini API key')
    model_name = (model or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    prompt = (system_prompt or DEFAULT_GEMINI_SYSTEM_PROMPT) or DEFAULT_GEMINI_SYSTEM_PROMPT
    if target_language:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', target_language)
    else:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', 'the target language')
    body = {
        'systemInstruction': {
            'parts': [{'text': prompt}]
        },
        'contents': [
            {
                'role': 'user',
                'parts': [{'text': text.strip()}]
            }
        ],
        'generationConfig': {
            'temperature': 0.1,
            'topP': 0.95,
            'maxOutputTokens': 2048,
        }
    }
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            'Content-Type': 'application/json; charset=utf-8'
        }
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = exc.read().decode('utf-8', 'ignore')
        except Exception:
            pass
        message = detail or exc.reason or ''
        raise RuntimeError(f'Gemini API error {exc.code}: {message}') from exc
    except Exception as exc:
        raise RuntimeError(f'Gemini API request failed: {exc}') from exc

    try:
        parsed = json.loads(payload) if isinstance(payload, str) else payload
    except Exception as exc:
        raise RuntimeError(f'Gemini API returned invalid JSON: {exc}') from exc

    candidates = parsed.get('candidates') if isinstance(parsed, dict) else None
    if isinstance(candidates, list):
        for candidate in candidates:
            content = candidate.get('content') if isinstance(candidate, dict) else None
            if not isinstance(content, dict):
                continue
            parts = content.get('parts')
            if isinstance(parts, list):
                for part in parts:
                    text_part = part.get('text') if isinstance(part, dict) else None
                    if isinstance(text_part, str) and text_part.strip():
                        try:
                            return text_part.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
                        except Exception:
                            return ''.join(ch for ch in text_part if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    # Fallback: top-level text field
    top_level_text = parsed.get('text') if isinstance(parsed, dict) else None
    if isinstance(top_level_text, str) and top_level_text.strip():
        try:
            return top_level_text.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
        except Exception:
            return ''.join(ch for ch in top_level_text if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    return None


def summarize_gemini(
    segments_text: str,
    target_language: Optional[str],
    api_key: Optional[str],
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    max_tokens: int = 160,
) -> Optional[str]:
    if not segments_text or not segments_text.strip():
        return None
    key = api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not key:
        raise RuntimeError('Missing Gemini API key')
    model_name = (model or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    prompt = (system_prompt or '').strip()
    if target_language:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', target_language)
    prompt = prompt or (
        'You write concise conversation titles in {{TARGET_LANGUAGE}}.\n'
        'Summarize the transcript into one short sentence and return only the title.'
    )
    if target_language and '{{TARGET_LANGUAGE}}' in prompt:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', target_language)
    elif '{{TARGET_LANGUAGE}}' in prompt:
        prompt = prompt.replace('{{TARGET_LANGUAGE}}', 'the requested language')
    body = {
        'systemInstruction': {
            'parts': [{'text': prompt}]
        },
        'contents': [
            {
                'role': 'user',
                'parts': [{'text': segments_text.strip()}]
            }
        ],
        'generationConfig': {
            'temperature': 0.2,
            'topP': 0.9,
            'maxOutputTokens': max_tokens,
        }
    }
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            'Content-Type': 'application/json; charset=utf-8'
        }
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = exc.read().decode('utf-8', 'ignore')
        except Exception:
            pass
        message = detail or exc.reason or ''
        raise RuntimeError(f'Gemini API error {exc.code}: {message}') from exc
    except Exception as exc:
        raise RuntimeError(f'Gemini API request failed: {exc}') from exc

    try:
        parsed = json.loads(payload) if isinstance(payload, str) else payload
    except Exception as exc:
        raise RuntimeError(f'Gemini API returned invalid JSON: {exc}') from exc

    candidates = parsed.get('candidates') if isinstance(parsed, dict) else None
    if isinstance(candidates, list):
        for candidate in candidates:
            content = candidate.get('content') if isinstance(candidate, dict) else None
            if not isinstance(content, dict):
                continue
            parts = content.get('parts')
            if isinstance(parts, list):
                for part in parts:
                    text_part = part.get('text') if isinstance(part, dict) else None
                    if isinstance(text_part, str) and text_part.strip():
                        return text_part.strip()
    top_level_text = parsed.get('text') if isinstance(parsed, dict) else None
    if isinstance(top_level_text, str) and top_level_text.strip():
        return top_level_text.strip()
    return None


def optimize_gemini(
    text: str,
    api_key: Optional[str],
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    if not text or not text.strip():
        return None
    key = api_key or os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not key:
        raise RuntimeError('Missing Gemini API key')
    model_name = (model or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    prompt = (system_prompt or DEFAULT_OPTIMIZE_PROMPT).strip() or DEFAULT_OPTIMIZE_PROMPT
    body = {
        'systemInstruction': {
            'parts': [{'text': prompt}]
        },
        'contents': [
            {
                'role': 'user',
                'parts': [{'text': text.strip()}]
            }
        ],
        'generationConfig': {
            'temperature': 0.25,
            'topP': 0.9,
            'maxOutputTokens': 800,
        }
    }
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            'Content-Type': 'application/json; charset=utf-8'
        }
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = exc.read().decode('utf-8', 'ignore')
        except Exception:
            pass
        message = detail or exc.reason or ''
        raise RuntimeError(f'Gemini API error {exc.code}: {message}') from exc
    except Exception as exc:
        raise RuntimeError(f'Gemini API request failed: {exc}') from exc

    try:
        parsed = json.loads(payload) if isinstance(payload, str) else payload
    except Exception as exc:
        raise RuntimeError(f'Gemini API returned invalid JSON: {exc}') from exc

    candidates = parsed.get('candidates') if isinstance(parsed, dict) else None
    if isinstance(candidates, list):
        for candidate in candidates:
            content = candidate.get('content') if isinstance(candidate, dict) else None
            if not isinstance(content, dict):
                continue
            parts = content.get('parts')
            if isinstance(parts, list):
                for part in parts:
                    text_part = part.get('text') if isinstance(part, dict) else None
                    if isinstance(text_part, str) and text_part.strip():
                        try:
                            return text_part.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
                        except Exception:
                            return ''.join(ch for ch in text_part if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    top_level_text = parsed.get('text') if isinstance(parsed, dict) else None
    if isinstance(top_level_text, str) and top_level_text.strip():
        try:
            return top_level_text.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
        except Exception:
            return ''.join(ch for ch in top_level_text if 0xD800 > ord(ch) or ord(ch) > 0xDFFF).strip()
    return None




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

    # DashScope Qwen3-ASR 这里改为直接使用系统绝对路径，不再添加 file:// 前缀
    # 例如 Windows: C:\Users\...\录音录音.mp4
    #      Linux/macOS: /home/user/file.mp3
    # Use absolute system path for DashScope Qwen3-ASR (no file:// prefix)
    # Example Windows: C:\\Users\\...\\record.mp4
    # Example Linux/macOS: /home/user/file.mp3
    file_path = os.path.abspath(filepath)
    messages = [
        {"role": "system", "content": [{"text": ""}]},
        {"role": "user", "content": [{"audio": file_path}]},
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
