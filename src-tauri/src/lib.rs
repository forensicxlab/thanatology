use env_logger;
use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs};
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use std::sync::{Arc, Mutex};

pub mod modules;

use modules::th_artifacts::extract_artifacts;
use modules::th_filesystem::{get_fs_info, read_file_bytes, read_file_prefix, read_file_slice};
use modules::th_identifier::identify_file_types;
use modules::th_index::index_partition;

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    path::PathBuf,
};
use tauri::AppHandle;
use tauri_plugin_sql::Migration;

async fn update_evidence_status(
    pool: &SqlitePool,
    evidence_id: i64,
    status: i64,
) -> Result<(), sqlx::Error> {
    let query = "UPDATE evidence SET status = ? WHERE id = ?";
    sqlx::query(query)
        .bind(status)
        .bind(evidence_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractionModule {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// Check if the evidence file exists at the given path.
#[tauri::command]
fn check_evidence_exists(path: String) -> Result<bool, String> {
    let path_obj = Path::new(&path);
    if path_obj.exists() {
        Ok(true)
    } else {
        Err(format!("File not found at path: {}", path))
    }
}

/// Auto-detect the disk image format based on headers extension or content.
/// otherwise we return "RAW".
#[tauri::command]
fn check_disk_image_format(path: String) -> Result<String, String> {
    let body: Body = Body::new(path.to_string(), "auto");
    Ok(body.format_description().to_string())
}

/// Exhuming the partitions from the disk image.
/// Returns the Partition object found by exhume_partitions.
#[tauri::command]
fn discover_partitions(path: String) -> Result<Partitions, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    match Partitions::new(&mut body) {
        Ok(discover_partitions) => Ok(discover_partitions),
        Err(err) => Err(format!("Could not discover partitions: {:?}", err)),
    }
}

/// Attempt to read the selected partition from the disk image.
/// Here we try to read the selected partitions.
#[tauri::command]
fn read_mbr_partition(partition: MBRPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let partition_size_result =
        (partition.size_sectors as u64).checked_mul(body.get_sector_size() as u64);

    let partition_size = match partition_size_result {
        Some(size) => size,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let fs = match detect_filesystem(&mut body, partition.first_byte_addr as u64, partition_size) {
        Ok(_) => true,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };
    Ok(fs)
}

#[tauri::command]
fn read_gpt_partition(partition: GPTPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let partition_size_result = (partition.ending_lba - partition.starting_lba + 1)
        .checked_mul(body.get_sector_size() as u64);
    let partition_first_byte_addr = partition
        .starting_lba
        .checked_mul(body.get_sector_size() as u64);
    let partition_size = match partition_size_result {
        Some(size) => size,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let partition_start = match partition_first_byte_addr {
        Some(offset) => offset,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let fs = match detect_filesystem(&mut body, partition_start, partition_size) {
        Ok(_) => true,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };
    Ok(fs)
}

#[tauri::command]
fn process_partitions(evidence_id: i64, db_path: String, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // ───────────────────────────────── DB CONNECT ────────────────────────────────
        let pool = match SqlitePool::connect(&db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("DB connection error: {err:?}"),
                    &app,
                );
                error!("DB connection error: {err:?}");
                return;
            }
        };

        // ───────────────────────────────── LOAD EVIDENCE ─────────────────────────────
        let evidence = match sqlx::query("SELECT * FROM evidence WHERE id = ?")
            .bind(evidence_id)
            .fetch_one(&pool)
            .await
        {
            Ok(row) => row,
            Err(err) => {
                error!("Error fetching evidence: {err:?}");
                return;
            }
        };

        // ───────────────────────────────── LOAD PARTITIONS ───────────────────────────
        let mbr_partitions =
            sqlx::query("SELECT * FROM mbr_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

        let gpt_partitions =
            sqlx::query("SELECT * FROM gpt_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

        // Build a *single* collection of references we can loop over twice.
        let all_partitions: Vec<&sqlx::sqlite::SqliteRow> =
            mbr_partitions.iter().chain(gpt_partitions.iter()).collect();

        let total_partitions = all_partitions.len() as u64;

        // ───────────────────────────────── INDEXATION (MODULE 0) ─────────────────────
        for (idx, partition) in all_partitions.iter().enumerate() {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                format!("Indexing partition {}/{}", idx + 1, total_partitions),
                &app,
            );

            index_partition(
                evidence_id,
                partition.get("id"),
                partition.get("size_sectors"),
                partition.get("first_byte_addr"),
                evidence.get("path"),
                &pool,
                &app,
            )
            .await;
        }

        // Mark evidence as “indexation completed” (status 3)
        if let Err(err) = update_evidence_status(&pool, evidence_id, 3).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to update evidence status: {err:?}"),
                &app,
            );
            error!("Failed to update evidence status: {err:?}");
            return;
        } else {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                "Successfully indexed all partitions.",
                &app,
            );
        }

        // ──────────────────────────────── POST-INDEX MODULES ─────────────────────────
        for partition in all_partitions {
            let mut body = Body::new(evidence.get("path"), "auto");
            let sector_size = body.get_sector_size() as u64;
            let partition_size_bytes: u64 = partition
                .get::<u64, _>("size_sectors")
                .saturating_mul(sector_size);

            let mut fs = match detect_filesystem(
                &mut body,
                partition.get("first_byte_addr"),
                partition_size_bytes,
            ) {
                Ok(fs) => fs,
                Err(err) => {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!("Could not detect filesystem: {}", err),
                        &app,
                    );
                    error!("Could not detect filesystem: {}", err);
                    continue; // move on to the next partition
                }
            };

            // ── Module 1: Artifact extraction ───────────────────────────────────────
            extract_artifacts(evidence_id, partition.get("id"), &app, &pool).await;

            update_evidence_status(&pool, evidence_id, 4).await.ok();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                "Successfully extracted artifacts",
                &app,
            );

            // ── Module 2: File-type identification ──────────────────────────────────
            identify_file_types(
                &mut fs,
                evidence_id,
                partition.get("id"),
                &app,
                pool.clone(),
            )
            .await;

            update_evidence_status(&pool, evidence_id, 5).await.ok();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                "Successfully finished file identification",
                &app,
            );

            // ── Module 3: (reserved for future work) ────────────────────────────────
        }
    });
}

