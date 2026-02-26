use crate::modules::utils::th_progress::{
    emit_progress_event, ProgressMessageLevel, ProgressMessageType,
};
use anyhow::Result;
use exhume_artefacts::parsers::ParserRegistry;
use exhume_artefacts::{ObjectParsed, Parser as ArtefactParser, ParserInput};
use exhume_filesystem::filesystem::{FileCommon, FsFileReadSeek};
use exhume_filesystem::File;
use exhume_filesystem::Filesystem;
use log::{error, info};
use regex::escape;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;
use std::fs;

use serde_json::Value;
use tauri::AppHandle;

/// Category assigned to an artifact.
///
/// Values are deserialized case-insensitively from the YAML.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    System,
    Network,
    Users,
    Media,
    Application,
}

/// One path entry in an artifact.
///
/// It can be either:
/// - a simple string: `- "/var/log/syslog"`
/// - or an object with a regexp flag:
///   - `- path: "/home/.*/.local"`
///     `  regexp: true`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArtifactPath {
    /// Simple YAML string form:
    ///   paths:
    ///     - "/var/log/syslog"
    Literal(String),

    /// Object form with flag:
    ///   paths:
    ///     - path: "/home/.*/.local"
    ///       regexp: true
    WithFlag {
        path: String,
        #[serde(default)]
        regexp: bool,
    },
}

impl ArtifactPath {
    /// Convert this path spec into a regex pattern string.
    ///
    /// - Literal or `regexp: false` → treat as exact path:
    ///     "/var/log/syslog" → "^/var/log/syslog$"
    /// - `regexp: true` → use pattern as-is:
    ///     "/home/.*/.local" → "/home/.*/.local"
    pub fn to_regex(&self) -> String {
        match self {
            ArtifactPath::Literal(p) => {
                // Exact match for literal path
                format!("^{}$", escape(p))
            }
            ArtifactPath::WithFlag { path, regexp } => {
                if *regexp {
                    // Already a regex pattern
                    path.clone()
                } else {
                    // Explicitly marked as non-regex literal
                    format!("^{}$", escape(path))
                }
            }
        }
    }
}

/// One artifact definition as it appears in the YAML file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artifact {
    /// A short, human-friendly identifier.
    pub name: String,
    /// Detailed description of what the artifact contains.
    pub description: String,
    /// Paths where the artifact could live.
    /// Items may be literal strings or regex patterns depending on `regexp`.
    pub paths: Vec<ArtifactPath>,
    /// Optional name of a parser capable of processing the artifact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parser: Option<String>,
    /// Logical tag to help group artifacts.
    pub tag: String,
    /// The functional category the artifact belongs to.
    pub category: Category,
}

/// Top-level structure expected in the YAML file (`artifacts:` ➜ list of `Artifact`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArtifactSet {
    pub artifacts: Vec<Artifact>,
}

impl ArtifactSet {
    /// Convenience helper: read YAML from a string.
    pub fn from_yaml_str(yaml: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(yaml)
    }
}

