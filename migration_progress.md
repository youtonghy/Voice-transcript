# Migration Progress Log

## Context (Tauri Rewrite)
- Electron + Python stack replaced by Rust-only backend (`src-tauri`) and React frontend (`src`).
- Python service removed; new Rust services created for transcription, translation, history, settings, and media processing.
- Audio capture currently guarded behind optional `native-audio` feature (disabled by default to keep `cargo check` working without system ALSA headers).
- New React UI implemented (control panel, transcript board, history, media panel, settings drawer) with Tauri command bindings and event listeners.

## Backend Status
- `AppState`, `TranscriptionService`, `RecognitionRouter`, `LanguageService`, SQLite conversation store, and custom audio segmentation implemented in Rust.
- Live recording support pending enablement of `native-audio` (requires building with `--features native-audio` and handling ALSA dependencies).
- Media file transcription pipeline in place, including progress events and summary generation.
- Configuration handling rewritten in Rust (`config.rs`).
- Command surface exposed in `lib.rs`; Tauri plugins configured (clipboard, dialog, shell, store, notification, log, opener, global shortcut).
- `cargo check` succeeds without extra features.
- Recording lifecycle now emits `transcription-event` status updates so the React client can react without polling, and conversation IDs are returned immediately for selection.

## Frontend Status
- `App.tsx` replaced with dashboard layout; integrates new components (`ControlPanel`, `TranscriptBoard`, `HistoryPanel`, `SettingsDrawer`, `MediaPanel`) and hooks.
- `api/commands.ts` encapsulates all Tauri invocations.
- `useTranscriptionEvents` hook subscribes to backend events (`transcription-event`, `media-event`).
- Design tokens and layout updated (`App.css`, component-level CSS).
- Old Electron-inspired React code removed.
- React app now initializes `i18next` with Simplified Chinese defaults, wraps UI strings in translations, and reacts to `app_language` changes from config.
- Recording actions optimistically select the freshly created conversation and rely on event-driven status updates to avoid redundant status fetches.

## Outstanding / Follow-up
- Enable and test real-time audio recording (`native-audio` feature) once ALSA dependencies are available; add feature documentation.
- Flesh out translation/summary prompt customization UI, validation, and persistence.
- Implement detailed error handling, toast notifications, and optimistic UI updates.
- Write integration tests or manual test checklist for transcription + media workflows.
- Audit warnings (unused struct fields/methods) and prune or wire remaining functionality.
- Eventually reintroduce icons/resources in Tauri bundle (currently removed).
- Expand translation resources beyond Simplified Chinese, add language switcher UI, and localize remaining dynamic strings/notifications.
- Run `pnpm install` (or `pnpm update`) to sync new `i18next`/`react-i18next` dependencies into the lockfile in this environment.

## Verification
- `cargo check` (without `native-audio`) passes (rerun after status/i18n updates).
- React build/dev not yet run in this session; recommended: `pnpm install` (if not already), `pnpm build`, and `pnpm tauri dev` after enabling audio feature as needed.
