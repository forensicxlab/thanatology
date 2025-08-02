import React, { useEffect, useState } from "react";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import { listen } from "@tauri-apps/api/event";
import Avatar from "@mui/material/Avatar";
import { CircularProgress } from "@mui/material";
import IconButton from "@mui/material/IconButton";

import { Check, Preview } from "@mui/icons-material";

interface ProcessingTaskProps {
  /** The evidence ID you are currently processing */
  evidenceId: number;
  evidenceName: string;
  /** Optional callback fired when `main_progress_success_*` arrives */
  status: number;
  onComplete?: () => void;
}

const ProcessingTask: React.FC<ProcessingTaskProps> = ({
  evidenceId,
  evidenceName,
  status,
  onComplete,
}) => {
  const [mainProgress, setMainProgress] = useState("");
  const [mainColor, setMainColor] = useState<
    "info" | "secondary" | "error" | "success"
  >("info");
  const [moduleProgress, setModuleProgress] = useState("");
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

  return status < 5 ? (
    <ListItem>
      <ListItemAvatar>
        <Avatar sx={{ background: "transparent" }}>
          <CircularProgress />
        </Avatar>
      </ListItemAvatar>
      <ListItemText primary={mainProgress} secondary={moduleProgress} />
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
      <ListItemText primary={evidenceName} secondary="Finished" />
    </ListItem>
  );
};

export default ProcessingTask;
