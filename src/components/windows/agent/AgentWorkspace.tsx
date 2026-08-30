import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import SendIcon from "@mui/icons-material/Send";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  WINDOW_TITLEBAR_HEIGHT,
  WindowDragRegion,
  WindowFrame,
  WindowTitlebar,
} from "../shared/WindowTitlebar";
import { useAgentSession } from "./useAgentSession";
import {
  AgentEvent,
  AgentFileMention,
  SpecialistKind,
  SpecialistSummary,
} from "./types";

type ActivityTab = "all" | SpecialistKind;

const STATUSBAR_HEIGHT = 28;
const SPECIALIST_KINDS: SpecialistKind[] = ["image", "audio", "sqlite"];

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function displayMessage(content: string): string {
  return content.replace(
    /@(.+?) \(identifier: \d+, partition_id: \d+\)/g,
    "@$1",
  );
}

interface EvidenceReference {
  eventId: string;
  toolName: string;
}

function groundedMessage(content: string): {
  content: string;
  references: EvidenceReference[];
} {
  const references: EvidenceReference[] = [];
  const groundedContent = content.replace(
    /\[\[evidence:([^|\]]+)\|([^\]]+)\]\]/g,
    (_match, eventId: string, toolName: string) => {
      references.push({ eventId, toolName });
      return "";
    },
  );
  return { content: groundedContent.trimEnd(), references };
}

function eventText(event: AgentEvent): string {
  switch (event.type) {
    case "log":
      return event.message;
    case "turn_started":
      return "Agent turn started.";
    case "turn_completed":
      return "Agent turn completed.";
    case "turn_cancelled":
      return "Agent turn cancelled.";
    case "turn_failed":
      return `Agent turn failed: ${event.error}`;
    case "tool_call":
      return `▶ ${event.tool_name}: ${event.arguments}`;
    case "tool_result":
      return `✓ ${event.tool_name}: ${event.result}`;
    case "approval_requested":
      return `Approval requested: ${event.prompt}`;
    case "approval_resolved":
      return event.approved ? "✓ Request approved." : "✗ Request denied.";
    case "report_updated":
      return event.export_path
        ? `Report updated: ${event.export_path}`
        : "Report updated.";
    case "specialist": {
      const label = event.kind.toUpperCase();
      switch (event.update.status) {
        case "started":
          return `▶ [${label}] analyzing file_id=${event.update.file_id}`;
        case "stage":
          return `[${label}] ${event.update.message}`;
        case "finished": {
          const score =
            event.update.score === null ? "" : ` — score ${event.update.score}`;
          const cached = event.update.cached ? " (cached)" : "";
          const summary = event.update.summary
            ? ` — ${event.update.summary}`
            : "";
          return `✓ [${label}] ${event.update.file_name}${cached}${score}${summary}`;
        }
        case "failed":
          return `✗ [${label}] ${event.update.error}`;
      }
    }
  }
}

function eventColor(event: AgentEvent): string {
  if (
    event.type === "turn_failed" ||
    (event.type === "log" && event.level === "error") ||
    (event.type === "specialist" && event.update.status === "failed")
  ) {
    return "error.main";
  }
  if (
    event.type === "approval_requested" ||
    (event.type === "log" && event.level === "warning")
  ) {
    return "warning.main";
  }
  if (
    event.type === "tool_result" ||
    event.type === "turn_completed" ||
    (event.type === "approval_resolved" && event.approved) ||
    (event.type === "specialist" && event.update.status === "finished")
  ) {
    return "success.main";
  }
  if (
    event.type === "tool_call" ||
    event.type === "turn_started" ||
    event.type === "specialist"
  ) {
    return "info.main";
  }
  return "text.secondary";
}

