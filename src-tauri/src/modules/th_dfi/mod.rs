use exhume_filesystem::filesystem::{DirectoryCommon, FileCommon};
use exhume_filesystem::{File, Filesystem};
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};

use log::{error, info};
use sqlx::sqlite::Sqlite;
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

    // crude but portable way of finding the root record:
    // ext = 2, ntfs = 5 – fall back to 0 if neither works.
    let root_id_candidates = [2u64, 5u64, 0u64];
    let root_id = root_id_candidates
        .into_iter()
        .find(|id| fs.get_file(*id).is_ok())
        .ok_or("Could not locate a valid root record")?;

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

pub async fn process_filesystem<T: Filesystem>(
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
            metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
