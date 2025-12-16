use crate::modules::utils::th_progress::{
    emit_progress_event, ProgressMessageLevel, ProgressMessageType,
};
use exhume_filesystem::File;
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use std::fs;
use tauri::AppHandle;

use regex::escape;

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

pub async fn extract_artifacts(
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