#[tauri::command]
async fn read_chunk(path: String, offset: u64, length: u32) -> Result<Vec<u8>, String> {
    if length == 0 {
        return Ok(Vec::new());
    }

    // Own the path so we can move it safely into the thread-pool task.
    let path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        if !path.exists() {
            return Err("File does not exist".into());
        }

        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let file_len = file.metadata().map_err(|e| e.to_string())?.len();

        if offset >= file_len {
            return Ok(Vec::new());
        }

        let to_read = std::cmp::min(length as u64, file_len - offset) as usize;
        let mut buf = vec![0u8; to_read];

        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let read_bytes = file.read(&mut buf).map_err(|e| e.to_string())?;
        buf.truncate(read_bytes);
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Return the file length in bytes (`u64`), or an error message.
///
/// This is cheap enough to run directly on the async runtime thread.
#[tauri::command]
async fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn new_whiteboard(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(
        &app,
        "whiteboard",
        tauri::WebviewUrl::App("escalidraw.html".into()),
    )
    .title("Whiteboard")
    .maximized(true)
    .build()
    .unwrap();
}

#[tauri::command]
fn new_fileviewer(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(
        &app,
        "fileviewer",
        tauri::WebviewUrl::App("fileviewer.html".into()),
    )
    .title("Advanced File Viewer")
    .maximized(true)
    .build()
    .unwrap();
}

#[tauri::command]
fn new_shell(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(&app, "shell", tauri::WebviewUrl::App("shell.html".into()))
        .title("Shell")
        .maximized(true)
        .build()
        .unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(None::<DetectedFs<BodySlice>>)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:thanatology.db", init_migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            check_evidence_exists,
            check_disk_image_format,
            discover_partitions,
            read_mbr_partition,
            read_gpt_partition,
            process_partitions,
            get_fs_info,
            new_whiteboard,
            new_fileviewer,
            new_shell,
            read_chunk,
            file_size,
            read_file_slice,
            read_file_prefix,
            read_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
