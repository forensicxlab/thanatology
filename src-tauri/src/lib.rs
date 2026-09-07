use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use env_logger;
use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::Filesystem;
use exhume_indexer::ensure_tables as ensure_evidence_tables;
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub mod modules;

use exhume_artefacts::parsers::build_registry;
use modules::th_artifacts::{
    extract_artefacts, has_evtx_data, has_pml_data, identify_artefacts, parse_pe,
    populate_filesystem_timeline,
};
use modules::th_evidences::create_case_with_evidence;
use modules::th_filesystem::{
    compute_hash, dump_file_to_disk, get_fs_info, parse_plist_file, read_file_bytes,
    read_file_prefix, read_file_slice, read_file_slice_bytes, register_media_source,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub enable_text_specialist: bool,
    pub enable_image_specialist: bool,
    pub enable_audio_specialist: bool,
    #[serde(default = "default_batch_size")]
    pub batch_size: u32,
}

fn default_batch_size() -> u32 {
    10
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
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_sql::Migration;

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
    phase: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhysicalDevice {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub size_human: String,
    pub is_internal: bool,
    pub protocol: String,
}

#[cfg(target_os = "macos")]
fn list_physical_devices_macos() -> Result<Vec<PhysicalDevice>, String> {
    use std::process::Command;

    let list_out = Command::new("diskutil")
        .args(["list"])
        .output()
        .map_err(|e| format!("Failed to run diskutil list: {e}"))?;

    let list_str = String::from_utf8_lossy(&list_out.stdout);
    let disk_re = regex::Regex::new(r"^(/dev/disk\d+)\s+\(([^)]+)\):").unwrap();

    let mut disk_entries: Vec<(String, bool)> = Vec::new();
    for line in list_str.lines() {
        if let Some(caps) = disk_re.captures(line.trim()) {
            let path = caps[1].to_string();
            let attrs = caps[2].to_string();
            // Skip virtual (synthesized) disks like APFS containers
            let is_internal = attrs.contains("internal") && !attrs.contains("virtual");
            let is_virtual = attrs.contains("virtual");
            if !is_virtual {
                disk_entries.push((path, is_internal));
            }
        }
    }

    let mut devices = Vec::new();
    for (path, is_internal) in disk_entries {
        let info_out = Command::new("diskutil")
            .args(["info", &path])
            .output()
            .map_err(|e| format!("Failed to run diskutil info for {path}: {e}"))?;

        let info_str = String::from_utf8_lossy(&info_out.stdout);
        let mut name = String::new();
        let mut size: u64 = 0;
        let mut size_human = String::new();
        let mut protocol = String::new();

        for line in info_str.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("Device/Media Name:") {
                name = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("Disk Size:") {
                let rest = rest.trim();
                // Format: "500.1 GB (500107862016 Bytes) (exactly ...)"
                if let Some(human) = rest.split('(').next() {
                    size_human = human.trim().to_string();
                }
                if let Some(bytes_part) = rest.split('(').nth(1) {
                    if let Some(bytes_str) = bytes_part.split_whitespace().next() {
                        size = bytes_str.parse().unwrap_or(0);
                    }
                }
            } else if let Some(rest) = line.strip_prefix("Protocol:") {
                protocol = rest.trim().to_string();
            }
        }

        if name.is_empty() {
            name = path.replace("/dev/", "");
        }

        devices.push(PhysicalDevice {
            path,
            name,
            size,
            size_human,
            is_internal,
            protocol,
        });
    }

    Ok(devices)
}

#[tauri::command]
fn list_physical_devices() -> Result<Vec<PhysicalDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        list_physical_devices_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Device listing is not supported on this platform.".to_string())
    }
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

    // Flush previous analysis results to prevent duplicates when restarting after abort.
    for table in ["artifact_objects", "artifacts", "system_files"] {
        let del = format!("DELETE FROM {} WHERE evidence_id = ?;", table);
        sqlx::query(&del)
            .bind(evidence_id)
            .execute(evidence_pool)
            .await
            .ok();
    }

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

pub struct ProcessingEntry {
    pub cancel: Arc<AtomicBool>,
    pub handle: tauri::async_runtime::JoinHandle<()>,
}

pub struct ProcessingState {
    pub tokens: Mutex<HashMap<i64, ProcessingEntry>>,
    lifecycle_operations: Mutex<HashSet<i64>>,
}

pub(crate) struct ProcessingLifecycleGuard<'a> {
    state: &'a ProcessingState,
    evidence_ids: Vec<i64>,
}

impl Drop for ProcessingLifecycleGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.state.lifecycle_operations.lock() {
            for evidence_id in &self.evidence_ids {
                operations.remove(evidence_id);
            }
        }
    }
}

impl ProcessingState {
    fn reap_finished_task(tokens: &mut HashMap<i64, ProcessingEntry>, evidence_id: i64) {
        if tokens
            .get(&evidence_id)
            .is_some_and(|entry| entry.handle.inner().is_finished())
        {
            tokens.remove(&evidence_id);
        }
    }

