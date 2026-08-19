use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Deserialize)]
pub struct ExtractFileArgs {
    pub file_id: u64,
    pub partition_id: i64,
}

#[derive(Serialize, Debug, Error)]
#[error("ExtractFileError: {message}")]
pub struct ExtractFileError {
    pub message: String,
}

use exhume_body::Body;
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::filesystem::Filesystem;

/// A tool to extract a file or read its metadata using the natively linked exhume crates.
pub struct ExhumeExtractionTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub app: tauri::AppHandle,
    pub evidence_id: i64,
}

impl ExhumeExtractionTool {
    pub fn new(evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Self {
        Self {
            evidence_pool,
            app,
            evidence_id,
        }
    }
}

impl Tool for ExhumeExtractionTool {
    const NAME: &'static str = "extract_file_content";

    type Args = ExtractFileArgs;
    type Output = String;
    type Error = ExtractFileError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Extracts the textual content or metadata structure of a specific file from the disk image using Exhume.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "integer",
                        "description": "The filesystem identifier integer of the file on the partition. (Retrieved from system_files.identifier)"
                    },
                    "partition_id": {
                        "type": "integer",
                        "description": "The ID of the partition containing the file."
                    }
                },
                "required": ["file_id", "partition_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        use crate::modules::utils::th_progress::{
            ProgressMessageLevel, ProgressMessageType, emit_progress_event,
        };
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::AgentToolCall,
            format!("Extracting file content (id: {})", args.file_id),
            &self.app,
        );

        use sqlx::Row;

        let evidence_row = sqlx::query("SELECT type, path FROM evidence WHERE id = ? LIMIT 1")
            .bind(self.evidence_id)
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|e| ExtractFileError {
                message: format!("Failed to read evidence metadata: {}", e),
            })?;

        let ev_type: String = evidence_row.try_get("type").unwrap_or_default();
        let ev_path: String = evidence_row.try_get("path").unwrap_or_default();

        if ev_type == "Folder" {
            let file_row = sqlx::query("SELECT absolute_path FROM system_files WHERE identifier = ? AND partition_id = ? LIMIT 1")
                .bind(args.file_id as i64)
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool)
                .await
                .map_err(|_| ExtractFileError { message: format!("Could not find absolute_path in DB for file_id {}", args.file_id) })?;
            let absolute_path: String = file_row.try_get("absolute_path").unwrap_or_default();

            let full_path =
                std::path::Path::new(&ev_path).join(absolute_path.trim_start_matches('/'));
            let content = std::fs::read(&full_path).map_err(|e| ExtractFileError {
                message: format!("Local FS Error reading {:?}: {}", full_path, e.to_string()),
            })?;
            let text = String::from_utf8_lossy(&content).to_string();
            return Ok(text.chars().take(50_000).collect()); // Cap output to 50k chars
        }

        // It's a Disk Image (EWF, RAW, etc.)
        // Determine partition bounds
        let mut first_byte_addr: Option<u64> = None;
        let mut size_bytes: Option<u64> = None;

        let mut body = Body::new(ev_path.clone(), "auto");
        let sector_size = body.get_sector_size() as u64;

        if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors, sector_size, size_bytes FROM partitions WHERE id = ?")
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool).await {
            first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
            size_bytes = Some(
                row.try_get::<i64, _>("size_bytes").unwrap_or_else(|_| {
                    let size_sectors = row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64;
                    let partition_sector_size = row.try_get::<i64, _>("sector_size").unwrap_or(sector_size as i64) as u64;
                    size_sectors.saturating_mul(partition_sector_size) as i64
                }) as u64,
            );
        }

        if first_byte_addr.is_none() || size_bytes.is_none() {
            return Err(ExtractFileError {
                message: format!("Partition ID {} not found", args.partition_id),
            });
        }

        let mut fs = detect_filesystem(
            &mut body,
            first_byte_addr.unwrap(),
            size_bytes.unwrap(),
            None,
        )
        .map_err(|e| ExtractFileError {
            message: format!("Filesystem detection failed: {}", e),
        })?;

        let file = fs.get_file(args.file_id).map_err(|e| ExtractFileError {
            message: format!("File lookup failed for id {}: {}", args.file_id, e),
        })?;

        let content = fs.read_file_content(&file).map_err(|e| ExtractFileError {
            message: format!("Failed to read file bytes: {}", e),
        })?;

        let text = String::from_utf8_lossy(&content).to_string();
        Ok(text.chars().take(50_000).collect())
    }
}

