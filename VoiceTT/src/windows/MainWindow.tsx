import "./main/MainWindow.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateSummary,
  getConfig,
  getServiceStatus,
  exportLogs,
  exportResults,
  onPythonMessage,
  openMediaTranscribe,
  openSettings,
  openVoiceInputSettings,
  optimizeText,
  requestTranslation,
  restartPythonService,
  startVoiceInput,
  startRecording,
  stopRecording,
  stopVoiceInput,
  summarizeConversationTitle,
  windowControl,
  writeClipboard,
} from "../api";
import { PythonMessage } from "../api";
import { useI18n } from "../i18n";
import {
  Conversation,
  ConversationEntry,
  LogEntry,
  ServiceStatusState,
} from "./main/types";

const CONVERSATIONS_STORAGE_KEY = "voice_transcript_conversations_v1";
const ACTIVE_CONVERSATION_STORAGE_KEY = "voice_transcript_active_conversation_v1";
const HISTORY_COLLAPSED_STORAGE_KEY = "voice_transcript_history_collapsed";

const MAX_LOG_ENTRIES = 300;
const VOLUME_MIN_DB = -60;
const VOLUME_MAX_DB = 0;
const SILENCE_PLACEHOLDER_DB = (VOLUME_MIN_DB + VOLUME_MAX_DB) / 2;

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const pinnedA = a.pinned ? 1 : 0;
    const pinnedB = b.pinned ? 1 : 0;
    if (pinnedA !== pinnedB) {
      return pinnedB - pinnedA;
    }
    const rankA = a.orderRank ?? 0;
    const rankB = b.orderRank ?? 0;
    if (rankA !== rankB) {
      return rankB - rankA;
    }
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

