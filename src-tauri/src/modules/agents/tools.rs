use rig::tool::Tool;
use rig::completion::ToolDefinition;
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

use exhume_body::{Body, BodySlice};
use exhume_filesystem::detected_fs::detect_filesystem;
use exhume_filesystem::filesystem::Filesystem;

/// A tool to extract a file or read its metadata using the natively linked exhume crates.
pub struct ExhumeExtractionTool {
    pub evidence_pool: sqlx::SqlitePool,
}

impl ExhumeExtractionTool {
    pub fn new(evidence_pool: sqlx::SqlitePool) -> Self {
        Self { evidence_pool }
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
                        "description": "The unique 'identifier' integer of the file on the partition to extract. (Retrieved from the system_files table)"
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
        use sqlx::Row;
        
        let evidence_row = sqlx::query("SELECT type, path FROM evidence LIMIT 1")
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|e| ExtractFileError { message: format!("Failed to read evidence metadata: {}", e) })?;

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

            let full_path = std::path::Path::new(&ev_path).join(absolute_path.trim_start_matches('/'));
            let content = std::fs::read(&full_path).map_err(|e| ExtractFileError { message: format!("Local FS Error reading {:?}: {}", full_path, e.to_string()) })?;
            let text = String::from_utf8_lossy(&content).to_string();
            return Ok(text.chars().take(50_000).collect()); // Cap output to 50k chars
        }

        // It's a Disk Image (EWF, RAW, etc.)
        // Determine partition bounds
        let mut first_byte_addr: Option<u64> = None;
        let mut size_bytes: Option<u64> = None;

        let mut body = Body::new(ev_path.clone(), "auto");
        let sector_size = body.get_sector_size() as u64;

        if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors FROM mbr_partition_entries WHERE id = ?")
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool).await {
            first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
            size_bytes = Some((row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64).saturating_mul(sector_size));
        } else if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors FROM gpt_partition_entries WHERE id = ?")
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool).await {
            first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
            size_bytes = Some((row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64).saturating_mul(sector_size));
        } else if let Ok(row) = sqlx::query("SELECT size FROM logical_partition_entries WHERE id = ?")
            .bind(args.partition_id)
            .fetch_one(&self.evidence_pool).await {
            first_byte_addr = Some(0);
            size_bytes = Some(row.try_get::<i64, _>("size").unwrap_or(0) as u64);
        }

        if first_byte_addr.is_none() || size_bytes.is_none() {
            return Err(ExtractFileError { message: format!("Partition ID {} not found", args.partition_id) });
        }

        let mut fs = detect_filesystem(&mut body, first_byte_addr.unwrap(), size_bytes.unwrap())
            .map_err(|e| ExtractFileError { message: format!("Filesystem detection failed: {}", e) })?;

        let file = fs.get_file(args.file_id)
            .map_err(|e| ExtractFileError { message: format!("File lookup failed for id {}: {}", args.file_id, e) })?;

        let content = fs.read_file_content(&file)
            .map_err(|e| ExtractFileError { message: format!("Failed to read file bytes: {}", e) })?;

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
}

impl QuerySystemFilesTool {
    pub fn new(evidence_pool: sqlx::SqlitePool) -> Self {
        Self { evidence_pool }
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
            description: "Execute a read-only SQLite query against the evidence database to find files or artifacts. Tables include: files, entries_pml, entries_pe, timeline, artifacts. Example: SELECT name, absolute_path FROM files WHERE extension = 'exe' LIMIT 10".to_string(),
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
        if !args.query.trim().to_uppercase().starts_with("SELECT") {
            return Err(QueryError {
                message: "Only SELECT queries are allowed.".to_string(),
            });
        }

        use sqlx::{Row, Column, TypeInfo};
        let rows = sqlx::query(&args.query)
            .fetch_all(&self.evidence_pool)
            .await
            .map_err(|e| QueryError { message: e.to_string() })?;

        let mut results = Vec::new();
        for row in rows {
            let mut obj = serde_json::Map::new();
            for col in row.columns() {
                let name = col.name();
                let ty = col.type_info().name();
                let value = match ty {
                    "TEXT" | "VARCHAR" => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    },
                    "INTEGER" | "BIGINT" => {
                        let val: Option<i64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    },
                    "REAL" | "FLOAT" => {
                        let val: Option<f64> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    },
                    "BOOLEAN" => {
                        let val: Option<bool> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    },
                    _ => {
                        let val: Option<String> = row.try_get(name).unwrap_or(None);
                        serde_json::json!(val)
                    }
                };
                obj.insert(name.to_string(), value);
            }
            results.push(serde_json::Value::Object(obj));
        }

        Ok(serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()))
    }
}

pub struct AnalyzeImageTool {
    pub evidence_pool: sqlx::SqlitePool,
    pub api_key: String,
}

