use anyhow::Result;
use exhume_artefacts::parsers::ParserRegistry;
use exhume_filesystem::filesystem::FileCommon;
use exhume_filesystem::Filesystem;
use sqlx::sqlite::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

use log::{info, warn};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::mpsc;

#[derive(Serialize)]
struct ProgressPayload {
    current: u64,
    total: u64,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParserProgressPayload {
    current: u64,
    total: u64,
    parser: String,
    file_path: String,
    artifact_id: i64,
    file_id: Option<i64>,
    phase: &'static str,
    elapsed_ms: Option<u64>,
    setup_ms: Option<u64>,
    parse_ms: Option<u64>,
    persistence_ms: Option<u64>,
    objects_emitted: Option<u64>,
    message: String,
}

pub async fn identify_artefacts(
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: &SqlitePool,
) {
    let (tx, mut rx) = mpsc::channel::<exhume_indexer::IndexerEvent>(100);
    let app_clone = app.clone();

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event.event_type {
                exhume_indexer::IndexerEventType::Info => {
                    info!(
                        "Artefact identification: evidence_id={} partition_id={} {}",
                        event.evidence_id, partition_id, event.message
                    );
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Info,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Warning => {
                    warn!(
                        "Artefact identification warning: evidence_id={} partition_id={} {}",
                        event.evidence_id, partition_id, event.message
                    );
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Info,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Success => {
                    info!(
                        "Artefact identification completed: evidence_id={} partition_id={} {}",
                        event.evidence_id, partition_id, event.message
                    );
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Success,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Error => {
                    warn!(
                        "Artefact identification failed: evidence_id={} partition_id={} {}",
                        event.evidence_id, partition_id, event.message
                    );
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Error,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Progress { current, total } => {
                    info!(
                        "Artefact identification progress: evidence_id={} partition_id={} current={}/{} {}",
                        event.evidence_id, partition_id, current, total, event.message
                    );
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Progress,
                        ProgressPayload {
                            current,
                            total,
                            message: event.message,
                        },
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::ParserProgress { .. } => {
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Main,
                        crate::modules::utils::th_progress::ProgressMessageType::Info,
                        event.message,
                        &app_clone,
                    )
                }
            };
        }
    });

    exhume_indexer::artifacts::identify_artefacts(evidence_id, partition_id, pool, Some(tx), None)
        .await;
}

pub async fn extract_artefacts<F: Filesystem>(
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: &SqlitePool,
    fs: &mut F,
    registry: &ParserRegistry,
    cancel_token: Option<Arc<AtomicBool>>,
) where
    F::FileType: FileCommon,
{
    let (tx, mut rx) = mpsc::channel::<exhume_indexer::IndexerEvent>(100);
    let app_clone = app.clone();

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event.event_type {
                exhume_indexer::IndexerEventType::Info
                | exhume_indexer::IndexerEventType::Warning => {
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Module,
                        crate::modules::utils::th_progress::ProgressMessageType::Info,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Success => {
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Module,
                        crate::modules::utils::th_progress::ProgressMessageType::Success,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Error => {
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Module,
                        crate::modules::utils::th_progress::ProgressMessageType::Error,
                        event.message,
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::Progress { current, total } => {
                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Module,
                        crate::modules::utils::th_progress::ProgressMessageType::Progress,
                        ProgressPayload {
                            current,
                            total,
                            message: event.message,
                        },
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::ParserProgress {
                    current,
                    total,
                    parser,
                    file_path,
                    artifact_id,
                    file_id,
                    phase,
                    elapsed_ms,
                    setup_ms,
                    parse_ms,
                    persistence_ms,
                    objects_emitted,
                } => {
                    match phase {
                        exhume_indexer::ParserProgressPhase::Started => info!(
                            "Artefact parser started: evidence_id={} parser={} position={}/{} artifact_id={} file_id={:?} path={:?}",
                            event.evidence_id,
                            parser,
                            current,
                            total,
                            artifact_id,
                            file_id,
                            file_path,
                        ),
                        exhume_indexer::ParserProgressPhase::Completed => info!(
                            "Artefact parser completed: evidence_id={} parser={} position={}/{} artifact_id={} file_id={:?} elapsed_ms={:?} setup_ms={:?} parse_ms={:?} persistence_ms={:?} objects_emitted={:?} path={:?}",
                            event.evidence_id,
                            parser,
                            current,
                            total,
                            artifact_id,
                            file_id,
                            elapsed_ms,
                            setup_ms,
                            parse_ms,
                            persistence_ms,
                            objects_emitted,
                            file_path,
                        ),
                        exhume_indexer::ParserProgressPhase::Failed => warn!(
                            "Artefact parser failed: evidence_id={} parser={} position={}/{} artifact_id={} file_id={:?} elapsed_ms={:?} setup_ms={:?} parse_ms={:?} persistence_ms={:?} path={:?}: {}",
                            event.evidence_id,
                            parser,
                            current,
                            total,
                            artifact_id,
                            file_id,
                            elapsed_ms,
                            setup_ms,
                            parse_ms,
                            persistence_ms,
                            file_path,
                            event.message,
                        ),
                    }

                    crate::modules::utils::th_progress::emit_progress_event(
                        &event.evidence_id,
                        crate::modules::utils::th_progress::ProgressMessageLevel::Module,
                        crate::modules::utils::th_progress::ProgressMessageType::Parser,
                        ParserProgressPayload {
                            current,
                            total,
                            parser,
                            file_path,
                            artifact_id,
                            file_id,
                            phase: phase.as_str(),
                            elapsed_ms,
                            setup_ms,
                            parse_ms,
                            persistence_ms,
                            objects_emitted,
                            message: event.message,
                        },
                        &app_clone,
                    )
                }
            };
        }
    });

    exhume_indexer::artifacts::extract_artefacts(
        evidence_id,
        partition_id,
        pool,
        fs,
        registry,
        Some(tx),
        cancel_token,
    )
    .await;
}

#[tauri::command]
pub async fn parse_pe(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<Value, String> {
    info!("Fetching PE for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT json
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pe'
        ORDER BY id DESC
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = row {
        info!("Found PE data for file_id {}", file_id);
        let json_str: String = row.get("json");
        let json_val: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(json_val)
    } else {
        info!("No PE data found for file_id {}", file_id);
        Err("No PE data found for this file".to_string())
    }
}

#[tauri::command]
pub async fn has_pml_data(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<bool, String> {
    info!("Checking PML for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT 1
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.is_some())
}

#[tauri::command]
pub async fn has_evtx_data(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<bool, String> {
    info!("Checking EVTX for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT 1
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_evtx'
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.is_some())
}

#[tauri::command]
pub async fn get_pml_events_count(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<i64, String> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT COUNT(*) as count
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.get("count"))
}

#[tauri::command]
pub async fn get_pml_events(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
    offset: i64,
    limit: i64,
) -> Result<Vec<Value>, String> {
    info!(
        "Fetching PML slice for evidence={evidence_id} partition={partition_id} file={file_id} offset={offset} limit={limit}"
    );

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let rows = sqlx::query(
        r#"
        SELECT json
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        ORDER BY id ASC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let json_str: String = row.get("json");
        // Deserialize each row's JSON string into a Value
        let json_val: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        results.push(json_val);
    }

    Ok(results)
}

pub async fn populate_filesystem_timeline(evidence_id: i64, partition_id: i64, pool: &SqlitePool) {
    if let Err(e) =
        exhume_indexer::populate_filesystem_timeline(evidence_id, partition_id, pool).await
    {
        log::warn!(
            "populate_filesystem_timeline failed for evidence={evidence_id} partition={partition_id}: {e}"
        );
    }
}
