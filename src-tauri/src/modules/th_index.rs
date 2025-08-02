use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::filesystem::{DirectoryCommon, FileCommon};
use exhume_filesystem::{File, Filesystem};
use exhume_partitions::mbr::MBRPartitionEntry;
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use log::{error, info};
use sqlx::sqlite::Sqlite;
use sqlx::sqlite::SqlitePool;
use sqlx::types::Json;
use sqlx::Pool;
use std::collections::{HashSet, VecDeque};
use tauri::AppHandle;

fn collect_files<T: Filesystem>(
    fs: &mut T,
    app: &AppHandle,
    evidence_id: &i64,
) -> Result<Vec<File>, Box<dyn std::error::Error>>
where
    T::DirectoryType: DirectoryCommon,
{
    let mut files = Vec::<File>::new();
    let mut seen: HashSet<u64> = HashSet::new();
    let mut queue: VecDeque<(u64, String)> = VecDeque::new();

    let root_id = fs.get_root_file_id();

    queue.push_back((root_id, "/".to_owned()));

    while let Some((record_id, path)) = queue.pop_front() {
        if !seen.insert(record_id) {
            continue;
        }

        let record = fs.get_file(record_id)?;
        let file_obj = fs.record_to_file(&record, record_id, &path);
        files.push(file_obj.clone());

        emit_progress_event(
            evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Info,
            format!("Discovered {} files", files.len()),
            app,
        );

        if record.is_dir() {
            for entry in fs.list_dir(&record)? {
                let child_id = entry.file_id();
                let child_path = if path == "/" {
                    format!("/{}", entry.name())
                } else {
                    format!("{}/{}", path, entry.name())
                };
                queue.push_back((child_id, child_path));
            }
        }
    }

    Ok(files)
}

async fn index_filesystem<T: Filesystem>(
    fs: &mut T,
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: Pool<Sqlite>,
) where
    T::DirectoryType: DirectoryCommon,
{
    info!("Starting filesystem indexation…");

    if let Err(e) = sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_files_identifier
            ON system_files(identifier);
        CREATE INDEX IF NOT EXISTS idx_files_ev_path
            ON system_files(evidence_id, absolute_path);
        "#,
    )
    .execute(&pool)
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

    //--------------------------------------------------------------
    // 1) Walk the filesystem and gather every File struct.
    //--------------------------------------------------------------
    let files = match collect_files(fs, app, &evidence_id) {
        Ok(v) => v,
        Err(e) => {
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
    };

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
        if let Err(e) = sqlx::query(stmt)
            .bind(evidence_id)
            .bind(partition_id)
            .bind(f.identifier as i64)
            .bind(&f.absolute_path)
            .bind(&f.name)
            .bind(&f.ftype)
            .bind(f.size as i64)
            .bind(Some(f.created).unwrap())
            .bind(Some(f.modified).unwrap())
            .bind(Some(f.accessed).unwrap())
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
    partition: MBRPartitionEntry,
    disk_image_path: String,
    pool: SqlitePool,
    app: &AppHandle,
) {
    let mut body = Body::new(disk_image_path, "auto");
    let sector_size = body.get_sector_size();
    let partition_size_bytes = partition.size_sectors as u64 * sector_size as u64;

    let mut fs = match detect_filesystem(
        &mut body,
        partition.first_byte_addr as u64,
        partition_size_bytes,
    ) {
        Ok(fs) => fs,
        Err(err) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Main,
                ProgressMessageType::Error,
                format!("Could not detect the filesystem: {}", err.to_string()),
                &app,
            );
            return;
        }
    };

    index_filesystem(&mut fs, evidence_id, partition.id.unwrap(), app, pool).await
}
