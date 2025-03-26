use exhume_body::Body;
use exhume_filesystem::detect_filesystem;
use exhume_filesystem::Filesystem;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct FsInfo {
    pub filesystem_type: String,
    pub block_size: u64,
}

#[tauri::command]
pub fn get_fs_info(path: String, offset: u64, size: u64) -> Result<FsInfo, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let fs = match detect_filesystem(&mut body, offset, size) {
        Ok(fs) => fs,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };

    let fs_type = fs.filesystem_type();
    let block_size = fs.block_size();

    let info = FsInfo {
        filesystem_type: fs_type,
        block_size: block_size,
    };

    Ok(info)
}
