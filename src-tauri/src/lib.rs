mod modules;
use env_logger;
use exhume_body::{Body, BodySlice};
use exhume_extfs::ExtFS;
use exhume_filesystem::Filesystem;
use exhume_lvm::Lvm2;
use exhume_partitions::{mbr::MBRPartitionEntry, Partitions};
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use log::{debug, info};
use modules::th_ldfi::process_ldfi;
use sqlx::query;
use sqlx::sqlite::SqlitePool;
use tauri::AppHandle;
use tauri_plugin_sql::Migration;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::path::Path;

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
/// TODO: We have to try to create all of the filesystem objects without checking the type except for LVM.
/// If LVM we try LVM first before the creation of all of the other underlying filesystems.
#[tauri::command]
fn read_mbr_partition(partition: MBRPartitionEntry, path: String) -> Result<bool, String> {
    let mut body: Body = Body::new(path.to_string(), "auto");
    let partition_size_result =
        (partition.size_sectors as u64).checked_mul(body.get_sector_size() as u64);

    let partition_size = match partition_size_result {
        Some(size) => size,
        None => return Err("Error: Overflow occurred when calculating partition size".to_string()),
    };

    let mut isolated_partition: Option<BodySlice> =
        match BodySlice::new(&mut body, partition.first_byte_addr as u64, partition_size) {
            Ok(slice) => Some(slice),
            Err(e) => return Err(format!("Error creating BodySlice: {:?}", e)),
        };

    if partition.partition_type == 0x83 {
        match ExtFS::new(isolated_partition.as_mut().unwrap()) {
            Ok(_) => Ok(true),
            Err(err) => Err(format!("Could not parse the extfs partition: {:?}", err)),
        }
    } else if partition.partition_type == 0x8E {
        match Lvm2::open(isolated_partition.as_mut().unwrap()) {
            Ok(_) => Ok(true),
            Err(err) => Err(format!("Could not parse the lvm partition: {:?}", err)),
        }
    } else {
        Err("Thanatology doesn't support the exhume of this partition type.".to_string())
    }
}

#[tauri::command]
fn process_linux_partitions(
    evidence_id: i64,
    partitions: Vec<MBRPartitionEntry>,
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

        let total_partitions = partitions.len() as u64;

        for (index, partition) in partitions.into_iter().enumerate() {
            // Emit phase message
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Info,
                format!("Processing partition {}/{}", index + 1, total_partitions),
                &app,
            );

            // Process the partition
            process_linux_partition(
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
                "Succesfully parsed all of the partitions.",
                &app,
            );
        }
    });
}

async fn process_linux_partition(
    evidence_id: i64,
    partition: MBRPartitionEntry,
    disk_image_path: String,
    pool: SqlitePool,
    app: &AppHandle,
) {
    let mut body = Body::new(disk_image_path, "auto");
    let sector_size = body.get_sector_size();
    let partition_size_bytes = partition.size_sectors as u64 * sector_size as u64;
    let mut slice = match BodySlice::new(
        &mut body,
        partition.first_byte_addr as u64,
        partition_size_bytes,
    ) {
        Ok(s) => s,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Error creating BodySlice: {e:?}"),
                &app,
            );
            return;
        }
    };

    //TODO: THIS PART OF THE CODE HAS TO BE REWORKED TO RETURN THE RIGHT FS
    //OBJECT TO CREATE WE LEAVE EXTFS FOR NOW BUT IT HURTS
    if partition.partition_type != 0x83 {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Thanatology does not support this partition type."),
            &app,
        );
        return;
    }

    let mut extfs = match ExtFS::new(&mut slice) {
        Ok(fs) => fs,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Error creating ExtFS: {e:?}"),
                &app,
            );
            return;
        }
    };
    if let Err(e) = extfs.open_fs() {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Error opening ExtFS: {e:?}"),
            &app,
        );
        return;
    }
    process_ldfi(&mut extfs, evidence_id, app, pool).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:thanatology.db", init_migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_evidence_exists,
            check_disk_image_format,
            discover_partitions,
            read_mbr_partition,
            process_linux_partitions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
