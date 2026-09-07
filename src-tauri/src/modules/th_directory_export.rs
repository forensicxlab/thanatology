use exhume_body::Body;
use exhume_filesystem::detected_fs::{DetectedFs, ImageStream, KeyMaterial, detect_filesystem};
use exhume_filesystem::directory_export::{
    DirectoryExportControl, DirectoryExportError, DirectoryExportOptions, DirectoryExportProgress,
    DirectoryExportProvenance, DirectoryExportSource, DirectoryExportStage, export_directory,
};
use exhume_filesystem::filesystem::{FileCommon, Filesystem};
use exhume_filesystem::folder_impl::FolderFS;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap};
use std::fs::File as StdFile;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

pub const DIRECTORY_EXPORT_EVENT: &str = "filesystem-directory-export";
const MAX_ACTIVE_DIRECTORY_EXPORTS: usize = 4;
const MAX_TERMINAL_DIRECTORY_EXPORTS: usize = 64;
const MAX_REPORTED_FAILURES: usize = 100;
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);
const PROGRESS_EMIT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDirectoryExportRequest {
    pub operation_id: String,
    pub evidence_id: i64,
    pub partition_id: i64,
    pub directory_system_file_id: i64,
    pub destination_parent: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryExportJobStatus {
    Queued,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Failed,
}

impl DirectoryExportJobStatus {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Failed)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryExportJobStage {
    Queued,
    Preparing,
    Traversing,
    Copying,
    Finalizing,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryExportFailureSnapshot {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryExportJobSnapshot {
    pub job_id: String,
    pub evidence_id: i64,
    pub partition_id: i64,
    pub directory_system_file_id: i64,
    pub source_path: String,
    pub destination_parent: String,
    pub output_path: Option<String>,
    pub status: DirectoryExportJobStatus,
    pub stage: DirectoryExportJobStage,
    pub current_path: Option<String>,
    pub entries_processed: u64,
    pub total_entries: Option<u64>,
    pub files_exported: u64,
    pub directories_created: u64,
    pub bytes_written: u64,
    pub total_bytes: Option<u64>,
    pub skipped_entries: u64,
    pub failed_entries: u64,
    pub failures: Vec<DirectoryExportFailureSnapshot>,
    pub manifest_path: Option<String>,
    pub error: Option<String>,
    pub started_at_unix_ms: Option<u64>,
    pub finished_at_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelDirectoryExportResult {
    pub accepted: bool,
}

struct ManagedDirectoryExportJob {
    snapshot: DirectoryExportJobSnapshot,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct DirectoryExportRegistry {
    jobs: Mutex<HashMap<String, ManagedDirectoryExportJob>>,
}

impl DirectoryExportRegistry {
    fn jobs(&self) -> MutexGuard<'_, HashMap<String, ManagedDirectoryExportJob>> {
        self.jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn insert(
        &self,
        snapshot: DirectoryExportJobSnapshot,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let mut jobs = self.jobs();
        let active = jobs
            .values()
            .filter(|job| !job.snapshot.status.is_terminal())
            .count();
        if active >= MAX_ACTIVE_DIRECTORY_EXPORTS {
            return Err(format!(
                "At most {MAX_ACTIVE_DIRECTORY_EXPORTS} directory exports may run at once."
            ));
        }
        if jobs.contains_key(&snapshot.job_id) {
            return Err("A directory export with this job identifier already exists.".to_string());
        }
        jobs.insert(
            snapshot.job_id.clone(),
            ManagedDirectoryExportJob { snapshot, cancel },
        );
        Ok(())
    }

    fn update(
        &self,
        job_id: &str,
        update: impl FnOnce(&mut DirectoryExportJobSnapshot),
    ) -> Option<DirectoryExportJobSnapshot> {
        let mut jobs = self.jobs();
        let job = jobs.get_mut(job_id)?;
        update(&mut job.snapshot);
        let snapshot = job.snapshot.clone();
        if snapshot.status.is_terminal() {
            prune_terminal_jobs(&mut jobs);
        }
        Some(snapshot)
    }

    fn update_silent(
        &self,
        job_id: &str,
        update: impl FnOnce(&mut DirectoryExportJobSnapshot),
    ) -> bool {
        let mut jobs = self.jobs();
        let Some(job) = jobs.get_mut(job_id) else {
            return false;
        };
        update(&mut job.snapshot);
        let terminal = job.snapshot.status.is_terminal();
        if terminal {
            prune_terminal_jobs(&mut jobs);
        }
        true
    }

    fn cancel(&self, job_id: &str) -> (bool, Option<DirectoryExportJobSnapshot>) {
        let mut jobs = self.jobs();
        let Some(job) = jobs.get_mut(job_id) else {
            return (false, None);
        };
        if job.snapshot.status.is_terminal() {
            return (false, Some(job.snapshot.clone()));
        }
        job.cancel.store(true, Ordering::Relaxed);
        job.snapshot.status = DirectoryExportJobStatus::Cancelling;
        (true, Some(job.snapshot.clone()))
    }

    fn snapshots(&self, evidence_id: Option<i64>) -> Vec<DirectoryExportJobSnapshot> {
        let mut snapshots = self
            .jobs()
            .values()
            .filter(|job| {
                evidence_id.is_none_or(|evidence_id| job.snapshot.evidence_id == evidence_id)
            })
            .map(|job| job.snapshot.clone())
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| {
            right
                .started_at_unix_ms
                .cmp(&left.started_at_unix_ms)
                .then_with(|| right.job_id.cmp(&left.job_id))
        });
        snapshots
    }
}

fn prune_terminal_jobs(jobs: &mut HashMap<String, ManagedDirectoryExportJob>) {
    let mut terminal = jobs
        .iter()
        .filter(|(_, job)| job.snapshot.status.is_terminal())
        .map(|(job_id, job)| {
            (
                job_id.clone(),
                job.snapshot
                    .finished_at_unix_ms
                    .or(job.snapshot.started_at_unix_ms)
                    .unwrap_or(0),
            )
        })
        .collect::<Vec<_>>();
    if terminal.len() <= MAX_TERMINAL_DIRECTORY_EXPORTS {
        return;
    }
    terminal.sort_by_key(|(_, timestamp)| *timestamp);
    let remove_count = terminal.len() - MAX_TERMINAL_DIRECTORY_EXPORTS;
    for (job_id, _) in terminal.into_iter().take(remove_count) {
        jobs.remove(&job_id);
    }
}

pub struct DirectoryExportState {
    registry: Arc<DirectoryExportRegistry>,
}

impl Default for DirectoryExportState {
    fn default() -> Self {
        Self {
            registry: Arc::new(DirectoryExportRegistry::default()),
        }
    }
}

struct PreparedPartition {
    kind: String,
    first_byte_addr: u64,
    size_bytes: u64,
    fvek_hex: Option<Zeroizing<String>>,
}

struct PreparedDirectoryExport {
    evidence_id: i64,
    partition_id: i64,
    directory_system_file_id: i64,
    evidence_type: String,
    evidence_path: PathBuf,
    registered_source_path: String,
    partition: PreparedPartition,
    directory_identifier: u64,
    logical_path: String,
    output_name: String,
    destination_parent: PathBuf,
}

#[derive(Clone)]
struct ExecutionProgress {
    stage: DirectoryExportJobStage,
    current_path: Option<String>,
    entries_processed: u64,
    files_exported: u64,
    directories_created: u64,
    bytes_written: u64,
    skipped_entries: u64,
    failed_entries: u64,
    failures: Vec<DirectoryExportFailureSnapshot>,
}

#[derive(Default)]
struct ProgressEmissionGate {
    last_emit: Option<Instant>,
    last_stage: Option<DirectoryExportJobStage>,
    last_bytes: u64,
}

impl ProgressEmissionGate {
    fn should_emit(&mut self, progress: &ExecutionProgress, now: Instant) -> bool {
        let stage_changed = self.last_stage != Some(progress.stage);
        let enough_bytes =
            progress.bytes_written.saturating_sub(self.last_bytes) >= PROGRESS_EMIT_BYTES;
        let enough_time = self
            .last_emit
            .is_none_or(|last_emit| now.duration_since(last_emit) >= PROGRESS_EMIT_INTERVAL);
        // A path transition can happen for every tiny file. It is deliberately
        // sampled on the same time/byte cadence so large trees cannot flood
        // the Tauri event bus with one IPC event per entry.
        let should_emit = stage_changed || enough_bytes || enough_time;
        if should_emit {
            self.last_emit = Some(now);
            self.last_stage = Some(progress.stage);
            self.last_bytes = progress.bytes_written;
        }
        should_emit
    }
}

struct ExecutionCompletion {
    output_path: PathBuf,
    manifest_path: PathBuf,
    entries_processed: u64,
    files_exported: u64,
    directories_created: u64,
    bytes_written: u64,
    skipped_entries: u64,
    failed_entries: u64,
    failures: Vec<DirectoryExportFailureSnapshot>,
}

#[derive(Debug)]
enum ExecutionError {
    Cancelled {
        message: String,
        entries_processed: u64,
        bytes_written: u64,
    },
    Failed(String),
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_request(request: &StartDirectoryExportRequest) -> Result<(), String> {
    validate_operation_id(&request.operation_id)?;
    if request.evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    if request.partition_id <= 0 {
        return Err("Partition ID must be positive.".to_string());
    }
    if request.directory_system_file_id <= 0 {
        return Err("A concrete indexed directory must be selected.".to_string());
    }
    if request.destination_parent.trim().is_empty() {
        return Err("Choose a destination directory for the export.".to_string());
    }
    Ok(())
}

fn validate_operation_id(operation_id: &str) -> Result<(), String> {
    if !is_canonical_uuid_v4(operation_id) {
        return Err(
            "Directory export operationId must be a canonical lowercase UUID v4.".to_string(),
        );
    }
    Ok(())
}

fn is_canonical_uuid_v4(identifier: &str) -> bool {
    let bytes = identifier.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

fn read_only_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false)
}

async fn open_read_only_pool(path: &Path, label: &str) -> Result<SqlitePool, String> {
    if !path.is_file() {
        return Err(format!("{label} is unavailable: {}", path.display()));
    }
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(read_only_options(path))
        .await
        .map_err(|error| format!("Failed to open {label}: {error}"))
}

fn nonnegative_u64(value: i64, field: &str) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("Indexed partition {field} is invalid: {value}"))
}

fn validate_source_path(path: &Path, evidence_type: &str) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        format!(
            "Cannot access the registered evidence source '{}': {error}",
            path.display()
        )
    })?;
    match evidence_type {
        "Folder" if !metadata.is_dir() => Err(format!(
            "The registered Folder evidence source is not a directory: {}",
            path.display()
        )),
        "Folder" => std::fs::read_dir(path)
            .map(|_| ())
            .map_err(|error| format!("Cannot read evidence folder '{}': {error}", path.display())),
        "Physical Disk image" | "Logical Disk image" if metadata.is_dir() => Err(format!(
            "The registered disk-image evidence source is a directory: {}",
            path.display()
        )),
        "Physical Disk image" | "Logical Disk image" => StdFile::open(path)
            .map(|_| ())
            .map_err(|error| format!("Cannot read evidence source '{}': {error}", path.display())),
        unsupported => Err(format!(
            "Directory export is not supported for evidence type {unsupported}."
        )),
    }
}

