use crate::config::open_or_create_connection;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, Error, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

const TABLE_CONVERSATIONS: &str = "conversation_store";
const TABLE_UI_STATE: &str = "conversation_ui_state";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEntryModel {
    pub id: String,
    #[serde(default)]
    pub result_id: Option<String>,
    #[serde(default)]
    pub transcription: String,
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub transcription_pending: Option<bool>,
    #[serde(default)]
    pub translation_pending: Option<bool>,
    #[serde(default)]
    pub optimized: Option<String>,
    #[serde(default)]
    pub optimized_pending: Option<bool>,
    #[serde(default)]
    pub optimized_error: Option<String>,
    #[serde(default)]
    pub optimization_meta: Option<Value>,
    #[serde(default)]
    pub meta: Option<Value>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConversationModel {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub entries: Vec<ConversationEntryModel>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub order_rank: Option<i64>,
    #[serde(default)]
    pub needs_title_refresh: Option<bool>,
    #[serde(default)]
    pub title_generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationStateModel {
    #[serde(default)]
    pub conversations: Vec<ConversationModel>,
    #[serde(default)]
    pub active_conversation_id: Option<String>,
    #[serde(default)]
    pub history_collapsed: bool,
}

impl Default for ConversationStateModel {
    fn default() -> Self {
        Self {
            conversations: Vec::new(),
            active_conversation_id: None,
            history_collapsed: false,
        }
    }
}

pub fn load_conversation_state(path: &Path) -> Result<ConversationStateModel> {
    let conn = open_or_create_connection(path)?;
    ensure_tables(&conn)?;

    let conversations = read_conversations(&conn)?;
    let active_conversation_id = read_ui_value(&conn, "active_conversation_id")?;
    let history_collapsed = read_ui_value(&conn, "history_collapsed")?
        .map(|value| parse_bool(&value, false))
        .unwrap_or(false);

    Ok(ConversationStateModel {
        conversations,
        active_conversation_id: active_conversation_id.filter(|value| !value.is_empty()),
        history_collapsed,
    })
}

pub fn save_conversation_state(path: &Path, state: &ConversationStateModel) -> Result<()> {
    let mut conn = open_or_create_connection(path)?;
    ensure_tables(&conn)?;

    let mut tx = conn
        .transaction()
        .context("failed to begin conversation transaction")?;

    let existing_ids = fetch_existing_ids(&tx)?;
    let incoming_ids: HashSet<&str> = state.conversations.iter().map(|c| c.id.as_str()).collect();

    for id in existing_ids {
        if !incoming_ids.contains(id.as_str()) {
            tx.execute(
                &format!("DELETE FROM {TABLE_CONVERSATIONS} WHERE id = ?1"),
                params![id],
            )
            .with_context(|| format!("failed to delete conversation {}", id))?;
        }
    }

    for conversation in &state.conversations {
        let data = serde_json::to_string(conversation)
            .context("failed to serialize conversation payload")?;
        tx.execute(
            &format!(
                "INSERT INTO {TABLE_CONVERSATIONS} (id, data)
                 VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data"
            ),
            params![conversation.id, data],
        )
        .with_context(|| format!("failed to upsert conversation {}", conversation.id))?;
    }

    write_ui_value(
        &mut tx,
        "active_conversation_id",
        state
            .active_conversation_id
            .clone()
            .unwrap_or_default()
            .as_str(),
    )?;
    write_ui_value(
        &mut tx,
        "history_collapsed",
        if state.history_collapsed { "1" } else { "0" },
    )?;

    tx.commit()
        .context("failed to commit conversation transaction")?;
    Ok(())
}

fn ensure_tables(conn: &Connection) -> Result<()> {
    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {TABLE_CONVERSATIONS} (
                id   TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )"
        ),
        [],
    )
    .context("failed to ensure conversation table")?;
    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {TABLE_UI_STATE} (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )"
        ),
        [],
    )
    .context("failed to ensure conversation ui table")?;
    Ok(())
}

fn read_conversations(conn: &Connection) -> Result<Vec<ConversationModel>> {
    let mut stmt = conn
        .prepare(&format!("SELECT data FROM {TABLE_CONVERSATIONS}"))
        .context("failed to prepare conversation query")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .context("failed to iterate conversation rows")?;

    let mut conversations = Vec::new();
    for row in rows {
        let data = row?;
        match serde_json::from_str::<ConversationModel>(&data) {
            Ok(mut conversation) => {
                if conversation.entries.is_empty() {
                    conversation.entries = Vec::new();
                }
                conversations.push(conversation);
            }
            Err(err) => {
                eprintln!("[conversation] failed to parse record: {err:?}");
            }
        }
    }
    Ok(conversations)
}

fn read_ui_value(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT value FROM {TABLE_UI_STATE} WHERE key = ?1"
        ))
        .with_context(|| format!("failed to prepare ui state query for key {key}"))?;
    match stmt.query_row(params![key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err).with_context(|| format!("failed to read ui state for key {key}")),
    }
}

fn write_ui_value(tx: &mut Transaction<'_>, key: &str, value: &str) -> Result<()> {
    tx.execute(
        &format!(
            "INSERT INTO {TABLE_UI_STATE} (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ),
        params![key, value],
    )
    .with_context(|| format!("failed to persist ui state key {key}"))?;
    Ok(())
}

fn fetch_existing_ids(tx: &Transaction<'_>) -> Result<Vec<String>> {
    let mut stmt = tx
        .prepare(&format!("SELECT id FROM {TABLE_CONVERSATIONS}"))
        .context("failed to prepare existing conversation query")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .context("failed to iterate conversation ids")?;

    let mut ids = Vec::new();
    for entry in rows {
        ids.push(entry?);
    }
    Ok(ids)
}

fn parse_bool(value: &str, fallback: bool) -> bool {
    match value.trim().to_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => fallback,
    }
}
