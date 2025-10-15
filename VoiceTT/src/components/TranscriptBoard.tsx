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
  return (
    <section className="transcript-board">
      <header>
        <div>
          <h2>{activeConversationTitle || "Transcript"}</h2>
          <p>{entries.length === 0 ? "No entries yet." : `${entries.length} segments`}</p>
        </div>
      </header>
      <div className="transcript-scroll">
        {entries.map((entry) => (
          <article key={entry.id} className={`transcript-entry ${entry.kind}`}>
            <div className="transcript-meta">
              <span className="entry-kind">{entry.kind}</span>
              <span className="entry-time">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="entry-text">{entry.text}</p>
            {entry.translatedText && (
              <p className="entry-translation">
                <span>Translation</span>
                {entry.translatedText}
              </p>
            )}
            <div className="entry-actions">
              {onTranslate && (
                <button type="button" onClick={() => onTranslate(entry)}>
                  Translate
                </button>
              )}
              {onOptimize && (
                <button type="button" onClick={() => onOptimize(entry)}>
                  Improve phrasing
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
