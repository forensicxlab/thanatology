pub mod manager;
pub mod tools;
pub mod supervisor;
pub mod specialists;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;
use tauri::{AppHandle, Manager};

fn resolve_sqlite_url(app: &AppHandle, path_or_url: &str) -> String {
    let relative_path = path_or_url.trim_start_matches("sqlite:");
    
    // If the path is already absolute, just use it
    let path = std::path::Path::new(relative_path);
    if path.is_absolute() {
        return format!("sqlite:{}", relative_path);
    }

    // Otherwise, resolve via app_local_data_dir
    let base_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let full_path = base_dir.join(relative_path);
    format!("sqlite:{}", full_path.to_string_lossy())
}

async fn open_pool(app: &AppHandle, db_path_or_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let url = resolve_sqlite_url(app, db_path_or_url);
    let opts = SqliteConnectOptions::from_str(&url)?
        .with_regexp()
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(30))
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
}

#[tauri::command]
pub async fn investigate_with_agent(
    app: AppHandle,
    evidence_db_path: String,
    instruction: String,
    history: Vec<supervisor::ChatMessage>,
    ai_provider: String,
    ai_endpoint: String,
    ai_model: String,
    ai_api_key: String,
) -> Result<supervisor::Report, String> {
    // 1. Connect to the evidence database
    let evidence_pool = open_pool(&app, &evidence_db_path)
        .await
        .map_err(|e| format!("Failed to open evidence db for agent: {}", e))?;

    // 2. Initialize AgentManager
    let manager = manager::AgentManager::new();

    // 3. Build Configuration
    let config = manager::AgentConfig {
        provider: ai_provider,
        endpoint: ai_endpoint,
        model: ai_model,
        api_key: ai_api_key,
    };

    // 4. Run the investigation via dynamic dispatch internally
    use sqlx::Row;
    let evidence_row = sqlx::query("SELECT id FROM evidence LIMIT 1")
        .fetch_one(&evidence_pool)
        .await
        .map_err(|e| format!("Failed to read evidence ID: {}", e))?;
    let evidence_id: i64 = evidence_row.get(0);

    let report = manager
        .execute_investigation(&config, instruction, history, evidence_pool, app, evidence_id)
        .await?;

    Ok(report)
}

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct MentionFileResult {
    pub identifier: i64,
    pub partition_id: i64,
    pub name: String,
    pub absolute_path: String,
}

#[tauri::command]
pub async fn search_files_for_mention(
    app: AppHandle,
    evidence_db_path: String,
    query: String,
) -> Result<Vec<MentionFileResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let evidence_pool = open_pool(&app, &evidence_db_path)
        .await
        .map_err(|e| format!("Failed to open evidence db: {}", e))?;

    // We use LIKE '%query%' to find matching file names quickly.
    // LIMIT 10 to keep the dropdown UI responsive and clean.
    let _sql = "SELECT identifier, partition_id, name, absolute_path FROM system_files WHERE name LIKE ? OR absolute_path LIKE ? LIMIT 10";
    let filter = format!("%{}%", query);

    let rows = sqlx::query_as::<_, MentionFileResult>(
        "SELECT identifier, partition_id, name, absolute_path FROM system_files WHERE name LIKE ? OR absolute_path LIKE ? LIMIT 10"
    )
    .bind(filter.clone())
    .bind(filter)
    .fetch_all(&evidence_pool)
    .await
    .map_err(|e| format!("Failed to query system_files: {}", e))?;

    Ok(rows)
}
