[app]
# (str) Title of your application
title = Voice Transcribe Translate

# (str) Package name
package.name = voicetranscribe

# (str) Package domain (needed for android/ios packaging)
package.domain = org.test

# (str) Source code where the main.py live
source.dir = .

# (str) Name of the main py file to run
main.py = main_android.py

# (list) Source files to include (let buildozer find them)
source.include_exts = py,png,jpg,kv,atlas,json

# (list) List of modules to blacklist
# source.blacklist_exts = spec

# (str) Version of your application
version = 0.2

# (list) Application requirements
# comma separated e.g. requirements = sqlite3,kivy
requirements = python3,kivy,openai,pyjnius,certifi

# (str) Presplash background color (for new android presplash)
android.presplash_color = #1a1a1a

# (str) Icon of the application
# android.icon_fn = %(source.dir)s/data/icon.png

# (str) Supported architectures
android.archs = arm64-v8a

# (list) Permissions
android.permissions = RECORD_AUDIO, INTERNET

# (int) Android API level - 31 is required for new apps on Google Play
android.api = 31
android.minapi = 21

# (str) The NDK version to use
android.ndk = 25b

# (bool) Indicate if the application should be fullscreen
fullscreen = 0

# (list) Android logcat filters to use
# android.logcat_filters = *:S python:D


[buildozer]
# (int) Log level (0 = error, 1 = info, 2 = debug (with command output))
log_level = 2

# (int) Display warning if buildozer is run as root (0 = False, 1 = True)
warn_on_root = 1 