    /// Reserve an evidence lifecycle transition while proving no processing
    /// task is live. The marker remains held across awaits through the returned
    /// guard, so processing/cancel/reset/relocate/delete cannot cross each
    /// other between a liveness check and a filesystem/database mutation.
    pub(crate) fn begin_idle_lifecycle(
        &self,
        evidence_id: i64,
        operation: &str,
    ) -> Result<ProcessingLifecycleGuard<'_>, String> {
        let mut operations = self
            .lifecycle_operations
            .lock()
            .map_err(|_| "Failed to inspect evidence lifecycle operations.".to_string())?;
        if operations.contains(&evidence_id) {
            return Err(format!(
                "Cannot {operation} evidence {evidence_id}: another lifecycle operation is in progress."
            ));
        }
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "Failed to inspect active evidence processing tasks.".to_string())?;
        Self::reap_finished_task(&mut tokens, evidence_id);
        if tokens.contains_key(&evidence_id) {
            return Err(format!(
                "Cannot {operation} evidence {evidence_id} while processing is active. Stop it first."
            ));
        }
        operations.insert(evidence_id);
        Ok(ProcessingLifecycleGuard {
            state: self,
            evidence_ids: vec![evidence_id],
        })
    }

    pub(crate) fn begin_idle_lifecycle_batch(
        &self,
        evidence_ids: &[i64],
        operation: &str,
    ) -> Result<ProcessingLifecycleGuard<'_>, String> {
        let mut operations = self
            .lifecycle_operations
            .lock()
            .map_err(|_| "Failed to inspect evidence lifecycle operations.".to_string())?;
        let conflicting = evidence_ids
            .iter()
            .filter(|evidence_id| operations.contains(evidence_id))
            .copied()
            .collect::<Vec<_>>();
        if !conflicting.is_empty() {
            return Err(format!(
                "Cannot {operation} evidence while another lifecycle operation is active: {}",
                conflicting
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "Failed to inspect active evidence processing tasks.".to_string())?;
        for evidence_id in evidence_ids {
            Self::reap_finished_task(&mut tokens, *evidence_id);
        }
        let active = evidence_ids
            .iter()
            .filter(|evidence_id| tokens.contains_key(evidence_id))
            .copied()
            .collect::<Vec<_>>();
        if !active.is_empty() {
            return Err(format!(
                "Cannot {operation} evidence while processing is active: {}",
                active
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        operations.extend(evidence_ids.iter().copied());
        Ok(ProcessingLifecycleGuard {
            state: self,
            evidence_ids: evidence_ids.to_vec(),
        })
    }

    fn begin_cancellation(
        &self,
        evidence_id: i64,
    ) -> Result<(ProcessingLifecycleGuard<'_>, Option<ProcessingEntry>), String> {
        let mut operations = self
            .lifecycle_operations
            .lock()
            .map_err(|_| "Failed to acquire evidence lifecycle lock.".to_string())?;
        if operations.contains(&evidence_id) {
            return Err(format!(
                "Cannot stop evidence {evidence_id}: another lifecycle operation is in progress."
            ));
        }
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "Failed to acquire processing state lock.".to_string())?;
        Self::reap_finished_task(&mut tokens, evidence_id);
        let entry = tokens.remove(&evidence_id);
        operations.insert(evidence_id);
        Ok((
            ProcessingLifecycleGuard {
                state: self,
                evidence_ids: vec![evidence_id],
            },
            entry,
        ))
    }

    fn has_in_flight_work(&self) -> Result<bool, String> {
        let operations_active = !self
            .lifecycle_operations
            .lock()
            .map_err(|_| "Failed to inspect evidence lifecycle operations.".to_string())?
            .is_empty();
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "Failed to inspect active evidence processing tasks.".to_string())?;
        tokens.retain(|_, entry| !entry.handle.inner().is_finished());
        Ok(operations_active || !tokens.is_empty())
    }

    fn abort_all_live_tasks(&self) -> Result<Vec<i64>, String> {
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "Failed to inspect active evidence processing tasks.".to_string())?;
        tokens.retain(|_, entry| !entry.handle.inner().is_finished());
        for entry in tokens.values() {
            entry.cancel.store(true, Ordering::Relaxed);
            entry.handle.abort();
        }
        Ok(tokens.keys().copied().collect())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CancelProcessingResult {
    outcome: &'static str,
    status: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EvidenceSourceRelinkResult {
    evidence_id: i64,
    old_path: String,
    new_path: String,
    status: i64,
}

#[derive(Debug, Clone)]
struct EvidenceSourceRecord {
    path: String,
    evidence_type: String,
    status: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessingSourceKind {
    DiskImage,
    Folder,
}

#[derive(Debug, Clone)]
struct ProcessingAdmission {
    source: EvidenceSourceRecord,
    previous_status: i64,
    resume_stage: i64,
    main_db_path: PathBuf,
    evidence_db_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EvidenceSourceStatus {
    available: bool,
    reason: Option<String>,
    path: String,
    evidence_type: String,
}

fn app_evidence_paths(app: &AppHandle, evidence_id: i64) -> Result<(PathBuf, PathBuf), String> {
    if evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app-local data directory: {error}"))?;
    Ok((
        app_data_dir.join("thanatology.db"),
        app_data_dir
            .join("evidences")
            .join(format!("{evidence_id}.db")),
    ))
}

fn existing_sqlite_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(30))
}

async fn open_existing_main_pool(path: &Path) -> Result<SqlitePool, String> {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(existing_sqlite_options(path))
        .await
        .map_err(|error| format!("Failed to open the main database: {error}"))
}

async fn fetch_evidence_source(
    pool: &SqlitePool,
    evidence_id: i64,
) -> Result<EvidenceSourceRecord, String> {
    let row = sqlx::query("SELECT path, type, status FROM evidence WHERE id = ? LIMIT 1")
        .bind(evidence_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Failed to load evidence {evidence_id}: {error}"))?
        .ok_or_else(|| format!("Evidence {evidence_id} was not found."))?;
    Ok(EvidenceSourceRecord {
        path: row
            .try_get("path")
            .map_err(|error| format!("Evidence {evidence_id} has an invalid path: {error}"))?,
        evidence_type: row
            .try_get("type")
            .map_err(|error| format!("Evidence {evidence_id} has an invalid type: {error}"))?,
        status: row
            .try_get("status")
            .map_err(|error| format!("Evidence {evidence_id} has an invalid status: {error}"))?,
    })
}

/// Map a resting lifecycle status to the pipeline stage from which processing
/// may start. Positive running statuses are deliberately excluded: when no
/// task owns one of those statuses, `cancel_processing` must perform the stale
/// cleanup before preprocessing can be started again.
fn processing_resume_stage(status: i64) -> Option<i64> {
    match status {
        // setup_evidence_pools intentionally clears generated analysis rows,
        // including system_files. Every accepted retry must therefore rebuild
        // the index before later stages; skipping to abs(status) would run
        // artefact work against an empty index.
        1 | -1 | -3 | -4 => Some(1),
        _ => None,
    }
}

async fn admit_processing_start_at_paths(
    main_db_path: &Path,
    evidence_db_path: &Path,
    evidence_id: i64,
    expected_kind: ProcessingSourceKind,
) -> Result<ProcessingAdmission, String> {
    let main_pool = open_existing_main_pool(main_db_path).await?;
    let result = async {
        let source = fetch_evidence_source(&main_pool, evidence_id).await?;
        validate_evidence_source(Path::new(&source.path), &source.evidence_type)?;

        match (expected_kind, source.evidence_type.as_str()) {
            (ProcessingSourceKind::Folder, "Folder") => {}
            (ProcessingSourceKind::DiskImage, "Folder") => {
                return Err(format!(
                    "Evidence {evidence_id} is a folder and cannot be processed as a disk image."
                ));
            }
            (ProcessingSourceKind::Folder, evidence_type) => {
                return Err(format!(
                    "Evidence {evidence_id} has type {evidence_type} and cannot be processed as a folder."
                ));
            }
            (ProcessingSourceKind::DiskImage, _) => {}
        }

        let resume_stage = processing_resume_stage(source.status).ok_or_else(|| {
            if source.status == 0 {
                format!(
                    "Evidence {evidence_id} is not preprocessed. Complete preprocessing before starting analysis."
                )
            } else {
                format!(
                    "Evidence {evidence_id} cannot start processing from lifecycle status {}.",
                    source.status
                )
            }
        })?;

        // The conditional write makes the admission robust against any legacy
        // renderer that still writes lifecycle state directly. The surrounding
        // ProcessingLifecycleGuard makes this status transition and task
        // registration indivisible to backend stop/reset/delete operations.
        let updated = sqlx::query("UPDATE evidence SET status = 2 WHERE id = ? AND status = ?")
            .bind(evidence_id)
            .bind(source.status)
            .execute(&main_pool)
            .await
            .map_err(|error| format!("Failed to mark evidence as processing: {error}"))?;
        if updated.rows_affected() != 1 {
            return Err(format!(
                "Evidence {evidence_id} changed state while processing was starting. Try again."
            ));
        }

        Ok(ProcessingAdmission {
            previous_status: source.status,
            source,
            resume_stage,
            main_db_path: main_db_path.to_path_buf(),
            evidence_db_path: evidence_db_path.to_path_buf(),
        })
    }
    .await;
    main_pool.close().await;
    result
}

async fn restore_processing_admission(main_db_path: &Path, evidence_id: i64, previous_status: i64) {
    let Ok(main_pool) = open_existing_main_pool(main_db_path).await else {
        return;
    };
    // Do not roll a pipeline back after it has advanced to a later stage.
    let _ = sqlx::query("UPDATE evidence SET status = ? WHERE id = ? AND status = 2")
        .bind(previous_status)
        .bind(evidence_id)
        .execute(&main_pool)
        .await;
    main_pool.close().await;
}

/// Validate both the expected source kind and basic readability without ever
/// parsing user-controlled evidence. Physical devices are accepted as long as
/// they are non-directories and can be opened for reading.
fn validate_evidence_source(path: &Path, evidence_type: &str) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Evidence source path cannot be empty.".to_string());
    }
    let metadata = std::fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("Evidence source was not found: {}", path.display())
        } else {
            format!(
                "Cannot access evidence source '{}': {error}",
                path.display()
            )
        }
    })?;

    if evidence_type == "Folder" {
        if !metadata.is_dir() {
            return Err(format!(
                "Evidence type Folder requires a directory, but '{}' is not a directory.",
                path.display()
            ));
        }
        std::fs::read_dir(path).map_err(|error| {
            format!(
                "Evidence folder '{}' is not readable: {error}",
                path.display()
            )
        })?;
    } else {
        if metadata.is_dir() {
            return Err(format!(
                "Evidence type {evidence_type} requires a file or device, but '{}' is a directory.",
                path.display()
            ));
        }
        File::open(path).map_err(|error| {
            format!(
                "Evidence source '{}' is not readable: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn evidence_source_status(source: &EvidenceSourceRecord) -> EvidenceSourceStatus {
    match validate_evidence_source(Path::new(&source.path), &source.evidence_type) {
        Ok(()) => EvidenceSourceStatus {
            available: true,
            reason: None,
            path: source.path.clone(),
            evidence_type: source.evidence_type.clone(),
        },
        Err(reason) => EvidenceSourceStatus {
            available: false,
            reason: Some(reason),
            path: source.path.clone(),
            evidence_type: source.evidence_type.clone(),
        },
    }
}

async fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() => Err(format!(
            "Refusing to remove analysis database path '{}' because it is a directory.",
            path.display()
        )),
        Ok(_) => tokio::fs::remove_file(path)
            .await
            .map_err(|error| format!("Failed to remove '{}': {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect '{}': {error}", path.display())),
    }
}

async fn remove_analysis_database_files(database_path: &Path) -> Result<(), String> {
    let database_path_text = database_path.to_string_lossy();
    for path in [
        database_path.to_path_buf(),
        PathBuf::from(format!("{database_path_text}-wal")),
        PathBuf::from(format!("{database_path_text}-shm")),
    ] {
        remove_file_if_present(&path).await?;
    }
    Ok(())
}

async fn reset_stale_processing_state(pool: &SqlitePool, evidence_id: i64) -> Result<(), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin evidence recovery: {error}"))?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM evidence WHERE id = ?")
        .bind(evidence_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to verify evidence {evidence_id}: {error}"))?;
    if exists == 0 {
        return Err(format!("Evidence {evidence_id} was not found."));
    }
    sqlx::query("DELETE FROM evidence_preprocessing_metadata WHERE evidence_id = ?")
        .bind(evidence_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to clear preprocessing metadata: {error}"))?;
    sqlx::query("DELETE FROM partitions WHERE evidence_id = ?")
        .bind(evidence_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to clear evidence partitions: {error}"))?;
    sqlx::query("UPDATE evidence SET status = 0 WHERE id = ?")
        .bind(evidence_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to reset evidence status: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit evidence recovery: {error}"))
}

fn is_stale_running_status(status: i64) -> bool {
    matches!(status, 2 | 3 | 4 | -2)
}

#[tauri::command]
async fn cancel_processing(
    evidence_id: i64,
    state: tauri::State<'_, ProcessingState>,
    agent_state: tauri::State<'_, modules::agents::runtime::AgentRuntimeState>,
    spatiotemporal_state: tauri::State<'_, modules::th_spatiotemporal::SpatiotemporalSessionState>,
    app: tauri::AppHandle,
) -> Result<CancelProcessingResult, String> {
    // Atomically take the task and reserve this evidence until it has fully
    // dropped its pools and the status/database transition is complete.
    let (_lifecycle_guard, entry) = state.begin_cancellation(evidence_id)?;
    let had_live_task = entry
        .as_ref()
        .is_some_and(|entry| !entry.handle.inner().is_finished());

    if let Some(entry) = entry {
        if had_live_task {
            entry.cancel.store(true, Ordering::Relaxed);
            entry.handle.abort();
        }
        // Awaiting guarantees the task has dropped its SQLite pools before a
        // later reset/delete is allowed to touch the database files.
        let _ = entry.handle.await;
    }

    let (main_db_path, evidence_db_path) = app_evidence_paths(&app, evidence_id)?;
    let main_pool = open_existing_main_pool(&main_db_path).await?;

    if had_live_task {
        update_evidence_status(&main_pool, evidence_id, -1)
            .await
            .map_err(|error| format!("Failed to update evidence status: {error}"))?;
        main_pool.close().await;
        return Ok(CancelProcessingResult {
            outcome: "stopped",
            status: -1,
        });
    }

    let source = fetch_evidence_source(&main_pool, evidence_id).await?;
    if !is_stale_running_status(source.status) {
        main_pool.close().await;
        return Err(format!(
            "No active processing task was found for evidence {evidence_id}, but status {} is not a stale running state. No analysis data was removed.",
            source.status
        ));
    }

    modules::agents::runtime::close_agent_sessions_for_evidence(agent_state.inner(), evidence_id)
        .await?;
    modules::th_spatiotemporal::close_spatiotemporal_sessions_for_evidence(
        &app,
        spatiotemporal_state.inner(),
        evidence_id,
    )
    .await?;

    remove_analysis_database_files(&evidence_db_path).await?;
    reset_stale_processing_state(&main_pool, evidence_id).await?;
    main_pool.close().await;
    Ok(CancelProcessingResult {
        outcome: "resetToNotProcessed",
        status: 0,
    })
}

#[tauri::command]
async fn reset_evidence(
    app: AppHandle,
    processing_state: tauri::State<'_, ProcessingState>,
    agent_state: tauri::State<'_, modules::agents::runtime::AgentRuntimeState>,
    spatiotemporal_state: tauri::State<'_, modules::th_spatiotemporal::SpatiotemporalSessionState>,
    evidence_id: i64,
) -> Result<(), String> {
    let _lifecycle_guard = processing_state.begin_idle_lifecycle(evidence_id, "restart")?;

    let (main_db_path, evidence_db_path) = app_evidence_paths(&app, evidence_id)?;
    let main_pool = open_existing_main_pool(&main_db_path).await?;
    let source = fetch_evidence_source(&main_pool, evidence_id).await?;
    validate_evidence_source(Path::new(&source.path), &source.evidence_type)?;

    modules::agents::runtime::close_agent_sessions_for_evidence(agent_state.inner(), evidence_id)
        .await?;
    modules::th_spatiotemporal::close_spatiotemporal_sessions_for_evidence(
        &app,
        spatiotemporal_state.inner(),
        evidence_id,
    )
    .await?;

    remove_analysis_database_files(&evidence_db_path).await?;
    // Pending Start preserves the already selected preprocessing metadata and
    // partitions, while all generated analysis rows were removed with the DB.
    update_evidence_status(&main_pool, evidence_id, 1)
        .await
        .map_err(|error| format!("Failed to update evidence status: {error}"))?;
    main_pool.close().await;

    info!("Successfully reset evidence ID {}", evidence_id);
    Ok(())
}

async fn relink_evidence_source_and_reset_storage(
    main_pool: &SqlitePool,
    evidence_db_path: &Path,
    evidence_id: i64,
    new_path: &str,
) -> Result<EvidenceSourceRelinkResult, String> {
    // Re-read the authoritative record immediately before cleanup. The
    // renderer never supplies the evidence type or prior lifecycle state.
    let source = fetch_evidence_source(main_pool, evidence_id).await?;
    validate_evidence_source(Path::new(new_path), &source.evidence_type)?;

    // Do not change the registered source until every generated analysis file
    // has been removed. On validation or cleanup failure, the authoritative
    // path/status remain unchanged (the cleanup error reports any partial
    // filesystem failure rather than committing the new source).
    remove_analysis_database_files(evidence_db_path)
        .await
        .map_err(|error| {
            format!(
                "Evidence source was not changed because generated analysis cleanup failed: {error}"
            )
        })?;

    let update_result: Result<(), String> = async {
        let mut transaction = main_pool
            .begin()
            .await
            .map_err(|error| format!("Failed to begin evidence source recovery: {error}"))?;
        let updated = sqlx::query(
            "UPDATE evidence SET path = ?, status = 1 \
             WHERE id = ? AND path = ? AND status = ?",
        )
        .bind(new_path)
        .bind(evidence_id)
        .bind(&source.path)
        .bind(source.status)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to update evidence source: {error}"))?;
        if updated.rows_affected() != 1 {
            return Err(format!(
                "Evidence {evidence_id} changed while source recovery was running."
            ));
        }
        transaction
            .commit()
            .await
            .map_err(|error| format!("Failed to commit evidence source recovery: {error}"))
    }
    .await;

    if let Err(error) = update_result {
        // SQLite rolls the transaction back on failure, so it cannot expose a
        // new source path beside results parsed from the old source. Cleanup
        // has already happened, however, and that fact must not be hidden.
        return Err(format!(
            "Generated analysis database files were removed, but the evidence source could not be updated. The registered source path and status remain unchanged; retry the recovery before processing. {error}"
        ));
    }

    Ok(EvidenceSourceRelinkResult {
        evidence_id,
        old_path: source.path,
        new_path: new_path.to_string(),
        status: 1,
    })
}

#[tauri::command]
async fn relink_evidence_source_and_reset(
    app: AppHandle,
    processing_state: tauri::State<'_, ProcessingState>,
    agent_state: tauri::State<'_, modules::agents::runtime::AgentRuntimeState>,
    spatiotemporal_state: tauri::State<'_, modules::th_spatiotemporal::SpatiotemporalSessionState>,
    evidence_id: i64,
    new_path: String,
) -> Result<EvidenceSourceRelinkResult, String> {
    let _lifecycle_guard =
        processing_state.begin_idle_lifecycle(evidence_id, "relink and reset")?;
    if new_path.trim().is_empty() {
        return Err("New evidence source path cannot be empty.".to_string());
    }
    let (main_db_path, evidence_db_path) = app_evidence_paths(&app, evidence_id)?;
    let main_pool = open_existing_main_pool(&main_db_path).await?;

    let operation_result = async {
        // Validate before closing sessions so a bad picker selection is a
        // fully non-mutating failure.
        let source = fetch_evidence_source(&main_pool, evidence_id).await?;
        validate_evidence_source(Path::new(&new_path), &source.evidence_type)?;

        modules::agents::runtime::close_agent_sessions_for_evidence(
            agent_state.inner(),
            evidence_id,
        )
        .await?;
        modules::th_spatiotemporal::close_spatiotemporal_sessions_for_evidence(
            &app,
            spatiotemporal_state.inner(),
            evidence_id,
        )
        .await?;

        relink_evidence_source_and_reset_storage(
            &main_pool,
            &evidence_db_path,
            evidence_id,
            &new_path,
        )
        .await
    }
    .await;
    main_pool.close().await;
    operation_result
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
                data_url: format!("data:{};base64,{}", mime_type, BASE64_STANDARD.encode(data)),
            })
        })
        .collect()
}

