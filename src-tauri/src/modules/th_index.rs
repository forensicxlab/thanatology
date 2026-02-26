use crate::modules::utils::th_progress::{
    emit_progress_event, ProgressMessageLevel, ProgressMessageType,
};
use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::folder_impl::FolderFS;
use exhume_filesystem::{File, Filesystem};
use log::{error, info};
use sqlx::sqlite::SqlitePool;
use sqlx::types::Json;
use std::path::PathBuf;
use tauri::AppHandle;

async fn index_filesystem<T: Filesystem>(
    fs: &mut T,
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: &SqlitePool,
) {
    info!("Starting filesystem indexation…");

    if let Err(e) = sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_files_identifier
            ON system_files(identifier);
        CREATE INDEX IF NOT EXISTS idx_files_ev_path
            ON system_files(evidence_id, absolute_path);
        "#,
    )
    .execute(pool)
    .await
    {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Could not prepare DB: {e:?}"),
            app,
        );
        error!("Could not prepare DB: {e:?}");
        return;
    }

    let mut files = Vec::<File>::new();
    let mut discovered = 0;
    
    if let Err(e) = fs.walk_fs(&mut |event| match event {
        exhume_filesystem::filesystem::WalkEvent::File(f) => {
            files.push(f);
            discovered += 1;
            if discovered % 1000 == 0 {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Info,
                    format!("Discovered {} files", discovered),
                    app,
                );
            }
        },
        exhume_filesystem::filesystem::WalkEvent::Status(msg) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                msg,
                app,
            );
        }
    }) {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Failed to walk filesystem: {e}"),
            app,
        );
        error!("Failed to walk filesystem: {e}");
        return;
    }

    //--------------------------------------------------------------
    // 2) Persist them in one transaction.
    //--------------------------------------------------------------
    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Info,
        "Ingesting files into the database…",
        app,
    );

    let total = files.len() as u64;
    let mut inserted = 0u64;

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("Could not open DB transaction: {e:?}"),
                app,
            );
            error!("Could not open DB transaction: {e:?}");

            return;
        }
    };

    let stmt = r#"
        INSERT INTO system_files (
            evidence_id,
            partition_id,
            identifier,
            absolute_path,
            name,
            ftype,
            size,
            created,
            modified,
            accessed,
            permissions,
            owner,
            "group",
            metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#;

    for f in &files {
        let created = f.created.unwrap() as i64;
        let modified = f.modified.unwrap() as i64;
        let accessed = f.accessed.unwrap() as i64;

        if let Err(e) = sqlx::query(stmt)
            .bind(evidence_id)
            .bind(partition_id)
            .bind(f.identifier as i64)
            .bind(&f.absolute_path)
            .bind(&f.name)
            .bind(&f.ftype)
            .bind(f.size as i64)
            .bind(Some(created))
            .bind(Some(modified))
            .bind(Some(accessed))
            .bind(&f.permissions)
            .bind(&f.owner)
            .bind(&f.group)
            .bind(Json(&f.metadata))
            .execute(&mut *tx)
            .await
        {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("Insert error: {e:?}"),
                app,
            );
            error!("Insert error: {e:?}");
        }

        inserted += 1;
        if inserted % 500 == 0 || inserted == total {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                format!("Indexed {inserted}/{total} items…"),
                app,
            );
        }
    }

    if let Err(e) = tx.commit().await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Commit error: {e:?}"),
            app,
        );
        error!("Commit error: {e:?}");
        return;
    }

    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Success,
        format!("Successfully ingested {total} items into the database."),
        app,
    );
}

pub async fn index_partition(
    evidence_id: i64,
    partition_id: i64,
    size_sectors: u64,
    first_byte_addr: u64,
    disk_image_path: String,
    pool: &SqlitePool,
    app: &AppHandle,
) {
    let mut body = Body::new(disk_image_path, "auto");
    let sector_size = body.get_sector_size() as u64;
    let partition_size_bytes = size_sectors * sector_size;

    let mut fs = match detect_filesystem(&mut body, first_byte_addr, partition_size_bytes) {
        Ok(fs) => fs,
        Err(err) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Could not detect the filesystem: {}", err.to_string()),
                &app,
            );
            error!("Could not detect the filesystem: {}", err.to_string());
            return;
        }
    };

    index_filesystem(&mut fs, evidence_id, partition_id, app, pool).await
}

pub async fn index_folder(
    evidence_id: i64,
    partition_id: i64,
    folder_path: String,
    pool: &SqlitePool,
    app: &AppHandle,
) {
    let path = PathBuf::from(folder_path);
    let mut fs = FolderFS::new(path);
    index_filesystem(&mut fs, evidence_id, partition_id, app, pool).await
}
