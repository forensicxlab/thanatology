use rig::{
    agent::Agent,
    providers::{ollama, openai},
    client::{Nothing, CompletionClient},
};

fn normalize_endpoint(endpoint: &str) -> String {
    let e = endpoint.trim();
    if !e.starts_with("http://") && !e.starts_with("https://") {
        format!("http://{}", e)
    } else {
        e.to_string()
    }
}

pub struct AgentConfig {
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
}

pub struct AgentManager;

impl AgentManager {
    /// Create a new AgentManager (factory struct)
    pub fn new() -> Self {
        Self
    }

    const SUPERVISOR_PREAMBLE: &'static str =
        "You are the Supervisor of a digital forensics multi-agent system. \
        Your job is to receive user requests, decompose them into actionable investigative steps, \
        delegate tasks to specialist agents using provided tools, and synthesize a final report. \
        Always link your findings back to the exact evidence_id and absolute_path. \
        Use the `query_system_files` tool to execute SQLite queries against the parsed evidence database. \
        Table to query files is `system_files`, not `files`. Example: SELECT identifier, absolute_path, partition_id, size FROM system_files WHERE ftype = 'txt' LIMIT 5. \
        Use the `query_sqlite_file` tool to expressly extract and query an explicitly requested target SQLite database (.db or .sqlite) file from the disk image, using the file's `identifier` and `partition_id`. \
        Use the `extract_file_content` tool when you need to read the physical textual contents of a document directly from the disk image, passing the file's `identifier` (from system_files) and `partition_id`. \
        Use the `analyze_image_content` tool exclusively when you need to visually analyze photographic evidence or image files (.jpg, .png, etc.), passing the file's `identifier` and `partition_id`. DO NOT use extract_file_content for images. \
        CRITICAL WARNING: Before attempting to extract complex binary OS artifacts (like Windows Registry files, EVTX logs, Prefetch, etc.), execute the `query_parsed_artifacts` tool with the file's `identifier` and `partition_id`. If the tool reports that the artifact is unparsed, strictly forward that warning to the user and refuse to process it.";

    fn build_tools(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> (
        super::tools::QuerySystemFilesTool,
        super::tools::ExhumeExtractionTool,
        super::tools::AnalyzeImageTool,
        super::tools::QueryParsedArtifactsTool,
        super::tools::QuerySqliteFileTool,
    ) {
        let endpoint = normalize_endpoint(&config.endpoint);
        (
            super::tools::QuerySystemFilesTool::new(evidence_pool.clone(), app.clone(), evidence_id),
            super::tools::ExhumeExtractionTool::new(evidence_pool.clone(), app.clone(), evidence_id),
            super::tools::AnalyzeImageTool::new(evidence_pool.clone(), app.clone(), evidence_id, config.api_key.clone(), config.provider.clone(), endpoint),
            super::tools::QueryParsedArtifactsTool::new(evidence_pool.clone(), app.clone(), evidence_id),
            super::tools::QuerySqliteFileTool::new(evidence_pool.clone(), app.clone(), evidence_id),
        )
    }

    /// Helper to build an OpenAI-backed Supervisor
    fn build_openai_supervisor(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Agent<impl rig::completion::CompletionModel> {
        let client: openai::Client = openai::Client::new(&config.api_key).expect("Failed to initialize OpenAI client");
        let (query_tool, extract_tool, analyze_image_tool, query_parsed_artifacts_tool, query_sqlite_file_tool) =
            self.build_tools(config, evidence_pool, app, evidence_id);
        client
            .agent(&config.model)
            .preamble(Self::SUPERVISOR_PREAMBLE)
            .tool(query_tool)
            .tool(extract_tool)
            .tool(analyze_image_tool)
            .tool(query_parsed_artifacts_tool)
            .tool(query_sqlite_file_tool)
            .build()
    }

    /// Helper to build an Ollama-backed Supervisor
    fn build_ollama_supervisor(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Agent<impl rig::completion::CompletionModel> {
        let client: ollama::Client = ollama::Client::builder()
            .base_url(&config.endpoint)
            .api_key(Nothing)
            .build()
            .expect("Failed to initialize Ollama client");
        let (query_tool, extract_tool, analyze_image_tool, query_parsed_artifacts_tool, query_sqlite_file_tool) =
            self.build_tools(config, evidence_pool, app, evidence_id);
        client
            .agent(&config.model)
            .preamble(Self::SUPERVISOR_PREAMBLE)
            .tool(query_tool)
            .tool(extract_tool)
            .tool(analyze_image_tool)
            .tool(query_parsed_artifacts_tool)
            .tool(query_sqlite_file_tool)
            .build()
    }

    /// Helper to build a copilot (vLLM / dfi-copilot) Supervisor using Chat Completions API
    fn build_copilot_supervisor(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool, app: tauri::AppHandle, evidence_id: i64) -> Agent<impl rig::completion::CompletionModel> {
        let base = normalize_endpoint(&config.endpoint);
        let llm_url = format!("{}:8000/v1", base.trim_end_matches('/'));
        let client: openai::CompletionsClient = openai::CompletionsClient::builder()
            .api_key("no-key")
            .base_url(&llm_url)
            .build()
            .expect("Failed to initialize copilot CompletionsClient");
        let (query_tool, extract_tool, analyze_image_tool, query_parsed_artifacts_tool, query_sqlite_file_tool) =
            self.build_tools(config, evidence_pool, app, evidence_id);
        client
            .agent(&config.model)
            .preamble(Self::SUPERVISOR_PREAMBLE)
            .tool(query_tool)
            .tool(extract_tool)
            .tool(analyze_image_tool)
            .tool(query_parsed_artifacts_tool)
            .tool(query_sqlite_file_tool)
            .build()
    }

    /// Instantiates the Rig Supervisor and executes the analysis dynamically, 
    /// avoiding complex `Box<dyn CompletionModel>` bounds that conflict with rig::agent::Agent implementation limitations.
    pub async fn execute_investigation(
        &self, 
        config: &AgentConfig, 
        instruction: String, 
        history: Vec<super::supervisor::ChatMessage>,
        evidence_pool: sqlx::SqlitePool,
        app: tauri::AppHandle,
        evidence_id: i64,
    ) -> Result<super::supervisor::Report, String> {
        
        let task = super::supervisor::InvestigationTask { instruction, history };

        match config.provider.as_str() {
            "openai" => {
                let agent = self.build_openai_supervisor(config, evidence_pool, app.clone(), evidence_id);
                let supervisor = super::supervisor::Supervisor::new(agent, evidence_id, app);
                supervisor.investigate(task).await
            }
            "copilot" => {
                let agent = self.build_copilot_supervisor(config, evidence_pool, app.clone(), evidence_id);
                let supervisor = super::supervisor::Supervisor::new(agent, evidence_id, app);
                supervisor.investigate(task).await
            }
            _ => {
                let agent = self.build_ollama_supervisor(config, evidence_pool, app.clone(), evidence_id);
                let supervisor = super::supervisor::Supervisor::new(agent, evidence_id, app);
                supervisor.investigate(task).await
            }
        }
    }
}
