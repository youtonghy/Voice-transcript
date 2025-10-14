import "./voice/VoiceInputWindow.css";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { getConfig, saveConfig, navigateToMain } from "../api";

type LanguageOption =
  | "Chinese"
  | "English"
  | "Japanese"
  | "Korean"
  | "Spanish"
  | "French"
  | "German"
  | "Italian"
  | "Portuguese"
  | "Russian"
  | "Arabic"
  | "Hindi"
  | "Thai"
  | "Vietnamese"
  | "Indonesian"
  | "Turkish"
  | "Dutch"
  | "Polish"
  | "Ukrainian"
  | "Czech";

type AppConfig = {
  voice_input_enabled?: boolean;
  voice_input_hotkey?: string;
  voice_input_engine?: string;
  voice_input_language?: string;
  voice_input_translate?: boolean;
  voice_input_translate_language?: string;
  recognition_engine?: string;
  transcribe_source?: string;
  translate_language?: string;
  app_language?: "en" | "zh" | "ja";
  [key: string]: unknown;
};

type VoiceConfig = {
  voice_input_enabled: boolean;
  voice_input_hotkey: string;
  voice_input_engine: string;
  voice_input_language: string;
  voice_input_translate: boolean;
  voice_input_translate_language: LanguageOption;
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voice_input_enabled: false,
  voice_input_hotkey: "F3",
  voice_input_engine: "openai",
  voice_input_language: "auto",
  voice_input_translate: false,
  voice_input_translate_language: "Chinese",
};

const AUTO_SAVE_DELAY = 600;
const LOAD_GUARD_TIMEOUT_MS = 5000;

const TRANSCRIPTION_LANGUAGE_OPTIONS = ["auto", "Chinese", "English"] as const;

const LANGUAGE_OPTIONS: LanguageOption[] = [
  "Chinese",
  "English",
  "Japanese",
  "Korean",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Russian",
  "Arabic",
  "Hindi",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Turkish",
  "Dutch",
  "Polish",
  "Ukrainian",
  "Czech",
];

const ENGINE_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "soniox", label: "Soniox" },
  { value: "qwen3-asr", label: "Qwen3-ASR (DashScope)" },
];

const LANGUAGE_ALIASES: Record<string, LanguageOption> = {
  chinese: "Chinese",
  zh: "Chinese",
  "zh-cn": "Chinese",
  english: "English",
  en: "English",
  japanese: "Japanese",
  ja: "Japanese",
  "ja-jp": "Japanese",
  korean: "Korean",
  ko: "Korean",
  spanish: "Spanish",
  es: "Spanish",
  french: "French",
  fr: "French",
  german: "German",
  de: "German",
  italian: "Italian",
  it: "Italian",
  portuguese: "Portuguese",
  pt: "Portuguese",
  russian: "Russian",
  ru: "Russian",
  arabic: "Arabic",
  ar: "Arabic",
  hindi: "Hindi",
  hi: "Hindi",
  thai: "Thai",
  th: "Thai",
  vietnamese: "Vietnamese",
  vi: "Vietnamese",
  indonesian: "Indonesian",
  id: "Indonesian",
  turkish: "Turkish",
  tr: "Turkish",
  dutch: "Dutch",
  nl: "Dutch",
  polish: "Polish",
  pl: "Polish",
  ukrainian: "Ukrainian",
  uk: "Ukrainian",
  czech: "Czech",
  cs: "Czech",
};

function normalizeLanguageAlias(
  value: unknown,
  fallback: LanguageOption = "Chinese",
): LanguageOption {
  if (typeof value !== "string") {
    return fallback;
  }
  const key = value.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? fallback;
}

function normalizeVoiceConfig(config: AppConfig | null): AppConfig & VoiceConfig {
  const merged: AppConfig & VoiceConfig = {
    ...DEFAULT_VOICE_CONFIG,
    ...(config || {}),
  };

  const engineFallback =
    (typeof config?.voice_input_engine === "string" &&
      config?.voice_input_engine.trim()) ||
    (typeof config?.recognition_engine === "string" &&
      config?.recognition_engine.trim()) ||
    (typeof config?.transcribe_source === "string" &&
      config?.transcribe_source.trim()) ||
    DEFAULT_VOICE_CONFIG.voice_input_engine;

  merged.voice_input_engine = engineFallback;
  merged.voice_input_hotkey =
    typeof config?.voice_input_hotkey === "string" &&
    config?.voice_input_hotkey.trim()
      ? config.voice_input_hotkey.trim().toUpperCase()
      : DEFAULT_VOICE_CONFIG.voice_input_hotkey;
  merged.voice_input_language =
    typeof config?.voice_input_language === "string" &&
    config?.voice_input_language.trim()
      ? config.voice_input_language
      : DEFAULT_VOICE_CONFIG.voice_input_language;
  merged.voice_input_translate_language = normalizeLanguageAlias(
    config?.voice_input_translate_language ??
      config?.translate_language ??
      DEFAULT_VOICE_CONFIG.voice_input_translate_language,
  );

  return merged;
}

