import "./media/MediaTranscribeWindow.css";

import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { stat } from "@tauri-apps/api/fs";
import { useI18n } from "../i18n";
import {
  exportResults,
  getConfig,
  onMediaProgress,
  processMediaFile,
  saveConfig,
} from "../api";

type MediaResult = {
  transcription: string;
  translation?: string;
};

type SelectedFile = {
  path: string;
  name: string;
  size: number;
};

const LANGUAGE_OPTIONS = [
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
] as const;

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function MediaTranscribeWindow({
  initialLanguage,
}: {
  initialLanguage: string;
}) {
  const { setLanguage, t } = useI18n();
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [outputPath, setOutputPath] = useState("");
  const [results, setResults] = useState<MediaResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recognitionEngine, setRecognitionEngine] = useState("openai");
  const [translationEngine, setTranslationEngine] = useState("openai");
  const [enableTranslation, setEnableTranslation] = useState(true);
  const [targetLanguage, setTargetLanguage] = useState<string>("Chinese");
  const [customLanguage, setCustomLanguage] = useState("");
  const [theaterMode, setTheaterMode] = useState(false);

  useEffect(() => {
    setLanguage(initialLanguage as any);
  }, [initialLanguage, setLanguage]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const cfg = await getConfig<Record<string, any>>();
        if (!isMounted) return;
        setConfig(cfg);
        setRecognitionEngine(
          cfg.recognition_engine || cfg.transcribe_source || "openai",
        );
        setTranslationEngine(cfg.translation_engine || "openai");
        setEnableTranslation(cfg.enable_translation !== false);
        setTargetLanguage(cfg.translate_language || "Chinese");
        setTheaterMode(Boolean(cfg.theater_mode));
      } catch {
        // ignore load errors for now
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onMediaProgress((payload) => {
      const kind = String(payload.type || "");
      if (kind === "progress") {
        setProgressMessage(
          typeof payload.message === "string" ? payload.message : null,
        );
        setErrorMessage(null);
      } else if (kind === "result") {
        setResults((prev) => [
          ...prev,
          {
            transcription: String(payload.transcription || ""),
            translation: payload.translation
              ? String(payload.translation)
              : undefined,
          },
        ]);
      } else if (kind === "complete") {
        setProcessing(false);
        setProgressMessage(t("media.progress.complete") || "Completed");
        setErrorMessage(null);
      } else if (kind === "error") {
        setProcessing(false);
        setErrorMessage(
          typeof payload.message === "string"
            ? payload.message
            : t("media.error.processingFailed") || "Processing failed",
        );
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  const canStart = useMemo(() => {
    return (
      !!selectedFile &&
      !!outputPath.trim() &&
      !processing &&
      (!enableTranslation ||
        targetLanguage !== "__custom__" ||
        customLanguage.trim() !== "")
    );
  }, [
    selectedFile,
    outputPath,
    processing,
    enableTranslation,
    targetLanguage,
    customLanguage,
  ]);

  const usingCustomLanguage =
    enableTranslation && targetLanguage === "__custom__";

  const handleSelectFile = async () => {
    try {
      const selection = await open({
        multiple: false,
        title: t("media.upload.select") || "Select Media File",
        filters: [
          {
            name: "Audio/Video",
            extensions: [
              "wav",
              "mp3",
              "flac",
              "aac",
              "ogg",
              "m4a",
              "wma",
              "mp4",
              "avi",
              "mov",
              "mkv",
              "flv",
              "wmv",
              "webm",
              "m4v",
            ],
          },
        ],
      });
      if (!selection) return;
      const path =
        typeof selection === "string" ? selection : selection[0] || "";
      if (!path) return;
      let size = 0;
      try {
        const info = await stat(path);
        size = info.size ?? 0;
      } catch {
        size = 0;
      }
      const name = path.split(/[\\/]/).pop() || path;
      setSelectedFile({ path, name, size });
      setResults([]);
      setProgressMessage(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        `${t("media.error.selectFileFailed") || "Failed to select file"}: ${
          (error as Error).message || error
        }`,
      );
    }
  };

  const handleBrowseOutput = async () => {
    try {
      const suggestedName =
        selectedFile?.name?.replace(/\.[^/.]+$/, "") || "output";
      const path = await save({
        title: t("media.actions.choosePathPlaceholder") || "Choose save location",
        filters: [{ name: "Text Files", extensions: ["txt"] }],
        defaultPath: `${suggestedName}.txt`,
      });
      if (path) {
        setOutputPath(path);
      }
    } catch (error) {
      setErrorMessage(
        `${t("media.error.selectOutputFailed") || "Select output failed"}: ${
          (error as Error).message || error
        }`,
      );
    }
  };

  const finalTargetLanguage = enableTranslation
    ? targetLanguage === "__custom__"
      ? customLanguage.trim()
      : targetLanguage
    : "";

  const applyEngineConfig = async () => {
    if (!config) return;
    const next = {
      ...config,
      recognition_engine: recognitionEngine,
      transcribe_source: recognitionEngine,
      translation_engine: translationEngine,
      enable_translation: enableTranslation,
      translate_language: finalTargetLanguage || config.translate_language,
      theater_mode: theaterMode,
    };
    try {
      await saveConfig(next);
      setConfig(next);
    } catch {
      // ignore save errors; process can still run
    }
  };

  const handleStart = async () => {
    if (!canStart || !selectedFile) {
      return;
    }
    setProcessing(true);
    setResults([]);
    setProgressMessage(t("media.progress.preparing") || "Preparing...");
    setErrorMessage(null);
    await applyEngineConfig();
    const settings = {
      enableTranslation,
      targetLanguage: finalTargetLanguage,
      theaterMode,
      outputPath,
    };
    try {
      const response = (await processMediaFile(
        selectedFile.path,
        settings,
      )) as Record<string, unknown>;
      if (response && response.success === false) {
        setErrorMessage(
          typeof response.error === "string"
            ? response.error
            : t("media.error.processingFailed") || "Processing failed",
        );
        setProcessing(false);
      }
    } catch (error) {
      setProcessing(false);
      setErrorMessage(
        `${t("media.error.processingException") || "Processing error"}: ${
          (error as Error).message || error
        }`,
      );
    }
  };

  const handleExport = async () => {
    if (!results.length) {
      setErrorMessage(
        t("media.error.noResultsToExport") || "No results available to export.",
      );
      return;
    }
    try {
      const response = (await exportResults(results)) as Record<
        string,
        unknown
      >;
      if (response && response.success !== false) {
        setProgressMessage(
          t("media.notify.exportSuccess") || "Export completed",
        );
      } else {
        const message =
          (response && response.error && String(response.error)) ||
          t("media.notify.exportFailed") ||
          "Export failed";
        setErrorMessage(message);
      }
    } catch (error) {
      setErrorMessage(
        `${t("media.notify.exportFailed") || "Export failed"}: ${
          (error as Error).message || error
        }`,
      );
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setOutputPath("");
    setResults([]);
    setProgressMessage(null);
    setErrorMessage(null);
  };

  const fileSizeLabel = selectedFile ? formatFileSize(selectedFile.size) : "";

  return (
    <div className="media-window">
      <header className="media-nav">
        <div className="media-nav-content">
          <button className="media-back" onClick={() => window.close()}>
            <span className="media-back-icon">←</span>
            <span>{t("common.backLink") || "Back"}</span>
          </button>
          <div className="media-title">
            {t("media.nav.title") || "Media Transcription"}
          </div>
          <div className="media-status">
            {processing ? t("media.progress.processing") || "Processing..." : ""}
          </div>
        </div>
      </header>

      <div className="media-main">
        <aside className="media-settings">
          <section className="media-panel">
            <h2 className="panel-heading">
              {t("media.panel.file") || "Select File"}
            </h2>
            <button
              className="upload-area"
              onClick={handleSelectFile}
              disabled={processing}
            >
              <div className="upload-icon">📁</div>
              <div className="upload-text">
                <div className="primary">
                  {t("media.upload.select") || "Click to choose a media file"}
                </div>
                <div>
                  {t("media.upload.supportVideo") ||
                    "Supported video: MP4, AVI, MOV, MKV, ..."}
                </div>
                <div>
                  {t("media.upload.supportAudio") ||
                    "Supported audio: WAV, MP3, FLAC, AAC, ..."}
                </div>
              </div>
            </button>
            {selectedFile ? (
              <div className="file-info">
                <div className="file-name">{selectedFile.name}</div>
                <div className="file-size">{fileSizeLabel}</div>
              </div>
            ) : (
              <div className="file-info empty">
                {t("media.file.none") || "No file selected"}
              </div>
            )}
          </section>

          <section className="media-panel">
            <h2 className="panel-heading">
              {t("media.panel.processing") || "Processing Settings"}
            </h2>
            <div className="input-group">
              <label htmlFor="recognitionEngine">
                {t("media.labels.recognitionEngine") ||
                  "Transcription Engine"}
              </label>
              <select
                id="recognitionEngine"
                value={recognitionEngine}
                onChange={(event) => setRecognitionEngine(event.target.value)}
                disabled={processing}
              >
                <option value="openai">OpenAI</option>
                <option value="soniox">Soniox</option>
                <option value="dashscope">DashScope (Qwen3-ASR)</option>
              </select>
            </div>

            <div className="input-group">
              <label htmlFor="translationEngine">
                {t("media.labels.translationEngine") || "Translation Engine"}
              </label>
              <select
                id="translationEngine"
                value={translationEngine}
                onChange={(event) => setTranslationEngine(event.target.value)}
                disabled={processing}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-item">
                <input
                  type="checkbox"
                  checked={enableTranslation}
                  onChange={(event) => setEnableTranslation(event.target.checked)}
                  disabled={processing}
                />
                <span>
                  {t("media.setting.enableTranslation") || "Enable Translation"}
                </span>
              </label>

              <div className="input-group">
                <label htmlFor="targetLanguage">
                  {t("media.setting.targetLanguage") || "Target Language"}
                </label>
                <select
                  id="targetLanguage"
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  disabled={!enableTranslation || processing}
                >
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                  <option value="__custom__">
                    {t("media.languages.custom") || "Custom..."}
                  </option>
                </select>
                {usingCustomLanguage && (
                  <input
                    type="text"
                    className="custom-language-input"
                    value={customLanguage}
                    onChange={(event) => setCustomLanguage(event.target.value)}
                    disabled={processing}
                    placeholder={
                      t("settings.placeholders.customLanguage") ||
                      "Enter a custom language"
                    }
                  />
                )}
              </div>

              <label className="setting-item">
                <input
                  type="checkbox"
                  checked={theaterMode}
                  onChange={(event) => setTheaterMode(event.target.checked)}
                  disabled={processing}
                />
                <span>
                  {t("media.setting.theaterMode") ||
                    "Enable Theater Mode (audio enhancement)"}
                </span>
              </label>
            </div>
          </section>

          <section className="media-panel">
            <h2 className="panel-heading">
              {t("media.panel.output") || "Output Settings"}
            </h2>
            <div className="input-group">
              <label htmlFor="outputPath">
                {t("media.labels.outputPath") || "Save Location"}
              </label>
              <div className="output-row">
                <input
                  id="outputPath"
                  className="text-input"
                  readOnly
                  value={outputPath}
                  placeholder={
                    t("media.actions.choosePathPlaceholder") ||
                    "Choose a save location"
                  }
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleBrowseOutput}
                  disabled={processing}
                >
                  {t("media.actions.browse") || "Browse"}
                </button>
              </div>
            </div>
          </section>

          <div className="action-buttons">
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={!canStart}
            >
              {processing
                ? t("media.progress.processing") || "Processing..."
                : t("media.actions.start") || "Start Processing"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleClear}
              disabled={processing}
            >
              {t("media.actions.clear") || "Clear Selection"}
            </button>
          </div>
        </aside>

        <section className="results-panel">
          <div className="results-header">
            <div className="results-title">
              {t("media.results.title") || "Processing Results"}
            </div>
            <button
              className="export-btn"
              onClick={handleExport}
              disabled={!results.length}
            >
              {t("media.actions.export") || "Export TXT"}
            </button>
          </div>
          <div className="results-content">
            {errorMessage ? (
              <div className="empty-state error">
                <div className="empty-icon">⚠️</div>
                <div>{errorMessage}</div>
              </div>
            ) : progressMessage && processing ? (
              <div className="progress-container">
                <div className="progress-text">{progressMessage}</div>
                <div className="progress-bar">
                  <div className="progress-fill" />
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📄</div>
                <div>
                  {t("media.results.emptyState") ||
                    "Select a media file and start processing to view the transcription here."}
                </div>
              </div>
            ) : (
              results.map((result, index) => (
                <article className="result-item" key={`${index}-${result.transcription}`}>
                  <header className="result-header">
                    <div className="segment-number">
                      {t("media.results.segmentLabel")
                        ? t("media.results.segmentLabel")!.replace(
                            "{index}",
                            String(index + 1),
                          )
                        : `Segment ${index + 1}`}
                    </div>
                  </header>
                  <div className="result-text">
                    <div className="transcription">{result.transcription}</div>
                    {result.translation && result.translation.trim() && (
                      <div className="translation">{result.translation}</div>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