fn canonical_existing_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Cannot resolve {label} '{}': {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "{label} is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn resolve_folder_source_directory(
    evidence_root: &Path,
    logical_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let canonical_root = canonical_existing_directory(evidence_root, "folder evidence root")?;
    let relative = logical_path.trim_start_matches(std::path::MAIN_SEPARATOR);
    let candidate = canonical_root.join(relative);
    let canonical_source = canonical_existing_directory(&candidate, "selected evidence directory")?;
    if !canonical_source.starts_with(&canonical_root) {
        return Err(format!(
            "Selected directory resolves outside the folder evidence root: {}",
            canonical_source.display()
        ));
    }
    Ok((canonical_root, canonical_source))
}

fn validate_folder_destination(
    canonical_root: &Path,
    canonical_source: &Path,
    destination_parent: &Path,
) -> Result<(), String> {
    if destination_parent.starts_with(canonical_root) {
        return Err(format!(
            "The export destination cannot be inside the folder evidence root: {}",
            canonical_root.display()
        ));
    }
    debug_assert!(!destination_parent.starts_with(canonical_source));
    Ok(())
}

fn effective_partition_size(kind: &str, declared_size: u64, image_size: u64) -> u64 {
    if kind == "logical" && declared_size == 0 {
        image_size
    } else {
        declared_size
    }
}

fn selected_path_occurrence_name(logical_path: &str, evidence_type: &str) -> Option<String> {
    let separator = if evidence_type == "Folder" {
        std::path::MAIN_SEPARATOR
    } else if logical_path.starts_with('\\') {
        '\\'
    } else {
        '/'
    };
    logical_path
        .rsplit(separator)
        .find(|component| !component.is_empty())
        .map(str::to_string)
}

