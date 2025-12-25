use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs};
use exhume_filesystem::filesystem::Filesystem;
use log::{error, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};

use tauri::State;

pub type SharedState = Arc<Mutex<Option<DetectedFs<BodySlice>>>>;

#[derive(Serialize, Deserialize)]
pub struct FsInfo {
    pub filesystem_type: String,
    pub block_size: u64,
    pub metadata: Value,
}

#[tauri::command]
pub fn get_fs_info(
    state: tauri::State<'_, SharedState>,
    path: String,
    offset: u64,
    size: u64,
) -> Result<FsInfo, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let bytes_size = body.get_sector_size() as u64 * size;
    let fs = match detect_filesystem(&mut body, offset, bytes_size) {
        Ok(fs) => fs,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };

    let filesystem_type = fs.filesystem_type();
    let block_size = fs.block_size();
    let metadata = fs.get_metadata().unwrap();
    let info = FsInfo {
        filesystem_type,
        block_size,
        metadata,
    };

    let mut state_lock = state.lock().unwrap();
    *state_lock = Some(fs);
    Ok(info)
}

#[tauri::command]
pub fn read_file_slice(
    state: tauri::State<'_, SharedState>,
    file_id: u64,
    offset: u64,
    length: usize,
) -> Result<String, String> {
    info!("Reading file {:?} slice ", file_id);

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = fs.get_file(file_id).map_err(|e| e.to_string())?;
    let content = fs
        .read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())?;

    // Convert to a safe printable string
    Ok(String::from_utf8_lossy(&content).to_string())
}

#[tauri::command]
pub fn read_file_prefix(
    state: tauri::State<'_, SharedState>,
    file_id: u64,
    length: usize,
) -> Result<String, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    info!("Reading file {:?} prefix ", file_id);

    let file = fs.get_file(file_id).map_err(|e| e.to_string())?;
    let content = fs
        .read_file_prefix(&file, length)
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&content).to_string())
}

#[tauri::command]
pub fn read_file_slice_bytes(
    state: State<'_, SharedState>,
    file_id: u64,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = fs.get_file(file_id).map_err(|e| e.to_string())?;
    let content = fs
        .read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
pub fn read_file_bytes(state: State<'_, SharedState>, file_id: u64) -> Result<Vec<u8>, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    info!("Reading file {:?} bytes ", file_id);

    let file = fs.get_file(file_id).map_err(|e| e.to_string())?;
    let content = fs.read_file_content(&file).map_err(|e| e.to_string())?;

    Ok(content)
}
