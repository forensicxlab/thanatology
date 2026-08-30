use crate::modules::agents::runtime::{close_agent_sessions_for_evidence, AgentRuntimeState};
use crate::modules::th_spatiotemporal::{
    close_spatiotemporal_sessions_for_evidence, SpatiotemporalSessionState,
};
use crate::ProcessingState;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
pub struct CaseInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub collaborator_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EvidenceInput {
    pub name: String,
    pub r#type: String, // 'type' is a Rust keyword
    pub path: String,
    pub description: String,
    #[serde(default)]
    pub images: Vec<EvidenceImageInput>,
}

#[derive(Debug, Deserialize)]
pub struct EvidenceImageInput {
    pub caption: String,
    pub file_name: String,
    pub mime_type: String,
    pub source_kind: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDeletionResult {
    pub deleted_evidence_ids: Vec<i64>,
    pub cleanup_warnings: Vec<String>,
}

#[tauri::command]
pub async fn create_case_with_evidence(
    case: CaseInput,
    evidences: Vec<EvidenceInput>,
    db_path: String,
) -> Result<i64, String> {
    let pool = SqlitePool::connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    // Begin transaction
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    // Insert case
    sqlx::query("INSERT INTO cases (name, description) VALUES (?, ?);")
        .bind(&case.name)
        .bind(&case.description)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert case error: {e}"))?;

    // Get generated id (SQLite-friendly, works widely)
    let rec = sqlx::query_as::<_, (i64,)>("SELECT last_insert_rowid();")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("last_insert_rowid error: {e}"))?;
    let case_id = rec.0;

    // Collaborators (idempotent)
    for uid in case.collaborator_ids.iter() {
        sqlx::query("INSERT OR IGNORE INTO case_collaborators (case_id, user_id) VALUES (?, ?);")
            .bind(case_id)
            .bind(uid)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert collaborator error: {e}"))?;
    }

