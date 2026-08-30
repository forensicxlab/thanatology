use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::sync::RwLock;

pub const SPATIOTEMPORAL_EVENT_NAME: &str = "spatiotemporal-state";
const DEFAULT_CORRELATION_WINDOW_MS: i64 = 5 * 60 * 1_000;
const MIN_CORRELATION_WINDOW_MS: i64 = 1_000;
const MAX_CORRELATION_WINDOW_MS: i64 = 24 * 60 * 60 * 1_000;
const DEFAULT_PLAYBACK_RATE: f64 = 1.0;
const MIN_PLAYBACK_RATE: f64 = 0.1;
const MAX_PLAYBACK_RATE: f64 = 3_600.0;
static NEXT_SESSION_LIFECYCLE_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_WINDOW_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpatiotemporalRole {
    Timeline,
    Location,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpatiotemporalOrigin {
    Timeline,
    Location,
    Investigation,
}

impl From<SpatiotemporalRole> for SpatiotemporalOrigin {
    fn from(role: SpatiotemporalRole) -> Self {
        match role {
            SpatiotemporalRole::Timeline => Self::Timeline,
            SpatiotemporalRole::Location => Self::Location,
        }
    }
}

impl SpatiotemporalRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Timeline => "timeline",
            Self::Location => "location",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Timeline => "Timeline",
            Self::Location => "Location",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct SessionKey {
    evidence_id: i64,
    partition_id: i64,
}

#[derive(Debug, Clone, Copy)]
struct WindowRegistration {
    instance_id: u64,
    key: SessionKey,
    role: SpatiotemporalRole,
    initial_lifecycle_id: u64,
    bound_lifecycle_id: Option<u64>,
}

#[derive(Debug, Clone)]
struct Session {
    lifecycle_id: u64,
    session_id: String,
    sync_enabled: bool,
    cursor_ms: Option<i64>,
    range_start_ms: Option<i64>,
    range_end_ms: Option<i64>,
    correlation_window_ms: i64,
    playing: bool,
    playback_rate: f64,
    controller: Option<SpatiotemporalRole>,
    playback_generation: u64,
    playback_tick_sequence: u64,
    selected_timeline_event_id: Option<i64>,
    selected_location_observation_id: Option<i64>,
    revision: u64,
    origin: Option<SpatiotemporalOrigin>,
    timeline_connected: bool,
    location_connected: bool,
}

impl Default for Session {
    fn default() -> Self {
        let lifecycle_id = NEXT_SESSION_LIFECYCLE_ID.fetch_add(1, Ordering::Relaxed);
        Self {
            lifecycle_id,
            session_id: format!("st-{lifecycle_id:016x}"),
            sync_enabled: false,
            cursor_ms: None,
            range_start_ms: None,
            range_end_ms: None,
            correlation_window_ms: DEFAULT_CORRELATION_WINDOW_MS,
            playing: false,
            playback_rate: DEFAULT_PLAYBACK_RATE,
            controller: None,
            playback_generation: 0,
            playback_tick_sequence: 0,
            selected_timeline_event_id: None,
            selected_location_observation_id: None,
            revision: 0,
            origin: None,
            timeline_connected: false,
            location_connected: false,
        }
    }
}

impl Session {
    fn invalidate_playback_ticks(&mut self) {
        self.playback_generation = self.playback_generation.saturating_add(1);
        self.playback_tick_sequence = 0;
    }

    fn set_connected(&mut self, role: SpatiotemporalRole, connected: bool) -> bool {
        let was_connected = match role {
            SpatiotemporalRole::Timeline => self.timeline_connected,
            SpatiotemporalRole::Location => self.location_connected,
        };
        if was_connected == connected {
            return false;
        }
        match role {
            SpatiotemporalRole::Timeline => self.timeline_connected = connected,
            SpatiotemporalRole::Location => self.location_connected = connected,
        }
        if !connected && self.controller == Some(role) {
            self.invalidate_playback_ticks();
            self.playing = false;
            self.controller = None;
        }
        self.revision = self.revision.saturating_add(1);
        true
    }

    fn snapshot(&self, key: SessionKey) -> SpatiotemporalSnapshot {
        SpatiotemporalSnapshot {
            schema_version: 2,
            session_id: self.session_id.clone(),
            evidence_id: key.evidence_id,
            partition_id: key.partition_id,
            sync_enabled: self.sync_enabled,
            cursor_ms: self.cursor_ms,
            range_start_ms: self.range_start_ms,
            range_end_ms: self.range_end_ms,
            correlation_window_ms: self.correlation_window_ms,
            playing: self.playing,
            playback_rate: self.playback_rate,
            controller: self.controller,
            playback_generation: self.playback_generation,
            playback_tick_sequence: self.playback_tick_sequence,
            selected_timeline_event_id: self.selected_timeline_event_id,
            selected_location_observation_id: self.selected_location_observation_id,
            revision: self.revision,
            origin: self.origin,
            timeline_connected: self.timeline_connected,
            location_connected: self.location_connected,
        }
    }
}

#[derive(Clone, Default)]
pub struct SpatiotemporalSessionState {
    sessions: Arc<RwLock<HashMap<SessionKey, Session>>>,
    window_registrations: Arc<RwLock<HashMap<String, WindowRegistration>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSpatiotemporalWindowsResult {
    pub timeline_label: Option<String>,
    pub location_label: Option<String>,
    pub timeline_error: Option<String>,
    pub location_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSpatiotemporalWindowRequest {
    pub evidence_id: i64,
    pub partition_id: i64,
    pub role: SpatiotemporalRole,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSpatiotemporalStateRequest {
    pub evidence_id: i64,
    pub partition_id: i64,
    pub role: SpatiotemporalRole,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub cursor_ms: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub range_start_ms: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub range_end_ms: Option<Option<i64>>,
    pub correlation_window_ms: Option<i64>,
    pub playing: Option<bool>,
    pub playback_rate: Option<f64>,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub controller: Option<Option<SpatiotemporalRole>>,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub selected_timeline_event_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub selected_location_observation_id: Option<Option<i64>>,
    pub playback_generation: Option<u64>,
    pub playback_tick_sequence: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSpatiotemporalSyncRequest {
    pub evidence_id: i64,
    pub partition_id: i64,
    pub role: SpatiotemporalRole,
    pub sync_enabled: bool,
    pub cursor_ms: Option<i64>,
    pub range_start_ms: Option<i64>,
    pub range_end_ms: Option<i64>,
    pub correlation_window_ms: i64,
    pub playing: bool,
    pub playback_rate: f64,
    pub selected_timeline_event_id: Option<i64>,
    pub selected_location_observation_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSpatiotemporalRangeFromMainRequest {
    pub evidence_id: i64,
    pub partition_id: i64,
    pub expected_session_id: Option<String>,
    pub expected_revision: Option<u64>,
    pub range_start_ms: Option<i64>,
    pub range_end_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSpatiotemporalSyncFromMainRequest {
    pub evidence_id: i64,
    pub partition_id: i64,
    pub expected_session_id: Option<String>,
    pub expected_revision: Option<u64>,
    pub sync_enabled: bool,
    pub range_start_ms: Option<i64>,
    pub range_end_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpatiotemporalSnapshot {
    pub schema_version: u8,
    pub session_id: String,
    pub evidence_id: i64,
    pub partition_id: i64,
    pub sync_enabled: bool,
    pub cursor_ms: Option<i64>,
    pub range_start_ms: Option<i64>,
    pub range_end_ms: Option<i64>,
    pub correlation_window_ms: i64,
    pub playing: bool,
    pub playback_rate: f64,
    pub controller: Option<SpatiotemporalRole>,
    pub playback_generation: u64,
    pub playback_tick_sequence: u64,
    pub selected_timeline_event_id: Option<i64>,
    pub selected_location_observation_id: Option<i64>,
    pub revision: u64,
    pub origin: Option<SpatiotemporalOrigin>,
    pub timeline_connected: bool,
    pub location_connected: bool,
}

fn session_key(evidence_id: i64, partition_id: i64) -> Result<SessionKey, String> {
    if evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    if partition_id <= 0 {
        return Err("Partition ID must be positive.".to_string());
    }
    Ok(SessionKey {
        evidence_id,
        partition_id,
    })
}

pub fn spatiotemporal_window_label(
    role: SpatiotemporalRole,
    evidence_id: i64,
    partition_id: i64,
) -> String {
    format!("{}-e{evidence_id}-p{partition_id}", role.as_str())
}

fn validate_caller(
    window: &WebviewWindow,
    role: SpatiotemporalRole,
    key: SessionKey,
) -> Result<(), String> {
    let expected = spatiotemporal_window_label(role, key.evidence_id, key.partition_id);
    if window.label() != expected {
        return Err(format!(
            "Window '{}' cannot access spatiotemporal session {}:{} as {}.",
            window.label(),
            key.evidence_id,
            key.partition_id,
            role.as_str()
        ));
    }
    Ok(())
}

fn validate_reader(window: &WebviewWindow, key: SessionKey) -> Result<(), String> {
    if window.label() == "main"
        || window.label()
            == spatiotemporal_window_label(
                SpatiotemporalRole::Timeline,
                key.evidence_id,
                key.partition_id,
            )
        || window.label()
            == spatiotemporal_window_label(
                SpatiotemporalRole::Location,
                key.evidence_id,
                key.partition_id,
            )
    {
        return Ok(());
    }
    Err(format!(
        "Window '{}' cannot read spatiotemporal session {}:{}.",
        window.label(),
        key.evidence_id,
        key.partition_id
    ))
}

fn validate_main_opener(window: &WebviewWindow) -> Result<(), String> {
    validate_main_window_label(window.label(), "open a spatiotemporal workspace")
}

fn validate_main_caller(window: &WebviewWindow, action: &str) -> Result<(), String> {
    validate_main_window_label(window.label(), action)
}

fn validate_main_window_label(label: &str, action: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err(format!("Window '{label}' cannot {action}."))
    }
}

fn normalize_range(start: Option<i64>, end: Option<i64>) -> (Option<i64>, Option<i64>) {
    match (start, end) {
        (Some(start), Some(end)) if start > end => (Some(end), Some(start)),
        range => range,
    }
}

fn normalize_correlation_window(value: i64) -> i64 {
    value.clamp(MIN_CORRELATION_WINDOW_MS, MAX_CORRELATION_WINDOW_MS)
}

fn normalize_playback_rate(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
    } else {
        DEFAULT_PLAYBACK_RATE
    }
}

fn request_matches_session(
    session: &Session,
    expected_session_id: Option<&str>,
    expected_revision: Option<u64>,
) -> bool {
    expected_session_id.is_none_or(|expected| expected == session.session_id)
        && expected_revision.is_none_or(|expected| expected == session.revision)
}

fn reset_clock_for_investigation(session: &mut Session) {
    session.invalidate_playback_ticks();
    session.cursor_ms = None;
    session.playing = false;
    session.controller = None;
    session.selected_timeline_event_id = None;
    session.selected_location_observation_id = None;
}

fn apply_main_range_update(
    session: &mut Session,
    range_start_ms: Option<i64>,
    range_end_ms: Option<i64>,
) -> bool {
    if !session.sync_enabled {
        return false;
    }

    let (range_start_ms, range_end_ms) = normalize_range(range_start_ms, range_end_ms);
    if session.range_start_ms == range_start_ms && session.range_end_ms == range_end_ms {
        return false;
    }

    reset_clock_for_investigation(session);
    session.range_start_ms = range_start_ms;
    session.range_end_ms = range_end_ms;
    session.origin = Some(SpatiotemporalOrigin::Investigation);
    session.revision = session.revision.saturating_add(1);
    true
}

fn apply_main_sync_update(
    session: &mut Session,
    sync_enabled: bool,
    range_start_ms: Option<i64>,
    range_end_ms: Option<i64>,
) -> bool {
    let (range_start_ms, range_end_ms) = normalize_range(range_start_ms, range_end_ms);
    let sync_changed = session.sync_enabled != sync_enabled;
    let range_changed =
        session.range_start_ms != range_start_ms || session.range_end_ms != range_end_ms;

    // Main does not own a disconnected session's local range. Repeating the
    // disabled state is therefore an idempotent no-op even if its current
    // investigation filter differs from the last detached-window snapshot.
    if !sync_changed && (!sync_enabled || !range_changed) {
        return false;
    }

    reset_clock_for_investigation(session);
    session.sync_enabled = sync_enabled;
    session.range_start_ms = range_start_ms;
    session.range_end_ms = range_end_ms;
    session.origin = Some(SpatiotemporalOrigin::Investigation);
    session.revision = session.revision.saturating_add(1);
    true
}

fn update_main_range_in_sessions(
    sessions: &mut HashMap<SessionKey, Session>,
    key: SessionKey,
    request: &UpdateSpatiotemporalRangeFromMainRequest,
) -> (Option<SpatiotemporalSnapshot>, bool) {
    let Some(session) = sessions.get_mut(&key) else {
        return (None, false);
    };
    if !request_matches_session(
        session,
        request.expected_session_id.as_deref(),
        request.expected_revision,
    ) {
        return (Some(session.snapshot(key)), false);
    }

    let changed = apply_main_range_update(session, request.range_start_ms, request.range_end_ms);
    (Some(session.snapshot(key)), changed)
}

fn update_main_sync_in_sessions(
    sessions: &mut HashMap<SessionKey, Session>,
    key: SessionKey,
    request: &SetSpatiotemporalSyncFromMainRequest,
) -> (Option<SpatiotemporalSnapshot>, bool) {
    let Some(session) = sessions.get_mut(&key) else {
        return (None, false);
    };
    if !request_matches_session(
        session,
        request.expected_session_id.as_deref(),
        request.expected_revision,
    ) {
        return (Some(session.snapshot(key)), false);
    }

    let changed = apply_main_sync_update(
        session,
        request.sync_enabled,
        request.range_start_ms,
        request.range_end_ms,
    );
    (Some(session.snapshot(key)), changed)
}

fn playback_patch_is_allowed(
    session: &Session,
    role: SpatiotemporalRole,
    changes_playback: bool,
    requested_playing: Option<bool>,
) -> bool {
    !session.playing
        || session.controller == Some(role)
        || !changes_playback
        || requested_playing == Some(false)
}

fn request_changes_clock_or_control(request: &UpdateSpatiotemporalStateRequest) -> bool {
    request.cursor_ms.is_some()
        || request.range_start_ms.is_some()
        || request.range_end_ms.is_some()
        || request.playing.is_some()
        || request.playback_rate.is_some()
        || request.controller.is_some()
}

fn apply_playback_tick(
    session: &mut Session,
    request: &UpdateSpatiotemporalStateRequest,
) -> Result<(), String> {
    let (Some(generation), Some(sequence), Some(Some(cursor_ms))) = (
        request.playback_generation,
        request.playback_tick_sequence,
        request.cursor_ms,
    ) else {
        return Err(
            "A playback tick requires a cursor, generation, and sequence number.".to_string(),
        );
    };
    if request.role != SpatiotemporalRole::Location
        || request.range_start_ms.is_some()
        || request.range_end_ms.is_some()
        || request.correlation_window_ms.is_some()
        || request.playing.is_some()
        || request.playback_rate.is_some()
        || request.controller.is_some()
        || request.selected_timeline_event_id.is_some()
        || request.selected_location_observation_id.is_some()
    {
        return Err("A playback tick may update only the Location cursor.".to_string());
    }
    if !session.playing || session.controller != Some(SpatiotemporalRole::Location) {
        return Err("Location playback is no longer active.".to_string());
    }
    if generation != session.playback_generation {
        return Err(format!(
            "Stale playback generation {generation}; current generation is {}.",
            session.playback_generation
        ));
    }
    if sequence <= session.playback_tick_sequence {
        return Err(format!(
            "Out-of-order playback tick {sequence}; last accepted tick is {}.",
            session.playback_tick_sequence
        ));
    }

    session.cursor_ms = Some(cursor_ms);
    session.playback_tick_sequence = sequence;
    // A moving playback clock no longer points at either explicitly selected
    // record. The cursor still provides the bounded temporal correlation.
    session.selected_timeline_event_id = None;
    session.selected_location_observation_id = None;
    session.origin = Some(request.role.into());
    session.revision = session.revision.saturating_add(1);
    Ok(())
}

fn apply_state_update(
    session: &mut Session,
    request: &UpdateSpatiotemporalStateRequest,
) -> Result<(), String> {
    let has_tick_metadata =
        request.playback_generation.is_some() || request.playback_tick_sequence.is_some();
    if has_tick_metadata {
        return apply_playback_tick(session, request);
    }
    if request.role == SpatiotemporalRole::Location
        && request.cursor_ms.is_some()
        && request.playing != Some(false)
    {
        return Err(
            "A Location cursor update must be a sequenced playback tick or explicitly stop playback."
                .to_string(),
        );
    }

    let changes_clock_or_control = request_changes_clock_or_control(request);
    if !playback_patch_is_allowed(
        session,
        request.role,
        changes_clock_or_control,
        request.playing,
    ) {
        return Err(format!(
            "Active playback is controlled by {}.",
            session
                .controller
                .map(SpatiotemporalRole::title)
                .unwrap_or("another window")
        ));
    }
    if let Some(Some(controller)) = request.controller {
        if controller != request.role {
            return Err("A window cannot assign playback control to another role.".to_string());
        }
    }

    // Validate the resulting controller state before mutating any clock field,
    // so a rejected request is atomic.
    let mut next_playing = session.playing;
    let mut next_controller = session.controller;
    if let Some(playing) = request.playing {
        if playing {
            if session.controller.is_some() && session.controller != Some(request.role) {
                return Err(format!(
                    "Active playback is controlled by {}.",
                    session.controller.map(SpatiotemporalRole::title).unwrap()
                ));
            }
            next_playing = true;
            next_controller = Some(request.role);
        } else {
            next_playing = false;
            next_controller = None;
        }
    } else if let Some(controller) = request.controller {
        match controller {
            Some(controller) if session.playing && controller == request.role => {
                next_controller = Some(controller);
            }
            None if !session.playing => next_controller = None,
            _ => {
                return Err(
                    "Playback control can only be changed while starting or stopping playback."
                        .to_string(),
                );
            }
        }
    }

    if changes_clock_or_control {
        // This makes every already-issued tick stale, including a tick delayed
        // behind a Timeline seek/pause in another webview's IPC transport.
        session.invalidate_playback_ticks();
    }
    if let Some(cursor_ms) = request.cursor_ms {
        session.cursor_ms = cursor_ms;
    }
    let next_start = request.range_start_ms.unwrap_or(session.range_start_ms);
    let next_end = request.range_end_ms.unwrap_or(session.range_end_ms);
    (session.range_start_ms, session.range_end_ms) = normalize_range(next_start, next_end);
    if let Some(correlation_window_ms) = request.correlation_window_ms {
        session.correlation_window_ms = normalize_correlation_window(correlation_window_ms);
    }
    if let Some(playback_rate) = request.playback_rate {
        session.playback_rate = normalize_playback_rate(playback_rate);
    }
    session.playing = next_playing;
    session.controller = next_controller;

    if let Some(selected_timeline_event_id) = request.selected_timeline_event_id {
        session.selected_timeline_event_id = selected_timeline_event_id;
    }
    if let Some(selected_location_observation_id) = request.selected_location_observation_id {
        session.selected_location_observation_id = selected_location_observation_id;
    }

    let changes_range = request.range_start_ms.is_some() || request.range_end_ms.is_some();
    if request.role == SpatiotemporalRole::Timeline && changes_range {
        session.selected_timeline_event_id = None;
        session.selected_location_observation_id = None;
    } else if request.role == SpatiotemporalRole::Timeline && request.cursor_ms.is_some() {
        session.selected_location_observation_id = None;
    } else if request.role == SpatiotemporalRole::Location && request.cursor_ms.is_some() {
        session.selected_timeline_event_id = None;
    }
    if request.role == SpatiotemporalRole::Location && request.playing == Some(true) {
        session.selected_timeline_event_id = None;
        session.selected_location_observation_id = None;
    }

    session.origin = Some(request.role.into());
    session.revision = session.revision.saturating_add(1);
    Ok(())
}

async fn validate_reviewable_evidence(app: &AppHandle, evidence_id: i64) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to locate application data: {error}"))?;
    let main_database_path = base_dir.join("thanatology.db");
    let options = SqliteConnectOptions::new()
        .filename(&main_database_path)
        .read_only(true)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("Failed to open the case database: {error}"))?;
    let status = sqlx::query_scalar::<_, i64>("SELECT status FROM evidence WHERE id = ? LIMIT 1")
        .bind(evidence_id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| format!("Failed to validate evidence review status: {error}"))?;
    pool.close().await;

    match status {
        Some(5 | 6) => Ok(()),
        Some(_) => Err(format!(
            "Evidence {evidence_id} is not reviewable until artefact parsing has completed."
        )),
        None => Err(format!("Evidence {evidence_id} does not exist.")),
    }
}

async fn validate_evidence_partition(app: &AppHandle, key: SessionKey) -> Result<(), String> {
    validate_reviewable_evidence(app, key.evidence_id).await?;
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to locate application data: {error}"))?;
    let database_path = base_dir
        .join("evidences")
        .join(format!("{}.db", key.evidence_id));
    if !database_path.is_file() {
        return Err(format!(
            "Evidence database {} is unavailable.",
            database_path.display()
        ));
    }

    let options = SqliteConnectOptions::new()
        .filename(&database_path)
        .read_only(true)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("Failed to open evidence database: {error}"))?;
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM partitions WHERE id = ? AND evidence_id = ? LIMIT 1",
    )
    .bind(key.partition_id)
    .bind(key.evidence_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Failed to validate the selected partition: {error}"))?
    .is_some();
    pool.close().await;

    if !exists {
        return Err(format!(
            "Partition {} does not belong to evidence {}.",
            key.partition_id, key.evidence_id
        ));
    }
    Ok(())
}

async fn seed_session_if_missing(
    state: &SpatiotemporalSessionState,
    key: SessionKey,
    initial_range_start_ms: Option<i64>,
    initial_range_end_ms: Option<i64>,
) {
    let mut sessions = state.sessions.write().await;
    sessions.entry(key).or_insert_with(|| {
        let (range_start_ms, range_end_ms) =
            normalize_range(initial_range_start_ms, initial_range_end_ms);
        Session {
            range_start_ms,
            range_end_ms,
            ..Session::default()
        }
    });
}

fn emit_snapshot(app: &AppHandle, snapshot: &SpatiotemporalSnapshot) {
    let _ = app.emit_to("main", SPATIOTEMPORAL_EVENT_NAME, snapshot);
    let roles = [SpatiotemporalRole::Timeline, SpatiotemporalRole::Location];
    for role in roles {
        let connected = match role {
            SpatiotemporalRole::Timeline => snapshot.timeline_connected,
            SpatiotemporalRole::Location => snapshot.location_connected,
        };
        if !connected {
            continue;
        }
        let label = spatiotemporal_window_label(role, snapshot.evidence_id, snapshot.partition_id);
        let _ = app.emit_to(&label, SPATIOTEMPORAL_EVENT_NAME, snapshot);
    }
}

fn bind_window_registration(
    registrations: &mut HashMap<String, WindowRegistration>,
    sessions: &mut HashMap<SessionKey, Session>,
    label: &str,
    key: SessionKey,
    role: SpatiotemporalRole,
) -> Result<SpatiotemporalSnapshot, String> {
    let registration = registrations.get_mut(label).ok_or_else(|| {
        format!("Window '{label}' is not registered as a spatiotemporal workspace.")
    })?;
    if registration.key != key || registration.role != role {
        return Err(format!(
            "Window '{label}' cannot register for spatiotemporal session {}:{} as {}.",
            key.evidence_id,
            key.partition_id,
            role.as_str()
        ));
    }

    let session = sessions.entry(key).or_default();
    // Bind the Destroyed handler to the lifecycle which this exact webview
    // actually joined. The originally seeded lifecycle may have disappeared
    // while the page was loading (for example, another window closed during
    // Open Both and removed the still-unconnected session).
    registration.bound_lifecycle_id = Some(session.lifecycle_id);
    session.set_connected(role, true);
    Ok(session.snapshot(key))
}

fn disconnect_window_instance(
    registrations: &mut HashMap<String, WindowRegistration>,
    sessions: &mut HashMap<SessionKey, Session>,
    label: &str,
    instance_id: u64,
) -> Option<SpatiotemporalSnapshot> {
    let registration = registrations.get(label).copied()?;
    // A late Destroyed callback from a former webview must not consume the
    // ownership record belonging to a newly-created window with the same
    // deterministic Tauri label.
    if registration.instance_id != instance_id {
        return None;
    }
    registrations.remove(label);

    let lifecycle_id = registration
        .bound_lifecycle_id
        .unwrap_or(registration.initial_lifecycle_id);
    let session = sessions.get_mut(&registration.key)?;
    if session.lifecycle_id != lifecycle_id {
        return None;
    }

    session.set_connected(registration.role, false);
    let snapshot = session.snapshot(registration.key);
    if !session.timeline_connected && !session.location_connected {
        sessions.remove(&registration.key);
    }
    Some(snapshot)
}

async fn unregister_window(
    app: AppHandle,
    state: SpatiotemporalSessionState,
    label: String,
    instance_id: u64,
) {
    let snapshot = {
        // Registration ownership is always locked before sessions. Register
        // uses the same order so bind and destroy are atomic with respect to
        // each other and cannot deadlock.
        let mut registrations = state.window_registrations.write().await;
        let mut sessions = state.sessions.write().await;
        disconnect_window_instance(&mut registrations, &mut sessions, &label, instance_id)
    };
    if let Some(snapshot) = snapshot {
        emit_snapshot(&app, &snapshot);
    }
}

fn focus_existing(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

async fn open_workspace_window(
    app: &AppHandle,
    state: SpatiotemporalSessionState,
    key: SessionKey,
    role: SpatiotemporalRole,
) -> Result<String, String> {
    let label = spatiotemporal_window_label(role, key.evidence_id, key.partition_id);
    if let Some(window) = app.get_webview_window(&label) {
        focus_existing(window)?;
        return Ok(label);
    }

    let initial_lifecycle_id = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&key)
            .map(|session| session.lifecycle_id)
            .ok_or_else(|| "The spatiotemporal session is not active.".to_string())?
    };
    let instance_id = NEXT_WINDOW_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
    {
        let mut registrations = state.window_registrations.write().await;
        registrations.insert(
            label.clone(),
            WindowRegistration {
                instance_id,
                key,
                role,
                initial_lifecycle_id,
                bound_lifecycle_id: None,
            },
        );
    }

    let url = format!(
        "{}.html?evidenceId={}&partitionId={}",
        role.as_str(),
        key.evidence_id,
        key.partition_id
    );
    let window_result = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(format!(
            "{} — Evidence {} · Partition {}",
            role.title(),
            key.evidence_id,
            key.partition_id
        ))
        .inner_size(1180.0, 800.0)
        .min_inner_size(800.0, 560.0)
        .decorations(false)
        .build();
    let window = match window_result {
        Ok(window) => window,
        Err(error) => {
            let mut registrations = state.window_registrations.write().await;
            let mut sessions = state.sessions.write().await;
            disconnect_window_instance(&mut registrations, &mut sessions, &label, instance_id);
            return Err(format!("Failed to open {} window: {error}", role.as_str()));
        }
    };

    let app_handle = app.clone();
    let window_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let app_handle = app_handle.clone();
            let state = state.clone();
            let window_label = window_label.clone();
            tauri::async_runtime::spawn(async move {
                unregister_window(app_handle, state, window_label, instance_id).await;
            });
        }
    });
    Ok(label)
}

