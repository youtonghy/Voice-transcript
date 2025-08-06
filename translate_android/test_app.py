#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试脚本 - 验证语音转写翻译应用功能
"""

import os
import json
import sys
import subprocess

def test_dependencies():
    """测试依赖是否安装正确"""
    print("🔍 测试依赖安装...")
    
    required_packages = [
        'kivy',
        'numpy',
        'openai',
        'sounddevice',
        'soundfile'
    ]
    
    failed_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
            print(f"✅ {package} 已安装")
        except ImportError as e:
            print(f"❌ {package} 未安装: {e}")
            failed_packages.append(package)
    
    return len(failed_packages) == 0

def test_config():
    """测试配置文件"""
    print("\n⚙️ 测试配置文件...")
    
    config_file = "config.json"
    
    if not os.path.exists(config_file):
        print("📝 创建测试配置文件...")
        default_config = {
            "azure_openai_api_key": "test-key",
            "azure_openai_endpoint": "https://test.openai.azure.com/",
            "translate_language": "中文"
        }
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, ensure_ascii=False, indent=2)
        
        print("✅ 配置文件已创建")
    else:
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            print("✅ 配置文件格式正确")
            
            # 检查必要字段
            required_fields = ['azure_openai_api_key', 'azure_openai_endpoint', 'translate_language']
            for field in required_fields:
                if field not in config:
                    print(f"⚠️  缺少字段: {field}")
                else:
                    print(f"✅ 找到字段: {field}")
                    
        except json.JSONDecodeError as e:
            print(f"❌ 配置文件格式错误: {e}")
            return False
    
    return True

def test_audio():
    """测试音频功能"""
    print("\n🎤 测试音频功能...")
    
    try:
        import sounddevice as sd
        
        # 获取设备信息
        devices = sd.query_devices()
        input_devices = [d for d in devices if d['max_input_channels'] > 0]
        
        if input_devices:
            print(f"✅ 找到 {len(input_devices)} 个输入设备")
            for i, device in enumerate(input_devices[:3]):  # 显示前3个
                print(f"   {i+1}. {device['name']} ({device['max_input_channels']} 通道)")
        else:
            print("❌ 没有找到音频输入设备")
            return False
            
    except Exception as e:
        print(f"❌ 音频测试失败: {e}")
        return False
    
    return True

def test_buildozer():
    """测试 Buildozer 配置"""
    print("\n🔨 测试 Buildozer 配置...")
    
    spec_file = "buildozer.spec"
    
    if not os.path.exists(spec_file):
        print("❌ buildozer.spec 文件不存在")
        return False
    
    try:
        with open(spec_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 检查关键配置
        checks = [
            ('title = 语音转写翻译', '应用标题'),
            ('android.permissions = RECORD_AUDIO', '录音权限'),
            ('requirements = python3,kivy,numpy,openai,sounddevice,soundfile', '依赖包'),
            ('orientation = portrait', '屏幕方向')
        ]
        
        for check_str, description in checks:
            if check_str in content:
                print(f"✅ {description} 配置正确")
            else:
                print(f"❌ {description} 配置缺失")
        
    except Exception as e:
        print(f"❌ 读取配置文件失败: {e}")
        return False
    
    return True

def test_main_app():
    """测试主应用文件"""
    print("\n📱 测试主应用文件...")
    
    main_file = "main.py"
    
    if not os.path.exists(main_file):
        print("❌ main.py 文件不存在")
        return False
    
    try:
        # 简单语法检查
        with open(main_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 检查关键类和方法
        checks = [
            ('class VoiceTranscriberApp', '主应用类'),
            ('def build', '构建方法'),
            ('def start_recording', '录音开始方法'),
            ('def stop_recording', '录音停止方法'),
            ('def show_settings', '设置方法'),
            ('import numpy', 'NumPy 导入'),
            ('import openai', 'OpenAI 导入')
        ]
        
        for check_str, description in checks:
            if check_str in content:
                print(f"✅ {description} 存在")
            else:
                print(f"❌ {description} 缺失")
        
        # 尝试语法检查
        result = subprocess.run([sys.executable, '-m', 'py_compile', main_file], 
                              capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ Python 语法检查通过")
        else:
            print(f"❌ Python 语法错误: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ 测试主应用文件失败: {e}")
        return False
    
    return True

def main():
    """主测试函数"""
    print("🧪 语音转写翻译应用测试开始...")
    print("=" * 50)
    
    tests = [
        ("依赖包测试", test_dependencies),
        ("配置文件测试", test_config),
        ("音频功能测试", test_audio),
        ("Buildozer 配置测试", test_buildozer),
        ("主应用测试", test_main_app)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"\n{test_name}")
        print("-" * 30)
        try:
            result = test_func()
            results.append(result)
        except Exception as e:
            print(f"❌ {test_name} 运行失败: {e}")
            results.append(False)
    
    print("\n" + "=" * 50)
    print("📊 测试结果汇总:")
    
    passed = sum(results)
    total = len(results)
    
    for i, (test_name, _) in enumerate(tests):
        status = "✅ 通过" if results[i] else "❌ 失败"
        print(f"{i+1}. {test_name}: {status}")
    
    print(f"\n总览: {passed}/{total} 测试通过")
    
    if passed == total:
        print("🎉 所有测试通过，应用可以构建！")
        return True
    else:
        print("⚠️  部分测试失败，请检查问题后再构建")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)