#[derive(Deserialize)]
pub struct QuerySystemFilesArgs {
    pub query: String,
}

#[derive(Serialize, Debug, Error)]
#[error("QueryError: {message}")]
pub struct QueryError {
    pub message: String,
}

/// A tool allowing the LLM to query the evidence SQLite database.
pub struct QuerySystemFilesTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub app: tauri::AppHandle,
    pub evidence_id: i64,
}

impl QuerySystemFilesTool {
    pub fn new(evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Self {
        Self {
            evidence_pool,
            app,
            evidence_id,
        }
    }
}

impl Tool for QuerySystemFilesTool {
    const NAME: &'static str = "query_system_files";

    type Args = QuerySystemFilesArgs;
    type Output = String;
    type Error = QueryError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Execute a read-only SQLite query against the evidence database. Primary portable tables are: system_files, partitions, artifacts, artifact_objects. Example: SELECT identifier, absolute_path, partition_id FROM system_files WHERE LOWER(name) LIKE '%.exe' LIMIT 10".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The exact SQLite query to execute. MUST be a SELECT statement."
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        use crate::modules::utils::th_progress::{
            ProgressMessageLevel, ProgressMessageType, emit_progress_event,
        };
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::AgentToolCall,
            format!("Executing SQL query: {}", args.query),
            &self.app,
        );

        let query = exhume_agent::tools::query_index::validate_read_query(&args.query)
            .map_err(|message| QueryError { message })?;

        use futures::TryStreamExt;
        use sqlx::{Column, Row, TypeInfo};
        let mut stream = sqlx::query(&query).fetch(&self.evidence_pool);
        let mut rows = Vec::with_capacity(201);
        while rows.len() < 201 {
            match stream.try_next().await {
                Ok(Some(row)) => rows.push(row),
                Ok(None) => break,
                Err(e) => {
                    return Err(QueryError {
                        message: e.to_string(),
                    });
                }
            }
        }
        let truncated = rows.len() > 200;
        rows.truncate(200);

        let mut results = Vec::new();
        for row in rows {
            let mut obj = serde_json::Map::new();
            for col in row.columns() {
                let name = col.name();
                let ty = col.type_info().name();
                let value = match ty {
                    "TEXT" | "VARCHAR" => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(
                            val.map(|value| value.chars().take(2_000).collect::<String>())
                        )
                    }
                    "INTEGER" | "BIGINT" => {
                        let val: Option<i64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    "REAL" | "FLOAT" => {
                        let val: Option<f64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    "BOOLEAN" => {
                        let val: Option<bool> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    _ => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                };
                obj.insert(name.to_string(), value);
            }
            results.push(serde_json::Value::Object(obj));
        }

        Ok(serde_json::json!({
            "rows": results,
            "truncated": truncated,
        })
        .to_string())
    }
}

pub struct AnalyzeImageTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub app: tauri::AppHandle,
    pub evidence_id: i64,
    pub api_key: String,
    pub provider: String,
    pub endpoint: String,
}

impl AnalyzeImageTool {
    pub fn new(
        evidence_pool: sqlx::SqlitePool,
        app: tauri::AppHandle,
        evidence_id: i64,
        api_key: String,
        provider: String,
        endpoint: String,
    ) -> Self {
        Self {
            evidence_pool,
            app,
            evidence_id,
            api_key,
            provider,
            endpoint,
        }
    }
}

impl Tool for AnalyzeImageTool {
    const NAME: &'static str = "analyze_image_content";