function clampPercent(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function buildOptimizationMeta(meta: Record<string, unknown> | null | undefined) {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const engine = sanitizeText((meta as Record<string, unknown>).engine);
  const model = sanitizeText((meta as Record<string, unknown>).model);
  const result: Record<string, string> = {};
  if (engine) result.engine = engine;
  if (model) result.model = model;
  return Object.keys(result).length ? result : null;
}

function cx(
  ...classes: Array<string | Record<string, boolean> | undefined | null>
): string {
  const tokens: string[] = [];
  classes.forEach((value) => {
    if (!value) return;
    if (typeof value === "string") {
      tokens.push(value);
    } else {
      Object.entries(value).forEach(([key, active]) => {
        if (active) tokens.push(key);
      });
    }
  });
  return tokens.join(" ");
}

type ConfigObject = Record<string, unknown>;

function createConversation(name: string): Conversation {
  const timestamp = new Date().toISOString();
  return {
    id: `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    entries: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    orderRank: Date.now(),
    needsTitleRefresh: false,
    titleGeneratedAt: null,
  };
}

function createEntry(resultId: string): ConversationEntry {
  const timestamp = new Date().toISOString();
  return {
    id: `entry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    resultId,
    transcription: "",
    translation: "",
    transcriptionPending: false,
    translationPending: false,
    optimized: "",
    optimizedPending: false,
    optimizedError: null,
    optimizationMeta: null,
    meta: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sanitizeText(text: unknown): string {
  return typeof text === "string" ? text : "";
}

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function MainWindow({
  initialLanguage,
}: {
  initialLanguage: string;
}) {
  const { language, setLanguage, t } = useI18n();
  const [config, setConfig] = useState<ConfigObject | null>(null);
  const [pythonStatus, setPythonStatus] =
    useState<ServiceStatusState>("starting");
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    sortConversations(
      loadFromStorage<Conversation[]>(CONVERSATIONS_STORAGE_KEY, []),
    ),
  );
  const conversationsRef = useRef(conversations);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(() =>
    loadFromStorage<string | null>(
      ACTIVE_CONVERSATION_STORAGE_KEY,
      conversations.length ? conversations[0].id : null,
    ),
  );
  const [historyCollapsed, setHistoryCollapsed] = useState<boolean>(() =>
    loadFromStorage<boolean>(HISTORY_COLLAPSED_STORAGE_KEY, false),
  );
  const [historySearch, setHistorySearch] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summaryInFlight, setSummaryInFlight] = useState(false);
  const [titleInFlight, setTitleInFlight] = useState(false);
  const [volumeCollapsed, setVolumeCollapsed] = useState(true);
  const [volumeDb, setVolumeDb] = useState<number | null>(null);
  const [volumeRms, setVolumeRms] = useState(0);
  const [silenceDb, setSilenceDb] = useState(SILENCE_PLACEHOLDER_DB);
  const [volumeStatus, setVolumeStatus] = useState<
    "waiting" | "recording" | "notReady"
  >("waiting");
  const [historyContextMenu, setHistoryContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [lastConversationOrderRank, setLastConversationOrderRank] = useState(
    () => Date.now(),
  );

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    setLanguage(initialLanguage as any);
  }, [initialLanguage, setLanguage]);

  useEffect(() => {
    const handleDismiss = () => setHistoryContextMenu(null);
    document.addEventListener("click", handleDismiss);
    document.addEventListener("contextmenu", handleDismiss);
    return () => {
      document.removeEventListener("click", handleDismiss);
      document.removeEventListener("contextmenu", handleDismiss);
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      const nextStatus =
        pythonStatus === "running" ? "waiting" : "notReady";
      setVolumeStatus((current) =>
        current === nextStatus ? current : nextStatus,
      );
    }
  }, [isRecording, pythonStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(conversations),
    );
  }, [conversations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeConversationId) {
      window.localStorage.setItem(
        ACTIVE_CONVERSATION_STORAGE_KEY,
        JSON.stringify(activeConversationId),
      );
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      HISTORY_COLLAPSED_STORAGE_KEY,
      JSON.stringify(historyCollapsed),
    );
  }, [historyCollapsed]);

  useEffect(() => {
    if (historyContextMenu) {
      setHistoryContextMenu(null);
    }
  }, [historyCollapsed]);

  const emptyConversationTitle = useMemo(
    () => sanitizeText(t("index.history.emptyConversationTitle")),
    [language, t],
  );

  useEffect(() => {
    setConversations((prev) =>
      sortConversations(
        prev.map((conversation) => {
          if (conversation.entries.length === 0) {
            return { ...conversation, name: emptyConversationTitle };
          }
          return conversation;
        }),
      ),
    );
  }, [emptyConversationTitle]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  }, [activeConversationId, conversations]);

  const filteredConversations = useMemo(() => {
    if (!historySearch.trim()) return conversations;
    const normalized = historySearch.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (conversation.name.toLowerCase().includes(normalized)) {
        return true;
      }
      return conversation.entries.some(
        (entry) =>
          entry.transcription.toLowerCase().includes(normalized) ||
          entry.translation.toLowerCase().includes(normalized),
      );
    });
  }, [conversations, historySearch]);

  const formatSilenceLabel = useCallback(
    (db: number) => {
      const formatted = t("index.volume.silenceRangeLabel");
      if (
        formatted &&
        formatted !== "index.volume.silenceRangeLabel" &&
        formatted.includes("{value}")
      ) {
        return formatted.replace("{value}", db.toFixed(1));
      }
      const fallback = t("index.volume.silenceRange");
      if (fallback && fallback !== "index.volume.silenceRange") {
        return fallback;
      }
      const base = t("index.volume.silenceRange") || "Silence Range";
      return `${base} (${db.toFixed(1)} dB)`;
    },
    [t],
  );

  const formatDbDisplay = useCallback(
    (db: number | null) => {
      if (db === null) {
        const negInf = t("index.volume.dbValueNegInf");
        return negInf && negInf !== "index.volume.dbValueNegInf"
          ? negInf
          : "-inf dB";
      }
      if (db <= VOLUME_MIN_DB) {
        const template = t("index.volume.dbValueLessEqual");
        if (
          template &&
          template !== "index.volume.dbValueLessEqual" &&
          template.includes("{value}")
        ) {
          return template.replace("{value}", VOLUME_MIN_DB.toFixed(1));
        }
        return `<= ${VOLUME_MIN_DB.toFixed(1)} dB`;
      }
      const template = t("index.volume.dbValue");
      if (
        template &&
        template !== "index.volume.dbValue" &&
        template.includes("{value}")
      ) {
        return template.replace("{value}", db.toFixed(1));
      }
      return `${db.toFixed(1)} dB`;
    },
    [t],
  );

  const formatRmsDisplay = useCallback(
    (rms: number) => {
      const template = t("index.volume.rmsValue");
      if (
        template &&
        template !== "index.volume.rmsValue" &&
        template.includes("{value}")
      ) {
        return template.replace("{value}", rms.toFixed(3));
      }
      return `RMS ${rms.toFixed(3)}`;
    },
    [t],
  );

  const formatRecordedAtText = useCallback(
    (recordedAt: unknown) => {
      const value = sanitizeText(recordedAt);
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    },
    [],
  );

  const formatDurationText = useCallback((duration: unknown) => {
    const numeric = typeof duration === "number" ? duration : Number(duration);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return "";
    }
    const totalSeconds = Math.round(numeric);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const minutesPart = minutes > 0 ? `${minutes}m ` : "";
    const secondsPart = `${seconds}s`;
    return `${minutesPart}${secondsPart}`.trim();
  }, []);

  const formatOptimizationError = useCallback(
    (reason?: string, fallback?: string) => {
      const normalized = sanitizeText(reason);
      if (normalized === "timeout") {
        return t("index.optimized.timeout") || "Formal rewrite timed out";
      }
      if (normalized === "empty") {
        return (
          t("index.optimized.noText") ||
          "Transcription is not ready; cannot perform a formal rewrite yet"
        );
      }
      if (normalized === "credentials_missing") {
        return (
          fallback && fallback.trim()
            ? fallback
            : t("index.optimized.failed") || "Formal rewrite failed"
        );
      }
      if (fallback && fallback.trim()) {
        return fallback;
      }
      return t("index.optimized.failed") || "Formal rewrite failed";
    },
    [t],
  );

  const describeOptimizationMeta = useCallback(
    (meta: Record<string, unknown> | null | undefined) => {
      if (!meta || typeof meta !== "object") {
        return "";
      }
      const parts: string[] = [];
      const engine = sanitizeText((meta as Record<string, unknown>).engine);
      const model = sanitizeText((meta as Record<string, unknown>).model);
      if (engine) parts.push(engine);
      if (model) parts.push(model);
      return parts.join(" · ");
    },
    [],
  );

  const updateConversationEntry = useCallback(
    (
      conversationId: string | null | undefined,
      entryId: string | null | undefined,
      resultId: string | null | undefined,
      updater: (entry: ConversationEntry) => ConversationEntry,
      options: { keepOrder?: boolean } = {},
    ) => {
      const timestamp = new Date().toISOString();
      const orderRank = Date.now();
      let changed = false;
      setConversations((prev) => {
        const next = prev.map((conversation) => {
          if (conversationId && conversation.id !== conversationId) {
            return conversation;
          }
          const index = conversation.entries.findIndex((entry) => {
            if (entryId && entry.id === entryId) return true;
            if (resultId && entry.resultId === resultId) return true;
            return false;
          });
          if (index === -1) {
            return conversation;
          }
          changed = true;
          const entries = conversation.entries.slice();
          const updatedEntry = updater({ ...entries[index] });
          if (!updatedEntry.updatedAt) {
            updatedEntry.updatedAt = timestamp;
          }
          entries[index] = updatedEntry;
          return {
            ...conversation,
            entries,
            updatedAt: timestamp,
            orderRank: options.keepOrder
              ? conversation.orderRank
              : orderRank,
          };
        });
        if (!changed) {
          return prev;
        }
        return sortConversations(next);
      });
      if (changed && !options.keepOrder) {
        setLastConversationOrderRank(orderRank);
      }
    },
    [setLastConversationOrderRank],
  );

  const volumeActive = volumeStatus === "recording";
  const volumeDbText = useMemo(
    () => formatDbDisplay(volumeDb),
    [formatDbDisplay, volumeDb],
  );
  const volumeRmsText = useMemo(
    () => formatRmsDisplay(volumeRms),
    [formatRmsDisplay, volumeRms],
  );
  const silenceLabel = useMemo(
    () => formatSilenceLabel(silenceDb),
    [formatSilenceLabel, silenceDb],
  );
  const volumeLevelPercent = useMemo(() => {
    if (!volumeActive || volumeDb === null) {
      return 0;
    }
    const clamped = Math.min(
      VOLUME_MAX_DB,
      Math.max(VOLUME_MIN_DB, volumeDb),
    );
    const percent =
      ((clamped - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB)) * 100;
    return clampPercent(percent);
  }, [volumeActive, volumeDb]);
  const volumeSilencePercent = useMemo(() => {
    const clamped = Math.min(
      VOLUME_MAX_DB,
      Math.max(VOLUME_MIN_DB, silenceDb),
    );
    const percent =
      ((clamped - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB)) * 100;
    return clampPercent(percent);
  }, [silenceDb]);
  const volumeLevelClass = useMemo(() => {
    if (!volumeActive || volumeDb === null) {
      return "idle";
    }
    const clamped = Math.min(
      VOLUME_MAX_DB,
      Math.max(VOLUME_MIN_DB, volumeDb),
    );
    if (clamped <= -30) {
      return "low";
    }
    if (clamped <= -15) {
      return "medium";
    }
    return "high";
  }, [volumeActive, volumeDb]);
  const volumeStatusLabel = useMemo(() => {
    if (volumeStatus === "recording") {
      return t("index.volume.recording") || "Recording...";
    }
    if (volumeStatus === "waiting") {
      return t("index.volume.waiting") || "Waiting For Recording";
    }
    return t("index.statusText.notReady") || "Service not ready";
  }, [t, volumeStatus]);

  const contextConversation = useMemo(() => {
    if (!historyContextMenu) {
      return null;
    }
    return (
      conversations.find(
        (conversation) => conversation.id === historyContextMenu.id,
      ) ?? null
    );
  }, [conversations, historyContextMenu]);

  const appendLog = useCallback(
    (level: LogEntry["level"], message: string) => {
      setLogs((prev) => {
        const next: LogEntry[] = [
          ...prev,
          {
            id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            level,
            message,
            timestamp: new Date().toISOString(),
          },
        ];
        if (next.length > MAX_LOG_ENTRIES) {
          return next.slice(next.length - MAX_LOG_ENTRIES);
        }
        return next;
      });
    },
    [],
  );

  const ensureConversation = useCallback(() => {
    let createdConversationId: string | null = null;
    let createdConversationRank: number | null = null;
    setConversations((prev) => {
      if (prev.length === 0) {
        const conversation = createConversation(emptyConversationTitle);
        createdConversationId = conversation.id;
        createdConversationRank = conversation.orderRank ?? Date.now();
        return sortConversations([conversation]);
      }
      return prev;
    });
    if (createdConversationRank !== null) {
      setLastConversationOrderRank(createdConversationRank);
    }
    if (!activeConversationIdRef.current) {
      setActiveConversationId((current) => {
        if (current) return current;
        const fallback =
          createdConversationId ??
          (conversationsRef.current[0]
            ? conversationsRef.current[0].id
            : null);
        return fallback;
      });
    }
  }, [emptyConversationTitle]);

  const handlePythonResult = useCallback(
    (message: PythonMessage) => {
      const resultId =
        sanitizeText((message as Record<string, unknown>).result_id) ||
        `result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const timestamp = new Date().toISOString();
      const orderRank = Date.now();
      let createdConversationId: string | null = null;
      setConversations((prev) => {
        let next = [...prev];
        if (next.length === 0) {
          const conversation = createConversation(emptyConversationTitle);
          conversation.orderRank = orderRank;
          next = [conversation];
          createdConversationId = conversation.id;
        }
        const activeId =
          activeConversationIdRef.current ?? next[next.length - 1].id;
        const index = next.findIndex((conversation) => conversation.id === activeId);
        const conversationIndex = index >= 0 ? index : 0;
        const conversation = { ...next[conversationIndex] };
        const entries = conversation.entries.map((entry) => ({ ...entry }));

        let entryIndex = entries.findIndex(
          (entry) => entry.resultId === resultId,
        );
        if (entryIndex === -1) {
          const entry = createEntry(resultId);
          entries.push(entry);
          entryIndex = entries.length - 1;
        }

        const entry = { ...entries[entryIndex] };
        const transcription = sanitizeText(
          (message as Record<string, unknown>).transcription,
        );
        const translation = sanitizeText(
          (message as Record<string, unknown>).translation,
        );
        if (transcription) {
          entry.transcription = transcription;
          entry.transcriptionPending = false;
        }
        if (translation) {
          entry.translation = translation;
          entry.translationPending = false;
        }
        entry.updatedAt = timestamp;
        entries[entryIndex] = entry;

        conversation.entries = entries;
        conversation.updatedAt = timestamp;
        conversation.orderRank = orderRank;
        next[conversationIndex] = conversation;
        return sortConversations(next);
      });
      setLastConversationOrderRank(orderRank);

      if (createdConversationId) {
        setActiveConversationId(createdConversationId);
      }
    },
    [emptyConversationTitle],
  );

  const updateEntryByResultId = useCallback(
    (
      resultId: string,
      updater: (entry: ConversationEntry) => ConversationEntry,
      options: { clearPending?: boolean; keepOrder?: boolean } = {},
    ) => {
      updateConversationEntry(
        null,
        null,
        resultId,
        (entry) => {
          const nextEntry = updater({ ...entry });
          if (options.clearPending) {
            nextEntry.translationPending = false;
            nextEntry.transcriptionPending = false;
          }
          return nextEntry;
        },
        { keepOrder: options.keepOrder },
      );
    },
    [updateConversationEntry],
  );

  const handlePythonMessage = useCallback(
    (message: PythonMessage) => {
      const type = sanitizeText(
        (message as Record<string, unknown>).type,
      ).toLowerCase();

      if (!type) return;

      switch (type) {
        case "log": {
          const level = sanitizeText(
            (message as Record<string, unknown>).level,
          ).toLowerCase() as LogEntry["level"] | "";
          const logLevel: LogEntry["level"] =
            level === "warning" || level === "warn"
              ? "warning"
              : level === "error"
                ? "error"
                : level === "debug"
                  ? "debug"
                  : "info";
          const logMessage = sanitizeText(
            (message as Record<string, unknown>).message,
          );
          appendLog(logLevel, logMessage || "[log]");
          if (logMessage.includes("Service started")) {
            setPythonStatus("running");
          }
          if (logMessage.includes("Service stopped")) {
            setPythonStatus("stopped");
          }
          break;
        }
        case "result":
        case "result_final": {
          handlePythonResult(message);
          break;
        }
        case "transcription_update": {
          const resultId = sanitizeText(
            (message as Record<string, unknown>).result_id,
          );
          if (!resultId) return;
          const transcription = sanitizeText(
            (message as Record<string, unknown>).transcription,
          );
          const pending = Boolean(
            (message as Record<string, unknown>).transcription_pending,
          );
          updateEntryByResultId(
            resultId,
            (entry) => ({
              ...entry,
              transcription: transcription || entry.transcription,
              transcriptionPending: pending,
            }),
            { clearPending: !pending },
          );
          break;
        }
        case "translation_update": {
          const resultId = sanitizeText(
            (message as Record<string, unknown>).result_id,
          );
          if (!resultId) return;
          const translation = sanitizeText(
            (message as Record<string, unknown>).translation,
          );
          const pending = Boolean(
            (message as Record<string, unknown>).translation_pending,
          );
          updateEntryByResultId(
            resultId,
            (entry) => ({
              ...entry,
              translation: translation || entry.translation,
              translationPending: pending,
            }),
            { clearPending: !pending },
          );
          break;
        }
        case "conversation_summary": {
          const conversationId = sanitizeText(
            (message as Record<string, unknown>).conversation_id,
          );
          if (!conversationId) return;
          const title = sanitizeText(
            (message as Record<string, unknown>).title,
          );
          if (!title) return;
          setConversations((prev) =>
            prev.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, name: title }
                : conversation,
            ),
          );
          break;
        }
        case "summary_result": {
          appendLog("info", t("index.log.summaryComplete") || "Summary ready");
          break;
        }
        case "volume_level": {
          if (!isRecording) {
            break;
          }
          setVolumeStatus("recording");
          const rawDb = Number(
            (message as Record<string, unknown>).db,
          );
          if (Number.isFinite(rawDb)) {
            const clamped = Math.min(
              VOLUME_MAX_DB,
              Math.max(VOLUME_MIN_DB, rawDb),
            );
            setVolumeDb((prev) => (prev === clamped ? prev : clamped));
          } else {
            setVolumeDb((prev) => (prev === null ? prev : null));
          }
          const rmsValue = Number(
            (message as Record<string, unknown>).rms,
          );
          if (Number.isFinite(rmsValue)) {
            setVolumeRms((prev) =>
              Math.abs(prev - rmsValue) < 0.0005 ? prev : rmsValue,
            );
          }
          const silenceValue = Number(
            (message as Record<string, unknown>).silence_db,
          );
          if (Number.isFinite(silenceValue)) {
            const clampedSilence = Math.min(
              VOLUME_MAX_DB,
              Math.max(VOLUME_MIN_DB, silenceValue),
            );
            setSilenceDb((prev) =>
              Math.abs(prev - clampedSilence) < 0.01 ? prev : clampedSilence,
            );
          }
          break;
        }
        case "voice_activity": {
          const activeFlag = Boolean(
            (message as Record<string, unknown>).active,
          );
          if (activeFlag) {
            if (!isVoiceInputActive) {
              appendLog(
                "info",
                t("index.log.voiceInputStarted") || "Voice input started",
              );
            }
            if (!isVoiceInputActive) {
              setIsVoiceInputActive(true);
            }
            if (!isRecording) {
              setIsRecording(true);
            }
            setPythonStatus("running");
            setVolumeStatus("recording");
          }
          break;
        }
        case "optimization_result": {
          const payload = message as Record<string, unknown>;
          const conversationId = sanitizeText(payload.conversation_id);
          const entryId = sanitizeText(payload.entry_id);
          const resultId = sanitizeText(payload.result_id);
          const success = payload.success !== false;
          const optimizedText = sanitizeText(payload.optimized_text);
          const optimizationMeta = buildOptimizationMeta({
            engine: payload.engine,
            model: payload.model,
          } as Record<string, unknown>);
          if (success && optimizedText) {
            updateConversationEntry(
              conversationId,
              entryId,
              resultId,
              (current) => ({
                ...current,
                optimized: optimizedText,
                optimizedPending: false,
                optimizedError: null,
                optimizationMeta,
              }),
              { keepOrder: true },
            );
          } else {
            const errorText = formatOptimizationError(
              payload.reason as string | undefined,
              sanitizeText(payload.error),
            );
            updateConversationEntry(
              conversationId,
              entryId,
              resultId,
              (current) => ({
                ...current,
                optimized: "",
                optimizedPending: false,
                optimizedError: errorText,
                optimizationMeta,
              }),
              { keepOrder: true },
            );
            appendLog(
              "error",
              `${
                t("index.optimized.logFailed") || "Formal rewrite failed"
              }: ${errorText}`,
            );
          }
          break;
        }
        case "recording_error": {
          setIsRecording(false);
          setPythonStatus("error");
          setIsVoiceInputActive(false);
          const errorMessage = sanitizeText(
            (message as Record<string, unknown>).message,
          );
          appendLog("error", errorMessage || "Recording error");
          setVolumeStatus("notReady");
          setVolumeDb(null);
          setVolumeRms(0);
          setSilenceDb(SILENCE_PLACEHOLDER_DB);
          break;
        }
        case "recording_stopped": {
          setIsRecording(false);
          if (isVoiceInputActive) {
            appendLog(
              "info",
              t("index.log.voiceInputStopped") || "Voice input stopped",
            );
          }
          setIsVoiceInputActive(false);
          setVolumeStatus(
            pythonStatus === "running" ? "waiting" : "notReady",
          );
          setVolumeDb(null);
          setVolumeRms(0);
          setSilenceDb(SILENCE_PLACEHOLDER_DB);
          break;
        }
        default:
          break;
      }
    },
    [
      appendLog,
      formatOptimizationError,
      handlePythonResult,
      isRecording,
      isVoiceInputActive,
      pythonStatus,
      t,
      updateConversationEntry,
      updateEntryByResultId,
    ],
  );

  useEffect(() => {
    getConfig<ConfigObject>()
      .then((value) => setConfig(value))
      .catch(() => {
        appendLog("error", "Failed to load configuration");
      });
  }, [appendLog]);

  useEffect(() => {
    const lang = sanitizeText(config?.app_language);
    if (lang) {
      setLanguage(lang as any);
    }
  }, [config?.app_language, setLanguage]);

  useEffect(() => {
    getServiceStatus()
      .then((status) => {
        if (status.running) {
          setPythonStatus(status.ready ? "running" : "starting");
        } else {
          setPythonStatus("stopped");
        }
      })
      .catch(() => {
        setPythonStatus("error");
      });
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    onPythonMessage(handlePythonMessage)
      .then((unlisten) => {
        unsubscribe = unlisten;
      })
      .catch(() => {
        appendLog("error", "Failed to subscribe to backend messages");
      });
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [appendLog, handlePythonMessage]);

  const handleToggleRecording = useCallback(async () => {
    try {
      if (isRecording) {
        await stopRecording();
        setIsRecording(false);
        setIsVoiceInputActive(false);
        setVolumeStatus(
          pythonStatus === "running" ? "waiting" : "notReady",
        );
        setVolumeDb(null);
        setVolumeRms(0);
        setSilenceDb(SILENCE_PLACEHOLDER_DB);
        appendLog("info", t("index.log.recordingStopped") || "Recording stopped");
      } else {
        ensureConversation();
        await startRecording();
        setIsRecording(true);
        setIsVoiceInputActive(false);
        setPythonStatus("running");
        setVolumeStatus("recording");
        setVolumeDb(null);
        setVolumeRms(0);
        setSilenceDb(SILENCE_PLACEHOLDER_DB);
        appendLog("info", t("index.log.recordingStarted") || "Recording started");
      }
    } catch (error) {
      appendLog(
        "error",
        t("index.log.recordingError") || `Recording error: ${String(error)}`,
      );
      setIsRecording(false);
      setIsVoiceInputActive(false);
      setPythonStatus("error");
      setVolumeStatus("notReady");
      setVolumeDb(null);
      setVolumeRms(0);
      setSilenceDb(SILENCE_PLACEHOLDER_DB);
    }
  }, [
    appendLog,
    ensureConversation,
    isRecording,
    pythonStatus,
    startRecording,
    stopRecording,
    t,
  ]);

  const handleToggleVoiceInput = useCallback(async () => {
    try {
      if (isVoiceInputActive) {
        await stopVoiceInput();
        setIsVoiceInputActive(false);
        setIsRecording(false);
        setVolumeStatus(
          pythonStatus === "running" ? "waiting" : "notReady",
        );
        setVolumeDb(null);
        setVolumeRms(0);
        setSilenceDb(SILENCE_PLACEHOLDER_DB);
        appendLog(
          "info",
          t("index.log.voiceInputStopped") || "Voice input stopped",
        );
      } else {
        ensureConversation();
        await startVoiceInput();
        setIsVoiceInputActive(true);
        setIsRecording(true);
        setPythonStatus("running");
        setVolumeStatus("recording");
        setVolumeDb(null);
        setVolumeRms(0);
        setSilenceDb(SILENCE_PLACEHOLDER_DB);
        appendLog(
          "info",
          t("index.log.voiceInputStarted") || "Voice input started",
        );
      }
    } catch (error) {
      appendLog(
        "error",
        t("index.log.voiceInputError") ||
          `Voice input error: ${String(error)}`,
      );
      setIsVoiceInputActive(false);
      setIsRecording(false);
      setVolumeStatus("notReady");
      setVolumeDb(null);
      setVolumeRms(0);
      setSilenceDb(SILENCE_PLACEHOLDER_DB);
    }
  }, [
    appendLog,
    ensureConversation,
    isVoiceInputActive,
    pythonStatus,
    startVoiceInput,
    stopVoiceInput,
    t,
  ]);

  const handleNewConversation = useCallback(() => {
    const conversation = createConversation(emptyConversationTitle);
    const rank = conversation.orderRank ?? Date.now();
    setLastConversationOrderRank(rank);
    setConversations((prev) =>
      sortConversations([conversation, ...prev]),
    );
    setActiveConversationId(conversation.id);
  }, [emptyConversationTitle, setLastConversationOrderRank]);

  const handleDeleteConversation = useCallback((id: string) => {
    const remaining = conversationsRef.current.filter(
      (conversation) => conversation.id !== id,
    );
    setConversations((prev) =>
      sortConversations(
        prev.filter((conversation) => conversation.id !== id),
      ),
    );
    setActiveConversationId((current) => {
      if (current === id) {
        return remaining.length ? remaining[0].id : null;
      }
      return current;
    });
    setHistoryContextMenu(null);
  }, []);

  const togglePinConversation = useCallback((id: string) => {
    setConversations((prev) =>
      sortConversations(
        prev.map((conversation) =>
          conversation.id === id
            ? { ...conversation, pinned: !conversation.pinned }
            : conversation,
        ),
      ),
    );
    setHistoryContextMenu(null);
  }, []);

  const moveConversationToTop = useCallback(
    (id: string) => {
      const rank = Date.now();
      setLastConversationOrderRank(rank);
      setConversations((prev) =>
        sortConversations(
          prev.map((conversation) =>
            conversation.id === id
              ? { ...conversation, orderRank: rank }
              : conversation,
          ),
        ),
      );
      setHistoryContextMenu(null);
    },
    [setLastConversationOrderRank],
  );

  const handleRequestTranslation = useCallback(
    async (entry: ConversationEntry, conversation: Conversation) => {
      if (!entry.transcription || entry.transcriptionPending) {
        appendLog(
          "warning",
          t("index.log.translationNoText") ||
            "Transcription is not ready yet",
        );
        return;
      }
      if (entry.translationPending) {
        appendLog(
          "info",
          t("index.log.translationInProgress") ||
            "Translation is already running",
        );
        return;
      }
      const targetLanguage =
        sanitizeText(
          (config?.translate_language as string | undefined) ?? "",
        ) || "Chinese";
      updateEntryByResultId(entry.resultId || entry.id, (current) => ({
        ...current,
        translationPending: true,
      }));
      try {
        await requestTranslation({
          transcription: entry.transcription,
          resultId: entry.resultId ?? entry.id,
          conversationId: conversation.id,
          entryId: entry.id,
          targetLanguage,
          context: "manual",
        });
        appendLog(
          "info",
          t("index.log.translationQueued") || "Translation requested",
        );
      } catch (error) {
        appendLog(
          "error",
          t("index.log.translationFailed") ||
            `Translation failed: ${String(error)}`,
        );
        updateEntryByResultId(
          entry.resultId || entry.id,
          (current) => ({ ...current }),
          { clearPending: true },
        );
      }
    },
    [appendLog, config?.translate_language, t, updateEntryByResultId],
  );

  const handleOptimizeEntry = useCallback(
    async (entry: ConversationEntry, conversation: Conversation) => {
      if (!entry.transcription || entry.transcriptionPending) {
        appendLog(
          "warning",
          t("index.optimized.noText") ||
            "Transcription is not ready; cannot perform a formal rewrite yet",
        );
        return;
      }
      updateConversationEntry(
        conversation.id,
        entry.id,
        entry.resultId ?? entry.id,
        (current) => ({
          ...current,
          optimizedPending: true,
          optimized: "",
          optimizedError: null,
          optimizationMeta: null,
        }),
      );
      appendLog(
        "info",
        t("index.optimized.logQueued") || "Formal rewrite requested",
      );
      try {
        const response = (await optimizeText({
          text: entry.transcription,
          conversationId: conversation.id,
          entryId: entry.id,
          resultId: entry.resultId ?? null,
          context: "manual",
        })) as Record<string, unknown> | undefined;
        if (response) {
          const responseData = response as Record<string, unknown>;
          if (responseData.success === false) {
            const immediateMeta = buildOptimizationMeta({
              engine: responseData.engine,
              model: responseData.model,
            } as Record<string, unknown>);
            const errorText = formatOptimizationError(
              responseData.reason as string | undefined,
              sanitizeText(responseData.error),
            );
            updateConversationEntry(
              conversation.id,
              entry.id,
              entry.resultId ?? null,
              (current) => ({
                ...current,
                optimizedPending: false,
                optimized: "",
                optimizedError: errorText,
                optimizationMeta: immediateMeta,
              }),
              { keepOrder: true },
            );
            appendLog(
              "error",
              `${
                t("index.optimized.logFailed") || "Formal rewrite failed"
              }: ${errorText}`,
            );
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const formatted = formatOptimizationError(undefined, message);
        updateConversationEntry(
          conversation.id,
          entry.id,
          entry.resultId ?? null,
          (current) => ({
            ...current,
            optimizedPending: false,
            optimized: "",
            optimizedError: formatted,
            optimizationMeta: null,
          }),
          { keepOrder: true },
        );
        appendLog(
          "error",
          `${t("index.optimized.logFailed") || "Formal rewrite failed"}: ${
            formatted || message
          }`,
        );
      }
    },
    [
      appendLog,
      formatOptimizationError,
      optimizeText,
      t,
      updateConversationEntry,
    ],
  );

  const collectExportResults = useCallback(
    (conversation: Conversation) =>
      conversation.entries.map((entry) => ({
        transcription: entry.transcription || "",
        translation: entry.translation || "",
      })),
    [],
  );

  const collectExportLogEntries = useCallback(
    (conversation: Conversation) => {
      return conversation.entries
        .filter((entry) => entry.transcription && !entry.transcriptionPending)
        .map((entry) => {
          const meta = entry.meta || {};
          const recordedText = formatRecordedAtText(
            (meta as Record<string, unknown>).recordedAt,
          );
          const durationText = formatDurationText(
            (meta as Record<string, unknown>).durationSeconds,
          );
          const includeTranslation = Boolean(
            entry.translation && !entry.translationPending,
          );
          const timeParts = [recordedText, durationText].filter(Boolean);
          return {
            transcription: entry.transcription,
            translation: includeTranslation ? entry.translation : "",
            includeTranslation,
            timeText: timeParts.join(" · "),
          };
        });
    },
    [formatDurationText, formatRecordedAtText],
  );

  const handleExportConversation = useCallback(async () => {
    if (!activeConversation || !activeConversation.entries.length) {
      appendLog(
        "warning",
        t("index.log.exportNoResults") || "No logs to export",
      );
      return;
    }
    try {
      const payload = collectExportResults(activeConversation);
      const response = (await exportResults(payload)) as {
        success?: boolean;
        error?: unknown;
      } | undefined;
      if (response && response.success !== false) {
        appendLog(
          "info",
          t("index.log.exportResultsSuccess") || "Transcript exported",
        );
      } else if (response && response.error) {
        appendLog(
          "error",
          `${
            t("index.log.exportResultsFailed")
            || "Failed to export transcript"
          }: ${String(response.error)}`,
        );
      } else {
        appendLog(
          "error",
          t("index.log.exportResultsFailed") || "Failed to export transcript",
        );
      }
    } catch (error) {
      appendLog(
        "error",
        `${
          t("index.log.exportResultsFailed") || "Failed to export transcript"
        }: ${String(error)}`,
      );
    }
  }, [
    activeConversation,
    appendLog,
    collectExportResults,
    exportResults,
    t,
  ]);

  const handleExportLogs = useCallback(async () => {
    if (!activeConversation || !activeConversation.entries.length) {
      appendLog(
        "warning",
        t("index.log.exportNoResults") || "No logs to export",
      );
      return;
    }
    const entries = collectExportLogEntries(activeConversation)
      .filter((entry) => entry.transcription);
    if (!entries.length) {
      appendLog(
        "warning",
        t("index.log.exportNoResults") || "No logs to export",
      );
      return;
    }
    try {
      const response = (await exportLogs(entries))
        as { success?: boolean; error?: unknown; canceled?: boolean } | undefined;
      if (response && response.success !== false) {
        appendLog(
          "info",
          t("index.log.exportSuccess") || "Logs exported",
        );
      } else if (response && response.error) {
        appendLog(
          "error",
          `${t("index.log.exportFailed") || "Failed to export logs"}: ${
            response.error
          }`,
        );
      } else if (!(response && response.canceled == true)) {
        appendLog(
          "error",
          t("index.log.exportFailed") || "Failed to export logs",
        );
      }
    } catch (error) {
      appendLog(
        "error",
        `${t("index.log.exportFailed") || "Failed to export logs"}: ${
          String(error)
        }`,
      );
    }
  }, [
    activeConversation,
    appendLog,
    collectExportLogEntries,
    exportLogs,
    t,
  ]);

  const handleCopyText = useCallback(
    async (text: string, messageKey: string) => {
      if (!text.trim()) {
        appendLog("warning", t("index.log.copyEmpty") || "Nothing to copy");
        return;
      }
      try {
        await writeClipboard(text);
        appendLog("info", t(messageKey) || "Copied");
      } catch (error) {
        appendLog(
          "error",
          t("index.log.copyFailed") || `Copy failed: ${String(error)}`,
        );
      }
    },
    [appendLog, t],
  );

  const handleSummarizeConversationTitle = useCallback(async () => {
    if (!activeConversation) return;
    if (!activeConversation.entries.length) return;
    setTitleInFlight(true);
    try {
      await summarizeConversationTitle({
        conversationId: activeConversation.id,
        segments: activeConversation.entries.map((entry) => ({
          transcription: entry.transcription,
          translation: entry.translation,
        })),
        targetLanguage:
          sanitizeText(
            (config?.translate_language as string | undefined) ?? "",
          ) || "Chinese",
        emptyTitle: emptyConversationTitle,
        fallbackTitle: activeConversation.name,
      });
    } finally {
      setTitleInFlight(false);
    }
  }, [activeConversation, config?.translate_language, emptyConversationTitle]);

  const handleGenerateSummary = useCallback(async () => {
    if (!activeConversation) return;
    if (!activeConversation.entries.length) return;
    setSummaryInFlight(true);
    try {
      const response = await generateSummary({
        conversationId: activeConversation.id,
        segments: activeConversation.entries.map((entry) => ({
          transcription: entry.transcription,
          translation: entry.translation,
        })),
      });
      const content = sanitizeText(
        (response as Record<string, unknown>).content,
      );
      if (content) {
        appendLog("info", content);
      }
    } catch (error) {
      appendLog(
        "error",
        t("index.log.summaryFailed") || `Summary failed: ${String(error)}`,
      );
    } finally {
      setSummaryInFlight(false);
    }
  }, [activeConversation, appendLog, t]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleCopyLatestResult = useCallback(() => {
    const latestEntry = conversations
      .flatMap((conversation) => conversation.entries)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (!latestEntry) {
      appendLog("warning", t("index.log.copyEmpty") || "Nothing to copy");
      return;
    }
    handleCopyText(
      latestEntry.translation || latestEntry.transcription,
      "index.log.copySuccess",
    );
  }, [appendLog, conversations, handleCopyText, t]);

  const handleReloadConfig = useCallback(async () => {
    try {
      const latest = await getConfig<ConfigObject>();
      setConfig(latest);
      appendLog("info", t("settings.notify.reloaded") || "Config reloaded");
    } catch (error) {
      appendLog(
        "error",
        t("settings.notify.loadFailed") ||
          `Failed to load configuration: ${String(error)}`,
      );
    }
  }, [appendLog, t]);

  const serviceStatusLabel = useMemo(() => {
    switch (pythonStatus) {
      case "running":
        return t("index.status.running") || "Service running";
      case "starting":
        return t("index.status.starting") || "Starting Python service...";
      case "error":
        return t("index.status.error") || "Service error";
      case "stopped":
      default:
        return t("index.status.stopped") || "Service stopped";
    }
  }, [pythonStatus, t]);

  return (
    <div
      className={cx("main-window", { "python-error": pythonStatus === "error" })}
    >
      <div className="title-bar">
        <div className="title-bar__left">
          <strong>{t("index.title")}</strong>
          <span className={cx("status-dot", pythonStatus)} />
          <span className="status-text">{serviceStatusLabel}</span>
        </div>
        <div className="title-bar__center">
          <button
            className={cx("record-button", {
              recording: isRecording,
            })}
            onClick={handleToggleRecording}
          >
            <span className="record-icon" role="img" aria-hidden>
              {isRecording ? "⏹" : "🎙"}
            </span>
            <span className="record-label">
              {isRecording
                ? t("index.buttons.recordActive") || "Stop Recording"
                : t("index.buttons.recordIdle") || "Start Recording"}
            </span>
          </button>
          <button
            className={cx("toolbar-button", { recording: isVoiceInputActive })}
            onClick={handleToggleVoiceInput}
          >
            {isVoiceInputActive
              ? t("index.buttons.voiceInputStop") || "Stop Voice Input"
              : t("index.buttons.voiceInputStart") || "Start Voice Input"}
          </button>
          <button
            className="toolbar-button"
            onClick={handleSummarizeConversationTitle}
            disabled={!activeConversation || titleInFlight}
          >
            {titleInFlight
              ? t("index.buttons.summaryTooltip") || "Summarizing..."
              : t("index.buttons.exportLogs") || "Summarize"}
          </button>
          <button
            className="toolbar-button"
            onClick={handleGenerateSummary}
            disabled={!activeConversation || summaryInFlight}
          >
            {t("index.buttons.summaryTooltip") || "Summarize conversation"}
          </button>
        </div>
        <div className="title-bar__right">
          <button
            className="toolbar-button"
            onClick={() => openVoiceInputSettings()}
          >
            {t("index.tooltips.voiceInput") || "Voice Input"}
          </button>
          <button
            className="toolbar-button"
            onClick={() => openMediaTranscribe()}
          >
            {t("index.tooltips.media") || "Media"}
          </button>
          <button
            className="toolbar-button"
            onClick={() => openSettings()}
          >
            {t("index.tooltips.settings") || "Settings"}
          </button>
          <div className="window-controls">
            <button onClick={() => windowControl("minimize")}>─</button>
            <button onClick={() => windowControl("toggle-maximize")}>▢</button>
            <button onClick={() => windowControl("close")}>✕</button>
          </div>
        </div>
      </div>

      <div
        className={cx("volume-panel", {
          active: volumeActive,
          inactive: !volumeActive,
          collapsed: volumeCollapsed,
        })}
      >
        <div className="volume-header">
          <div className="volume-title">
            <span>{t("index.volume.current") || "Current Volume"}</span>
            <span className="volume-status-text">{volumeStatusLabel}</span>
          </div>
          <button
            className="volume-toggle-btn"
            type="button"
            aria-expanded={!volumeCollapsed}
            aria-controls="volumeBody"
            onClick={() => setVolumeCollapsed((value) => !value)}
            title={
              volumeCollapsed
                ? t("index.volume.expandTooltip") || "Expand volume monitor"
                : t("index.volume.collapseTooltip") || "Collapse volume monitor"
            }
          >
            {volumeCollapsed
              ? t("index.volume.expand") || "Expand"
              : t("index.volume.collapse") || "Collapse"}
          </button>
        </div>
        <div
          id="volumeBody"
          className={cx("volume-body", { hidden: volumeCollapsed })}
        >
          <div className="volume-bar-wrapper">
            <div className="volume-scale">
              <span>{t("index.volume.scaleMinus60") || "-60 dB"}</span>
              <span>{t("index.volume.scaleMinus40") || "-40 dB"}</span>
              <span>{t("index.volume.scaleMinus20") || "-20 dB"}</span>
              <span>{t("index.volume.scaleMinus10") || "-10 dB"}</span>
              <span>{t("index.volume.scale0") || "0 dB"}</span>
            </div>
            <div className="volume-bar">
              <div
                className="volume-silence"
                style={{
                  width: `${
                    volumeActive ? volumeSilencePercent : 33
                  }%`,
                }}
              >
                {silenceLabel}
              </div>
              <div
                className={cx("volume-level", volumeLevelClass)}
                style={{ width: `${volumeLevelPercent}%` }}
              />
            </div>
          </div>
          <div className="volume-values">
            <span>{volumeDbText}</span>
            <span>{volumeRmsText}</span>
          </div>
        </div>
      </div>

      <div
        className={cx("content", {
          "history-collapsed": historyCollapsed,
        })}
      >
        <aside className="history-panel">
          <div className="history-header">
            <div className="history-title">
              {t("index.history.title") || "History"}
            </div>
            <button
              className="history-toggle"
              onClick={() => setHistoryCollapsed((value) => !value)}
            >
              {historyCollapsed
                ? t("index.history.show") || "Show History"
                : t("index.history.hide") || "Hide History"}
            </button>
          </div>
          <button className="new-conversation" onClick={handleNewConversation}>
            {t("index.history.newConversation") || "New Conversation"}
          </button>
          <input
            type="search"
            className="history-search"
            placeholder={
              t("index.history.searchPlaceholder") ||
              "Search transcripts or translations"
            }
            value={historySearch}
            onChange={(event) => setHistorySearch(event.currentTarget.value)}
          />
          <div className="history-list">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={cx("history-item", {
                  active: conversation.id === activeConversationId,
                  pinned: Boolean(conversation.pinned),
                })}
                onClick={() => setActiveConversationId(conversation.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setHistoryContextMenu({
                    id: conversation.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <span className="history-name">{conversation.name}</span>
                <span className="history-meta">
                  <span className="history-count">
                    {conversation.entries.length}
                  </span>
                  {conversation.pinned && (
                    <span className="history-pin" aria-hidden="true">
                      📌
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {historyContextMenu && (
            <div
              className="context-menu"
              style={{
                top: historyContextMenu.y,
                left: historyContextMenu.x,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => moveConversationToTop(historyContextMenu.id)}
              >
                {t("index.history.context.moveToTop") || "Move to top"}
              </button>
              <button
                type="button"
                onClick={() => togglePinConversation(historyContextMenu.id)}
              >
                {contextConversation?.pinned
                  ? t("index.history.context.unpin") || "Unpin conversation"
                  : t("index.history.context.pin") || "Pin conversation"}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConversation(historyContextMenu.id)}
              >
                {t("index.history.context.delete") || "Delete conversation"}
              </button>
            </div>
          )}
        </aside>

        <main className="main-panel">
          <div className="conversation-toolbar">
            <div className="conversation-actions">
              <button
                className="conversation-action"
                onClick={handleCopyLatestResult}
              >
                {t("index.buttons.copyLatest") || "Copy Latest Result"}
              </button>
              <button
                className="conversation-action"
                onClick={handleReloadConfig}
              >
                {t("settings.notify.reloaded") || "Reload Config"}
              </button>
              <button
                className="conversation-action"
                onClick={handleExportConversation}
              >
                {t("index.buttons.exportConversation") || "Export Conversation"}
              </button>
              <button
                className="conversation-action"
                onClick={async () => {
                  try {
                    await restartPythonService();
                    appendLog(
                      "info",
                      t("index.buttons.restartService") ||
                        "Restart Service",
                    );
                  } catch (error) {
                    appendLog(
                      "error",
                      `${
                        t("index.log.backendFailed") ||
                        "Backend connection failed"
                      }: ${String(error)}`,
                    );
                  }
                }}
              >
                {t("index.buttons.restartService") || "Restart Service"}
              </button>
            </div>
            {activeConversation && (
              <button
                className="conversation-delete"
                onClick={() => handleDeleteConversation(activeConversation.id)}
              >
                {t("index.context.delete") || "Delete"}
              </button>
            )}
          </div>

          <section className="conversation-view">
            {activeConversation && activeConversation.entries.length > 0 ? (
              activeConversation.entries.map((entry) => {
                const optimizationMetaText = describeOptimizationMeta(
                  entry.optimizationMeta,
                );
                return (
                  <article className="conversation-entry" key={entry.id}>
                    <header className="entry-header">
                      <div className="entry-meta">
                        <time>
                          {new Date(entry.updatedAt).toLocaleTimeString()}
                        </time>
                        {entry.transcriptionPending && (
                          <span className="badge">
                            {t("index.result.transcribing") || "Transcribing..."}
                          </span>
                        )}
                        {entry.translationPending && (
                          <span className="badge">
                            {t("index.translation.loading") || "Translating..."}
                          </span>
                        )}
                        {entry.optimizedPending && (
                          <span className="badge">
                            {t("index.optimized.pending") || "Rewriting formally..."}
                          </span>
                        )}
                      </div>
                      <div className="entry-actions">
                        <button
                          onClick={() =>
                            handleCopyText(
                              entry.transcription,
                              "index.context.copy",
                            )
                          }
                        >
                          {t("index.context.copy") || "Copy Transcription"}
                        </button>
                        <button
                          onClick={() =>
                            handleCopyText(
                              entry.translation || entry.transcription,
                              "index.context.copyTranslation",
                            )
                          }
                        >
                          {t("index.context.copyTranslation") ||
                            "Copy Translation"}
                        </button>
                        <button
                          onClick={() =>
                            handleRequestTranslation(entry, activeConversation)
                          }
                          disabled={entry.translationPending}
                        >
                          {t("index.context.translate") || "Translate"}
                        </button>
                        <button
                          onClick={() =>
                            handleOptimizeEntry(entry, activeConversation)
                          }
                          disabled={
                            entry.optimizedPending ||
                            entry.transcriptionPending ||
                            !entry.transcription
                          }
                        >
                          {t("index.context.optimize") || "Formal Rewrite"}
                        </button>
                      </div>
                    </header>
                    <div className="entry-body">
                      <div className="entry-block">
                        <h4>{t("index.logTitle") || "Transcription"}</h4>
                        <p>{entry.transcription || "…"}</p>
                      </div>
                      <div className="entry-block">
                        <h4>
                          {t("index.context.copyTranslation") || "Translation"}
                        </h4>
                        <p>{entry.translation || "…"}</p>
                      </div>
                      {(entry.optimizedPending ||
                        entry.optimizedError ||
                        (entry.optimized && entry.optimized.trim())) && (
                        <div
                          className={cx("entry-block", "optimized", {
                            pending: entry.optimizedPending,
                            error: Boolean(entry.optimizedError),
                          })}
                        >
                          <div className="optimized-header">
                            <h4>
                              {t("index.optimized.label") || "Formal Rewrite"}
                            </h4>
                            {optimizationMetaText && (
                              <span className="optimized-meta">
                                {optimizationMetaText}
                              </span>
                            )}
                          </div>
                          <p>
                            {entry.optimizedPending
                              ? t("index.optimized.pending") ||
                                "Rewriting formally..."
                              : entry.optimizedError
                                ? entry.optimizedError
                                : entry.optimized || "…"}
                          </p>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="conversation-empty">
                {t("index.history.empty") || "No conversations yet"}
              </div>
            )}
          </section>

          <section className="log-panel">
            <header className="log-header">
              <h3>{t("index.logTitle") || "Real-Time Logs"}</h3>
              <div className="log-actions">
                <button onClick={handleExportLogs}>
                  {t("index.buttons.exportLogs") || "Export"}
                </button>
                <button onClick={handleCopyLatestResult}>
                  {t("index.buttons.copyLatest") || "Copy Latest"}
                </button>
                <button onClick={handleClearLogs}>
                  {t("index.buttons.clearLogs") || "Clear"}
                </button>
              </div>
            </header>
            <div className="log-body">
              {logs.length === 0 ? (
                <div className="log-empty">
                  {t("index.log.exportNoResults") || "No logs yet"}
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-entry ${log.level}`}>
                    <time>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </time>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
