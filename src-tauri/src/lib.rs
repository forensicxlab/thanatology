use exhume_body::Body;
use exhume_extfs::extfs::ExtFS;
use exhume_lvm::Lvm2;
use exhume_partitions::{mbr::MBRPartitionEntry, Partitions};
use tauri_plugin_sql::Migration;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::path::Path;

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

    // Extfs
    if partition.partition_type == 0x83 {
        match ExtFS::new(&mut body, partition.first_byte_addr as u64) {
            Ok(_) => Ok(true),
            Err(err) => Err(format!("Could not parse the extfs partition: {:?}", err)),
        }
    }
    // LVM
    else if partition.partition_type == 0x8E {
        match Lvm2::open(&mut body, partition.first_byte_addr as u64) {
            Ok(_) => Ok(true),
            Err(err) => Err(format!("Could not parse the lvm partition: {:?}", err)),
        }
    } else {
        Err("Thanatology doesn't support the exhume of this partition type.".to_string())
    }
}

#[tauri::command]
fn default_processing_action(evidence_id: i64) -> Result<String, String> {
    println!(
        "Default processing action triggered for evidence_id: {} (currently does nothing)",
        evidence_id
    );
    // TODO: Implement real processing logic in the future
    Ok("Default processing action initiated.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(init_migrations: Vec<Migration>) {
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
            default_processing_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
