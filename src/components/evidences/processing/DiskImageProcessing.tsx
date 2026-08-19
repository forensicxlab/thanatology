import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import { useAiConfigStore } from "../../../store/aiConfigStore";
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
import ProcessingParticlesView from "./ProcessingParticlesView";
import { appLocalDataDir } from "@tauri-apps/api/path";
import {
  getSelectedPartitions,
  setProcessingInProgress,
} from "../../../dbutils/sqlite";
import { invoke } from "@tauri-apps/api/core";
import { useSnackbar } from "../../SnackbarProvider";
import { useNavigate } from "react-router";
import { getEvidenceStatusInfo } from "../../../dbutils/evidenceStatus";

interface DiskImageProcessingProps {
  evidence: Evidence;
  setEvidence: React.Dispatch<React.SetStateAction<Evidence | null>>;
}

const DiskImageProcessing: React.FC<DiskImageProcessingProps> = ({
  evidence,
  setEvidence,
}) => {
  const { display_message } = useSnackbar();
  const navigate = useNavigate();
  const { config: aiConfigStore, loadConfig } = useAiConfigStore();

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const [mbrPartitions, setMbrPartitions] = useState<MBRPartitionEntry[]>([]);
  const [gptPartitions, setGptPartitions] = useState<GPTPartitionEntry[]>([]);
  const [processing, setProcessing] = useState<boolean>(false);

  const [mainDbPath, setMainDbPath] = useState<string>("");
  const [evidenceDbPath, setEvidenceDbPath] = useState<string>("");

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

        const baseDir = await appLocalDataDir();
        setMainDbPath(`${baseDir}/thanatology.db`);
        setEvidenceDbPath(`${baseDir}/evidences/${evidence.id}.db`);
      } catch (error) {
        console.error("Error fetching processing data", error);
        display_message("error", "Error fetching processing data");
      }
    }
    fetchPartitions();
  }, [evidence, display_message]);

  async function fetchEvidence() {
    try {
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

  useEffect(() => {
    setProcessing(evidence.status >= 2 && evidence.status < 5);
    return;
  }, [display_message, evidence.status]);

  const handleStartProcessing = async () => {
    if (!evidence) {
      display_message("info", "Evidence data is not loaded yet.");
      return;
    }
    if (!mainDbPath || !evidenceDbPath) {
      display_message("error", "Database paths are not ready yet.");
      return;
    }

    const metadata: ProcessedEvidenceMetadata = {
      evidenceData: evidence,
      diskImageFormat: "",
      selectedMbrPartitions: mbrPartitions,
      selectedGptPartitions: gptPartitions,
    };

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
      const aiConfig = aiConfigStore;

      await invoke("process_partitions", {
        evidenceId: evidence.id,
        mainDbPath: mainDbPath,
        evidenceDbPath: evidenceDbPath,
        aiConfig: aiConfig,
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

  const handleReviewEvidence = async () => {
    const statusInfo = getEvidenceStatusInfo(evidence.status);
    if (!statusInfo.isReviewable) {
      display_message(
        "warning",
        statusInfo.blockedReason ?? "Artefact parsing has not completed yet.",
      );
      return;
    }
    try {
      const exists: boolean = await invoke("check_evidence_exists", {
        path: evidence.path,
      });

      if (!exists) {
        display_message(
          "error",
          "The source evidence file is missing on disk. Please relink it manually.",
        );
        return;
      }

      navigate(`/evidences/investigate/${evidence.id}`);
    } catch (err) {
      display_message("error", `Error checking evidence: ${err}`);
    }
  };

  const showCompletionScreen = evidence.status >= 5;

  const processingTask =
    evidence.status >= 2 && evidence.status < 5 ? (
      <ProcessingParticlesView
        evidence={evidence}
        onComplete={fetchEvidence}
      />
    ) : null;

  if (showCompletionScreen) {
    return (
      <Box sx={{ textAlign: "center", mt: 4 }}>
          <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
          <Typography variant="h5" gutterBottom>
            Evidence Ready for Review
          </Typography>
          <Typography variant="body1">
            Artefact parsing is complete. You can review the evidence while any
            remaining AI specialist analysis continues in the background.
          </Typography>
          <Box sx={{ mt: 3 }}>
            <Button variant="contained" onClick={handleReviewEvidence}>
              Review Evidence
            </Button>
          </Box>
        </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, p: 2 }}>
      {!processing && mbrPartitions && mbrPartitions.length > 0 && (
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

      {!processing && gptPartitions && gptPartitions.length > 0 && (
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

      {processingTask}
      <Box sx={{ textAlign: "center", mt: 2 }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleStartProcessing}
          disabled={processing}
        >
          {processing ? "Processing..." : "Start Processing"}
        </Button>
      </Box>
    </Box>
  );
};

export default DiskImageProcessing;
