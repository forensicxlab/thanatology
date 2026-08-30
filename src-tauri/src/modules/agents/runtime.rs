use super::tools::QueryParsedArtifactsTool;
use crate::AiConfig;
use exhume_agent::agent::{AgentToolContext, AgentToolProvider, ExhumeAgent};
use exhume_agent::config::AgentConfig;
use exhume_agent::paths;
use exhume_agent::policy::{AgentOptions, AgentPolicy};
use exhume_agent::report;
use exhume_agent::session::{persist_agent_event, AgentSession, AgentSessionSnapshot};
use exhume_agent::ui::{unique_id, AgentEvent, ApprovalRequest, UiEvent, UiHandle};
use rig::tool::ToolDyn;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::sync::{oneshot, Mutex, RwLock};

const AGENT_EVENT_NAME: &str = "agent-event";

#[derive(Clone, Default)]
pub struct AgentRuntimeState {
    sessions: Arc<RwLock<HashMap<String, ManagedAgentSession>>>,
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
}

#[derive(Clone)]
struct ManagedAgentSession {
    session: AgentSession,
    pool: Arc<SqlitePool>,
    evidence_name: String,
    evidence_path: String,
    evidence_db_path: PathBuf,
    window_label: String,
}

struct PendingApproval {
    session_id: String,
    turn_id: Option<String>,
    responder: oneshot::Sender<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAgentSessionRequest {
    pub evidence_id: i64,
    pub session_id: Option<String>,
    #[serde(default)]
    pub reporting_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceSnapshot {
    pub session: AgentSessionSnapshot,
    pub evidence_name: String,
    pub evidence_path: String,
    pub evidence_db_path: String,
    pub shell_working_dir: String,
    pub notes_count: i64,
    pub anomaly_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnResponse {
    pub session_id: String,
    pub turn_id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelResponse {
    pub cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalResponse {
    pub accepted: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AgentFileMention {
    pub identifier: i64,
    pub partition_id: i64,
    pub name: String,
    pub absolute_path: String,
}

#[derive(Clone)]
struct ThanatologyToolProvider {
    app: AppHandle,
    pool: SqlitePool,
    evidence_id: i64,
}

impl AgentToolProvider for ThanatologyToolProvider {
    fn tools(&self, _context: &AgentToolContext) -> Vec<Box<dyn ToolDyn>> {
        vec![Box::new(QueryParsedArtifactsTool::new(
            self.pool.clone(),
            self.app.clone(),
            self.evidence_id,
        ))]
    }
}

#[tauri::command]
pub async fn open_agent_window(app: AppHandle, evidence_id: i64) -> Result<(), String> {
    if evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    evidence_db_path(&app, evidence_id)?;

    let label = format!("agent-{evidence_id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App(format!("agent.html?evidenceId={evidence_id}").into());
    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("Exhume Agent — Evidence {evidence_id}"))
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .build()
        .map_err(|error| error.to_string())?;

    let runtime = app.state::<AgentRuntimeState>().inner().clone();
    let window_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let runtime = runtime.clone();
            let window_label = window_label.clone();
            tauri::async_runtime::spawn(async move {
                close_sessions_for_window(&runtime, &window_label).await;
            });
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn open_agent_session(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    request: OpenAgentSessionRequest,
) -> Result<AgentWorkspaceSnapshot, String> {
    if request.evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    if window.label() != format!("agent-{}", request.evidence_id) {
        return Err("Agent sessions can only be opened by their evidence window.".to_string());
    }

    let session_id = request
        .session_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| unique_id("session"));
    if let Some(existing) = state.sessions.read().await.get(&session_id).cloned() {
        if existing.session.evidence_id() != request.evidence_id {
            return Err("Session belongs to a different evidence.".to_string());
        }
        if existing.window_label != window.label() {
            return Err("Session is already attached to another window.".to_string());
        }
        return workspace_snapshot(&existing).await;
    }

    let db_path = evidence_db_path(&app, request.evidence_id)?;
    let pool = Arc::new(open_existing_pool(&db_path).await?);
    let evidence = load_evidence_metadata(&pool, request.evidence_id).await?;
    let ai_config = crate::load_ai_config(app.clone()).await?;

    if request.reporting_enabled {
        report::initialize_report(
            &pool,
            &db_path,
            &evidence.path,
            evidence.evidence_type == "Folder",
            evidence.evidence_type == "Logical Disk image",
        )
        .await
        .map_err(|error| format!("Failed to initialize the digital report: {error}"))?;
    }

    let extraction_dir = paths::extraction_dir_for_db(&db_path);
    tokio::fs::create_dir_all(&extraction_dir)
        .await
        .map_err(|error| {
            format!(
                "Failed to prepare the agent shell directory '{}': {error}",
                extraction_dir.display()
            )
        })?;
    let policy = AgentPolicy {
        allow_shell: true,
        shell_working_dir: Some(extraction_dir),
        ..AgentPolicy::default()
    };
    let options = AgentOptions {
        session_id: session_id.clone(),
        evidence_id: request.evidence_id,
        policy,
    };
    let (ui, receiver) = UiHandle::channel_with_context(&session_id, request.evidence_id, 512);
    let config = agent_config(ai_config);
    let agent = ExhumeAgent::new_with_options(
        config,
        evidence.path.clone(),
        db_path.clone(),
        pool.clone(),
        evidence.evidence_type == "Logical Disk image",
        request.reporting_enabled,
        Some(ui),
        options,
    )
    .with_tool_provider(Arc::new(ThanatologyToolProvider {
        app: app.clone(),
        pool: (*pool).clone(),
        evidence_id: request.evidence_id,
    }));
    let session = AgentSession::open(agent)
        .await
        .map_err(|error| format!("Failed to open agent session: {error}"))?;

    let managed = ManagedAgentSession {
        session,
        pool: pool.clone(),
        evidence_name: evidence.name,
        evidence_path: evidence.path,
        evidence_db_path: db_path,
        window_label: window.label().to_string(),
    };
    state
        .sessions
        .write()
        .await
        .insert(session_id, managed.clone());
    spawn_event_forwarder(
        app,
        managed.window_label.clone(),
        managed.pool.clone(),
        state.approvals.clone(),
        receiver,
    );
    workspace_snapshot(&managed).await
}

#[tauri::command]
pub async fn get_agent_session(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
) -> Result<AgentWorkspaceSnapshot, String> {
    let managed = session_for_window(&state, &session_id, window.label()).await?;
    workspace_snapshot(&managed).await
}

#[tauri::command]
pub async fn submit_agent_turn(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
    instruction: String,
    turn_id: Option<String>,
) -> Result<AgentTurnResponse, String> {
    let managed = session_for_window(&state, &session_id, window.label()).await?;
    let (turn_id, content) = managed
        .session
        .submit(instruction, turn_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(AgentTurnResponse {
        session_id,
        turn_id,
        content,
    })
}

#[tauri::command]
pub async fn cancel_agent_turn(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
    turn_id: Option<String>,
) -> Result<AgentCancelResponse, String> {
    let managed = session_for_window(&state, &session_id, window.label()).await?;
    Ok(AgentCancelResponse {
        cancelled: managed.session.cancel(turn_id.as_deref()).await,
    })
}

#[tauri::command]
pub async fn respond_agent_approval(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
    request_id: String,
    approved: bool,
) -> Result<AgentApprovalResponse, String> {
    session_for_window(&state, &session_id, window.label()).await?;
    let pending = state.approvals.lock().await.remove(&request_id);
    let Some(pending) = pending else {
        return Ok(AgentApprovalResponse { accepted: false });
    };
    if pending.session_id != session_id {
        state.approvals.lock().await.insert(request_id, pending);
        return Err("Approval request belongs to another session.".to_string());
    }
    Ok(AgentApprovalResponse {
        accepted: pending.responder.send(approved).is_ok(),
    })
}

#[tauri::command]
pub async fn clear_agent_session(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
) -> Result<(), String> {
    session_for_window(&state, &session_id, window.label())
        .await?
        .session
        .clear_history()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn close_agent_session(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
) -> Result<(), String> {
    session_for_window(&state, &session_id, window.label()).await?;
    close_session(state.inner(), &session_id).await
}

#[tauri::command]
pub async fn list_agent_sessions(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    evidence_id: Option<i64>,
) -> Result<Vec<AgentSessionSnapshot>, String> {
    let sessions: Vec<ManagedAgentSession> = state
        .sessions
        .read()
        .await
        .values()
        .filter(|managed| managed.window_label == window.label())
        .filter(|managed| evidence_id.is_none_or(|id| managed.session.evidence_id() == id))
        .cloned()
        .collect();
    let mut snapshots = Vec::with_capacity(sessions.len());
    for managed in sessions {
        snapshots.push(
            managed
                .session
                .snapshot()
                .await
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(snapshots)
}

#[tauri::command]
pub async fn list_agent_events(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
    limit: Option<u32>,
) -> Result<Vec<AgentEvent>, String> {
    let managed = session_for_window(&state, &session_id, window.label()).await?;
    let limit = limit.unwrap_or(500).clamp(1, 1_000) as i64;
    let rows = sqlx::query(
        r#"
        SELECT event_json
        FROM agent_audit_events
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
        "#,
    )
    .bind(&session_id)
    .bind(limit)
    .fetch_all(&*managed.pool)
    .await
    .map_err(|error| format!("Failed to load agent activity: {error}"))?;

    let mut events = rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("event_json").ok())
        .filter_map(|json| serde_json::from_str::<AgentEvent>(&json).ok())
        .collect::<Vec<_>>();
    events.reverse();
    Ok(events)
}

#[tauri::command]
pub async fn search_agent_files(
    window: WebviewWindow,
    state: State<'_, AgentRuntimeState>,
    session_id: String,
    query: String,
) -> Result<Vec<AgentFileMention>, String> {
    let managed = session_for_window(&state, &session_id, window.label()).await?;
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let filter = format!("%{escaped}%");
    sqlx::query_as::<_, AgentFileMention>(
        r#"
        SELECT identifier, partition_id, name, absolute_path
        FROM system_files
        WHERE name LIKE ? ESCAPE '\'
           OR absolute_path LIKE ? ESCAPE '\'
        ORDER BY
            CASE WHEN name LIKE ? ESCAPE '\' THEN 0 ELSE 1 END,
            name
        LIMIT 12
        "#,
    )
    .bind(&filter)
    .bind(&filter)
    .bind(format!("{escaped}%"))
    .fetch_all(&*managed.pool)
    .await
    .map_err(|error| format!("Failed to search indexed files: {error}"))
}

async fn session_for_window(
    state: &State<'_, AgentRuntimeState>,
    session_id: &str,
    window_label: &str,
) -> Result<ManagedAgentSession, String> {
    let managed = state
        .sessions
        .read()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("Agent session '{session_id}' was not found."))?;
    if managed.window_label != window_label {
        return Err("Agent session belongs to another window.".to_string());
    }
    Ok(managed)
}

async fn close_session(state: &AgentRuntimeState, session_id: &str) -> Result<(), String> {
    let Some(managed) = state.sessions.write().await.remove(session_id) else {
        return Ok(());
    };
    let close_result = managed
        .session
        .close()
        .await
        .map_err(|error| error.to_string());
    state
        .approvals
        .lock()
        .await
        .retain(|_, pending| pending.session_id != session_id);
    managed.pool.close().await;
    close_result
}

async fn close_sessions_for_window(state: &AgentRuntimeState, window_label: &str) {
    let session_ids = state
        .sessions
        .read()
        .await
        .iter()
        .filter_map(|(session_id, managed)| {
            (managed.window_label == window_label).then(|| session_id.clone())
        })
        .collect::<Vec<_>>();

    for session_id in session_ids {
        if let Err(error) = close_session(state, &session_id).await {
            log::warn!(
                "Failed to close agent session '{}' for destroyed window '{}': {}",
                session_id,
                window_label,
                error
            );
        }
    }
}

pub(crate) async fn close_agent_sessions_for_evidence(
    state: &AgentRuntimeState,
    evidence_id: i64,
) -> Result<(), String> {
    let session_ids = state
        .sessions
        .read()
        .await
        .iter()
        .filter_map(|(session_id, managed)| {
            (managed.session.evidence_id() == evidence_id).then(|| session_id.clone())
        })
        .collect::<Vec<_>>();

    let mut errors = Vec::new();
    for session_id in session_ids {
        if let Err(error) = close_session(state, &session_id).await {
            errors.push(format!("{session_id}: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to close one or more agent sessions: {}",
            errors.join("; ")
        ))
    }
}

fn spawn_event_forwarder(
    app: AppHandle,
    window_label: String,
    pool: Arc<SqlitePool>,
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    mut receiver: tokio::sync::mpsc::Receiver<UiEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(ui_event) = receiver.recv().await {
            let event = ui_event.event().clone();
            if let UiEvent::ApprovalRequest {
                request:
                    ApprovalRequest {
                        request_id,
                        responder,
                        ..
                    },
                ..
            } = ui_event
            {
                approvals.lock().await.insert(
                    request_id,
                    PendingApproval {
                        session_id: event.session_id.clone(),
                        turn_id: event.turn_id.clone(),
                        responder,
                    },
                );
            }
            if matches!(
                &event.payload,
                exhume_agent::ui::AgentEventPayload::TurnCompleted { .. }
                    | exhume_agent::ui::AgentEventPayload::TurnCancelled
                    | exhume_agent::ui::AgentEventPayload::TurnFailed { .. }
            ) {
                let mut pending = approvals.lock().await;
                pending.retain(|_, approval| {
                    approval.session_id != event.session_id || approval.turn_id != event.turn_id
                });
            }
            if let Err(error) = persist_agent_event(&pool, &event).await {
                log::error!("Failed to persist agent audit event: {error}");
            }
            if let Err(error) = app.emit_to(&window_label, AGENT_EVENT_NAME, &event) {
                log::warn!(
                    "Failed to emit agent event to window '{}': {}",
                    window_label,
                    error
                );
            }
        }
    });
}

async fn workspace_snapshot(
    managed: &ManagedAgentSession,
) -> Result<AgentWorkspaceSnapshot, String> {
    let notes_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM investigation_notes")
        .fetch_one(&*managed.pool)
        .await
        .unwrap_or(0);
    let anomaly_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM system_files WHERE anomaly_flag = 1")
            .fetch_one(&*managed.pool)
            .await
            .unwrap_or(0);
    Ok(AgentWorkspaceSnapshot {
        session: managed
            .session
            .snapshot()
            .await
            .map_err(|error| error.to_string())?,
        evidence_name: managed.evidence_name.clone(),
        evidence_path: managed.evidence_path.clone(),
        evidence_db_path: managed.evidence_db_path.display().to_string(),
        shell_working_dir: paths::extraction_dir_for_db(&managed.evidence_db_path)
            .display()
            .to_string(),
        notes_count,
        anomaly_count,
    })
}

struct EvidenceMetadata {
    name: String,
    evidence_type: String,
    path: String,
}

async fn load_evidence_metadata(
    pool: &SqlitePool,
    evidence_id: i64,
) -> Result<EvidenceMetadata, String> {
    let row = sqlx::query("SELECT id, name, type, path FROM evidence WHERE id = ? LIMIT 1")
        .bind(evidence_id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Failed to read evidence metadata: {error}"))?;
    Ok(EvidenceMetadata {
        name: row.try_get("name").unwrap_or_default(),
        evidence_type: row.try_get("type").unwrap_or_default(),
        path: row.try_get("path").unwrap_or_default(),
    })
}

fn evidence_db_path(app: &AppHandle, evidence_id: i64) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app-local data directory: {error}"))?;
    let path = base.join("evidences").join(format!("{evidence_id}.db"));
    require_existing_file(&path)
}

fn require_existing_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "Evidence database '{}' is unavailable: {error}",
            path.display()
        )
    })?;
    if !canonical.is_file() {
        return Err(format!(
            "Evidence database '{}' is not a file.",
            canonical.display()
        ));
    }
    Ok(canonical)
}

async fn open_existing_pool(path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(30));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("Failed to open evidence database: {error}"))
}

fn agent_config(config: AiConfig) -> AgentConfig {
    AgentConfig {
        provider: config.provider,
        model: config.model,
        endpoint: config.endpoint,
        api_key: config.api_key,
        llm_endpoint: None,
        image_endpoint: None,
        audio_endpoint: None,
    }
}
