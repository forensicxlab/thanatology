use env_logger;
use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs};
use exhume_filesystem::Filesystem;
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use std::sync::{Arc, Mutex};

pub mod modules;

use modules::th_artifacts::extract_artifacts;
use modules::th_evidences::create_case_with_evidence;
use modules::th_filesystem::{get_fs_info, read_file_bytes, read_file_prefix, read_file_slice};
use modules::utils::th_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};

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

/// Detect the filesystem inside a logical image (single filesystem snapshot).
#[tauri::command]
fn detect_logical_filesystem(path: String) -> Result<String, String> {
    let mut body: Body = Body::new(path.clone(), "auto");
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat image: {}", e))?
        .len();
    let fs = match detect_filesystem(&mut body, 0, size) {
        Ok(fs) => fs,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };
    return Ok(fs.filesystem_type());
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
        // ─────────────────────────────── DB CONNECT ───────────────────────────────
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

        // ─────────────────────────────── LOAD EVIDENCE ────────────────────────────
        let evidence = match sqlx::query("SELECT * FROM evidence WHERE id = ?")
            .bind(evidence_id)
            .fetch_one(&pool)
            .await
        {
            Ok(row) => row,
            Err(err) => {
                let msg = format!("Error fetching evidence {evidence_id}: {err:?}");
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    msg.clone(),
                    &app,
                );
                error!("{msg}");
                return;
            }
        };

        let evidence_path: String = evidence.get("path");

        // We’ll use Body to know sector size (and for later FS detection)
        let mut body_for_info = Body::new(evidence_path.clone(), "auto");
        let sector_size_u64 = body_for_info.get_sector_size() as u64;

        // ─────────────────────────────── LOAD PARTITIONS ──────────────────────────
        let mbr_rows = sqlx::query(
            "SELECT id, first_byte_addr, size_sectors FROM mbr_partition_entries WHERE evidence_id = ?",
        )
        .bind(evidence_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let gpt_rows = sqlx::query(
            "SELECT id, first_byte_addr, size_sectors FROM gpt_partition_entries WHERE evidence_id = ?",
        )
        .bind(evidence_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let logical_rows =
            sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();

        // If there are no entries anywhere, create a single logical partition that covers the whole file.
        if mbr_rows.is_empty() && gpt_rows.is_empty() && logical_rows.is_empty() {
            let file_len = match std::fs::metadata(&evidence_path) {
                Ok(m) => m.len(),
                Err(err) => {
                    let msg = format!("Failed to stat evidence file: {err}");
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        msg.clone(),
                        &app,
                    );
                    error!("{msg}");
                    return;
                }
            };

            match sqlx::query(
                "INSERT INTO logical_partition_entries (evidence_id, size) VALUES (?, ?)",
            )
            .bind(evidence_id)
            .bind(file_len as i64)
            .execute(&pool)
            .await
            {
                Ok(_) => {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        format!(
                            "No MBR/GPT partitions detected; created a logical partition covering {} bytes.",
                            file_len
                        ),
                        &app,
                    );
                }
                Err(err) => {
                    let msg = format!("Failed to create logical partition entry: {err:?}");
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        msg.clone(),
                        &app,
                    );
                    error!("{msg}");
                    return;
                }
            }
        }

        // Re-read logical rows (in case we just inserted one)
        let logical_rows = if logical_rows.is_empty() && mbr_rows.is_empty() && gpt_rows.is_empty()
        {
            sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_default()
        } else {
            logical_rows
        };

        // ──────────────────────── Build unified work list ────────────────────────
        struct WorkPartition {
            id: i64,
            first_byte_addr: u64,
            size_sectors: u64,
            size_bytes: u64,    // exact byte length for this region
            kind: &'static str, // "MBR" | "GPT" | "LOGICAL"
        }

        let mut work: Vec<WorkPartition> = Vec::new();

        // MBR
        for r in &mbr_rows {
            let id: i64 = r.get("id");
            let fba: i64 = r.get("first_byte_addr");
            let sz_sectors: i64 = r.get("size_sectors");
            let size_sectors_u64 = (sz_sectors as u64);
            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: size_sectors_u64,
                size_bytes: size_sectors_u64.saturating_mul(sector_size_u64),
                kind: "MBR",
            });
        }

        // GPT
        for r in &gpt_rows {
            let id: i64 = r.get("id");
            let fba: i64 = r.get("first_byte_addr");
            let sz_sectors: i64 = r.get("size_sectors");
            let size_sectors_u64 = (sz_sectors as u64);
            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: size_sectors_u64,
                size_bytes: size_sectors_u64.saturating_mul(sector_size_u64),
                kind: "GPT",
            });
        }

        // LOGICAL
        for r in &logical_rows {
            let id: i64 = r.get("id");
            let size: i64 = r.get("size"); // bytes
            let size_u64 = size as u64;

            // Derive sectors for reuse with indexer
            let size_sectors = if sector_size_u64 > 0 {
                size_u64 / sector_size_u64
            } else {
                0
            };

            work.push(WorkPartition {
                id,
                first_byte_addr: 0,
                size_sectors,
                size_bytes: size_u64, // keep exact size for FS detection and modules
                kind: "LOGICAL",
            });
        }

        if work.is_empty() {
            let msg = "No partitions (MBR/GPT/logical) available to process.".to_string();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                msg.clone(),
                &app,
            );
            error!("{msg}");
            return;
        }

        let total_partitions = work.len() as u64;

        // ────────────────────────────── INDEXATION ───────────────────────────────
        for (idx, p) in work.iter().enumerate() {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                format!(
                    "Indexing {} partition {}/{}",
                    p.kind,
                    idx + 1,
                    total_partitions
                ),
                &app,
            );

            // Reuse your existing indexing code path
            index_partition(
                evidence_id,
                p.id,
                p.size_sectors,    // for LOGICAL, derived from bytes/sector
                p.first_byte_addr, // 0 for LOGICAL
                evidence_path.clone(),
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
                format!("Failed to update evidence status to 3: {err:?}"),
                &app,
            );
            error!("Failed to update evidence status to 3: {err:?}");
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

        // ───────────────────────────── POST-INDEX ────────────────────────────────
        for p in work {
            // New Body for each partition to keep read state simple
            let mut body = Body::new(evidence_path.clone(), "auto");

            // Decide byte length for FS detection:
            // - MBR/GPT: size_sectors * sector_size
            // - LOGICAL: exact size_bytes from the logical table
            let bytes_len = match p.kind {
                "LOGICAL" => p.size_bytes,
                _ => p.size_sectors.saturating_mul(sector_size_u64),
            };

            // Filesystem detection
            let mut fs = match detect_filesystem(&mut body, p.first_byte_addr, bytes_len) {
                Ok(fs) => fs,
                Err(err) => {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!(
                            "Could not detect filesystem for {} partition (id {}): {}",
                            p.kind, p.id, err
                        ),
                        &app,
                    );
                    error!(
                        "Could not detect filesystem for {} partition (id {}): {}",
                        p.kind, p.id, err
                    );
                    continue; // move on to the next partition
                }
            };

            // ── Module 1: Artifact extraction
            extract_artifacts(evidence_id, p.id, &app, &pool).await;

            update_evidence_status(&pool, evidence_id, 4).await.ok();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                format!(
                    "Successfully extracted artifacts for {} partition (id {}).",
                    p.kind, p.id
                ),
                &app,
            );

            // ── Module 2: File-type identification
            identify_file_types(&mut fs, evidence_id, p.id, &app, pool.clone()).await;

            update_evidence_status(&pool, evidence_id, 5).await.ok();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                format!(
                    "Successfully finished file identification for {} partition (id {}).",
                    p.kind, p.id
                ),
                &app,
            );

            // ── Module 3: (reserved)
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
            create_case_with_evidence,
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
            read_file_bytes,
            detect_logical_filesystem
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