/// Check if the evidence file exists at the given path.
#[tauri::command]
fn check_evidence_exists(path: String) -> Result<bool, String> {
    match std::fs::metadata(Path::new(&path)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Cannot inspect evidence path '{path}': {error}")),
    }
}

/// Report whether the source registered for an evidence is still usable.
///
/// The source path and type are loaded from the main database so the renderer
/// cannot accidentally validate stale card data or a mismatched evidence kind.
#[tauri::command]
async fn get_evidence_source_status(
    app: AppHandle,
    evidence_id: i64,
) -> Result<EvidenceSourceStatus, String> {
    let (main_db_path, _) = app_evidence_paths(&app, evidence_id)?;
    let main_pool = open_existing_main_pool(&main_db_path).await?;
    let source = fetch_evidence_source(&main_pool, evidence_id).await;
    main_pool.close().await;
    source.map(|source| evidence_source_status(&source))
}

/// Auto-detect the disk image format based on headers extension or content.
/// otherwise we return "RAW".
#[tauri::command]
fn check_disk_image_format(path: String) -> Result<String, String> {
    let body: Body = Body::try_new(path.clone(), "auto")
        .map_err(|err| format!("Unable to open evidence source '{path}': {err}"))?;
    Ok(body.format_description().to_string())
}

/// Exhuming the partitions from the disk image.
/// Returns the Partition object found by exhume_partitions.
#[tauri::command]
fn discover_partitions(path: String) -> Result<Partitions, String> {
    let mut body: Body = Body::try_new(path.clone(), "auto")
        .map_err(|err| format!("Unable to open evidence source '{path}': {err}"))?;
    match Partitions::new(&mut body) {
        Ok(discover_partitions) => Ok(discover_partitions),
        Err(err) => Err(format!("Could not discover partitions: {:?}", err)),
    }
}

/// Attempt to read the selected partition from the disk image.
/// Here we try to read the selected partitions.
#[tauri::command]
fn read_mbr_partition(partition: MBRPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::try_new(path.clone(), "auto")
        .map_err(|err| format!("Unable to open evidence source '{path}': {err}"))?;
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
            ));
        }
    };
    Ok(fs)
}

/// Detect the filesystem inside a logical image (single filesystem snapshot).
#[tauri::command]
fn detect_logical_filesystem(path: String) -> Result<String, String> {
    let mut body: Body = Body::try_new(path.clone(), "auto")
        .map_err(|err| format!("Unable to open evidence source '{path}': {err}"))?;
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat image: {}", e))?
        .len();
    let fs = match detect_filesystem(&mut body, 0, size, None) {
        Ok(fs) => fs,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ));
        }
    };
    return Ok(fs.filesystem_type());
}