impl AnalyzeImageTool {
    pub fn new(evidence_pool: sqlx::SqlitePool, api_key: String) -> Self {
        Self { evidence_pool, api_key }
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
                        "description": "The unique 'identifier' integer of the image file. (Retrieved from system_files)"
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
        use sqlx::Row;
        use rig::client::CompletionClient;
        use rig::providers::openai;
        use rig::completion::Prompt;
        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
        
        let evidence_row = sqlx::query("SELECT type, path FROM evidence LIMIT 1")
            .fetch_one(&self.evidence_pool)
            .await
            .map_err(|e| ExtractFileError { message: format!("Failed to read evidence metadata: {}", e) })?;

        let ev_type: String = evidence_row.try_get("type").unwrap_or_default();
        let ev_path: String = evidence_row.try_get("path").unwrap_or_default();

        let mut content = Vec::new();
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

            let full_path = std::path::Path::new(&ev_path).join(absolute_path.trim_start_matches('/'));
            content = std::fs::read(&full_path).map_err(|e| ExtractFileError { message: format!("Local FS Error reading {:?}: {}", full_path, e.to_string()) })?;
        } else {
            // It's a Disk Image
            let mut first_byte_addr: Option<u64> = None;
            let mut size_bytes: Option<u64> = None;

            let mut body = Body::new(ev_path.clone(), "auto");
            let sector_size = body.get_sector_size() as u64;

            if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors FROM mbr_partition_entries WHERE id = ?")
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool).await {
                first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
                size_bytes = Some((row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64).saturating_mul(sector_size));
            } else if let Ok(row) = sqlx::query("SELECT first_byte_addr, size_sectors FROM gpt_partition_entries WHERE id = ?")
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool).await {
                first_byte_addr = Some(row.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64);
                size_bytes = Some((row.try_get::<i64, _>("size_sectors").unwrap_or(0) as u64).saturating_mul(sector_size));
            } else if let Ok(row) = sqlx::query("SELECT size FROM logical_partition_entries WHERE id = ?")
                .bind(args.partition_id)
                .fetch_one(&self.evidence_pool).await {
                first_byte_addr = Some(0);
                size_bytes = Some(row.try_get::<i64, _>("size").unwrap_or(0) as u64);
            }

            if first_byte_addr.is_none() || size_bytes.is_none() {
                return Err(ExtractFileError { message: format!("Partition ID {} not found", args.partition_id) });
            }

            let mut fs = detect_filesystem(&mut body, first_byte_addr.unwrap(), size_bytes.unwrap())
                .map_err(|e| ExtractFileError { message: format!("Filesystem detection failed: {}", e) })?;

            let file = fs.get_file(args.file_id)
                .map_err(|e| ExtractFileError { message: format!("File lookup failed for id {}: {}", args.file_id, e) })?;

            content = fs.read_file_content(&file)
                .map_err(|e| ExtractFileError { message: format!("Failed to read file bytes: {}", e) })?;
        }

        // Limit huge images to avoid memory blowout (e.g., max 20MB)
        if content.len() > 20_000_000 {
            return Err(ExtractFileError { message: "Image file is too large to process visually (>20MB).".to_string() });
        }

        // Convert the file bytes to a base64 data URI
        let base64_data = BASE64.encode(&content);
        let data_uri = format!("data:{};base64,{}", mime_type, base64_data);

        // Sub-Agent invocation: Send the multimodal prompt to OpenAI using the user's API key
        if self.api_key.is_empty() {
            return Err(ExtractFileError { message: "OpenAI API Key is missing. Vision model requires a valid OpenAI Key.".to_string() });
        }

        let oai_client: openai::Client = openai::Client::new(&self.api_key).map_err(|e| ExtractFileError { message: format!("Failed to initialize OAI client: {}", e) })?;
        let sub_agent = oai_client
            .agent("gpt-4o")
            .preamble("You are a forensic image analyst. Describe this image in granular technical detail. Note file types, texts visible via OCR, objects, metadata if rendered, environment details, and anomalies.")
            .build();

        let image_message = rig::completion::Message::User { 
            content: rig::one_or_many::OneOrMany::many(
                vec![
                    rig::completion::message::UserContent::text("Please analyze this evidence image visually."),
                    rig::completion::message::UserContent::image_url(data_uri, None, None)
                ]
            ).unwrap()
        };

        match sub_agent.prompt(image_message).await {
            Ok(desc) => Ok(desc),
            Err(e) => Err(ExtractFileError { message: format!("Vision Analysis failed: {}", e) }),
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
}

impl QueryParsedArtifactsTool {
    pub fn new(evidence_pool: sqlx::SqlitePool) -> Self {
        Self { evidence_pool }
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
                        "description": "The unique 'identifier' integer of the file."
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
        use sqlx::Row;

        let rows = sqlx::query(
            "SELECT ao.json 
             FROM artifact_objects ao 
             JOIN system_files sf ON ao.file_id = sf.id 
             WHERE sf.identifier = ? AND ao.partition_id = ?"
        )
            .bind(args.file_id as i64)
            .bind(args.partition_id)
            .fetch_all(&self.evidence_pool)
            .await
            .map_err(|e| QueryParsedArtifactsError { message: format!("Failed to query artifact_objects: {}", e) })?;

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
