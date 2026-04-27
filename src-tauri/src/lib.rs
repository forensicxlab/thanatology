use env_logger;
use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::Filesystem;
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use exhume_indexer::ensure_tables as ensure_evidence_tables;
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub mod modules;

use exhume_artefacts::parsers::build_registry;
use modules::th_artifacts::{extract_artefacts, identify_artefacts, parse_pe, has_pml_data, has_evtx_data};
use modules::th_evidences::create_case_with_evidence;
use modules::th_filesystem::{
    get_fs_info, read_file_bytes, read_file_prefix, read_file_slice, read_file_slice_bytes,
    dump_file_to_disk, compute_hash,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub enable_text_specialist: bool,
    pub enable_image_specialist: bool,
    pub enable_audio_specialist: bool,
}

use modules::utils::th_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};

use modules::th_identifier::identify_file_types;

use modules::th_index::{index_folder, index_partition};

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    path::PathBuf,
};
use tauri_plugin_sql::Migration;
use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind, DialogExt};

#[derive(Debug, Clone, Deserialize)]
struct EvidenceImagePayload {
    caption: String,
    file_name: String,
    mime_type: String,
    source_kind: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
struct EvidenceImageResponse {
    id: i64,
    evidence_id: i64,
    caption: String,
    file_name: String,
    mime_type: String,
    source_kind: String,
    created_at: String,
    data_url: String,
}

#[derive(Debug, Clone, Serialize)]
struct ProcessingStatusPayload {
    message: String,
    status: i64,
}

fn as_sqlite_url(path_or_url: &str) -> String {
    if path_or_url.starts_with("sqlite:") {
        path_or_url.to_string()
    } else if path_or_url.starts_with('/') {
        format!("sqlite:{}", path_or_url)
    } else {
        format!("sqlite:{}", path_or_url)
    }
}

async fn open_pool(db_path_or_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str(&as_sqlite_url(db_path_or_url))?
        .with_regexp()
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(30))
        .create_if_missing(true);

    SqlitePoolOptions::new()
        // single-writer friendly; reduces lock contention inside each DB
        .max_connections(1)
        .connect_with(opts)
        .await
}

async fn has_user_tables(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    )
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}

fn escape_sqlite_single_quotes(s: &str) -> String {
    s.replace('\'', "''")
}

async fn attach_main_db(
    evidence_pool: &SqlitePool,
    main_db_path_fs: &str,
) -> Result<(), sqlx::Error> {
    // ATTACH expects filesystem path (not sqlite: URL)
    let escaped = escape_sqlite_single_quotes(main_db_path_fs);
    let sql = format!("ATTACH DATABASE '{}' AS main_db;", escaped);
    sqlx::query(&sql).execute(evidence_pool).await?;
    Ok(())
}

async fn copy_evidence_scoped_rows(
    evidence_pool: &SqlitePool,
    evidence_id: i64,
) -> Result<(), sqlx::Error> {
    // Copy the evidence row into the portable evidence DB.
    sqlx::query(
        "INSERT OR REPLACE INTO evidence (id, case_id, name, type, path, description, status)          SELECT id, case_id, name, type, path, description, status FROM main_db.evidence WHERE id = ?;",
    )
    .bind(evidence_id)
    .execute(evidence_pool)
    .await?;

    // Copy portable partitions for this evidence.
    for table in ["partitions"] {
        let del = format!("DELETE FROM {} WHERE evidence_id = ?;", table);
        let ins = format!(
            "INSERT OR REPLACE INTO {t} SELECT * FROM main_db.{t} WHERE evidence_id = ?;",
            t = table
        );

        sqlx::query(&del)
            .bind(evidence_id)
            .execute(evidence_pool)
            .await
            .ok();

        sqlx::query(&ins)
            .bind(evidence_id)
            .execute(evidence_pool)
            .await
            .ok();
    }

    Ok(())
}
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

pub struct ProcessingState {
    pub tokens: Mutex<HashMap<i64, Arc<AtomicBool>>>,
}

