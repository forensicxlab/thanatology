import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AgentEvent,
  AgentFileMention,
  AgentTurnResponse,
  AgentWorkspaceSnapshot,
  PendingApproval,
} from "./types";

const MAX_ACTIVITY_EVENTS = 1_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventKey(event: AgentEvent): string {
  if (event.event_id) return event.event_id;
  let detail = "";
  switch (event.type) {
    case "tool_call":
    case "tool_result":
      detail = event.tool_call_id ?? event.tool_name;
      break;
    case "approval_requested":
    case "approval_resolved":
      detail = event.request_id;
      break;
    case "specialist":
      detail = `${event.kind}:${JSON.stringify(event.update)}`;
      break;
    case "log":
      detail = event.message;
      break;
    case "turn_failed":
      detail = event.error;
      break;
    case "turn_completed":
      detail = event.response;
      break;
    case "report_updated":
      detail = event.export_path ?? "";
      break;
    case "turn_started":
    case "turn_cancelled":
      break;
  }
  return [
    event.version,
    event.session_id,
    event.turn_id ?? "",
    event.timestamp_ms,
    event.type,
    detail,
  ].join(":");
}

function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const events = new Map(current.map((event) => [eventKey(event), event]));
  for (const event of incoming) {
    events.set(eventKey(event), event);
  }
  return [...events.values()]
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms)
    .slice(-MAX_ACTIVITY_EVENTS);
}

export function useAgentSession(evidenceId: number) {
  const sessionId = useMemo(() => `thanatology-${evidenceId}`, [evidenceId]);
  const [workspace, setWorkspace] = useState<AgentWorkspaceSnapshot | null>(
    null,
  );
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);

  const refresh = useCallback(async () => {
    const snapshot = await invoke<AgentWorkspaceSnapshot>("get_agent_session", {
      sessionId,
    });
    setWorkspace(snapshot);
    return snapshot;
  }, [sessionId]);

  const applyEvent = useCallback(
    (event: AgentEvent) => {
      if (
        event.session_id !== sessionId ||
        event.evidence_id !== evidenceId ||
        ![1, 2].includes(event.version)
      ) {
        return;
      }

      setEvents((current) => mergeEvents(current, [event]));
      if (event.type === "approval_requested") {
        setPendingApproval({
          requestId: event.request_id,
          prompt: event.prompt,
        });
      } else if (event.type === "approval_resolved") {
        setPendingApproval((current) =>
          current?.requestId === event.request_id ? null : current,
        );
      }

      setWorkspace((current) => {
        if (!current) return current;
        if (event.type === "turn_started") {
          return {
            ...current,
            session: {
              ...current.session,
              status: "running",
              active_turn_id: event.turn_id,
            },
          };
        }
        if (
          event.type === "turn_completed" ||
          event.type === "turn_cancelled" ||
          event.type === "turn_failed"
        ) {
          return {
            ...current,
            session: {
              ...current.session,
              status: "idle",
              active_turn_id: null,
            },
          };
        }
        return current;
      });
    },
    [evidenceId, sessionId],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        unlisten = await listen<AgentEvent>("agent-event", ({ payload }) => {
          if (!disposed) applyEvent(payload);
        });
        const snapshot = await invoke<AgentWorkspaceSnapshot>(
          "open_agent_session",
          {
            request: {
              evidenceId,
              sessionId,
              reportingEnabled: true,
            },
          },
        );
        const historicalEvents = await invoke<AgentEvent[]>(
          "list_agent_events",
          {
            sessionId,
            limit: MAX_ACTIVITY_EVENTS,
          },
        );
        if (!disposed) {
          setWorkspace(snapshot);
          setEvents((current) => mergeEvents(current, historicalEvents));
          setError(null);
        }
      } catch (reason) {
        if (!disposed) setError(errorMessage(reason));
      } finally {
        if (!disposed) setInitializing(false);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyEvent, evidenceId, sessionId]);

  const submit = useCallback(
    async (instruction: string): Promise<boolean> => {
      const trimmed = instruction.trim();
      if (!trimmed || !workspace || workspace.session.status === "running") {
        return false;
      }

      const turnId = `turn-${globalThis.crypto.randomUUID()}`;
      const optimisticId = -Date.now();
      setError(null);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              session: {
                ...current.session,
                status: "running",
                active_turn_id: turnId,
                messages: [
                  ...current.session.messages,
                  {
                    id: optimisticId,
                    turn_id: turnId,
                    role: "user",
                    content: trimmed,
                    created_at: new Date().toISOString(),
                  },
                ],
              },
            }
          : current,
      );

      try {
        await invoke<AgentTurnResponse>("submit_agent_turn", {
          sessionId,
          instruction: trimmed,
          turnId,
        });
        await refresh();
        return true;
      } catch (reason) {
        const message = errorMessage(reason);
        if (!message.toLowerCase().includes("cancel")) {
          setError(message);
        }
        try {
          await refresh();
        } catch {
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  session: {
                    ...current.session,
                    status: "idle",
                    active_turn_id: null,
                  },
                }
              : current,
          );
        }
        return false;
      }
    },
    [refresh, sessionId, workspace],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke<{ cancelled: boolean }>("cancel_agent_turn", {
        sessionId,
        turnId: workspace?.session.active_turn_id ?? null,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [sessionId, workspace?.session.active_turn_id]);

  const clear = useCallback(async () => {
    try {
      await invoke("clear_agent_session", { sessionId });
      await refresh();
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [refresh, sessionId]);

  const respondToApproval = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval) return;
      setApprovalBusy(true);
      try {
        const response = await invoke<{ accepted: boolean }>(
          "respond_agent_approval",
          {
            sessionId,
            requestId: pendingApproval.requestId,
            approved,
          },
        );
        if (!response.accepted) {
          setError("The approval request is no longer active.");
          setPendingApproval(null);
        }
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setApprovalBusy(false);
      }
    },
    [pendingApproval, sessionId],
  );

  const searchFiles = useCallback(
    async (query: string): Promise<AgentFileMention[]> => {
      if (!query.trim() || !workspace) return [];
      return invoke<AgentFileMention[]>("search_agent_files", {
        sessionId,
        query,
      });
    },
    [sessionId, workspace],
  );

  const lastReportPath = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "report_updated" && event.export_path) {
        return event.export_path;
      }
    }
    return null;
  }, [events]);

  const clearError = useCallback(() => setError(null), []);

  return {
    workspace,
    events,
    pendingApproval,
    approvalBusy,
    initializing,
    error,
    isRunning: workspace?.session.status === "running",
    lastReportPath,
    clearError,
    submit,
    cancel,
    clear,
    respondToApproval,
    searchFiles,
  };
}
