//! file_identifier.rs  – rev 3 (bind-friendly)
//!
//! Reads each regular file’s prefix with `read_file_prefix`, detects its
//! format through the `file_type` crate, and stores the result in three
//! dedicated DB columns (`sig_name`, `sig_mime`, `sig_exts`).
//!
//! ─────────────────────────────────────────────────────────────────────────
//!   ALTER TABLE system_files
//!     ADD COLUMN sig_name TEXT,
//!     ADD COLUMN sig_mime TEXT,
//!     ADD COLUMN sig_exts TEXT;
//!   CREATE INDEX IF NOT EXISTS idx_files_sig_mime ON system_files(sig_mime);
//! ─────────────────────────────────────────────────────────────────────────

use exhume_filesystem::filesystem::{DirectoryCommon, FileCommon};
use exhume_filesystem::Filesystem;
use file_type::FileType;
use log::{error, info};
use sqlx::{Pool, Row, Sqlite};
use tauri::AppHandle;

use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};

const SAMPLE_LEN: usize = 8192; // 8 KiB of magic bytes

pub async fn identify_file_types<T: Filesystem>(
    fs: &mut T,
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: Pool<Sqlite>,
) where
    T::DirectoryType: DirectoryCommon,
{
    info!("Starting file-signature identification…");

    //--------------------------------------------------------------
    // 1) Pull identifiers of every regular, non-empty file.
    //--------------------------------------------------------------
    let rows = match sqlx::query(
        r#"
        SELECT identifier
        FROM   system_files
        WHERE  evidence_id  = ?
          AND  partition_id = ?
          AND  size        > 0
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("Could not list files for signature pass: {e:?}"),
                app,
            );
            return;
        }
    };

    let total = rows.len() as u64;
    if total == 0 {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Success,
            "No regular file to analyse (skipping file-type module).",
            app,
        );
        return;
    }

    //--------------------------------------------------------------
    // 2) Bulk update in a single transaction.
    //--------------------------------------------------------------
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

    //--------------------------------------------------------------
    // 3) For every file: read prefix → detect → UPDATE … .bind().
    //--------------------------------------------------------------
    let mut processed = 0u64;

    for row in rows {
        let record_id = row.get::<i64, _>("identifier") as u64;

        // FS record
        let record = match fs.get_file(record_id) {
            Ok(rec) => rec,
            Err(e) => {
                error!("get_file error id={record_id}: {e}");
                continue;
            }
        };

        // Efficient prefix read
        let prefix = match fs.read_file_prefix(&record, SAMPLE_LEN) {
            Ok(v) => v,
            Err(e) => {
                error!("read_file_prefix error id={record_id}: {e}");
                continue;
            }
        };

        // Signature → UPDATE
        if let ft = FileType::from_bytes(&prefix) {
            //info!("Found file type: {}", ft.name());
            if let Err(e) = sqlx::query(
                r#"
                UPDATE system_files
                   SET sig_name = ?,
                       sig_mime = ?,
                       sig_exts = ?
                 WHERE evidence_id  = ?
                   AND partition_id = ?
                   AND identifier   = ?
                "#,
            )
            .bind(ft.name())
            .bind(ft.media_types().join(","))
            .bind(ft.extensions().join(","))
            .bind(evidence_id)
            .bind(partition_id)
            .bind(record_id as i64)
            .execute(&mut *tx)
            .await
            {
                error!("DB update error id={record_id}: {e:?}");
            }
        }

        processed += 1;
        if processed % 500 == 0 || processed == total {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                format!("Signature analysed for {processed}/{total} files…"),
                app,
            );
        }
    }

    //--------------------------------------------------------------
    // 4) Commit.
    //--------------------------------------------------------------
    if let Err(e) = tx.commit().await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Signature-pass commit error: {e:?}"),
            app,
        );
        return;
    }

    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Success,
        format!("File-signature identification done for {total} files."),
        app,
    );
}
