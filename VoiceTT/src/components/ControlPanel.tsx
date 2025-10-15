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
  const recording = status?.isRecording ?? false;
  const mode = status?.mode ?? "default";

  return (
    <section className="control-panel">
      <div className="control-status">
        <div className={`status-indicator ${recording ? "recording" : "idle"}`} />
        <div>
          <h2>{recording ? "Recording" : "Idle"}</h2>
          <p>{recording ? `Mode: ${mode}` : "Ready"}</p>
        </div>
      </div>
      <div className="control-actions">
        <button
          type="button"
          className="primary"
          onClick={onStartRecording}
          disabled={recording || busy}
        >
          Start Recording
        </button>
        <button
          type="button"
          onClick={onStopRecording}
          disabled={!recording || busy}
        >
          Stop Recording
        </button>
        <button
          type="button"
          onClick={onStartVoiceInput}
          disabled={recording || busy}
        >
          Voice Input
        </button>
        <button
          type="button"
          onClick={onStopVoiceInput}
          disabled={!recording || busy || mode !== "voice_input"}
        >
          Stop Voice Input
        </button>
      </div>
    </section>
  );
}
