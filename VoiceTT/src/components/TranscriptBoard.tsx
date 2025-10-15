import { useTranslation } from "../i18n";
import type { ConversationEntry } from "../types";
import "./TranscriptBoard.css";

interface TranscriptBoardProps {
  entries: ConversationEntry[];
  activeConversationTitle: string;
  onTranslate?: (entry: ConversationEntry) => void;
  onOptimize?: (entry: ConversationEntry) => void;
}

export function TranscriptBoard({
  entries,
  activeConversationTitle,
  onTranslate,
  onOptimize,
}: TranscriptBoardProps) {
  const { t } = useTranslation();
  return (
    <section className="transcript-board">
      <header>
        <div>
          <h2>{activeConversationTitle || t("transcript.title")}</h2>
          <p>
            {entries.length === 0
              ? t("transcript.empty")
              : t("transcript.count", { count: entries.length })}
          </p>
        </div>
      </header>
      <div className="transcript-scroll">
        {entries.map((entry) => (
          <article key={entry.id} className={`transcript-entry ${entry.kind}`}>
            <div className="transcript-meta">
              <span className="entry-kind">
                {t(`transcript.kinds.${entry.kind}`, { defaultValue: entry.kind })}
              </span>
              <span className="entry-time">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="entry-text">{entry.text}</p>
            {entry.translatedText && (
              <p className="entry-translation">
                <span>{t("transcript.translationLabel")}</span>
                {entry.translatedText}
              </p>
            )}
            <div className="entry-actions">
              {onTranslate && (
                <button type="button" onClick={() => onTranslate(entry)}>
                  {t("transcript.actions.translate")}
                </button>
              )}
              {onOptimize && (
                <button type="button" onClick={() => onOptimize(entry)}>
                  {t("transcript.actions.optimize")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