#[tauri::command]
fn read_gpt_partition(partition: GPTPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::try_new(path.clone(), "auto")
        .map_err(|err| format!("Unable to open evidence source '{path}': {err}"))?;
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
            ));
        }
    };
    Ok(fs)
}

/// Shared setup for both process_partitions and process_folder:
/// creates the evidence DB directory, opens both pools, initialises
/// the schema, attaches the main DB, and copies the evidence rows.
/// Returns None (after emitting an error event) if anything fails.
async fn setup_evidence_pools(
    evidence_id: i64,
    main_db_path: &str,
    evidence_db_path: &str,
    app: &AppHandle,
) -> Option<(SqlitePool, SqlitePool)> {
    if let Some(parent) = std::path::Path::new(evidence_db_path).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to create evidence DB directory: {e}"),
                app,
            );
            error!("Failed to create evidence DB directory: {e}");
            return None;
        }
    }

    let main_pool = match open_pool(main_db_path).await {
        Ok(p) => p,
        Err(err) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Main DB connection error: {err:?}"),
                app,
            );
            error!("Main DB connection error: {err:?}");
            return None;
        }
    };

    let evidence_pool = match open_pool(evidence_db_path).await {
        Ok(p) => p,
        Err(err) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Evidence DB connection error: {err:?}"),
                app,
            );
            error!("Evidence DB connection error: {err:?}");
            return None;
        }
    };

    match has_user_tables(&evidence_pool).await {
        Ok(false) => {
            if let Err(err) = ensure_evidence_tables(&evidence_pool).await {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("Failed to initialize evidence DB schema: {err:?}"),
                    app,
                );
                error!("Failed to initialize evidence DB schema: {err:?}");
                return None;
            }
        }
        Ok(true) => {}
        Err(err) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed checking evidence DB schema: {err:?}"),
                app,
            );
            error!("Failed checking evidence DB schema: {err:?}");
            return None;
        }
    }

    if let Err(err) = attach_main_db(&evidence_pool, main_db_path).await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Failed to attach main DB: {err:?}"),
            app,
        );
        error!("Failed to attach main DB: {err:?}");
        return None;
    }

    if let Err(err) = copy_evidence_scoped_rows(&evidence_pool, evidence_id).await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Failed to copy evidence rows into evidence DB: {err:?}"),
            app,
        );
        error!("Failed to copy evidence rows into evidence DB: {err:?}");
        return None;
    }

    Some((main_pool, evidence_pool))
}

/// Re-open removable evidence for a processing stage without risking a
/// process-wide exit if the source was disconnected after admission.
async fn open_processing_body_or_stop(
    evidence_id: i64,
    evidence_path: &str,
    phase: &str,
    failure_status: i64,
    main_pool: &SqlitePool,
    app: &AppHandle,
) -> Option<Body> {
    match Body::try_new(evidence_path.to_string(), "auto") {
        Ok(body) => Some(body),
        Err(error) => {
            let message = format!(
                "Evidence source became unavailable during {phase}; processing stopped and partial results were retained: {error}"
            );
            error!("Evidence {evidence_id}: {message}");
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                message,
                app,
            );
            update_evidence_status(main_pool, evidence_id, failure_status)
                .await
                .ok();
            None
        }
    }
}

#[tauri::command]
async fn process_partitions(
    evidence_id: i64,
    ai_config: AiConfig,
    app: AppHandle,
) -> Result<(), String> {
    let processing_state = app.state::<ProcessingState>();
    let start_guard = processing_state.begin_idle_lifecycle(evidence_id, "start processing")?;
    let (main_db_path, evidence_db_path) = app_evidence_paths(&app, evidence_id)?;
    let admission = admit_processing_start_at_paths(
        &main_db_path,
        &evidence_db_path,
        evidence_id,
        ProcessingSourceKind::DiskImage,
    )
    .await?;
    let rollback_main_db_path = admission.main_db_path.clone();
    let rollback_status = admission.previous_status;
    let cancel_token = Arc::new(AtomicBool::new(false));
    let cancel_for_task = cancel_token.clone();
    let app_for_task = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let app = app_for_task;
        let cancel_token = cancel_for_task;
        let ProcessingAdmission {
            source,
            previous_status,
            resume_stage: actual_status,
            main_db_path,
            evidence_db_path,
        } = admission;
        let main_db_path_text = main_db_path.to_string_lossy().into_owned();
        let evidence_db_path_text = evidence_db_path.to_string_lossy().into_owned();

        let (main_pool, evidence_pool) = match setup_evidence_pools(
            evidence_id,
            &main_db_path_text,
            &evidence_db_path_text,
            &app,
        )
        .await
        {
            Some(pools) => pools,
            None => {
                restore_processing_admission(&main_db_path, evidence_id, previous_status).await;
                return;
            }
        };

        let evidence_path = source.path;

        // Sector size and image size reference (uses logical size from body metadata,
        // not the container file size — critical for compressed formats like AFF4).
        let body_for_info = match Body::try_new(evidence_path.clone(), "auto") {
            Ok(body) => body,
            Err(error) => {
                let message = format!(
                    "Evidence source became unavailable before processing could start: {error}"
                );
                error!("Evidence {evidence_id}: {message}");
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    message,
                    &app,
                );
                restore_processing_admission(&main_db_path, evidence_id, previous_status).await;
                return;
            }
        };
        let sector_size_u64 = body_for_info.get_sector_size() as u64;
        let image_size = body_for_info.get_image_size();

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
            let size_sectors = if sector_size_u64 > 0 {
                image_size / sector_size_u64
            } else {
                0
            };

            if let Err(err) = sqlx::query(
                "INSERT INTO partitions (evidence_id, kind, first_byte_addr, size_sectors, sector_size, size_bytes) VALUES (?, 'logical', 0, ?, ?, ?)",
            )
            .bind(evidence_id)
            .bind(size_sectors as i64)
            .bind(sector_size_u64 as i64)
            .bind(image_size as i64)
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
                update_evidence_status(&main_pool, evidence_id, previous_status)
                    .await
                    .ok();
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

            // For logical (whole-image) partitions, always recompute from the body's
            // declared image size so that compressed formats (AFF4, EWF, …) report the
            // correct uncompressed size rather than the container file size.
            let (effective_size_bytes, effective_size_sectors) = if kind.as_str() == "logical" {
                let s = if sector_size_u64 > 0 {
                    image_size / sector_size_u64
                } else {
                    0
                };
                (image_size, s)
            } else {
                (size_bytes as u64, size_sectors as u64)
            };

            work.push(WorkPartition {
                id,
                first_byte_addr: fba as u64,
                size_sectors: effective_size_sectors,
                size_bytes: effective_size_bytes,
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
            update_evidence_status(&main_pool, evidence_id, previous_status)
                .await
                .ok();
            return;
        }

        // Indexation (writes ONLY to evidence DB)
        let total = work.len() as u64;

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
                    update_evidence_status(&main_pool, evidence_id, -1)
                        .await
                        .ok();
                    return;
                }

                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Info,
                    format!("Indexing {} partition {}/{}", p.kind, idx + 1, total),
                    &app,
                );

                if let Err(error) = index_partition(
                    evidence_id,
                    p.id,
                    p.size_sectors,
                    p.first_byte_addr,
                    evidence_path.clone(),
                    &evidence_pool,
                    &app,
                    Some(cancel_token.clone()),
                )
                .await
                {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!(
                            "Partition indexing stopped; partial results were retained: {error}"
                        ),
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -1)
                        .await
                        .ok();
                    return;
                }
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
                    update_evidence_status(&main_pool, evidence_id, -3)
                        .await
                        .ok();
                    return;
                }

                let Some(mut body) = open_processing_body_or_stop(
                    evidence_id,
                    &evidence_path,
                    "file identification",
                    -3,
                    &main_pool,
                    &app,
                )
                .await
                else {
                    return;
                };

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p
                    .fvek
                    .clone()
                    .and_then(|h| hex::decode(h).ok())
                    .map(|fvek| exhume_filesystem::detected_fs::KeyMaterial {
                        bitlocker_fvek: Some(fvek),
                    });

                let mut fs = match detect_filesystem(
                    &mut body,
                    p.first_byte_addr,
                    bytes_len,
                    key_material,
                ) {
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
            // The card reads the main DB, so mirror it there or this stage is invisible.
            update_evidence_status(&main_pool, evidence_id, 4)
                .await
                .ok();

            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                ProcessingStatusPayload {
                    message: "File type identification complete. Identifying known artefacts…"
                        .to_string(),
                    status: 4,
                    phase: "artefact_identification",
                },
                &app,
            );
        }

        // Post-index artefact discovery and parsing (also writes to evidence DB)
        if actual_status < 5 {
            for (partition_index, p) in work.iter().enumerate() {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "Artefact identification cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -4)
                        .await
                        .ok();
                    return;
                }

                let Some(mut body) = open_processing_body_or_stop(
                    evidence_id,
                    &evidence_path,
                    "artefact identification",
                    -4,
                    &main_pool,
                    &app,
                )
                .await
                else {
                    return;
                };

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p
                    .fvek
                    .clone()
                    .and_then(|h| hex::decode(h).ok())
                    .map(|fvek| exhume_filesystem::detected_fs::KeyMaterial {
                        bitlocker_fvek: Some(fvek),
                    });

                if detect_filesystem(&mut body, p.first_byte_addr, bytes_len, key_material).is_err()
                {
                    continue;
                }

                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Info,
                    ProcessingStatusPayload {
                        message: format!(
                            "Identifying known artefacts in {} partition {}/{}…",
                            p.kind,
                            partition_index + 1,
                            total
                        ),
                        status: 4,
                        phase: "artefact_identification",
                    },
                    &app,
                );

                identify_artefacts(evidence_id, p.id, &app, &evidence_pool).await;
            }

            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                ProcessingStatusPayload {
                    message: "Artefact identification complete. Parsing discovered artefacts…"
                        .to_string(),
                    status: 4,
                    phase: "artefact_parsing",
                },
                &app,
            );

            let registry = build_registry();

            for (partition_index, p) in work.iter().enumerate() {
                if cancel_token.load(Ordering::Relaxed) {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Info,
                        "Artefact extraction cancelled by user.",
                        &app,
                    );
                    update_evidence_status(&main_pool, evidence_id, -4)
                        .await
                        .ok();
                    return;
                }

                let Some(mut body) = open_processing_body_or_stop(
                    evidence_id,
                    &evidence_path,
                    "artefact parsing",
                    -4,
                    &main_pool,
                    &app,
                )
                .await
                else {
                    return;
                };

                let bytes_len = match p.kind {
                    "LOGICAL" => p.size_bytes,
                    _ => p.size_sectors.saturating_mul(sector_size_u64),
                };

                let key_material = p
                    .fvek
                    .clone()
                    .and_then(|h| hex::decode(h).ok())
                    .map(|fvek| exhume_filesystem::detected_fs::KeyMaterial {
                        bitlocker_fvek: Some(fvek),
                    });

                let mut fs = match detect_filesystem(
                    &mut body,
                    p.first_byte_addr,
                    bytes_len,
                    key_material,
                ) {
                    Ok(fs) => fs,
                    Err(_) => continue,
                };

                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Info,
                    ProcessingStatusPayload {
                        message: format!(
                            "Parsing artefacts in {} partition {}/{}…",
                            p.kind,
                            partition_index + 1,
                            total
                        ),
                        status: 4,
                        phase: "artefact_parsing",
                    },
                    &app,
                );

                extract_artefacts(
                    evidence_id,
                    p.id,
                    &app,
                    &evidence_pool,
                    &mut fs,
                    &registry,
                    Some(cancel_token.clone()),
                )
                .await;

                populate_filesystem_timeline(evidence_id, p.id, &evidence_pool).await;
            }

            // Every partition's artefacts are parsed: the investigation is
            // reviewable from here. AI enrichment below only adds to it, so it
            // must not gate an investigator's access to the evidence.
            update_evidence_status(&evidence_pool, evidence_id, 5)
                .await
                .ok();
            update_evidence_status(&main_pool, evidence_id, 5)
                .await
                .ok();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                ProcessingStatusPayload {
                    message: "Artefact parsing complete. Evidence is ready for review.".to_string(),
                    status: 5,
                    phase: "ai_analysis",
                },
                &app,
            );
            app.emit(&format!("artefacts_complete_{}", evidence_id), evidence_id)
                .ok();
        }

        // Guarded separately so an evidence interrupted during AI enrichment
        // (already at 5) resumes the AI pass instead of skipping it.
        if actual_status < 6 {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                ProcessingStatusPayload {
                    message: "Running AI specialist analysis…".to_string(),
                    status: 5,
                    phase: "ai_analysis",
                },
                &app,
            );
            for p in &work {
                if cancel_token.load(Ordering::Relaxed) {
                    break;
                }
                modules::agents::specialists::run_specialists(
                    evidence_id,
                    p.id,
                    evidence_pool.clone(),
                    &app,
                    ai_config.clone(),
                )
                .await;
            }

            update_evidence_status(&evidence_pool, evidence_id, 6)
                .await
                .ok();
        }

        update_evidence_status(&main_pool, evidence_id, 6)
            .await
            .ok();
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "Processing pipeline complete.".to_string(),
                status: 6,
                phase: "complete",
            },
            &app,
        );
        app.emit(&format!("pipeline_complete_{}", evidence_id), evidence_id)
            .ok();
    });

    let mut pending_handle = Some(handle);
    let registration_error = match processing_state.tokens.lock() {
        Ok(tokens) if tokens.contains_key(&evidence_id) => Some(format!(
            "Evidence {evidence_id} already has a registered processing task."
        )),
        Ok(mut tokens) => {
            tokens.insert(
                evidence_id,
                ProcessingEntry {
                    cancel: cancel_token,
                    handle: pending_handle.take().expect("pending processing handle"),
                },
            );
            None
        }
        Err(_) => Some("Failed to register the evidence processing task.".to_string()),
    };
    if let Some(message) = registration_error {
        pending_handle
            .take()
            .expect("unregistered processing handle")
            .abort();
        restore_processing_admission(&rollback_main_db_path, evidence_id, rollback_status).await;
        return Err(message);
    }
    drop(start_guard);
    Ok(())
}

