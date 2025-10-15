import { useTranslation } from "react-i18next";
import type { Conversation } from "../types";
import "./HistoryPanel.css";

interface HistoryPanelProps {
  conversations: Conversation[];
  activeConversationId?: string;
  onSelect: (conversationId: string) => void;
  onPin: (conversationId: string, pinned: boolean) => void;
  onDelete: (conversationId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function HistoryPanel({
  conversations,
  activeConversationId,
  onSelect,
  onPin,
  onDelete,
  collapsed,
  onToggleCollapse,
}: HistoryPanelProps) {
  const { t } = useTranslation();
  return (
    <aside className={`history-panel ${collapsed ? "collapsed" : ""}`}>
      <header>
        <h3>{t("history.title")}</h3>
        <div className="history-actions">
          <button type="button" onClick={onToggleCollapse} disabled={!onToggleCollapse}>
            {collapsed ? t("history.expand") : t("history.collapse")}
          </button>
        </div>
      </header>
      <div className="history-scroll">
        {conversations.length === 0 ? (
          <p className="history-empty">{t("history.empty")}</p>
        ) : (
          conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            return (
              <button
                key={conversation.id}
                type="button"
                className={`history-item ${isActive ? "active" : ""}`}
                onClick={() => onSelect(conversation.id)}
              >
                <div className="history-title">
                  <span>{conversation.title}</span>
                  {conversation.pinned && <span className="pin">📌</span>}
                </div>
                <div className="history-meta">
                  <span>{new Date(conversation.updatedAt).toLocaleString()}</span>
                </div>
                <div className="history-toolbar">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPin(conversation.id, !conversation.pinned);
                    }}
                  >
                    {conversation.pinned ? t("history.unpin") : t("history.pin")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(conversation.id);
                    }}
                  >
                    {t("history.delete")}
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
