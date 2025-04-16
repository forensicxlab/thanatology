import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Stepper,
  Step,
  Box,
  StepLabel,
  Typography,
  StepContent,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
import ComputerIcon from "@mui/icons-material/Computer";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { useNavigate } from "react-router";

import {
  Evidence,
  ProcessedEvidenceMetadata,
  Module,
  Partitions,
  MBRPartitionEntry,
  GPTPartitionEntry,
} from "../../../dbutils/types";
import { useSnackbar } from "../../SnackbarProvider";

import PartitionComponent from "./PartitionsComponent";
import { savePreprocessingMetadata } from "../../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";

interface DiskImageProps {
  database: Database | null;
  evidenceData: Evidence; // MUST have an 'id' that exists in DB
  onComplete: (metadata: ProcessedEvidenceMetadata) => void;
}

interface PartitionReadResult {
  partitionLabel: string;
  success: boolean;
  message: string;
}

const DiskImage: React.FC<DiskImageProps> = ({
  database,
  evidenceData,
  onComplete,
}) => {
  const { display_message } = useSnackbar();
  const navigate = useNavigate();

  const steps = [
    "Check Evidence Existence",
    "Autocheck Disk Image Format",
    "Partition Discovery & Selection",
    "Read Partition(s)",
  ];

  // Tracks which step is visible
  const [activeStep, setActiveStep] = useState<number>(0);

  // Disk image info
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");

  // Partition selection
  const [partitions, setPartitions] = useState<Partitions | undefined>(
    undefined,
  );
  // MBR + GPT
  const [selectedMbrPartitions, setSelectedMbrPartitions] = useState<
    MBRPartitionEntry[]
  >([]);
  const [selectedGptPartitions, setSelectedGptPartitions] = useState<
    GPTPartitionEntry[]
  >([]);
  const [partitionsLocked, setPartitionsLocked] = useState<boolean>(false);

  // Partition read results
  const [partitionReadResults, setPartitionReadResults] = useState<
    PartitionReadResult[]
  >([]);

  const [extractionModules, setExtractionModules] = useState<Module[]>([]);
  const [selectedExtractionModules, setSelectedExtractionModules] = useState<
    string[]
  >([]);

  // Tracks general error states during steps
  const [currentError, setCurrentError] = useState<string | null>(null);

  // Tracks final insertion state: idle, loading, success, or error
  const [finalInsertStatus, setFinalInsertStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  // -------------------------------
  // Partition selection callback
  // -------------------------------
  const handleSelectPartitions = useCallback(
    (
      mbrPartitions: MBRPartitionEntry[],
      gptPartitions: GPTPartitionEntry[],
    ) => {
      setSelectedMbrPartitions(mbrPartitions);
      setSelectedGptPartitions(gptPartitions);
    },
    [],
  );

  // -------------------------------
  // Step 0 & 1 (Auto): Check existence & Format
  // -------------------------------
  const runAutoStep = async (step: number) => {
    if (step === 0) {
      try {
        const exists: boolean = await invoke("check_evidence_exists", {
          path: evidenceData.path,
        });
        if (!exists) {
          setCurrentError("Evidence not found at the specified location.");
        } else {
          setCurrentError(null);
          setActiveStep(1);
        }
      } catch (error) {
        console.error("Error checking evidence existence:", error);
        setCurrentError(`Error checking evidence existence: ${error}`);
      }
    } else if (step === 1) {
      try {
        const format: string = await invoke("check_disk_image_format", {
          path: evidenceData.path,
        });
        setDiskImageFormat(format);
        setCurrentError(null);
        setActiveStep(2);
      } catch (error) {
        console.error("Error in disk image format check:", error);
        setCurrentError(`Error in disk image format check: ${error}`);
      }
    }
  };

  useEffect(() => {
    if (activeStep < 2) {
      runAutoStep(activeStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  // -------------------------------
  // Step 2: Partition Discovery
  // -------------------------------
  useEffect(() => {
    if (activeStep === 2 && !partitions) {
      const discover = async () => {
        try {
          const discovered: Partitions = await invoke("discover_partitions", {
            path: evidenceData.path,
          });
          setPartitions(discovered);
          setCurrentError(null);
        } catch (error) {
          console.error("Error during partition discovery:", error);
          setCurrentError(`An error during partition discovery: ${error}`);
        }
      };
      discover();
    }
  }, [activeStep, partitions, evidenceData.path]);

  // -------------------------------
  // Step 3: Read Selected Partitions (MBR + GPT)
  // -------------------------------
  useEffect(() => {
    if (activeStep === 3 && partitionReadResults.length === 0) {
      // If user hasn't selected anything, bail
      if (
        selectedMbrPartitions.length === 0 &&
        selectedGptPartitions.length === 0
      ) {
        setCurrentError("No partition selected.");
        return;
      }

      const readPartitions = async () => {
        const results: PartitionReadResult[] = [];

        // 1) Read MBR
        for (let i = 0; i < selectedMbrPartitions.length; i++) {
          const partition = selectedMbrPartitions[i];
          try {
            const res = await invoke("read_mbr_partition", {
              partition,
              path: evidenceData.path,
            });
            if (res === true) {
              results.push({
                partitionLabel: `MBR Partition ${i + 1} (${partition.description})`,
                success: true,
                message: "Success",
              });
            } else {
              results.push({
                partitionLabel: `MBR Partition ${i + 1} (${partition.description})`,
                success: false,
                message: String(res),
              });
            }
          } catch (error: any) {
            results.push({
              partitionLabel: `MBR Partition ${i + 1} (${partition.description})`,
              success: false,
              message: error.toString(),
            });
          }
        }

        // 2) Read GPT
        for (let i = 0; i < selectedGptPartitions.length; i++) {
          const partition = selectedGptPartitions[i];
          try {
            const res = await invoke("read_gpt_partition", {
              partition,
              path: evidenceData.path,
            });
            if (res === true) {
              results.push({
                partitionLabel: `GPT Partition ${i + 1} (${partition.description})`,
                success: true,
                message: "Success",
              });
            } else {
              results.push({
                partitionLabel: `GPT Partition ${i + 1} (${partition.description})`,
                success: false,
                message: String(res),
              });
            }
          } catch (error: any) {
            results.push({
              partitionLabel: `GPT Partition ${i + 1} (${partition.description})`,
              success: false,
              message: error.toString(),
            });
          }
        }

        setPartitionReadResults(results);

        // If none succeeded, set an error
        if (!results.some((r) => r.success)) {
          setCurrentError(
            "None of the selected partitions were successfully read.",
          );
        } else {
          setCurrentError(null);
        }
      };
      readPartitions();
    }
  }, [
    activeStep,
    selectedMbrPartitions,
    selectedGptPartitions,
    partitionReadResults.length,
    evidenceData.path,
  ]);

  // -------------------------------
  // Step Navigation
  // -------------------------------
  const handleNext = async () => {
    setCurrentError(null);

    // Validate current step
    if (activeStep === 2) {
      if (
        selectedMbrPartitions.length === 0 &&
        selectedGptPartitions.length === 0
      ) {
        setCurrentError("No partition selected.");
        return;
      }
      // Lock partitions before going forward
      setPartitionsLocked(true);
    } else if (activeStep === 3) {
      if (partitionReadResults.length === 0) {
        setCurrentError("Still reading partitions, please wait...");
        return;
      }
      if (!partitionReadResults.some((r) => r.success)) {
        setCurrentError(
          "None of the selected partitions were successfully read.",
        );
        return;
      }
    }

    // Move to the next step
    setActiveStep((prev) => prev + 1);
  };

  // Going backwards (allow re-selection, re-reading, etc.)
  const handleBack = () => {
    setCurrentError(null);
    if (activeStep === 3) {
      // In case user wants to reselect partitions
      setPartitionReadResults([]);
      setPartitionsLocked(false);
    }
    setActiveStep((prev) => prev - 1);
  };

  // -------------------------------
  // Final step: handle "Finish"
  // -------------------------------
  const handleFinish = async () => {
    setFinalInsertStatus("loading");
    setCurrentError(null);

    const metadata: ProcessedEvidenceMetadata = {
      evidenceData,
      diskImageFormat,
      selectedMbrPartitions,
      selectedGptPartitions, // ← Include the GPT selection here
      extractionModules: extractionModules.filter((mod) =>
        selectedExtractionModules.includes(mod.id),
      ),
    };

    // 1) Save metadata to DB
    savePreprocessingMetadata(metadata, database)
      .then(() => {
        setFinalInsertStatus("success");
      })
      .catch((err: any) => {
        console.error("Error saving preprocessing metadata:", err);
        display_message("error", `Error saving metadata: ${err.message}`);
        setFinalInsertStatus("error");
      });
  };

  // -------------------------------
  // Helpers for Nested List Rendering
  // -------------------------------
  const getModuleIcon = (os: string) => {
    if (os.toLowerCase() === "linux") {
      return <TerminalIcon sx={{ mr: 1 }} />;
    }
    return <ComputerIcon sx={{ mr: 1 }} />;
  };

  const renderModuleList = (
    modulesByParent: Record<string, Module[]>,
    parentId: string = "0",
  ) => {
    if (!modulesByParent[parentId]) return null;
    return (
      <List disablePadding>
        {modulesByParent[parentId].map((mod) => (
          <React.Fragment key={mod.id}>
            <ListItem disablePadding>
              {getModuleIcon(mod.os)}
              <ListItemText
                primary={`${mod.name}`}
                secondary={`${mod.description}`}
              />
            </ListItem>
            <Divider component="li" />
            {modulesByParent[mod.id.toString()] && (
              <Box sx={{ pl: 4 }}>
                {renderModuleList(modulesByParent, mod.id.toString())}
              </Box>
            )}
          </React.Fragment>
        ))}
      </List>
    );
  };

  // -------------------------------
  // Step Content
  // -------------------------------
  const allPartitionsCount = partitions
    ? partitions.mbr.partition_table.length +
      partitions.ebr.length +
      (partitions.gpt?.partition_entries?.length || 0)
    : 0;

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Typography variant="body1">
            Checked evidence existence at: {evidenceData.path}
          </Typography>
        );
      case 1:
        return (
          <Typography variant="body1">
            Disk image format: {diskImageFormat || "Checking..."}
          </Typography>
        );
      case 2:
        if (currentError) {
          return <Typography variant="body1">{steps[2]}</Typography>;
        }
        return (
          <Box>
            {partitions ? (
              <>
                <Typography variant="body1">
                  Partition discovery: Found {allPartitionsCount} partition(s).
                </Typography>
                {!partitionsLocked ? (
                  <>
                    <Typography variant="body2">
                      Please select the partition(s) to analyze (MBR and/or
                      GPT).
                    </Typography>
                    <PartitionComponent
                      partitions={partitions}
                      locked={partitionsLocked}
                      onSelectPartitions={handleSelectPartitions}
                    />
                  </>
                ) : (
                  <Typography variant="body2">
                    Partition selection completed. MBR: [
                    {selectedMbrPartitions
                      .map(
                        (part, i) => `Partition ${i + 1} (${part.description})`,
                      )
                      .join(", ")}
                    ] GPT: [
                    {selectedGptPartitions
                      .map(
                        (part, i) =>
                          `Partition ${i + 1} (${part.partition_name})`,
                      )
                      .join(", ")}
                    ]
                  </Typography>
                )}
              </>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
                <CircularProgress size={30} />
                <Typography variant="body2" sx={{ ml: 1 }}>
                  Discovering partitions…
                </Typography>
              </Box>
            )}
          </Box>
        );
      case 3:
        return (
          <Box>
            {partitionReadResults.length === 0 ? (
              <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
                <CircularProgress size={30} />
                <Typography variant="body2" sx={{ ml: 1 }}>
                  Reading selected partition(s)…
                </Typography>
              </Box>
            ) : (
              <Box>
                {partitionReadResults.map((result, i) => (
                  <Typography
                    key={i}
                    variant="body2"
                    color={result.success ? "success.main" : "warning.main"}
                  >
                    {result.partitionLabel}:{" "}
                    {result.success ? "Success" : result.message}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        );
      default:
        return <Typography variant="body1">Unknown step.</Typography>;
    }
  };

  // -------------------------------
  // Final status UI (overrides the stepper if not "idle")
  // -------------------------------
  if (finalInsertStatus === "loading") {
    return (
      <Box display="flex" alignItems="center" flexDirection="column" mt={2}>
        <CircularProgress size={40} />
        <Typography variant="body2" sx={{ mt: 1 }}>
          Saving preprocessing metadata...
        </Typography>
      </Box>
    );
  }

  if (finalInsertStatus === "success") {
    return (
      <Box display="flex" alignItems="center" flexDirection="column" mt={2}>
        <CheckCircleIcon fontSize="large" />
        <Typography variant="h6" sx={{ mt: 1 }}>
          Preprocessing metadata saved successfully!
        </Typography>
        <Box mt={2}>
          <Button
            variant="contained"
            onClick={() => {
              navigate(`/evidences/process/${evidenceData.id}`);
            }}
            sx={{ mr: 2 }}
          >
            Launch Processing Action
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              navigate(`/cases/`);
            }}
          >
            I will start processing the evidence later.
          </Button>
        </Box>
      </Box>
    );
  }

  if (finalInsertStatus === "error") {
    return (
      <Box display="flex" alignItems="center" flexDirection="column" mt={2}>
        <CancelIcon fontSize="large" color="error" />
        <Typography variant="h6" color="error" sx={{ mt: 1 }}>
          Error saving preprocessing metadata
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Please check the logs or try again.
        </Typography>
        <Box mt={2}>
          <Button
            variant="contained"
            onClick={() => setFinalInsertStatus("idle")}
          >
            Return
          </Button>
        </Box>
      </Box>
    );
  }

  // -------------------------------
  // If finalInsertStatus is "idle", show Stepper
  // -------------------------------
  return (
    <Box>
      <Stepper activeStep={activeStep} orientation="vertical">
        {steps.map((label, idx) => (
          <Step key={idx}>
            <StepLabel error={idx === activeStep && currentError !== null}>
              {idx > activeStep ? label : getStepContent(idx)}
            </StepLabel>
            {idx <= activeStep && (
              <StepContent>
                {idx === activeStep && currentError && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2" color="error">
                      {currentError}
                    </Typography>
                    {activeStep < 2 && (
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => runAutoStep(activeStep)}
                        sx={{ mt: 1 }}
                      >
                        Retry
                      </Button>
                    )}
                  </Box>
                )}
              </StepContent>
            )}
          </Step>
        ))}
      </Stepper>

      {/* Navigation Buttons */}
      {activeStep >= 3 && activeStep < steps.length && (
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          style={{ marginRight: "10px" }}
        >
          Back
        </Button>
      )}

      {activeStep >= 2 && activeStep < steps.length && (
        <Button
          variant="contained"
          color="primary"
          onClick={handleNext}
          disabled={
            (activeStep === 2 &&
              selectedMbrPartitions.length === 0 &&
              selectedGptPartitions.length === 0) ||
            (activeStep === 2 && currentError !== null)
          }
        >
          Next
        </Button>
      )}

      {/* Keep "Finish" button */}
      {activeStep === steps.length && (
        <Button variant="contained" color="primary" onClick={handleFinish}>
          Finish
        </Button>
      )}

      {/* Auto-step circular progress if steps < 2 and no current error */}
      {activeStep < 2 && !currentError && (
        <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
          <CircularProgress size={30} />
          <Typography variant="body2" sx={{ ml: 1 }}>
            Processing…
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default DiskImage;
