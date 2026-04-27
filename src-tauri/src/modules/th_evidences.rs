use serde::Deserialize;
use sqlx::SqlitePool;

#[derive(Debug, Deserialize)]
pub struct CaseInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub collaborator_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EvidenceInput {
    pub name: String,
    pub r#type: String, // 'type' is a Rust keyword
    pub path: String,
    pub description: String,
    #[serde(default)]
    pub images: Vec<EvidenceImageInput>,
}

#[derive(Debug, Deserialize)]
pub struct EvidenceImageInput {
    pub caption: String,
    pub file_name: String,
    pub mime_type: String,
    pub source_kind: String,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn create_case_with_evidence(
    case: CaseInput,
    evidences: Vec<EvidenceInput>,
    db_path: String,
) -> Result<i64, String> {
    let pool = SqlitePool::connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    // Begin transaction
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    // Insert case
    sqlx::query("INSERT INTO cases (name, description) VALUES (?, ?);")
        .bind(&case.name)
        .bind(&case.description)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert case error: {e}"))?;

    // Get generated id (SQLite-friendly, works widely)
    let rec = sqlx::query_as::<_, (i64,)>("SELECT last_insert_rowid();")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("last_insert_rowid error: {e}"))?;
    let case_id = rec.0;

    // Collaborators (idempotent)
    for uid in case.collaborator_ids.iter() {
        sqlx::query("INSERT OR IGNORE INTO case_collaborators (case_id, user_id) VALUES (?, ?);")
            .bind(case_id)
            .bind(uid)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert collaborator error: {e}"))?;
    }

    // Evidences
    for ev in evidences.iter() {
        sqlx::query(
            "INSERT INTO evidence (case_id, name, type, path, description)
             VALUES (?, ?, ?, ?, ?);",
        )
        .bind(case_id)
        .bind(&ev.name)
        .bind(&ev.r#type)
        .bind(&ev.path)
        .bind(&ev.description)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert evidence error: {e}"))?;

        let evidence_rec = sqlx::query_as::<_, (i64,)>("SELECT last_insert_rowid();")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("last_insert_rowid error: {e}"))?;
        let evidence_id = evidence_rec.0;

        for image in ev.images.iter() {
            let caption = image.caption.trim();
            if caption.is_empty() {
                return Err("Each evidence image requires a caption.".to_string());
            }

            sqlx::query(
                "INSERT INTO evidence_images (
                    evidence_id,
                    caption,
                    file_name,
                    mime_type,
                    source_kind,
                    data
                 ) VALUES (?, ?, ?, ?, ?, ?);",
            )
            .bind(evidence_id)
            .bind(caption)
            .bind(&image.file_name)
            .bind(&image.mime_type)
            .bind(&image.source_kind)
            .bind(&image.bytes)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert evidence image error: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit error: {e}"))?;
    Ok(case_id)
}
