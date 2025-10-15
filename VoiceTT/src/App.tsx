import { useCallback, useEffect, useMemo, useState } from "react";
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

  const activeConversationTitle = useMemo(() => {
    return conversations.find((conversation) => conversation.id === activeConversationId)?.title ?? "Transcript";
  }, [conversations, activeConversationId]);

  const refreshStatus = useCallback(async () => {
    const next = await fetchStatus();
    setStatus(next);
  }, []);

  const refreshConversations = useCallback(async () => {
    const list = await fetchConversations();
    setConversations(list);
    if (!activeConversationId && list.length > 0) {
      setActiveConversationId(list[0].id);
    }
  }, [activeConversationId]);

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
      refreshEntries(activeConversationId);
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
          refreshConversations();
          if (activeConversationId === event.conversationId) {
            refreshEntries(event.conversationId);
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
          refreshConversations();
          break;
        default:
          break;
      }
    },
    [activeConversationId, refreshConversations, refreshEntries],
  );

  useTranscriptionEvents(handleTranscriptionEvent);

  const handleStartRecording = useCallback(async () => {
    if (!config) return;
    try {
      setBusy(true);
      await startRecording({
        translate: config.enable_translation,
        translateLanguage: config.translate_language,
      });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [config, refreshStatus]);

  const handleStopRecording = useCallback(async () => {
    try {
      setBusy(true);
      await stopRecording();
      await refreshStatus();
      if (activeConversationId) {
        await refreshEntries(activeConversationId);
      }
    } finally {
      setBusy(false);
    }
  }, [activeConversationId, refreshEntries, refreshStatus]);

  const handleStartVoiceInput = useCallback(async () => {
    if (!config) return;
    try {
      setBusy(true);
      await startVoiceInput({
        translate: config.voice_input_translate,
        translateLanguage: config.voice_input_translate_language,
        recognitionEngine: config.voice_input_engine,
        transcribeLanguage: config.voice_input_language,
      });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [config, refreshStatus]);

  const handleStopVoiceInput = useCallback(async () => {
    try {
      setBusy(true);
      await stopVoiceInput();
      await refreshStatus();
      if (activeConversationId) {
        await refreshEntries(activeConversationId);
      }
    } finally {
      setBusy(false);
    }
  }, [activeConversationId, refreshEntries, refreshStatus]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  const handlePinConversation = useCallback(
    async (conversationId: string, pinned: boolean) => {
      await setConversationPinned(conversationId, pinned);
      refreshConversations();
    },
    [refreshConversations],
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      await deleteConversation(conversationId);
      refreshConversations();
      if (conversationId === activeConversationId) {
        setActiveConversationId(undefined);
        setEntries([]);
      }
    },
    [activeConversationId, refreshConversations],
  );

  const handleTranslateEntry = useCallback(
    async (entry: ConversationEntry) => {
      const targetLanguage = config?.translate_language ?? "Chinese";
      await requestTranslation(entry.conversationId, entry.text, targetLanguage);
      refreshEntries(entry.conversationId);
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
        setActiveConversationId(conversationId);
        await refreshConversations();
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
            <h1>Voice Transcript Studio</h1>
            <p>Real-time transcription, translation, and summaries in a single workspace.</p>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => refreshConversations()}>
            Refresh
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
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
              <h3>Summary</h3>
              <p>Generate a high-level summary for the current conversation.</p>
              <button type="button" onClick={handleSummarizeConversation} disabled={!entries.length}>
                Summarize Conversation
              </button>
              {mediaProgress && (
                <p className="media-progress">
                  Processing media… {mediaProgress.current} / {mediaProgress.total}
                </p>
              )}
              {lastVoiceInput && lastVoiceInput.type === "voice_input" && (
                <div className="voice-preview">
                  <h4>Last voice input</h4>
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
