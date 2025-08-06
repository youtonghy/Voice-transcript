#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音转写翻译安卓应用
可直接运行的简化版本，用于测试和构建
"""

import os
import json
import threading
import time
from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.textinput import TextInput
from kivy.uix.label import Label
from kivy.uix.popup import Popup
from kivy.properties import StringProperty, BooleanProperty
from kivy.clock import Clock

try:
    import android.permissions
    from android.permissions import Permission, request_permissions
    ANDROID = True
except ImportError:
    ANDROID = False

# 简化版本 - 模拟录音功能
class VoiceTranscriberApp(App):
    is_recording = BooleanProperty(False)
    transcription_text = StringProperty("")
    translation_text = StringProperty("")
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.config_data = {}
    
    def build(self):
        self.title = '语音转写翻译'
        self.load_config()
        
        # 主布局
        main_layout = BoxLayout(orientation='vertical', padding=10, spacing=10)
        
        # 顶部工具栏
        toolbar = BoxLayout(size_hint_y=None, height=50)
        title_label = Label(text='语音转写翻译', font_size='20sp', bold=True, size_hint_x=0.8)
        settings_btn = Button(text='⚙️', font_size='24sp', size_hint_x=0.2)
        settings_btn.bind(on_press=self.show_settings)
        toolbar.add_widget(title_label)
        toolbar.add_widget(settings_btn)
        
        # 录音按钮
        self.record_button = Button(
            text='按住开始录音',
            font_size='18sp',
            size_hint_y=None,
            height=100,
            background_color=(0.8, 0.2, 0.2, 1)
        )
        self.record_button.bind(on_touch_down=self.start_recording)
        self.record_button.bind(on_touch_up=self.stop_recording)
        
        # 结果显示
        trans_label = Label(text='转写结果:', font_size='16sp', size_hint_y=None, height=30)
        self.transcription_input = TextInput(
            text='',
            hint_text='转写结果将显示在这里...',
            readonly=True,
            size_hint_y=0.3
        )
        
        translate_label = Label(text='翻译结果:', font_size='16sp', size_hint_y=None, height=30)
        self.translation_input = TextInput(
            text='',
            hint_text='翻译结果将显示在这里...',
            readonly=True,
            size_hint_y=0.3
        )
        
        self.status_label = Label(text='准备就绪', font_size='14sp', size_hint_y=None, height=30)
        
        main_layout.add_widget(toolbar)
        main_layout.add_widget(self.record_button)
        main_layout.add_widget(trans_label)
        main_layout.add_widget(self.transcription_input)
        main_layout.add_widget(translate_label)
        main_layout.add_widget(self.translation_input)
        main_layout.add_widget(self.status_label)
        
        if ANDROID:
            self.request_android_permissions()
        
        return main_layout
    
    def request_android_permissions(self):
        """请求 Android 权限"""
        if ANDROID:
            permissions = [Permission.RECORD_AUDIO, Permission.WRITE_EXTERNAL_STORAGE, Permission.READ_EXTERNAL_STORAGE]
            request_permissions(permissions)
    
    def load_config(self):
        """加载配置"""
        try:
            if os.path.exists('config.json'):
                with open('config.json', 'r', encoding='utf-8') as f:
                    self.config_data = json.load(f)
        except:
            self.config_data = {}
    
    def save_config(self):
        """保存配置"""
        try:
            with open('config.json', 'w', encoding='utf-8') as f:
                json.dump(self.config_data, f, ensure_ascii=False, indent=2)
        except:
            pass
    
    def show_settings(self, instance):
        """显示设置"""
        content = BoxLayout(orientation='vertical', padding=10, spacing=10)
        
        # API Key
        api_key_input = TextInput(
            text=self.config_data.get('api_key', ''),
            hint_text='Azure OpenAI API Key',
            multiline=False
        )
        
        # Endpoint
        endpoint_input = TextInput(
            text=self.config_data.get('endpoint', ''),
            hint_text='https://xxx.openai.azure.com/',
            multiline=False
        )
        
        # Language
        language_input = TextInput(
            text=self.config_data.get('language', '中文'),
            hint_text='翻译目标语言',
            multiline=False
        )
        
        # 按钮
        button_layout = BoxLayout(size_hint_y=None, height=50)
        save_btn = Button(text='保存')
        cancel_btn = Button(text='取消')
        
        def save_settings(instance):
            self.config_data['api_key'] = api_key_input.text
            self.config_data['endpoint'] = endpoint_input.text
            self.config_data['language'] = language_input.text
            self.save_config()
            popup.dismiss()
            self.status_label.text = '设置已保存'
        
        save_btn.bind(on_press=save_settings)
        cancel_btn.bind(on_press=lambda x: popup.dismiss())
        
        button_layout.add_widget(save_btn)
        button_layout.add_widget(cancel_btn)
        
        content.add_widget(Label(text='API Key:'))
        content.add_widget(api_key_input)
        content.add_widget(Label(text='Endpoint:'))
        content.add_widget(endpoint_input)
        content.add_widget(Label(text='翻译语言:'))
        content.add_widget(language_input)
        content.add_widget(button_layout)
        
        popup = Popup(title='设置', content=content, size_hint=(0.9, 0.7))
        popup.open()
    
    def start_recording(self, instance, touch):
        """开始录音"""
        if not self.record_button.collide_point(*touch.pos):
            return
        
        if self.is_recording:
            return
        
        self.is_recording = True
        self.record_button.text = '录音中...松开停止'
        self.record_button.background_color = (0.2, 0.8, 0.2, 1)
        self.status_label.text = '正在录音...'
        
        # 模拟录音
        Clock.schedule_once(self.simulate_recording, 2)
    
    def stop_recording(self, instance, touch):
        """停止录音"""
        if not self.is_recording:
            return
        
        self.is_recording = False
        self.record_button.text = '按住开始录音'
        self.record_button.background_color = (0.8, 0.2, 0.2, 1)
    
    def simulate_recording(self, dt):
        """模拟录音处理"""
        if self.is_recording:
            self.status_label.text = '正在处理...'
            
            # 模拟延迟
            Clock.schedule_once(self.show_results, 1)
    
    def show_results(self, dt):
        """显示模拟结果"""
        self.transcription_input.text = "这是一个语音转写的测试内容。"
        self.translation_text = "This is a test content for voice transcription."
        self.translation_input.text = self.translation_text
        self.status_label.text = '处理完成'

if __name__ == '__main__':
    VoiceTranscriberApp().run()