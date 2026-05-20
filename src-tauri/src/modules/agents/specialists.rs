use crate::modules::utils::th_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use crate::AiConfig;
use log::{error, info, warn};
use sqlx::SqlitePool;
use tauri::AppHandle;
use rig::providers::{openai};
use rig::completion::Prompt;
use rig::client::CompletionClient;
use exhume_filesystem::Filesystem;

fn normalize_endpoint(endpoint: &str) -> String {
    let e = endpoint.trim();
    if !e.starts_with("http://") && !e.starts_with("https://") {
        format!("http://{}", e)
    } else {
        e.to_string()
    }
}

pub async fn run_specialists(
    evidence_id: i64,
    partition_id: i64,
    pool: SqlitePool,
    app: &AppHandle,
    config: AiConfig,
) {
    if !config.enable_text_specialist && !config.enable_image_specialist && !config.enable_audio_specialist {
        info!("AI Specialists: All specialist agents are disabled in settings.");
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::Success,
            "AI Specialists skipped (disabled in settings).",
            app,
        );
        return;
    }
    
    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Main,
        ProgressMessageType::Info,
        "Running AI Specialist Agents...".to_string(),
        app,
    );
    
    if config.enable_text_specialist {
        run_text_specialist(evidence_id, partition_id, pool.clone(), app, &config).await;
    }
    
    if config.enable_image_specialist {
        run_image_specialist(evidence_id, partition_id, pool.clone(), app, &config).await;
    }
    
    if config.enable_audio_specialist {
        run_audio_specialist(evidence_id, partition_id, pool.clone(), app, &config).await;
    }

    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Main,
        ProgressMessageType::Success,
        "AI Specialists completed.".to_string(),
        app,
    );
}

/// Ensures an entry exists in the `artifacts` table for the AI specialist results to link to.
async fn ensure_ai_artifact(
    pool: &SqlitePool,
    evidence_id: i64,
    partition_id: i64,
    file_id: i64,
    name: &str,
) -> Result<i64, sqlx::Error> {
    use sqlx::Row;

    // Check if it already exists
    let existing = sqlx::query("SELECT id FROM artifacts WHERE file_id = ? AND evidence_id = ? AND name = ?")
        .bind(file_id)
        .bind(evidence_id)
        .bind(name)
        .fetch_optional(pool)
        .await?;

    if let Some(row) = existing {
        return Ok(row.get(0));
    }

    // Otherwise create it
    let res = sqlx::query(
        r#"INSERT INTO artifacts (evidence_id, file_id, partition_id, name, description, parser, tag, category)
           VALUES (?, ?, ?, ?, 'AI-generated analysis artifact', 'ai_specialist', 'AI', 'Analysis')
           RETURNING id"#
    )
    .bind(evidence_id)
    .bind(file_id)
    .bind(partition_id)
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(res.get(0))
}