#[tauri::command]
async fn process_folder(
    evidence_id: i64,
    ai_config: AiConfig,
    app: AppHandle,
) -> Result<(), String> {
    let processing_state = app.state::<ProcessingState>();
    let start_guard = processing_state.begin_idle_lifecycle(evidence_id, "start processing")?;
    let (main_db_path, evidence_db_path) = app_evidence_paths(&app, evidence_id)?;
    let admission = admit_processing_start_at_paths(
        &main_db_path,
        &evidence_db_path,
        evidence_id,
        ProcessingSourceKind::Folder,
    )
    .await?;
    let rollback_main_db_path = admission.main_db_path.clone();
    let rollback_status = admission.previous_status;
    let cancel_token = Arc::new(AtomicBool::new(false));
    let cancel_for_task = cancel_token.clone();
    let app_for_task = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let app = app_for_task;
        let cancel_token = cancel_for_task;
        let ProcessingAdmission {
            source,
            previous_status,
            resume_stage: _,
            main_db_path,
            evidence_db_path,
        } = admission;
        let main_db_path_text = main_db_path.to_string_lossy().into_owned();
        let evidence_db_path_text = evidence_db_path.to_string_lossy().into_owned();

        let (main_pool, evidence_pool) = match setup_evidence_pools(
            evidence_id,
            &main_db_path_text,
            &evidence_db_path_text,
            &app,
        )
        .await
        {
            Some(pools) => pools,
            None => {
                restore_processing_admission(&main_db_path, evidence_id, previous_status).await;
                return;
            }
        };
        let folder_path = source.path;

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
                update_evidence_status(&main_pool, evidence_id, previous_status)
                    .await
                    .ok();
                return;
            }
            partition_rows =
                sqlx::query("SELECT id FROM partitions WHERE evidence_id = ? AND kind IN ('logical', 'folder') ORDER BY id")
                    .bind(evidence_id)
                    .fetch_all(&evidence_pool)
                    .await
                    .unwrap_or_default();
        }

        if partition_rows.is_empty() {
            let msg = "Folder processing could not create its logical partition.".to_string();
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                msg.clone(),
                &app,
            );
            error!("{msg}");
            update_evidence_status(&main_pool, evidence_id, previous_status)
                .await
                .ok();
            return;
        }

        let partition_id = partition_rows[0].get::<i64, _>("id");

        if cancel_token.load(Ordering::Relaxed) {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                "Folder processing cancelled by user.",
                &app,
            );
            update_evidence_status(&main_pool, evidence_id, -1)
                .await
                .ok();
            return;
        }

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Info,
            format!("Indexing Folder..."),
            &app,
        );

        index_folder(
            evidence_id,
            partition_id,
            folder_path.clone(),
            &evidence_pool,
            &app,
            Some(cancel_token.clone()),
        )
        .await;

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
            update_evidence_status(&main_pool, evidence_id, -1)
                .await
                .ok();
            return;
        }

        let fs =
            exhume_filesystem::folder_impl::FolderFS::new(std::path::PathBuf::from(&folder_path));
        let mut detected_fs: exhume_filesystem::detected_fs::DetectedFs<
            exhume_filesystem::detected_fs::ImageStream,
        > = exhume_filesystem::detected_fs::DetectedFs::Folder(fs);

        identify_file_types(
            &mut detected_fs,
            evidence_id,
            partition_id,
            &app,
            evidence_pool.clone(),
        )
        .await;
        update_evidence_status(&evidence_pool, evidence_id, 4)
            .await
            .ok();
        update_evidence_status(&main_pool, evidence_id, 4)
            .await
            .ok();

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "File type identification complete. Identifying known artefacts…"
                    .to_string(),
                status: 4,
                phase: "artefact_identification",
            },
            &app,
        );

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Info,
            ProcessingStatusPayload {
                message: "Identifying known artefacts in the folder…".to_string(),
                status: 4,
                phase: "artefact_identification",
            },
            &app,
        );

        identify_artefacts(evidence_id, partition_id, &app, &evidence_pool).await;
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "Artefact identification complete. Parsing discovered artefacts…"
                    .to_string(),
                status: 4,
                phase: "artefact_parsing",
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
            update_evidence_status(&main_pool, evidence_id, -4)
                .await
                .ok();
            return;
        }

        let registry = build_registry();
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Info,
            ProcessingStatusPayload {
                message: "Parsing discovered folder artefacts…".to_string(),
                status: 4,
                phase: "artefact_parsing",
            },
            &app,
        );
        extract_artefacts(
            evidence_id,
            partition_id,
            &app,
            &evidence_pool,
            &mut detected_fs,
            &registry,
            Some(cancel_token.clone()),
        )
        .await;

        populate_filesystem_timeline(evidence_id, partition_id, &evidence_pool).await;

        // Artefacts are parsed: reviewable now, AI enrichment follows.
        update_evidence_status(&evidence_pool, evidence_id, 5)
            .await
            .ok();
        update_evidence_status(&main_pool, evidence_id, 5)
            .await
            .ok();
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "Artefact parsing complete. Evidence is ready for review.".to_string(),
                status: 5,
                phase: "ai_analysis",
            },
            &app,
        );
        app.emit(&format!("artefacts_complete_{}", evidence_id), evidence_id)
            .ok();

        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Info,
            ProcessingStatusPayload {
                message: "Running AI specialist analysis…".to_string(),
                status: 5,
                phase: "ai_analysis",
            },
            &app,
        );
        modules::agents::specialists::run_specialists(
            evidence_id,
            partition_id,
            evidence_pool.clone(),
            &app,
            ai_config,
        )
        .await;

        update_evidence_status(&evidence_pool, evidence_id, 6)
            .await
            .ok();
        update_evidence_status(&main_pool, evidence_id, 6)
            .await
            .ok();
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            ProcessingStatusPayload {
                message: "Processing pipeline complete.".to_string(),
                status: 6,
                phase: "complete",
            },
            &app,
        );
        app.emit(&format!("pipeline_complete_{}", evidence_id), evidence_id)
            .ok();
    });

    let mut pending_handle = Some(handle);
    let registration_error = match processing_state.tokens.lock() {
        Ok(tokens) if tokens.contains_key(&evidence_id) => Some(format!(
            "Evidence {evidence_id} already has a registered processing task."
        )),
        Ok(mut tokens) => {
            tokens.insert(
                evidence_id,
                ProcessingEntry {
                    cancel: cancel_token,
                    handle: pending_handle
                        .take()
                        .expect("pending folder processing handle"),
                },
            );
            None
        }
        Err(_) => Some("Failed to register the folder processing task.".to_string()),
    };
    if let Some(message) = registration_error {
        pending_handle
            .take()
            .expect("unregistered folder processing handle")
            .abort();
        restore_processing_admission(&rollback_main_db_path, evidence_id, rollback_status).await;
        return Err(message);
    }
    drop(start_guard);
    Ok(())
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
        .decorations(false)
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
        .decorations(false)
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
        .decorations(false)
        .maximized(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_ai_config(config: AiConfig, app: AppHandle) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    let config_path = base_dir.join("ai_config.json");
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize AI config: {}", e))?;
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write AI config file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn load_ai_config(app: AppHandle) -> Result<AiConfig, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    let config_path = base_dir.join("ai_config.json");
    if !config_path.exists() {
        return Ok(AiConfig {
            provider: "ollama".to_string(),
            endpoint: "http://localhost:11434".to_string(),
            api_key: String::new(),
            model: "llama3.1:latest".to_string(),
            enable_text_specialist: false,
            enable_image_specialist: false,
            enable_audio_specialist: false,
            batch_size: 10,
        });
    }
    let json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read AI config file: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse AI config: {}", e))
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let unique = NEXT_TEST_DIRECTORY.fetch_add(1, AtomicOrdering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "thanatology-{name}-{}-{nanos}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn create_test_pool(path: &Path) -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal),
            )
            .await
            .expect("create test database")
    }

    #[test]
    fn source_validation_enforces_file_and_folder_evidence_kinds() {
        let directory = TestDirectory::new("source-validation");
        let file_path = directory.path().join("source.raw");
        std::fs::write(&file_path, b"evidence").expect("write source");

        assert!(validate_evidence_source(&file_path, "Physical Disk image").is_ok());
        assert!(validate_evidence_source(directory.path(), "Folder").is_ok());
        assert!(validate_evidence_source(&file_path, "Folder")
            .expect_err("folder must reject file")
            .contains("requires a directory"));
        assert!(
            validate_evidence_source(directory.path(), "Logical Disk image")
                .expect_err("image must reject directory")
                .contains("requires a file or device")
        );
        assert!(
            validate_evidence_source(&directory.path().join("missing.raw"), "Memory Image")
                .expect_err("missing source")
                .contains("was not found")
        );
    }

    #[test]
    fn missing_disk_image_is_reported_without_terminating_the_application() {
        let directory = TestDirectory::new("missing-body-source");
        let missing_path = directory.path().join("disconnected.raw");

        let error = check_disk_image_format(missing_path.to_string_lossy().into_owned())
            .expect_err("a disconnected evidence source must be returned as an error");

        assert!(error.contains("Unable to open evidence source"));
        assert!(error.contains("disconnected.raw"));
    }

    #[test]
    fn source_status_reports_validation_failures_with_camel_case_fields() {
        let directory = TestDirectory::new("source-status");
        let file_path = directory.path().join("source.raw");
        std::fs::write(&file_path, b"evidence").expect("write source");

        let available = evidence_source_status(&EvidenceSourceRecord {
            path: file_path.to_string_lossy().into_owned(),
            evidence_type: "Logical Disk image".to_string(),
            status: 6,
        });
        assert!(available.available);
        assert_eq!(available.reason, None);

        let unavailable = evidence_source_status(&EvidenceSourceRecord {
            path: directory.path().to_string_lossy().into_owned(),
            evidence_type: "Logical Disk image".to_string(),
            status: 6,
        });
        assert!(!unavailable.available);
        assert!(unavailable
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("requires a file or device")));

        let serialized = serde_json::to_value(&unavailable).expect("serialize source status");
        assert_eq!(serialized["evidenceType"], "Logical Disk image");
        assert!(serialized.get("evidence_type").is_none());
    }

    #[tokio::test]
    async fn processing_admission_claims_only_pending_or_resumable_statuses() {
        let directory = TestDirectory::new("processing-admission");
        let main_db_path = directory.path().join("thanatology.db");
        let evidence_db_path = directory.path().join("evidences").join("31.db");
        let source_path = directory.path().join("source.raw");
        std::fs::write(&source_path, b"evidence").expect("write source");

        let pool = create_test_pool(&main_db_path).await;
        sqlx::query(
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("evidence schema");
        sqlx::query(
            "INSERT INTO evidence (id, path, type, status) VALUES (31, ?, 'Logical Disk image', 1)",
        )
        .bind(source_path.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .expect("evidence row");

        for status in [1, -1, -3, -4] {
            sqlx::query("UPDATE evidence SET status = ? WHERE id = 31")
                .bind(status)
                .execute(&pool)
                .await
                .expect("prepare lifecycle status");

            let admission = admit_processing_start_at_paths(
                &main_db_path,
                &evidence_db_path,
                31,
                ProcessingSourceKind::DiskImage,
            )
            .await
            .expect("eligible processing admission");
            assert_eq!(admission.previous_status, status);
            assert_eq!(admission.resume_stage, 1);
            let claimed: i64 = sqlx::query_scalar("SELECT status FROM evidence WHERE id = 31")
                .fetch_one(&pool)
                .await
                .expect("claimed status");
            assert_eq!(claimed, 2);
        }

        for status in [0, -2, 2, 3, 4, 5, 6] {
            sqlx::query("UPDATE evidence SET status = ? WHERE id = 31")
                .bind(status)
                .execute(&pool)
                .await
                .expect("prepare rejected lifecycle status");
            let error = admit_processing_start_at_paths(
                &main_db_path,
                &evidence_db_path,
                31,
                ProcessingSourceKind::DiskImage,
            )
            .await
            .expect_err("ineligible processing admission");
            if status == 0 {
                assert!(error.contains("not preprocessed"));
            }
            let unchanged: i64 = sqlx::query_scalar("SELECT status FROM evidence WHERE id = 31")
                .fetch_one(&pool)
                .await
                .expect("unchanged status");
            assert_eq!(unchanged, status);
        }
    }

    #[tokio::test]
    async fn delayed_start_after_stale_stop_cleanup_cannot_reclaim_status_zero() {
        let directory = TestDirectory::new("processing-admission-after-stop");
        let main_db_path = directory.path().join("thanatology.db");
        let evidence_db_path = directory.path().join("evidences").join("32.db");
        let source_path = directory.path().join("source.raw");
        std::fs::write(&source_path, b"evidence").expect("write source");

        let pool = create_test_pool(&main_db_path).await;
        sqlx::query(
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("evidence schema");
        sqlx::query(
            "INSERT INTO evidence (id, path, type, status) VALUES (32, ?, 'Logical Disk image', 0)",
        )
        .bind(source_path.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .expect("reset evidence row");

        let error = admit_processing_start_at_paths(
            &main_db_path,
            &evidence_db_path,
            32,
            ProcessingSourceKind::DiskImage,
        )
        .await
        .expect_err("delayed start must not cross stale cleanup");
        assert!(error.contains("not preprocessed"));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT status FROM evidence WHERE id = 32")
                .fetch_one(&pool)
                .await
                .expect("status"),
            0
        );
        assert!(!evidence_db_path.exists());
    }

    #[test]
    fn missing_evidence_check_is_a_false_result_not_an_error() {
        let directory = TestDirectory::new("exists");
        let missing = directory.path().join("missing.raw");
        assert_eq!(
            check_evidence_exists(missing.to_string_lossy().into_owned()),
            Ok(false)
        );
    }

    #[test]
    fn orphan_cleanup_is_limited_to_stale_running_statuses() {
        for status in [2, 3, 4, -2] {
            assert!(is_stale_running_status(status), "status {status}");
        }
        for status in [0, 1, 5, 6, -1, -3, -4] {
            assert!(!is_stale_running_status(status), "status {status}");
        }
    }

    #[tokio::test]
    async fn database_cleanup_removes_main_and_orphan_sidecars_idempotently() {
        let directory = TestDirectory::new("analysis-cleanup");
        let database_path = directory.path().join("7.db");
        let wal_path = directory.path().join("7.db-wal");
        let shm_path = directory.path().join("7.db-shm");
        for path in [&database_path, &wal_path, &shm_path] {
            std::fs::write(path, b"generated").expect("write generated file");
        }

        remove_analysis_database_files(&database_path)
            .await
            .expect("first cleanup");
        remove_analysis_database_files(&database_path)
            .await
            .expect("idempotent cleanup");

        assert!(!database_path.exists());
        assert!(!wal_path.exists());
        assert!(!shm_path.exists());

        std::fs::create_dir(&database_path).expect("create unsafe directory target");
        assert!(remove_analysis_database_files(&database_path)
            .await
            .expect_err("must refuse recursive removal")
            .contains("Refusing to remove"));
        assert!(database_path.is_dir());
    }

    #[tokio::test]
    async fn stale_reset_clears_preprocessing_but_preserves_evidence_and_images() {
        let directory = TestDirectory::new("stale-reset");
        let database_path = directory.path().join("thanatology.db");
        let pool = create_test_pool(&database_path).await;
        for statement in [
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, status INTEGER NOT NULL)",
            "CREATE TABLE partitions (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "CREATE TABLE evidence_preprocessing_metadata (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "CREATE TABLE evidence_images (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "INSERT INTO evidence (id, status) VALUES (9, 2)",
            "INSERT INTO partitions (id, evidence_id) VALUES (1, 9)",
            "INSERT INTO evidence_preprocessing_metadata (id, evidence_id) VALUES (1, 9)",
            "INSERT INTO evidence_images (id, evidence_id) VALUES (1, 9)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("test schema statement");
        }

        reset_stale_processing_state(&pool, 9)
            .await
            .expect("stale reset");

        let status: i64 = sqlx::query_scalar("SELECT status FROM evidence WHERE id = 9")
            .fetch_one(&pool)
            .await
            .expect("status");
        let partitions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM partitions")
            .fetch_one(&pool)
            .await
            .expect("partitions");
        let metadata: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM evidence_preprocessing_metadata")
                .fetch_one(&pool)
                .await
                .expect("metadata");
        let images: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM evidence_images")
            .fetch_one(&pool)
            .await
            .expect("images");

        assert_eq!(status, 0);
        assert_eq!(partitions, 0);
        assert_eq!(metadata, 0);
        assert_eq!(images, 1);
    }

    #[tokio::test]
    async fn failed_stale_reset_rolls_back_and_keeps_nonzero_status() {
        let directory = TestDirectory::new("stale-reset-rollback");
        let database_path = directory.path().join("thanatology.db");
        let pool = create_test_pool(&database_path).await;
        for statement in [
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, status INTEGER NOT NULL)",
            "CREATE TABLE evidence_preprocessing_metadata (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "INSERT INTO evidence (id, status) VALUES (10, 2)",
            "INSERT INTO evidence_preprocessing_metadata (id, evidence_id) VALUES (1, 10)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("test schema statement");
        }

        assert!(reset_stale_processing_state(&pool, 10).await.is_err());
        let status: i64 = sqlx::query_scalar("SELECT status FROM evidence WHERE id = 10")
            .fetch_one(&pool)
            .await
            .expect("status");
        let metadata: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM evidence_preprocessing_metadata")
                .fetch_one(&pool)
                .await
                .expect("metadata");
        assert_eq!(status, 2, "failed cleanup must not claim Not processed");
        assert_eq!(metadata, 1, "failed transaction must roll back metadata");
    }

    #[tokio::test]
    async fn atomic_relink_removes_analysis_and_commits_pending_source() {
        let directory = TestDirectory::new("atomic-relink");
        let main_db_path = directory.path().join("thanatology.db");
        let analysis_db_path = directory.path().join("11.db");
        let old_source = directory.path().join("old.raw");
        let new_source = directory.path().join("new.raw");
        std::fs::write(&old_source, b"old").expect("old source");
        std::fs::write(&new_source, b"new").expect("new source");
        for path in [
            analysis_db_path.clone(),
            PathBuf::from(format!("{}-wal", analysis_db_path.display())),
            PathBuf::from(format!("{}-shm", analysis_db_path.display())),
        ] {
            std::fs::write(path, b"generated analysis").expect("analysis file");
        }

        let main_pool = create_test_pool(&main_db_path).await;
        for statement in [
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
            "CREATE TABLE partitions (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "CREATE TABLE evidence_preprocessing_metadata (id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL)",
            "INSERT INTO partitions (id, evidence_id) VALUES (1, 11)",
            "INSERT INTO evidence_preprocessing_metadata (id, evidence_id) VALUES (1, 11)",
        ] {
            sqlx::query(statement)
                .execute(&main_pool)
                .await
                .expect("main schema");
        }
        sqlx::query("INSERT INTO evidence (id, path, type, status) VALUES (11, ?, 'Physical Disk image', 5)")
            .bind(old_source.to_string_lossy().as_ref())
            .execute(&main_pool)
            .await
            .expect("main evidence");

        let result = relink_evidence_source_and_reset_storage(
            &main_pool,
            &analysis_db_path,
            11,
            new_source.to_string_lossy().as_ref(),
        )
        .await
        .expect("relink source");
        assert_eq!(result.evidence_id, 11);
        assert_eq!(result.old_path, old_source.to_string_lossy());
        assert_eq!(result.new_path, new_source.to_string_lossy());
        assert_eq!(result.status, 1);

        let row = sqlx::query("SELECT path, status FROM evidence WHERE id = 11")
            .fetch_one(&main_pool)
            .await
            .expect("relinked evidence");
        assert_eq!(
            row.try_get::<String, _>("path").expect("path"),
            new_source.to_string_lossy()
        );
        assert_eq!(row.try_get::<i64, _>("status").expect("status"), 1);
        assert!(!analysis_db_path.exists());
        assert!(!PathBuf::from(format!("{}-wal", analysis_db_path.display())).exists());
        assert!(!PathBuf::from(format!("{}-shm", analysis_db_path.display())).exists());
        for table in ["partitions", "evidence_preprocessing_metadata"] {
            let count: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE evidence_id = 11"
            ))
            .fetch_one(&main_pool)
            .await
            .expect("preserved preprocessing row");
            assert_eq!(count, 1, "{table} should be preserved");
        }

        assert_eq!(
            serde_json::to_value(&result).expect("serialize relink")["evidenceId"],
            11
        );
    }

    #[tokio::test]
    async fn rejected_relink_keeps_old_registration_and_analysis() {
        let directory = TestDirectory::new("atomic-relink-rejected");
        let main_db_path = directory.path().join("thanatology.db");
        let analysis_db_path = directory.path().join("12.db");
        let old_source = directory.path().join("old.raw");
        std::fs::write(&old_source, b"old").expect("old source");
        std::fs::write(&analysis_db_path, b"old analysis").expect("analysis database");

        let main_pool = create_test_pool(&main_db_path).await;
        sqlx::query(
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
        )
        .execute(&main_pool)
        .await
        .expect("main schema");
        sqlx::query("INSERT INTO evidence (id, path, type, status) VALUES (12, ?, 'Physical Disk image', 5)")
            .bind(old_source.to_string_lossy().as_ref())
            .execute(&main_pool)
            .await
            .expect("main evidence");

        assert!(relink_evidence_source_and_reset_storage(
            &main_pool,
            &analysis_db_path,
            12,
            directory.path().to_string_lossy().as_ref(),
        )
        .await
        .expect_err("image relocation must reject directory")
        .contains("requires a file or device"));

        let row = sqlx::query("SELECT path, status FROM evidence WHERE id = 12")
            .fetch_one(&main_pool)
            .await
            .expect("original registration");
        assert_eq!(
            row.try_get::<String, _>("path").expect("path"),
            old_source.to_string_lossy()
        );
        assert_eq!(row.try_get::<i64, _>("status").expect("status"), 5);
        assert_eq!(
            std::fs::read(&analysis_db_path).expect("old analysis retained"),
            b"old analysis"
        );
    }

    #[tokio::test]
    async fn cleanup_failure_keeps_old_registration() {
        let directory = TestDirectory::new("atomic-relink-cleanup-failure");
        let main_db_path = directory.path().join("thanatology.db");
        let analysis_db_path = directory.path().join("13.db");
        let old_source = directory.path().join("old.raw");
        let new_source = directory.path().join("new.raw");
        std::fs::write(&old_source, b"old").expect("old source");
        std::fs::write(&new_source, b"new").expect("new source");
        std::fs::create_dir(&analysis_db_path).expect("unsafe analysis directory");

        let main_pool = create_test_pool(&main_db_path).await;
        sqlx::query(
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
        )
        .execute(&main_pool)
        .await
        .expect("main schema");
        sqlx::query("INSERT INTO evidence (id, path, type, status) VALUES (13, ?, 'Physical Disk image', 6)")
            .bind(old_source.to_string_lossy().as_ref())
            .execute(&main_pool)
            .await
            .expect("main evidence");

        let error = relink_evidence_source_and_reset_storage(
            &main_pool,
            &analysis_db_path,
            13,
            new_source.to_string_lossy().as_ref(),
        )
        .await
        .expect_err("directory cleanup must fail");
        assert!(error.contains("source was not changed"));
        let row = sqlx::query("SELECT path, status FROM evidence WHERE id = 13")
            .fetch_one(&main_pool)
            .await
            .expect("original registration");
        assert_eq!(
            row.try_get::<String, _>("path").expect("path"),
            old_source.to_string_lossy()
        );
        assert_eq!(row.try_get::<i64, _>("status").expect("status"), 6);
        assert!(analysis_db_path.is_dir());
    }

    #[tokio::test]
    async fn transaction_failure_reports_removed_analysis_without_committing_new_path() {
        let directory = TestDirectory::new("atomic-relink-transaction-failure");
        let main_db_path = directory.path().join("thanatology.db");
        let analysis_db_path = directory.path().join("14.db");
        let old_source = directory.path().join("old.raw");
        let new_source = directory.path().join("new.raw");
        std::fs::write(&old_source, b"old").expect("old source");
        std::fs::write(&new_source, b"new").expect("new source");
        std::fs::write(&analysis_db_path, b"generated analysis").expect("analysis database");

        let main_pool = create_test_pool(&main_db_path).await;
        for statement in [
            "CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT NOT NULL, type TEXT NOT NULL, status INTEGER NOT NULL)",
            "CREATE TRIGGER reject_evidence_update BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, 'blocked for test'); END",
        ] {
            sqlx::query(statement)
                .execute(&main_pool)
                .await
                .expect("main schema");
        }
        sqlx::query("INSERT INTO evidence (id, path, type, status) VALUES (14, ?, 'Physical Disk image', 6)")
            .bind(old_source.to_string_lossy().as_ref())
            .execute(&main_pool)
            .await
            .expect("main evidence");

        let error = relink_evidence_source_and_reset_storage(
            &main_pool,
            &analysis_db_path,
            14,
            new_source.to_string_lossy().as_ref(),
        )
        .await
        .expect_err("transaction must fail");
        assert!(error.contains("analysis database files were removed"));
        assert!(error.contains("path and status remain unchanged"));
        let row = sqlx::query("SELECT path, status FROM evidence WHERE id = 14")
            .fetch_one(&main_pool)
            .await
            .expect("original registration");
        assert_eq!(
            row.try_get::<String, _>("path").expect("path"),
            old_source.to_string_lossy()
        );
        assert_eq!(row.try_get::<i64, _>("status").expect("status"), 6);
        assert!(!analysis_db_path.exists());
    }

    #[tokio::test]
    async fn processing_state_reaps_finished_handles_but_reports_live_tasks() {
        let state = ProcessingState {
            tokens: Mutex::new(HashMap::new()),
            lifecycle_operations: Mutex::new(HashSet::new()),
        };

        let finished = tauri::async_runtime::spawn(async {});
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(finished.inner().is_finished());
        state.tokens.lock().expect("state lock").insert(
            20,
            ProcessingEntry {
                cancel: Arc::new(AtomicBool::new(false)),
                handle: finished,
            },
        );
        let finished_guard = state
            .begin_idle_lifecycle(20, "restart")
            .expect("finished task must be reaped");
        assert!(!state.tokens.lock().expect("state lock").contains_key(&20));
        drop(finished_guard);

        let live = tauri::async_runtime::spawn(std::future::pending::<()>());
        state.tokens.lock().expect("state lock").insert(
            21,
            ProcessingEntry {
                cancel: Arc::new(AtomicBool::new(false)),
                handle: live,
            },
        );
        assert!(state.begin_idle_lifecycle(21, "restart").is_err());
        let (cancellation, entry) = state
            .begin_cancellation(21)
            .expect("begin live cancellation");
        let entry = entry.expect("live entry");
        assert!(state.begin_idle_lifecycle(21, "delete").is_err());
        entry.handle.abort();
        let _ = entry.handle.await;
        drop(cancellation);

        let batch = state
            .begin_idle_lifecycle_batch(&[22, 23], "delete")
            .expect("reserve batch");
        assert!(state.begin_idle_lifecycle(22, "restart").is_err());
        assert!(state.begin_cancellation(23).is_err());
        drop(batch);
        assert!(state.begin_idle_lifecycle(22, "restart").is_ok());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();
    let mut builder = tauri::Builder::default()
        .manage(modules::th_filesystem::SharedState::default())
        .manage(modules::th_filesystem::MediaServeState::default())
        .manage(modules::th_directory_export::DirectoryExportState::default())
        .manage(ProcessingState {
            tokens: Mutex::new(HashMap::new()),
            lifecycle_operations: Mutex::new(HashSet::new()),
        })
        .manage(modules::th_memory::MemoryExecutionState::default())
        .manage(modules::agents::runtime::AgentRuntimeState::default())
        .manage(modules::th_maps::MapDownloadState::default())
        .manage(modules::th_spatiotemporal::SpatiotemporalSessionState::default())
        .register_asynchronous_uri_scheme_protocol("thanatology-media", |ctx, request, responder| {
            let fs_state = ctx
                .app_handle()
                .state::<modules::th_filesystem::SharedState>()
                .inner()
                .clone();
            let media_state = ctx
                .app_handle()
                .state::<modules::th_filesystem::MediaServeState>()
                .inner()
                .clone();

            std::thread::spawn(move || {
                let response = modules::th_filesystem::serve_media_source_request(
                    fs_state,
                    media_state,
                    request,
                );
                responder.respond(response);
            });
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() != "main" {
                    return;
                }

                let state_guard = window.state::<ProcessingState>();
                let is_processing = state_guard.has_in_flight_work().unwrap_or(false);

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
                                let active_evidences =
                                    state_guard.abort_all_live_tasks().unwrap_or_default();

                                // Spawn a targeted task to force DB states to Stopped (-1) and exit immediately
                                tauri::async_runtime::spawn(async move {
                                    use tauri::Manager;
                                    if let Ok(base_dir) = app_clone.path().app_local_data_dir() {
                                        let main_db_path = format!("{}/thanatology.db", base_dir.display());
                                        if let Ok(pool) = sqlx::SqlitePool::connect(&format!("sqlite:{}", main_db_path)).await {
                                            for eid in active_evidences {
                                                // Force status to "Stopped/Error" (-1)
                                                let _ = sqlx::query("UPDATE evidence SET status = -1 WHERE id = ? AND (status = -2 OR (status > 0 AND status < 5))")
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
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(base_dir) = app_handle.path().app_local_data_dir() {
                    let main_db_path = format!("sqlite:{}/thanatology.db", base_dir.display());
                    if let Ok(pool) = sqlx::SqlitePool::connect(&main_db_path).await {
                        let result = sqlx::query("UPDATE evidence SET status = -1 WHERE status = -2")
                            .execute(&pool)
                            .await;
                        if let Ok(r) = result {
                            if r.rows_affected() > 0 {
                                info!("Startup cleanup: reset {} evidence(s) stuck at status -2 to -1", r.rows_affected());
                            }
                        }
                        pool.close().await;
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_case_with_evidence,
            modules::th_evidences::delete_evidences,
            check_evidence_exists,
            get_evidence_source_status,
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
            parse_plist_file,
            register_media_source,
            modules::th_memory::discover_memory_dma,
            modules::th_memory::run_memory_module,
            process_folder,
            detect_logical_filesystem,
            dump_file_to_disk,
            modules::th_directory_export::start_directory_export,
            modules::th_directory_export::get_directory_export_jobs,
            modules::th_directory_export::cancel_directory_export,
            compute_hash,
            parse_pe,
            has_evtx_data,
            has_pml_data,
            cancel_processing,
            reset_evidence,
            relink_evidence_source_and_reset,
            save_evidence_images,
            get_evidence_images,
            save_ai_config,
            load_ai_config,
            list_physical_devices,
            modules::th_maps::get_map_storage_status,
            modules::th_maps::set_map_storage_root,
            modules::th_maps::activate_map_pack,
            modules::th_maps::remove_map_pack,
            modules::th_maps::discard_map_download,
            modules::th_maps::download_map_pack,
            modules::th_maps::import_map_pack,
            modules::th_maps::cancel_map_download,
            modules::th_maps::read_map_range,
            modules::th_maps::read_map_asset,
            modules::th_spatiotemporal::open_timeline_window,
            modules::th_spatiotemporal::open_location_window,
            modules::th_spatiotemporal::open_spatiotemporal_windows,
            modules::th_spatiotemporal::register_spatiotemporal_window,
            modules::th_spatiotemporal::get_spatiotemporal_snapshot,
            modules::th_spatiotemporal::update_spatiotemporal_range_from_main,
            modules::th_spatiotemporal::set_spatiotemporal_sync_from_main,
            modules::th_spatiotemporal::update_spatiotemporal_state,
            modules::th_spatiotemporal::set_spatiotemporal_sync,
            modules::th_external_apps::open_external_application,
            modules::th_external_apps::test_external_application,
            modules::agents::investigate_with_agent,
            modules::agents::search_files_for_mention,
            modules::agents::runtime::open_agent_window,
            modules::agents::runtime::open_agent_session,
            modules::agents::runtime::get_agent_session,
            modules::agents::runtime::submit_agent_turn,
            modules::agents::runtime::cancel_agent_turn,
            modules::agents::runtime::respond_agent_approval,
            modules::agents::runtime::clear_agent_session,
            modules::agents::runtime::close_agent_session,
            modules::agents::runtime::list_agent_sessions,
            modules::agents::runtime::list_agent_events,
            modules::agents::runtime::search_agent_files,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
