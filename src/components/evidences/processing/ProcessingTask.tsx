import React, { useEffect, useState } from "react";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import { listen } from "@tauri-apps/api/event";
import Avatar from "@mui/material/Avatar";
import {
  Box,
  CircularProgress,
  LinearProgress,
  Step,
  StepLabel,
  Stepper,
  Tooltip,
} from "@mui/material";
import IconButton from "@mui/material/IconButton";

import { Check, Preview, StopCircle, Warning } from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { Evidence } from "../../../dbutils/types";
import Typography from "@mui/material/Typography";
import ParserActivityStatus, {
  ParserProgressPayload,
} from "./ParserActivityStatus";

interface ProcessingTaskProps {
  evidence: Evidence;
  onComplete?: () => void;
}

interface ProgressPayload {
  current: number;
  total: number;
  message?: string;
}

interface ProgressMessagePayload {
  message: string;
  status?: number;
  phase?: ProcessingPhase;
}

type ProcessingPhase =
  | "artefact_identification"
  | "artefact_parsing"
  | "ai_analysis"
  | "complete";

function getProgressMessage(payload: string | ProgressMessagePayload): string {
  return typeof payload === "string" ? payload : payload.message;
}

const PIPELINE_STEPS = [
  "Indexing files",
  "File types",
  "Artefact discovery",
  "Artefact parsing",
  "AI specialists",
];

function stepForStatus(status: number): number {
  if (status >= 6) return PIPELINE_STEPS.length;
  if (status >= 5) return 4;
  if (status >= 4) return 2;
  if (status >= 3) return 1;
  return 0;
}

function stepForPhase(phase?: ProcessingPhase): number | null {
  switch (phase) {
    case "artefact_identification": return 2;
    case "artefact_parsing": return 3;
    case "ai_analysis": return 4;
    case "complete": return PIPELINE_STEPS.length;
    default: return null;
  }
}

function isCancelled(status: number) {
  return status < 0;
}

function cancelledPhaseLabel(status: number): string {
  if (status === -1) return "Cancelled during Indexing";
  if (status === -2) return "Cancellation requested";
  if (status === -3) return "Cancelled during File Identification";
  if (status === -4) return "Cancelled during Artifact Extraction";
  return "Cancelled";
}