async fn run_text_specialist(
    evidence_id: i64,
    partition_id: i64,
    pool: SqlitePool,
    app: &AppHandle,
    config: &AiConfig,
) {
    info!("Text Specialist: Starting on evidence {} partition {}", evidence_id, partition_id);
    
    // Use 'id' for DB linking and 'identifier' for filesystem extraction
    let rows = match sqlx::query(
        "SELECT id as file_id, identifier, absolute_path, name FROM system_files WHERE (sig_mime LIKE 'text/%' OR name LIKE '%.txt') AND evidence_id = ? AND partition_id = ?"
    )
    .bind(evidence_id)
    .bind(partition_id)
    .fetch_all(&pool)
    .await {
        Ok(r) => r,
        Err(e) => {
            error!("Text Specialist: SQL query error: {}", e);
            return;
        }
    };

    if rows.is_empty() {
        info!("Text Specialist: No .txt files found to analyze.");
        return;
    }

    info!("Text Specialist: Processing {} files.", rows.len());

    use crate::modules::agents::tools::{ExhumeExtractionTool, ExtractFileArgs};
    use rig::tool::Tool;

    let text_preamble = "You are a Forensic Text-Analyst Specialist reporting to the Investigation Manager. \
        Your task is to analyze raw file content extracted from digital evidence and identify artifacts relevant to the investigation story. \
        Focus on uncovering hidden intent, credentials, sensitive communication, or configuration files that point to criminal activity. \
        Evaluate the forensic relevance and associate a score between 0 and 100. \
        Produce a structured JSON output with ONLY the following two keys: \
        - `score`: An integer from 0 to 100 representing the forensic severity/relevance (100 is highly critical, 0 is irrelevant boilerplate). \
        - `summary`: A concise 1-2 sentence description explaining the forensic significance of the file in the context of the investigation. \
        Do not include any surrounding markdown code blocks.";

    let extract_tool = ExhumeExtractionTool::new(pool.clone(), app.clone(), evidence_id);

    macro_rules! text_agent_prompt {
        ($client:expr, $model:expr) => {
            $client.agent($model).preamble(text_preamble).build()
        };
    }

    // We use a macro to avoid duplicating the loop body across provider branches
    macro_rules! run_text_loop {
        ($agent:expr) => {{
            use sqlx::Row;
            let batch_size = (config.batch_size.max(1)) as usize;
            for (batch_idx, chunk) in rows.chunks(batch_size).enumerate() {
              if batch_idx > 0 {
                  tokio::time::sleep(std::time::Duration::from_millis(200)).await;
              }
              for row in chunk {
                let file_id: i64 = row.get("file_id");
                let identifier: i64 = row.get("identifier");
                let path: String = row.get("absolute_path");
                let name: String = row.get("name");
                info!("Text Specialist: Analyzing {}", path);
                let args = ExtractFileArgs { file_id: identifier as u64, partition_id };
                if let Ok(content) = extract_tool.call(args).await {
                    let snippet: String = content.chars().take(25_000).collect();
                    let prompt = format!("File Name: {}\nFile Path: {}\n\nContent:\n{}", name, path, snippet);
                    if let Ok(resp) = $agent.prompt(&prompt).await {
                        let cleaned = resp.trim().trim_start_matches("```json").trim_end_matches("```").trim();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(cleaned) {
                            match ensure_ai_artifact(&pool, evidence_id, partition_id, file_id, "AI Text Analysis").await {
                                Ok(art_id) => {
                                    let _ = sqlx::query(
                                        "INSERT INTO artifact_objects (evidence_id, partition_id, artifact_id, file_id, parser, kind, text, json) VALUES (?, ?, ?, ?, 'ai_specialist', 'Text Analysis', ?, ?)"
                                    )
                                    .bind(evidence_id).bind(partition_id).bind(art_id).bind(file_id).bind(&name).bind(val.to_string())
                                    .execute(&pool).await;
                                    info!("Text Specialist: Stored results for {}", name);
                                }
                                Err(e) => error!("Text Specialist: Failed to ensure artifact for {}: {}", name, e),
                            }
                        } else {
                            warn!("Text Specialist: Invalid JSON for {}: {}", name, cleaned);
                        }
                    } else {
                        error!("Text Specialist: LLM prompt failed for {}", name);
                    }
                }
              }
            }
        }};
    }

    if config.provider == "copilot" {
        let base = normalize_endpoint(&config.endpoint);
        let llm_url = format!("{}:8000/v1", base.trim_end_matches('/'));
        let client: openai::CompletionsClient = match openai::CompletionsClient::builder()
            .api_key("no-key")
            .base_url(&llm_url)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                error!("Text Specialist: Failed to initialize copilot client: {}", e);
                return;
            }
        };
        let agent = text_agent_prompt!(client, &config.model);
        run_text_loop!(agent);
    } else {
        let client: openai::Client = match openai::Client::new(&config.api_key) {
            Ok(c) => c,
            Err(e) => {
                error!("Text Specialist: Failed to initialize OpenAI client: {}", e);
                return;
            }
        };
        let agent = text_agent_prompt!(client, &config.model);
        run_text_loop!(agent);
    }
}

