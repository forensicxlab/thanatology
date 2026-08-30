use exhume_filesystem::filesystem::DirectoryCommon;
use exhume_filesystem::Filesystem;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tauri::AppHandle;

use crate::modules::utils::th_progress::{
    emit_progress_event, ProgressMessageLevel, ProgressMessageType,
};
use tokio::sync::mpsc;

#[derive(Serialize)]
struct ProgressPayload {
    current: u64,
    total: u64,
    message: String,
}

pub async fn identify_file_types<T: Filesystem>(
    fs: &mut T,
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: Pool<Sqlite>,
) where
    T::DirectoryType: DirectoryCommon,
{
    let (tx, mut rx) = mpsc::channel::<exhume_indexer::IndexerEvent>(100);
    let app_clone = app.clone();

    // Spawn a task to listen for progress events from the headless indexer
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event.event_type {
                exhume_indexer::IndexerEventType::Info
                | exhume_indexer::IndexerEventType::Warning => emit_progress_event(
                    &event.evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Info,
                    event.message,
                    &app_clone,
                ),
                exhume_indexer::IndexerEventType::Success => emit_progress_event(
                    &event.evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Success,
                    event.message,
                    &app_clone,
                ),
                exhume_indexer::IndexerEventType::Error => emit_progress_event(
                    &event.evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Error,
                    event.message,
                    &app_clone,
                ),
                exhume_indexer::IndexerEventType::Progress { current, total } => {
                    emit_progress_event(
                        &event.evidence_id,
                        ProgressMessageLevel::Module,
                        ProgressMessageType::Progress,
                        ProgressPayload {
                            current,
                            total,
                            message: event.message,
                        },
                        &app_clone,
                    )
                }
                exhume_indexer::IndexerEventType::ParserProgress { .. } => emit_progress_event(
                    &event.evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Info,
                    event.message,
                    &app_clone,
                ),
            };
        }
    });

    exhume_indexer::identification::identify_file_types(
        fs,
        evidence_id,
        partition_id,
        &pool,
        Some(tx),
    )
    .await;
}