    type Args = ExtractFileArgs;
    type Output = String;
    type Error = ExtractFileError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Extracts an image file (.jpg, .png, etc.) from the disk and uses a Vision AI model to analyze and describe it in extreme detail.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "integer",
                        "description": "The filesystem identifier integer of the image file. (Retrieved from system_files.identifier)"
                    },
                    "partition_id": {
                        "type": "integer",
                        "description": "The ID of the partition containing the image file."
                    }
                },
                "required": ["file_id", "partition_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        use crate::modules::utils::th_progress::{
            ProgressMessageLevel, ProgressMessageType, emit_progress_event,
        };
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::AgentToolCall,
            format!("Analyzing image content (id: {})", args.file_id),
            &self.app,
        );

        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
        use rig::client::CompletionClient;
        use rig::completion::Prompt;
        use rig::providers::openai;
        use sqlx::Row;

        let evidence_row = sqlx::query("SELECT type, path FROM evidence WHERE id = ? LIMIT 1")
            .bind(self.evidence_id)
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|e| ExtractFileError {
                message: format!("Failed to read evidence metadata: {}", e),
            })?;

        let ev_type: String = evidence_row.try_get("type").unwrap_or_default();
        let ev_path: String = evidence_row.try_get("path").unwrap_or_default();

        let content: Vec<u8>;
        let mut mime_type = "image/jpeg".to_string();

        // Also fetch file extension from system_files to set correct mime type
        if let Ok(file_row) = sqlx::query("SELECT absolute_path FROM system_files WHERE identifier = ? AND partition_id = ? LIMIT 1")
            .bind(args.file_id as i64)
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool).await {
                
            let path: String = file_row.try_get("absolute_path").unwrap_or_default();
            let ext = std::path::Path::new(&path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            match ext.as_str() {
                "png" => mime_type = "image/png".to_string(),
                "gif" => mime_type = "image/gif".to_string(),
                "webp" => mime_type = "image/webp".to_string(),
                _ => mime_type = "image/jpeg".to_string(),
            }
        }

        if ev_type == "Folder" {
            let file_row = sqlx::query("SELECT absolute_path FROM system_files WHERE identifier = ? AND partition_id = ? LIMIT 1")
                .bind(args.file_id as i64)
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool)
                .await
                .map_err(|_| ExtractFileError { message: format!("Could not find absolute_path in DB for file_id {}", args.file_id) })?;
            let absolute_path: String = file_row.try_get("absolute_path").unwrap_or_default();

            let full_path =
                std::path::Path::new(&ev_path).join(absolute_path.trim_start_matches('/'));
            content = std::fs::read(&full_path).map_err(|e| ExtractFileError {
                message: format!("Local FS Error reading {:?}: {}", full_path, e.to_string()),
            })?;
        } else {
            // It's a Disk Image
            let mut first_byte_addr: Option<u64> = None;
            let mut size_bytes: Option<u64> = None;

            let mut body = Body::new(ev_path.clone(), "auto");
            let sector_size = body.get_sector_size() as u64;

            if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors, sector_size, size_bytes FROM partitions WHERE id = ?")
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool).await {
                first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
                size_bytes = Some(
                    row.try_get::<i64, _>("size_bytes").unwrap_or_else(|_| {
                        let size_sectors = row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64;
                        let partition_sector_size = row.try_get::<i64, _>("sector_size").unwrap_or(sector_size as i64) as u64;
                        size_sectors.saturating_mul(partition_sector_size) as i64
                    }) as u64,
                );
            }

            if first_byte_addr.is_none() || size_bytes.is_none() {
                return Err(ExtractFileError {
                    message: format!("Partition ID {} not found", args.partition_id),
                });
            }

            let mut fs = detect_filesystem(
                &mut body,
                first_byte_addr.unwrap(),
                size_bytes.unwrap(),
                None,
            )
            .map_err(|e| ExtractFileError {
                message: format!("Filesystem detection failed: {}", e),
            })?;

            let file = fs.get_file(args.file_id).map_err(|e| ExtractFileError {
                message: format!("File lookup failed for id {}: {}", args.file_id, e),
            })?;

            content = fs.read_file_content(&file).map_err(|e| ExtractFileError {
                message: format!("Failed to read file bytes: {}", e),
            })?;
        }

        // Limit huge images to avoid memory blowout (e.g., max 20MB)
        if content.len() > 20_000_000 {
            return Err(ExtractFileError {
                message: "Image file is too large to process visually (>20MB).".to_string(),
            });
        }

        let base64_data = BASE64.encode(&content);

        if self.provider == "copilot" {
            // Route to the local dfi-copilot image2text service
            let base_url = self.endpoint.trim_end_matches('/');
            let url = format!("{}:8001/v1/describe", base_url);
            let http = reqwest::Client::new();
            let body = serde_json::json!({
                "image_base64": base64_data,
                "prompt": "You are a forensic image analyst. Describe this image in granular technical detail. Note any visible text (OCR), objects, people, documents, weapons, suspicious items, environment details, and anomalies."
            });
            let resp = http
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| ExtractFileError {
                    message: format!("copilot image2text request failed: {}", e),
                })?;
            if !resp.status().is_success() {
                return Err(ExtractFileError {
                    message: format!("copilot image2text returned HTTP {}", resp.status()),
                });
            }
            let json: serde_json::Value = resp.json().await.map_err(|e| ExtractFileError {
                message: format!("copilot image2text response parse error: {}", e),
            })?;
            let description = json
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            return Ok(description);
        }

        // OpenAI gpt-4o vision path
        let data_uri = format!("data:{};base64,{}", mime_type, base64_data);

        if self.api_key.is_empty() {
            return Err(ExtractFileError {
                message: "OpenAI API Key is missing. Vision model requires a valid OpenAI Key."
                    .to_string(),
            });
        }

        let oai_client: openai::Client =
            openai::Client::new(&self.api_key).map_err(|e| ExtractFileError {
                message: format!("Failed to initialize OAI client: {}", e),
            })?;
        let sub_agent = oai_client
            .agent("gpt-4o")
            .preamble("You are a forensic image analyst. Describe this image in granular technical detail. Note file types, texts visible via OCR, objects, metadata if rendered, environment details, and anomalies.")
            .build();

        let image_message = rig::completion::Message::User {
            content: rig::one_or_many::OneOrMany::many(vec![
                rig::completion::message::UserContent::text(
                    "Please analyze this evidence image visually.",
                ),
                rig::completion::message::UserContent::image_url(data_uri, None, None),
            ])
            .unwrap(),
        };

        match sub_agent.prompt(image_message).await {
            Ok(desc) => Ok(desc),
            Err(e) => Err(ExtractFileError {
                message: format!("Vision Analysis failed: {}", e),
            }),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// Query Parsed Artifacts Tool
// -------------------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct QueryParsedArtifactsArgs {
    pub file_id: u64,
    pub partition_id: i64,
}

