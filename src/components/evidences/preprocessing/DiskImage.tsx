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

import {
  Evidence,
  ProcessedEvidenceMetadata,
  Module,
  Partitions,
  MBRPartitionEntry,
} from "../../../dbutils/types";
import { useSnackbar } from "../../SnackbarProvider";

import MBRPartitionComponent from "./MBRPartitionComponent";
import {
  getMBRCompatibleModules,
  savePreprocessingMetadata,
} from "../../../dbutils/sqlite";
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

  const steps = [
    "Check Evidence Existence",
    "Autocheck Disk Image Format",
    "Partition Discovery & Selection",
    "Read Partition(s)",
    "Finalize Metadata",
  ];

  // Tracks which step is visible
  const [activeStep, setActiveStep] = useState<number>(0);

  // Disk image info
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");

  // Partition selection
  const [partitions, setPartitions] = useState<Partitions | undefined>(
    undefined,
  );
  const [selectedMbrPartitions, setSelectedMbrPartitions] = useState<
    MBRPartitionEntry[]
  >([]);
  const [partitionsLocked, setPartitionsLocked] = useState<boolean>(false);

  // Partition read results
  const [partitionReadResults, setPartitionReadResults] = useState<
    PartitionReadResult[]
  >([]);

  // Extraction modules
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
    (selected: MBRPartitionEntry[]) => {
      setSelectedMbrPartitions((prev) => {
        if (prev.length === selected.length) {
          const allSame = prev.every((item, idx) => item === selected[idx]);
          if (allSame) {
            return prev;
          }
        }
        return selected;
      });
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
  // Step 3: Read Selected Partitions
  // -------------------------------
  useEffect(() => {
    if (
      activeStep === 3 &&
      partitionReadResults.length === 0 &&
      selectedMbrPartitions.length > 0
    ) {
      const readPartitions = async () => {
        const results: PartitionReadResult[] = [];
        for (let i = 0; i < selectedMbrPartitions.length; i++) {
          const partition = selectedMbrPartitions[i];
          try {
            const res = await invoke("read_mbr_partition", {
              partition,
              path: evidenceData.path,
            });
            if (res === true) {
              results.push({
                partitionLabel: `Partition ${i + 1} (${partition.description})`,
                success: true,
                message: "Success",
              });
            } else {
              results.push({
                partitionLabel: `Partition ${i + 1} (${partition.description})`,
                success: false,
                message: String(res),
              });
            }
          } catch (error: any) {
            results.push({
              partitionLabel: `Partition ${i + 1} (${partition.description})`,
              success: false,
              message: error.toString(),
            });
          }
        }
        setPartitionReadResults(results);
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
      if (selectedMbrPartitions.length === 0) {
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
  // Step 4: Fetch Modules
  // -------------------------------
  useEffect(() => {
    if (activeStep === 4 && selectedMbrPartitions.length > 0) {
      const fetchModules = async () => {
        try {
          const modulesPromises = selectedMbrPartitions.map((partition) =>
            getMBRCompatibleModules(partition, database)
              .then((modules) => modules || [])
              .catch((error: any) => {
                console.error(error);
                display_message("warning", String(error));
                return [];
              }),
          );
          const modulesArrays = await Promise.all(modulesPromises);
          const combinedModules = modulesArrays.flat();
          // Remove duplicates by ID
          const uniqueModules = Array.from(
            new Map(combinedModules.map((mod) => [mod.id, mod])).values(),
          );
          setExtractionModules(uniqueModules);
          setSelectedExtractionModules(uniqueModules.map((mod) => mod.id));
        } catch (error) {
          console.error("Error fetching extraction modules:", error);
          setCurrentError("Error fetching extraction modules.");
        }
      };
      fetchModules();
    }
  }, [activeStep, selectedMbrPartitions, database, display_message]);

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

  // Called when user clicks "Launch Processing Action"
  const handleLaunchProcessing = async () => {
    try {
      const resp: string = await invoke("default_processing_action", {
        evidenceId: evidenceData.id,
      });
      display_message("info", `Processing response: ${resp}`);
    } catch (err) {
      console.error("Error launching default processing:", err);
      display_message("error", "Could not launch processing action.");
    }
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
    ? partitions.mbr.partition_table.length + partitions.ebr.length
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
                      Please select the partition(s) to analyze.
                    </Typography>
                    <MBRPartitionComponent
                      partitions={partitions}
                      locked={partitionsLocked}
                      onSelectPartitions={handleSelectPartitions}
                    />
                  </>
                ) : (
                  <Typography variant="body2">
                    Partition selection completed. Selected partition(s):{" "}
                    {selectedMbrPartitions
                      .map(
                        (part, i) => `Partition ${i + 1} (${part.description})`,
                      )
                      .join(", ")}
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
      case 4:
        // Show modules for final review
        const modulesByParent = extractionModules.reduce(
          (acc, mod) => {
            const key = (mod.parent_id ?? 0).toString();
            if (!acc[key]) {
              acc[key] = [];
            }
            acc[key].push(mod);
            return acc;
          },
          {} as Record<string, Module[]>,
        );

        return (
          <Box>
            <Typography variant="body1">
              Artifact extraction modules for the chosen partition(s):
            </Typography>
            {extractionModules.length === 0 ? (
              <Typography variant="body2">Loading modules...</Typography>
            ) : (
              renderModuleList(modulesByParent)
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
            onClick={handleLaunchProcessing}
            sx={{ mr: 2 }}
          >
            Launch Processing Action
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              onComplete({
                evidenceData,
                diskImageFormat,
                selectedMbrPartitions,
                extractionModules: extractionModules.filter((mod) =>
                  selectedExtractionModules.includes(mod.id),
                ),
              })
            }
          >
            Go Back to the Case
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

      {activeStep >= 2 && activeStep < steps.length - 1 && (
        <Button
          variant="contained"
          color="primary"
          onClick={handleNext}
          disabled={
            (activeStep === 2 && selectedMbrPartitions.length === 0) ||
            (activeStep === 2 && currentError !== null)
          }
        >
          Next
        </Button>
      )}

      {/* Show "Finish" only on last step (4) */}
      {activeStep === steps.length - 1 && (
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