async fn load_prepared_context_at_paths(
    main_db_path: &Path,
    evidence_db_path: &Path,
    request: &StartDirectoryExportRequest,
) -> Result<PreparedDirectoryExport, String> {
    validate_request(request)?;

    let main_pool = open_read_only_pool(main_db_path, "case database").await?;
    let evidence_row_result = sqlx::query("SELECT path, type FROM evidence WHERE id = ? LIMIT 1")
        .bind(request.evidence_id)
        .fetch_optional(&main_pool)
        .await;
    main_pool.close().await;
    let evidence_row = evidence_row_result
        .map_err(|error| format!("Failed to load evidence {}: {error}", request.evidence_id))?
        .ok_or_else(|| format!("Evidence {} was not found.", request.evidence_id))?;
    let evidence_path_text: String = evidence_row
        .try_get("path")
        .map_err(|error| format!("Evidence source path is invalid: {error}"))?;
    let evidence_type: String = evidence_row
        .try_get("type")
        .map_err(|error| format!("Evidence type is invalid: {error}"))?;
    if evidence_path_text.trim().is_empty() {
        return Err("The registered evidence source path is empty.".to_string());
    }
    let evidence_path = PathBuf::from(&evidence_path_text);
    validate_source_path(&evidence_path, &evidence_type)?;

    let evidence_pool = open_read_only_pool(evidence_db_path, "evidence database").await?;
    let indexed_row_result = sqlx::query(
        r#"
        SELECT
            sf.identifier,
            sf.absolute_path,
            sf.name,
            sf.is_dir,
            p.kind,
            p.first_byte_addr,
            p.size_sectors,
            p.sector_size,
            p.size_bytes,
            p.fvek
        FROM system_files sf
        INNER JOIN partitions p
            ON p.id = sf.partition_id
           AND p.evidence_id = sf.evidence_id
        WHERE sf.id = ?
          AND sf.evidence_id = ?
          AND sf.partition_id = ?
        LIMIT 1
        "#,
    )
    .bind(request.directory_system_file_id)
    .bind(request.evidence_id)
    .bind(request.partition_id)
    .fetch_optional(&evidence_pool)
    .await;
    evidence_pool.close().await;
    let indexed_row = indexed_row_result
        .map_err(|error| format!("Failed to load the indexed directory: {error}"))?
        .ok_or_else(|| {
            format!(
                "Indexed item {} does not belong to evidence {} partition {}.",
                request.directory_system_file_id, request.evidence_id, request.partition_id
            )
        })?;

    let is_dir: i64 = indexed_row
        .try_get("is_dir")
        .map_err(|error| format!("Indexed directory type is invalid: {error}"))?;
    if is_dir != 1 {
        return Err("The selected indexed item is not a directory.".to_string());
    }
    let identifier_signed: i64 = indexed_row
        .try_get("identifier")
        .map_err(|error| format!("Indexed directory identifier is invalid: {error}"))?;
    // Identifiers are stored in SQLite as the original u64 bit pattern cast to
    // i64. Casting back preserves packed APFS volume/inode identifiers.
    let directory_identifier = identifier_signed as u64;
    let logical_path: String = indexed_row
        .try_get("absolute_path")
        .map_err(|error| format!("Indexed directory path is invalid: {error}"))?;
    if logical_path.trim().is_empty() {
        return Err("The selected indexed directory has an empty logical path.".to_string());
    }
    let indexed_name: String = indexed_row
        .try_get("name")
        .map_err(|error| format!("Indexed directory name is invalid: {error}"))?;

    let kind: String = indexed_row
        .try_get("kind")
        .map_err(|error| format!("Indexed partition kind is invalid: {error}"))?;
    match (evidence_type.as_str(), kind.as_str()) {
        ("Folder", "folder" | "logical") => {}
        ("Folder", _) => {
            return Err("The selected partition is not a folder-evidence partition.".to_string());
        }
        ("Physical Disk image" | "Logical Disk image", "folder") => {
            return Err("A disk image cannot use a folder-evidence partition.".to_string());
        }
        ("Physical Disk image" | "Logical Disk image", _) => {}
        _ => {
            return Err(format!(
                "Directory export is not supported for evidence type {evidence_type}."
            ));
        }
    }

    let first_byte_addr = nonnegative_u64(
        indexed_row
            .try_get("first_byte_addr")
            .map_err(|error| format!("Indexed partition offset is invalid: {error}"))?,
        "offset",
    )?;
    let size_bytes_column = nonnegative_u64(
        indexed_row
            .try_get("size_bytes")
            .map_err(|error| format!("Indexed partition size is invalid: {error}"))?,
        "size",
    )?;
    let size_sectors = nonnegative_u64(
        indexed_row
            .try_get("size_sectors")
            .map_err(|error| format!("Indexed partition sector count is invalid: {error}"))?,
        "sector count",
    )?;
    let sector_size = nonnegative_u64(
        indexed_row
            .try_get("sector_size")
            .map_err(|error| format!("Indexed partition sector size is invalid: {error}"))?,
        "sector size",
    )?;
    let computed_size = size_sectors.checked_mul(sector_size).ok_or_else(|| {
        "Indexed partition size overflows the supported address range.".to_string()
    })?;
    let size_bytes = if size_bytes_column > 0 {
        size_bytes_column
    } else {
        computed_size
    };
    let fvek_hex = indexed_row
        .try_get::<Option<String>, _>("fvek")
        .map_err(|error| format!("Indexed partition key material is invalid: {error}"))?
        .filter(|value| !value.trim().is_empty())
        .map(Zeroizing::new);

    let destination_parent =
        canonical_existing_directory(Path::new(&request.destination_parent), "export destination")?;
    let evidence_path = if evidence_type == "Folder" {
        let (canonical_root, selected_source) =
            resolve_folder_source_directory(&evidence_path, &logical_path).map_err(|error| {
                format!(
                    "{error} The indexed folder location may be stale; reprocess the evidence before exporting it."
                )
            })?;
        validate_folder_destination(&canonical_root, &selected_source, &destination_parent)?;
        canonical_root
    } else {
        evidence_path
    };

    // Evidence paths use the source filesystem separator, not necessarily the
    // analyst host separator. Prefer the selected directory-entry occurrence
    // over an indexed metadata name (which may be a stale NTFS 8.3 alias).
    let path_occurrence_name = selected_path_occurrence_name(&logical_path, &evidence_type);
    let output_name = path_occurrence_name
        .or_else(|| (!indexed_name.trim().is_empty()).then(|| indexed_name.clone()))
        .or_else(|| {
            evidence_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("directory-{}", request.directory_system_file_id));

    Ok(PreparedDirectoryExport {
        evidence_id: request.evidence_id,
        partition_id: request.partition_id,
        directory_system_file_id: request.directory_system_file_id,
        evidence_type,
        evidence_path,
        registered_source_path: evidence_path_text,
        partition: PreparedPartition {
            kind,
            first_byte_addr,
            size_bytes,
            fvek_hex,
        },
        directory_identifier,
        logical_path,
        output_name,
        destination_parent,
    })
}

async fn load_prepared_context(
    app: &AppHandle,
    request: &StartDirectoryExportRequest,
) -> Result<PreparedDirectoryExport, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to locate application data: {error}"))?;
    load_prepared_context_at_paths(
        &base_dir.join("thanatology.db"),
        &base_dir
            .join("evidences")
            .join(format!("{}.db", request.evidence_id)),
        request,
    )
    .await
}

