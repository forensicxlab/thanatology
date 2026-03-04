use env_logger;
use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs};
use exhume_filesystem::Filesystem;
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
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
use modules::th_artifacts::{extract_artefacts, identify_artefacts, parse_pe, get_pml_events_count, get_pml_events, has_pml_data, has_evtx_data};
use modules::th_evidences::create_case_with_evidence;
use modules::th_filesystem::{
    get_fs_info, read_file_bytes, read_file_prefix, read_file_slice, read_file_slice_bytes,
    dump_file_to_disk, compute_hash,
};

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

async fn copy_schema_from_main(
    main_pool: &SqlitePool,
    evidence_pool: &SqlitePool,
) -> Result<(), sqlx::Error> {
    // Tables
    let table_rows = sqlx::query(
        "SELECT sql FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
         ORDER BY name;",
    )
    .fetch_all(main_pool)
    .await?;

    for r in table_rows {
        let sql: String = r.get("sql");
        // If schema already exists, ignore "already exists" errors
        if let Err(e) = sqlx::query(&sql).execute(evidence_pool).await {
            let msg = format!("{e:?}");
            if !msg.contains("already exists") {
                return Err(e);
            }
        }
    }

    // Indexes
    let index_rows = sqlx::query(
        "SELECT sql FROM sqlite_master
         WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
         ORDER BY name;",
    )
    .fetch_all(main_pool)
    .await?;

    for r in index_rows {
        let sql: String = r.get("sql");
        if let Err(e) = sqlx::query(&sql).execute(evidence_pool).await {
            let msg = format!("{e:?}");
            if !msg.contains("already exists") {
                return Err(e);
            }
        }
    }

    // Triggers
    let trig_rows = sqlx::query(
        "SELECT sql FROM sqlite_master
         WHERE type='trigger' AND sql IS NOT NULL
         ORDER BY name;",
    )
    .fetch_all(main_pool)
    .await?;

    for r in trig_rows {
        let sql: String = r.get("sql");
        if let Err(e) = sqlx::query(&sql).execute(evidence_pool).await {
            let msg = format!("{e:?}");
            if !msg.contains("already exists") {
                return Err(e);
            }
        }
    }

    // Views (optional)
    let view_rows = sqlx::query(
        "SELECT sql FROM sqlite_master
         WHERE type='view' AND sql IS NOT NULL
         ORDER BY name;",
    )
    .fetch_all(main_pool)
    .await?;

    for r in view_rows {
        let sql: String = r.get("sql");
        if let Err(e) = sqlx::query(&sql).execute(evidence_pool).await {
            let msg = format!("{e:?}");
            if !msg.contains("already exists") {
                return Err(e);
            }
        }
    }

    Ok(())
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
    // 1) Find the case_id for this evidence in main DB
    let case_id: i64 = sqlx::query_scalar("SELECT case_id FROM main_db.evidence WHERE id = ?;")
        .bind(evidence_id)
        .fetch_one(evidence_pool)
        .await?;

    // 2) Copy the parent case first (required for FK evidence.case_id -> cases.id)
    sqlx::query("INSERT OR REPLACE INTO cases SELECT * FROM main_db.cases WHERE id = ?;")
        .bind(case_id)
        .execute(evidence_pool)
        .await?;

    // 3) Copy evidence row
    sqlx::query("INSERT OR REPLACE INTO evidence SELECT * FROM main_db.evidence WHERE id = ?;")
        .bind(evidence_id)
        .execute(evidence_pool)
        .await?;

    // 4) Copy partitions for this evidence
    for table in [
        "mbr_partition_entries",
        "gpt_partition_entries",
        "logical_partition_entries",
    ] {
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
fn cancel_processing(evidence_id: i64, state: tauri::State<'_, ProcessingState>) {
    if let Ok(tokens) = state.tokens.lock() {
        if let Some(token) = tokens.get(&evidence_id) {
            token.store(true, Ordering::Relaxed);
        }
    }
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

        // Initialize evidence DB schema once (copy from main)
        match has_user_tables(&evidence_pool).await {
            Ok(false) => {
                if let Err(err) = copy_schema_from_main(&main_pool, &evidence_pool).await {
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

        // Sector size reference
        let body_for_info = Body::new(evidence_path.clone(), "auto");
        let sector_size_u64 = body_for_info.get_sector_size() as u64;

        // Load partitions FROM EVIDENCE DB (no shared locks with other evidences)
        let mbr_rows = sqlx::query(
            "SELECT id, first_byte_addr, size_sectors FROM mbr_partition_entries WHERE evidence_id = ?",
        )
        .bind(evidence_id)
        .fetch_all(&evidence_pool)
        .await
        .unwrap_or_default();

        let gpt_rows = sqlx::query(
            "SELECT id, first_byte_addr, size_sectors FROM gpt_partition_entries WHERE evidence_id = ?",
        )
        .bind(evidence_id)
        .fetch_all(&evidence_pool)
        .await
        .unwrap_or_default();

        let mut logical_rows =
            sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&evidence_pool)
                .await
                .unwrap_or_default();

        // Create logical partition entry (in evidence DB) if none exist
        if mbr_rows.is_empty() && gpt_rows.is_empty() && logical_rows.is_empty() {
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

            if let Err(err) = sqlx::query(
                "INSERT INTO logical_partition_entries (evidence_id, size) VALUES (?, ?)",
            )
            .bind(evidence_id)
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

            logical_rows =
                sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
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
        }

        let mut work: Vec<WorkPartition> = Vec::new();

        for r in &mbr_rows {
            let id: i64 = r.get("id");
            let fba: i64 = r.get("first_byte_addr");
            let sz: i64 = r.get("size_sectors");
            let ss = sz as u64;
            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: ss,
                size_bytes: ss.saturating_mul(sector_size_u64),
                kind: "MBR",
            });
        }

        for r in &gpt_rows {
            let id: i64 = r.get("id");
            let fba: i64 = r.get("first_byte_addr");
            let sz: i64 = r.get("size_sectors");
            let ss = sz as u64;
            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: ss,
                size_bytes: ss.saturating_mul(sector_size_u64),
                kind: "GPT",
            });
        }

        for r in &logical_rows {
            let id: i64 = r.get("id");
            let size: i64 = r.get("size");
            let size_u64 = size as u64;
            let size_sectors = if sector_size_u64 > 0 {
                size_u64 / sector_size_u64
            } else {
                0
            };
            work.push(WorkPartition {
                id,
                first_byte_addr: 0,
                size_sectors,
                size_bytes: size_u64,
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

        // Indexation (writes ONLY to evidence DB)
        let total = work.len() as u64;

        let cancel_token = Arc::new(AtomicBool::new(false));
        if let Ok(mut tokens) = app.state::<ProcessingState>().tokens.lock() {
            tokens.insert(evidence_id, cancel_token.clone());
        }

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

        // Post-index modules (also writes to evidence DB)
        for p in work {
            if cancel_token.load(Ordering::Relaxed) {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Info,
                    "Post-index processing cancelled by user.",
                    &app,
                );
                update_evidence_status(&main_pool, evidence_id, -1).await.ok();
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
                    continue;
                }
            };

            identify_artefacts(evidence_id, p.id, &app, &evidence_pool).await;
            let registry = build_registry();
            extract_artefacts(evidence_id, p.id, &app, &evidence_pool, &mut fs, &registry).await;

            update_evidence_status(&evidence_pool, evidence_id, 4)
                .await
                .ok();

            identify_file_types(&mut fs, evidence_id, p.id, &app, evidence_pool.clone()).await;
            update_evidence_status(&evidence_pool, evidence_id, 5)
                .await
                .ok();
        }

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

        // Initialize evidence DB schema once (copy from main)
        match has_user_tables(&evidence_pool).await {
            Ok(false) => {
                if let Err(err) = copy_schema_from_main(&main_pool, &evidence_pool).await {
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
        let mut logical_rows =
            sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
                .bind(evidence_id)
                .fetch_all(&evidence_pool)
                .await
                .unwrap_or_default();
        
        if logical_rows.is_empty() {
             // Fake size or calculate it? 0 is fine for folder root usually or we can scan.
             if let Err(err) = sqlx::query(
                "INSERT INTO logical_partition_entries (evidence_id, size) VALUES (?, ?)",
            )
            .bind(evidence_id)
            .bind(0)
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
             logical_rows =
                sqlx::query("SELECT id, size FROM logical_partition_entries WHERE evidence_id = ?")
                    .bind(evidence_id)
                    .fetch_all(&evidence_pool)
                    .await
                    .unwrap_or_default();
        }
        
        let partition_id = logical_rows[0].get::<i64, _>("id");

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

        index_folder(evidence_id, partition_id, folder_path.clone(), &evidence_pool, &app).await;
        
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
        let mut detected_fs: DetectedFs<BodySlice> = DetectedFs::Folder(fs);
        
        identify_artefacts(evidence_id, partition_id, &app, &evidence_pool).await;
        let registry = build_registry();
        extract_artefacts(evidence_id, partition_id, &app, &evidence_pool, &mut detected_fs, &registry).await;

        update_evidence_status(&evidence_pool, evidence_id, 4)
            .await
            .ok();

        identify_file_types(&mut detected_fs, evidence_id, partition_id, &app, evidence_pool.clone()).await;
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
        .manage(ProcessingState {
            tokens: Mutex::new(HashMap::new()),
        })
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
            read_file_slice_bytes,
            read_file_bytes,
            process_partitions,
            process_folder,
            detect_logical_filesystem,
            dump_file_to_disk,
            compute_hash,
            parse_pe,
            has_evtx_data,
            has_pml_data,
            cancel_processing,
            reset_evidence,
            modules::agents::investigate_with_agent,
            modules::agents::search_files_for_mention,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

