use std::{path::PathBuf, sync::Arc};

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub pinned: bool,
    pub order_rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEntry {
    pub id: String,
    pub conversation_id: String,
    pub kind: EntryKind,
    pub text: String,
    pub translated_text: Option<String>,
    pub language: Option<String>,
    pub created_at: DateTime<Utc>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Transcription,
    Translation,
    Summary,
    Optimization,
}

impl EntryKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntryKind::Transcription => "transcription",
            EntryKind::Translation => "translation",
            EntryKind::Summary => "summary",
            EntryKind::Optimization => "optimization",
        }
    }
}

impl From<&str> for EntryKind {
    fn from(value: &str) -> Self {
        match value {
            "translation" => EntryKind::Translation,
            "summary" => EntryKind::Summary,
            "optimization" => EntryKind::Optimization,
            _ => EntryKind::Transcription,
        }
    }
}

#[derive(Debug)]
pub struct NewEntry<'a> {
    pub conversation_id: &'a str,
    pub kind: EntryKind,
    pub text: &'a str,
    pub translated_text: Option<&'a str>,
    pub language: Option<&'a str>,
    pub metadata: Option<Value>,
}

#[derive(Clone)]
pub struct ConversationStore {
    conn: Arc<Mutex<Connection>>,
}

impl ConversationStore {
    pub fn new(path: PathBuf) -> AppResult<Self> {
        let parent = path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        std::fs::create_dir_all(parent)?;

        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        Self::init_schema(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn init_schema(conn: &Connection) -> AppResult<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                order_rank REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_entries (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL,
                translated_text TEXT,
                language TEXT,
                created_at TEXT NOT NULL,
                metadata TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_entries_conversation ON conversation_entries(conversation_id, created_at);
        "#,
        )?;
        Ok(())
    }

    pub fn create_conversation(&self, title: Option<&str>) -> AppResult<Conversation> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let title = title
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "New Conversation".to_string());

        let order_rank = now.timestamp_millis() as f64;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, pinned, order_rank) VALUES (?, ?, ?, ?, 0, ?)",
            params![id, title, now.to_rfc3339(), now.to_rfc3339(), order_rank],
        )?;

        Ok(Conversation {
            id,
            title,
            created_at: now,
            updated_at: now,
            pinned: false,
            order_rank,
        })
    }

    pub fn update_conversation_title(&self, id: &str, title: &str) -> AppResult<()> {
        let now = Utc::now();
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now.to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?",
            params![if pinned { 1 } else { 0 }, Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn update_order_rank(&self, id: &str, order_rank: f64) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET order_rank = ?, updated_at = ? WHERE id = ?",
            params![order_rank, Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM conversations WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn append_entry(&self, entry: NewEntry<'_>) -> AppResult<ConversationEntry> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let metadata_json = entry
            .metadata
            .as_ref()
            .map(|value| value.to_string());

        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO conversation_entries (id, conversation_id, kind, text, translated_text, language, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                entry.conversation_id,
                entry.kind.as_str(),
                entry.text,
                entry.translated_text,
                entry.language,
                now.to_rfc3339(),
                metadata_json
            ],
        )?;

        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            params![now.to_rfc3339(), entry.conversation_id],
        )?;

        Ok(ConversationEntry {
            id,
            conversation_id: entry.conversation_id.to_string(),
            kind: entry.kind,
            text: entry.text.to_string(),
            translated_text: entry.translated_text.map(|s| s.to_string()),
            language: entry.language.map(|s| s.to_string()),
            created_at: now,
            metadata: entry.metadata,
        })
    }

    pub fn list_conversations(&self) -> AppResult<Vec<Conversation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, pinned, order_rank
             FROM conversations
             ORDER BY pinned DESC, order_rank DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let created_at: String = row.get(2)?;
            let updated_at: String = row.get(3)?;
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: DateTime::parse_from_rfc3339(&created_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                pinned: row.get::<_, i64>(4)? != 0,
                order_rank: row.get(5)?,
            })
        })?;

        let mut items = Vec::new();
        for item in rows {
            items.push(item?);
        }
        Ok(items)
    }

    pub fn conversation(&self, id: &str) -> AppResult<Option<Conversation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, pinned, order_rank
             FROM conversations WHERE id = ?",
        )?;
        let item = stmt
            .query_row(params![id], |row| {
                let created_at: String = row.get(2)?;
                let updated_at: String = row.get(3)?;
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: DateTime::parse_from_rfc3339(&created_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    updated_at: DateTime::parse_from_rfc3339(&updated_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    pinned: row.get::<_, i64>(4)? != 0,
                    order_rank: row.get(5)?,
                })
            })
            .optional()?;
        Ok(item)
    }

    pub fn entries_for_conversation(
        &self,
        conversation_id: &str,
        limit: Option<usize>,
    ) -> AppResult<Vec<ConversationEntry>> {
        let conn = self.conn.lock();
        let mut query = String::from(
            "SELECT id, kind, text, translated_text, language, created_at, metadata
             FROM conversation_entries
             WHERE conversation_id = ?
             ORDER BY created_at ASC",
        );
        if let Some(limit) = limit {
            query.push_str(" LIMIT ");
            query.push_str(&limit.to_string());
        }
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map([conversation_id], |row| {
            let kind_text: String = row.get(1)?;
            let metadata_json: Option<String> = row.get(6)?;
            let created_at: String = row.get(5)?;
            Ok(ConversationEntry {
                id: row.get(0)?,
                conversation_id: conversation_id.to_string(),
                kind: EntryKind::from(kind_text.as_str()),
                text: row.get(2)?,
                translated_text: row.get(3)?,
                language: row.get(4)?,
                created_at: DateTime::parse_from_rfc3339(&created_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                metadata: metadata_json
                    .as_ref()
                    .and_then(|value| serde_json::from_str(value).ok()),
            })
        })?;

        let mut items = Vec::new();
        for entry in rows {
            items.push(entry?);
        }
        Ok(items)
    }
}