fn emit_snapshot(app: &AppHandle, snapshot: &DirectoryExportJobSnapshot) {
    if let Err(error) = app.emit(DIRECTORY_EXPORT_EVENT, snapshot) {
        warn!("Failed to emit directory-export progress: {error}");
    }
}

fn update_and_emit(
    registry: &DirectoryExportRegistry,
    app: &AppHandle,
    job_id: &str,
    update: impl FnOnce(&mut DirectoryExportJobSnapshot),
) {
    if let Some(snapshot) = registry.update(job_id, update) {
        emit_snapshot(app, &snapshot);
    }
}

fn mark_job_started(snapshot: &mut DirectoryExportJobSnapshot) {
    if snapshot.status == DirectoryExportJobStatus::Queued {
        snapshot.status = DirectoryExportJobStatus::Running;
    }
    snapshot.stage = DirectoryExportJobStage::Preparing;
}

fn apply_execution_progress(
    snapshot: &mut DirectoryExportJobSnapshot,
    progress: ExecutionProgress,
) {
    snapshot.stage = progress.stage;
    snapshot.current_path = progress.current_path;
    snapshot.entries_processed = progress.entries_processed;
    snapshot.files_exported = progress.files_exported;
    snapshot.directories_created = progress.directories_created;
    snapshot.bytes_written = progress.bytes_written;
    snapshot.skipped_entries = progress.skipped_entries;
    snapshot.failed_entries = progress.failed_entries;
    snapshot.failures = progress
        .failures
        .into_iter()
        .take(MAX_REPORTED_FAILURES)
        .collect();
}

fn open_dedicated_filesystem(
    prepared: &mut PreparedDirectoryExport,
) -> Result<DetectedFs<ImageStream>, String> {
    if prepared.evidence_type == "Folder" {
        return Ok(DetectedFs::Folder(FolderFS::new(
            prepared.evidence_path.clone(),
        )));
    }

    let path = prepared.evidence_path.to_string_lossy().into_owned();
    let body = Body::try_new(path.clone(), "auto")
        .map_err(|error| format!("Unable to open evidence source '{path}': {error}"))?;
    let image_size = body.get_image_size();
    let partition_size = effective_partition_size(
        &prepared.partition.kind,
        prepared.partition.size_bytes,
        image_size,
    );
    if partition_size == 0 {
        return Err("The indexed partition has an empty size.".to_string());
    }
    let partition_end = prepared
        .partition
        .first_byte_addr
        .checked_add(partition_size)
        .ok_or_else(|| "The indexed partition extent overflows u64.".to_string())?;
    if image_size > 0 && partition_end > image_size {
        return Err(format!(
            "The indexed partition extent ({partition_end} bytes) exceeds the evidence size ({image_size} bytes)."
        ));
    }
    // Preserve the validated effective geometry in plaintext provenance. This
    // replaces the legacy zero-size marker used by whole-image logical rows.
    prepared.partition.size_bytes = partition_size;

    let key_material = prepared
        .partition
        .fvek_hex
        .take()
        .map(|secret| {
            hex::decode(secret.trim())
                .map(|bytes| KeyMaterial {
                    bitlocker_fvek: Some(bytes),
                })
                .map_err(|_| "The stored BitLocker FVEK is not valid hexadecimal.".to_string())
        })
        .transpose()?;
    detect_filesystem(
        &body,
        prepared.partition.first_byte_addr,
        partition_size,
        key_material,
    )
    .map_err(|error| format!("Unable to open the indexed filesystem: {error}"))
}

fn execute_prepared_export(
    mut prepared: PreparedDirectoryExport,
    cancel: Arc<AtomicBool>,
    mut on_progress: impl FnMut(ExecutionProgress),
) -> Result<ExecutionCompletion, ExecutionError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(ExecutionError::Cancelled {
            message: "Directory export was cancelled before it started.".to_string(),
            entries_processed: 0,
            bytes_written: 0,
        });
    }
    on_progress(ExecutionProgress {
        stage: DirectoryExportJobStage::Preparing,
        current_path: Some(prepared.logical_path.clone()),
        entries_processed: 0,
        files_exported: 0,
        directories_created: 0,
        bytes_written: 0,
        skipped_entries: 0,
        failed_entries: 0,
        failures: Vec::new(),
    });

    let mut filesystem =
        open_dedicated_filesystem(&mut prepared).map_err(ExecutionError::Failed)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(ExecutionError::Cancelled {
            message: "Directory export was cancelled while opening the evidence filesystem."
                .to_string(),
            entries_processed: 0,
            bytes_written: 0,
        });
    }
    let source_record = filesystem
        .get_file_by_path(&prepared.logical_path, prepared.directory_identifier)
        .map_err(|error| {
            ExecutionError::Failed(format!(
                "Unable to resolve indexed directory {} against the current evidence source: {error}. Reprocess the evidence before exporting this directory.",
                prepared.logical_path
            ))
        })?;
    if !source_record.is_dir() {
        return Err(ExecutionError::Failed(format!(
            "Indexed path is no longer a directory: {}. Reprocess the evidence before exporting it.",
            prepared.logical_path
        )));
    }
    let resolved_identifier = filesystem.file_identifier(&source_record);
    if resolved_identifier != prepared.directory_identifier {
        return Err(ExecutionError::Failed(format!(
            "Indexed directory identity changed for {} (expected {}, resolved {}). Reprocess the evidence before exporting it.",
            prepared.logical_path, prepared.directory_identifier, resolved_identifier
        )));
    }

    let mut public_metadata = BTreeMap::new();
    public_metadata.insert(
        "directorySystemFileId".to_string(),
        prepared.directory_system_file_id.to_string(),
    );
    public_metadata.insert("partitionKind".to_string(), prepared.partition.kind.clone());
    public_metadata.insert(
        "partitionFirstByteAddress".to_string(),
        prepared.partition.first_byte_addr.to_string(),
    );
    public_metadata.insert(
        "partitionSizeBytes".to_string(),
        prepared.partition.size_bytes.to_string(),
    );
    public_metadata.insert(
        "sourceView".to_string(),
        filesystem.source_view().as_str().to_string(),
    );
    let options = DirectoryExportOptions {
        provenance: DirectoryExportProvenance {
            evidence_id: Some(prepared.evidence_id.to_string()),
            partition_id: Some(prepared.partition_id.to_string()),
            source_path: Some(prepared.registered_source_path.clone()),
            source_description: Some(prepared.evidence_type.clone()),
            public_metadata,
        },
        ..DirectoryExportOptions::default()
    };
    let source = DirectoryExportSource::new(
        source_record,
        prepared.directory_identifier,
        prepared.logical_path,
        prepared.output_name,
    );
    let mut copying_started = false;
    let mut progress_callback = |progress: &DirectoryExportProgress| {
        let stage = match progress.stage {
            DirectoryExportStage::Preparing => DirectoryExportJobStage::Preparing,
            DirectoryExportStage::Exporting => {
                copying_started |=
                    progress.current_file_total > 0 || progress.current_file_bytes > 0;
                if copying_started {
                    DirectoryExportJobStage::Copying
                } else {
                    DirectoryExportJobStage::Traversing
                }
            }
            DirectoryExportStage::Finalizing => DirectoryExportJobStage::Finalizing,
            DirectoryExportStage::Complete => DirectoryExportJobStage::Complete,
        };
        on_progress(ExecutionProgress {
            stage,
            current_path: (!progress.current_logical_path.is_empty())
                .then(|| progress.current_logical_path.clone()),
            entries_processed: progress.entries_processed,
            files_exported: progress.files_exported,
            directories_created: progress.directories_exported,
            bytes_written: progress.bytes_written,
            skipped_entries: progress.skipped_entries,
            failed_entries: progress.failed_entries,
            failures: Vec::new(),
        });
    };
    let mut control =
        DirectoryExportControl::new(Some(cancel.as_ref()), Some(&mut progress_callback));
    let report = export_directory(
        &mut filesystem,
        source,
        &prepared.destination_parent,
        &options,
        &mut control,
    )
    .map_err(|error| match error {
        DirectoryExportError::Cancelled {
            entries_processed,
            bytes_written,
        } => ExecutionError::Cancelled {
            message: format!(
                "Directory export cancelled after {entries_processed} entries and {bytes_written} bytes"
            ),
            entries_processed,
            bytes_written,
        },
        error => ExecutionError::Failed(error.to_string()),
    })?;

    Ok(ExecutionCompletion {
        output_path: report.output_path,
        manifest_path: report.manifest_path,
        entries_processed: report.entries_processed,
        files_exported: report.files_exported,
        directories_created: report.directories_exported,
        bytes_written: report.bytes_written,
        skipped_entries: report.skipped_entries,
        failed_entries: report.failed_entries,
        failures: report
            .failures
            .into_iter()
            .take(MAX_REPORTED_FAILURES)
            .map(|failure| DirectoryExportFailureSnapshot {
                path: failure.source_logical_path,
                error: format!("{}: {}", failure.operation, failure.message),
            })
            .collect(),
    })
}

