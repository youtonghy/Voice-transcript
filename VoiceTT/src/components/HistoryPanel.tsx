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
  return (
    <aside className={`history-panel ${collapsed ? "collapsed" : ""}`}>
      <header>
        <h3>History</h3>
        <div className="history-actions">
          <button type="button" onClick={onToggleCollapse}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </header>
      <div className="history-scroll">
        {conversations.length === 0 ? (
          <p className="history-empty">No conversations yet.</p>
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
                    {conversation.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(conversation.id);
                    }}
                  >
                    Delete
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
