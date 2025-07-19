use exhume_filesystem::File;
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use futures::TryStreamExt;
use log::{error, info};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, Pool, Sqlite};
use std::fs;
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

/// One artifact definition as it appears in the YAML file.
///
/// ```yaml
/// name: "System Logs"
/// description: "System log files containing syslog messages"
/// paths:
///   - "/var/log/syslog"
///   - "/var/log/messages"
/// parser: "syslog"
/// tag: "logs"
/// category: "system"
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artifact {
    /// A short, human-friendly identifier.
    pub name: String,
    /// Detailed description of what the artifact contains.
    pub description: String,
    /// Paths where the artifact could live.  Items may include regular
    /// expressions.
    pub paths: Vec<String>,
    /// Optional name of a parser capable of processing the artifact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parser: Option<String>,
    /// Logical tag to help group artifacts.
    pub tag: String,
    /// The functional category the artifact belongs to.
    pub category: Category,
}

/// Top-level structure expected in the YAML file
/// (`artifacts:` ➜ list of `Artifact`).
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

#[tauri::command]
pub async fn process_artifacts(evidence_id: i64, db_path: String, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Connect to the SQLite database.
        info!("{}", db_path);
        if db_path.is_empty() {
            info!("NO DB !");
        }
        let db = match SqlitePool::connect(&db_path).await {
            Ok(db) => {
                info!("DB Connection success");
                db
            }
            Err(err) => {
                error!("Could not connect to DB");
                emit_progress_event(
                    &evidence_id,
                    ProgressMessageLevel::Main,
                    ProgressMessageType::Error,
                    format!("DB connection error: {err:?}"),
                    &app,
                );
                return;
            }
        };

        let artifacts_path = std::env::args()
            .nth(1)
            .unwrap_or_else(|| "artifacts.yaml".to_string());

        let yaml_text = fs::read_to_string(&artifacts_path).unwrap();
        let artifact_set: ArtifactSet = ArtifactSet::from_yaml_str(&yaml_text).unwrap();
        info!("Loaded {} artifact(s):\n", artifact_set.artifacts.len());

        for artifact in &artifact_set.artifacts {
            for path in &artifact.paths {
                let au_file_paths: Vec<File> = sqlx::query_as::<_, File>(
                    "SELECT * FROM system_files WHERE absolute_path = ?;",
                )
                .bind(path)
                .fetch_all(&db)
                .await
                .map_err(|e| format!("Failed to query database: {}", e))
                .unwrap();

                for file in au_file_paths {
                    info!("Found file: {:?}", file);
                }
            }
        }
    });
}

// #[tauri::command]
// async fn get_files(state: tauri::State<'_, AppState>) -> Result<Vec<Todo>, String> {
//     let db = &state.db;

//     let todos: Vec<Todo> = sqlx::query_as::<_, Todo>("SELECT * FROM todos")
//         .fetch(db)
//         .try_collect()
//         .await
//         .map_err(|e| format!("Failed to get todos {}", e))?;

//     Ok(todos)
// }
