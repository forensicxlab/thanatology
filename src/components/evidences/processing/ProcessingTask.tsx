import React, { useEffect, useState } from "react";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import { listen } from "@tauri-apps/api/event";
import Avatar from "@mui/material/Avatar";
import { CircularProgress, Tooltip } from "@mui/material";
import IconButton from "@mui/material/IconButton";

import { Check, Preview, StopCircle } from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { Evidence } from "../../../dbutils/types";
import Typography from "@mui/material/Typography";

interface ProcessingTaskProps {
  evidence: Evidence;
  onComplete?: () => void;
}

const ProcessingTask: React.FC<ProcessingTaskProps> = ({
  evidence,
  onComplete,
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

  useEffect(() => {
    /* -------- event names tied to this evidence ------- */
    const events = {
      mainInfo: `main_progress_info_${evidenceId}`,
      mainSuccess: `main_progress_success_${evidenceId}`,
      mainError: `main_progress_error_${evidenceId}`,
      modInfo: `module_progress_info_${evidenceId}`,
      modSuccess: `module_progress_success_${evidenceId}`,
      modError: `module_progress_error_${evidenceId}`,
    };

    /* -------- listeners + automatic cleanup ----------- */
    const unsubs: Promise<() => void>[] = [
      listen<any>(events.mainInfo, ({ payload }) => {
        setMainProgress(payload);
        setMainColor("secondary");
      }),
      listen<any>(events.mainSuccess, ({ payload }) => {
        setMainProgress(payload);
        setMainColor("success");
        onComplete?.();
      }),
      listen<any>(events.mainError, ({ payload }) => {
        setMainProgress(payload);
        setMainColor("error");
      }),
      listen<any>(events.modInfo, ({ payload }) => {
        setModuleProgress(payload);
        setModuleColor("info");
      }),
      listen<any>(events.modSuccess, ({ payload }) => {
        setModuleProgress(payload);
        setModuleColor("success");
      }),
      listen<any>(events.modError, ({ payload }) => {
        setModuleProgress(payload);
        setModuleColor("error");
      }),
    ];

    return () => {
      unsubs.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [evidenceId, onComplete]);

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
          <Typography variant="subtitle1" fontWeight="bold">
            {evidenceName} ({evidence.type})
          </Typography>
        }
        secondary={
          <React.Fragment>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Path: {evidence.path}
            </Typography>
            <Typography variant="body2" color={mainColor}>
              {mainProgress}
            </Typography>
            <Typography variant="body2" color={moduleColor}>
              {moduleProgress}
            </Typography>
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