async fn prepare_session(
    app: AppHandle,
    state: &SpatiotemporalSessionState,
    evidence_id: i64,
    partition_id: i64,
    initial_range_start_ms: Option<i64>,
    initial_range_end_ms: Option<i64>,
) -> Result<SessionKey, String> {
    let key = session_key(evidence_id, partition_id)?;
    validate_evidence_partition(&app, key).await?;
    seed_session_if_missing(state, key, initial_range_start_ms, initial_range_end_ms).await;
    Ok(key)
}

#[tauri::command]
pub async fn open_timeline_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    evidence_id: i64,
    partition_id: i64,
    initial_range_start_ms: Option<i64>,
    initial_range_end_ms: Option<i64>,
) -> Result<String, String> {
    validate_main_opener(&window)?;
    let key = prepare_session(
        app.clone(),
        state.inner(),
        evidence_id,
        partition_id,
        initial_range_start_ms,
        initial_range_end_ms,
    )
    .await?;
    open_workspace_window(
        &app,
        state.inner().clone(),
        key,
        SpatiotemporalRole::Timeline,
    )
    .await
}

#[tauri::command]
pub async fn open_location_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    evidence_id: i64,
    partition_id: i64,
    initial_range_start_ms: Option<i64>,
    initial_range_end_ms: Option<i64>,
) -> Result<String, String> {
    validate_main_opener(&window)?;
    let key = prepare_session(
        app.clone(),
        state.inner(),
        evidence_id,
        partition_id,
        initial_range_start_ms,
        initial_range_end_ms,
    )
    .await?;
    open_workspace_window(
        &app,
        state.inner().clone(),
        key,
        SpatiotemporalRole::Location,
    )
    .await
}

