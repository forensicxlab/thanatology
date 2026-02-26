use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs};
use exhume_filesystem::filesystem::{FileCommon, Filesystem};
use exhume_filesystem::folder_impl::FolderFS;
use log::{error, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
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
    if Path::new(&path).is_dir() {
        let mut fs = FolderFS::new(PathBuf::from(&path));
        let _ = fs.walk_fs(&mut |_| {}); // Populate cache for subsequent reads
        let filesystem_type = fs.filesystem_type();
        let block_size = fs.block_size();
        let metadata = fs.get_metadata().map_err(|e| e.to_string())?;
        
        let info = FsInfo {
            filesystem_type,
            block_size,
            metadata,
        };

        let mut state_lock = state.lock().unwrap();
        *state_lock = Some(DetectedFs::Folder(fs));
        return Ok(info);
    }

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
    path: Option<String>,
) -> Result<String, String> {
    info!("Reading file {:?} slice ", file_id);

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

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
    path: Option<String>,
) -> Result<String, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    info!("Reading file {:?} prefix ", file_id);

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

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
    path: Option<String>,
) -> Result<Vec<u8>, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

    let content = fs
        .read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
pub fn read_file_bytes(
    state: State<'_, SharedState>,
    file_id: u64,
    path: Option<String>,
) -> Result<Vec<u8>, String> {
    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    info!("Reading file {:?} bytes ", file_id);

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

    let content = fs.read_file_content(&file).map_err(|e| e.to_string())?;

    Ok(content)
}

#[tauri::command]
pub fn dump_file_to_disk(
    state: State<'_, SharedState>,
    file_id: u64,
    destination_path: String,
    path: Option<String>,
) -> Result<(), String> {
    info!("Dumping file {:?} to {}", file_id, destination_path);

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

    let file_size = file.size();

    let mut dest_file = std::fs::File::create(&destination_path).map_err(|e| e.to_string())?;
    
    let chunk_size = 1024 * 1024; // 1MB
    let mut offset = 0;

    while offset < file_size {
        let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
        let data = fs.read_file_slice(&file, offset, len).map_err(|e| e.to_string())?;
        use std::io::Write;
        dest_file.write_all(&data).map_err(|e| e.to_string())?;
        offset += len as u64;
    }
    
    Ok(())
}

use sha2::{Sha256, Digest};
use md5::Md5;

#[tauri::command]
pub fn compute_hash(
    state: State<'_, SharedState>,
    file_id: u64,
    algorithm: String,
    path: Option<String>,
) -> Result<String, String> {
    info!("Computing {} hash for file {:?}", algorithm, file_id);

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id).map_err(|e| e.to_string())?
            } else {
                 return Err(format!("File ID {} not found and no path provided", file_id));
            }
        }
    };

    let file_size = file.size();

    let chunk_size = 1024 * 1024; // 1MB
    let mut offset = 0;

    match algorithm.as_str() {
        "md5" => {
            let mut hasher = Md5::new();
            while offset < file_size {
                let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
                let data = fs.read_file_slice(&file, offset, len).map_err(|e| e.to_string())?;
                hasher.update(&data);
                offset += len as u64;
            }
            let result = hasher.finalize();
            Ok(format!("{:x}", result))
        },
        "sha256" => {
            let mut hasher = Sha256::new();
            while offset < file_size {
                let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
                let data = fs.read_file_slice(&file, offset, len).map_err(|e| e.to_string())?;
                hasher.update(&data);
                offset += len as u64;
            }
            let result = hasher.finalize();
            Ok(format!("{:x}", result))
        },
         _ => Err(format!("Unsupported algorithm: {}", algorithm)),
    }
}
