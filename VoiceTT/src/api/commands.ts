import { invoke } from "@tauri-apps/api/core";
import {
  AppConfig,
  Conversation,
  ConversationEntry,
  ServiceStatus,
} from "../types";

export async function fetchConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await invoke("save_config", { config });
}

export async function fetchStatus(): Promise<ServiceStatus> {
  return invoke("get_service_status");
}

export async function startRecording(options?: {
  translate?: boolean;
  translateLanguage?: string;
  recognitionEngine?: string;
  transcribeLanguage?: string;
}): Promise<string> {
  return invoke("start_recording", { options });
}

export async function stopRecording(): Promise<string | null> {
  return invoke("stop_recording");
}

export async function startVoiceInput(options?: {
  translate?: boolean;
  translateLanguage?: string;
  recognitionEngine?: string;
  transcribeLanguage?: string;
}): Promise<string> {
  return invoke("start_voice_input", { options });
}

export async function stopVoiceInput(): Promise<string | null> {
  return invoke("stop_voice_input");
}

export async function fetchConversations(): Promise<Conversation[]> {
  return invoke("get_conversations");
}

export async function fetchConversationEntries(
  conversationId: string,
  limit?: number,
): Promise<ConversationEntry[]> {
  return invoke("get_conversation_entries", { conversationId, limit });
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  await invoke("rename_conversation", { conversationId, title });
}

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  await invoke("pin_conversation", { conversationId, pinned });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await invoke("delete_conversation", { conversationId });
}

export async function requestTranslation(
  conversationId: string,
  text: string,
  targetLanguage: string,
): Promise<string> {
  return invoke("request_translation", {
    options: { conversationId, text, targetLanguage },
  });
}

export async function optimizeText(text: string): Promise<string> {
  return invoke("optimize_text", { text });
}

export async function summarizeText(
  text: string,
  targetLanguage: string,
): Promise<string> {
  return invoke("summarize_text", { text, targetLanguage });
}

export async function processMediaFile(options: {
  path: string;
  translate?: boolean;
  targetLanguage?: string;
}): Promise<string> {
  return invoke("process_media_file", { options });
}