    // Evidences
    for ev in evidences.iter() {
        sqlx::query(
            "INSERT INTO evidence (case_id, name, type, path, description)
             VALUES (?, ?, ?, ?, ?);",
        )
        .bind(case_id)
        .bind(&ev.name)
        .bind(&ev.r#type)
        .bind(&ev.path)
        .bind(&ev.description)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert evidence error: {e}"))?;

        let evidence_rec = sqlx::query_as::<_, (i64,)>("SELECT last_insert_rowid();")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("last_insert_rowid error: {e}"))?;
        let evidence_id = evidence_rec.0;

        for image in ev.images.iter() {
            let caption = image.caption.trim();
            if caption.is_empty() {
                return Err("Each evidence image requires a caption.".to_string());
            }

            sqlx::query(
                "INSERT INTO evidence_images (
                    evidence_id,
                    caption,
                    file_name,
                    mime_type,
                    source_kind,
                    data
                 ) VALUES (?, ?, ?, ?, ?, ?);",
            )
            .bind(evidence_id)
            .bind(caption)
            .bind(&image.file_name)
            .bind(&image.mime_type)
            .bind(&image.source_kind)
            .bind(&image.bytes)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert evidence image error: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit error: {e}"))?;
    Ok(case_id)
}

#[tauri::command]
pub async fn delete_evidences(
    app: AppHandle,
    processing_state: State<'_, ProcessingState>,
    agent_state: State<'_, AgentRuntimeState>,
    spatiotemporal_state: State<'_, SpatiotemporalSessionState>,
    evidence_ids: Vec<i64>,
) -> Result<EvidenceDeletionResult, String> {
    let evidence_ids = evidence_ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if evidence_ids.is_empty() {
        return Ok(EvidenceDeletionResult {
            deleted_evidence_ids: Vec::new(),
            cleanup_warnings: Vec::new(),
        });
    }
    if evidence_ids.len() > 1_000 {
        return Err("At most 1,000 evidences can be deleted at once.".to_string());
    }

    {
        let active = processing_state
            .tokens
            .lock()
            .map_err(|_| "Failed to inspect active evidence processing tasks.".to_string())?;
        let processing_ids = evidence_ids
            .iter()
            .filter(|id| active.contains_key(id))
            .copied()
            .collect::<Vec<_>>();
        if !processing_ids.is_empty() {
            return Err(format!(
                "Cannot delete evidence while processing is active: {}",
                processing_ids
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }

    for evidence_id in &evidence_ids {
        close_agent_sessions_for_evidence(agent_state.inner(), *evidence_id).await?;
        close_spatiotemporal_sessions_for_evidence(
            &app,
            spatiotemporal_state.inner(),
            *evidence_id,
        )
        .await
        .map_err(|error| {
            format!(
                "Cannot delete evidence {evidence_id}: failed to close linked Timeline/Location windows: {error}"
            )
        })?;
    }

    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app-local data directory: {error}"))?;
    let main_db_path = app_data_dir.join("thanatology.db");
    let options = SqliteConnectOptions::new()
        .filename(&main_db_path)
        .create_if_missing(false)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(30));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("Failed to open the main database: {error}"))?;
    let deleted_evidence_ids = delete_main_evidence_records(&pool, &evidence_ids).await?;
    pool.close().await;

    let mut cleanup_warnings = Vec::new();
    let evidence_dir = app_data_dir.join("evidences");
    for evidence_id in &deleted_evidence_ids {
        if let Some(window) = app.get_webview_window(&format!("agent-{evidence_id}")) {
            if let Err(error) = window.close() {
                cleanup_warnings.push(format!(
                    "Evidence {evidence_id}: failed to close its agent window: {error}"
                ));
            }
        }

        let db_path = evidence_dir.join(format!("{evidence_id}.db"));
        for path in [
            db_path.clone(),
            evidence_dir.join(format!("{evidence_id}.db-wal")),
            evidence_dir.join(format!("{evidence_id}.db-shm")),
            evidence_dir.join(format!("{evidence_id}.report.md")),
        ] {
            if let Err(error) = remove_path_if_present(&path).await {
                cleanup_warnings.push(format!(
                    "Evidence {evidence_id}: failed to remove '{}': {error}",
                    path.display()
                ));
            }
        }

        let extraction_dir = evidence_dir.join(format!("{evidence_id}.extracted"));
        if let Err(error) = remove_path_if_present(&extraction_dir).await {
            cleanup_warnings.push(format!(
                "Evidence {evidence_id}: failed to remove '{}': {error}",
                extraction_dir.display()
            ));
        }
    }

    Ok(EvidenceDeletionResult {
        deleted_evidence_ids,
        cleanup_warnings,
    })
}

async fn delete_main_evidence_records(
    pool: &SqlitePool,
    evidence_ids: &[i64],
) -> Result<Vec<i64>, String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin evidence deletion: {error}"))?;

    let mut deleted_evidence_ids = Vec::new();
    for evidence_id in evidence_ids {
        sqlx::query("DELETE FROM evidence_images WHERE evidence_id = ?")
            .bind(evidence_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Failed to delete evidence images: {error}"))?;
        sqlx::query("DELETE FROM evidence_preprocessing_metadata WHERE evidence_id = ?")
            .bind(evidence_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Failed to delete preprocessing metadata: {error}"))?;
        sqlx::query("DELETE FROM partitions WHERE evidence_id = ?")
            .bind(evidence_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Failed to delete partitions: {error}"))?;
        let result = sqlx::query("DELETE FROM evidence WHERE id = ?")
            .bind(evidence_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Failed to delete evidence record: {error}"))?;
        if result.rows_affected() > 0 {
            deleted_evidence_ids.push(*evidence_id);
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit evidence deletion: {error}"))?;
    Ok(deleted_evidence_ids)
}

async fn remove_path_if_present(path: &Path) -> std::io::Result<()> {
    let metadata = match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(path).await
    } else {
        tokio::fs::remove_file(path).await
    }
}

#[cfg(test)]
mod tests {
    use super::delete_main_evidence_records;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn deletes_main_records_without_evidence_analysis_tables() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory database");
        for statement in [
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY)",
            "CREATE TABLE partitions (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "CREATE TABLE evidence_preprocessing_metadata (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "CREATE TABLE evidence_images (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "INSERT INTO evidence (id) VALUES (7)",
            "INSERT INTO partitions (id, evidence_id) VALUES (1, 7)",
            "INSERT INTO evidence_preprocessing_metadata (id, evidence_id) VALUES (1, 7)",
            "INSERT INTO evidence_images (id, evidence_id) VALUES (1, 7)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("test schema statement");
        }

        let deleted = delete_main_evidence_records(&pool, &[7])
            .await
            .expect("evidence deletion");

        assert_eq!(deleted, vec![7]);
        for table in [
            "evidence",
            "partitions",
            "evidence_preprocessing_metadata",
            "evidence_images",
        ] {
            let query = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = sqlx::query_scalar(&query)
                .fetch_one(&pool)
                .await
                .expect("table count");
            assert_eq!(count, 0, "{table} should be empty");
        }
    }
}