export default function VoiceInputWindow({
  initialLanguage,
}: {
  initialLanguage: string;
}) {
  const { setLanguage, t } = useI18n();
  const [config, setConfig] = useState<(AppConfig & VoiceConfig) | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestConfig = useRef<(AppConfig & VoiceConfig) | null>(null);
  const isMounted = useRef(true);
  const loadGuardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      if (loadGuardTimer.current) {
        clearTimeout(loadGuardTimer.current);
        loadGuardTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setLanguage(initialLanguage as any);
  }, [initialLanguage, setLanguage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (loadGuardTimer.current) {
          clearTimeout(loadGuardTimer.current);
        }
        loadGuardTimer.current = setTimeout(() => {
          if (isMounted.current) {
            setLoading(false);
            setErrorMessage((prev) =>
              prev ??
              (t("voice.notify.loadFailed") || "Failed to load configuration"),
            );
          }
        }, LOAD_GUARD_TIMEOUT_MS);

        const raw = await getConfig<AppConfig>();
        if (cancelled || !isMounted.current) return;
        const normalized = normalizeVoiceConfig(raw);
        latestConfig.current = normalized;
        setConfig(normalized);
        if (normalized.app_language) {
          setLanguage(normalized.app_language as any);
        }
      } catch (error) {
        if (!isMounted.current || cancelled) return;
        setErrorMessage(
          `${t("voice.notify.loadFailed") || "Failed to load configuration"}: ${
            (error as Error).message || error
          }`,
        );
      } finally {
        if (loadGuardTimer.current) {
          clearTimeout(loadGuardTimer.current);
          loadGuardTimer.current = null;
        }
        if (!isMounted.current || cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLanguage, t]);

  const scheduleSave = useCallback(
    (nextConfig: AppConfig & VoiceConfig) => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      autoSaveTimer.current = setTimeout(async () => {
        try {
          await saveConfig(nextConfig);
          if (!isMounted.current) {
            return;
          }
          setSaving(false);
          setSuccessMessage(t("settings.notify.saved") || "Saved");
          autoSaveTimer.current = null;
          setTimeout(() => {
            if (isMounted.current) {
              setSuccessMessage(null);
            }
          }, 2000);
        } catch (error) {
          if (!isMounted.current) {
            return;
          }
          setSaving(false);
          autoSaveTimer.current = null;
          setErrorMessage(
            `${t("voice.notify.saveFailed") || "Save failed"}: ${
              (error as Error).message || error
            }`,
          );
        }
      }, AUTO_SAVE_DELAY);
    },
    [t],
  );

  const updateConfig = useCallback(
    (patch: Partial<VoiceConfig>) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        latestConfig.current = next;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleToggle =
    (key: keyof VoiceConfig) => (event: ChangeEvent<HTMLInputElement>) => {
      const value =
        key === "voice_input_enabled" || key === "voice_input_translate"
          ? event.target.checked
          : event.target.value;
      updateConfig({ [key]: value } as Partial<VoiceConfig>);
    };

  const handleSelect =
    (key: keyof VoiceConfig) => (event: ChangeEvent<HTMLSelectElement>) => {
      updateConfig({ [key]: event.target.value } as Partial<VoiceConfig>);
    };

  const handleHotkeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateConfig({
      voice_input_hotkey: event.target.value.toUpperCase(),
    });
  };

  const handleHotkeyBlur = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value.trim()) {
      updateConfig({
        voice_input_hotkey: DEFAULT_VOICE_CONFIG.voice_input_hotkey,
      });
    }
  };

  const statusText = useMemo(() => {
    if (errorMessage) return errorMessage;
    if (isSaving) {
      return t("settings.notify.saveInProgress") || "Saving...";
    }
    if (successMessage) {
      return successMessage;
    }
    return "";
  }, [errorMessage, isSaving, successMessage, t]);

  const statusClass = errorMessage
    ? "status-error"
    : isSaving
      ? "status-saving"
      : successMessage
        ? "status-success"
        : "";

  const translateEnabled = config?.voice_input_translate ?? false;

  return (
    <div className="voice-window">
      <header className="voice-nav">
        <div className="voice-nav-content">
          <button className="voice-back" onClick={() => navigateToMain()}>
            <span className="voice-back-icon">←</span>
            <span>{t("common.backLink") || "Back"}</span>
          </button>
          <div className="voice-title">
            {t("voice.nav.title") || "Voice Input Settings"}
          </div>
          <div className={`voice-status ${statusClass}`}>
            {statusText}
          </div>
        </div>
      </header>

      <main className="voice-main">
        <section className="voice-panel">
          <h1 className="voice-section-title">
            {t("voice.section.title") || "Voice Input"}
          </h1>
          {isLoading ? (
            <div className="voice-loading">
              {t("voice.notify.loading") || "Loading configuration..."}
            </div>
          ) : !config ? (
            <div className="voice-error">
              {errorMessage ||
                t("voice.notify.loadFailed") ||
                "Failed to load configuration"}
            </div>
          ) : (
            <>
              <div className="voice-form-group voice-checkbox">
                <input
                  id="voiceInputEnabled"
                  type="checkbox"
                  checked={config?.voice_input_enabled ?? false}
                  onChange={handleToggle("voice_input_enabled")}
                />
                <label htmlFor="voiceInputEnabled">
                  {t("voice.fields.enable") ||
                    "Enable voice input (press once to start, press again to stop)"}
                </label>
              </div>

              <div className="voice-grid">
                <div className="voice-form-group">
                  <label htmlFor="voiceInputHotkey">
                    {t("voice.fields.hotkey") || "Hotkey"}
                  </label>
                  <input
                    id="voiceInputHotkey"
                    type="text"
                    value={config?.voice_input_hotkey ?? ""}
                    placeholder={t("voice.placeholders.hotkey") || "e.g. F3 or A"}
                    onChange={handleHotkeyChange}
                    onBlur={handleHotkeyBlur}
                  />
                  <div className="voice-note">
                    {t("voice.notes.hotkey") || "Supports F1-F24, A-Z, 0-9"}
                  </div>
                </div>

                <div className="voice-form-group">
                  <label htmlFor="voiceInputEngine">
                    {t("voice.fields.engine") || "Transcription Engine"}
                  </label>
                  <select
                    id="voiceInputEngine"
                    value={config?.voice_input_engine ?? "openai"}
                    onChange={handleSelect("voice_input_engine")}
                  >
                    {ENGINE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="voice-form-group">
                  <label htmlFor="voiceInputLanguage">
                    {t("voice.fields.language") || "Transcription Language"}
                  </label>
                  <select
                    id="voiceInputLanguage"
                    value={config?.voice_input_language ?? "auto"}
                    onChange={handleSelect("voice_input_language")}
                  >
                    {TRANSCRIPTION_LANGUAGE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value === "auto"
                          ? t("settings.options.autoDetect") || "Auto Detect"
                          : value}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="voice-form-group voice-checkbox-row">
                  <div className="voice-checkbox-inline">
                    <input
                      id="voiceInputTranslate"
                      type="checkbox"
                      checked={translateEnabled}
                      onChange={handleToggle("voice_input_translate")}
                    />
                    <label htmlFor="voiceInputTranslate">
                      {t("voice.fields.insertTranslation") ||
                        "Insert translation after completion"}
                    </label>
                  </div>
                  {translateEnabled ? (
                    <div className="voice-note" id="tlNote">
                      {t("voice.fields.insertNote") ||
                        "If enabled, the translation will be inserted after stopping."}
                    </div>
                  ) : null}
                </div>

                {translateEnabled ? (
                  <div className="voice-form-group">
                    <label htmlFor="voiceInputTranslateLanguage">
                      {t("voice.fields.translateLanguage") ||
                        "Translation Target Language"}
                    </label>
                    <select
                      id="voiceInputTranslateLanguage"
                      value={config?.voice_input_translate_language ?? "Chinese"}
                      onChange={handleSelect("voice_input_translate_language")}
                    >
                      {LANGUAGE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