pub async fn identify_artefacts(
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: &SqlitePool,
) {
    let artifacts_path = "artifacts.yaml".to_string();

    let stmt = r#"
        INSERT INTO artifacts (
            evidence_id,
            file_id,
            partition_id,
            name,
            description,
            parser,
            tag,
            category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    "#;

    let yaml_text = fs::read_to_string(&artifacts_path).unwrap();
    let artifact_set: ArtifactSet = ArtifactSet::from_yaml_str(&yaml_text).unwrap();
    info!("Loaded {} artifact(s):", artifact_set.artifacts.len());

    // Make identify pass idempotent for this partition.
    if let Err(err) = sqlx::query(
        r#"
        DELETE FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?;
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .execute(pool)
    .await
    {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Failed to clear existing parsed artefacts: {err}"),
            app,
        );
        error!("Failed to clear existing parsed artefacts: {err}");
        return;
    }

    if let Err(err) = sqlx::query(
        r#"
        DELETE FROM artifacts
        WHERE evidence_id = ?
          AND partition_id = ?;
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .execute(pool)
    .await
    {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Error,
            format!("Failed to clear existing artefacts: {err}"),
            app,
        );
        error!("Failed to clear existing artefacts: {err}");
        return;
    }

    for artifact in &artifact_set.artifacts {
        for path_spec in &artifact.paths {
            // Build the final regex pattern for this path entry
            let pattern = path_spec.to_regex();

            let au_file_paths: Vec<File> = match sqlx::query_as::<_, File>(
                "SELECT * FROM system_files \
                     WHERE absolute_path REGEXP ?1 \
                     AND evidence_id = ?2 \
                     AND partition_id = ?3;",
            )
            .bind(&pattern)
            .bind(evidence_id)
            .bind(partition_id)
            .fetch_all(pool)
            .await
            {
                Ok(files) => files,
                Err(e) => {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!(
                            "Failed to query database for artifact '{}': {e}",
                            artifact.name
                        ),
                        app,
                    );
                    error!(
                        "Failed to query database for artifact '{}': {e}",
                        artifact.name
                    );
                    continue;
                }
            };

            for file in au_file_paths {
                info!("Found file: {}", file.absolute_path);
                if let Err(err) = sqlx::query(stmt)
                    .bind(evidence_id)
                    .bind(file.id)
                    .bind(partition_id)
                    .bind(&artifact.name)
                    .bind(&artifact.description)
                    .bind(&artifact.parser)
                    .bind(&artifact.tag)
                    .bind(format!("{:?}", &artifact.category))
                    .execute(pool)
                    .await
                {
                    emit_progress_event(
                        &evidence_id,
                        ProgressMessageLevel::Main,
                        ProgressMessageType::Error,
                        format!("Artifact insertion error: {err:?}"),
                        app,
                    );
                    error!("Artifact insertion error: {err:?}");
                }
            }
        }
    }
}

/// Synchronously run one parser against one filesystem record, using streaming Read+Seek.
fn extract_artefact<F: Filesystem>(
    fs: &mut F,
    parser: &dyn ArtefactParser,
    fs_identifier: u64,
    absolute_path: &str,
) -> Result<Vec<ObjectParsed>>
where
    F::FileType: FileCommon,
{
    // Fetch FS record
    let record = match fs.get_file(fs_identifier) {
        Ok(r) => r,
        Err(_) => {
            // Fallback: try to get by path if ID lookup failed (e.g. empty FolderFS cache)
            fs.get_file_by_path(absolute_path, fs_identifier)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
        }
    };

    // Adapter: Read+Seek backed by Filesystem::read_file_slice
    let rs = FsFileReadSeek::new(fs, record);

    // Collect parsed objects
    let mut out: Vec<ObjectParsed> = Vec::new();
    let mut sink = |obj: ObjectParsed| -> Result<()> {
        out.push(obj);
        Ok(())
    };

    parser.run_into(ParserInput::ReadSeek(Box::new(rs)), &mut sink)?;
    Ok(out)
}

