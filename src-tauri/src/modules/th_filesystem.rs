use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::filesystem::Filesystem;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
pub struct FsInfo {
    pub filesystem_type: String,
    pub block_size: u64,
    pub metadata: Value,
}

#[tauri::command]
pub fn get_fs_info(path: String, offset: u64, size: u64) -> Result<FsInfo, String> {
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

    Ok(info)
}
