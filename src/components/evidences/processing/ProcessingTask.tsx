import React, { useEffect, useState } from "react";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import { listen } from "@tauri-apps/api/event";
import Avatar from "@mui/material/Avatar";
import { Box, CircularProgress, LinearProgress, Tooltip } from "@mui/material";
import IconButton from "@mui/material/IconButton";

import { Check, Preview, StopCircle } from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { Evidence } from "../../../dbutils/types";
import Typography from "@mui/material/Typography";

interface ProcessingTaskProps {
  evidence: Evidence;
  onComplete?: () => void;
  onArtefactIdentificationComplete?: () => void;
}

interface ProgressPayload {
  current: number;
  total: number;
  message?: string;
}

interface ProgressMessagePayload {
  message: string;
  status?: number;
}

function getProgressMessage(payload: string | ProgressMessagePayload): string {
  return typeof payload === "string" ? payload : payload.message;
}

const ProcessingTask: React.FC<ProcessingTaskProps> = ({
  evidence,
  onComplete,
  onArtefactIdentificationComplete,
}) => {
  const evidenceId = evidence.id;
  const evidenceName = evidence.name;
  const status = evidence.status;
  const [mainProgress, setMainProgress] = useState("");
  const [mainColor, setMainColor] = useState<
    "info" | "secondary" | "error" | "success"
  >("info");
  const [moduleProgress, setModuleProgress] = useState(
    "Processing...Waiting for status.",
  );
  const [moduleColor, setModuleColor] = useState<
    "info" | "secondary" | "error" | "success"
  >("info");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const isDiscoveryPhase = progress !== null && progress.total <= 0;
  const isIndexingPhase = progress !== null && progress.total > 0;

  useEffect(() => {
    /* -------- event names tied to this evidence ------- */
    const events = {
      mainInfo: `main_progress_info_${evidenceId}`,
      mainSuccess: `main_progress_success_${evidenceId}`,
      mainError: `main_progress_error_${evidenceId}`,
      modInfo: `module_progress_info_${evidenceId}`,
      modSuccess: `module_progress_success_${evidenceId}`,
      modError: `module_progress_error_${evidenceId}`,
      modProgress: `module_progress_progress_${evidenceId}`,
    };

    /* -------- listeners + automatic cleanup ----------- */
    const unsubs: Promise<() => void>[] = [
      listen<string | ProgressMessagePayload>(events.mainInfo, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("secondary");
      }),
      listen<string | ProgressMessagePayload>(events.mainSuccess, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("success");
        if (
          typeof payload !== "string" &&
          payload.status === 4
        ) {
          onArtefactIdentificationComplete?.();
        }
        onComplete?.();
      }),
      listen<string | ProgressMessagePayload>(events.mainError, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setMainColor("error");
      }),
      listen<string | ProgressMessagePayload>(events.modInfo, ({ payload }) => {
        console.log("[ProcessingTask] modInfo", { evidenceId, payload });
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("info");
      }),
      listen<string | ProgressMessagePayload>(events.modSuccess, ({ payload }) => {
        console.log("[ProcessingTask] modSuccess", { evidenceId, payload });
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("success");
        setProgress(null);
      }),
      listen<string | ProgressMessagePayload>(events.modError, ({ payload }) => {
        console.log("[ProcessingTask] modError", { evidenceId, payload });
        setModuleProgress(getProgressMessage(payload));
        setModuleColor("error");
        setProgress(null);
      }),
      listen<ProgressPayload>(events.modProgress, ({ payload }) => {
        console.log("[ProcessingTask] modProgress", { evidenceId, payload });
        setProgress({ current: payload.current, total: payload.total });
        if (payload.total <= 0) {
          setModuleProgress(
            payload.current > 0
              ? `Discovering files... ${payload.current} found so far.`
              : "Discovering files in the filesystem...",
          );
          setModuleColor("info");
        } else if (payload.message) {
          setModuleProgress(payload.message);
          setModuleColor("info");
        }
      }),
    ];

    return () => {
      unsubs.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [evidenceId, onArtefactIdentificationComplete, onComplete]);

  const handleCancel = async () => {
    try {
      await invoke("cancel_processing", { evidenceId });
      setModuleProgress("Cancellation requested...");
      setModuleColor("error");
    } catch (err) {
      console.error("Failed to cancel processing", err);
    }
  };

  return status < 5 ? (
    <ListItem
      secondaryAction={
        <Tooltip title="Cancel Processing">
          <IconButton edge="end" aria-label="cancel" onClick={handleCancel}>
            <StopCircle color="error" />
          </IconButton>
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
          <Typography variant="subtitle1" sx={{
            fontWeight: "bold"
          }}>
            {evidenceName} ({evidence.type})
          </Typography>
        }
        secondary={
          <React.Fragment>
            <Typography variant="body2" gutterBottom sx={{
              color: "text.secondary"
            }}>
              Path: {evidence.path}
            </Typography>
            <Typography variant="body2" color={mainColor}>
              {mainProgress}
            </Typography>
            <Typography variant="body2" color={moduleColor}>
              {moduleProgress}
            </Typography>
            {isDiscoveryPhase && progress && (
              <Box sx={{ width: "100%", mt: 1 }}>
                <LinearProgress variant="indeterminate" color="primary" />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {progress.current} files discovered
                  </Typography>
                </Box>
              </Box>
            )}
            {isIndexingPhase && progress && (
              <Box sx={{ width: '100%', mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={(progress.current / progress.total) * 100}
                  color={moduleColor === "info" ? "primary" : moduleColor as any}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total})
                  </Typography>
                </Box>
              </Box>
            )}
          </React.Fragment>
        }
      />
    </ListItem>
  ) : (
    <ListItem
      secondaryAction={
        <IconButton edge="end" aria-label="delete">
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
        secondary="Processing fully completed"
      />
    </ListItem>
  );
};

export default ProcessingTask;