#[derive(Serialize, Debug, Error)]
#[error("QueryParsedArtifactsError: {message}")]
pub struct QueryParsedArtifactsError {
    pub message: String,
}

/// A tool to check if a specific system file has been successfully parsed by Thanatology's plugins.
pub struct QueryParsedArtifactsTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub app: tauri::AppHandle,
    pub evidence_id: i64,
}

impl QueryParsedArtifactsTool {
    pub fn new(evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Self {
        Self {
            evidence_pool,
            app,
            evidence_id,
        }
    }
}

impl Tool for QueryParsedArtifactsTool {
    const NAME: &'static str = "query_parsed_artifacts";

    type Args = QueryParsedArtifactsArgs;
    type Output = String;
    type Error = QueryParsedArtifactsError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Check if a file (like Windows Registry, EVTX, Prefetch) has been specifically parsed into JSON artifacts. ALWAYS use this BEFORE extract_file_content for binary OS artifacts.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "integer",
                        "description": "The filesystem identifier integer of the file."
                    },
                    "partition_id": {
                        "type": "integer",
                        "description": "The ID of the partition containing the file."
                    }
                },
                "required": ["file_id", "partition_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        use crate::modules::utils::th_progress::{
            ProgressMessageLevel, ProgressMessageType, emit_progress_event,
        };
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::AgentToolCall,
            format!("Checking parsed artifacts for file_id: {}", args.file_id),
            &self.app,
        );

        use sqlx::Row;

        let rows = sqlx::query(
            "SELECT ao.json 
             FROM artifact_objects ao 
             JOIN system_files sf ON ao.file_id = sf.id 
             WHERE sf.identifier = ? AND ao.partition_id = ?
             LIMIT 200",
        )
        .bind(args.file_id as i64)
        .bind(args.partition_id)
        .fetch_all(&self.evidence_pool)
        .await
        .map_err(|e| QueryParsedArtifactsError {
            message: format!("Failed to query artifact_objects: {}", e),
        })?;

        if rows.is_empty() {
            return Ok("Error: This file is a recognized OS artifact but it has not been parsed yet. Inform the user that you cannot process this file for the requested task, and advise them to run the relevant artifact parser first before asking again.".to_string());
        }

        let mut concatenated_json = String::new();
        for row in rows {
            let json_str: String = row.try_get("json").unwrap_or_default();
            concatenated_json.push_str(&json_str);
            concatenated_json.push('\n');
        }

        // Cap to 50k characters to prevent window blowout.
        Ok(concatenated_json.chars().take(50_000).collect())
    }
}

