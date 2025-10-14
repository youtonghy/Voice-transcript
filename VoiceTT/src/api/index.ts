import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type PythonLogMessage = {
  type: "log";
  level: "info" | "warning" | "error" | string;
  message: string;
  timestamp?: string;
};

export type PythonResultMessage = {
  type: "result";
  result_id?: string;
  transcription?: string;
  translation?: string;
  transcription_pending?: boolean;
  translation_pending?: boolean;
  optimized?: string;
  context?: string;
  [key: string]: unknown;
};

export type PythonUpdateMessage = {
  type:
    | "transcription_update"
    | "translation_update"
    | "optimization_result"
    | "conversation_summary"
    | "summary_result"
    | "recording_error"
    | "recording_stopped"
    | "voice_meter";
  [key: string]: unknown;
};

export type PythonMessage =
  | PythonLogMessage
  | PythonResultMessage
  | PythonUpdateMessage
  | Record<string, unknown>;

export type ServiceStatus = {
  running: boolean;
  ready: boolean;
};

export async function getConfig<T = Record<string, unknown>>() {
  return invoke<T>("get_config");
}

export async function saveConfig<T = Record<string, unknown>>(config: T) {
  return invoke<void>("save_config", { config });
}

export async function getServiceStatus() {
  return invoke<ServiceStatus>("get_service_status");
}

export async function restartPythonService() {
  return invoke<void>("restart_python_service");
}

export async function startRecording() {
  return invoke<void>("start_recording");
}

export async function stopRecording() {
  return invoke<void>("stop_recording");
}

export async function startVoiceInput() {
  return invoke<void>("start_voice_input");
}

export async function stopVoiceInput() {
  return invoke<void>("stop_voice_input");
}

type TranslationPayload = {
  transcription?: string;
  text?: string;
  resultId?: string;
  result_id?: string;
  conversationId?: string;
  conversation_id?: string;
  entryId?: string;
  entry_id?: string;
  targetLanguage?: string;
  target_language?: string;
  context?: string;
};

export async function requestTranslation(payload: TranslationPayload) {
  return invoke<Record<string, unknown>>("request_translation", { payload });
}

type OptimizePayload = {
  text?: string;
  conversationId?: string;
  conversation_id?: string;
  entryId?: string;
  entry_id?: string;
  requestId?: string;
  request_id?: string;
  targetLanguage?: string;
  target_language?: string;
  systemPrompt?: string;
  system_prompt?: string;
  context?: string;
  maxTokens?: number;
  max_tokens?: number;
};

export async function optimizeText(payload: OptimizePayload) {
  return invoke<Record<string, unknown>>("optimize_text", { payload });
}

type ExportResultEntry = {
  transcription?: string;
  translation?: string;
};

export async function exportResults(
  results: ExportResultEntry[],
  suggestedPath?: string,
) {
  return invoke<Record<string, unknown>>("export_results", {
    payload: { results, suggestedPath },
  });
}

type ExportLogEntry = {
  transcription?: string;
  translation?: string;
  includeTranslation?: boolean;
  timeText?: string;
};

export async function exportLogs(entries: ExportLogEntry[]) {
  return invoke<Record<string, unknown>>("export_logs", { payload: { entries } });
}

export async function statPath(path: string) {
  return invoke<{ size: number } | null>("stat_path", { path });
}

type SummaryPayload = {
  conversationId?: string;
  conversation_id?: string;
  segments: unknown[];
  systemPrompt?: string;
  system_prompt?: string;
};

export async function generateSummary(payload: SummaryPayload) {
  return invoke<Record<string, unknown>>("generate_summary", { payload });
}

type TitlePayload = {
  conversationId?: string;
  conversation_id?: string;
  segments: unknown[];
  targetLanguage?: string;
  target_language?: string;
  emptyTitle?: string;
  empty_title?: string;
  fallbackTitle?: string;
  fallback_title?: string;
  systemPrompt?: string;
  system_prompt?: string;
  updatedAt?: string;
  updated_at?: string;
};

export async function summarizeConversationTitle(payload: TitlePayload) {
  return invoke<Record<string, unknown>>("summarize_conversation_title", {
    payload,
  });
}

export async function writeClipboard(text: string) {
  return invoke<Record<string, unknown>>("write_clipboard", { text });
}

export async function getDevices() {
  return invoke<unknown[]>("get_devices");
}

export async function setDevice(deviceId?: string) {
  return invoke<Record<string, unknown>>("set_device", { deviceId });
}

export async function testPython(pythonPath: string) {
  return invoke<Record<string, unknown>>("test_python", {
    payload: { python_path: pythonPath },
  });
}

export async function restartService() {
  return invoke<void>("restart_service");
}

export async function windowControl(action: "minimize" | "toggle-maximize" | "close") {
  return invoke<void>("window_control", { payload: { action } });
}

function navigateToHash(target?: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  const sanitized = target ? String(target).replace(/^#/, "") : "";
  if (!sanitized) {
    if (window.location.hash) {
      window.location.hash = "";
    } else {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    return;
  }
  const next = `#${sanitized}`;
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = sanitized;
  }
}

export function navigateToMain() {
  navigateToHash("");
}

export function openSettings(section?: string) {
  const suffix = section ? `settings/${section}` : "settings";
  navigateToHash(suffix);
}

export function openMediaTranscribe() {
  navigateToHash("media");
}

export function openVoiceInputSettings() {
  navigateToHash("voice");
}

export async function onPythonMessage(handler: (message: PythonMessage) => void) {
  const unlisten = await listen<PythonMessage>("python-message", (event) => {
    handler(event.payload);
  });
  return unlisten;
}

export async function onWindowStateChange(
  handler: (payload: Record<string, unknown>) => void,
) {
  const unlisten = await listen("window-state-changed", (event) => {
    handler(event.payload as Record<string, unknown>);
  });
  return unlisten;
}

type MediaSettingsPayload = {
  enableTranslation?: boolean;
  targetLanguage?: string;
  theaterMode?: boolean;
  outputPath?: string;
};

export async function processMediaFile(filePath: string, settings: MediaSettingsPayload) {
  return invoke<Record<string, unknown>>("process_media_file", {
    payload: { filePath, settings },
  });
}

export async function onMediaProgress(
  handler: (payload: Record<string, unknown>) => void,
) {
  const unlisten = await listen<Record<string, unknown>>("media-progress", (event) => {
    handler(event.payload);
  });
  return unlisten;
}