/// Extract artefacts for a partition by running registered parsers against the matched files.
///
/// This is called from your `process_partitions` flow:
///   identify_artefacts(..)
///   extract_artefacts(.., &mut fs, &registry).await
pub async fn extract_artefacts<F: Filesystem>(
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: &SqlitePool,
    fs: &mut F,
    registry: &ParserRegistry,
) where
    F::FileType: FileCommon,
{
    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Info,
        "Starting artefact extraction…".to_string(),
        app,
    );

    // Pull artefacts that specify a parser, joined to system_files to recover the FS identifier.
    let rows = match sqlx::query(
        r#"
        SELECT
            a.id            AS artifact_id,
            a.file_id       AS file_id,
            a.parser        AS parser_name,
            sf.identifier   AS fs_identifier,
            sf.absolute_path AS absolute_path
        FROM artifacts a
        JOIN system_files sf
          ON sf.id = a.file_id
        WHERE a.evidence_id  = ?
          AND a.partition_id = ?
          AND a.parser IS NOT NULL
          AND TRIM(a.parser) <> ''
        ORDER BY a.id;
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("Failed to list artefacts to extract: {e:?}"),
                app,
            );
            error!("extract_artefacts list error: {e:?}");
            return;
        }
    };

    if rows.is_empty() {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Success,
            "No artefacts with a parser to extract.".to_string(),
            app,
        );
        return;
    }

    let total = rows.len() as u64;

    // Write parsed objects in one transaction for this partition.
    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("Could not open DB transaction for extraction: {e:?}"),
                app,
            );
            return;
        }
    };

    let mut processed_files = 0u64;
    let mut emitted_objects = 0u64;

    for row in rows {
        processed_files += 1;

        let artifact_id: i64 = row.get("artifact_id");
        let file_id: Option<i64> = row.get("file_id");
        let parser_name: String = row.get("parser_name");
        let fs_identifier_i64: i64 = row.get("fs_identifier");
        let abs_path: String = row.get("absolute_path");

        let Some(parser) = registry.get(parser_name.as_str()) else {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!(
                    "Artefact '{}' references unknown parser '{}' (file: {})",
                    artifact_id, parser_name, abs_path
                ),
                app,
            );
            continue;
        };

        let objs = match extract_artefact(fs, &**parser, fs_identifier_i64 as u64, &abs_path) {
            Ok(v) => v,
            Err(e) => {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Error,
                    format!(
                        "Extraction failed (parser={}, file={}): {e:?}",
                        parser_name, abs_path
                    ),
                    app,
                );
                error!("Extraction failed parser={parser_name} file={abs_path}: {e:?}");
                continue;
            }
        };

        for obj in objs {
            emitted_objects += 1;

            // Store the parsed object
            if let Err(e) = sqlx::query(
                r#"
                INSERT INTO artifact_objects (
                    evidence_id,
                    partition_id,
                    artifact_id,
                    file_id,
                    parser,
                    kind,
                    text,
                    json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(evidence_id)
            .bind(partition_id)
            .bind(artifact_id)
            .bind(file_id)
            .bind(obj.parser)
            .bind(obj.kind)
            .bind(obj.text)
            .bind(obj.json.to_string())
            .execute(&mut *tx)
            .await
            {
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Module,
                    ProgressMessageType::Error,
                    format!("DB insert error for parsed object: {e:?}"),
                    app,
                );
                error!("DB insert error for parsed object: {e:?}");
            }
        }

        if processed_files % 50 == 0 || processed_files == total {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Info,
                format!(
                    "Artefact extraction: {processed_files}/{total} files, {emitted_objects} objects emitted…"
                ),
                app,
            );
        }
    }

    if let Err(e) = tx.commit().await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Extraction commit error: {e:?}"),
            app,
        );
        return;
    }

    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Success,
        format!(
            "Artefact extraction done: processed {total} files, emitted {emitted_objects} objects."
        ),
        app,
    );

    info!(
        "Artefact extraction done evidence_id={evidence_id} partition_id={partition_id}: \
         processed={total} emitted={emitted_objects}"
    );
}

#[tauri::command]
pub async fn parse_pe(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<Value, String> {
    info!("Fetching PE for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT json
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pe'
        ORDER BY id DESC
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = row {
        info!("Found PE data for file_id {}", file_id);
        let json_str: String = row.get("json");
        let json_val: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(json_val)
    } else {
        info!("No PE data found for file_id {}", file_id);
        Err("No PE data found for this file".to_string())
    }
}

#[tauri::command]
pub async fn has_pml_data(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<bool, String> {
    info!("Checking PML for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT 1
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.is_some())
}

#[tauri::command]
pub async fn has_evtx_data(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<bool, String> {
    info!("Checking EVTX for evidence={evidence_id} partition={partition_id} file={file_id}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT 1
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_evtx'
        LIMIT 1
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.is_some())
}

#[tauri::command]
pub async fn get_pml_events_count(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
) -> Result<i64, String> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let row = sqlx::query(
        r#"
        SELECT COUNT(*) as count
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.get("count"))
}

#[tauri::command]
pub async fn get_pml_events(
    db_path: String,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
    offset: i64,
    limit: i64,
) -> Result<Vec<Value>, String> {
    info!("Fetching PML slice for evidence={evidence_id} partition={partition_id} file={file_id} offset={offset} limit={limit}");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_path)
        .await
        .map_err(|e| format!("DB connection error: {e}"))?;

    let rows = sqlx::query(
        r#"
        SELECT json
        FROM artifact_objects
        WHERE evidence_id = ?
          AND partition_id = ?
          AND file_id = ?
          AND parser = 'windows_pml'
        ORDER BY id ASC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(evidence_id)
    .bind(partition_id)
    .bind(file_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let json_str: String = row.get("json");
        // Deserialize each row's JSON string into a Value
        let json_val: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        results.push(json_val);
    }

    Ok(results)
}
