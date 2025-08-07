import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import Grid from "@mui/material/Grid";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  Evidence,
  GPTPartitionEntry,
  MBRPartitionEntry,
  ProcessedEvidenceMetadata,
} from "../../../dbutils/types";
import MBRPartition from "../common/MBRPartition";
import GPTPartition from "../common/GPTPartition";
import ProcessingTask from "./ProcessingTask";
import { appLocalDataDir } from "@tauri-apps/api/path";
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
  const [processing, setProcessing] = useState<boolean>(false);
  const [dbPath, setDbPath] = useState<string>("");

  useEffect(() => {
    async function fetchPartitions() {
      try {
        const fetchedPartitions = await getSelectedPartitions(
          evidence.id,
          null,
        );

        const mbrRows: MBRPartitionEntry[] = fetchedPartitions.mbrRows.map(
          (row: any) => ({
            id: row.evidence_id,
            boot_indicator: row.boot_indicator,
            start_chs: JSON.parse(row.start_chs),
            end_chs: JSON.parse(row.end_chs),
            partition_type: row.partition_type,
            start_lba: row.start_lba,
            size_sectors: row.size_sectors,
            sector_size: row.sector_size,
            first_byte_addr: row.first_byte_addr,
            description: row.description,
          }),
        );

        setMbrPartitions(mbrRows);
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

    return;
  }, [display_message]);

  const handleStartProcessing = async () => {
    if (!evidence) {
      display_message("info", "Evidence data is not loaded yet.");
      return;
    }

    if (mbrPartitions.length === 0 && gptPartitions.length === 0) {
      display_message("info", "No partitions selected for processing.");
      return;
    }

    // Build a minimal metadata object for updating evidence status
    const metadata: ProcessedEvidenceMetadata = {
      evidenceData: evidence,
      diskImageFormat: "", // This could be set via check_disk_image_format if needed.
      selectedMbrPartitions: mbrPartitions,
      selectedGptPartitions: gptPartitions,
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
      await invoke("process_partitions", {
        dbPath: dbPath,
        evidenceId: evidence.id,
      });
    } catch (err) {
      console.error("Error invoking process_partitions", err);
      display_message(
        "error",
        "An error occurred while starting the processing task.",
      );
      setProcessing(false);
    }
  };

  // If processing is complete, display a dedicated completion screen
  if (evidence.status === 3) {
    return (
      <Box sx={{ textAlign: "center", mt: 4 }}>
        <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
        <Typography variant="h5" gutterBottom>
          Disk Indexing Completed
        </Typography>
        <Typography variant="body1">
          The indexation process of the evidence is now completed. You can
          already start your investigation while the other modules are running.
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
        <ProcessingTask
          status={evidence.status}
          evidenceName={evidence.name}
          evidenceId={evidence.id}
          onComplete={fetchEvidence}
        />
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