function specialistSummaries(
  events: AgentEvent[],
): Record<SpecialistKind, SpecialistSummary> {
  const summaries: Record<SpecialistKind, SpecialistSummary> = {
    image: { running: false, stage: "", completed: 0, failed: 0 },
    audio: { running: false, stage: "", completed: 0, failed: 0 },
    sqlite: { running: false, stage: "", completed: 0, failed: 0 },
  };
  for (const event of events) {
    if (event.type !== "specialist") continue;
    const summary = summaries[event.kind];
    switch (event.update.status) {
      case "started":
        summary.running = true;
        summary.stage = `Analyzing file_id=${event.update.file_id}`;
        break;
      case "stage":
        summary.running = true;
        summary.stage = event.update.message;
        break;
      case "finished":
        summary.running = false;
        summary.stage = "";
        summary.completed += 1;
        break;
      case "failed":
        summary.running = false;
        summary.stage = "";
        summary.failed += 1;
        break;
    }
  }
  return summaries;
}

function AgentTitlebar({
  evidenceName,
  evidencePath,
}: {
  evidenceName: string;
  evidencePath: string;
}) {
  return (
    <WindowTitlebar windowName="AI Agent">
      <WindowDragRegion
        sx={{
          gap: 1,
          px: 1,
        }}
      >
        <Chip
          data-tauri-drag-region
          icon={<SmartToyOutlinedIcon />}
          label="EXHUME AGENT"
          color="primary"
          size="small"
          sx={{ height: 22, fontWeight: 700, borderRadius: 1 }}
        />
        <Typography
          data-tauri-drag-region
          variant="caption"
          sx={{ fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {evidenceName}
        </Typography>
        <Typography
          data-tauri-drag-region
          variant="caption"
          color="text.secondary"
          title={evidencePath}
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {evidencePath}
        </Typography>
      </WindowDragRegion>
    </WindowTitlebar>
  );
}

function ConversationPane({
  messages,
  running,
  onClear,
}: {
  messages: NonNullable<
    ReturnType<typeof useAgentSession>["workspace"]
  >["session"]["messages"];
  running: boolean;
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, running]);

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "36px minmax(0, 1fr)",
      }}
    >
      <Box
        sx={{
          px: 1.25,
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
          CONVERSATION
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Clear conversation history">
          <span>
            <IconButton
              aria-label="Clear conversation"
              size="small"
              disabled={running || messages.length === 0}
              onClick={onClear}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box
        ref={scrollRef}
        sx={{
          minHeight: 0,
          overflow: "auto",
          px: 1.5,
          py: 1.25,
        }}
      >
        {messages.length === 0 ? (
          <Box
            sx={{
              height: "100%",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              px: 4,
            }}
          >
            <Box>
              <SmartToyOutlinedIcon
                sx={{ fontSize: 42, color: "text.disabled", mb: 1 }}
              />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Begin an evidence-scoped investigation
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Ask for filesystem, artifact, timeline, specialist, or report
                analysis. Use @ to attach an indexed file reference.
              </Typography>
            </Box>
          </Box>
        ) : (
          <Stack spacing={1.25}>
            {messages.map((message) => {
              const grounded = groundedMessage(message.content);
              return (
                <Box
                key={`${message.id}-${message.turn_id ?? ""}`}
                sx={{
                  alignSelf:
                    message.role === "user" ? "flex-end" : "stretch",
                  width: message.role === "user" ? "min(88%, 760px)" : "100%",
                  borderLeft: 3,
                  borderColor:
                    message.role === "user" ? "primary.main" : "success.main",
                  bgcolor:
                    message.role === "user"
                      ? "action.hover"
                      : "background.paper",
                  borderRadius: 1,
                  px: 1.25,
                  py: 1,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mb: 0.5, justifyContent: "space-between" }}
                >
                  <Typography
                    variant="caption"
                    color={
                      message.role === "user" ? "primary.main" : "success.main"
                    }
                    sx={{ fontWeight: 700 }}
                  >
                    {message.role === "user" ? "INVESTIGATOR" : "AGENT"}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {message.created_at}
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    fontSize: "0.84rem",
                    lineHeight: 1.55,
                    overflowWrap: "anywhere",
                    "& p": { my: 0.6 },
                    "& p:first-of-type": { mt: 0 },
                    "& p:last-child": { mb: 0 },
                    "& pre": {
                      p: 1,
                      overflow: "auto",
                      bgcolor: "rgba(0,0,0,0.24)",
                      borderRadius: 1,
                      fontSize: "0.76rem",
                    },
                    "& code": {
                      fontFamily:
                        '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
                    },
                    "& table": { borderCollapse: "collapse", width: "100%" },
                    "& th, & td": {
                      border: 1,
                      borderColor: "divider",
                      px: 0.75,
                      py: 0.4,
                      textAlign: "left",
                    },
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {displayMessage(grounded.content)}
                  </ReactMarkdown>
                  {grounded.references.length > 0 && (
                    <Stack
                      direction="row"
                      useFlexGap
                      spacing={0.5}
                      sx={{ mt: 1, flexWrap: "wrap" }}
                    >
                      {grounded.references.map((reference) => (
                        <Tooltip
                          key={`${reference.eventId}-${reference.toolName}`}
                          title={`Audit event ${reference.eventId}`}
                        >
                          <Chip
                            size="small"
                            variant="outlined"
                            color="success"
                            label={`${reference.toolName} · ${reference.eventId.slice(-8)}`}
                            sx={{ height: 20, fontSize: "0.66rem" }}
                          />
                        </Tooltip>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Box>
              );
            })}
            {running && (
              <Stack
                direction="row"
                spacing={1}
                sx={{ color: "warning.main", px: 1, alignItems: "center" }}
              >
                <CircularProgress size={13} color="inherit" />
                <Typography variant="caption">
                  Agent is investigating…
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function ActivityPane({
  events,
}: {
  events: AgentEvent[];
}) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const summaries = useMemo(() => specialistSummaries(events), [events]);
  const visibleEvents = useMemo(
    () =>
      activeTab === "all"
        ? events
        : events.filter(
            (event) =>
              event.type === "specialist" && event.kind === activeTab,
          ),
    [activeTab, events],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeTab, visibleEvents.length]);

  const tabLabel = (kind: SpecialistKind) => {
    const summary = summaries[kind];
    const markers = [
      summary.running ? "●" : "",
      summary.completed ? `✓${summary.completed}` : "",
      summary.failed ? `✗${summary.failed}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `${kind.toUpperCase()}${markers ? ` ${markers}` : ""}`;
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        display: "grid",
        gridTemplateRows:
          activeTab === "all" ? "36px minmax(0, 1fr)" : "36px 28px minmax(0, 1fr)",
      }}
    >
      <Tabs
        value={activeTab}
        onChange={(_event, value: ActivityTab) => setActiveTab(value)}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 36,
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTab-root": {
            minHeight: 36,
            minWidth: 54,
            px: 1,
            py: 0,
            fontSize: "0.65rem",
          },
        }}
      >
        <Tab value="all" label="ALL" />
        {SPECIALIST_KINDS.map((kind) => (
          <Tab key={kind} value={kind} label={tabLabel(kind)} />
        ))}
      </Tabs>

      {activeTab !== "all" && (
        <Box
          sx={{
            px: 1.25,
            display: "flex",
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "action.hover",
          }}
        >
          <Typography
            variant="caption"
            color={
              summaries[activeTab].running
                ? "warning.main"
                : "text.secondary"
            }
            noWrap
          >
            {summaries[activeTab].running
              ? `● ${summaries[activeTab].stage}`
              : summaries[activeTab].completed + summaries[activeTab].failed > 0
                ? `○ idle — ${summaries[activeTab].completed} completed, ${summaries[activeTab].failed} failed`
                : "○ idle — no delegations this session"}
          </Typography>
        </Box>
      )}

      <Box
        ref={scrollRef}
        sx={{
          minHeight: 0,
          overflow: "auto",
          px: 1.1,
          py: 0.9,
          fontFamily:
            '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          bgcolor: "rgba(0,0,0,0.08)",
        }}
      >
        {visibleEvents.length === 0 ? (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ fontStyle: "italic" }}
          >
            No activity recorded.
          </Typography>
        ) : (
          visibleEvents.map((event, index) => (
            <Box
              key={`${event.timestamp_ms}-${event.type}-${index}`}
              sx={{
                display: "grid",
                gridTemplateColumns: "76px minmax(0, 1fr)",
                gap: 0.75,
                py: 0.35,
                borderBottom: "1px solid",
                borderColor: "rgba(127,127,127,0.09)",
              }}
            >
              <Box title={event.event_id}>
                <Typography
                  component="div"
                  sx={{
                    font: "inherit",
                    fontSize: "0.66rem",
                    color: "text.disabled",
                  }}
                >
                  {formatTimestamp(event.timestamp_ms)}
                </Typography>
                {event.event_id && (
                  <Typography
                    component="div"
                    sx={{
                      font: "inherit",
                      fontSize: "0.59rem",
                      color: "text.disabled",
                      opacity: 0.7,
                    }}
                  >
                    {event.event_id.slice(-8)}
                  </Typography>
                )}
              </Box>
              <Typography
                component="span"
                sx={{
                  font: "inherit",
                  fontSize: "0.69rem",
                  lineHeight: 1.45,
                  color: eventColor(event),
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {eventText(event)}
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Paper>
  );
}

interface MentionToken {
  start: number;
  cursor: number;
  query: string;
}

export default function AgentWorkspace({
  evidenceId,
}: {
  evidenceId: number;
}) {
  const {
    workspace,
    events,
    pendingApproval,
    approvalBusy,
    initializing,
    error,
    isRunning,
    lastReportPath,
    clearError,
    submit,
    cancel,
    clear,
    respondToApproval,
    searchFiles,
  } = useAgentSession(evidenceId);
  const [instruction, setInstruction] = useState("");
  const [contextFiles, setContextFiles] = useState<AgentFileMention[]>([]);
  const [mentionToken, setMentionToken] = useState<MentionToken | null>(null);
  const [mentionResults, setMentionResults] = useState<AgentFileMention[]>([]);
  const [mentionSelection, setMentionSelection] = useState(0);
  const [clearConfirmation, setClearConfirmation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!mentionToken?.query) {
      setMentionResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchFiles(mentionToken.query)
        .then((results) => {
          if (!cancelled) {
            setMentionResults(results);
            setMentionSelection(0);
          }
        })
        .catch(() => {
          if (!cancelled) setMentionResults([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionToken?.query, searchFiles]);

  const handleInstructionChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    setInstruction(value);
    const match = value.slice(0, cursor).match(/@([\w.-]*)$/);
    if (match?.index !== undefined && match[1].trim()) {
      setMentionToken({
        start: match.index,
        cursor,
        query: match[1].trim(),
      });
    } else {
      setMentionToken(null);
      setMentionResults([]);
    }
  };

  const selectMention = useCallback(
    (file: AgentFileMention) => {
      if (!mentionToken) return;
      const before = instruction.slice(0, mentionToken.start);
      const suffix = instruction.slice(mentionToken.cursor);
      const whitespace = suffix.search(/\s/);
      const after = whitespace === -1 ? "" : suffix.slice(whitespace);
      setInstruction(`${before}@${file.name}${after} `);
      setContextFiles((current) => [
        ...current.filter(
          (candidate) => candidate.identifier !== file.identifier,
        ),
        file,
      ]);
      setMentionToken(null);
      setMentionResults([]);
    },
    [instruction, mentionToken],
  );

  const submitInstruction = useCallback(async () => {
    if (!instruction.trim() || isRunning) return;
    let processed = instruction.trim();
    const files = [...contextFiles].sort(
      (left, right) => right.name.length - left.name.length,
    );
    for (const file of files) {
      const escaped = file.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      processed = processed.replace(
        new RegExp(`@${escaped}(?=\\s|$|[.,;:])`, "g"),
        `@${file.name} (identifier: ${file.identifier}, partition_id: ${file.partitionId})`,
      );
    }
    setInstruction("");
    setContextFiles([]);
    setMentionToken(null);
    setMentionResults([]);
    await submit(processed);
  }, [contextFiles, instruction, isRunning, submit]);

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (mentionResults.length > 0 && mentionToken) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionSelection((current) =>
          Math.min(current + 1, mentionResults.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelection((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectMention(mentionResults[mentionSelection]);
        return;
      }
      if (event.key === "Escape") {
        setMentionToken(null);
        setMentionResults([]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitInstruction();
    }
  };

  if (initializing) {
    return (
      <WindowFrame windowName="AI Agent" title="Exhume Agent">
        <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
          <Stack spacing={1.5} sx={{ alignItems: "center" }}>
            <CircularProgress size={28} />
            <Typography variant="body2">Opening evidence agent session…</Typography>
          </Stack>
        </Box>
      </WindowFrame>
    );
  }

  if (!workspace) {
    return (
      <WindowFrame windowName="AI Agent" title="Exhume Agent">
        <Box sx={{ height: "100%", display: "grid", placeItems: "center", p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => window.location.reload()}>
                Retry
              </Button>
            }
            sx={{ maxWidth: 720 }}
          >
            The agent workspace could not be opened: {error ?? "Unknown error"}
          </Alert>
        </Box>
      </WindowFrame>
    );
  }

  const status = pendingApproval
    ? "APPROVAL REQUIRED"
    : isRunning
      ? "THINKING"
      : "IDLE";
  const statusColor = pendingApproval
    ? "error"
    : isRunning
      ? "warning"
      : "success";
  const isShellApproval = pendingApproval?.prompt.startsWith(
    "Allow this host shell command?",
  );

  return (
    <Box
      sx={{
        height: "100vh",
        minWidth: 0,
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: `${WINDOW_TITLEBAR_HEIGHT}px minmax(0, 1fr) auto ${STATUSBAR_HEIGHT}px`,
      }}
    >
      <AgentTitlebar
        evidenceName={workspace.evidenceName}
        evidencePath={workspace.evidencePath}
      />

      <Box
        sx={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.62fr) minmax(320px, 1fr)",
          gap: 0.75,
          p: 0.75,
          pb: 0,
        }}
      >
        <ConversationPane
          messages={workspace.session.messages}
          running={isRunning}
          onClear={() => setClearConfirmation(true)}
        />
        <ActivityPane events={events} />
      </Box>

      <Box sx={{ position: "relative", px: 0.75, py: 0.75 }}>
        {error && (
          <Alert
            severity="error"
            onClose={clearError}
            sx={{ mb: 0.75, py: 0 }}
          >
            {error}
          </Alert>
        )}
        {contextFiles.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mb: 0.5, overflowX: "auto" }}
          >
            {contextFiles.map((file) => (
              <Chip
                key={file.identifier}
                label={`@${file.name}`}
                title={file.absolutePath}
                size="small"
                onDelete={() =>
                  setContextFiles((current) =>
                    current.filter(
                      (candidate) => candidate.identifier !== file.identifier,
                    ),
                  )
                }
                sx={{ maxWidth: 260 }}
              />
            ))}
          </Stack>
        )}

        {mentionToken && mentionResults.length > 0 && (
          <Paper
            variant="outlined"
            sx={{
              position: "absolute",
              zIndex: 20,
              left: 12,
              bottom: "calc(100% - 4px)",
              width: "min(620px, calc(100% - 24px))",
              maxHeight: 250,
              overflow: "auto",
              p: 0.5,
            }}
          >
            {mentionResults.map((file, index) => (
              <Box
                component="button"
                type="button"
                key={file.identifier}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(file)}
                sx={{
                  width: "100%",
                  border: 0,
                  borderRadius: 1,
                  px: 1,
                  py: 0.6,
                  display: "block",
                  textAlign: "left",
                  color: "text.primary",
                  bgcolor:
                    index === mentionSelection
                      ? "action.selected"
                      : "transparent",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{ display: "block", fontWeight: 600 }}
                >
                  {file.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: "block" }}
                >
                  Partition {file.partitionId} · {file.absolutePath}
                </Typography>
              </Box>
            ))}
          </Paper>
        )}

        <Stack
          direction="row"
          spacing={0.75}
          sx={{ alignItems: "flex-end" }}
        >
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            size="small"
            label="Investigation instruction"
            placeholder="Find persistence mechanisms, explain anomalous files, or investigate @filename…"
            value={instruction}
            disabled={isRunning}
            onChange={handleInstructionChange}
            onKeyDown={handleComposerKeyDown}
            helperText="Enter to investigate · Shift+Enter for a new line · @ to reference an indexed file"
            slotProps={{
              htmlInput: {
                spellCheck: true,
              },
            }}
          />
          {isRunning ? (
            <Tooltip title="Cancel the active turn">
              <Button
                variant="outlined"
                color="warning"
                onClick={() => void cancel()}
                sx={{ minWidth: 44, height: 54, mb: 2.7 }}
              >
                <StopCircleOutlinedIcon />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Submit investigation">
              <span>
                <Button
                  variant="contained"
                  disabled={!instruction.trim()}
                  onClick={() => void submitInstruction()}
                  sx={{ minWidth: 44, height: 54, mb: 2.7 }}
                >
                  <SendIcon />
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Box>

      <Paper
        square
        elevation={0}
        sx={{
          minWidth: 0,
          height: STATUSBAR_HEIGHT,
          borderWidth: 0,
          borderTop: 1,
          borderColor: "divider",
          borderRadius: 0,
          px: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 1,
          overflow: "hidden",
        }}
      >
        <Chip
          size="small"
          color={statusColor}
          label={status}
          sx={{ height: 21, borderRadius: 0.75, fontSize: "0.64rem" }}
        />
        <Typography variant="caption" noWrap>
          {workspace.session.provider} / {workspace.session.model}
        </Typography>
        <Divider orientation="vertical" flexItem />
        <Typography variant="caption" color="text.secondary" noWrap>
          Notes: {workspace.notesCount} · Anomalies: {workspace.anomalyCount}
        </Typography>
        <Divider orientation="vertical" flexItem />
        <Typography
          variant="caption"
          color={workspace.session.reporting_enabled ? "success.main" : "text.disabled"}
          noWrap
        >
          Report: {workspace.session.reporting_enabled ? "ON" : "OFF"}
        </Typography>
        <Divider orientation="vertical" flexItem />
        <Typography
          variant="caption"
          color="warning.main"
          title={`Every command requires approval. Working directory: ${workspace.shellWorkingDir}`}
          noWrap
        >
          Shell: APPROVAL
        </Typography>
        {lastReportPath && (
          <>
            <Divider orientation="vertical" flexItem />
            <Typography
              variant="caption"
              color="text.secondary"
              title={lastReportPath}
              sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {lastReportPath}
            </Typography>
          </>
        )}
      </Paper>

      <Dialog
        open={pendingApproval !== null}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle color="warning.main">
          {isShellApproval
            ? "Host shell approval required"
            : "Agent approval required"}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {isShellApproval
              ? "This command will execute on the host, not inside an evidence sandbox. Review the exact command and working directory before approving."
              : "Review the requested operation."}{" "}
            Approval applies only to this request and is recorded in the
            evidence audit trail.
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1.25,
              fontFamily:
                '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
              fontSize: "0.78rem",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {pendingApproval?.prompt}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={approvalBusy}
            onClick={() => void respondToApproval(false)}
          >
            Deny
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={approvalBusy}
            onClick={() => void respondToApproval(true)}
          >
            Approve once
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearConfirmation}
        onClose={() => setClearConfirmation(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Clear conversation history?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This removes the persisted messages for this agent session.
            Evidence notes, findings, reports, and audit activity are retained.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmation(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setClearConfirmation(false);
              void clear();
            }}
          >
            Clear history
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
