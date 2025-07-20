import React, { useEffect, useState } from "react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { listen } from "@tauri-apps/api/event";

interface ProcessingTaskProps {
  /** The evidence ID you are currently processing */
  evidenceId: number;
  /** Optional callback fired when `main_progress_success_*` arrives */
  onComplete?: () => void;
}

const ProcessingTask: React.FC<ProcessingTaskProps> = ({
  evidenceId,
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

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Module Execution
      </Typography>

      <Box sx={{ width: "100%", mt: 1 }}>
        <Typography variant="subtitle1" color={mainColor}>
          {mainProgress}
        </Typography>

        <Typography variant="caption" color={moduleColor}>
          {moduleProgress}
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProcessingTask;
