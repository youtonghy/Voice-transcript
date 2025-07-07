#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kivy App for Voice Transcription and Translation on Android
"""

import os
import threading
import json
import base64
from datetime import datetime
from time import sleep

# Kivy imports
from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.label import Label
from kivy.clock import mainthread
from kivy.utils import platform
from kivy.uix.scrollview import ScrollView
from kivy.core.window import Window


# Android-specific imports
if platform == 'android':
    from android.permissions import request_permissions, Permission
    from jnius import autoclass

# OpenAI import
from openai import AzureOpenAI

# --- Configuration ---
AZURE_OPENAI_API_VERSION = "2025-01-01-preview"
DEPLOYMENT_NAME = "gpt-4o-audio-preview"  # Model for transcription
WHISPER_DEPLOYMENT = "whisper"            # Fallback whisper model
TRANSLATE_DEPLOYMENT = "gpt-4o-mini"      # Model for translation
DEFAULT_TARGET_LANGUAGE = "中文"

# --- Android MediaRecorder setup ---
if platform == 'android':
    MediaRecorder = autoclass('android.media.MediaRecorder')
    AudioSource = autoclass('android.media.MediaRecorder$AudioSource')
    OutputFormat = autoclass('android.media.MediaRecorder$OutputFormat')
    AudioEncoder = autoclass('android.media.MediaRecorder$AudioEncoder')


class VoiceTranscribeApp(App):
    def build(self):
        self.title = "语音转写翻译"
        self.is_recording = False
        self.audio_recorder = None
        self.audio_filepath = None
        self.azure_client = None
        self.config = {}
        self.target_language = DEFAULT_TARGET_LANGUAGE

        # --- UI Layout ---
        Window.clearcolor = (0.1, 0.1, 0.1, 1) # Dark background
        
        layout = BoxLayout(orientation='vertical', padding=30, spacing=20)
        
        self.status_label = Label(
            text="请按住按钮开始录音", 
            size_hint_y=None, height=60,
            font_size='20sp',
            halign='center'
        )
        
        self.record_button = Button(
            text="按住录音", 
            size_hint=(1, 0.5), 
            font_size='25sp',
            background_color=(0.2, 0.6, 0.8, 1)
        )
        
        self.transcription_label = Label(
            text="...", 
            size_hint=(1, None),
            text_size=(Window.width - 60, None),
            halign='left',
            valign='top'
        )
        self.transcription_label.bind(texture_size=self.transcription_label.setter('size'))

        self.translation_label = Label(
            text="...",
            size_hint=(1, None),
            text_size=(Window.width - 60, None),
            halign='left',
            valign='top'
        )
        self.translation_label.bind(texture_size=self.translation_label.setter('size'))
        
        # Scrollable areas for results
        trans_scroll = ScrollView(size_hint=(1, 1))
        trans_scroll.add_widget(self.transcription_label)

        tran_scroll = ScrollView(size_hint=(1, 1))
        tran_scroll.add_widget(self.translation_label)

        layout.add_widget(self.status_label)
        layout.add_widget(self.record_button)
        layout.add_widget(Label(text="转写结果:", size_hint_y=None, height=40, font_size='18sp'))
        layout.add_widget(trans_scroll)
        layout.add_widget(Label(text="翻译结果:", size_hint_y=None, height=40, font_size='18sp'))
        layout.add_widget(tran_scroll)

        self.record_button.bind(on_press=self.start_recording, on_release=self.stop_recording)

        # On Android, request permissions when the app starts
        if platform == 'android':
            self.request_android_permissions()

        # Start initialization in a separate thread to not block UI
        threading.Thread(target=self.initialize_app, daemon=True).start()

        return layout
        
    def request_android_permissions(self):
        """Request necessary permissions on Android."""
        try:
            request_permissions([
                Permission.RECORD_AUDIO,
                Permission.WRITE_EXTERNAL_STORAGE,
                Permission.READ_EXTERNAL_STORAGE
            ])
        except Exception as e:
            self.update_status(f"权限申请失败: {e}")

    def get_storage_path(self):
        """Get the path for storing audio files."""
        if platform == 'android':
            # Use app-specific cache directory on Android
            path = self.user_data_dir
        else:
            # Fallback for desktop testing
            path = 'recordings_android'
        
        if not os.path.exists(path):
            os.makedirs(path)
        return path

    def initialize_app(self):
        """Load config and initialize Azure client in a background thread."""
        self.load_config()
        self.init_azure_openai()

    @mainthread
    def update_status(self, text):
        self.status_label.text = text

    @mainthread
    def update_transcription(self, text):
        self.transcription_label.text = text

    @mainthread
    def update_translation(self, text):
        self.translation_label.text = text

    def load_config(self):
        """Load config from a file in the user data directory."""
        config_file = os.path.join(self.user_data_dir, "config.json")
        self.update_status(f"加载配置中...")
        sleep(1)
        
        default_config = {
            "azure_openai_api_key": "YOUR_API_KEY",
            "azure_openai_endpoint": "YOUR_ENDPOINT",
            "translate_language": DEFAULT_TARGET_LANGUAGE
        }
        
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    self.config = json.load(f)
                self.target_language = self.config.get('translate_language', DEFAULT_TARGET_LANGUAGE)
            except Exception as e:
                self.update_status(f"读取配置失败: {e}")
                self.config = default_config
        else:
            self.update_status("未找到 config.json")
            self.config = default_config
            try:
                with open(config_file, 'w', encoding='utf-8') as f:
                    json.dump(self.config, f, indent=2, ensure_ascii=False)
                self.update_status("已创建默认配置，请修改")
            except Exception as e:
                self.update_status(f"创建配置失败: {e}")

    def init_azure_openai(self):
        """Initialize Azure OpenAI client."""
        api_key = self.config.get('azure_openai_api_key')
        endpoint = self.config.get('azure_openai_endpoint')

        if api_key and endpoint and "YOUR_API_KEY" not in api_key:
            try:
                self.azure_client = AzureOpenAI(
                    azure_endpoint=endpoint,
                    api_key=api_key,
                    api_version=AZURE_OPENAI_API_VERSION
                )
                self.update_status("Azure OpenAI 客户端初始化成功")
                sleep(2) # Show message for a bit
                self.update_status("请按住按钮开始录音")
            except Exception as e:
                self.update_status(f"Azure 初始化失败: {e}")
                self.azure_client = None
        else:
            self.update_status("Azure 配置不完整，请检查 config.json")
            self.azure_client = None

    def start_recording(self, instance):
        if self.is_recording or not self.azure_client:
            if not self.azure_client:
                self.update_status("客户端未初始化，无法录音")
            return

        self.update_status("🎤 正在录音...")
        self.is_recording = True
        self.record_button.background_color = (0.8, 0.2, 0.2, 1) # Red when recording
        self.update_transcription("...")
        self.update_translation("...")
        
        if platform == 'android':
            self.audio_recorder = MediaRecorder()
            self.audio_recorder.setAudioSource(AudioSource.MIC)
            self.audio_recorder.setOutputFormat(OutputFormat.MPEG_4)
            self.audio_recorder.setAudioEncoder(AudioEncoder.AAC)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self.audio_filepath = os.path.join(self.get_storage_path(), f"recording_{timestamp}.mp4")
            
            self.audio_recorder.setOutputFile(self.audio_filepath)
            
            try:
                self.audio_recorder.prepare()
                self.audio_recorder.start()
            except Exception as e:
                self.update_status(f"录音启动失败: {e}")
                self.is_recording = False
                self.record_button.background_color = (0.2, 0.6, 0.8, 1)
        else: # Desktop fallback for testing
            # This part is for simulation on a desktop. It won't actually record.
            # You need a pre-existing audio file named 'test_audio.mp4' in 'recordings_android'
            self.update_status("桌面测试模式 (不录音)")
            self.audio_filepath = os.path.join(self.get_storage_path(), "test_audio.mp4")

    def stop_recording(self, instance):
        if not self.is_recording:
            return
        
        self.is_recording = False
        self.record_button.background_color = (0.2, 0.6, 0.8, 1) # Back to blue
        self.update_status("⏹️ 录音结束，正在处理...")

        if platform == 'android':
            try:
                self.audio_recorder.stop()
                self.audio_recorder.release()
                self.audio_recorder = None
                # Start processing in a new thread
                threading.Thread(target=self.process_audio, daemon=True).start()
            except Exception as e:
                self.update_status(f"停止录音失败: {e}")
        else: # Desktop fallback for testing
             if os.path.exists(self.audio_filepath):
                 threading.Thread(target=self.process_audio, daemon=True).start()
             else:
                self.update_status(f"测试文件 {self.audio_filepath} 不存在")
                sleep(2)
                self.update_status("请按住按钮开始录音")


    def process_audio(self):
        """Transcribe and translate the audio file in a background thread."""
        if not self.audio_filepath or not os.path.exists(self.audio_filepath):
            self.update_status("错误: 未找到录音文件")
            return

        # 1. Transcribe
        self.update_status("🔄 正在转写音频...")
        transcription = self.transcribe_audio_file(self.audio_filepath)
        if transcription:
            self.update_transcription(transcription)
            
            # 2. Translate
            self.update_status("🌍 正在翻译文本...")
            translation = self.translate_text(transcription, self.target_language)
            if translation and translation.strip() != transcription.strip():
                self.update_translation(translation)
                self.update_status("✅ 处理完成")
            elif translation:
                 self.update_translation(f"({self.target_language}原文，无需翻译)")
                 self.update_status("✅ 处理完成")
            else:
                self.update_status("❌ 翻译失败")
        else:
            self.update_status("❌ 转写失败")
        
        # 3. Cleanup
        try:
            os.remove(self.audio_filepath)
        except Exception as e:
            print(f"Warning: Failed to delete audio file {self.audio_filepath}: {e}")
        
        sleep(2) # Show status for a bit
        if not self.is_recording:
            self.update_status("请按住按钮开始录音")

    def transcribe_audio_file(self, filepath):
        """Use Azure OpenAI to transcribe an audio file."""
        if not self.azure_client:
            return "Azure client not initialized."
        
        try:
            with open(filepath, "rb") as audio_file:
                audio_data = audio_file.read()
                encoded_audio = base64.b64encode(audio_data).decode('ascii')
            
            chat_prompt = [
                {"role": "system", "content": "You are a voice-to-text transcription engine. Transcribe the user's audio input accurately, without any modifications, translations, or additional comments. Preserve all speech disfluencies."},
                {"role": "user", "content": [
                    {"type": "text", "text": "Transcribe the following audio to text in its original language:"},
                    {"type": "input_audio", "input_audio": {"data": encoded_audio}}
                ]}
            ]
            
            completion = self.azure_client.chat.completions.create(
                model=DEPLOYMENT_NAME,
                messages=chat_prompt,
                max_tokens=1024,
                temperature=0.1
            )
            return completion.choices[0].message.content
            
        except Exception as e:
            # Fallback to Whisper API
            try:
                self.update_status("转写失败，尝试 Whisper API...")
                with open(filepath, "rb") as audio_file:
                    transcript = self.azure_client.audio.transcriptions.create(
                        model=WHISPER_DEPLOYMENT,
                        file=audio_file,
                        response_format="text",
                        language="zh" # Specify language for better accuracy if known
                    )
                return transcript
            except Exception as fallback_error:
                error_message = f"Transcription failed: {fallback_error}"
                self.update_status(f"错误: {error_message[:100]}")
                return None

    def translate_text(self, text, target_language):
        """Use Azure OpenAI to translate text."""
        if not self.azure_client or not text:
            return None
        
        try:
            system_prompt = f"You are a professional translation assistant. Translate the user's text into {target_language}. Requirements: 1. Maintain the original tone and style. 2. Ensure accuracy and natural phrasing. 3. If the text is already in {target_language}, return it unchanged. 4. Output only the translated text, without any explanations."
            
            response = self.azure_client.chat.completions.create(
                model=TRANSLATE_DEPLOYMENT,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                max_tokens=1024,
                temperature=0.1
            )
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            error_message = f"Translation failed: {e}"
            self.update_status(f"错误: {error_message[:100]}")
            return None


if __name__ == '__main__':
    VoiceTranscribeApp().run() 