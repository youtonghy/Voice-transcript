import { useMemo } from "react";
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

const KEY_FIELDS: Array<{ key: keyof AppConfig; label: string; placeholder?: string } > = [
  { key: "openai_api_key", label: "OpenAI API Key" },
  { key: "openai_base_url", label: "OpenAI Base URL", placeholder: "https://api.openai.com" },
  { key: "gemini_api_key", label: "Gemini API Key" },
  { key: "soniox_api_key", label: "Soniox API Key" },
  { key: "dashscope_api_key", label: "DashScope API Key" },
];

const MODEL_FIELDS: Array<{ key: keyof AppConfig; label: string }> = [
  { key: "openai_transcribe_model", label: "OpenAI Transcribe Model" },
  { key: "openai_translate_model", label: "OpenAI Translate Model" },
  { key: "openai_summary_model", label: "OpenAI Summary Model" },
  { key: "openai_optimize_model", label: "OpenAI Optimize Model" },
  { key: "gemini_translate_model", label: "Gemini Translate Model" },
  { key: "gemini_summary_model", label: "Gemini Summary Model" },
  { key: "gemini_optimize_model", label: "Gemini Optimize Model" },
  { key: "qwen3_asr_model", label: "Qwen ASR Model" },
];

export function SettingsDrawer({
  open,
  config,
  onChange,
  onSave,
  onClose,
  busy,
}: SettingsDrawerProps) {
  const className = useMemo(
    () => `settings-drawer ${open ? "open" : ""}`,
    [open],
  );

  return (
    <aside className={className}>
      <header>
        <div>
          <h2>Settings</h2>
          <p>Configure engines, prompts, and language preferences.</p>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="settings-content">
        <section>
          <h3>Credentials</h3>
          <div className="settings-grid">
            {KEY_FIELDS.map((field) => (
              <label key={field.key} className="settings-field">
                <span>{field.label}</span>
                <input
                  type="password"
                  value={config[field.key] as string}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    onChange({ [field.key]: event.target.value } as Partial<AppConfig>)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>Models</h3>
          <div className="settings-grid">
            {MODEL_FIELDS.map((field) => (
              <label key={field.key} className="settings-field">
                <span>{field.label}</span>
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
          <h3>Language & Behaviour</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Default Translate Language</span>
              <input
                type="text"
                value={config.translate_language}
                onChange={(event) => onChange({ translate_language: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Transcribe Language</span>
              <input
                type="text"
                value={config.transcribe_language}
                onChange={(event) => onChange({ transcribe_language: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Silence Threshold</span>
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
              <span>Minimum Silence (seconds)</span>
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
              <span>Enable translation by default</span>
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={config.voice_input_translate}
                onChange={(event) =>
                  onChange({ voice_input_translate: event.target.checked })
                }
              />
              <span>Translate voice input</span>
            </label>
          </div>
        </section>
      </div>
      <footer>
        <button type="button" onClick={onSave} disabled={busy}>
          Save Changes
        </button>
      </footer>
    </aside>
  );
}
