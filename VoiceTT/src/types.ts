export interface AppConfig {
  openai_api_key: string;
  openai_base_url: string;
  openai_transcribe_model: string;
  openai_translate_model: string;
  gemini_api_key: string;
  gemini_translate_model: string;
  gemini_translate_system_prompt: string;
  conversation_title_system_prompt: string;
  summary_engine: string;
  openai_summary_model: string;
  gemini_summary_model: string;
  summary_system_prompt: string;
  optimize_engine: string;
  openai_optimize_model: string;
  gemini_optimize_model: string;
  optimize_system_prompt: string;
  recognition_engine: string;
  translation_engine: string;
  transcribe_source: string;
  soniox_api_key: string;
  dashscope_api_key: string;
  qwen3_asr_model: string;
  enable_translation: boolean;
  translate_language: string;
  translation_mode: string;
  smart_language1: string;
  smart_language2: string;
  transcribe_language: string;
  silence_rms_threshold: number;
  min_silence_seconds: number;
  theater_mode: boolean;
  app_language: string;
  voice_input_enabled: boolean;
  voice_input_hotkey: string;
  voice_input_engine: string;
  voice_input_language: string;
  voice_input_translate: boolean;
  voice_input_translate_language: string;
}

export interface ServiceStatus {
  running: boolean;
  ready: boolean;
  isRecording: boolean;
  mode?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  orderRank: number;
}

export type EntryKind =
  | "transcription"
  | "translation"
  | "summary"
  | "optimization";

export interface ConversationEntry {
  id: string;
  conversationId: string;
  kind: EntryKind;
  text: string;
  translatedText?: string | null;
  language?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export type TranscriptionEvent =
  | {
      type: "segment";
      conversationId: string;
      segmentId: string;
      entryId: string;
      text: string;
      language?: string;
      confidence?: number | null;
      durationMs: number;
      mode: string;
    }
  | {
      type: "translation";
      conversationId: string;
      segmentId: string;
      entryId: string;
      translation: string;
      targetLanguage: string;
      mode: string;
    }
  | {
      type: "voice_input";
      conversationId: string;
      segmentId: string;
      transcription: string;
      translation?: string;
      language?: string;
    }
  | {
      type: "summary";
      conversationId: string;
      summary: string;
    }
  | {
      type: "media_progress";
      conversationId: string;
      current: number;
      total: number;
    }
  | {
      type: "media_complete";
      conversationId: string;
    }
  | {
      type: "status";
      status: ServiceStatus;
    };
