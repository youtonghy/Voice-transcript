import "./settings/SettingsWindow.css";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { getConfig, saveConfig } from "../api";

type LanguageOption = "en" | "zh" | "ja";

type AppConfig = {
  recognition_engine: string;
  translation_engine: string;
  summary_engine: string;
  optimize_engine: string;
  transcribe_source: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_transcribe_model: string;
  openai_translate_model: string;
  openai_summary_model: string;
  openai_optimize_model: string;
  gemini_api_key: string;
  gemini_translate_model: string;
  gemini_summary_model: string;
  gemini_optimize_model: string;
  gemini_translate_system_prompt: string;
  soniox_api_key: string;
  dashscope_api_key: string;
  qwen3_asr_model: string;
  enable_translation: boolean;
  translation_mode: "fixed" | "smart";
  translate_language: string;
  smart_language1: string;
  smart_language2: string;
  transcribe_language: string;
  silence_rms_threshold: number;
  min_silence_seconds: number;
  theater_mode: boolean;
  app_language: LanguageOption;
};

type SettingsSection =
  | "engine"
  | "transcription"
  | "translation"
  | "recording"
  | "interface";

const DEFAULT_SECTION: SettingsSection = "engine";
const AUTO_SAVE_DELAY = 800;
const LANGUAGE_PRESETS = [
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
] as const;

const DEFAULT_CONFIG: AppConfig = {
  recognition_engine: "openai",
  translation_engine: "openai",
  summary_engine: "openai",
  optimize_engine: "openai",
  transcribe_source: "openai",
  openai_api_key: "",
  openai_base_url: "",
  openai_transcribe_model: "gpt-4o-transcribe",
  openai_translate_model: "gpt-4o-mini",
  openai_summary_model: "gpt-4o-mini",
  openai_optimize_model: "gpt-4o-mini",
  gemini_api_key: "",
  gemini_translate_model: "gemini-2.0-flash",
  gemini_summary_model: "gemini-2.0-flash",
  gemini_optimize_model: "gemini-2.0-flash",
  gemini_translate_system_prompt: "",
  soniox_api_key: "",
  dashscope_api_key: "",
  qwen3_asr_model: "qwen3-asr-flash",
  enable_translation: true,
  translation_mode: "fixed",
  translate_language: "Chinese",
  smart_language1: "Chinese",
  smart_language2: "English",
  transcribe_language: "auto",
  silence_rms_threshold: 0.01,
  min_silence_seconds: 1.0,
  theater_mode: false,
  app_language: "en",
};

function normaliseConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(config || {}),
  };
}

