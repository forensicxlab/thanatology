use exhume_body::Body;
use exhume_partitions::Partitions;
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
/// Here we simply simulate a successful read if the partition size is greater than 0.
// #[tauri::command]
// fn read_partition(partition: Partitions, path: String) -> Result<bool, String> {
//     if partition.size_sectors > 0 {
//         println!("Successfully read partition: {:?}", partition);
//         Ok(true)
//     } else {
//         Err("Failed to read partition: partition size is zero".into())
//     }
// }

/// Fetch a list of extraction modules compatible with the selected partition.
/// The list returned here depends on the partition type.
// #[tauri::command]
// fn get_extraction_modules(partition: MBRPartitionEntry) -> Result<Vec<ExtractionModule>, String> {
//     let modules = match partition.partition_type {
//         0x07 => vec![
//             ExtractionModule {
//                 id: "fs_extract".to_string(),
//                 name: "File System Extraction".to_string(),
//                 description: "Extracts file system artefacts.".to_string(),
//             },
//             ExtractionModule {
//                 id: "event_logs".to_string(),
//                 name: "Event Log Extraction".to_string(),
//                 description: "Extracts Windows event logs.".to_string(),
//             },
//         ],
//         0x83 => vec![ExtractionModule {
//             id: "linux_fs".to_string(),
//             name: "Linux File System Extraction".to_string(),
//             description: "Extracts Linux file system artefacts.".to_string(),
//         }],
//         _ => vec![ExtractionModule {
//             id: "generic".to_string(),
//             name: "Generic Extraction".to_string(),
//             description: "Generic artefact extraction module.".to_string(),
//         }],
//     };
//     Ok(modules)
// }

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
            //read_partition,
            //get_extraction_modules
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
