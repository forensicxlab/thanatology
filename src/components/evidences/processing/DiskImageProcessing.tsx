import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import Grid from "@mui/material/Grid2";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  Evidence,
  GPTPartitionEntry,
  MBRPartitionEntry,
  ProcessedEvidenceMetadata,
} from "../../../dbutils/types";
import MBRPartition from "./MBRPartition";
import GPTPartition from "./GPTPartition";

import { appLocalDataDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import {
  getSelectedPartitions,
  setProcessingInProgress,
} from "../../../dbutils/sqlite";
import { invoke } from "@tauri-apps/api/core";
import { useSnackbar } from "../../SnackbarProvider";

interface DiskImageProcessingProps {
  evidence: Evidence;
  setEvidence: React.Dispatch<React.SetStateAction<Evidence | null>>;
}

const DiskImageProcessing: React.FC<DiskImageProcessingProps> = ({
  evidence,
  setEvidence,
}) => {
  const { display_message } = useSnackbar();

  const [mbrPartitions, setMbrPartitions] = useState<MBRPartitionEntry[]>([]);
  const [gptPartitions, setGptPartitions] = useState<GPTPartitionEntry[]>([]);

  const [mainProgress, setMainProgress] = useState<string>("");
  const [mainProgressColor, setMainProgressColor] = useState<string>("info");
  const [moduleProgress, setModuleProgress] = useState<string>("");
  const [moduleProgressColor, setModuleProgressColor] =
    useState<string>("info");
  const [processing, setProcessing] = useState<boolean>(false);
  const [dbPath, setDbPath] = useState<string>("");

  useEffect(() => {
    async function fetchPartitions() {
      try {
        const fetchedPartitions = await getSelectedPartitions(
          evidence.id,
          null,
        );
        setMbrPartitions(fetchedPartitions.mbrRows);
        setGptPartitions(fetchedPartitions.gptRows);

        const appLocalDataDirPath = await appLocalDataDir();
        setDbPath(`${appLocalDataDirPath}/thanatology.db`);
      } catch (error) {
        console.error("Error fetching processing data", error);
        display_message("error", "Error fetching processing data");
      }
    }
    fetchPartitions();
  }, [evidence, display_message]);

  async function fetchEvidence() {
    try {
      // Fetch evidence info.
      const fetchedEvidence: Evidence = await getEvidence(
        null,
        evidence.id.toString(),
      );
      setEvidence(fetchedEvidence);
    } catch (error) {
      console.error("Error fetching processing data", error);
      display_message("error", "Error fetching processing data");
    }
  }

  // Listen for progress events from Tauri:
  useEffect(() => {
    if (evidence.status === 2) {
      setProcessing(true);
    }

    const main_progress_info_listener = listen<any>(
      `main_progress_info_${evidence.id}`,
      (event) => {
        console.log("Main info:", event.payload);
        setMainProgress(event.payload);
        setMainProgressColor("secondary");
      },
    );

    const main_progress_success_listener = listen<any>(
      `main_progress_success_${evidence.id}`,
      (event) => {
        console.log("Main success:", event.payload);
        setMainProgress(event.payload);
        setMainProgressColor("green");
        fetchEvidence();
      },
    );

    const main_progress_error_listener = listen<any>(
      `main_progress_error_${evidence.id}`,
      (event) => {
        console.log("Main error:", event.payload);
        setMainProgress(event.payload);
        setMainProgressColor("danger");
      },
    );

    const module_progress_error_listener = listen<any>(
      `module_progress_error_${evidence.id}`,
      (event) => {
        console.log("Module error:", event.payload);
        setModuleProgress(event.payload);
        setModuleProgressColor("danger");
      },
    );

    const module_progress_info_listener = listen<any>(
      `module_progress_info_${evidence.id}`,
      (event) => {
        console.log("Module info:", event.payload);
        setModuleProgress(event.payload);
        setModuleProgressColor("info");
      },
    );

    // Listen to completion of progress
    const module_progress_success_listener = listen<any>(
      `module_progress_success_${evidence.id}`,
      (event) => {
        console.log("Module success:", event.payload);
        setModuleProgress(event.payload);
        setModuleProgressColor("green");
      },
    );

    return () => {
      main_progress_info_listener.then((unlisten) => unlisten());
      main_progress_success_listener.then((unlisten) => unlisten());
      main_progress_error_listener.then((unlisten) => unlisten());
      module_progress_success_listener.then((unlisten) => unlisten());
      module_progress_error_listener.then((unlisten) => unlisten());
      module_progress_info_listener.then((unlisten) => unlisten());
    };
  }, [display_message]);

  const handleStartProcessing = async () => {
    if (!evidence) {
      display_message("info", "Evidence data is not loaded yet.");
      return;
    }

    if (mbrPartitions.length === 0) {
      display_message("info", "No partitions selected for processing.");
      return;
    }

    // Build a minimal metadata object for updating evidence status
    const metadata: ProcessedEvidenceMetadata = {
      evidenceData: evidence,
      diskImageFormat: "", // This could be set via check_disk_image_format if needed.
      selectedMbrPartitions: mbrPartitions,
      selectedGptPartitions: gptPartitions,
      extractionModules: [], // No modules since we're not iterating anymore
    };

    // Set processing status in the DB to "in progress"
    try {
      await setProcessingInProgress(null, metadata);
      await fetchEvidence();
    } catch (err) {
      console.error("Error setting processing in progress", err);
      display_message(
        "error",
        "Failed to update evidence status to in progress.",
      );
      return;
    }

    setProcessing(true);

    display_message("info", "Processing Started");

    try {
      await invoke("process_linux_partitions", {
        evidenceId: evidence.id,
        mbrPartitions: mbrPartitions,
        gptPartitions: gptPartitions,
        diskImagePath: evidence.path,
        dbPath: dbPath,
      });
    } catch (err) {
      console.error("Error invoking process_linux_partitions", err);
      display_message(
        "error",
        "An error occurred while starting the processing task.",
      );
      setProcessing(false);
    }

    // Note: Success message and processing state are handled by event listeners
  };

  // If processing is complete, display a dedicated completion screen
  if (evidence.status === 3) {
    return (
      <Box sx={{ textAlign: "center", mt: 4 }}>
        <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
        <Typography variant="h5" gutterBottom>
          Extraction Completed
        </Typography>
        <Typography variant="body1">
          The processing of the evidence is now completed.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, p: 2 }}>
      {mbrPartitions && mbrPartitions.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Selected Partitions
          </Typography>
          <Grid container spacing={1}>
            {mbrPartitions.map((p, index) => (
              <Grid size={4} key={index}>
                <MBRPartition mbrPartition={p} index={index} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {gptPartitions && gptPartitions.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Selected Partitions
          </Typography>
          <Grid container spacing={1}>
            {gptPartitions.map((p, index) => (
              <Grid size={4} key={index}>
                <GPTPartition gptPartition={p} index={index} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {evidence.status === 2 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Module Execution
          </Typography>
          <Box sx={{ width: "100%", mt: 1 }}>
            <Typography variant="subtitle1" color={mainProgressColor}>
              {mainProgress}
            </Typography>
            <Typography variant="caption" color={moduleProgressColor}>
              {moduleProgress}
            </Typography>
          </Box>
        </Paper>
      )}
      <Box sx={{ textAlign: "center", mt: 2 }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleStartProcessing}
          disabled={
            processing ||
            (mbrPartitions.length === 0 && gptPartitions.length === 0)
          }
        >
          {processing ? "Processing..." : "Start Processing"}
        </Button>
      </Box>
    </Box>
  );
};

export default DiskImageProcessing;
