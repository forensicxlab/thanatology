use exhume_body::Body;
use exhume_filesystem::detected_fs::{detect_filesystem, DetectedFs, ImageStream};
use exhume_filesystem::filesystem::{FileCommon, Filesystem};
use exhume_filesystem::folder_impl::FolderFS;
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File as StdFile;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::State;

pub type SharedState = Arc<Mutex<Option<DetectedFs<ImageStream>>>>;

#[derive(Serialize, Deserialize)]
pub struct FsInfo {
    pub filesystem_type: String,
    pub block_size: u64,
    pub metadata: Value,
    pub image_size: u64,
}

fn resolve_host_file_path(path: Option<&str>, root_path: Option<&str>) -> Option<PathBuf> {
    let path = path?.trim();
    if path.is_empty() {
        return None;
    }

    if let Some(root_path) = root_path {
        let root = PathBuf::from(root_path.trim());
        if root.exists() {
            let relative = path.trim_start_matches(['/', '\\']);
            let joined = root.join(relative);
            if joined.exists() {
                return Some(joined);
            }
        }
    }

    let direct = PathBuf::from(path);
    if direct.exists() {
        return Some(direct);
    }

    None
}


fn read_host_slice(path: &Path, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    let mut file = StdFile::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buffer = vec![0; length];
    let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
    buffer.truncate(read);
    Ok(buffer)
}

fn read_host_prefix(path: &Path, length: usize) -> Result<Vec<u8>, String> {
    read_host_slice(path, 0, length)
}

fn read_host_bytes(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

fn dump_host_file(path: &Path, destination_path: &str) -> Result<(), String> {
    let mut source = StdFile::open(path).map_err(|e| e.to_string())?;
    let mut destination = StdFile::create(destination_path).map_err(|e| e.to_string())?;
    std::io::copy(&mut source, &mut destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn compute_hash_from_host_file(path: &Path, algorithm: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use md5::Md5;

    let mut file = StdFile::open(path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1024 * 1024];

    match algorithm {
        "md5" => {
            let mut hasher = Md5::new();
            loop {
                let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            loop {
                let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        _ => Err(format!("Unsupported algorithm: {}", algorithm)),
    }
}

#[tauri::command]
pub fn get_fs_info(
    state: tauri::State<'_, SharedState>,
    path: String,
    offset: u64,
    size: u64,
    fvek: Option<String>,
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
            image_size: 0,
        };

        let mut state_lock = state.lock().unwrap();
        *state_lock = Some(DetectedFs::Folder(fs));
        return Ok(info);
    }

    let mut body: Body = Body::new(path.to_string(), "auto");
    // For a whole-disk logical image (offset == 0), always use the body's declared
    // logical size so compressed formats (AFF4, EWF) report the uncompressed size.
    // For sub-partitions (offset > 0) the caller-supplied sector count is authoritative.
    let bytes_size = if offset == 0 {
        body.get_image_size()
    } else {
        body.get_sector_size() as u64 * size
    };
    let key_material = fvek.and_then(|h| hex::decode(h).ok()).map(|f| exhume_filesystem::detected_fs::KeyMaterial { bitlocker_fvek: Some(f) });
    let fs = match detect_filesystem(&mut body, offset, bytes_size, key_material) {
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
        image_size: body.get_image_size(),
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
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Reading file {:?} slice ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        let content = read_host_slice(&host_path, offset, length)?;
        return Ok(String::from_utf8_lossy(&content).to_string());
    }

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

    Ok(String::from_utf8_lossy(&content).to_string())
}

#[tauri::command]
pub fn read_file_prefix(
    state: tauri::State<'_, SharedState>,
    file_id: u64,
    length: usize,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Reading file {:?} prefix ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        let content = read_host_prefix(&host_path, length)?;
        return Ok(String::from_utf8_lossy(&content).to_string());
    }

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
    root_path: Option<String>,
) -> Result<Vec<u8>, String> {
    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return read_host_slice(&host_path, offset, length);
    }

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
    root_path: Option<String>,
) -> Result<Vec<u8>, String> {
    info!("Reading file {:?} bytes ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return read_host_bytes(&host_path);
    }

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

    let content = fs.read_file_content(&file).map_err(|e| e.to_string())?;

    Ok(content)
}

#[tauri::command]
pub fn dump_file_to_disk(
    state: State<'_, SharedState>,
    file_id: u64,
    destination_path: String,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<(), String> {
    info!("Dumping file {:?} to {}", file_id, destination_path);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return dump_host_file(&host_path, &destination_path);
    }

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
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Computing {} hash for file {:?}", algorithm, file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return compute_hash_from_host_file(&host_path, &algorithm);
    }

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
