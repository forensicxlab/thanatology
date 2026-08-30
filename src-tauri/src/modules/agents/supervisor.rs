use crate::modules::utils::th_progress::{
    emit_progress_event, ProgressMessageLevel, ProgressMessageType,
};
use rig::{
    agent::Agent,
    completion::{CompletionModel, Prompt},
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct InvestigationTask {
    pub instruction: String,
    pub history: Vec<ChatMessage>,
}

#[derive(Serialize, Deserialize)]
pub struct Report {
    pub summary: String,
    pub findings: Vec<String>,
}

pub struct Supervisor<M: CompletionModel> {
    pub agent: Agent<M>,
    pub evidence_id: i64,
    pub app: tauri::AppHandle,
}

impl<M: CompletionModel> Supervisor<M> {
    pub fn new(agent: Agent<M>, evidence_id: i64, app: tauri::AppHandle) -> Self {
        Self {
            agent,
            evidence_id,
            app,
        }
    }

    /// Entry point for an investigation. The supervisor takes a high-level task,
    /// and uses its Rig agent to determine the steps.
    pub async fn investigate(&self, task: InvestigationTask) -> Result<Report, String> {
        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::AgentThought,
            format!("Starting investigation: {}", task.instruction),
            &self.app,
        );

        let mut history_block = String::new();
        if !task.history.is_empty() {
            history_block.push_str("=== Conversation History ===\n");
            for msg in &task.history {
                history_block.push_str(&format!(
                    "{}: {}\n\n",
                    msg.role.to_uppercase(),
                    msg.content
                ));
            }
            history_block.push_str("============================\n\n");
        }

        let prompt = format!(
            "{}Perform an investigation based on this instruction: '{}'.
            Use your available tools to find the relevant information, extract the necessary files, and synthesize a comprehensive response.
            
            IMPORTANT: Your final response MUST be a valid JSON object matching this schema exactly:
            {{
                \"summary\": \"A detailed narrative summary of your investigation\",
                \"findings\": [\"A specific finding with concrete evidence\", \"Another finding with file paths and contents\"]
            }}
            Do not wrap the JSON in markdown blocks like ```json ... ```.",
            history_block,
            task.instruction
        );

        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::AgentThought,
            "Analyzing evidence and thinking about next steps...".to_string(),
            &self.app,
        );

        let response = match self.agent.prompt(&prompt).max_turns(5).await {
            Ok(resp) => resp,
            Err(e) => return Err(format!("LLM error: {}", e)),
        };

        emit_progress_event(
            &self.evidence_id,
            ProgressMessageLevel::Main,
            ProgressMessageType::AgentThought,
            "Synthesizing final investigation report...".to_string(),
            &self.app,
        );

        // Attempt to parse the structured JSON from the LLM.
        // If it returns markdown code blocks, strip them.
        let cleaned_response = response
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        match serde_json::from_str::<Report>(cleaned_response) {
            Ok(report) => Ok(report),
            Err(_) => {
                // Fallback: If the LLM failed to format as JSON, just return the raw text.
                Ok(Report {
                    summary: response,
                    findings: vec![],
                })
            }
        }
    }
}