function getHashSection(): SettingsSection {
  const hash = (window.location.hash || "").replace(/^#/, "");
  const available: SettingsSection[] = [
    "engine",
    "transcription",
    "translation",
    "recording",
    "interface",
  ];
  if (available.includes(hash as SettingsSection)) {
    return hash as SettingsSection;
  }
  return DEFAULT_SECTION;
}

export default function SettingsWindow({
  initialLanguage,
}: {
  initialLanguage: string;
}) {
  const { setLanguage, t } = useI18n();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedSection, setSelectedSection] =
    useState<SettingsSection>(getHashSection);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestConfig = useRef<AppConfig | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    setLanguage(initialLanguage as any);
  }, [initialLanguage, setLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleHashChange = () => {
      setSelectedSection(getHashSection());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const current = await getConfig<AppConfig>();
        const normalized = normaliseConfig(current);
        if (!isMountedRef.current) return;
        latestConfig.current = normalized;
        setConfig(normalized);
        setLanguage(normalized.app_language as LanguageOption);
      } catch (error) {
        if (!isMountedRef.current) return;
        console.error(error);
        setErrorMessage(
          `${t("settings.notify.loadFailed") || "Failed to load configuration"}`,
        );
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [setLanguage, t]);

  const scheduleSave = useCallback(
    (nextConfig: AppConfig) => {
      latestConfig.current = nextConfig;
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      autoSaveTimer.current = setTimeout(async () => {
        if (!latestConfig.current) {
          setSaving(false);
          return;
        }
        try {
          await saveConfig(latestConfig.current);
          if (!isMountedRef.current) return;
          setSuccessMessage(
            t("settings.notify.saved") || "Settings saved",
          );
        } catch (error) {
          if (!isMountedRef.current) return;
          const message =
            error instanceof Error ? error.message : String(error);
          setErrorMessage(
            `${t("settings.notify.saveFailed") || "Save failed"}: ${message}`,
          );
        } finally {
          if (isMountedRef.current) {
            setSaving(false);
          }
        }
      }, AUTO_SAVE_DELAY);
    },
    [t],
  );

  const updateConfig = useCallback(
    (updater: (current: AppConfig) => AppConfig) => {
      setConfig((prev) => {
        const base = prev ?? normaliseConfig(null);
        const nextConfig = updater(base);
        scheduleSave(nextConfig);
        return nextConfig;
      });
    },
    [scheduleSave],
  );

  const handleSelectChange = useCallback(
    (
      event: ChangeEvent<HTMLSelectElement>,
      key: keyof AppConfig,
      transform: (value: string) => any = (value) => value,
    ) => {
      const value = transform(event.target.value);
      updateConfig((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [updateConfig],
  );

  const handleInputChange = useCallback(
    (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      key: keyof AppConfig,
      transform: (value: string) => any = (value) => value,
    ) => {
      const value = transform(event.target.value);
      updateConfig((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [updateConfig],
  );

  const handleCheckboxChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>, key: keyof AppConfig) => {
      const value = event.target.checked;
      updateConfig((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [updateConfig],
  );

  const handleTranslationToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked;
      updateConfig((current) => ({
        ...current,
        enable_translation: enabled,
      }));
    },
    [updateConfig],
  );

  const handleTargetLanguageChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      updateConfig((current) => {
        if (value === "__custom__") {
          return {
            ...current,
            translate_language:
              current.translate_language && !LANGUAGE_PRESETS.includes(current.translate_language as any)
                ? current.translate_language
                : "",
          };
        }
        return {
          ...current,
          translate_language: value,
        };
      });
    },
    [updateConfig],
  );

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const effectiveConfig = config;
  const selectedConfig = effectiveConfig ?? DEFAULT_CONFIG;

  const translationEnabled = selectedConfig.enable_translation !== false;
  const translationMode = selectedConfig.translation_mode || "fixed";
  const usingCustomLanguage =
    selectedConfig.translate_language &&
    !LANGUAGE_PRESETS.includes(
      selectedConfig.translate_language as (typeof LANGUAGE_PRESETS)[number],
    );
  const targetLanguageValue = usingCustomLanguage
    ? "__custom__"
    : selectedConfig.translate_language || "Chinese";

  const recognitionEngine = selectedConfig.recognition_engine || "openai";
  const translationEngine = selectedConfig.translation_engine || "openai";
  const summaryEngine = selectedConfig.summary_engine || translationEngine;
  const optimizeEngine = selectedConfig.optimize_engine || summaryEngine;

  const showSoniox = recognitionEngine === "soniox";
  const showDashscope = recognitionEngine === "dashscope";
  const showGeminiTranslation = translationEngine === "gemini";
  const showGeminiSummary = summaryEngine === "gemini";
  const showGeminiOptimize = optimizeEngine === "gemini";
  const showOpenAIFields =
    recognitionEngine === "openai" ||
    translationEngine === "openai" ||
    summaryEngine === "openai" ||
    optimizeEngine === "openai";

  const sectionItems: Array<{
    id: SettingsSection;
    label: string;
    icon: string;
  }> = [
    { id: "engine", label: t("settings.sidebar.engine") || "Engine", icon: "⚙️" },
    {
      id: "transcription",
      label: t("settings.sidebar.transcription") || "Transcription",
      icon: "📝",
    },
    {
      id: "translation",
      label: t("settings.sidebar.translation") || "Translation",
      icon: "🌐",
    },
    {
      id: "recording",
      label: t("settings.sidebar.recording") || "Recording",
      icon: "🎙",
    },
    {
      id: "interface",
      label: t("settings.sidebar.interface") || "Interface",
      icon: "🌈",
    },
  ];

  const handleSectionSelect = useCallback((section: SettingsSection) => {
    setSelectedSection(section);
    try {
      window.location.hash = section;
    } catch (_) {
      // ignore
    }
  }, []);

  const closeWindow = useCallback(() => {
    window.close();
  }, []);

  const numericInput =
    (key: keyof AppConfig, fallback: number, decimals = 3) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = parseFloat(event.target.value);
      const value = Number.isFinite(parsed) ? parsed : fallback;
      updateConfig((current) => ({
        ...current,
        [key]: value,
      }));
      if (!Number.isFinite(parsed)) {
        event.target.value = value.toFixed(decimals);
      }
    };

  const renderEngineSection = () => (
    <section className="settings-section active" data-section="engine">
      <div className="section-header">
        <h2 className="section-title" data-section-key="recognition">
          {t("settings.section.recognitionEngine") || "Recognition Engine"}
        </h2>
        <p className="section-description">
          {t("settings.notes.recognitionEngine") ||
            "Choose the provider for speech recognition (transcription)."}
        </p>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="recognitionEngine">
            {t("settings.labels.recognitionEngine") || "Recognition Engine"}
          </label>
          <select
            id="recognitionEngine"
            value={recognitionEngine}
            onChange={(event) =>
              handleSelectChange(event, "recognition_engine")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="soniox">Soniox</option>
            <option value="dashscope">DashScope (Qwen3-ASR)</option>
          </select>
          <p className="form-note">
            {t("settings.notes.recognitionEngine") ||
              "Choose the provider for speech recognition (transcription)."}
          </p>
        </div>
        {showSoniox && (
          <div className="form-field">
            <label htmlFor="sonioxApiKey">
              {t("settings.labels.sonioxApiKey") || "Soniox API Key"}
            </label>
            <input
              id="sonioxApiKey"
              type="password"
              value={selectedConfig.soniox_api_key}
              onChange={(event) =>
                handleInputChange(event, "soniox_api_key")
              }
            />
            <p className="form-note">
              {t("settings.notes.sonioxApiKey") ||
                "Required when the recognition engine is Soniox."}
            </p>
          </div>
        )}
        {showDashscope && (
          <>
            <div className="form-field">
              <label htmlFor="dashscopeApiKey">
                {t("settings.labels.dashscopeApiKey") || "DashScope API Key"}
              </label>
              <input
                id="dashscopeApiKey"
                type="password"
                value={selectedConfig.dashscope_api_key}
                onChange={(event) =>
                  handleInputChange(event, "dashscope_api_key")
                }
              />
              <p className="form-note">
                {t("settings.notes.dashscopeApiKey") ||
                  "Qwen3-ASR requires a DashScope API key."}
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="qwen3AsrModel">
                {t("settings.labels.qwen3AsrModel") || "Qwen3-ASR Model"}
              </label>
              <input
                id="qwen3AsrModel"
                value={selectedConfig.qwen3_asr_model}
                onChange={(event) =>
                  handleInputChange(event, "qwen3_asr_model")
                }
              />
              <p className="form-note">
                {t("settings.notes.qwen3AsrModel") ||
                  "Default is qwen3-asr-flash; change if needed."}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="section-divider" />

      <div className="section-header">
        <h2
          className="section-title"
          data-section-key="translationEngine"
        >
          {t("settings.section.translationEngine") || "Translation Engine"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="translationEngine">
            {t("settings.labels.translationEngine") || "Translation Engine"}
          </label>
          <select
            id="translationEngine"
            value={translationEngine}
            onChange={(event) =>
              handleSelectChange(event, "translation_engine")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        {showGeminiTranslation ? (
          <>
            <div className="form-field">
              <label htmlFor="geminiApiKey">
                {t("settings.labels.geminiApiKey") || "Gemini API Key"}
              </label>
              <input
                id="geminiApiKey"
                type="password"
                value={selectedConfig.gemini_api_key}
                onChange={(event) =>
                  handleInputChange(event, "gemini_api_key")
                }
              />
              <p className="form-note">
                {t("settings.notes.geminiApiKey") ||
                  "Stored locally for translation."}
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="geminiTranslateModel">
                {t("settings.labels.geminiTranslateModel") || "Gemini Model"}
              </label>
              <input
                id="geminiTranslateModel"
                value={selectedConfig.gemini_translate_model}
                onChange={(event) =>
                  handleInputChange(event, "gemini_translate_model")
                }
              />
            </div>
          </>
        ) : (
          <div className="form-field">
            <label htmlFor="openaiTranslateModel">
              {t("settings.labels.openaiTranslateModel") || "Translate Model"}
            </label>
            <input
              id="openaiTranslateModel"
              value={selectedConfig.openai_translate_model}
              onChange={(event) =>
                handleInputChange(event, "openai_translate_model")
              }
            />
          </div>
        )}
      </div>

      <div className="section-divider" />

      <div className="section-header">
        <h2
          className="section-title"
          data-section-key="summaryEngine"
        >
          {t("settings.section.summaryEngine") || "Summary Engine"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="summaryEngine">
            {t("settings.labels.summaryEngine") || "Summary Engine"}
          </label>
          <select
            id="summaryEngine"
            value={summaryEngine}
            onChange={(event) =>
              handleSelectChange(event, "summary_engine")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        {showGeminiSummary ? (
          <div className="form-field">
            <label htmlFor="geminiSummaryModel">
              {t("settings.labels.geminiSummaryModel") || "Gemini Summary Model"}
            </label>
            <input
              id="geminiSummaryModel"
              value={selectedConfig.gemini_summary_model}
              onChange={(event) =>
                handleInputChange(event, "gemini_summary_model")
              }
            />
          </div>
        ) : (
          <div className="form-field">
            <label htmlFor="openaiSummaryModel">
              {t("settings.labels.openaiSummaryModel") || "Summary Model"}
            </label>
            <input
              id="openaiSummaryModel"
              value={selectedConfig.openai_summary_model}
              onChange={(event) =>
                handleInputChange(event, "openai_summary_model")
              }
            />
          </div>
        )}
      </div>

      <div className="section-divider" />

      <div className="section-header">
        <h2
          className="section-title"
          data-section-key="optimizeEngine"
        >
          {t("settings.section.optimizeEngine") || "Optimize Engine"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="optimizeEngine">
            {t("settings.labels.optimizeEngine") || "Optimize Engine"}
          </label>
          <select
            id="optimizeEngine"
            value={optimizeEngine}
            onChange={(event) =>
              handleSelectChange(event, "optimize_engine")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        {showGeminiOptimize ? (
          <div className="form-field">
            <label htmlFor="geminiOptimizeModel">
              {t("settings.labels.geminiOptimizeModel") || "Gemini Optimize Model"}
            </label>
            <input
              id="geminiOptimizeModel"
              value={selectedConfig.gemini_optimize_model}
              onChange={(event) =>
                handleInputChange(event, "gemini_optimize_model")
              }
            />
          </div>
        ) : (
          <div className="form-field">
            <label htmlFor="openaiOptimizeModel">
              {t("settings.labels.openaiOptimizeModel") || "Optimize Model"}
            </label>
            <input
              id="openaiOptimizeModel"
              value={selectedConfig.openai_optimize_model}
              onChange={(event) =>
                handleInputChange(event, "openai_optimize_model")
              }
            />
          </div>
        )}
      </div>
    </section>
  );

  const renderTranscriptionSection = () => (
    <section className="settings-section active" data-section="transcription">
      <div className="section-header">
        <h2 className="section-title" data-section-key="transcription">
          {t("settings.section.transcription") || "Transcription Settings"}
        </h2>
      </div>
      <div className="form-grid">
        {showOpenAIFields && (
          <>
            <div className="form-field">
              <label htmlFor="apiKey">
                {t("settings.labels.apiKey") || "OpenAI API Key"}
              </label>
              <input
                id="apiKey"
                type="password"
                value={selectedConfig.openai_api_key}
                onChange={(event) =>
                  handleInputChange(event, "openai_api_key")
                }
              />
              <p className="form-note">
                {t("settings.notes.apiKey") ||
                  "Saved locally; shared across services."}
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="apiUrl">
                {t("settings.labels.apiUrl") || "API Base URL (optional)"}
              </label>
              <input
                id="apiUrl"
                value={selectedConfig.openai_base_url}
                onChange={(event) =>
                  handleInputChange(event, "openai_base_url")
                }
              />
              <p className="form-note">
                {t("settings.notes.apiUrl") ||
                  "Leave empty to use default; include /v1 for custom endpoints."}
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="openaiTranscribeModel">
                {t("settings.labels.openaiTranscribeModel") ||
                  "OpenAI Transcribe Model"}
              </label>
              <input
                id="openaiTranscribeModel"
                value={selectedConfig.openai_transcribe_model}
                onChange={(event) =>
                  handleInputChange(event, "openai_transcribe_model")
                }
              />
            </div>
          </>
        )}
        <div className="form-field">
          <label htmlFor="transcribeLanguage">
            {t("settings.labels.transcribeLanguage") ||
              "Transcription Language"}
          </label>
          <select
            id="transcribeLanguage"
            value={selectedConfig.transcribe_language}
            onChange={(event) =>
              handleSelectChange(event, "transcribe_language")
            }
          >
            <option value="auto">
              {t("settings.options.autoDetect") || "Auto Detect"}
            </option>
            <option value="English">English</option>
            <option value="Chinese">Chinese</option>
            <option value="Japanese">Japanese</option>
            <option value="Korean">Korean</option>
            <option value="Spanish">Spanish</option>
            <option value="French">French</option>
          </select>
          <p className="form-note">
            {t("settings.notes.transcribeLanguage") ||
              "Selecting a language adds a hint to the transcription model."}
          </p>
        </div>
      </div>
    </section>
  );

  const renderTranslationSection = () => (
    <section className="settings-section active" data-section="translation">
      <div className="section-header">
        <h2 className="section-title" data-section-key="translation">
          {t("settings.section.translation") || "Translation Settings"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field checkbox">
          <label htmlFor="enableTranslation">
            <input
              id="enableTranslation"
              type="checkbox"
              checked={translationEnabled}
              onChange={handleTranslationToggle}
            />
            <span>
              {t("settings.labels.enableTranslation") ||
                "Enable Auto Translation"}
            </span>
          </label>
        </div>
        {translationEnabled && (
          <>
            <div className="form-field">
              <label htmlFor="translationMode">
                {t("settings.labels.translationMode") || "Translation Mode"}
              </label>
              <select
                id="translationMode"
                value={translationMode}
                onChange={(event) =>
                  handleSelectChange(
                    event,
                    "translation_mode",
                    (value) => value as AppConfig["translation_mode"],
                  )
                }
              >
                <option value="fixed">
                  {t("settings.translationMode.option.fixed") ||
                    "Fixed Translation"}
                </option>
                <option value="smart">
                  {t("settings.translationMode.option.smart") ||
                    "Smart Translation"}
                </option>
              </select>
              <p className="form-note">
                {t("settings.notes.translationMode") ||
                  "Fixed: always translate to the target language. Smart: better for bilingual conversations."}
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="targetLanguage">
                {t("settings.labels.targetLanguage") || "Target Language"}
              </label>
              <select
                id="targetLanguage"
                value={targetLanguageValue}
                onChange={handleTargetLanguageChange}
              >
                {LANGUAGE_PRESETS.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {usingCustomLanguage && (
                <input
                  id="customLanguage"
                  className="custom-language-input"
                  value={selectedConfig.translate_language}
                  onChange={(event) =>
                    handleInputChange(event, "translate_language")
                  }
                  placeholder={
                    t("settings.placeholders.customLanguage") ||
                    "Enter a custom language"
                  }
                />
              )}
            </div>
            {translationMode === "smart" && (
              <>
                <div className="form-field">
                  <label htmlFor="language1">
                    {t("settings.labels.language1") || "Language 1"}
                  </label>
                  <input
                    id="language1"
                    value={selectedConfig.smart_language1}
                    onChange={(event) =>
                      handleInputChange(event, "smart_language1")
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="language2">
                    {t("settings.labels.language2") || "Language 2"}
                  </label>
                  <input
                    id="language2"
                    value={selectedConfig.smart_language2}
                    onChange={(event) =>
                      handleInputChange(event, "smart_language2")
                    }
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );

  const renderRecordingSection = () => (
    <section className="settings-section active" data-section="recording">
      <div className="section-header">
        <h2 className="section-title" data-section-key="recording">
          {t("settings.section.recording") || "Recording Settings"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="silenceThreshold">
            {t("settings.labels.silenceThreshold") || "Silence Threshold"}
          </label>
          <input
            id="silenceThreshold"
            type="number"
            step="0.001"
            value={selectedConfig.silence_rms_threshold.toFixed(3)}
            onChange={numericInput("silence_rms_threshold", 0.01)}
          />
          <p className="form-note">
            {t("settings.notes.silenceThreshold") ||
              "Smaller is more sensitive. Recommended: 0.005 – 0.02."}
          </p>
        </div>
        <div className="form-field">
          <label htmlFor="silenceDuration">
            {t("settings.labels.silenceDuration") ||
              "Silence Split Duration (seconds)"}
          </label>
          <input
            id="silenceDuration"
            type="number"
            step="0.1"
            value={selectedConfig.min_silence_seconds.toFixed(1)}
            onChange={numericInput("min_silence_seconds", 1, 1)}
          />
          <p className="form-note">
            {t("settings.notes.silenceDuration") ||
              "Split when continuous silence exceeds this duration."}
          </p>
        </div>
        <div className="form-field checkbox">
          <label htmlFor="theaterMode">
            <input
              id="theaterMode"
              type="checkbox"
              checked={selectedConfig.theater_mode}
              onChange={(event) => handleCheckboxChange(event, "theater_mode")}
            />
            <span>{t("settings.labels.theaterMode") || "Theater Mode"}</span>
          </label>
          <p className="form-note">
            {t("settings.notes.theaterMode") ||
              "Amplify quiet audio to improve recognition."}
          </p>
        </div>
      </div>
    </section>
  );

  const renderInterfaceSection = () => (
    <section className="settings-section active" data-section="interface">
      <div className="section-header">
        <h2 className="section-title" data-section-key="interface">
          {t("settings.section.interfaceLanguage") || "Interface Language"}
        </h2>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="appLanguage">
            {t("settings.labels.appLanguage") || "Choose Language"}
          </label>
          <select
            id="appLanguage"
            value={selectedConfig.app_language}
            onChange={(event) =>
              handleSelectChange(
                event,
                "app_language",
                (value) => value as LanguageOption,
              )
            }
          >
            <option value="en">English</option>
            <option value="zh">简体中文</option>
            <option value="ja">日本語</option>
          </select>
          <p className="form-note">
            {t("settings.notes.appLanguage") ||
              "Changes take effect immediately and are saved to your configuration."}
          </p>
        </div>
      </div>
    </section>
  );

  if (isLoading || !effectiveConfig) {
    return (
      <div className="settings-window">
        <div className="settings-loading">
          <div className="spinner" />
          <span>{t("settings.nav.title") || "Settings"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-window">
      <header className="settings-nav">
        <div className="nav-content">
          <button className="back-btn" onClick={closeWindow}>
            <span className="back-btn-icon">←</span>
            <span>{t("common.backNav") || "Back"}</span>
          </button>
          <div className="nav-title">
            {t("settings.nav.title") || "Settings"}
          </div>
          <div className="nav-status">
            {isSaving ? (
              <span className="status-saving">
                {t("settings.notify.saveInProgress") || "Saving…"}
              </span>
            ) : successMessage ? (
              <span className="status-success">{successMessage}</span>
            ) : errorMessage ? (
              <span className="status-error">{errorMessage}</span>
            ) : null}
          </div>
        </div>
      </header>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="sidebar-title">
            {t("settings.sidebar.title") || "Configuration"}
          </div>
          <nav className="sidebar-nav">
            {sectionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cx("sidebar-item", {
                  active: selectedSection === item.id,
                })}
                onClick={() => handleSectionSelect(item.id)}
              >
                <span className="sidebar-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="settings-content">
          {selectedSection === "engine" && renderEngineSection()}
          {selectedSection === "transcription" && renderTranscriptionSection()}
          {selectedSection === "translation" && renderTranslationSection()}
          {selectedSection === "recording" && renderRecordingSection()}
          {selectedSection === "interface" && renderInterfaceSection()}
        </main>
      </div>
    </div>
  );
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
        if (active) {
          tokens.push(key);
        }
      });
    }
  });
  return tokens.join(" ");
}
