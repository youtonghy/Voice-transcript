import { useTranslation } from "react-i18next";
import type { ServiceStatus } from "../types";
import "./ControlPanel.css";

interface ControlPanelProps {
  status: ServiceStatus | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStartVoiceInput: () => void;
  onStopVoiceInput: () => void;
  busy?: boolean;
}

export function ControlPanel({
  status,
  onStartRecording,
  onStopRecording,
  onStartVoiceInput,
  onStopVoiceInput,
  busy,
}: ControlPanelProps) {
  const { t } = useTranslation();
  const recording = status?.isRecording ?? false;
  const mode = status?.mode ?? "default";
  const modeKey = mode === "voice_input" ? "voice_input" : "default";
  const modeLabel = t(`controlPanel.modes.${modeKey}`);

  return (
    <section className="control-panel">
      <div className="control-status">
        <div className={`status-indicator ${recording ? "recording" : "idle"}`} />
        <div>
          <h2>{recording ? t("controlPanel.statusRecording") : t("controlPanel.statusIdle")}</h2>
          <p>{recording ? t("controlPanel.mode", { mode: modeLabel }) : t("controlPanel.ready")}</p>
        </div>
      </div>
      <div className="control-actions">
        <button
          type="button"
          className="primary"
          onClick={onStartRecording}
          disabled={recording || busy}
        >
          {t("controlPanel.startRecording")}
        </button>
        <button
          type="button"
          onClick={onStopRecording}
          disabled={!recording || busy}
        >
          {t("controlPanel.stopRecording")}
        </button>
        <button
          type="button"
          onClick={onStartVoiceInput}
          disabled={recording || busy}
        >
          {t("controlPanel.voiceInput")}
        </button>
        <button
          type="button"
          onClick={onStopVoiceInput}
          disabled={!recording || busy || mode !== "voice_input"}
        >
          {t("controlPanel.stopVoiceInput")}
        </button>
      </div>
    </section>
  );
}
