import { useState } from "react";
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
        <h3>Media Transcription</h3>
        <p>Transcribe audio/video files directly.</p>
      </header>
      <form onSubmit={handleSubmit} className="media-form">
        <div className="media-field">
          <label>Source File</label>
          <div className="media-file">
            <input type="text" value={path} readOnly placeholder="Select audio or video file" />
            <button type="button" onClick={handleSelectFile} disabled={busy}>
              Browse…
            </button>
          </div>
        </div>
        <label className="media-checkbox">
          <input
            type="checkbox"
            checked={translate}
            onChange={(event) => setTranslate(event.target.checked)}
          />
          Translate automatically
        </label>
        {translate && (
          <div className="media-field">
            <label>Target language</label>
            <input
              type="text"
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            />
          </div>
        )}
        <button type="submit" disabled={!path || busy}>
          {busy ? "Processing…" : "Process"}
        </button>
      </form>
    </section>
  );
}