// -------------------------------------------------------------------------------------------------
// Query SQLite File Tool
// -------------------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct QuerySqliteFileArgs {
    pub file_id: u64,
    pub partition_id: i64,
    pub query: String,
}

#[derive(Serialize, Debug, Error)]
#[error("QuerySqliteFileError: {message}")]
pub struct QuerySqliteFileError {
    pub message: String,
}

/// A tool to extract a specific SQLite database from the disk image and execute a read-only query against it.
pub struct QuerySqliteFileTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub app: tauri::AppHandle,
    pub evidence_id: i64,
}

impl QuerySqliteFileTool {
    pub fn new(evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Self {
        Self {
            evidence_pool,
            app,
            evidence_id,
        }
    }
}

impl Tool for QuerySqliteFileTool {
    const NAME: &'static str = "query_sqlite_file";

    type Args = QuerySqliteFileArgs;
    type Output = String;
    type Error = QuerySqliteFileError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Extracts a SQLite database file (.db, .sqlite) from the disk image and executes a read-only SQL query against it. Example: SELECT name FROM sqlite_master WHERE type='table'".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "integer",
                        "description": "The filesystem identifier integer of the SQLite database file."
                    },
                    "partition_id": {
                        "type": "integer",
                        "description": "The ID of the partition containing the file."
                    },
                    "query": {
                        "type": "string",
                        "description": "The exact read-only SELECT query to execute against the extracted database."
                    }
                },
                "required": ["file_id", "partition_id", "query"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        use crate::modules::utils::th_progress::{
            ProgressMessageLevel, ProgressMessageType, emit_progress_event,
        };
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::AgentToolCall,
            format!(
                "Querying SQLite file (id: {}): {}",
                args.file_id, args.query
            ),
            &self.app,
        );

        let query = exhume_agent::tools::query_index::validate_read_query(&args.query)
            .map_err(|message| QuerySqliteFileError { message })?;

        use sqlx::{Column, Row, TypeInfo};

        let evidence_row = sqlx::query("SELECT type, path FROM evidence WHERE id = ? LIMIT 1")
            .bind(self.evidence_id)
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|e| QuerySqliteFileError {
                message: format!("Failed to read evidence metadata: {}", e),
            })?;

        let ev_type: String = evidence_row.try_get("type").unwrap_or_default();
        let ev_path: String = evidence_row.try_get("path").unwrap_or_default();

        let file_row = sqlx::query("SELECT name, absolute_path, sig_mime, sig_name, size FROM system_files WHERE identifier = ? AND partition_id = ? LIMIT 1")
            .bind(args.file_id as i64)
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|_| QuerySqliteFileError { message: format!("Could not find file_id {} in DB", args.file_id) })?;

        let name: String = file_row.try_get("name").unwrap_or_default();
        let sig_mime: String = file_row.try_get("sig_mime").unwrap_or_default();
        let sig_name: String = file_row.try_get("sig_name").unwrap_or_default();
        let indexed_size: i64 = file_row.try_get("size").unwrap_or(0);
        if indexed_size > 512 * 1024 * 1024 {
            return Err(QuerySqliteFileError {
                message: "SQLite file exceeds the 512MB interactive-query limit.".to_string(),
            });
        }

        let mut is_db = false;
        let p_name = name.to_lowercase();
        if p_name.ends_with(".db") || p_name.ends_with(".sqlite") || p_name.ends_with(".sqlite3") {
            is_db = true;
        }
        if sig_mime.to_lowercase().contains("sqlite") || sig_name.to_lowercase().contains("sqlite")
        {
            is_db = true;
        }
        if !is_db {
            return Err(QuerySqliteFileError {
                message: format!(
                    "File {} is not recognized as a SQLite Database by its signature or extension.",
                    name
                ),
            });
        }

        let content: Vec<u8>;
        if ev_type == "Folder" {
            let absolute_path: String = file_row.try_get("absolute_path").unwrap_or_default();
            let full_path =
                std::path::Path::new(&ev_path).join(absolute_path.trim_start_matches('/'));
            content = std::fs::read(&full_path).map_err(|e| QuerySqliteFileError {
                message: format!("Local FS Error reading {:?}: {}", full_path, e),
            })?;
        } else {
            let mut first_byte_addr: Option<u64> = None;
            let mut size_bytes: Option<u64> = None;

            let mut body = Body::new(ev_path.clone(), "auto");
            let sector_size = body.get_sector_size() as u64;

            if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors, sector_size, size_bytes FROM partitions WHERE id = ?")
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool).await {
                first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
                size_bytes = Some(
                    row.try_get::<i64, _>("size_bytes").unwrap_or_else(|_| {
                        let size_sectors = row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64;
                        let partition_sector_size = row.try_get::<i64, _>("sector_size").unwrap_or(sector_size as i64) as u64;
                        size_sectors.saturating_mul(partition_sector_size) as i64
                    }) as u64,
                );
            }

            if first_byte_addr.is_none() || size_bytes.is_none() {
                return Err(QuerySqliteFileError {
                    message: format!("Partition ID {} not found", args.partition_id),
                });
            }

            let mut fs = detect_filesystem(
                &mut body,
                first_byte_addr.unwrap(),
                size_bytes.unwrap(),
                None,
            )
            .map_err(|e| QuerySqliteFileError {
                message: format!("Filesystem detection failed: {}", e),
            })?;

            let file = fs
                .get_file(args.file_id)
                .map_err(|e| QuerySqliteFileError {
                    message: format!("File lookup failed for id {}: {}", args.file_id, e),
                })?;

            content = fs
                .read_file_content(&file)
                .map_err(|e| QuerySqliteFileError {
                    message: format!("Failed to read file bytes: {}", e),
                })?;
        }
        if !content.starts_with(b"SQLite format 3\0") {
            return Err(QuerySqliteFileError {
                message: format!("File {} does not have a SQLite 3 header.", name),
            });
        }

        let temp_path = std::env::temp_dir().join(format!(
            "thanatology_sqlite_query_{}_{}_{}.db",
            args.partition_id,
            args.file_id,
            exhume_agent::ui::unique_id("query")
        ));
        if let Err(e) = tokio::fs::write(&temp_path, &content).await {
            return Err(QuerySqliteFileError {
                message: format!("Failed to write DB to temp file: {}", e),
            });
        }

        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&temp_path)
            .read_only(true)
            .create_if_missing(false)
            .immutable(true);
        let temp_pool_res = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await;

        let temp_pool = match temp_pool_res {
            Ok(p) => p,
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(QuerySqliteFileError {
                    message: format!("Failed to open extracted database: {}", e),
                });
            }
        };

        use futures::TryStreamExt;
        let rows_res = async {
            let mut stream = sqlx::query(&query).fetch(&temp_pool);
            let mut rows = Vec::with_capacity(201);
            while rows.len() < 201 {
                match stream.try_next().await {
                    Ok(Some(row)) => rows.push(row),
                    Ok(None) => break,
                    Err(error) => return Err(error),
                }
            }
            Ok::<_, sqlx::Error>(rows)
        }
        .await;

        temp_pool.close().await;
        let _ = tokio::fs::remove_file(&temp_path).await;

        let mut rows = rows_res.map_err(|e| QuerySqliteFileError {
            message: format!("SQL Error: {}", e),
        })?;
        let truncated = rows.len() > 200;
        rows.truncate(200);

        let mut results = Vec::new();
        for row in rows {
            let mut obj = serde_json::Map::new();
            for col in row.columns() {
                let name = col.name();
                let ty = col.type_info().name();
                let value = match ty {
                    "TEXT" | "VARCHAR" => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(
                            val.map(|value| value.chars().take(2_000).collect::<String>())
                        )
                    }
                    "INTEGER" | "BIGINT" => {
                        let val: Option<i64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    "REAL" | "FLOAT" => {
                        let val: Option<f64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    "BOOLEAN" => {
                        let val: Option<bool> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                    _ => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                };
                obj.insert(name.to_string(), value);
            }
            results.push(serde_json::Value::Object(obj));
        }

        Ok(serde_json::json!({
            "rows": results,
            "truncated": truncated,
        })
        .to_string()
        .chars()
        .take(50_000)
        .collect())
    }
}