async fn run_image_specialist(
    evidence_id: i64,
    partition_id: i64,
    pool: SqlitePool,
    app: &AppHandle,
    config: &AiConfig,
) {
    info!("Image Specialist: Starting on evidence {} partition {}", evidence_id, partition_id);

    if config.provider != "openai" && config.provider != "copilot" {
        warn!("Image Specialist: Vision analysis requires OpenAI or copilot provider. Skipping.");
        return;
    }

    let rows = match sqlx::query(
        "SELECT id as file_id, identifier, absolute_path, name FROM system_files WHERE sig_mime LIKE 'image/%' AND evidence_id = ? AND partition_id = ?"
    )
    .bind(evidence_id)
    .bind(partition_id)
    .fetch_all(&pool)
    .await {
        Ok(r) => r,
        Err(e) => { error!("Image Specialist: SQL query error: {}", e); return; }
    };

    if rows.is_empty() {
        info!("Image Specialist: No images found to analyze.");
        return;
    }

    info!("Image Specialist: Processing {} files.", rows.len());

    use crate::modules::agents::tools::{AnalyzeImageTool, ExtractFileArgs};
    use rig::tool::Tool;

    let endpoint = normalize_endpoint(&config.endpoint);
    let vision_tool = AnalyzeImageTool::new(
        pool.clone(), app.clone(), evidence_id,
        config.api_key.clone(), config.provider.clone(), endpoint.clone(),
    );

    let image_preamble = "You are a Forensic Image-Analyst Specialist. \
        You will receive a textual description of an image found during an investigation. \
        Evaluate if it depicts anything suspicious, illegal (weapons, drugs, sensitive documents, surveillance), or forensically relevant. \
        Produce a structured JSON output with EXACTLY these two keys: \
        - `score`: An integer from 0 to 100 (100 = highly critical, 0 = benign). \
        - `summary`: A concise 1-2 sentence forensic significance description. \
        Do not include any surrounding markdown code blocks.";

    macro_rules! run_image_loop {
        ($agent:expr) => {{
            use sqlx::Row;
            let batch_size = (config.batch_size.max(1)) as usize;
            for (batch_idx, chunk) in rows.chunks(batch_size).enumerate() {
              if batch_idx > 0 {
                  tokio::time::sleep(std::time::Duration::from_millis(200)).await;
              }
              for row in chunk {
                let file_id: i64 = row.get("file_id");
                let identifier: i64 = row.get("identifier");
                let name: String = row.get("name");
                info!("Image Specialist: Analyzing {}", name);
                let args = ExtractFileArgs { file_id: identifier as u64, partition_id };
                match vision_tool.call(args).await {
                    Ok(desc) => {
                        let prompt = format!("File Name: {}\nVision Description: {}", name, desc);
                        if let Ok(resp) = $agent.prompt(&prompt).await {
                            let cleaned = resp.trim().trim_start_matches("```json").trim_end_matches("```").trim();
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(cleaned) {
                                match ensure_ai_artifact(&pool, evidence_id, partition_id, file_id, "AI Image Analysis").await {
                                    Ok(art_id) => {
                                        let _ = sqlx::query(
                                            "INSERT INTO artifact_objects (evidence_id, partition_id, artifact_id, file_id, parser, kind, text, json) VALUES (?, ?, ?, ?, 'ai_specialist', 'Image Analysis', ?, ?)"
                                        )
                                        .bind(evidence_id).bind(partition_id).bind(art_id).bind(file_id).bind(&name).bind(val.to_string())
                                        .execute(&pool).await;
                                        info!("Image Specialist: Stored results for {}", name);
                                    }
                                    Err(e) => error!("Image Specialist: Failed to ensure artifact for {}: {}", name, e),
                                }
                            } else {
                                warn!("Image Specialist: Invalid JSON for {}: {}", name, cleaned);
                            }
                        } else {
                            error!("Image Specialist: LLM prompt failed for {}", name);
                        }
                    }
                    Err(e) => error!("Image Specialist: Vision tool failed for {}: {}", name, e.message),
                }
              }
            }
        }};
    }

    if config.provider == "copilot" {
        let llm_url = format!("{}:8000/v1", endpoint.trim_end_matches('/'));
        let client: openai::CompletionsClient = match openai::CompletionsClient::builder()
            .api_key("no-key")
            .base_url(&llm_url)
            .build()
        {
            Ok(c) => c,
            Err(e) => { error!("Image Specialist: Failed to initialize copilot client: {}", e); return; }
        };
        let agent = client.agent(&config.model).preamble(image_preamble).build();
        run_image_loop!(agent);
    } else {
        let client: openai::Client = match openai::Client::new(&config.api_key) {
            Ok(c) => c,
            Err(e) => { error!("Image Specialist: OpenAI client error: {}", e); return; }
        };
        let agent = client.agent(&config.model).preamble(image_preamble).build();
        run_image_loop!(agent);
    }
}