#[tauri::command]
async fn cancel_processing(
    evidence_id: i64,
    state: tauri::State<'_, ProcessingState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if let Ok(tokens) = state.tokens.lock() {
        if let Some(token) = tokens.get(&evidence_id) {
            token.store(true, Ordering::Relaxed);
        } else {
            return Err("No active processing task found for this evidence.".to_string());
        }
    } else {
        return Err("Failed to acquire state lock.".to_string());
    }

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    let main_db_path = format!("{}/thanatology.db", base_dir.display());

    let main_pool = open_pool(&main_db_path)
        .await
        .map_err(|e| format!("Failed to open main DB: {}", e))?;

    update_evidence_status(&main_pool, evidence_id, -2)
        .await
        .map_err(|e| format!("Failed to update evidence status: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn reset_evidence(
    evidence_id: i64,
    main_db_path: String,
    evidence_db_path: String,
) -> Result<(), String> {
    // Connect to main pool to reset status to 1 (Pending Start)
    // so we don't have to repeat partition discovery/selection.
    let main_pool = open_pool(&main_db_path)
        .await
        .map_err(|e| format!("Failed to open main DB: {}", e))?;

    update_evidence_status(&main_pool, evidence_id, 1)
        .await
        .map_err(|e| format!("Failed to update evidence status: {}", e))?;

    // Delete the evidence specific database file if it exists
    let e_path = std::path::Path::new(&evidence_db_path);
    if e_path.exists() {
        if let Err(e) = std::fs::remove_file(e_path) {
            error!("Failed to delete evidence DB {}: {}", evidence_db_path, e);
            return Err(format!("Failed to delete evidence DB: {}", e));
        }
        
        // Also cleanup sqlite-wal and sqlite-shm if they exist
        let wal_path = format!("{}-wal", evidence_db_path);
        if std::path::Path::new(&wal_path).exists() {
             std::fs::remove_file(&wal_path).ok();
        }
        let shm_path = format!("{}-shm", evidence_db_path);
        if std::path::Path::new(&shm_path).exists() {
             std::fs::remove_file(&shm_path).ok();
        }
    }

    info!("Successfully reset evidence ID {}", evidence_id);
    Ok(())
}

#[tauri::command]
async fn save_evidence_images(
    evidence_id: i64,
    images: Vec<EvidenceImagePayload>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if images.is_empty() {
        return Ok(());
    }

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    let main_db_path = format!("{}/thanatology.db", base_dir.display());

    let pool = open_pool(&main_db_path)
        .await
        .map_err(|e| format!("Failed to open main DB: {}", e))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    for image in images {
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
        .map_err(|e| format!("Failed to save evidence image: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit evidence images: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_evidence_images(
    evidence_id: i64,
    app: tauri::AppHandle,
) -> Result<Vec<EvidenceImageResponse>, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    let main_db_path = format!("{}/thanatology.db", base_dir.display());

    let pool = open_pool(&main_db_path)
        .await
        .map_err(|e| format!("Failed to open main DB: {}", e))?;

    let rows = sqlx::query(
        "SELECT id, evidence_id, caption, file_name, mime_type, source_kind, data, created_at
         FROM evidence_images
         WHERE evidence_id = ?
         ORDER BY id",
    )
    .bind(evidence_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch evidence images: {}", e))?;

    rows.into_iter()
        .map(|row| {
            let mime_type: String = row
                .try_get("mime_type")
                .map_err(|e| format!("Failed to decode mime type: {}", e))?;
            let data: Vec<u8> = row
                .try_get("data")
                .map_err(|e| format!("Failed to decode evidence image data: {}", e))?;

            Ok(EvidenceImageResponse {
                id: row
                    .try_get("id")
                    .map_err(|e| format!("Failed to decode image id: {}", e))?,
                evidence_id: row
                    .try_get("evidence_id")
                    .map_err(|e| format!("Failed to decode evidence id: {}", e))?,
                caption: row
                    .try_get("caption")
                    .map_err(|e| format!("Failed to decode caption: {}", e))?,
                file_name: row
                    .try_get("file_name")
                    .map_err(|e| format!("Failed to decode file name: {}", e))?,
                mime_type: mime_type.clone(),
                source_kind: row
                    .try_get("source_kind")
                    .map_err(|e| format!("Failed to decode source kind: {}", e))?,
                created_at: row
                    .try_get("created_at")
                    .map_err(|e| format!("Failed to decode timestamp: {}", e))?,
                data_url: format!(
                    "data:{};base64,{}",
                    mime_type,
                    BASE64_STANDARD.encode(data)
                ),
            })
        })
        .collect()
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

    let key_material = partition
        .fvek
        .as_deref()
        .map(|hex| {
            hex::decode(hex)
                .map(|fvek| exhume_filesystem::detected_fs::KeyMaterial {
                    bitlocker_fvek: Some(fvek),
                })
                .map_err(|e| format!("Invalid BitLocker FVEK: {}", e))
        })
        .transpose()?;

    let fs = match detect_filesystem(
        &mut body,
        partition.first_byte_addr as u64,
        partition_size,
        key_material,
    ) {
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
    let fs = match detect_filesystem(&mut body, 0, size, None) {
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

    let key_material = partition
        .fvek
        .as_deref()
        .map(|hex| {
            hex::decode(hex)
                .map(|fvek| exhume_filesystem::detected_fs::KeyMaterial {
                    bitlocker_fvek: Some(fvek),
                })
                .map_err(|e| format!("Invalid BitLocker FVEK: {}", e))
        })
        .transpose()?;

    let fs = match detect_filesystem(&mut body, partition_start, partition_size, key_material) {
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
fn process_partitions(
    evidence_id: i64,
    main_db_path: String,
    evidence_db_path: String,
    app: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        // Ensure per-evidence DB folder exists
        if let Some(parent) = std::path::Path::new(&evidence_db_path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed to create evidence DB directory: {e}"),
                    &app,
                );
                error!("Failed to create evidence DB directory: {e}");
                return;
            }
        }

        // Connect pools
        let main_pool = match open_pool(&main_db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Main DB connection error: {err:?}"),
                    &app,
                );
                error!("Main DB connection error: {err:?}");

                return;
            }
        };

        let evidence_pool = match open_pool(&evidence_db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Evidence DB connection error: {err:?}"),
                    &app,
                );
                error!("Evidence DB connection error: {err:?}");

                return;
            }
        };

        // Initialize evidence DB schema once using the portable Exhume schema.
        match has_user_tables(&evidence_pool).await {
            Ok(false) => {
                if let Err(err) = ensure_evidence_tables(&evidence_pool).await {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!("Failed to initialize evidence DB schema: {err:?}"),
                        &app,
                    );
                    error!("Failed to initialize evidence DB schema: {err:?}");

                    return;
                }
            }
            Ok(true) => {}
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed checking evidence DB schema: {err:?}"),
                    &app,
                );
                error!("Failed checking evidence DB schema: {err:?}");

                return;
            }
        }

        // Attach main DB (filesystem path) and copy evidence rows into evidence DB
        if let Err(err) = attach_main_db(&evidence_pool, &main_db_path).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to attach main DB: {err:?}"),
                &app,
            );
            error!("Failed to attach main DB: {err:?}");
            return;
        }

        if let Err(err) = copy_evidence_scoped_rows(&evidence_pool, evidence_id).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to copy evidence rows into evidence DB: {err:?}"),
                &app,
            );
            error!("Failed to copy evidence rows into evidence DB: {err:?}");
            return;
        }

        // Load evidence path from MAIN DB (authoritative)
        let evidence_row = match sqlx::query("SELECT * FROM evidence WHERE id = ?")
            .bind(evidence_id)
            .fetch_one(&main_pool)
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

        let evidence_path: String = evidence_row.get("path");
        let evidence_status: i64 = evidence_row.try_get("status").unwrap_or(0);
        let actual_status = if evidence_status < 0 && evidence_status != -2 {
            evidence_status.abs()
        } else {
            evidence_status
        };

        // Sector size reference
        let body_for_info = Body::new(evidence_path.clone(), "auto");
        let sector_size_u64 = body_for_info.get_sector_size() as u64;

        // Load partitions FROM EVIDENCE DB (no shared locks with other evidences)
        let mut partition_rows = sqlx::query(
            "SELECT id, kind, first_byte_addr, size_sectors, sector_size, size_bytes, fvek FROM partitions WHERE evidence_id = ? ORDER BY id",
        )
        .bind(evidence_id)
        .fetch_all(&evidence_pool)
        .await
        .unwrap_or_default();

        // Create logical partition entry (in evidence DB) if none exist
        if partition_rows.is_empty() {
            let file_len = match Body::new(evidence_path.clone(), "auto").seek(std::io::SeekFrom::End(0)) {
                Ok(size) => size,
                Err(err) => {
                    let msg = format!("Failed to determine evidence file size: {err}");
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

            let size_sectors = if sector_size_u64 > 0 {
                file_len / sector_size_u64
            } else {
                0
            };

            if let Err(err) = sqlx::query(
                "INSERT INTO partitions (evidence_id, kind, first_byte_addr, size_sectors, sector_size, size_bytes) VALUES (?, 'logical', 0, ?, ?, ?)",
            )
            .bind(evidence_id)
            .bind(size_sectors as i64)
            .bind(sector_size_u64 as i64)
            .bind(file_len as i64)
            .execute(&evidence_pool)
            .await
            {
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

            partition_rows = sqlx::query(
                "SELECT id, kind, first_byte_addr, size_sectors, sector_size, size_bytes, fvek FROM partitions WHERE evidence_id = ? ORDER BY id",
            )
            .bind(evidence_id)
            .fetch_all(&evidence_pool)
            .await
            .unwrap_or_default();
        }

        struct WorkPartition {
            id: i64,
            first_byte_addr: u64,
            size_sectors: u64,
            size_bytes: u64,
            kind: &'static str,
            fvek: Option<String>,
        }

        let mut work: Vec<WorkPartition> = Vec::new();

        for r in &partition_rows {
            let id: i64 = r.get("id");
            let kind: String = r.get("kind");
            let fba: i64 = r.get("first_byte_addr");
            let size_sectors: i64 = r.get("size_sectors");
            let size_bytes: i64 = r.get("size_bytes");
            let fvek: Option<String> = r.try_get("fvek").unwrap_or(None);
            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: size_sectors as u64,
                size_bytes: size_bytes as u64,
                kind: match kind.as_str() {
                    "mbr" => "MBR",
                    "gpt" => "GPT",
                    "folder" => "FOLDER",
                    _ => "LOGICAL",
                },
                fvek,
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

        // Indexation (writes ONLY to evidence DB)
        let total = work.len() as u64;

        let cancel_token = Arc::new(AtomicBool::new(false));
        if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
            tokens.insert(evidence_id, cancel_token.clone());
        }

        if actual_status < 3 {
            for (idx, p) in work.iter().enumerate() {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "Partition processing cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -1).await.ok();
                    if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                        tokens.remove(&evidence_id);
                    }
                    return;
                }

                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Info,
                    format!("Indexing {} partition {}/{}", p.kind, idx + 1, total),
                    &app,
                );

                index_partition(
                    evidence_id,
                    p.id,
                    p.size_sectors,
                    p.first_byte_addr,
                    evidence_path.clone(),
                    &evidence_pool,
                    &app,
                    Some(cancel_token.clone()),
                )
                .await;
            }

            // Update main DB status for UI completion screen
            if let Err(err) = update_evidence_status(&main_pool, evidence_id, 3).await {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed to update main evidence status to 3: {err:?}"),
                    &app,
                );
                return;
            }

            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                "Successfully indexed all partitions.",
                &app,
            );
        }

        // Post-index file identification (writes to evidence DB)
        if actual_status < 4 {
            for p in &work {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "File identification cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -3).await.ok();
                    if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                        tokens.remove(&evidence_id);
                    }
                    return;
                }

                let mut body = Body::new(evidence_path.clone(), "auto");

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p.fvek.clone().and_then(|h| hex::decode(h).ok()).map(|fvek| exhume_filesystem::detected_fs::KeyMaterial { bitlocker_fvek: Some(fvek) });

                let mut fs = match detect_filesystem(&mut body, p.first_byte_addr, bytes_len, key_material) {
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
                        continue;
                    }
                };

                identify_file_types(&mut fs, evidence_id, p.id, &app, evidence_pool.clone()).await;
            }

            update_evidence_status(&evidence_pool, evidence_id, 4)
                .await
                .ok();
        }

        // Post-index artefact discovery and parsing (also writes to evidence DB)
        if actual_status < 5 {
            for p in &work {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "Artefact identification cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -4).await.ok();
                    if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                        tokens.remove(&evidence_id);
                    }
                    return;
                }

                let mut body = Body::new(evidence_path.clone(), "auto");

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p.fvek.clone().and_then(|h| hex::decode(h).ok()).map(|fvek| exhume_filesystem::detected_fs::KeyMaterial { bitlocker_fvek: Some(fvek) });

                if detect_filesystem(&mut body, p.first_byte_addr, bytes_len, key_material).is_err() {
                    continue;
                }

                identify_artefacts(evidence_id, p.id, &app, &evidence_pool).await;
            }

            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                ProcessingStatusPayload {
                    message: "Artefact identification complete.".to_string(),
                    status: 4,
                },
                &app,
            );

            let registry = build_registry();

            for p in &work {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "Artefact extraction cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -4).await.ok();
                    if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                        tokens.remove(&evidence_id);
                    }
                    return;
                }

                let mut body = Body::new(evidence_path.clone(), "auto");

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p.fvek.clone().and_then(|h| hex::decode(h).ok()).map(|fvek| exhume_filesystem::detected_fs::KeyMaterial { bitlocker_fvek: Some(fvek) });

                let mut fs = match detect_filesystem(&mut body, p.first_byte_addr, bytes_len, key_material) {
                    Ok(fs) => fs,
                    Err(_) => continue,
                };

                extract_artefacts(evidence_id, p.id, &app, &evidence_pool, &mut fs, &registry, Some(cancel_token.clone())).await;
            }

            update_evidence_status(&evidence_pool, evidence_id, 5)
                .await
                .ok();
        }

        update_evidence_status(&main_pool, evidence_id, 5).await.ok();
        if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
            tokens.remove(&evidence_id);
        }
    });
}