async fn run_directory_export_job(
    app: AppHandle,
    registry: Arc<DirectoryExportRegistry>,
    job_id: String,
    prepared: PreparedDirectoryExport,
    cancel: Arc<AtomicBool>,
) {
    update_and_emit(&registry, &app, &job_id, mark_job_started);

    let progress_registry = registry.clone();
    let progress_app = app.clone();
    let progress_job_id = job_id.clone();
    let execution = tokio::task::spawn_blocking(move || {
        let mut emission_gate = ProgressEmissionGate::default();
        execute_prepared_export(prepared, cancel, |progress| {
            let should_emit = emission_gate.should_emit(&progress, Instant::now());
            if should_emit {
                let snapshot = progress_registry.update(&progress_job_id, |snapshot| {
                    apply_execution_progress(snapshot, progress)
                });
                if let Some(snapshot) = snapshot {
                    emit_snapshot(&progress_app, &snapshot);
                }
            } else {
                progress_registry.update_silent(&progress_job_id, |snapshot| {
                    apply_execution_progress(snapshot, progress)
                });
            }
        })
    })
    .await;

    match execution {
        Ok(Ok(completion)) => {
            update_and_emit(&registry, &app, &job_id, |snapshot| {
                snapshot.status = DirectoryExportJobStatus::Completed;
                snapshot.stage = DirectoryExportJobStage::Complete;
                snapshot.current_path = None;
                snapshot.output_path = Some(completion.output_path.to_string_lossy().into_owned());
                snapshot.manifest_path =
                    Some(completion.manifest_path.to_string_lossy().into_owned());
                snapshot.entries_processed = completion.entries_processed;
                snapshot.files_exported = completion.files_exported;
                snapshot.directories_created = completion.directories_created;
                snapshot.bytes_written = completion.bytes_written;
                snapshot.skipped_entries = completion.skipped_entries;
                snapshot.failed_entries = completion.failed_entries;
                snapshot.failures = completion.failures;
                snapshot.finished_at_unix_ms = Some(unix_time_ms());
            });
            info!("Directory export job {job_id} completed");
        }
        Ok(Err(ExecutionError::Cancelled {
            message,
            entries_processed,
            bytes_written,
        })) => {
            update_and_emit(&registry, &app, &job_id, |snapshot| {
                snapshot.status = DirectoryExportJobStatus::Cancelled;
                snapshot.stage = DirectoryExportJobStage::Cancelled;
                snapshot.current_path = None;
                snapshot.entries_processed = entries_processed;
                snapshot.bytes_written = bytes_written;
                snapshot.error = Some(message);
                snapshot.finished_at_unix_ms = Some(unix_time_ms());
            });
        }
        Ok(Err(ExecutionError::Failed(message))) => {
            update_and_emit(&registry, &app, &job_id, |snapshot| {
                snapshot.status = DirectoryExportJobStatus::Failed;
                snapshot.stage = DirectoryExportJobStage::Failed;
                snapshot.current_path = None;
                snapshot.error = Some(message);
                snapshot.finished_at_unix_ms = Some(unix_time_ms());
            });
        }
        Err(error) => {
            update_and_emit(&registry, &app, &job_id, |snapshot| {
                snapshot.status = DirectoryExportJobStatus::Failed;
                snapshot.stage = DirectoryExportJobStage::Failed;
                snapshot.current_path = None;
                snapshot.error = Some(format!("Directory export task failed: {error}"));
                snapshot.finished_at_unix_ms = Some(unix_time_ms());
            });
        }
    }
}

#[tauri::command]
pub async fn start_directory_export(
    app: AppHandle,
    state: State<'_, DirectoryExportState>,
    request: StartDirectoryExportRequest,
) -> Result<DirectoryExportJobSnapshot, String> {
    let prepared = load_prepared_context(&app, &request).await?;
    let job_id = request.operation_id;
    let cancel = Arc::new(AtomicBool::new(false));
    let snapshot = DirectoryExportJobSnapshot {
        job_id: job_id.clone(),
        evidence_id: prepared.evidence_id,
        partition_id: prepared.partition_id,
        directory_system_file_id: prepared.directory_system_file_id,
        source_path: prepared.logical_path.clone(),
        destination_parent: prepared.destination_parent.to_string_lossy().into_owned(),
        output_path: None,
        status: DirectoryExportJobStatus::Queued,
        stage: DirectoryExportJobStage::Queued,
        current_path: None,
        entries_processed: 0,
        total_entries: None,
        files_exported: 0,
        directories_created: 0,
        bytes_written: 0,
        total_bytes: None,
        skipped_entries: 0,
        failed_entries: 0,
        failures: Vec::new(),
        manifest_path: None,
        error: None,
        started_at_unix_ms: Some(unix_time_ms()),
        finished_at_unix_ms: None,
    };
    state.registry.insert(snapshot.clone(), cancel.clone())?;
    emit_snapshot(&app, &snapshot);

    let registry = state.registry.clone();
    tauri::async_runtime::spawn(run_directory_export_job(
        app, registry, job_id, prepared, cancel,
    ));
    Ok(snapshot)
}

