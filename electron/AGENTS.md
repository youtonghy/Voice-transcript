# Repository Guidelines

This repository contains an Electron desktop app with a bundled Python transcription backend. Use this guide to navigate the codebase, build artifacts, and contribute changes safely.

## Project Structure & Module Organization
- Electron main: `main.js` (app lifecycle, windows), `preload.js` (IPC bridge)
- UI/renderer: `index.html`, `renderer.js`, `settings.html`, `settings.js`, `media-transcribe.html`, `media-transcribe-renderer.js`
- Python services: `transcribe_service.py`, `media_transcribe.py`, helper `openai_transcribe_translate.py`
- Assets/build: `assets/`, `build/`, `dist/` (installer artifacts), `dist-python/win/` (Nuitka EXEs)
- Runtime data: `recordings/` temporary audio, `config.json` local config
- Tests/utility: `test-media-transcribe.js`

## Build, Test, and Development Commands
- `npm install`: install Node dependencies
- `npm start`: run the Electron app
- `npm run dev`: run with devtools enabled
- `npm run build`: package Electron app (no installer)
- `npm run build:py:win`: build Python EXEs via Nuitka
- `npm run dist:win`: build Python EXEs, then create Windows installer
- Test media EXE: `node test-media-transcribe.js` (expects `dist-python/win/media_transcribe.exe`)

## Coding Style & Naming Conventions
- Please use English when coding. Use Chinese for reply.
- JavaScript/HTML: 2-space indent; semicolons; camelCase for variables/functions; PascalCase for classes; filenames: single-word `*.js` or kebab-case for multiword (e.g., `media-transcribe-renderer.js`).
- Python: 4-space indent; snake_case for modules/functions; UPPER_SNAKE_CASE for constants.
- Strings: prefer single quotes in JS; double quotes in JSON.
- No linter configured; keep formatting consistent with existing files.

## Testing Guidelines
- Smoke tests: run app via `npm start` and verify recording/transcribe flow; run `node test-media-transcribe.js` to validate EXE CLI.
- Place ad-hoc test assets under project root (e.g., `test.mkv`, ignored on release).
- Name test scripts `test-*.js` and prefer Node-based checks for child processes/IPC.

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits prefixes, e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Keep messages imperative and scoped.
- PRs: include a concise description, linked issues, and screenshots/GIFs for UI changes. Note platform tested (Windows/macOS/Linux) and build commands run.

## Security & Configuration Tips
- Do not commit secrets. `config.json` holds API keys and is generated per-user. Typical locations: project root in dev; packaged app user-data in production.
- Keep `ffmpeg.exe` in repo root for dev; it’s bundled for Windows builds.
