use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use exhume_memory::{
    BitlockerHit, BitlockerScanCallbacks, BitlockerScanRequest, ConnectorKind,
    ConnectorOptions, MemdumpCallbacks, MemdumpRequest, MemoryProgressUpdate, MemoryService,
    ModuleRecord, OsKind, ProcessRecord, PsListRequest, TriageRequest, scan_bitlocker_with_callbacks,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_LIMIT: usize = 32;
const DEFAULT_PROBE_LIMIT: usize = 8;
const DEFAULT_CHUNK_SIZE: usize = 0x100000;
const DMA_RELEASE_DELAY_MS: u64 = 250;

pub struct MemoryExecutionState {
    pub lock: tokio::sync::Mutex<()>,
}

impl Default for MemoryExecutionState {
    fn default() -> Self {
        Self {
            lock: tokio::sync::Mutex::new(()),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryConnectorType {
    Pcileech,
    Rawmem,
}

impl MemoryConnectorType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pcileech => "pcileech",
            Self::Rawmem => "rawmem",
        }
    }
}

impl From<MemoryConnectorType> for ConnectorKind {
    fn from(value: MemoryConnectorType) -> Self {
        match value {
            MemoryConnectorType::Pcileech => Self::Pcileech,
            MemoryConnectorType::Rawmem => Self::Rawmem,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOsKind {
    #[default]
    Windows,
    Linux,
}

impl From<MemoryOsKind> for OsKind {
    fn from(value: MemoryOsKind) -> Self {
        match value {
            MemoryOsKind::Windows => Self::Windows,
            MemoryOsKind::Linux => Self::Linux,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverMemoryDmaRequest {
    pub session_id: String,
    pub connector: String,
    pub connector_type: MemoryConnectorType,
    pub process_limit: Option<usize>,
    #[serde(default)]
    pub os_kind: MemoryOsKind,
    pub linux_profile: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMemoryModuleRequest {
    pub session_id: String,
    pub connector: String,
    pub connector_type: MemoryConnectorType,
    pub module_id: String,
    pub limit: Option<usize>,
    #[serde(alias = "process")]
    pub pid: Option<u32>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub chunk_size: Option<usize>,
    pub output_path: Option<String>,
    #[serde(default)]
    pub os_kind: MemoryOsKind,
    pub linux_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryModuleDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub supports_process_filter: bool,
    pub supports_address_range: bool,
    pub requires_output_path: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverMemoryDmaResponse {
    pub healthy: bool,
    pub connector: String,
    pub connector_type: String,
    pub max_address_hex: String,
    pub physical_memory_end_hex: String,
    pub sample_process_count: usize,
    pub available_modules: Vec<MemoryModuleDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryModuleExecutionResponse {
    pub module_id: String,
    pub row_count: usize,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryGridColumn {
    field: String,
    header_name: String,
    min_width: u16,
    flex: u16,
    #[serde(rename = "type")]
    column_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum MemorySessionEvent {
    ResetResults,
    Status { level: String, message: String },
    Progress { current: u64, total: u64, message: String },
    ResultSchema { title: String, columns: Vec<MemoryGridColumn> },
    ResultRow { row: Value },
    Complete { summary: String },
}

#[derive(Debug, Clone, Copy)]
enum MemoryModuleKind {
    Pslist,
    Triage,
    Bitlocker,
    Memdump,
}

impl TryFrom<&str> for MemoryModuleKind {
    type Error = String;

    fn try_from(value: &str) -> std::result::Result<Self, Self::Error> {
        match value {
            "pslist" => Ok(Self::Pslist),
            "triage" => Ok(Self::Triage),
            "bitlocker" => Ok(Self::Bitlocker),
            "memdump" => Ok(Self::Memdump),
            other => Err(format!("unsupported memory module: {other}")),
        }
    }
}

impl MemoryModuleKind {
    fn label(self) -> &'static str {
        match self {
            Self::Pslist => "pslist",
            Self::Triage => "triage",
            Self::Bitlocker => "bitlocker",
            Self::Memdump => "memdump",
        }
    }
}

#[tauri::command]
pub async fn discover_memory_dma(
    request: DiscoverMemoryDmaRequest,
    app: AppHandle,
    state: State<'_, MemoryExecutionState>,
) -> Result<DiscoverMemoryDmaResponse, String> {
    let _guard = state.lock.lock().await;

    reset_results(&request.session_id, &app);
    emit_status(
        &request.session_id,
        "info",
        "Preparing LeechCore runtime and validating DMA access.",
        &app,
    );
    emit_progress(
        &request.session_id,
        0,
        3,
        "Preparing DMA probe",
        &app,
    );

    let session_id = request.session_id.clone();
    let connector = request.connector.clone();
    let connector_type = request.connector_type;
    let os_kind = request.os_kind;
    let linux_profile = request.linux_profile.clone();
    let process_limit = request.process_limit.unwrap_or(DEFAULT_PROBE_LIMIT).max(1);
    let app_handle = app.clone();

    let probe = tokio::task::spawn_blocking(move || -> Result<_> {
        exhume_memory::runtime::configure_runtime_paths();
        emit_status(
            &session_id,
            "info",
            format!("Opening {} connector: {}", connector_type.as_str(), connector),
            &app_handle,
        );
        emit_progress(
            &session_id,
            1,
            3,
            "Connector opened; validating memory access",
            &app_handle,
        );

        let service = build_memory_service(connector, connector_type, os_kind, linux_profile);

        emit_status(
            &session_id,
            "info",
            "Enumerating processes through DMA to confirm the target is readable.",
            &app_handle,
        );
        emit_progress(
            &session_id,
            2,
            3,
            "Reading process list via DMA",
            &app_handle,
        );

        service
            .probe(&PsListRequest { limit: process_limit })
            .context("DMA probe failed")
    })
    .await
    .map_err(|err| format!("DMA probe task failed: {err}"))?
    .map_err(|err| {
        let message = format!("DMA probe failed: {err:#}");
        emit_status(&request.session_id, "error", message.clone(), &app);
        message
    })?;

    emit_progress(
        &request.session_id,
        3,
        3,
        "DMA validation completed",
        &app,
    );
    emit_schema(&request.session_id, "DMA Process Sample", process_columns(), &app);
    for process in &probe.processes {
        emit_row(&request.session_id, process_row(process), &app);
    }

    let summary = format!(
        "DMA is working. Sampled {} processes from the target.",
        probe.processes.len()
    );
    emit_status(&request.session_id, "success", summary.clone(), &app);
    emit_complete(&request.session_id, summary.clone(), &app);

    tokio::time::sleep(Duration::from_millis(DMA_RELEASE_DELAY_MS)).await;

    Ok(DiscoverMemoryDmaResponse {
        healthy: true,
        connector: request.connector,
        connector_type: request.connector_type.as_str().to_string(),
        max_address_hex: format!("{:#x}", probe.max_address),
        physical_memory_end_hex: format!("{:#x}", probe.physical_memory_end),
        sample_process_count: probe.processes.len(),
        available_modules: memory_modules(request.os_kind),
    })
}

#[tauri::command]
pub async fn run_memory_module(
    request: RunMemoryModuleRequest,
    app: AppHandle,
    state: State<'_, MemoryExecutionState>,
) -> Result<MemoryModuleExecutionResponse, String> {
    let _guard = state.lock.lock().await;

    let module_kind = MemoryModuleKind::try_from(request.module_id.as_str())?;
    reset_results(&request.session_id, &app);
    emit_status(
        &request.session_id,
        "info",
        format!("Running {} through exhume_memory.", module_kind.label()),
        &app,
    );
    emit_progress(
        &request.session_id,
        0,
        1,
        format!("Starting {}", module_kind.label()),
        &app,
    );

    let session_id = request.session_id.clone();
    let module_id = request.module_id.clone();
    let connector = request.connector.clone();
    let connector_type = request.connector_type;
    let os_kind = request.os_kind;
    let linux_profile = request.linux_profile.clone();
    let pid = request.pid;
    let start = parse_optional_u64(request.start.as_deref(), "start")
        .map_err(|err| format!("Invalid start address: {err:#}"))?;
    let end = parse_optional_u64(request.end.as_deref(), "end")
        .map_err(|err| format!("Invalid end address: {err:#}"))?;
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).max(1);
    let chunk_size = request.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE).max(1);
    let output_path = request.output_path.and_then(normalize_optional);
    let app_handle = app.clone();

    let response = tokio::task::spawn_blocking(move || -> Result<MemoryModuleExecutionResponse> {
        exhume_memory::runtime::configure_runtime_paths();
        let service = build_memory_service(connector, connector_type, os_kind, linux_profile);

        match module_kind {
            MemoryModuleKind::Pslist => {
                emit_schema(&session_id, "Process Listing", process_columns(), &app_handle);
                let report = service
                    .pslist(&PsListRequest { limit })
                    .context("pslist failed")?;
                for process in &report.processes {
                    emit_row(&session_id, process_row(process), &app_handle);
                }
                emit_progress(&session_id, 1, 1, "Process listing completed", &app_handle);
                let summary = format!("pslist completed with {} processes.", report.processes.len());
                emit_status(&session_id, "success", summary.clone(), &app_handle);
                emit_complete(&session_id, summary.clone(), &app_handle);
                Ok(MemoryModuleExecutionResponse {
                    module_id,
                    row_count: report.processes.len(),
                    summary,
                })
            }
            MemoryModuleKind::Triage => {
                let report = service
                    .triage(&TriageRequest {
                        limit,
                        pid,
                    })
                    .context("triage failed")?;

                let (title, row_count, summary) = if let Some(selected) = report.selected_process {
                    emit_schema(&session_id, "Process Modules", module_columns(), &app_handle);
                    for module in &selected.modules {
                        emit_row(&session_id, module_row(module), &app_handle);
                    }
                    let summary = format!(
                        "triage completed for pid {} ({}) with {} modules.",
                        selected.pid,
                        selected.name,
                        selected.modules.len()
                    );
                    ("Process Modules", selected.modules.len(), summary)
                } else {
                    emit_schema(&session_id, "Triage Process Sample", process_columns(), &app_handle);
                    for process in &report.processes {
                        emit_row(&session_id, process_row(process), &app_handle);
                    }
                    let summary = format!("triage completed with {} processes.", report.processes.len());
                    ("Triage Process Sample", report.processes.len(), summary)
                };

                let _ = title;
                emit_progress(&session_id, 1, 1, "Triage completed", &app_handle);
                emit_status(&session_id, "success", summary.clone(), &app_handle);
                emit_complete(&session_id, summary.clone(), &app_handle);
                Ok(MemoryModuleExecutionResponse {
                    module_id,
                    row_count,
                    summary,
                })
            }
            MemoryModuleKind::Bitlocker => {
                emit_schema(&session_id, "BitLocker Material", bitlocker_columns(), &app_handle);
                let progress_app = app_handle.clone();
                let progress_session = session_id.clone();
                let hit_app = app_handle.clone();
                let hit_session = session_id.clone();

                let callbacks = BitlockerScanCallbacks {
                    on_progress: Some(Arc::new(move |update: MemoryProgressUpdate| {
                        emit_progress(
                            &progress_session,
                            update.current,
                            update.total,
                            update.message,
                            &progress_app,
                        );
                    })),
                    on_hit: Some(Arc::new(move |hit: BitlockerHit| {
                        emit_row(&hit_session, bitlocker_row(&hit), &hit_app);
                    })),
                };

                let report = scan_bitlocker_with_callbacks(
                    service.connector_options(),
                    &BitlockerScanRequest {
                        start,
                        end,
                        chunk_size,
                    },
                    &callbacks,
                )
                .context("BitLocker scan failed")?;

                let summary = if report.hits.is_empty() {
                    "BitLocker scan completed with no material found.".to_string()
                } else {
                    format!(
                        "BitLocker scan completed with {} hits.",
                        report.hits.len()
                    )
                };
                emit_status(&session_id, "success", summary.clone(), &app_handle);
                emit_complete(&session_id, summary.clone(), &app_handle);
                Ok(MemoryModuleExecutionResponse {
                    module_id,
                    row_count: report.hits.len(),
                    summary,
                })
            }
            MemoryModuleKind::Memdump => {
                let output = output_path.context("memdump requires an output path")?;
                emit_schema(&session_id, "Memdump Summary", memdump_columns(), &app_handle);
                let progress_app = app_handle.clone();
                let progress_session = session_id.clone();
                let callbacks = MemdumpCallbacks {
                    on_progress: Some(Arc::new(move |update: MemoryProgressUpdate| {
                        emit_progress(
                            &progress_session,
                            update.current,
                            update.total,
                            update.message,
                            &progress_app,
                        );
                    })),
                };
                let report = service
                    .memdump_with_callbacks(
                        &MemdumpRequest {
                            end,
                            output: output.clone().into(),
                            chunk_size,
                        },
                        &callbacks,
                    )
                    .context("memdump failed")?;
                emit_row(&session_id, memdump_row(&report), &app_handle);
                let summary = format!(
                    "memdump completed: {:#x} bytes written to {}.",
                    report.bytes_dumped,
                    report.output.display()
                );
                emit_status(&session_id, "success", summary.clone(), &app_handle);
                emit_complete(&session_id, summary.clone(), &app_handle);
                Ok(MemoryModuleExecutionResponse {
                    module_id,
                    row_count: 1,
                    summary,
                })
            }
        }
    })
    .await
    .map_err(|err| format!("Memory module task failed: {err}"))?
    .map_err(|err| {
        let message = format!("{} failed: {err:#}", module_kind.label());
        emit_status(&request.session_id, "error", message.clone(), &app);
        message
    })?;

    tokio::time::sleep(Duration::from_millis(DMA_RELEASE_DELAY_MS)).await;

    Ok(response)
}

fn build_memory_service(
    connector: String,
    connector_type: MemoryConnectorType,
    os_kind: MemoryOsKind,
    linux_profile: Option<String>,
) -> MemoryService {
    MemoryService::new(ConnectorOptions {
        connector,
        kind: connector_type.into(),
        os_kind: os_kind.into(),
        linux_profile: linux_profile.and_then(|p| {
            let p = p.trim().to_string();
            if p.is_empty() { None } else { Some(PathBuf::from(p)) }
        }),
    })
}

fn memory_modules(os_kind: MemoryOsKind) -> Vec<MemoryModuleDescriptor> {
    let is_linux = matches!(os_kind, MemoryOsKind::Linux);
    vec![
        MemoryModuleDescriptor {
            id: "pslist".to_string(),
            name: "Process Listing".to_string(),
            description: "Enumerate the target process list through the DMA connector.".to_string(),
            supports_process_filter: false,
            supports_address_range: false,
            requires_output_path: false,
        },
        MemoryModuleDescriptor {
            id: "triage".to_string(),
            name: "Process Triage".to_string(),
            description: "Inspect a process by PID and list its loaded modules. The PID filter is optional.".to_string(),
            supports_process_filter: true,
            supports_address_range: false,
            requires_output_path: false,
        },
        MemoryModuleDescriptor {
            id: "bitlocker".to_string(),
            name: "BitLocker Recovery".to_string(),
            description: "Scan physical memory for FVEK and VMK material using exhume_memory.".to_string(),
            supports_process_filter: false,
            supports_address_range: true,
            requires_output_path: false,
        },
        MemoryModuleDescriptor {
            id: "memdump".to_string(),
            name: "Memdump".to_string(),
            description: "Dump physical memory to disk with live progress updates.".to_string(),
            supports_process_filter: false,
            supports_address_range: true,
            requires_output_path: true,
        },
    ]
    .into_iter()
    .filter(|m| !(is_linux && m.id == "bitlocker"))
    .collect()
}

fn process_columns() -> Vec<MemoryGridColumn> {
    vec![
        grid_column("pid", "PID", 90, 1, "number"),
        grid_column("name", "Process", 180, 2, "string"),
        grid_column("sysArch", "System Arch", 140, 1, "string"),
        grid_column("procArch", "Proc Arch", 140, 1, "string"),
    ]
}

fn module_columns() -> Vec<MemoryGridColumn> {
    vec![
        grid_column("base", "Base", 160, 1, "string"),
        grid_column("name", "Module", 180, 1, "string"),
        grid_column("path", "Path", 280, 2, "string"),
    ]
}

fn bitlocker_columns() -> Vec<MemoryGridColumn> {
    vec![
        grid_column("address", "Address", 160, 1, "string"),
        grid_column("tag", "Tag", 100, 1, "string"),
        grid_column("materialType", "Material", 150, 1, "string"),
        grid_column("fvek", "FVEK", 260, 2, "string"),
        grid_column("tweak", "Tweak", 260, 2, "string"),
        grid_column("full", "Full Key", 320, 2, "string"),
    ]
}

fn memdump_columns() -> Vec<MemoryGridColumn> {
    vec![
        grid_column("dumpStart", "Dump Start", 140, 1, "string"),
        grid_column("dumpEnd", "Dump End", 140, 1, "string"),
        grid_column("bytesDumped", "Bytes Dumped", 160, 1, "string"),
        grid_column("output", "Output", 320, 2, "string"),
    ]
}

fn grid_column(
    field: &str,
    header_name: &str,
    min_width: u16,
    flex: u16,
    column_type: &str,
) -> MemoryGridColumn {
    MemoryGridColumn {
        field: field.to_string(),
        header_name: header_name.to_string(),
        min_width,
        flex,
        column_type: column_type.to_string(),
    }
}

fn process_row(process: &ProcessRecord) -> Value {
    json!({
        "pid": process.pid,
        "name": process.name,
        "sysArch": process.sys_arch,
        "procArch": process.proc_arch,
    })
}

fn module_row(module: &ModuleRecord) -> Value {
    json!({
        "base": format!("{:#x}", module.base),
        "name": module.name,
        "path": module.path,
    })
}

fn bitlocker_row(hit: &BitlockerHit) -> Value {
    json!({
        "address": format!("{:#x}", hit.address),
        "tag": hit.tag,
        "materialType": format!("{:?}", hit.material.material_type),
        "fvek": hex::encode(&hit.material.fvek),
        "tweak": hit.material.tweak.as_ref().map(hex::encode).unwrap_or_default(),
        "full": hit.material.render_full_key_hex(),
    })
}

fn memdump_row(report: &exhume_memory::MemdumpReport) -> Value {
    json!({
        "dumpStart": format!("{:#x}", report.dump_start),
        "dumpEnd": format!("{:#x}", report.dump_end),
        "bytesDumped": format!("{:#x}", report.bytes_dumped),
        "output": report.output.display().to_string(),
    })
}

fn parse_optional_u64(value: Option<&str>, field_name: &str) -> Result<Option<u64>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    parse_u64(value).with_context(|| format!("failed to parse {field_name}: {value}"))
        .map(Some)
}

fn parse_u64(value: &str) -> Result<u64> {
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        Ok(u64::from_str_radix(hex, 16)?)
    } else {
        Ok(value.parse()?)
    }
}

fn normalize_optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn emit_memory_event(session_id: &str, event: MemorySessionEvent, app: &AppHandle) {
    app.emit(&format!("memory_session_{session_id}"), event).ok();
}

fn reset_results(session_id: &str, app: &AppHandle) {
    emit_memory_event(session_id, MemorySessionEvent::ResetResults, app);
}

fn emit_status(
    session_id: &str,
    level: impl Into<String>,
    message: impl Into<String>,
    app: &AppHandle,
) {
    emit_memory_event(
        session_id,
        MemorySessionEvent::Status {
            level: level.into(),
            message: message.into(),
        },
        app,
    );
}

fn emit_progress(
    session_id: &str,
    current: u64,
    total: u64,
    message: impl Into<String>,
    app: &AppHandle,
) {
    emit_memory_event(
        session_id,
        MemorySessionEvent::Progress {
            current,
            total,
            message: message.into(),
        },
        app,
    );
}

fn emit_schema(session_id: &str, title: impl Into<String>, columns: Vec<MemoryGridColumn>, app: &AppHandle) {
    emit_memory_event(
        session_id,
        MemorySessionEvent::ResultSchema {
            title: title.into(),
            columns,
        },
        app,
    );
}

fn emit_row(session_id: &str, row: Value, app: &AppHandle) {
    emit_memory_event(session_id, MemorySessionEvent::ResultRow { row }, app);
}

fn emit_complete(session_id: &str, summary: impl Into<String>, app: &AppHandle) {
    emit_memory_event(
        session_id,
        MemorySessionEvent::Complete {
            summary: summary.into(),
        },
        app,
    );
}
