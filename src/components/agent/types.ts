export type AgentSessionStatus = "idle" | "running" | "closed";
export type SpecialistKind = "image" | "audio" | "sqlite";
export type AgentLogLevel = "debug" | "info" | "warning" | "error";

export interface AgentSessionMessage {
  id: number;
  turn_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AgentSessionSnapshot {
  session_id: string;
  evidence_id: number;
  provider: string;
  model: string;
  reporting_enabled: boolean;
  status: AgentSessionStatus;
  active_turn_id: string | null;
  messages: AgentSessionMessage[];
}

export interface AgentWorkspaceSnapshot {
  session: AgentSessionSnapshot;
  evidenceName: string;
  evidencePath: string;
  evidenceDbPath: string;
  shellWorkingDir: string;
  notesCount: number;
  anomalyCount: number;
}

export interface AgentTurnResponse {
  sessionId: string;
  turnId: string;
  content: string;
}

export interface AgentFileMention {
  identifier: number;
  partitionId: number;
  name: string;
  absolutePath: string;
}

export interface SpecialistStarted {
  status: "started";
  file_id: number;
}

export interface SpecialistStage {
  status: "stage";
  message: string;
}

export interface SpecialistFinished {
  status: "finished";
  file_name: string;
  score: number | null;
  summary: string;
  cached: boolean;
}

export interface SpecialistFailed {
  status: "failed";
  error: string;
}

export type SpecialistUpdate =
  | SpecialistStarted
  | SpecialistStage
  | SpecialistFinished
  | SpecialistFailed;

interface AgentEventEnvelope {
  version: number;
  event_id?: string;
  parent_event_id?: string | null;
  tool_execution_id?: string | null;
  session_id: string;
  turn_id: string | null;
  evidence_id: number;
  timestamp_ms: number;
}

export type AgentEvent = AgentEventEnvelope &
  (
    | { type: "log"; level: AgentLogLevel; message: string }
    | { type: "turn_started" }
    | { type: "turn_completed"; response: string }
    | { type: "turn_cancelled" }
    | { type: "turn_failed"; error: string }
    | {
        type: "tool_call";
        tool_name: string;
        tool_call_id: string | null;
        arguments: string;
      }
    | {
        type: "tool_result";
        tool_name: string;
        tool_call_id: string | null;
        result: string;
      }
    | {
        type: "specialist";
        kind: SpecialistKind;
        update: SpecialistUpdate;
      }
    | {
        type: "approval_requested";
        request_id: string;
        prompt: string;
      }
    | {
        type: "approval_resolved";
        request_id: string;
        approved: boolean;
      }
    | { type: "report_updated"; export_path: string | null }
  );

export interface PendingApproval {
  requestId: string;
  prompt: string;
}

export interface SpecialistSummary {
  running: boolean;
  stage: string;
  completed: number;
  failed: number;
}
