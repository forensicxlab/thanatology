import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Stepper,
  Step,
  Box,
  StepLabel,
  Typography,
  FormControl,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormGroup,
  Checkbox,
  StepContent,
} from "@mui/material";
import CircularProgress from "@mui/material/CircularProgress";
import { green } from "@mui/material/colors";

import {
  EvidenceData,
  ProcessedEvidenceMetadata,
  MBRPartitionEntry,
  ExtractionModule,
} from "../../dbutils/types";

interface DiskImageProps {
  evidenceData: EvidenceData;
  onComplete: (metadata: ProcessedEvidenceMetadata) => void;
}

// -- COMPONENT

const DiskImage: React.FC<DiskImageProps> = ({ evidenceData, onComplete }) => {
  // Step control
  const [activeStep, setActiveStep] = useState<number>(0);
  const steps = [
    "Check Evidence Existence",
    "Autocheck Disk Image Format",
    "Partition Discovery",
    "Read Partition",
    "Select Artefact Extraction Modules",
    "Finalize Metadata",
  ];

  // Data coming from backend calls:
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");
  const [partitions, setPartitions] = useState<MBRPartitionEntry[]>([]);
  const [selectedPartitionIndex, setSelectedPartitionIndex] = useState<
    number | null
  >(null);
  const [extractionModules, setExtractionModules] = useState<
    ExtractionModule[]
  >([]);
  const [selectedExtractionModules, setSelectedExtractionModules] = useState<
    string[]
  >([]);

  // -------------------------------
  // Step 0: Check Evidence Existence
  // -------------------------------
  const checkEvidenceExistence = async (): Promise<boolean> => {
    try {
      // Replace with your actual API call & parameters.
      console.log(evidenceData.evidenceLocation);
      const exists: boolean = await invoke("check_evidence_exists", {
        path: evidenceData.evidenceLocation, // ensure the file has a path property
      });
      if (!exists) {
        console.error("Evidence not found at the specified location.");
      }
      return exists;
    } catch (error) {
      console.error("Error checking evidence existence:", error);
      return false;
    }
  };

  // -------------------------------
  // Step 1: Auto-check Disk Image Format
  // -------------------------------
  const checkDiskImageFormat = async (): Promise<boolean> => {
    try {
      // Assume the backend returns the format (e.g. "E01", "DD", etc.)
      const format: string = await invoke("check_disk_image_format", {
        path: evidenceData.evidenceLocation,
      });
      setDiskImageFormat(format);
      return true;
    } catch (error) {
      console.error("Error in disk image format check:", error);
      return false;
    }
  };

  // -------------------------------
  // Step 2: Partition Discovery
  // -------------------------------
  const discoverPartitions = async (): Promise<boolean> => {
    try {
      // Replace with your actual API call to discover partitions.
      const discovered: MBRPartitionEntry[] = await invoke(
        "discover_partitions",
        {
          path: evidenceData.evidenceLocation,
        },
      );
      setPartitions(discovered);
      return true;
    } catch (error) {
      console.error("Error during partition discovery:", error);
      return false;
    }
  };

  // -------------------------------
  // Step 3: Read Selected Partition
  // -------------------------------
  const readSelectedPartition = async (): Promise<boolean> => {
    if (selectedPartitionIndex === null) {
      console.error("No partition selected.");
      return false;
    }
    try {
      const selectedPartition = partitions[selectedPartitionIndex];
      // The API is assumed to read the partition and return a status.
      await invoke("read_partition", {
        partition: selectedPartition,
        path: evidenceData.evidenceLocation,
      });
      return true;
    } catch (error) {
      console.error("Error reading partition:", error);
      return false;
    }
  };

  // -------------------------------
  // Step 4: Fetch Extraction Modules for Selected Partition
  // -------------------------------
  const fetchExtractionModules = async (): Promise<boolean> => {
    if (selectedPartitionIndex === null) {
      console.error("No partition selected for extraction modules.");
      return false;
    }
    try {
      const selectedPartition = partitions[selectedPartitionIndex];
      const modules: ExtractionModule[] = await invoke(
        "get_extraction_modules",
        {
          partition: selectedPartition,
        },
      );
      setExtractionModules(modules);
      return true;
    } catch (error) {
      console.error("Error fetching extraction modules:", error);
      return false;
    }
  };

  // -------------------------------
  // Handlers for Navigation
  // -------------------------------
  const handleNext = async () => {
    // For each step, perform the necessary API calls and validations.
    if (activeStep === 0) {
      const exists = await checkEvidenceExistence();
      if (!exists) return;
    } else if (activeStep === 1) {
      const formatOk = await checkDiskImageFormat();
      if (!formatOk) return;
    } else if (activeStep === 2) {
      const partitionsOk = await discoverPartitions();
      if (!partitionsOk) return;
    } else if (activeStep === 3) {
      const readOk = await readSelectedPartition();
      if (!readOk) return;
    } else if (activeStep === 4) {
      // Ensure at least one extraction module is selected.
      if (selectedExtractionModules.length === 0) {
        console.error("No extraction modules selected.");
        return;
      }
    } else if (activeStep === 5) {
      // Finalize metadata and pass to the onComplete callback.
      if (selectedPartitionIndex === null) {
        console.error("No partition selected.");
        return;
      }
      const metadata: ProcessedEvidenceMetadata = {
        evidenceData,
        diskImageFormat,
        selectedPartition: partitions[selectedPartitionIndex],
        extractionModules: extractionModules.filter((mod) =>
          selectedExtractionModules.includes(mod.id),
        ),
      };
      onComplete(metadata);
      return;
    }

    // Proceed to the next step.
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  // -------------------------------
  // Handlers for User Selections
  // -------------------------------
  // Partition selection (Step 3)
  const handlePartitionSelection = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setSelectedPartitionIndex(parseInt(event.target.value, 10));
  };

  // Extraction module toggling (Step 4)
  const handleExtractionModuleToggle = (moduleId: string) => {
    setSelectedExtractionModules((prev) => {
      if (prev.includes(moduleId)) {
        return prev.filter((id) => id !== moduleId);
      } else {
        return [...prev, moduleId];
      }
    });
  };

  // When reaching step 4, fetch the extraction modules if not already done.
  useEffect(() => {
    if (
      activeStep === 4 &&
      partitions.length > 0 &&
      selectedPartitionIndex !== null &&
      extractionModules.length === 0
    ) {
      fetchExtractionModules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, partitions, selectedPartitionIndex]);

  // -------------------------------
  // Render Step Content
  // -------------------------------
  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Typography variant="body1">
            Checking if evidence exists at: {evidenceData.evidenceLocation}
          </Typography>
        );
      case 1:
        return (
          <Typography variant="body1">
            Performing auto-check of the disk image format...
          </Typography>
        );
      case 2:
        return (
          <Typography variant="body1">
            Discovering partitions on the disk image...
          </Typography>
        );
      case 3:
        return (
          <div>
            <Typography variant="body1">
              Select a partition to analyze:
            </Typography>
            <FormControl component="fieldset">
              <RadioGroup
                value={
                  selectedPartitionIndex !== null
                    ? selectedPartitionIndex.toString()
                    : ""
                }
                onChange={handlePartitionSelection}
              >
                {partitions.map((partition, index) => (
                  <FormControlLabel
                    key={index}
                    value={index.toString()}
                    control={<Radio />}
                    label={`Partition ${index + 1} - Type: ${partition.partition_type} - Size: ${partition.size_sectors} sectors`}
                  />
                ))}
              </RadioGroup>
            </FormControl>
          </div>
        );
      case 4:
        return (
          <div>
            <Typography variant="body1">
              Select artefact extraction modules for the chosen partition:
            </Typography>
            {extractionModules.length === 0 ? (
              <Typography variant="body2">Loading modules...</Typography>
            ) : (
              <FormGroup>
                {extractionModules.map((module) => (
                  <FormControlLabel
                    key={module.id}
                    control={
                      <Checkbox
                        checked={selectedExtractionModules.includes(module.id)}
                        onChange={() => handleExtractionModuleToggle(module.id)}
                      />
                    }
                    label={`${module.name} - ${module.description}`}
                  />
                ))}
              </FormGroup>
            )}
          </div>
        );
      case 5:
        return (
          <div>
            <Typography variant="body1">
              Review and finalize metadata:
            </Typography>
            <Typography variant="body2">
              <strong>Evidence Name:</strong> {evidenceData.evidenceName}
            </Typography>
            <Typography variant="body2">
              <strong>Disk Image Format:</strong> {diskImageFormat}
            </Typography>
            {selectedPartitionIndex !== null && (
              <Typography variant="body2">
                <strong>Selected Partition:</strong> Partition{" "}
                {selectedPartitionIndex + 1} - Type:{" "}
                {partitions[selectedPartitionIndex].partition_type}
              </Typography>
            )}
            <Typography variant="body2">
              <strong>Selected Extraction Modules:</strong>{" "}
              {selectedExtractionModules.join(", ")}
            </Typography>
          </div>
        );
      default:
        return <Typography variant="body1">Unknown step.</Typography>;
    }
  };

  // -------------------------------
  // Component Render
  // -------------------------------
  return (
    <div style={{ padding: "20px" }}>
      <Stepper activeStep={activeStep} orientation="vertical">
        {steps.map((label, idx) => (
          <Step key={idx}>
            <Box sx={{ position: "relative" }}>
              {activeStep === idx && (
                <CircularProgress
                  size={30}
                  sx={{
                    position: "absolute",
                    top: 5,
                    left: -3,
                    zIndex: 1,
                  }}
                />
              )}
              <StepLabel>{label}</StepLabel>
            </Box>
            <StepContent> {getStepContent(activeStep)}</StepContent>
          </Step>
        ))}
      </Stepper>
      <div style={{ marginTop: "20px" }}>
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          style={{ marginRight: "10px" }}
        >
          Back
        </Button>
        <Button variant="contained" color="primary" onClick={handleNext}>
          {activeStep === steps.length - 1 ? "Finish" : "Next"}
        </Button>
      </div>
    </div>
  );
};

export default DiskImage;