#[tauri::command]
pub async fn open_spatiotemporal_windows(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    evidence_id: i64,
    partition_id: i64,
    initial_range_start_ms: Option<i64>,
    initial_range_end_ms: Option<i64>,
) -> Result<OpenSpatiotemporalWindowsResult, String> {
    validate_main_opener(&window)?;
    let key = prepare_session(
        app.clone(),
        state.inner(),
        evidence_id,
        partition_id,
        initial_range_start_ms,
        initial_range_end_ms,
    )
    .await?;

    let mut result = OpenSpatiotemporalWindowsResult {
        timeline_label: None,
        location_label: None,
        timeline_error: None,
        location_error: None,
    };
    match open_workspace_window(
        &app,
        state.inner().clone(),
        key,
        SpatiotemporalRole::Timeline,
    )
    .await
    {
        Ok(label) => result.timeline_label = Some(label),
        Err(error) => result.timeline_error = Some(error),
    }
    match open_workspace_window(
        &app,
        state.inner().clone(),
        key,
        SpatiotemporalRole::Location,
    )
    .await
    {
        Ok(label) => result.location_label = Some(label),
        Err(error) => result.location_error = Some(error),
    }
    Ok(result)
}

#[tauri::command]
pub async fn register_spatiotemporal_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    request: RegisterSpatiotemporalWindowRequest,
) -> Result<SpatiotemporalSnapshot, String> {
    let key = session_key(request.evidence_id, request.partition_id)?;
    validate_caller(&window, request.role, key)?;
    validate_evidence_partition(&app, key).await?;
    let snapshot = {
        let mut registrations = state.window_registrations.write().await;
        let mut sessions = state.sessions.write().await;
        bind_window_registration(
            &mut registrations,
            &mut sessions,
            window.label(),
            key,
            request.role,
        )?
    };
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn get_spatiotemporal_snapshot(
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    evidence_id: i64,
    partition_id: i64,
) -> Result<Option<SpatiotemporalSnapshot>, String> {
    let key = session_key(evidence_id, partition_id)?;
    validate_reader(&window, key)?;
    let sessions = state.sessions.read().await;
    Ok(sessions.get(&key).map(|session| session.snapshot(key)))
}

#[tauri::command]
pub async fn update_spatiotemporal_range_from_main(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    request: UpdateSpatiotemporalRangeFromMainRequest,
) -> Result<Option<SpatiotemporalSnapshot>, String> {
    validate_main_caller(&window, "update the investigation time range")?;
    let key = session_key(request.evidence_id, request.partition_id)?;
    let (snapshot, changed) = {
        let mut sessions = state.sessions.write().await;
        update_main_range_in_sessions(&mut sessions, key, &request)
    };
    if changed {
        if let Some(snapshot) = &snapshot {
            emit_snapshot(&app, snapshot);
        }
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn set_spatiotemporal_sync_from_main(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    request: SetSpatiotemporalSyncFromMainRequest,
) -> Result<Option<SpatiotemporalSnapshot>, String> {
    validate_main_caller(&window, "change investigation time synchronization")?;
    let key = session_key(request.evidence_id, request.partition_id)?;
    let (snapshot, changed) = {
        let mut sessions = state.sessions.write().await;
        update_main_sync_in_sessions(&mut sessions, key, &request)
    };
    if changed {
        if let Some(snapshot) = &snapshot {
            emit_snapshot(&app, snapshot);
        }
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn update_spatiotemporal_state(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    request: UpdateSpatiotemporalStateRequest,
) -> Result<SpatiotemporalSnapshot, String> {
    let key = session_key(request.evidence_id, request.partition_id)?;
    validate_caller(&window, request.role, key)?;
    let snapshot = {
        let mut sessions = state.sessions.write().await;
        let session = sessions
            .get_mut(&key)
            .ok_or_else(|| "The spatiotemporal session is not active.".to_string())?;
        if !session.sync_enabled {
            return Ok(session.snapshot(key));
        }
        apply_state_update(session, &request)?;
        session.snapshot(key)
    };
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn set_spatiotemporal_sync(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, SpatiotemporalSessionState>,
    request: SetSpatiotemporalSyncRequest,
) -> Result<SpatiotemporalSnapshot, String> {
    let key = session_key(request.evidence_id, request.partition_id)?;
    validate_caller(&window, request.role, key)?;
    let snapshot = {
        let mut sessions = state.sessions.write().await;
        let session = sessions
            .get_mut(&key)
            .ok_or_else(|| "The spatiotemporal session is not active.".to_string())?;
        if request.sync_enabled
            && request.playing
            && session.playing
            && session.controller != Some(request.role)
        {
            return Err(format!(
                "Active playback is controlled by {}.",
                session
                    .controller
                    .map(SpatiotemporalRole::title)
                    .unwrap_or("another window")
            ));
        }
        let (range_start_ms, range_end_ms) =
            normalize_range(request.range_start_ms, request.range_end_ms);
        session.invalidate_playback_ticks();
        session.sync_enabled = request.sync_enabled;
        session.cursor_ms = request.cursor_ms;
        session.range_start_ms = range_start_ms;
        session.range_end_ms = range_end_ms;
        session.correlation_window_ms = normalize_correlation_window(request.correlation_window_ms);
        session.playback_rate = normalize_playback_rate(request.playback_rate);
        session.selected_timeline_event_id = request.selected_timeline_event_id;
        session.selected_location_observation_id = request.selected_location_observation_id;
        if request.sync_enabled && request.playing {
            session.playing = true;
            session.controller = Some(request.role);
        } else {
            session.playing = false;
            session.controller = None;
        }
        session.origin = Some(request.role.into());
        session.revision = session.revision.saturating_add(1);
        session.snapshot(key)
    };
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

pub async fn close_spatiotemporal_sessions_for_evidence(
    app: &AppHandle,
    state: &SpatiotemporalSessionState,
    evidence_id: i64,
) -> Result<(), String> {
    if evidence_id <= 0 {
        return Err("Evidence ID must be positive.".to_string());
    }
    // Keep a recovery copy and leave the live entries in place until every
    // window accepted close(). This lets evidence deletion abort and retry
    // without silently losing an active linked-workspace session.
    let original_sessions = {
        let sessions = state.sessions.read().await;
        sessions
            .iter()
            .filter(|(key, _)| key.evidence_id == evidence_id)
            .map(|(key, session)| (*key, session.clone()))
            .collect::<Vec<_>>()
    };

    let mut errors = Vec::new();
    for (key, _) in &original_sessions {
        for role in [SpatiotemporalRole::Timeline, SpatiotemporalRole::Location] {
            let label = spatiotemporal_window_label(role, key.evidence_id, key.partition_id);
            if let Some(window) = app.get_webview_window(&label) {
                if let Err(error) = window.close() {
                    errors.push(format!("Failed to close {label}: {error}"));
                }
            }
        }
    }
    if !errors.is_empty() {
        let snapshots = {
            let mut sessions = state.sessions.write().await;
            let mut snapshots = Vec::new();
            for (key, original) in original_sessions {
                let timeline_connected = app
                    .get_webview_window(&spatiotemporal_window_label(
                        SpatiotemporalRole::Timeline,
                        key.evidence_id,
                        key.partition_id,
                    ))
                    .is_some();
                let location_connected = app
                    .get_webview_window(&spatiotemporal_window_label(
                        SpatiotemporalRole::Location,
                        key.evidence_id,
                        key.partition_id,
                    ))
                    .is_some();

                let session = match sessions.get_mut(&key) {
                    Some(session) if session.lifecycle_id == original.lifecycle_id => session,
                    Some(_) => continue,
                    None => sessions.entry(key).or_insert(original),
                };
                session.set_connected(SpatiotemporalRole::Timeline, timeline_connected);
                session.set_connected(SpatiotemporalRole::Location, location_connected);
                snapshots.push(session.snapshot(key));
            }
            snapshots
        };
        for snapshot in snapshots {
            emit_snapshot(app, &snapshot);
        }
        return Err(errors.join(" "));
    }

    let mut sessions = state.sessions.write().await;
    for (key, original) in original_sessions {
        if sessions
            .get(&key)
            .is_some_and(|session| session.lifecycle_id == original.lifecycle_id)
        {
            sessions.remove(&key);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_scoped_to_evidence_partition_and_role() {
        assert_eq!(
            spatiotemporal_window_label(SpatiotemporalRole::Timeline, 4, 9),
            "timeline-e4-p9"
        );
        assert_eq!(
            spatiotemporal_window_label(SpatiotemporalRole::Location, 4, 9),
            "location-e4-p9"
        );
    }

    #[test]
    fn inverted_ranges_are_normalized() {
        assert_eq!(normalize_range(Some(20), Some(10)), (Some(10), Some(20)));
        assert_eq!(normalize_range(Some(10), None), (Some(10), None));
    }

    #[test]
    fn correlation_window_is_bounded() {
        assert_eq!(normalize_correlation_window(10), MIN_CORRELATION_WINDOW_MS);
        assert_eq!(
            normalize_correlation_window(MAX_CORRELATION_WINDOW_MS + 1),
            MAX_CORRELATION_WINDOW_MS
        );
    }

    #[test]
    fn playback_rate_supports_long_history_speeds() {
        assert_eq!(normalize_playback_rate(3_600.0), 3_600.0);
        assert_eq!(normalize_playback_rate(9_999.0), 3_600.0);
        assert_eq!(normalize_playback_rate(f64::NAN), DEFAULT_PLAYBACK_RATE);
    }

    #[tokio::test]
    async fn sessions_are_isolated_by_evidence_and_partition() {
        let state = SpatiotemporalSessionState::default();
        let first = SessionKey {
            evidence_id: 1,
            partition_id: 2,
        };
        let second = SessionKey {
            evidence_id: 1,
            partition_id: 3,
        };
        seed_session_if_missing(&state, first, Some(100), Some(200)).await;
        seed_session_if_missing(&state, second, Some(300), Some(400)).await;
        let sessions = state.sessions.read().await;
        assert_eq!(sessions.len(), 2);
        assert_ne!(first, second);
        assert_eq!(
            sessions
                .get(&first)
                .and_then(|session| session.range_start_ms),
            Some(100)
        );
        assert_eq!(
            sessions
                .get(&second)
                .and_then(|session| session.range_start_ms),
            Some(300)
        );
    }

    #[tokio::test]
    async fn launch_seed_never_overwrites_an_existing_session() {
        let state = SpatiotemporalSessionState::default();
        let key = SessionKey {
            evidence_id: 8,
            partition_id: 5,
        };
        seed_session_if_missing(&state, key, Some(100), Some(200)).await;
        seed_session_if_missing(&state, key, Some(500), Some(600)).await;
        let sessions = state.sessions.read().await;
        let session = sessions.get(&key).unwrap();
        assert_eq!(session.range_start_ms, Some(100));
        assert_eq!(session.range_end_ms, Some(200));
    }

    #[test]
    fn update_patch_distinguishes_omitted_and_explicitly_cleared_values() {
        let omitted: UpdateSpatiotemporalStateRequest = serde_json::from_value(serde_json::json!({
            "evidenceId": 1,
            "partitionId": 2,
            "role": "timeline"
        }))
        .unwrap();
        assert_eq!(omitted.cursor_ms, None);
        assert_eq!(omitted.selected_timeline_event_id, None);

        let cleared: UpdateSpatiotemporalStateRequest = serde_json::from_value(serde_json::json!({
            "evidenceId": 1,
            "partitionId": 2,
            "role": "timeline",
            "cursorMs": null,
            "selectedTimelineEventId": null
        }))
        .unwrap();
        assert_eq!(cleared.cursor_ms, Some(None));
        assert_eq!(cleared.selected_timeline_event_id, Some(None));
    }

    #[test]
    fn non_controller_must_explicitly_stop_before_seeking() {
        let session = Session {
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            ..Session::default()
        };
        let role = SpatiotemporalRole::Timeline;

        assert!(!playback_patch_is_allowed(&session, role, true, None));
        assert!(playback_patch_is_allowed(&session, role, true, Some(false)));
        assert!(playback_patch_is_allowed(&session, role, false, None));
    }

    #[test]
    fn closing_the_controller_pauses_playback() {
        let mut session = Session {
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            location_connected: true,
            ..Session::default()
        };

        assert!(session.set_connected(SpatiotemporalRole::Location, false));
        assert!(!session.playing);
        assert_eq!(session.controller, None);
    }

    #[test]
    fn stale_playback_generation_cannot_overwrite_a_timeline_seek() {
        let mut session = Session {
            sync_enabled: true,
            cursor_ms: Some(100),
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            playback_generation: 7,
            playback_tick_sequence: 3,
            selected_location_observation_id: Some(55),
            ..Session::default()
        };
        let seek: UpdateSpatiotemporalStateRequest = serde_json::from_value(serde_json::json!({
            "evidenceId": 1,
            "partitionId": 2,
            "role": "timeline",
            "cursorMs": 500,
            "playing": false,
            "controller": null,
            "selectedTimelineEventId": 42
        }))
        .unwrap();
        apply_state_update(&mut session, &seek).unwrap();
        assert_eq!(session.cursor_ms, Some(500));
        assert_eq!(session.playback_generation, 8);
        assert_eq!(session.playback_tick_sequence, 0);
        assert_eq!(session.selected_location_observation_id, None);

        let stale_tick: UpdateSpatiotemporalStateRequest =
            serde_json::from_value(serde_json::json!({
                "evidenceId": 1,
                "partitionId": 2,
                "role": "location",
                "cursorMs": 600,
                "playbackGeneration": 7,
                "playbackTickSequence": 4
            }))
            .unwrap();
        assert!(apply_state_update(&mut session, &stale_tick).is_err());
        assert_eq!(session.cursor_ms, Some(500));
    }

    #[test]
    fn playback_ticks_must_be_strictly_increasing_within_a_generation() {
        let mut session = Session {
            sync_enabled: true,
            cursor_ms: Some(100),
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            playback_generation: 12,
            playback_tick_sequence: 4,
            selected_timeline_event_id: Some(77),
            ..Session::default()
        };
        let accepted: UpdateSpatiotemporalStateRequest =
            serde_json::from_value(serde_json::json!({
                "evidenceId": 1,
                "partitionId": 2,
                "role": "location",
                "cursorMs": 200,
                "playbackGeneration": 12,
                "playbackTickSequence": 5
            }))
            .unwrap();
        apply_state_update(&mut session, &accepted).unwrap();
        assert_eq!(session.cursor_ms, Some(200));
        assert_eq!(session.playback_tick_sequence, 5);
        assert_eq!(session.selected_timeline_event_id, None);

        let out_of_order: UpdateSpatiotemporalStateRequest =
            serde_json::from_value(serde_json::json!({
                "evidenceId": 1,
                "partitionId": 2,
                "role": "location",
                "cursorMs": 150,
                "playbackGeneration": 12,
                "playbackTickSequence": 5
            }))
            .unwrap();
        assert!(apply_state_update(&mut session, &out_of_order).is_err());
        assert_eq!(session.cursor_ms, Some(200));
        assert_eq!(session.playback_tick_sequence, 5);
    }

    #[test]
    fn playback_tick_shape_cannot_mix_selection_or_control_fields() {
        let mut session = Session {
            sync_enabled: true,
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            playback_generation: 3,
            ..Session::default()
        };
        let mixed_tick: UpdateSpatiotemporalStateRequest =
            serde_json::from_value(serde_json::json!({
                "evidenceId": 1,
                "partitionId": 2,
                "role": "location",
                "cursorMs": 200,
                "selectedTimelineEventId": null,
                "playbackGeneration": 3,
                "playbackTickSequence": 1
            }))
            .unwrap();

        assert!(apply_state_update(&mut session, &mixed_tick).is_err());
        assert_eq!(session.cursor_ms, None);
        assert_eq!(session.playback_tick_sequence, 0);
    }

    #[test]
    fn investigation_mutations_are_main_window_only() {
        assert!(validate_main_window_label("main", "update the investigation time range").is_ok());
        let error =
            validate_main_window_label("timeline-e1-p2", "update the investigation time range")
                .unwrap_err();
        assert!(error.contains("timeline-e1-p2"));
        assert!(error.contains("cannot update the investigation time range"));
    }

    #[tokio::test]
    async fn recreated_session_has_a_distinct_public_identity() {
        let state = SpatiotemporalSessionState::default();
        let key = SessionKey {
            evidence_id: 11,
            partition_id: 7,
        };
        seed_session_if_missing(&state, key, Some(100), Some(200)).await;
        let first_id = state
            .sessions
            .read()
            .await
            .get(&key)
            .unwrap()
            .session_id
            .clone();
        state.sessions.write().await.remove(&key);
        seed_session_if_missing(&state, key, Some(100), Some(200)).await;
        let second_id = state
            .sessions
            .read()
            .await
            .get(&key)
            .unwrap()
            .session_id
            .clone();

        assert_ne!(first_id, second_id);
    }

    #[test]
    fn destroyed_handler_tracks_the_lifecycle_joined_after_session_recreation() {
        let key = SessionKey {
            evidence_id: 12,
            partition_id: 4,
        };
        let label = spatiotemporal_window_label(
            SpatiotemporalRole::Location,
            key.evidence_id,
            key.partition_id,
        );
        let first = Session::default();
        let first_lifecycle_id = first.lifecycle_id;
        let mut sessions = HashMap::from([(key, first)]);
        let mut registrations = HashMap::from([(
            label.clone(),
            WindowRegistration {
                instance_id: 73,
                key,
                role: SpatiotemporalRole::Location,
                initial_lifecycle_id: first_lifecycle_id,
                bound_lifecycle_id: None,
            },
        )]);

        // Deterministically reproduce the Open Both race: the lifecycle which
        // existed when Location's Destroyed handler was installed disappears
        // before the Location page invokes register. Registration creates and
        // joins a new lifecycle instead.
        sessions.remove(&key);
        let second = Session::default();
        let second_lifecycle_id = second.lifecycle_id;
        assert_ne!(first_lifecycle_id, second_lifecycle_id);
        sessions.insert(key, second);

        let registered = bind_window_registration(
            &mut registrations,
            &mut sessions,
            &label,
            key,
            SpatiotemporalRole::Location,
        )
        .unwrap();
        assert!(registered.location_connected);
        assert_eq!(
            registrations.get(&label).unwrap().bound_lifecycle_id,
            Some(second_lifecycle_id)
        );

        let disconnected =
            disconnect_window_instance(&mut registrations, &mut sessions, &label, 73).unwrap();
        assert!(!disconnected.location_connected);
        assert!(registrations.is_empty());
        assert!(sessions.is_empty());
    }

    #[test]
    fn stale_destroyed_callback_cannot_disconnect_reused_window_label() {
        let key = SessionKey {
            evidence_id: 13,
            partition_id: 8,
        };
        let label = spatiotemporal_window_label(
            SpatiotemporalRole::Timeline,
            key.evidence_id,
            key.partition_id,
        );
        let mut session = Session::default();
        session.set_connected(SpatiotemporalRole::Timeline, true);
        let lifecycle_id = session.lifecycle_id;
        let mut sessions = HashMap::from([(key, session)]);
        let mut registrations = HashMap::from([(
            label.clone(),
            WindowRegistration {
                instance_id: 102,
                key,
                role: SpatiotemporalRole::Timeline,
                initial_lifecycle_id: lifecycle_id,
                bound_lifecycle_id: Some(lifecycle_id),
            },
        )]);

        assert!(
            disconnect_window_instance(&mut registrations, &mut sessions, &label, 101).is_none()
        );
        assert!(registrations.contains_key(&label));
        assert!(sessions.get(&key).unwrap().timeline_connected);
    }

    #[test]
    fn main_range_update_normalizes_and_invalidates_playback_once() {
        let key = SessionKey {
            evidence_id: 1,
            partition_id: 2,
        };
        let session = Session {
            sync_enabled: true,
            cursor_ms: Some(150),
            range_start_ms: Some(100),
            range_end_ms: Some(200),
            playing: true,
            controller: Some(SpatiotemporalRole::Location),
            playback_generation: 8,
            playback_tick_sequence: 4,
            selected_timeline_event_id: Some(41),
            selected_location_observation_id: Some(42),
            revision: 12,
            ..Session::default()
        };
        let session_id = session.session_id.clone();
        let request = UpdateSpatiotemporalRangeFromMainRequest {
            evidence_id: key.evidence_id,
            partition_id: key.partition_id,
            expected_session_id: Some(session_id),
            // Main range updates intentionally need not race every playback
            // tick; the lifecycle identity remains the required guard.
            expected_revision: None,
            range_start_ms: Some(900),
            range_end_ms: Some(300),
        };
        let mut sessions = HashMap::from([(key, session.clone())]);

        let (snapshot, changed) = update_main_range_in_sessions(&mut sessions, key, &request);
        assert!(changed);
        let snapshot = snapshot.unwrap();
        assert_eq!(snapshot.range_start_ms, Some(300));
        assert_eq!(snapshot.range_end_ms, Some(900));
        assert_eq!(snapshot.cursor_ms, None);
        assert!(!snapshot.playing);
        assert_eq!(snapshot.controller, None);
        assert_eq!(snapshot.playback_generation, 9);
        assert_eq!(snapshot.playback_tick_sequence, 0);
        assert_eq!(snapshot.selected_timeline_event_id, None);
        assert_eq!(snapshot.selected_location_observation_id, None);
        assert_eq!(snapshot.origin, Some(SpatiotemporalOrigin::Investigation));
        assert_eq!(snapshot.revision, 13);

        let (same_snapshot, changed_again) =
            update_main_range_in_sessions(&mut sessions, key, &request);
        assert!(!changed_again);
        assert_eq!(same_snapshot.unwrap().revision, 13);

        // An explicit null/null range clears both bounds and performs one more
        // coherent clock transition.
        let clear = UpdateSpatiotemporalRangeFromMainRequest {
            range_start_ms: None,
            range_end_ms: None,
            ..request
        };
        let (cleared, changed) = update_main_range_in_sessions(&mut sessions, key, &clear);
        assert!(changed);
        let cleared = cleared.unwrap();
        assert_eq!((cleared.range_start_ms, cleared.range_end_ms), (None, None));
        assert_eq!(cleared.revision, 14);
    }

    #[test]
    fn main_range_update_is_safe_when_disabled_missing_or_stale() {
        let key = SessionKey {
            evidence_id: 3,
            partition_id: 4,
        };
        let other_key = SessionKey {
            evidence_id: 3,
            partition_id: 5,
        };
        let session = Session {
            sync_enabled: false,
            range_start_ms: Some(10),
            range_end_ms: Some(20),
            revision: 6,
            ..Session::default()
        };
        let real_session_id = session.session_id.clone();
        let mut sessions = HashMap::from([(key, session)]);
        let request = UpdateSpatiotemporalRangeFromMainRequest {
            evidence_id: key.evidence_id,
            partition_id: key.partition_id,
            expected_session_id: Some(real_session_id),
            expected_revision: None,
            range_start_ms: Some(30),
            range_end_ms: Some(40),
        };

        let (disabled, changed) = update_main_range_in_sessions(&mut sessions, key, &request);
        assert!(!changed);
        assert_eq!(disabled.unwrap().revision, 6);
        assert_eq!(sessions.get(&key).unwrap().range_start_ms, Some(10));

        let (missing, changed) = update_main_range_in_sessions(&mut sessions, other_key, &request);
        assert!(!changed);
        assert!(missing.is_none());
        assert_eq!(sessions.len(), 1);

        let stale = UpdateSpatiotemporalRangeFromMainRequest {
            expected_session_id: Some("st-from-an-older-session".to_string()),
            ..request
        };
        sessions.get_mut(&key).unwrap().sync_enabled = true;
        let (current, changed) = update_main_range_in_sessions(&mut sessions, key, &stale);
        assert!(!changed);
        assert_eq!(current.unwrap().revision, 6);
        assert_eq!(sessions.get(&key).unwrap().range_start_ms, Some(10));
    }

    #[test]
    fn main_sync_toggle_seeds_range_and_is_idempotent() {
        let key = SessionKey {
            evidence_id: 6,
            partition_id: 9,
        };
        let session = Session {
            cursor_ms: Some(150),
            range_start_ms: Some(100),
            range_end_ms: Some(200),
            selected_timeline_event_id: Some(1),
            selected_location_observation_id: Some(2),
            playback_generation: 2,
            revision: 4,
            ..Session::default()
        };
        let session_id = session.session_id.clone();
        let mut sessions = HashMap::from([(key, session)]);
        let request = SetSpatiotemporalSyncFromMainRequest {
            evidence_id: key.evidence_id,
            partition_id: key.partition_id,
            expected_session_id: Some(session_id),
            expected_revision: Some(4),
            sync_enabled: true,
            range_start_ms: Some(800),
            range_end_ms: Some(500),
        };

        let (enabled, changed) = update_main_sync_in_sessions(&mut sessions, key, &request);
        assert!(changed);
        let enabled = enabled.unwrap();
        assert!(enabled.sync_enabled);
        assert_eq!(
            (enabled.range_start_ms, enabled.range_end_ms),
            (Some(500), Some(800))
        );
        assert_eq!(enabled.cursor_ms, None);
        assert_eq!(enabled.playback_generation, 3);
        assert_eq!(enabled.origin, Some(SpatiotemporalOrigin::Investigation));
        assert_eq!(enabled.revision, 5);

        let idempotent = SetSpatiotemporalSyncFromMainRequest {
            expected_revision: Some(5),
            ..request
        };
        let (same, changed) = update_main_sync_in_sessions(&mut sessions, key, &idempotent);
        assert!(!changed);
        assert_eq!(same.unwrap().revision, 5);
    }
}
