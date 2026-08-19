use crate::modules::utils::th_progress::{
    ProgressMessageLevel, ProgressMessageType, emit_progress_event,
};
use exhume_indexer::{
    IndexerEvent, IndexerEventType, index_folder as inner_index_folder,
    index_partition as inner_index_partition,
};
use log::{error, info};
use serde::Serialize;
use sqlx::sqlite::SqlitePool;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tauri::AppHandle;
use tokio::sync::mpsc;

#[derive(Serialize)]
struct ProgressPayload {
    current: u64,
    total: u64,
    message: String,
}

fn pump_progress_blocking(mut rx: mpsc::Receiver<IndexerEvent>, app: AppHandle) {
    while let Some(event) = rx.blocking_recv() {
        match event.event_type {
            IndexerEventType::Info | IndexerEventType::Warning => emit_progress_event(
                &event.evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                event.message,
                &app,
            ),
            IndexerEventType::Success => emit_progress_event(
                &event.evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Success,
                event.message,
                &app,
            ),
            IndexerEventType::Error => emit_progress_event(
                &event.evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                event.message,
                &app,
            ),
            IndexerEventType::Progress { current, total } => emit_progress_event(
                &event.evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Progress,
                ProgressPayload {
                    current,
                    total,
                    message: event.message,
                },
                &app,
            ),
            IndexerEventType::ParserProgress { .. } => emit_progress_event(
                &event.evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                event.message,
                &app,
            ),
        }
    }
}

pub async fn index_partition(
    evidence_id: i64,
    partition_id: i64,
    size_sectors: u64,
    first_byte_addr: u64,
    disk_image_path: String,
    pool: &SqlitePool,
    app: &AppHandle,
    cancel_token: Option<Arc<AtomicBool>>,
) {
    info!("Starting internal index_partition via exhume_indexer");
    let (tx, rx) = mpsc::channel(100);

    // Spawn task to handle the GUI progress bars via channel events
    let app_handle = app.clone();
    let progress_thread = std::thread::spawn(move || {
        pump_progress_blocking(rx, app_handle);
    });

    let result = inner_index_partition(
        evidence_id,
        partition_id,
        size_sectors,
        first_byte_addr,
        disk_image_path,
        pool,
        Some(tx),
        cancel_token,
    )
    .await;

    let _ = progress_thread.join();

    if let Err(err) = result {
        error!("Index partition failed: {}", err);
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Indexation failed: {}", err),
            app,
        );
    }
}

pub async fn index_folder(
    evidence_id: i64,
    partition_id: i64,
    folder_path: String,
    pool: &SqlitePool,
    app: &AppHandle,
    cancel_token: Option<Arc<AtomicBool>>,
) {
    info!("Starting internal index_folder via exhume_indexer");
    let (tx, rx) = mpsc::channel(100);

    let app_handle = app.clone();
    let progress_thread = std::thread::spawn(move || {
        pump_progress_blocking(rx, app_handle);
    });

    inner_index_folder(
        evidence_id,
        partition_id,
        folder_path,
        pool,
        Some(tx),
        cancel_token,
    )
    .await;
    let _ = progress_thread.join();
}