#[tauri::command]
pub fn get_directory_export_jobs(
    state: State<'_, DirectoryExportState>,
    evidence_id: Option<i64>,
) -> Result<Vec<DirectoryExportJobSnapshot>, String> {
    if evidence_id.is_some_and(|evidence_id| evidence_id <= 0) {
        return Err("Evidence ID must be positive.".to_string());
    }
    Ok(state.registry.snapshots(evidence_id))
}

#[tauri::command]
pub fn cancel_directory_export(
    app: AppHandle,
    state: State<'_, DirectoryExportState>,
    job_id: String,
) -> Result<CancelDirectoryExportResult, String> {
    if !is_canonical_uuid_v4(&job_id) {
        return Err("Directory export jobId must be a canonical lowercase UUID v4.".to_string());
    }
    let (accepted, snapshot) = state.registry.cancel(&job_id);
    if let Some(snapshot) = snapshot {
        emit_snapshot(&app, &snapshot);
    }
    Ok(CancelDirectoryExportResult { accepted })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    fn snapshot(
        job_id: &str,
        status: DirectoryExportJobStatus,
        timestamp: u64,
    ) -> DirectoryExportJobSnapshot {
        DirectoryExportJobSnapshot {
            job_id: job_id.to_string(),
            evidence_id: 7,
            partition_id: 8,
            directory_system_file_id: 9,
            source_path: "/Users/Alice/Documents".to_string(),
            destination_parent: "/exports".to_string(),
            output_path: None,
            status,
            stage: DirectoryExportJobStage::Queued,
            current_path: None,
            entries_processed: 0,
            total_entries: None,
            files_exported: 0,
            directories_created: 0,
            bytes_written: 0,
            total_bytes: None,
            skipped_entries: 0,
            failed_entries: 0,
            failures: Vec::new(),
            manifest_path: None,
            error: None,
            started_at_unix_ms: Some(timestamp),
            finished_at_unix_ms: status.is_terminal().then_some(timestamp),
        }
    }

    #[test]
    fn request_requires_concrete_positive_ids_and_destination() {
        let valid = StartDirectoryExportRequest {
            operation_id: "018f47f2-62d1-4f73-8ac8-f8e295c5a711".to_string(),
            evidence_id: 1,
            partition_id: 2,
            directory_system_file_id: 3,
            destination_parent: "/tmp".to_string(),
        };
        assert!(validate_request(&valid).is_ok());
        for invalid in [
            StartDirectoryExportRequest {
                operation_id: "not-a-uuid".to_string(),
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                operation_id: "018f47f2-62d1-4f73-8ac8-f8e295c5A711".to_string(),
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                operation_id: "018f47f2-62d1-5f73-8ac8-f8e295c5a711".to_string(),
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                operation_id: "018f47f2-62d1-4f73-7ac8-f8e295c5a711".to_string(),
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                evidence_id: 0,
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                partition_id: 0,
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                directory_system_file_id: 0,
                ..valid.clone()
            },
            StartDirectoryExportRequest {
                destination_parent: "  ".to_string(),
                ..valid.clone()
            },
        ] {
            assert!(validate_request(&invalid).is_err());
        }
    }

    #[test]
    fn snapshot_serializes_the_camel_case_ipc_contract() {
        let mut item = snapshot("job-1", DirectoryExportJobStatus::Running, 123);
        item.failed_entries = 17;
        item.failures.push(DirectoryExportFailureSnapshot {
            path: "/unreadable.bin".to_string(),
            error: "read: denied".to_string(),
        });
        let value = serde_json::to_value(item).expect("serialize snapshot");
        assert_eq!(value["jobId"], "job-1");
        assert_eq!(value["directorySystemFileId"], 9);
        assert_eq!(value["failedEntries"], 17);
        assert_eq!(value["status"], "running");
        assert!(value.get("failed_entries").is_none());
    }

    #[test]
    fn cancellation_is_keyed_and_terminal_jobs_are_immutable() {
        let registry = DirectoryExportRegistry::default();
        let live_cancel = Arc::new(AtomicBool::new(false));
        registry
            .insert(
                snapshot("live", DirectoryExportJobStatus::Running, 1),
                live_cancel.clone(),
            )
            .expect("insert live job");
        registry
            .insert(
                snapshot("done", DirectoryExportJobStatus::Completed, 2),
                Arc::new(AtomicBool::new(false)),
            )
            .expect("insert terminal job");

        let (accepted, live) = registry.cancel("live");
        assert!(accepted);
        assert!(live_cancel.load(Ordering::Relaxed));
        assert_eq!(
            live.expect("live snapshot").status,
            DirectoryExportJobStatus::Cancelling
        );

        let (accepted, done) = registry.cancel("done");
        assert!(!accepted);
        assert_eq!(
            done.expect("terminal snapshot").status,
            DirectoryExportJobStatus::Completed
        );
        assert_eq!(registry.cancel("missing").0, false);
    }

    #[test]
    fn starting_worker_does_not_overwrite_an_early_cancellation() {
        let mut item = snapshot(
            "cancelled-before-start",
            DirectoryExportJobStatus::Cancelling,
            1,
        );
        mark_job_started(&mut item);
        assert_eq!(item.status, DirectoryExportJobStatus::Cancelling);
        assert_eq!(item.stage, DirectoryExportJobStage::Preparing);
    }

    #[test]
    fn terminal_retention_is_bounded_without_removing_live_jobs() {
        let registry = DirectoryExportRegistry::default();
        registry
            .insert(
                snapshot("live", DirectoryExportJobStatus::Running, 1),
                Arc::new(AtomicBool::new(false)),
            )
            .expect("insert live job");
        {
            let mut jobs = registry.jobs();
            for index in 0..(MAX_TERMINAL_DIRECTORY_EXPORTS + 5) {
                let item = snapshot(
                    &format!("terminal-{index}"),
                    DirectoryExportJobStatus::Completed,
                    index as u64 + 10,
                );
                jobs.insert(
                    item.job_id.clone(),
                    ManagedDirectoryExportJob {
                        snapshot: item,
                        cancel: Arc::new(AtomicBool::new(false)),
                    },
                );
            }
            prune_terminal_jobs(&mut jobs);
        }
        let snapshots = registry.snapshots(None);
        assert_eq!(
            snapshots
                .iter()
                .filter(|item| item.status.is_terminal())
                .count(),
            MAX_TERMINAL_DIRECTORY_EXPORTS
        );
        assert!(snapshots.iter().any(|item| item.job_id == "live"));
    }

    #[test]
    fn folder_export_rejects_any_destination_inside_the_evidence_root() {
        let directory = tempfile::tempdir().expect("temp directory");
        let root = directory.path().join("evidence");
        let selected = root.join("Users").join("Alice");
        let sibling = root.join("Exports");
        let outside = directory.path().join("outside");
        std::fs::create_dir_all(&selected).expect("selected fixture");
        std::fs::create_dir_all(&sibling).expect("sibling fixture");
        std::fs::create_dir_all(&outside).expect("outside fixture");
        let (canonical_root, canonical_selected) =
            resolve_folder_source_directory(&root, "/Users/Alice").expect("resolve source");
        let sibling =
            canonical_existing_directory(&sibling, "export destination").expect("resolve sibling");
        let outside =
            canonical_existing_directory(&outside, "export destination").expect("resolve outside");
        assert!(
            validate_folder_destination(&canonical_root, &canonical_selected, &sibling).is_err()
        );
        assert!(
            validate_folder_destination(&canonical_root, &canonical_selected, &outside).is_ok()
        );
        #[cfg(unix)]
        {
            let backslash_name = root.join(r"\Cases");
            std::fs::create_dir(&backslash_name).expect("backslash directory fixture");
            let (_, resolved) = resolve_folder_source_directory(&root, r"/\Cases")
                .expect("preserve legal backslash component");
            assert_eq!(resolved, std::fs::canonicalize(backslash_name).unwrap());
        }
    }

    #[test]
    fn partition_geometry_honors_physical_extent_even_at_offset_zero() {
        assert_eq!(effective_partition_size("gpt", 4096, 1_000_000), 4096);
        assert_eq!(effective_partition_size("logical", 4096, 1_000_000), 4096);
        assert_eq!(effective_partition_size("logical", 0, 1_000_000), 1_000_000);
    }

    #[test]
    fn output_name_uses_the_evidence_separator_and_path_occurrence() {
        let logical_path = r"\Users\Suspect\Documents";
        assert_eq!(
            selected_path_occurrence_name(logical_path, "Physical Disk image").as_deref(),
            Some("Documents")
        );
        #[cfg(unix)]
        {
            assert_eq!(
                selected_path_occurrence_name(r"/Cases/foo\bar", "Folder").as_deref(),
                Some(r"foo\bar")
            );
            assert_eq!(
                selected_path_occurrence_name("/Cases/ ", "Folder").as_deref(),
                Some(" ")
            );
        }
        assert_eq!(
            selected_path_occurrence_name(r"/volume_1/Cases/foo\bar", "Physical Disk image")
                .as_deref(),
            Some(r"foo\bar")
        );
    }

    #[test]
    fn progress_gate_throttles_chunks_and_tiny_file_path_transitions() {
        let now = Instant::now();
        let mut gate = ProgressEmissionGate::default();
        let mut progress = ExecutionProgress {
            stage: DirectoryExportJobStage::Copying,
            current_path: Some("/one.bin".to_string()),
            entries_processed: 1,
            files_exported: 0,
            directories_created: 1,
            bytes_written: 1,
            skipped_entries: 0,
            failed_entries: 0,
            failures: Vec::new(),
        };
        assert!(gate.should_emit(&progress, now));
        progress.bytes_written += 1024;
        assert!(!gate.should_emit(&progress, now + Duration::from_millis(10)));
        progress.current_path = Some("/two.bin".to_string());
        assert!(!gate.should_emit(&progress, now + Duration::from_millis(20)));
        progress.bytes_written += PROGRESS_EMIT_BYTES;
        assert!(gate.should_emit(&progress, now + Duration::from_millis(30)));
        progress.stage = DirectoryExportJobStage::Finalizing;
        assert!(gate.should_emit(&progress, now + Duration::from_millis(40)));
    }

    #[test]
    fn backend_snapshot_updates_even_when_progress_event_is_throttled() {
        let registry = DirectoryExportRegistry::default();
        registry
            .insert(
                snapshot("silent-progress", DirectoryExportJobStatus::Running, 1),
                Arc::new(AtomicBool::new(false)),
            )
            .expect("insert job");
        let progress = ExecutionProgress {
            stage: DirectoryExportJobStage::Copying,
            current_path: Some("/many/tiny/file.txt".to_string()),
            entries_processed: 987,
            files_exported: 800,
            directories_created: 42,
            bytes_written: 4096,
            skipped_entries: 100,
            failed_entries: 45,
            failures: Vec::new(),
        };
        assert!(registry.update_silent("silent-progress", |snapshot| {
            apply_execution_progress(snapshot, progress)
        }));

        let latest = registry
            .snapshots(None)
            .into_iter()
            .next()
            .expect("updated snapshot");
        assert_eq!(latest.entries_processed, 987);
        assert_eq!(latest.files_exported, 800);
        assert_eq!(latest.directories_created, 42);
        assert_eq!(latest.skipped_entries, 100);
        assert_eq!(latest.failed_entries, 45);
        assert_eq!(latest.current_path.as_deref(), Some("/many/tiny/file.txt"));
    }

    #[test]
    #[cfg(unix)]
    fn folder_adapter_exports_the_authoritatively_resolved_directory() {
        let directory = tempfile::tempdir().expect("temp directory");
        let source_root = directory.path().join("source ");
        let selected = source_root.join("Documents");
        let nested = selected.join("Cases");
        let destination = directory.path().join("destination ");
        std::fs::create_dir_all(&nested).expect("source fixture");
        std::fs::create_dir_all(&destination).expect("destination fixture");
        std::fs::write(nested.join("note.txt"), b"forensic fixture").expect("fixture file");
        let identifier = std::fs::symlink_metadata(&selected)
            .expect("selected metadata")
            .ino();
        let prepared = PreparedDirectoryExport {
            evidence_id: 7,
            partition_id: 8,
            directory_system_file_id: 9,
            evidence_type: "Folder".to_string(),
            evidence_path: source_root.clone(),
            registered_source_path: source_root.to_string_lossy().into_owned(),
            partition: PreparedPartition {
                kind: "folder".to_string(),
                first_byte_addr: 0,
                size_bytes: 0,
                fvek_hex: None,
            },
            directory_identifier: identifier,
            logical_path: "/Documents".to_string(),
            output_name: "Documents".to_string(),
            destination_parent: destination.clone(),
        };
        let mut stages = Vec::new();
        let completion =
            execute_prepared_export(prepared, Arc::new(AtomicBool::new(false)), |progress| {
                stages.push(progress.stage)
            })
            .expect("directory export");

        assert_eq!(completion.files_exported, 1);
        assert_eq!(completion.directories_created, 2);
        assert_eq!(completion.bytes_written, 16);
        assert_eq!(
            completion.output_path,
            std::fs::canonicalize(&destination)
                .expect("canonical destination")
                .join("Documents")
        );
        assert_eq!(
            std::fs::read(completion.output_path.join("Cases").join("note.txt"))
                .expect("exported file"),
            b"forensic fixture"
        );
        assert!(completion.manifest_path.is_file());
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&completion.manifest_path).expect("manifest contents"),
        )
        .expect("manifest JSON");
        assert_eq!(manifest["provenance"]["evidence_id"], "7");
        assert_eq!(manifest["provenance"]["partition_id"], "8");
        assert_eq!(manifest["provenance"]["source_description"], "Folder");
        assert_eq!(
            manifest["provenance"]["source_path"],
            source_root.to_string_lossy().as_ref()
        );
        assert_eq!(
            manifest["provenance"]["public_metadata"]["directorySystemFileId"],
            "9"
        );
        assert_eq!(
            manifest["provenance"]["public_metadata"]["sourceView"],
            "native"
        );
        assert!(!manifest.to_string().to_ascii_lowercase().contains("fvek"));
        assert!(stages.contains(&DirectoryExportJobStage::Traversing));
        assert!(stages.contains(&DirectoryExportJobStage::Copying));
        assert!(stages.contains(&DirectoryExportJobStage::Finalizing));
        let stage_rank = |stage: DirectoryExportJobStage| match stage {
            DirectoryExportJobStage::Queued => 0,
            DirectoryExportJobStage::Preparing => 1,
            DirectoryExportJobStage::Traversing => 2,
            DirectoryExportJobStage::Copying => 3,
            DirectoryExportJobStage::Finalizing => 4,
            DirectoryExportJobStage::Complete
            | DirectoryExportJobStage::Cancelled
            | DirectoryExportJobStage::Failed => 5,
        };
        assert!(
            stages
                .windows(2)
                .all(|pair| stage_rank(pair[0]) <= stage_rank(pair[1]))
        );
    }

    #[test]
    #[cfg(unix)]
    fn folder_adapter_rejects_a_replaced_indexed_identity() {
        let directory = tempfile::tempdir().expect("temp directory");
        let source_root = directory.path().join("source");
        let selected = source_root.join("Documents");
        let destination = directory.path().join("destination");
        std::fs::create_dir_all(&selected).expect("source fixture");
        std::fs::create_dir_all(&destination).expect("destination fixture");
        let actual_identifier = std::fs::symlink_metadata(&selected)
            .expect("selected metadata")
            .ino();
        let stale_identifier = actual_identifier.wrapping_add(1);
        let prepared = PreparedDirectoryExport {
            evidence_id: 7,
            partition_id: 8,
            directory_system_file_id: 9,
            evidence_type: "Folder".to_string(),
            evidence_path: source_root.clone(),
            registered_source_path: source_root.to_string_lossy().into_owned(),
            partition: PreparedPartition {
                kind: "folder".to_string(),
                first_byte_addr: 0,
                size_bytes: 0,
                fvek_hex: None,
            },
            directory_identifier: stale_identifier,
            logical_path: "/Documents".to_string(),
            output_name: "Documents".to_string(),
            destination_parent: destination.clone(),
        };
        let error = execute_prepared_export(prepared, Arc::new(AtomicBool::new(false)), |_| {})
            .err()
            .expect("stale identity must fail");
        let ExecutionError::Failed(message) = error else {
            panic!("stale identity was reported as cancellation")
        };
        assert!(message.contains("expected"));
        assert!(!destination.join("Documents").exists());
    }

    #[tokio::test]
    async fn context_is_resolved_from_authoritative_scoped_database_rows() {
        let directory = tempfile::tempdir().expect("temp directory");
        let source_root = directory.path().join("source ");
        let selected = source_root.join("Users").join("Suspect").join("Documents");
        let destination = directory.path().join("destination ");
        std::fs::create_dir_all(&selected).expect("source fixture");
        std::fs::create_dir_all(&destination).expect("destination fixture");
        let main_db_path = directory.path().join("thanatology.db");
        let evidence_db_path = directory.path().join("7.db");

        let main_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&main_db_path)
                    .create_if_missing(true),
            )
            .await
            .expect("main database");
        sqlx::query("CREATE TABLE evidence (id INTEGER PRIMARY KEY, path TEXT, type TEXT)")
            .execute(&main_pool)
            .await
            .expect("main schema");
        sqlx::query("INSERT INTO evidence (id, path, type) VALUES (7, ?, 'Folder')")
            .bind(source_root.to_string_lossy().as_ref())
            .execute(&main_pool)
            .await
            .expect("evidence row");
        main_pool.close().await;

        let evidence_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&evidence_db_path)
                    .create_if_missing(true),
            )
            .await
            .expect("evidence database");
        sqlx::query(
            r#"CREATE TABLE partitions (
                id INTEGER PRIMARY KEY, evidence_id INTEGER, kind TEXT,
                first_byte_addr INTEGER, size_sectors INTEGER,
                sector_size INTEGER, size_bytes INTEGER, fvek TEXT
            )"#,
        )
        .execute(&evidence_pool)
        .await
        .expect("partition schema");
        sqlx::query(
            r#"CREATE TABLE system_files (
                id INTEGER PRIMARY KEY, evidence_id INTEGER, partition_id INTEGER,
                identifier INTEGER, absolute_path TEXT, name TEXT, is_dir INTEGER
            )"#,
        )
        .execute(&evidence_pool)
        .await
        .expect("file schema");
        sqlx::query("INSERT INTO partitions VALUES (8, 7, 'folder', 0, 0, 0, 0, NULL)")
            .execute(&evidence_pool)
            .await
            .expect("partition row");
        sqlx::query(
            r#"INSERT INTO system_files
               VALUES (9, 7, 8, 123, '/Users/Suspect/Documents', 'DOCUME~1', 1)"#,
        )
        .execute(&evidence_pool)
        .await
        .expect("directory row");
        evidence_pool.close().await;

        let request = StartDirectoryExportRequest {
            operation_id: "018f47f2-62d1-4f73-8ac8-f8e295c5a711".to_string(),
            evidence_id: 7,
            partition_id: 8,
            directory_system_file_id: 9,
            destination_parent: destination.to_string_lossy().into_owned(),
        };
        let prepared = load_prepared_context_at_paths(&main_db_path, &evidence_db_path, &request)
            .await
            .expect("authoritative context");
        assert_eq!(prepared.directory_identifier, 123);
        assert_eq!(prepared.logical_path, "/Users/Suspect/Documents");
        assert_eq!(prepared.output_name, "Documents");
        assert_eq!(
            prepared.registered_source_path,
            source_root.to_string_lossy().as_ref()
        );
        assert_eq!(
            prepared.evidence_path,
            std::fs::canonicalize(&source_root).unwrap()
        );
        assert_eq!(
            prepared.destination_parent,
            std::fs::canonicalize(&destination).unwrap()
        );

        let wrong_partition = StartDirectoryExportRequest {
            partition_id: 99,
            ..request.clone()
        };
        let error =
            load_prepared_context_at_paths(&main_db_path, &evidence_db_path, &wrong_partition)
                .await
                .err()
                .expect("mismatched partition must fail");
        assert!(error.contains("does not belong"));
    }
}
