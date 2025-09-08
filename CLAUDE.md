# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Voice-Translate-Transcribe (王译转) is a hybrid Electron + Python desktop application for real-time voice transcription and translation using OpenAI models. The application consists of an Electron frontend for UI and a Python backend for audio processing and AI services.

## Development Commands

### Running the Application
```bash
cd electron
npm install          # Install dependencies (first time)
npm start           # Run the Electron app
```

### Building Python Services
The Python services must be compiled to executables for distribution:
```bash
cd electron
npm run build:py:win    # Build both Python services (transcribe + media)
```

Individual builds:
- `npm run build:py:transcribe` - Build real-time transcription service
- `npm run build:py:media` - Build media file processor

### Creating Distribution
```bash
cd electron
npm run dist:win    # Build Python services + create Windows installer
```

## Architecture

### Process Architecture
1. **Main Process** (`main.js`): Manages windows, IPC, and Python subprocesses
2. **Renderer Processes**: UI windows (main, settings, media transcribe)
3. **Python Services**: 
   - `transcribe_service.py`: Persistent background service for real-time recording
   - `media_transcribe.py`: On-demand processor for media files

### Communication Flow
```
Renderer (UI) <--IPC--> Main Process <--JSON/stdout--> Python Services
```

Python services communicate via:
- Standard output for results (JSON format)
- Standard error for logs and errors
- JSON messages with types: `result`, `progress`, `error`, `complete`

### Key Files Structure
```
electron/
├── main.js                    # Electron main process
├── preload.js                 # IPC bridge
├── renderer.js                # Main window logic
├── transcribe_service.py      # Real-time transcription
├── media_transcribe.py        # Media file processing
├── config.json               # User configuration
└── dist-python/win/          # Compiled Python executables
```

## Important Implementation Details

### Python Service Integration
- Python services run as separate processes spawned by Electron
- Communication is JSON-based through stdout/stderr
- Services must be compiled with Nuitka for production
- FFmpeg binary must be bundled for media processing

### Real-time Transcription Flow
1. User triggers recording via hotkey or button
2. Python service captures audio using `sounddevice`
3. Silence detection segments audio automatically
4. Segments sent to OpenAI API for transcription
5. Optional translation based on user settings
6. Results sent back as JSON messages

### Media Processing Flow
1. User selects media file (audio/video)
2. FFmpeg extracts audio if needed
3. Audio segmented based on silence detection
4. Multi-threaded transcription and translation
5. Results displayed in real-time
6. Manual export to TXT via file dialog

### Configuration Management
- Development: `config.json` in project root
- Production: User data directory (`app.getPath('userData')`)
- Hot-reload of configuration in Python services
- Settings include: API keys, language preferences, audio parameters

### Translation Modes
- **Normal Mode**: Always translate to target language
- **Smart Mode**: Only translate if source language differs from target
- Language detection via OpenAI model analysis

## Common Tasks

### Adding New IPC Handlers
1. Add handler in `main.js` using `ipcMain.handle()`
2. Expose in `preload.js` via `contextBridge`
3. Call from renderer using `window.electronAPI.methodName()`

### Modifying Python Services
1. Edit Python source file
2. Test locally with Python interpreter
3. Rebuild executable: `npm run build:py:win`
4. Compiled output goes to `dist-python/win/`

### Updating UI
- Main window: Edit `index.html` and `renderer.js`
- Settings: Edit `settings.html` and `settings.js`
- Media transcribe: Edit `media-transcribe.html` and `media-transcribe-renderer.js`

## Testing and Debugging

### Python Service Testing
```bash
# Test transcribe service directly
python electron/transcribe_service.py

# Test media processor with GUI
python electron/media_transcribe.py --gui

# Test with specific file
python electron/media_transcribe.py --file input.mp4 --translate --language 中文
```

### Electron Debugging
- DevTools automatically open in development mode
- Check main process logs in terminal
- Monitor Python service output in renderer logs area

## Build Requirements

### Python Compilation
- Python 3.8+ with pip
- Nuitka: `pip install nuitka`
- C++ compiler (MSVC on Windows)
- Dependencies: openai, sounddevice, soundfile, numpy, scipy (optional)
- Please use the python on /.venv/Scripts/  when running Python scripts directly.
- When developing, use pyinstaller to compile to save time.

### Electron Packaging
- Node.js 16+ and npm
- Windows: NSIS for installer creation
- All Python services must be built before packaging

## API Keys and Configuration

OpenAI API configuration required:
- Set via Settings UI or directly in `config.json`
- Supports custom base URLs for API proxies
- API key stored locally (never committed)

## Known Constraints

1. Python services must be compiled for distribution (not bundled as source)
2. FFmpeg required for video file processing
3. Real-time transcription requires persistent Python background service
4. Smart translation requires additional API call for language detection
5. Audio device changes require service restart