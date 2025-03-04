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
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
import ComputerIcon from "@mui/icons-material/Computer";
import {
  EvidenceData,
  ProcessedEvidenceMetadata,
  Module,
  Partitions,
  MBRPartitionEntry,
} from "../../dbutils/types";
import { useSnackbar } from "../SnackbarProvider";

import MBRPartitionComponent from "./MBRPartitionComponent";
import { getMBRCompatibleModules } from "../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";

interface DiskImageProps {
  database: Database | null;
  evidenceData: EvidenceData;
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

  const [activeStep, setActiveStep] = useState<number>(0);
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");
  const [partitions, setPartitions] = useState<Partitions | undefined>(
    undefined,
  );
  const [selectedPartitions, setSelectedPartitions] = useState<
    MBRPartitionEntry[]
  >([]);
  const [extractionModules, setExtractionModules] = useState<Module[]>([]);
  const [selectedExtractionModules, setSelectedExtractionModules] = useState<
    string[]
  >([]);
  const [partitionsLocked, setPartitionsLocked] = useState<boolean>(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [partitionReadResults, setPartitionReadResults] = useState<
    PartitionReadResult[]
  >([]);

  // -------------------------------
  // Auto Steps: Evidence existence and disk image format.
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

  useEffect(() => {
    if (activeStep < 2) {
      runAutoStep(activeStep);
    }
  }, [activeStep]);

  // -------------------------------
  // Partition Discovery (Step 2)
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
  // Partition Reading (Step 3)
  // -------------------------------
  useEffect(() => {
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
  // Step Handlers
  // -------------------------------
  const handleNext = async () => {
    setCurrentError(null);

    if (activeStep === 2) {
      if (selectedPartitions.length === 0) {
        setCurrentError("No partition selected.");
        return;
      }
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
    } else if (activeStep === 4) {
      const metadata: ProcessedEvidenceMetadata = {
        evidenceData,
        diskImageFormat,
        selectedPartitions,
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
      setPartitionReadResults([]);
      setPartitionsLocked(false);
    }
    setActiveStep((prev) => prev - 1);
  };

  // -------------------------------
  // Fetch Modules (Triggered on Final Step - Step 4)
  // -------------------------------
  useEffect(() => {
    if (activeStep === 4 && selectedPartitions.length > 0) {
      const fetchModules = async () => {
        try {
          const modulesPromises = selectedPartitions.map((partition) =>
            getMBRCompatibleModules(partition, database)
              .then((modules) => modules || [])
              .catch((error: any) => {
                console.error(error);
                display_message("warning", error);
                return [];
              }),
          );
          const modulesArrays = await Promise.all(modulesPromises);
          const combinedModules = modulesArrays.flat();
          // Changed here: use mod.id as key for uniqueness rather than parent_id
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
  }, [activeStep, selectedPartitions]);

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
  // Step Content Renderer
  // -------------------------------
  const allPartitionsCount = partitions
    ? partitions.mbr.partition_table.length + partitions.ebr.length
    : 0;

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
                {!partitionsLocked ? (
                  <>
                    <Typography variant="body2">
                      Please select the partition(s) to analyse.
                    </Typography>
                    <MBRPartitionComponent
                      partitions={partitions}
                      locked={partitionsLocked}
                      onSelectPartitions={(selected) =>
                        setSelectedPartitions(selected)
                      }
                    />
                  </>
                ) : (
                  <Typography variant="body2">
                    Partition selection completed. Selected partition(s):{" "}
                    {selectedPartitions
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
                    color={result.success ? "success" : "warning"}
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
            <Box sx={{ mt: 2 }}>
              <Typography variant="body1">
                Artefact extraction modules for the chosen partition(s):
              </Typography>
              {extractionModules.length === 0 ? (
                <Typography variant="body2">Loading modules...</Typography>
              ) : (
                renderModuleList(modulesByParent)
              )}
            </Box>
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