#[tauri::command]
fn process_folder(
    evidence_id: i64,
    main_db_path: String,
    evidence_db_path: String,
    folder_path: String,
    app: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
         // Ensure per-evidence DB folder exists
         if let Some(parent) = std::path::Path::new(&evidence_db_path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed to create evidence DB directory: {e}"),
                    &app,
                );
                error!("Failed to create evidence DB directory: {e}");
                return;
            }
        }

        // Connect pools
        let main_pool = match open_pool(&main_db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Main DB connection error: {err:?}"),
                    &app,
                );
                error!("Main DB connection error: {err:?}");

                return;
            }
        };

        let evidence_pool = match open_pool(&evidence_db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Evidence DB connection error: {err:?}"),
                    &app,
                );
                error!("Evidence DB connection error: {err:?}");

                return;
            }
        };

        // Initialize evidence DB schema once using the portable Exhume schema.
        match has_user_tables(&evidence_pool).await {
            Ok(false) => {
                if let Err(err) = ensure_evidence_tables(&evidence_pool).await {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!("Failed to initialize evidence DB schema: {err:?}"),
                        &app,
                    );
                    error!("Failed to initialize evidence DB schema: {err:?}");

                    return;
                }
            }
            Ok(true) => {}
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed checking evidence DB schema: {err:?}"),
                    &app,
                );
                error!("Failed checking evidence DB schema: {err:?}");

                return;
            }
        }

        // Attach main DB (filesystem path) and copy evidence rows into evidence DB
        if let Err(err) = attach_main_db(&evidence_pool, &main_db_path).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to attach main DB: {err:?}"),
                &app,
            );
            error!("Failed to attach main DB: {err:?}");
            return;
        }

        if let Err(err) = copy_evidence_scoped_rows(&evidence_pool, evidence_id).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to copy evidence rows into evidence DB: {err:?}"),
                &app,
            );
            error!("Failed to copy evidence rows into evidence DB: {err:?}");
            return;
        }
        
         // Create logical partition entry (in evidence DB) if none exist
         // For folders, we treat it as one logical partition
        let mut partition_rows =
            sqlx::query("SELECT id FROM partitions WHERE evidence_id = ? AND kind IN ('logical', 'folder') ORDER BY id")
                .bind(evidence_id)
                .fetch_all(&evidence_pool)
                .await
                .unwrap_or_default();
        
        if partition_rows.is_empty() {
             if let Err(err) = sqlx::query(
                "INSERT INTO partitions (evidence_id, kind, first_byte_addr, size_sectors, sector_size, size_bytes) VALUES (?, 'folder', 0, 0, 0, 0)",
            )
            .bind(evidence_id)
            .execute(&evidence_pool)
            .await
            {
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
             partition_rows =
                sqlx::query("SELECT id FROM partitions WHERE evidence_id = ? AND kind IN ('logical', 'folder') ORDER BY id")
                    .bind(evidence_id)
                    .fetch_all(&evidence_pool)
                    .await
                    .unwrap_or_default();
        }
        
        let partition_id = partition_rows[0].get::<i64, _>("id");

        let cancel_token = Arc::new(AtomicBool::new(false));
        if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
            tokens.insert(evidence_id, cancel_token.clone());
        }

        if cancel_token.load(Ordering::Relaxed) {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                "Folder processing cancelled by user.",
                &app,
            );
            update_evidence_status(&main_pool, evidence_id, -1).await.ok();
            if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                tokens.remove(&evidence_id);
            }
            return;
        }

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Info,
            format!("Indexing Folder..."),
            &app,
        );

        index_folder(evidence_id, partition_id, folder_path.clone(), &evidence_pool, &app, Some(cancel_token.clone())).await;
        
        // Update main DB status for UI completion screen
        if let Err(err) = update_evidence_status(&main_pool, evidence_id, 3).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to update main evidence status to 3: {err:?}"),
                &app,
            );
            return;
        }

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            "Successfully indexed folder.",
            &app,
        );
        
        // Post index modules?
        // Identify artefacts etc.
        // Similar to process_partitions but using FolderFS

        if cancel_token.load(Ordering::Relaxed) {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                "Folder post-index processing cancelled by user.",
                &app,
            );
            update_evidence_status(&main_pool, evidence_id, -1).await.ok();
            if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                tokens.remove(&evidence_id);
            }
            return;
        }
        
        let fs = exhume_filesystem::folder_impl::FolderFS::new(std::path::PathBuf::from(&folder_path));
        let mut detected_fs: exhume_filesystem::detected_fs::DetectedFs<exhume_filesystem::detected_fs::ImageStream> = exhume_filesystem::detected_fs::DetectedFs::Folder(fs);
        
        identify_file_types(&mut detected_fs, evidence_id, partition_id, &app, evidence_pool.clone()).await;
        update_evidence_status(&evidence_pool, evidence_id, 4)
            .await
            .ok();

        identify_artefacts(evidence_id, partition_id, &app, &evidence_pool).await;
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "Artefact identification complete.".to_string(),
                status: 4,
            },
            &app,
        );

        if cancel_token.load(Ordering::Relaxed) {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                "Artefact extraction cancelled by user.",
                &app,
            );
            update_evidence_status(&main_pool, evidence_id, -4).await.ok();
            if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
                tokens.remove(&evidence_id);
            }
            return;
        }

        let registry = build_registry();
        extract_artefacts(evidence_id, partition_id, &app, &evidence_pool, &mut detected_fs, &registry, Some(cancel_token.clone())).await;

        update_evidence_status(&evidence_pool, evidence_id, 5)
            .await
            .ok();

        if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
            tokens.remove(&evidence_id);
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
async fn new_whiteboard(app: AppHandle) -> Result<(), String> {
    let label = "whiteboard";

    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("escalidraw.html".into()))
        .title("Whiteboard")
        .maximized(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_fileviewer(app: AppHandle) -> Result<(), String> {
    let label = "fileviewer";

    if let Some(win) = app.get_webview_window(label) {
        // Bring to foreground (handle minimized/hidden cases)
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("fileviewer.html".into()))
        .title("Advanced File Viewer")
        .maximized(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_shell(app: AppHandle) -> Result<(), String> {
    let label = "shell";

    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("shell.html".into()))
        .title("Shell")
        .maximized(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_leechcore(app: AppHandle) -> Result<(), String> {
    let label = "leechcore";

    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("leechcore.html".into()))
        .title("LeechCore")
        .maximized(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();
    let mut builder = tauri::Builder::default()
        .manage(modules::th_filesystem::SharedState::default())
        .manage(ProcessingState {
            tokens: Mutex::new(HashMap::new()),
        })
        .manage(modules::th_memory::MemoryExecutionState::default())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() != "main" {
                    return;
                }

                let state_guard = window.state::<ProcessingState>();
                let is_processing = if let Ok(tokens) = state_guard.tokens.lock() {
                    !tokens.is_empty()
                } else {
                    false
                };

                if is_processing {
                    api.prevent_close();
                    let app_handle = window.app_handle().clone();
                    window.dialog()
                        .message("Evidences are currently being processed. Are you sure you want to exit? The current step will be saved and can be resumed later.")
                        .title("Processing in Progress")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom("Exit".to_string(), "Cancel".to_string()))
                        .show(move |result| {
                            if result {
                                let app_clone = app_handle.clone();

                                // Hide main window to simulate immediate close
                                if let Some(main_win) = app_clone.get_webview_window("main") {
                                    let _ = main_win.hide();
                                }

                                // Trigger cancellation for all tasks and collect active evidence IDs
                                let state_guard = app_clone.state::<ProcessingState>();
                                let active_evidences: Vec<i64> = if let Ok(tokens) = state_guard.tokens.lock() {
                                    for (_, token) in tokens.iter() {
                                        token.store(true, std::sync::atomic::Ordering::Relaxed);
                                    }
                                    tokens.keys().cloned().collect()
                                } else {
                                    Vec::new()
                                };

                                // Spawn a targeted task to force DB states to Stopped (-1) and exit immediately
                                tauri::async_runtime::spawn(async move {
                                    use tauri::Manager;
                                    if let Ok(base_dir) = app_clone.path().app_local_data_dir() {
                                        let main_db_path = format!("{}/thanatology.db", base_dir.display());
                                        if let Ok(pool) = sqlx::SqlitePool::connect(&format!("sqlite:{}", main_db_path)).await {
                                            for eid in active_evidences {
                                                // Force status to "Stopped/Error" (-1)
                                                let _ = sqlx::query("UPDATE evidence SET status = -1 WHERE id = ? AND status > 0 AND status < 3")
                                                    .bind(eid)
                                                    .execute(&pool)
                                                    .await;
                                            }
                                        }
                                    }
                                    // Kill the app immediately instead of waiting for long operations to gracefully stop
                                    app_clone.exit(0);
                                });
                            }
                        });
                }
            }
            _ => {}
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_macos_permissions::init())
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
            new_leechcore,
            read_chunk,
            file_size,
            read_file_slice,
            read_file_prefix,
            read_file_slice_bytes,
            read_file_bytes,
            process_partitions,
            modules::th_memory::discover_memory_dma,
            modules::th_memory::run_memory_module,
            process_folder,
            detect_logical_filesystem,
            dump_file_to_disk,
            compute_hash,
            parse_pe,
            has_evtx_data,
            has_pml_data,
            cancel_processing,
            reset_evidence,
            save_evidence_images,
            get_evidence_images,
            modules::agents::investigate_with_agent,
            modules::agents::search_files_for_mention,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
