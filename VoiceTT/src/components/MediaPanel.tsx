import { useState } from "react";
import { useTranslation } from "../i18n";
import { open } from "@tauri-apps/plugin-dialog";
import "./MediaPanel.css";

interface MediaPanelProps {
  busy?: boolean;
  defaultTargetLanguage: string;
  onProcess: (options: { path: string; translate: boolean; targetLanguage?: string }) => void;
}

export function MediaPanel({ busy, defaultTargetLanguage, onProcess }: MediaPanelProps) {
  const [path, setPath] = useState<string>("");
  const [translate, setTranslate] = useState(true);
  const [targetLanguage, setTargetLanguage] = useState(defaultTargetLanguage);
  const { t } = useTranslation();

  async function handleSelectFile() {
    const result = await open({ multiple: false, filters: [{ name: "Media", extensions: ["mp3", "mp4", "m4a", "wav", "aac", "flac"] }] });
    if (typeof result === "string") {
      setPath(result);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!path) return;
    onProcess({ path, translate, targetLanguage: translate ? targetLanguage : undefined });
  }

  return (
    <section className="media-panel">
      <header>
        <h3>{t("media.title")}</h3>
        <p>{t("media.description")}</p>
      </header>
      <form onSubmit={handleSubmit} className="media-form">
        <div className="media-field">
          <label>{t("media.sourceFile")}</label>
          <div className="media-file">
            <input
              type="text"
              value={path}
              readOnly
              placeholder={t("media.placeholder")}
            />
            <button type="button" onClick={handleSelectFile} disabled={busy}>
              {t("media.browse")}
            </button>
          </div>
        </div>
        <label className="media-checkbox">
          <input
            type="checkbox"
            checked={translate}
            onChange={(event) => setTranslate(event.target.checked)}
          />
          {t("media.translateAutomatically")}
        </label>
        {translate && (
          <div className="media-field">
            <label>{t("media.targetLanguage")}</label>
            <input
              type="text"
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            />
          </div>
        )}
        <button type="submit" disabled={!path || busy}>
          {busy ? t("media.processing") : t("media.submit")}
        </button>
      </form>
    </section>
  );
}
