use rig::{
    agent::Agent,
    providers::{ollama, openai},
    client::{Nothing, CompletionClient},
};

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

    /// Helper to build an OpenAI-backed Supervisor
    fn build_openai_supervisor(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool) -> Agent<impl rig::completion::CompletionModel> {
        // In Rig 0.31.0, OpenAI client usually just takes the API key
        let client: openai::Client = openai::Client::new(&config.api_key).expect("Failed to initialize OpenAI client");
        let query_tool = super::tools::QuerySystemFilesTool::new(evidence_pool.clone());
        let extract_tool = super::tools::ExhumeExtractionTool::new(evidence_pool.clone());
        let analyze_image_tool = super::tools::AnalyzeImageTool::new(evidence_pool.clone(), config.api_key.clone());
        let query_parsed_artifacts_tool = super::tools::QueryParsedArtifactsTool::new(evidence_pool.clone());

        client
            .agent(&config.model)
            .preamble(
                "You are the Supervisor of a digital forensics multi-agent system. 
                Your job is to receive user requests, decompose them into actionable investigative steps, 
                delegate tasks to specialist agents using provided tools, and synthesize a final report.
                Always link your findings back to the exact evidence_id and absolute_path.
                Use the `query_system_files` tool to execute SQLite queries against the parsed evidence database.
                Table to query files is `system_files`, not `files`. Example: SELECT identifier, absolute_path, partition_id, size FROM system_files WHERE ftype = 'txt' LIMIT 5.
                Use the `extract_file_content` tool when you need to read the physical textual contents of a document directly from the disk image, passing the file's `identifier` (from system_files) and `partition_id`.
                Use the `analyze_image_content` tool exclusively when you need to visually analyze photographic evidence or image files (.jpg, .png, etc.), passing the file's `identifier` and `partition_id`. DO NOT use extract_file_content for images.
                CRITICAL WARNING: Before attempting to extract complex binary OS artifacts (like Windows Registry files, EVTX logs, Prefetch, etc.), execute the `query_parsed_artifacts` tool with the file's `identifier` and `partition_id`. If the tool reports that the artifact is unparsed, strictly forward that warning to the user and refuse to process it."
            )
            .tool(query_tool)
            .tool(extract_tool)
            .tool(analyze_image_tool)
            .tool(query_parsed_artifacts_tool)
            .build()
    }

    /// Helper to build an Ollama-backed Supervisor
    fn build_ollama_supervisor(&self, config: &AgentConfig, evidence_pool: sqlx::SqlitePool) -> Agent<impl rig::completion::CompletionModel> {
        let client: ollama::Client = ollama::Client::builder()
            .base_url(&config.endpoint)
            .api_key(Nothing)
            .build()
            .expect("Failed to initialize Ollama client");
            
        let query_tool = super::tools::QuerySystemFilesTool::new(evidence_pool.clone());
        let extract_tool = super::tools::ExhumeExtractionTool::new(evidence_pool.clone());
        let analyze_image_tool = super::tools::AnalyzeImageTool::new(evidence_pool.clone(), config.api_key.clone());
        let query_parsed_artifacts_tool = super::tools::QueryParsedArtifactsTool::new(evidence_pool.clone());

        client
            .agent(&config.model)
            .preamble(
                "You are the Supervisor of a digital forensics multi-agent system. 
                Your job is to receive user requests, decompose them into actionable investigative steps, 
                delegate tasks to specialist agents using provided tools, and synthesize a final report.
                Always link your findings back to the exact evidence_id and absolute_path.
                Use the `query_system_files` tool to execute SQLite queries against the parsed evidence database.
                Table to query files is `system_files`, not `files`. Example: SELECT identifier, absolute_path, partition_id, size FROM system_files WHERE ftype = 'txt' LIMIT 5.
                Use the `extract_file_content` tool when you need to read the physical textual contents of a document directly from the disk image, passing the file's `identifier` (from system_files) and `partition_id`.
                Use the `analyze_image_content` tool exclusively when you need to visually analyze photographic evidence or image files (.jpg, .png, etc.), passing the file's `identifier` and `partition_id`. DO NOT use extract_file_content for images.
                CRITICAL WARNING: Before attempting to extract complex binary OS artifacts (like Windows Registry files, EVTX logs, Prefetch, etc.), execute the `query_parsed_artifacts` tool with the file's `identifier` and `partition_id`. If the tool reports that the artifact is unparsed, strictly forward that warning to the user and refuse to process it."
            )
            .tool(query_tool)
            .tool(extract_tool)
            .tool(analyze_image_tool)
            .tool(query_parsed_artifacts_tool)
            .build()
    }

    /// Instantiates the Rig Supervisor and executes the analysis dynamically, 
    /// avoiding complex `Box<dyn CompletionModel>` bounds that conflict with rig::agent::Agent implementation limitations.
    pub async fn execute_investigation(
        &self, 
        config: &AgentConfig, 
        instruction: String, 
        history: Vec<super::supervisor::ChatMessage>,
        evidence_pool: sqlx::SqlitePool
    ) -> Result<super::supervisor::Report, String> {
        
        let task = super::supervisor::InvestigationTask { instruction, history };

        if config.provider == "openai" {
            let agent = self.build_openai_supervisor(config, evidence_pool);
            let supervisor = super::supervisor::Supervisor::new(agent);
            supervisor.investigate(task).await
        } else {
            let agent = self.build_ollama_supervisor(config, evidence_pool);
            let supervisor = super::supervisor::Supervisor::new(agent);
            supervisor.investigate(task).await
        }
    }
}