async fn run_audio_specialist(
    evidence_id: i64,
    partition_id: i64,
    pool: SqlitePool,
    _app: &AppHandle,
    config: &AiConfig,
) {
    info!("Audio Specialist: Starting on evidence {} partition {}", evidence_id, partition_id);

    if config.provider != "openai" && config.provider != "copilot" {
        warn!("Audio Specialist: Transcription requires OpenAI or copilot provider. Skipping.");
        return;
    }

    let rows = match sqlx::query(
        "SELECT id as file_id, identifier, absolute_path, name FROM system_files WHERE sig_mime LIKE 'audio/%' AND evidence_id = ? AND partition_id = ?"
    )
    .bind(evidence_id)
    .bind(partition_id)
    .fetch_all(&pool)
    .await {
        Ok(r) => r,
        Err(e) => { error!("Audio Specialist: SQL query error: {}", e); return; }
    };

    if rows.is_empty() {
        info!("Audio Specialist: No audio files found to analyze.");
        return;
    }

    info!("Audio Specialist: Processing {} files.", rows.len());

    let endpoint = normalize_endpoint(&config.endpoint);

    let audio_preamble = "You are a Forensic Audio-Analyst Specialist. \
        You will receive a raw transcription of an audio recording found during an investigation. \
        Evaluate if it depicts anything suspicious, illegal, or forensically relevant (incriminating conversations, planning, confessions). \
        Produce a structured JSON output with EXACTLY these two keys: \
        - `score`: An integer from 0 to 100 (100 = highly critical, 0 = benign). \
        - `summary`: A concise 1-2 sentence description of the forensic significance. \
        Do not include any surrounding markdown code blocks.";

    macro_rules! run_audio_loop {
        ($agent:expr, $transcribe:expr) => {{
            use sqlx::Row;
            let batch_size = (config.batch_size.max(1)) as usize;
            for (batch_idx, chunk) in rows.chunks(batch_size).enumerate() {
              if batch_idx > 0 {
                  tokio::time::sleep(std::time::Duration::from_millis(200)).await;
              }
              for row in chunk {
                let file_id: i64 = row.get("file_id");
                let identifier: i64 = row.get("identifier");
                let path: String = row.get("absolute_path");
                let name: String = row.get("name");
                info!("Audio Specialist: Analyzing {}", path);

                // Extract audio bytes from evidence
                let evidence_row = match sqlx::query("SELECT type, path FROM evidence WHERE id = ?")
                    .bind(evidence_id).fetch_one(&pool).await {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                let ev_type: String = evidence_row.try_get("type").unwrap_or_default();
                let ev_path: String = evidence_row.try_get("path").unwrap_or_default();
                let mut content: Vec<u8> = Vec::new();

                if ev_type == "Folder" {
                    let full_path = std::path::Path::new(&ev_path).join(path.trim_start_matches('/'));
                    content = std::fs::read(&full_path).unwrap_or_default();
                } else {
                    use exhume_body::Body;
                    use exhume_filesystem::detected_fs::detect_filesystem;
                    let mut body = Body::new(ev_path, "auto");
                    let mut addr = 0u64;
                    let mut sz = 0u64;
                    if let Ok(part) = sqlx::query("SELECT first_byte_addr, size_bytes FROM partitions WHERE id = ?")
                        .bind(partition_id).fetch_one(&pool).await {
                        addr = part.try_get::<i64, _>("first_byte_addr").unwrap_or(0) as u64;
                        sz = part.try_get::<i64, _>("size_bytes").unwrap_or(0) as u64;
                    }
                    if sz > 0 {
                        if let Ok(mut fs) = detect_filesystem(&mut body, addr, sz, None) {
                            if let Ok(node) = fs.get_file(identifier as u64) {
                                content = fs.read_file_content(&node).unwrap_or_default();
                            }
                        }
                    }
                }

                if content.is_empty() { continue; }
                if content.len() > 25_000_000 {
                    warn!("Audio Specialist: Skipping {} (>25MB)", name);
                    continue;
                }

                // Transcribe
                let transcription: Option<String> = $transcribe(&name, content, identifier).await;
                if let Some(text) = transcription {
                    info!("Audio Specialist: Transcription {} chars. Scoring...", text.len());
                    if let Ok(scored) = $agent.prompt(&format!("Transcription:\n{}", text)).await {
                        let cl = scored.trim().trim_start_matches("```json").trim_end_matches("```").trim();
                        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(cl) {
                            if let Ok(art_id) = ensure_ai_artifact(&pool, evidence_id, partition_id, file_id, "AI Audio Analysis").await {
                                let _ = sqlx::query("INSERT INTO artifact_objects (evidence_id, partition_id, artifact_id, file_id, parser, kind, text, json) VALUES (?, ?, ?, ?, 'ai_specialist', 'Audio Analysis', ?, ?)")
                                    .bind(evidence_id).bind(partition_id).bind(art_id).bind(file_id).bind(&name).bind(jv.to_string())
                                    .execute(&pool).await;
                                info!("Audio Specialist: Stored results for {}", name);
                            }
                        }
                    }
                }
              }
            }
        }};
    }

    if config.provider == "copilot" {
        let llm_url = format!("{}:8000/v1", endpoint.trim_end_matches('/'));
        let audio_url = format!("{}:8002/v1/transcribe", endpoint.trim_end_matches('/'));
        let client: openai::CompletionsClient = match openai::CompletionsClient::builder()
            .api_key("no-key")
            .base_url(&llm_url)
            .build()
        {
            Ok(c) => c,
            Err(e) => { error!("Audio Specialist: Failed to initialize copilot client: {}", e); return; }
        };
        let agent = client.agent(&config.model).preamble(audio_preamble).build();
        let transcribe = |name: &str, content: Vec<u8>, _id: i64| {
            let url = audio_url.clone();
            let name = name.to_string();
            async move {
                let http = reqwest::Client::new();
                let file_part = match reqwest::multipart::Part::bytes(content)
                    .file_name(name.clone())
                    .mime_str("audio/mpeg") {
                    Ok(p) => p,
                    Err(_) => return None,
                };
                let form = reqwest::multipart::Form::new().part("file", file_part);
                match http.post(&url).multipart(form).send().await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            json.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                        } else { None }
                    }
                    Err(e) => { error!("Audio Specialist: copilot transcription failed for {}: {}", name, e); None }
                }
            }
        };
        run_audio_loop!(agent, transcribe);
    } else {
        let api_key = config.api_key.clone();
        let client: openai::Client = match openai::Client::new(&api_key) {
            Ok(c) => c,
            Err(e) => { error!("Audio Specialist: OpenAI client error: {}", e); return; }
        };
        let agent = client.agent(&config.model).preamble(audio_preamble).build();
        let transcribe = |name: &str, content: Vec<u8>, identifier: i64| {
            let key = api_key.clone();
            let name = name.to_string();
            async move {
                let temp_path = std::env::temp_dir().join(format!("audio_{}.mp3", identifier));
                if std::fs::write(&temp_path, &content).is_err() { return None; }
                let http = reqwest::Client::new();
                let file_part = match reqwest::multipart::Part::bytes(content)
                    .file_name(name.clone())
                    .mime_str("audio/mpeg") {
                    Ok(p) => p,
                    Err(_) => { let _ = std::fs::remove_file(&temp_path); return None; }
                };
                let form = reqwest::multipart::Form::new().part("file", file_part).text("model", "whisper-1");
                let result = http.post("https://api.openai.com/v1/audio/transcriptions")
                    .bearer_auth(&key).multipart(form).send().await;
                let _ = std::fs::remove_file(&temp_path);
                match result {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            json.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                        } else { None }
                    }
                    Err(e) => { error!("Audio Specialist: Whisper API failed for {}: {}", name, e); None }
                }
            }
        };
        run_audio_loop!(agent, transcribe);
    }
}
