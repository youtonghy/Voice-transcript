import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchConfig,
  fetchStatus,
  startRecording,
  stopRecording,
  startVoiceInput,
  stopVoiceInput,
  fetchConversations,
  fetchConversationEntries,
  setConversationPinned,
  deleteConversation,
  requestTranslation,
  optimizeText,
  summarizeText,
  processMediaFile,
  saveConfig,
} from "./api/commands";
import { useTranscriptionEvents } from "./hooks/useTranscriptionEvents";
import {
  AppConfig,
  Conversation,
  ConversationEntry,
  ServiceStatus,
  TranscriptionEvent,
} from "./types";
import { ControlPanel } from "./components/ControlPanel";
import { TranscriptBoard } from "./components/TranscriptBoard";
import { HistoryPanel } from "./components/HistoryPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { MediaPanel } from "./components/MediaPanel";
import "./App.css";

type Nullable<T> = T | null;

function App() {
  const [status, setStatus] = useState<Nullable<ServiceStatus>>(null);
  const [config, setConfig] = useState<Nullable<AppConfig>>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [lastVoiceInput, setLastVoiceInput] = useState<TranscriptionEvent | null>(null);
  const { t, i18n } = useTranslation();

  const defaultConversationTitle = t("transcript.title");
  const activeConversationTitle = useMemo(() => {
    return (
      conversations.find((conversation) => conversation.id === activeConversationId)?.title ??
      defaultConversationTitle
    );
  }, [conversations, activeConversationId, defaultConversationTitle]);

  const isRecording = status?.isRecording ?? false;

  useEffect(() => {
    const nextLanguage = config?.app_language?.trim() || "zh-CN";
    if (i18n.language !== nextLanguage) {
      void i18n.changeLanguage(nextLanguage);
    }
  }, [config?.app_language, i18n]);

  const refreshConversations = useCallback(async (preferredActiveId?: string) => {
    const list = await fetchConversations();
    setConversations(list);
    if (preferredActiveId) {
      setActiveConversationId(preferredActiveId);
      return;
    }
    setActiveConversationId((previous) => {
      if (previous) {
        const stillPresent = list.some((conversation) => conversation.id === previous);
        if (stillPresent) {
          return previous;
        }
      }
      return list.length > 0 ? list[0].id : undefined;
    });
  }, []);

  const refreshEntries = useCallback(
    async (conversationId: string) => {
      const list = await fetchConversationEntries(conversationId);
      setEntries(list);
    },
    [],
  );

  useEffect(() => {
    (async () => {
      const [initialConfig, initialStatus, initialConversations] = await Promise.all([
        fetchConfig(),
        fetchStatus(),
        fetchConversations(),
      ]);
      setConfig(initialConfig);
      setStatus(initialStatus);
      setConversations(initialConversations);
      if (initialConversations.length > 0) {
        setActiveConversationId(initialConversations[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      void refreshEntries(activeConversationId);
    } else {
      setEntries([]);
    }
  }, [activeConversationId, refreshEntries]);

  const handleTranscriptionEvent = useCallback(
    (event: TranscriptionEvent) => {
      switch (event.type) {
        case "segment":
        case "translation":
        case "summary":
          void refreshConversations();
          if (activeConversationId === event.conversationId) {
            void refreshEntries(event.conversationId);
          }
          break;
        case "voice_input":
          setLastVoiceInput(event);
          break;
        case "media_progress":
          setMediaProgress({ current: event.current, total: event.total });
          break;
        case "media_complete":
          setMediaProgress(null);
          void refreshConversations();
          break;
        case "status":
          setStatus(event.status);
          break;
        default:
          break;
      }
    },
    [activeConversationId, refreshConversations, refreshEntries],
  );

  useTranscriptionEvents(handleTranscriptionEvent);

  const handleStartRecording = useCallback(async () => {
    if (!config || isRecording) {
      return;
    }
    try {
      setBusy(true);
      const conversationId = await startRecording({
        translate: config.enable_translation,
        translateLanguage: config.translate_language,
      });
      await refreshConversations(conversationId);
      await refreshEntries(conversationId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, [config, isRecording, refreshConversations, refreshEntries]);

  const handleStopRecording = useCallback(async () => {
    try {
      setBusy(true);
      await stopRecording();
      if (activeConversationId) {
        await refreshEntries(activeConversationId);
      }
      await refreshConversations();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, [activeConversationId, refreshConversations, refreshEntries]);

  const handleStartVoiceInput = useCallback(async () => {
    if (!config || isRecording) {
      return;
    }
    try {
      setBusy(true);
      const conversationId = await startVoiceInput({
        translate: config.voice_input_translate,
        translateLanguage: config.voice_input_translate_language,
        recognitionEngine: config.voice_input_engine,
        transcribeLanguage: config.voice_input_language,
      });
      await refreshConversations(conversationId);
      await refreshEntries(conversationId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, [config, isRecording, refreshConversations, refreshEntries]);

  const handleStopVoiceInput = useCallback(async () => {
    try {
      setBusy(true);
      await stopVoiceInput();
      if (activeConversationId) {
        await refreshEntries(activeConversationId);
      }
      await refreshConversations();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, [activeConversationId, refreshConversations, refreshEntries]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  const handlePinConversation = useCallback(
    async (conversationId: string, pinned: boolean) => {
      await setConversationPinned(conversationId, pinned);
      await refreshConversations();
    },
    [refreshConversations],
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      await deleteConversation(conversationId);
      await refreshConversations();
    },
    [refreshConversations],
  );

  const handleTranslateEntry = useCallback(
    async (entry: ConversationEntry) => {
      const targetLanguage = config?.translate_language ?? "Chinese";
      await requestTranslation(entry.conversationId, entry.text, targetLanguage);
      await refreshEntries(entry.conversationId);
    },
    [config, refreshEntries],
  );

  const handleOptimizeEntry = useCallback(async (entry: ConversationEntry) => {
    const improved = await optimizeText(entry.text);
    window.alert(improved);
  }, []);

  const handleSummarizeConversation = useCallback(async () => {
    if (!activeConversationId) return;
    const text = entries
      .filter((entry) => entry.kind === "transcription")
      .map((entry) => entry.text)
      .join("\n");
    if (text.trim().length === 0) return;
    const summary = await summarizeText(text, config?.translate_language ?? "Chinese");
    window.alert(summary);
  }, [activeConversationId, entries, config]);

  const handleProcessMedia = useCallback(
    async (options: { path: string; translate: boolean; targetLanguage?: string }) => {
      try {
        setMediaBusy(true);
        const conversationId = await processMediaFile(options);
        await refreshConversations(conversationId);
        await refreshEntries(conversationId);
      } finally {
        setMediaBusy(false);
      }
    },
    [refreshConversations, refreshEntries],
  );

  const handleSaveConfig = useCallback(async () => {
    if (!config) return;
    await saveConfig(config);
    setSettingsOpen(false);
  }, [config]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎙️</span>
          <div>
            <h1>{t("app.title")}</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => void refreshConversations()}>
            {t("app.actions.refresh")}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            {t("app.actions.settings")}
          </button>
        </div>
      </header>
      <div className="app-content">
        <HistoryPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={handleSelectConversation}
          onPin={handlePinConversation}
          onDelete={handleDeleteConversation}
        />
        <main className="app-main">
          <ControlPanel
            status={status}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onStartVoiceInput={handleStartVoiceInput}
            onStopVoiceInput={handleStopVoiceInput}
            busy={busy}
          />
          <TranscriptBoard
            entries={entries}
            activeConversationTitle={activeConversationTitle}
            onTranslate={handleTranslateEntry}
            onOptimize={handleOptimizeEntry}
          />
          <div className="app-footer-widgets">
            <MediaPanel
              busy={mediaBusy}
              defaultTargetLanguage={config?.translate_language ?? "Chinese"}
              onProcess={handleProcessMedia}
            />
            <div className="summary-panel">
              <h3>{t("app.summary.title")}</h3>
              <p>{t("app.summary.description")}</p>
              <button type="button" onClick={handleSummarizeConversation} disabled={!entries.length}>
                {t("app.summary.button")}
              </button>
              {mediaProgress && (
                <p className="media-progress">
                  {t("app.summary.mediaProgress", {
                    current: mediaProgress.current,
                    total: mediaProgress.total,
                  })}
                </p>
              )}
              {lastVoiceInput && lastVoiceInput.type === "voice_input" && (
                <div className="voice-preview">
                  <h4>{t("app.summary.lastVoiceInput")}</h4>
                  <p>{lastVoiceInput.transcription}</p>
                  {lastVoiceInput.translation && (
                    <p className="voice-translation">{lastVoiceInput.translation}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
      {config && (
        <SettingsDrawer
          open={settingsOpen}
          config={config}
          onChange={(patch) => setConfig({ ...config, ...patch })}
          onSave={handleSaveConfig}
          onClose={() => setSettingsOpen(false)}
          busy={busy}
        />
      )}
    </div>
  );
}

export default App;
