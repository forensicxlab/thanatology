use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug)]
pub enum ProgressMessageType {
    Info,
    Error,
    Success,
}

#[derive(Debug)]
pub enum ProgressMessageLevel {
    Main,
    Module,
}

impl ProgressMessageType {
    fn to_suffix(&self) -> &'static str {
        match self {
            ProgressMessageType::Info => "info",
            ProgressMessageType::Error => "error",
            ProgressMessageType::Success => "success",
        }
    }
}

impl ProgressMessageLevel {
    fn to_suffix(&self) -> &'static str {
        match self {
            ProgressMessageLevel::Main => "main",
            ProgressMessageLevel::Module => "module",
        }
    }
}

/// Emits a progress event tailored to the specific evidence ID.
///
/// # Arguments
///
/// * `evidence_id` - The ID of the evidence.
/// * `level` - The level of the message (main/module).
/// * `msg_type` - The type of the progress message.
/// * `message` - The message to send.
/// * `app` - The Tauri application handle.
pub fn emit_progress_event<T: Serialize>(
    evidence_id: &i64,
    level: ProgressMessageLevel,
    msg_type: ProgressMessageType,
    message: T,
    app: &AppHandle,
) {
    let event_name = format!(
        "{}_progress_{}_{}",
        level.to_suffix(),
        msg_type.to_suffix(),
        evidence_id
    );
    app.emit(&event_name, &message).ok();
}
