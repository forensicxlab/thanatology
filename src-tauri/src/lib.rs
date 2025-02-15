use tauri_plugin_sql::Migration;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MBRPartitionEntry {
    pub boot_indicator: u8,     // Bootable flag (e.g., 0x80 for active)
    pub start_chs: [u8; 3],     // CHS address of the start of the partition
    pub partition_type: u8,     // Partition type (e.g., 0x07 for NTFS)
    pub end_chs: [u8; 3],       // CHS address of the end of the partition
    pub start_lba: u32,         // Start address of the partition in LBA
    pub size_sectors: u32,      // Size of the partition in sectors
    pub sector_size: usize,     // Size of a sector in bytes
    pub first_byte_addr: usize, // Byte offset for the first byte
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

/// Auto-detect the disk image format based on file extension or content.
/// Here we simply return "E01" if the extension is ".e01" (case-insensitive),
/// otherwise we return "DD".
#[tauri::command]
fn check_disk_image_format(path: String) -> Result<String, String> {
    let path_obj = Path::new(&path);
    if let Some(ext) = path_obj.extension() {
        if ext.to_string_lossy().to_lowercase() == "e01" {
            return Ok("E01".to_string());
        }
    }
    Ok("DD".to_string())
}

/// Discover partitions on the disk image.
/// Returns a dummy list of partitions for demonstration purposes.
#[tauri::command]
fn discover_partitions(path: String) -> Result<Vec<MBRPartitionEntry>, String> {
    // In a real-world scenario, you would inspect the disk image at `path`
    // to detect partitions. Here we return two dummy partitions.
    let partitions = vec![
        MBRPartitionEntry {
            boot_indicator: 0x80,
            start_chs: [0, 0, 1],
            partition_type: 0x07, // NTFS
            end_chs: [255, 254, 63],
            start_lba: 2048,
            size_sectors: 102400,
            sector_size: 512,
            first_byte_addr: 2048 * 512,
        },
        MBRPartitionEntry {
            boot_indicator: 0x00,
            start_chs: [0, 0, 1],
            partition_type: 0x83, // Linux
            end_chs: [255, 254, 63],
            start_lba: 104448,
            size_sectors: 204800,
            sector_size: 512,
            first_byte_addr: 104448 * 512,
        },
    ];
    Ok(partitions)
}

/// Attempt to read the selected partition from the disk image.
/// Here we simply simulate a successful read if the partition size is greater than 0.
#[tauri::command]
fn read_partition(partition: MBRPartitionEntry, path: String) -> Result<bool, String> {
    if partition.size_sectors > 0 {
        println!("Successfully read partition: {:?}", partition);
        Ok(true)
    } else {
        Err("Failed to read partition: partition size is zero".into())
    }
}

/// Fetch a list of extraction modules compatible with the selected partition.
/// The list returned here depends on the partition type.
#[tauri::command]
fn get_extraction_modules(partition: MBRPartitionEntry) -> Result<Vec<ExtractionModule>, String> {
    let modules = match partition.partition_type {
        0x07 => vec![
            ExtractionModule {
                id: "fs_extract".to_string(),
                name: "File System Extraction".to_string(),
                description: "Extracts file system artefacts.".to_string(),
            },
            ExtractionModule {
                id: "event_logs".to_string(),
                name: "Event Log Extraction".to_string(),
                description: "Extracts Windows event logs.".to_string(),
            },
        ],
        0x83 => vec![ExtractionModule {
            id: "linux_fs".to_string(),
            name: "Linux File System Extraction".to_string(),
            description: "Extracts Linux file system artefacts.".to_string(),
        }],
        _ => vec![ExtractionModule {
            id: "generic".to_string(),
            name: "Generic Extraction".to_string(),
            description: "Generic artefact extraction module.".to_string(),
        }],
    };
    Ok(modules)
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
            read_partition,
            get_extraction_modules
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
