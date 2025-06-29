# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['openai_transcribe_gui.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('config.example.json', '.'),
    ],
    hiddenimports=[
        'sounddevice',
        'soundfile',
        'numpy',
        'keyboard',
        'openai',
        'tkinter',
        'tkinter.ttk',
        'tkinter.scrolledtext',
        'tkinter.messagebox',
        'tkinter.simpledialog',
        'threading',
        'json',
        'base64',
        'datetime',
        'os',
        'sys',
        'time',
        # 音频相关
        'numpy.core._methods',
        'numpy.lib.format',
        '_soundfile_data',
        'soundfile._soundfile_data',
        # OpenAI相关
        'openai.types',
        'openai.resources',
        'openai._client',
        # 其他可能需要的模块
        'cffi',
        'pycparser',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'scipy',
        'pandas',
        'PIL',
        'cv2',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='VoiceTranscript',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # 设置为False以隐藏控制台窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # 如果有图标文件，可以在这里指定
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='VoiceTranscript',
)