const ProcessingTask: React.FC<ProcessingTaskProps> = ({
  evidence,
  onComplete,
}) => {
  const evidenceId = evidence.id;
  const evidenceName = evidence.name;
  const status = evidence.status;

  // Seed the active pipeline step from the DB status at mount time.
  const [activeStep, setActiveStep] = useState<number>(stepForStatus(status));

  const [cancelling, setCancelling] = useState(false);

  const [mainProgress, setMainProgress] = useState("");
  const [mainColor, setMainColor] = useState<"info" | "secondary" | "error" | "success">("info");
  const [moduleProgress, setModuleProgress] = useState("Processing… waiting for status.");
  const [moduleColor, setModuleColor] = useState<"info" | "secondary" | "error" | "success">("info");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [parserActivity, setParserActivity] = useState<ParserProgressPayload | null>(null);

  const isDiscoveryPhase = activeStep === 0 && progress !== null && progress.total <= 0;
  const isIndexingPhase = progress !== null && progress.total > 0;

  useEffect(() => {
    const events = {
      mainInfo: `main_progress_info_${evidenceId}`,
      mainSuccess: `main_progress_success_${evidenceId}`,
      mainError: `main_progress_error_${evidenceId}`,
      mainProgress: `main_progress_progress_${evidenceId}`,
      modInfo: `module_progress_info_${evidenceId}`,
      modSuccess: `module_progress_success_${evidenceId}`,
      modError: `module_progress_error_${evidenceId}`,
      modProgress: `module_progress_progress_${evidenceId}`,
      modParser: `module_progress_parser_${evidenceId}`,
    };

    const unsubs: Promise<() => void>[] = [
      // Canonical pipeline-complete signal — fired after main DB status=5 is written,
      // guaranteeing fetchEvidence() reads the final status regardless of which phases ran.
      listen<number>(`pipeline_complete_${evidenceId}`, () => {
        setActiveStep(PIPELINE_STEPS.length);
        onComplete?.();
      }),
      listen<number>(`artefacts_complete_${evidenceId}`, () => {
        setActiveStep(4);
        onComplete?.();
      }),
      listen<string | ProgressMessagePayload>(events.mainInfo, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("secondary");
        if (typeof payload !== "string") {
          const step = stepForPhase(payload.phase);
          if (step !== null) setActiveStep(step);
        }
      }),
      listen<string | ProgressMessagePayload>(events.mainSuccess, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("success");
        setProgress(null);
        if (typeof payload !== "string") {
          const step = stepForPhase(payload.phase) ?? stepForStatus(payload.status ?? status);
          setActiveStep(step);
          if (payload.phase !== "artefact_parsing") setParserActivity(null);
        } else {
          setActiveStep((previous) => Math.max(previous, 1));
        }
        onComplete?.();
      }),
      listen<string | ProgressMessagePayload>(events.mainError, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("error");
      }),
      listen<ProgressPayload>(events.mainProgress, ({ payload }) => {
        setProgress({ current: payload.current, total: payload.total });
        if (payload.message) {
          setModuleProgress(payload.message);
          setModuleColor("info");
        }
      }),
      listen<string | ProgressMessagePayload>(events.modInfo, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("info");
      }),
      listen<string | ProgressMessagePayload>(events.modSuccess, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("success");
        setProgress(null);
        setParserActivity(null);
      }),
      listen<string | ProgressMessagePayload>(events.modError, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("error");
        setProgress(null);
      }),
      listen<ProgressPayload>(events.modProgress, ({ payload }) => {
        setProgress({ current: payload.current, total: payload.total });
        if (payload.total <= 0) {
          setModuleProgress(
            payload.current > 0
              ? `Discovering files… ${payload.current} found so far.`
              : "Discovering files in the filesystem…",
          );
          setModuleColor("info");
        } else if (payload.message) {
          setModuleProgress(payload.message);
          setModuleColor("info");
        }
      }),
      listen<ParserProgressPayload>(events.modParser, ({ payload }) => {
        setActiveStep(3);
        setParserActivity(payload);
        setModuleProgress(payload.message);
        setModuleColor(payload.phase === "failed" ? "error" : "info");
        setProgress({
          current:
            payload.phase === "started"
              ? Math.max(payload.current - 1, 0)
              : payload.current,
          total: payload.total,
        });
      }),
    ];

    return () => {
      unsubs.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [evidenceId, onComplete, status]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await invoke("cancel_processing", { evidenceId });
      setMainProgress("Stopping…");
      setMainColor("error");
      setProgress(null);
      setParserActivity(null);
      onComplete?.();
    } catch (err) {
      setCancelling(false);
      console.error("Failed to cancel processing", err);
    }
  };

  if (status >= 5) {
    return (
      <ListItem
        secondaryAction={
          <IconButton edge="end" aria-label="preview">
            <Preview />
          </IconButton>
        }
      >
        <ListItemAvatar>
          <Avatar sx={{ background: "green" }}>
            <Check />
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={evidenceName}
          secondary={
            status >= 6
              ? "Processing fully completed"
              : "Artefact parsing complete — ready for review"
          }
        />
      </ListItem>
    );
  }

  if (isCancelled(status)) {
    return (
      <ListItem>
        <ListItemAvatar>
          <Avatar sx={{ background: "warning.main" }}>
            <Warning />
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              {evidenceName} ({evidence.type})
            </Typography>
          }
          secondary={
            <Typography variant="body2" sx={{ color: "warning.main" }}>
              {cancelledPhaseLabel(status)}
            </Typography>
          }
        />
      </ListItem>
    );
  }

  return (
    <ListItem
      secondaryAction={
        <Tooltip title={cancelling ? "Stopping…" : "Cancel Processing"}>
          <span>
            <IconButton edge="end" aria-label="cancel" onClick={handleCancel} disabled={cancelling}>
              {cancelling
                ? <CircularProgress size={20} color="error" />
                : <StopCircle color="error" />}
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      <ListItemAvatar>
        <Avatar sx={{ background: "transparent" }}>
          <CircularProgress />
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={
          <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
            {evidenceName} ({evidence.type})
          </Typography>
        }
        secondary={
          <React.Fragment>
            <Typography variant="body2" gutterBottom sx={{ color: "text.secondary" }}>
              Path: {evidence.path}
            </Typography>

            {/* Pipeline phase stepper */}
            <Stepper activeStep={activeStep} sx={{ py: 1 }}>
              {PIPELINE_STEPS.map((label, idx) => (
                <Step key={label} completed={idx < activeStep}>
                  <StepLabel
                    slotProps={{
                      label: { style: { fontSize: "0.72rem" } },
                    }}
                  >
                    {label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>

            <Typography variant="body2" color={mainColor} sx={{ mt: 0.5 }}>
              {mainProgress}
            </Typography>
            <Typography variant="body2" color={moduleColor}>
              {moduleProgress}
            </Typography>

            {parserActivity && (
              <ParserActivityStatus activity={parserActivity} compact />
            )}

            {isDiscoveryPhase && progress && (
              <Box sx={{ width: "100%", mt: 1 }}>
                <LinearProgress variant="indeterminate" color="primary" />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {progress.current} files discovered
                  </Typography>
                </Box>
              </Box>
            )}
            {isIndexingPhase && progress && (
              <Box sx={{ width: "100%", mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={(progress.current / progress.total) * 100}
                  color={moduleColor === "info" ? "primary" : (moduleColor as any)}
                />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {Math.round((progress.current / progress.total) * 100)}%
                    ({progress.current}/{progress.total})
                  </Typography>
                </Box>
              </Box>
            )}
          </React.Fragment>
        }
        slotProps={{ secondary: { component: "div" } }}
      />
    </ListItem>
  );
};

export default ProcessingTask;
