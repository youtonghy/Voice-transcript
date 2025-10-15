import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig } from "../types";
import "./SettingsDrawer.css";

interface SettingsDrawerProps {
  open: boolean;
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onSave: () => void;
  onClose: () => void;
  busy?: boolean;
}

const KEY_FIELDS: Array<{ key: keyof AppConfig; labelKey: string; placeholderKey?: string }> = [
  { key: "openai_api_key", labelKey: "settings.credentials.openaiApiKey" },
  {
    key: "openai_base_url",
    labelKey: "settings.credentials.openaiBaseUrl",
    placeholderKey: "settings.placeholders.openaiBaseUrl",
  },
  { key: "gemini_api_key", labelKey: "settings.credentials.geminiApiKey" },
  { key: "soniox_api_key", labelKey: "settings.credentials.sonioxApiKey" },
  { key: "dashscope_api_key", labelKey: "settings.credentials.dashscopeApiKey" },
];

const MODEL_FIELDS: Array<{ key: keyof AppConfig; labelKey: string }> = [
  { key: "openai_transcribe_model", labelKey: "settings.models.openaiTranscribe" },
  { key: "openai_translate_model", labelKey: "settings.models.openaiTranslate" },
  { key: "openai_summary_model", labelKey: "settings.models.openaiSummary" },
  { key: "openai_optimize_model", labelKey: "settings.models.openaiOptimize" },
  { key: "gemini_translate_model", labelKey: "settings.models.geminiTranslate" },
  { key: "gemini_summary_model", labelKey: "settings.models.geminiSummary" },
  { key: "gemini_optimize_model", labelKey: "settings.models.geminiOptimize" },
  { key: "qwen3_asr_model", labelKey: "settings.models.qwenAsr" },
];

export function SettingsDrawer({
  open,
  config,
  onChange,
  onSave,
  onClose,
  busy,
}: SettingsDrawerProps) {
  const { t } = useTranslation();
  const className = useMemo(
    () => `settings-drawer ${open ? "open" : ""}`,
    [open],
  );

  return (
    <aside className={className}>
      <header>
        <div>
          <h2>{t("settings.title")}</h2>
          <p>{t("settings.subtitle")}</p>
        </div>
        <button type="button" onClick={onClose}>
          {t("settings.close")}
        </button>
      </header>
      <div className="settings-content">
        <section>
          <h3>{t("settings.sections.credentials")}</h3>
          <div className="settings-grid">
            {KEY_FIELDS.map((field) => (
              <label key={field.key} className="settings-field">
                <span>{t(field.labelKey)}</span>
                <input
                  type="password"
                  value={config[field.key] as string}
                  placeholder={
                    field.placeholderKey ? t(field.placeholderKey) : undefined
                  }
                  onChange={(event) =>
                    onChange({ [field.key]: event.target.value } as Partial<AppConfig>)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>{t("settings.sections.models")}</h3>
          <div className="settings-grid">
            {MODEL_FIELDS.map((field) => (
              <label key={field.key} className="settings-field">
                <span>{t(field.labelKey)}</span>
                <input
                  type="text"
                  value={config[field.key] as string}
                  onChange={(event) =>
                    onChange({ [field.key]: event.target.value } as Partial<AppConfig>)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>{t("settings.sections.language")}</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>{t("settings.language.defaultTranslateLanguage")}</span>
              <input
                type="text"
                value={config.translate_language}
                onChange={(event) => onChange({ translate_language: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.language.transcribeLanguage")}</span>
              <input
                type="text"
                value={config.transcribe_language}
                onChange={(event) => onChange({ transcribe_language: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.language.silenceThreshold")}</span>
              <input
                type="number"
                step="0.001"
                value={config.silence_rms_threshold}
                onChange={(event) =>
                  onChange({
                    silence_rms_threshold: Number(event.target.value) || 0.01,
                  })
                }
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.language.minSilence")}</span>
              <input
                type="number"
                step="0.1"
                value={config.min_silence_seconds}
                onChange={(event) =>
                  onChange({
                    min_silence_seconds: Number(event.target.value) || 0.5,
                  })
                }
              />
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={config.enable_translation}
                onChange={(event) => onChange({ enable_translation: event.target.checked })}
              />
              <span>{t("settings.language.enableTranslation")}</span>
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={config.voice_input_translate}
                onChange={(event) =>
                  onChange({ voice_input_translate: event.target.checked })
                }
              />
              <span>{t("settings.language.translateVoiceInput")}</span>
            </label>
          </div>
        </section>
      </div>
      <footer>
        <button type="button" onClick={onSave} disabled={busy}>
          {t("settings.save")}
        </button>
      </footer>
    </aside>
  );
}
