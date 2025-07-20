use env_logger;
use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_partitions::{gpt::GPTPartitionEntry, mbr::MBRPartitionEntry, Partitions};
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
pub mod modules;

use modules::th_artifacts::process_artifacts;
use modules::th_filesystem::get_fs_info;
use modules::th_index::index_partition;

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    path::PathBuf,
};
use tauri::AppHandle;
use tauri_plugin_sql::Migration;

async fn update_evidence_status(
    pool: &SqlitePool,
    evidence_id: i64,
    status: i64,
) -> Result<(), sqlx::Error> {
    let query = "UPDATE evidence SET status = ? WHERE id = ?";
    sqlx::query(query)
        .bind(status)
        .bind(evidence_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractionModule {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// Check if the evidence file exists at the given path.
#[tauri::command]
fn check_evidence_exists(path: String) -> Result<bool, String> {
    let path_obj = Path::new(&path);
    if path_obj.exists() {
        Ok(true)
    } else {
        Err(format!("File not found at path: {}", path))
    }
}

/// Auto-detect the disk image format based on headers extension or content.
/// otherwise we return "RAW".
#[tauri::command]
fn check_disk_image_format(path: String) -> Result<String, String> {
    let body: Body = Body::new(path.to_string(), "auto");
    Ok(body.format_description().to_string())
}

/// Exhuming the partitions from the disk image.
/// Returns the Partition object found by exhume_partitions.
#[tauri::command]
fn discover_partitions(path: String) -> Result<Partitions, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    match Partitions::new(&mut body) {
        Ok(discover_partitions) => Ok(discover_partitions),
        Err(err) => Err(format!("Could not discover partitions: {:?}", err)),
    }
}

/// Attempt to read the selected partition from the disk image.
/// Here we try to read the selected partitions.
#[tauri::command]
fn read_mbr_partition(partition: MBRPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let partition_size_result =
        (partition.size_sectors as u64).checked_mul(body.get_sector_size() as u64);

    let partition_size = match partition_size_result {
        Some(size) => size,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let fs = match detect_filesystem(&mut body, partition.first_byte_addr as u64, partition_size) {
        Ok(_) => true,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };
    Ok(fs)
}

#[tauri::command]
fn read_gpt_partition(partition: GPTPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let partition_size_result = (partition.ending_lba - partition.starting_lba + 1)
        .checked_mul(body.get_sector_size() as u64);
    let partition_first_byte_addr = partition
        .starting_lba
        .checked_mul(body.get_sector_size() as u64);
    let partition_size = match partition_size_result {
        Some(size) => size,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let partition_start = match partition_first_byte_addr {
        Some(offset) => offset,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let fs = match detect_filesystem(&mut body, partition_start, partition_size) {
        Ok(_) => true,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ))
        }
    };
    Ok(fs)
}

#[tauri::command]
fn process_partitions(
    evidence_id: i64,
    mbr_partitions: Vec<MBRPartitionEntry>,
    gpt_partitions: Vec<GPTPartitionEntry>,
    disk_image_path: String,
    db_path: String,
    app: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        // Connect to the SQLite database.
        let pool = match SqlitePool::connect(&db_path).await {
            Ok(p) => p,
            Err(err) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("DB connection error: {err:?}"),
                    &app,
                );
                return;
            }
        };

        let total_partitions = mbr_partitions.len() as u64 + gpt_partitions.len() as u64;
        // MODULE 0 - Indexation: Needs to be fast and dumm. Other modules will take their time to do the smart stuff later
        // But we want the investigator to be able to jump into the analysis as soon as possible.
        for (index, partition) in mbr_partitions.clone().into_iter().enumerate() {
            // Emit phase message
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                format!("Indexing partition {}/{}", index + 1, total_partitions),
                &app,
            );

            // Process the partition
            index_partition(
                evidence_id,
                partition,
                disk_image_path.clone(),
                pool.clone(),
                &app,
            )
            .await;
        }

        // Update the evidence status in the database to 3
        if let Err(err) = update_evidence_status(&pool, evidence_id, 3).await {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Failed to update evidence status: {err:?}"),
                &app,
            );
        } else {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Success,
                "Succesfully indexed all of the partitions.",
                &app,
            );
        }

        // Once the indexation part is finished the user will be able to review the evidence but
        // in the background, we still execute the other parsing modules that are smarter (so a bit slower).
        // We give information about the progress via the same emit channel.
        // Thanatology will keep track of the executing tasks via the evidence id + status.

        for (index, partition) in mbr_partitions.into_iter().enumerate() {
            // Module 1 - Artifact Parsing => Should be fast. Once done, the status will be updated to 4.
            process_artifacts(
                evidence_id,
                partition,
                disk_image_path.clone(),
                pool.clone(),
                &app,
            )
            .await;
            // Module 2 - File Identification => Will be slow. Once done the status will be updated to 5.
            // Module 3 - TBD => We can add more status here.
        }
    });
}

#[tauri::command]
async fn read_chunk(path: String, offset: u64, length: u32) -> Result<Vec<u8>, String> {
    if length == 0 {
        return Ok(Vec::new());
    }

    // Own the path so we can move it safely into the thread-pool task.
    let path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        if !path.exists() {
            return Err("File does not exist".into());
        }

        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let file_len = file.metadata().map_err(|e| e.to_string())?.len();

        if offset >= file_len {
            return Ok(Vec::new());
        }

        let to_read = std::cmp::min(length as u64, file_len - offset) as usize;
        let mut buf = vec![0u8; to_read];

        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let read_bytes = file.read(&mut buf).map_err(|e| e.to_string())?;
        buf.truncate(read_bytes);
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Return the file length in bytes (`u64`), or an error message.
///
/// This is cheap enough to run directly on the async runtime thread.
#[tauri::command]
async fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn new_whiteboard(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(
        &app,
        "whiteboard",
        tauri::WebviewUrl::App("escalidraw.html".into()),
    )
    .title("Whiteboard")
    .maximized(true)
    .build()
    .unwrap();
}

#[tauri::command]
fn new_fileviewer(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(
        &app,
        "fileviewer",
        tauri::WebviewUrl::App("fileviewer.html".into()),
    )
    .title("Advanced File Viewer")
    .maximized(true)
    .build()
    .unwrap();
}

#[tauri::command]
fn new_shell(app: AppHandle) {
    tauri::WebviewWindowBuilder::new(&app, "shell", tauri::WebviewUrl::App("shell.html".into()))
        .title("Shell")
        .maximized(true)
        .build()
        .unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:thanatology.db", init_migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            check_evidence_exists,
            check_disk_image_format,
            discover_partitions,
            read_mbr_partition,
            read_gpt_partition,
            process_partitions,
            get_fs_info,
            new_whiteboard,
            new_fileviewer,
            new_shell,
            read_chunk,
            file_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
