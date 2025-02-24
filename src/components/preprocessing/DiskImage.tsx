import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Stepper,
  Step,
  Box,
  StepLabel,
  Typography,
  StepContent,
} from "@mui/material";
import CircularProgress from "@mui/material/CircularProgress";
import CustomStepIcon from "./icons/CustomStepIcon";
import {
  EvidenceData,
  ProcessedEvidenceMetadata,
  ExtractionModule,
  Partitions,
  MBRPartitionEntry,
} from "../../dbutils/types";
import MBRPartitionComponent from "./MBRPartitionComponent";

interface DiskImageProps {
  evidenceData: EvidenceData;
  onComplete: (metadata: ProcessedEvidenceMetadata) => void;
}

// Type for partition read results.
interface PartitionReadResult {
  partitionLabel: string;
  success: boolean;
  message: string;
}

const DiskImage: React.FC<DiskImageProps> = ({ evidenceData, onComplete }) => {
  // Step control.
  const [activeStep, setActiveStep] = useState<number>(0);
  const steps = [
    "Check Evidence Existence",
    "Autocheck Disk Image Format",
    "Partition Discovery & Selection",
    "Read Partition(s)",
    "Select Artefact Extraction Modules",
    "Finalize Metadata",
  ];

  // Data from backend calls.
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");
  const [partitions, setPartitions] = useState<Partitions | undefined>(
    undefined,
  );
  // Instead of storing partition indices, store the actual partition objects.
  const [selectedPartitions, setSelectedPartitions] = useState<
    MBRPartitionEntry[]
  >([]);
  const [extractionModules, setExtractionModules] = useState<
    ExtractionModule[]
  >([]);
  const [selectedExtractionModules, setSelectedExtractionModules] = useState<
    string[]
  >([]);
  const [partitionsLocked, setPartitionsLocked] = useState<boolean>(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  // New state to keep track of read results for each partition.
  const [partitionReadResults, setPartitionReadResults] = useState<
    PartitionReadResult[]
  >([]);

  // -------------------------------
  // Auto Steps: 0 & 1 (Evidence Existence and Disk Image Format)
  // -------------------------------
  const runAutoStep = async (step: number) => {
    if (step === 0) {
      try {
        const exists: boolean = await invoke("check_evidence_exists", {
          path: evidenceData.evidenceLocation,
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
          path: evidenceData.evidenceLocation,
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

  // Automatically run auto steps.
  useEffect(() => {
    if (activeStep < 2) {
      runAutoStep(activeStep);
    }
  }, [activeStep]);

  // -------------------------------
  // Partition Discovery on merged step (Step 2)
  // -------------------------------
  useEffect(() => {
    if (activeStep === 2 && !partitions) {
      const discover = async () => {
        try {
          const discovered: Partitions = await invoke("discover_partitions", {
            path: evidenceData.evidenceLocation,
          });
          setPartitions(discovered);
          setCurrentError(null);
        } catch (error) {
          console.error("Error during partition discovery:", error);
          setCurrentError("Error during partition discovery.");
        }
      };
      discover();
    }
  }, [activeStep, partitions, evidenceData.evidenceLocation]);

  // -------------------------------
  // Automatically read partitions (Step 3)
  // -------------------------------
  useEffect(() => {
    // When reaching step 3 and if no read result exists yet, auto-trigger the partition reading.
    if (
      activeStep === 3 &&
      partitionReadResults.length === 0 &&
      selectedPartitions.length > 0
    ) {
      const readPartitions = async () => {
        const results: PartitionReadResult[] = [];
        for (let i = 0; i < selectedPartitions.length; i++) {
          const partition = selectedPartitions[i];
          try {
            const res = await invoke("read_mbr_partition", {
              partition,
              path: evidenceData.evidenceLocation,
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
                message: res as string,
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
    selectedPartitions,
    partitionReadResults.length,
    evidenceData.evidenceLocation,
  ]);

  // -------------------------------
  // Manual Steps Handlers (Steps 2-5)
  // -------------------------------
  const handleNext = async () => {
    setCurrentError(null);

    if (activeStep === 2) {
      // Ensure at least one partition is selected.
      if (selectedPartitions.length === 0) {
        setCurrentError("No partition selected.");
        return;
      }
      // Lock partition selection so it can't be changed later.
      setPartitionsLocked(true);
    } else if (activeStep === 3) {
      // In step 3, wait for partition reading to complete.
      if (partitionReadResults.length === 0) {
        setCurrentError("Still reading partitions, please wait...");
        return;
      }
      // Ensure at least one partition was read successfully.
      if (!partitionReadResults.some((r) => r.success)) {
        setCurrentError(
          "None of the selected partitions were successfully read.",
        );
        return;
      }
    } else if (activeStep === 4) {
      // Ensure at least one extraction module is selected.
      if (selectedExtractionModules.length === 0) {
        setCurrentError("No extraction modules selected.");
        return;
      }
    } else if (activeStep === 5) {
      // Finalize metadata.
      if (selectedPartitions.length === 0) {
        setCurrentError("No partition selected.");
        return;
      }
      const metadata: ProcessedEvidenceMetadata = {
        evidenceData,
        diskImageFormat,
        selectedPartitions: selectedPartitions,
        extractionModules: extractionModules.filter((mod) =>
          selectedExtractionModules.includes(mod.id),
        ),
      };
      onComplete(metadata);
      return;
    }
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setCurrentError(null);
    if (activeStep === 3) {
      // Optionally, clear partition read results if going back from step 3.
      setPartitionReadResults([]);
      // Unlock partition selection to allow modifications.
      setPartitionsLocked(false);
    }
    setActiveStep((prev) => prev - 1);
  };

  // -------------------------------
  // When reaching the extraction modules step, fetch modules if not already done.
  // -------------------------------
  useEffect(() => {
    if (
      activeStep === 4 &&
      selectedPartitions.length > 0 &&
      extractionModules.length === 0
    ) {
      const fetchModules = async () => {
        try {
          let modulesCombined: ExtractionModule[] = [];
          for (const partition of selectedPartitions) {
            const modules: ExtractionModule[] = await invoke(
              "get_extraction_modules",
              { partition },
            );
            modulesCombined = modulesCombined.concat(modules);
          }
          // Deduplicate modules by id.
          const uniqueModules = modulesCombined.reduce(
            (acc: ExtractionModule[], mod: ExtractionModule) => {
              if (!acc.some((m) => m.id === mod.id)) {
                acc.push(mod);
              }
              return acc;
            },
            [],
          );
          setExtractionModules(uniqueModules);
        } catch (error) {
          console.error("Error fetching extraction modules:", error);
          setCurrentError("Error fetching extraction modules.");
        }
      };
      fetchModules();
    }
  }, [activeStep, selectedPartitions, extractionModules.length]);

  // For displaying discovered partitions count.
  const allPartitionsCount = partitions
    ? partitions.mbr.partition_table.length + partitions.ebr.length
    : 0;

  // -------------------------------
  // Step Content Renderer
  // -------------------------------
  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Typography variant="body1">
            Checked evidence existence at: {evidenceData.evidenceLocation}
          </Typography>
        );
      case 1:
        return (
          <Typography variant="body1">
            Disk image format: {diskImageFormat || "Checking..."}
          </Typography>
        );
      case 2:
        return (
          <Box>
            {partitions ? (
              <>
                <Typography variant="body1">
                  Partition discovery: Found {allPartitionsCount} partition(s).
                </Typography>
                <Typography variant="body2">
                  Please select the partition(s) to analyse.
                </Typography>
                <MBRPartitionComponent
                  partitions={partitions}
                  locked={partitionsLocked} // Pass the lock flag here
                  onSelectPartitions={(selected) =>
                    setSelectedPartitions(selected)
                  }
                />
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
                    color={result.success ? "success" : "warning"}
                  >
                    {result.partitionLabel}:{" "}
                    {result.success ? "Success" : `${result.message}`}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        );
      case 4:
        return (
          <Box>
            <Typography variant="body1">
              Select artefact extraction modules for the chosen partition(s):
            </Typography>
            {extractionModules.length === 0 ? (
              <Typography variant="body2">Loading modules...</Typography>
            ) : (
              <Box>
                {extractionModules.map((module) => (
                  <Box key={module.id} sx={{ my: 1 }}>
                    <Button
                      variant={
                        selectedExtractionModules.includes(module.id)
                          ? "contained"
                          : "outlined"
                      }
                      onClick={() => {
                        setSelectedExtractionModules((prev) =>
                          prev.includes(module.id)
                            ? prev.filter((id) => id !== module.id)
                            : [...prev, module.id],
                        );
                      }}
                    >
                      {module.name} - {module.description}
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      case 5:
        return (
          <Box>
            <Typography variant="body1">
              Review and finalize metadata:
            </Typography>
            <Typography variant="body2">
              <strong>Evidence Name:</strong> {evidenceData.evidenceName}
            </Typography>
            <Typography variant="body2">
              <strong>Disk Image Format:</strong> {diskImageFormat}
            </Typography>
            {selectedPartitions.length > 0 && (
              <Typography variant="body2">
                <strong>Selected Partition(s):</strong>{" "}
                {selectedPartitions
                  .map((_, i) => `Partition ${i + 1}`)
                  .join(", ")}
              </Typography>
            )}
            <Typography variant="body2">
              <strong>Selected Extraction Modules:</strong>{" "}
              {selectedExtractionModules.join(", ")}
            </Typography>
          </Box>
        );
      default:
        return <Typography variant="body1">Unknown step.</Typography>;
    }
  };

  // -------------------------------
  // Component Render
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
      {activeStep >= 3 && (
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          style={{ marginRight: "10px" }}
        >
          Back
        </Button>
      )}
      {activeStep >= 2 && (
        <Button variant="contained" color="primary" onClick={handleNext}>
          {activeStep === steps.length - 1 ? "Finish" : "Next"}
        </Button>
      )}
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
