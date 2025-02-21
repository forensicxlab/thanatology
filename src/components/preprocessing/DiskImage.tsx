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
  FormControlLabel,
  Checkbox,
  FormGroup,
  StepContent,
} from "@mui/material";
import CircularProgress from "@mui/material/CircularProgress";
import { DataGrid, GridColDef, GridRenderCellParams } from "@mui/x-data-grid";

import {
  EvidenceData,
  ProcessedEvidenceMetadata,
  ExtractionModule,
  Partitions,
} from "../../dbutils/types";

interface DiskImageProps {
  evidenceData: EvidenceData;
  onComplete: (metadata: ProcessedEvidenceMetadata) => void;
}

const DiskImage: React.FC<DiskImageProps> = ({ evidenceData, onComplete }) => {
  // Step control
  const [activeStep, setActiveStep] = useState<number>(0);
  const steps = [
    "Check Evidence Existence",
    "Autocheck Disk Image Format",
    "Partition Discovery",
    "Read Partition(s)",
    "Select Artefact Extraction Modules",
    "Finalize Metadata",
  ];

  // Data from backend calls:
  const [diskImageFormat, setDiskImageFormat] = useState<string>("");
  const [partitions, setPartitions] = useState<Partitions>();
  // Combine MBR and EBR entries into one array.
  console.log(partitions);
  const allPartitions = partitions
    ? [...partitions.mbr.partition_table, ...partitions.ebr]
    : [];
  // Allow multiple partition selections:
  const [selectedPartitionIndices, setSelectedPartitionIndices] = useState<
    number[]
  >([]);
  const [extractionModules, setExtractionModules] = useState<
    ExtractionModule[]
  >([]);
  const [selectedExtractionModules, setSelectedExtractionModules] = useState<
    string[]
  >([]);

  // Error state for the current step.
  const [currentError, setCurrentError] = useState<string | null>(null);

  // -------------------------------
  // Auto Steps: 0, 1 & 2
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
    } else if (step === 2) {
      try {
        const discovered: Partitions = await invoke("discover_partitions", {
          path: evidenceData.evidenceLocation,
        });
        setPartitions(discovered);
        setCurrentError(null);
        setActiveStep(3);
      } catch (error) {
        console.error("Error during partition discovery:", error);
        setCurrentError("Error during partition discovery.");
      }
    }
  };

  // Automatically run auto steps.
  useEffect(() => {
    if (activeStep < 3) {
      runAutoStep(activeStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  // -------------------------------
  // Manual Steps Handlers (Steps 3-5)
  // -------------------------------
  const handleNext = async () => {
    setCurrentError(null);
    if (activeStep === 3) {
      // Step 3: Read selected partition(s)
      if (selectedPartitionIndices.length === 0) {
        setCurrentError("No partition selected.");
        return;
      }
      try {
        for (const idx of selectedPartitionIndices) {
          const selectedPartition = allPartitions[idx];
          await invoke("read_partition", {
            partition: selectedPartition,
            path: evidenceData.evidenceLocation,
          });
        }
      } catch (error) {
        console.error("Error reading partition(s):", error);
        setCurrentError("Error reading selected partition(s).");
        return;
      }
    } else if (activeStep === 4) {
      // Step 4: Ensure at least one extraction module is selected.
      if (selectedExtractionModules.length === 0) {
        setCurrentError("No extraction modules selected.");
        return;
      }
    } else if (activeStep === 5) {
      // Finalize metadata.
      if (selectedPartitionIndices.length === 0) {
        setCurrentError("No partition selected.");
        return;
      }
      const metadata: ProcessedEvidenceMetadata = {
        evidenceData,
        diskImageFormat,
        selectedPartitions: allPartitions.filter((_, idx) =>
          selectedPartitionIndices.includes(idx),
        ),
        extractionModules: extractionModules.filter((mod) =>
          selectedExtractionModules.includes(mod.id),
        ),
      } as any;
      onComplete(metadata);
      return;
    }
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setCurrentError(null);
    setActiveStep((prev) => prev - 1);
  };

  // -------------------------------
  // Handlers for Selections
  // -------------------------------
  const togglePartitionSelection = (index: number) => {
    setSelectedPartitionIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  const handleExtractionModuleToggle = (moduleId: string) => {
    setSelectedExtractionModules((prev) =>
      prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId],
    );
  };

  // When reaching step 4, fetch extraction modules if not already done.
  useEffect(() => {
    if (
      activeStep === 4 &&
      allPartitions.length > 0 &&
      selectedPartitionIndices.length > 0 &&
      extractionModules.length === 0
    ) {
      const fetchModules = async () => {
        try {
          let modulesCombined: ExtractionModule[] = [];
          for (const idx of selectedPartitionIndices) {
            const selectedPartition = allPartitions[idx];
            const modules: ExtractionModule[] = await invoke(
              "get_extraction_modules",
              {
                partition: selectedPartition,
              },
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
  }, [
    activeStep,
    allPartitions,
    selectedPartitionIndices,
    extractionModules.length,
  ]);

  // Define columns for the DataGrid
  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "boot_indicator", headerName: "Boot Indicator", width: 150 },
    {
      field: "start_chs",
      headerName: "Start CHS",
      width: 150,
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value.join(", ")}
        </div>
      ),
    },
    { field: "partition_type", headerName: "Partition Type", width: 150 },
    { field: "description", headerName: "Description", width: 150 },
    {
      field: "end_chs",
      headerName: "End CHS",
      width: 150,
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value.join(", ")}
        </div>
      ),
    },
    { field: "start_lba", headerName: "Start LBA", width: 150 },
    { field: "size_sectors", headerName: "Size (Sectors)", width: 150 },
    { field: "sector_size", headerName: "Sector Size", width: 150 },
    { field: "first_byte_addr", headerName: "First Byte Addr", width: 150 },
  ];

  // Prepare rows for the DataGrid by adding an 'id' field.
  const rows = allPartitions.map((partition, index) => ({
    id: index,
    ...partition,
  }));

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
            <Typography variant="body1">
              Partition discovery completed. Found {allPartitions.length}{" "}
              partition(s).
            </Typography>
            {allPartitions.length > 0 && (
              <Box sx={{ height: 400, width: "100%", mt: 2 }}>
                <DataGrid
                  rowHeight={40}
                  disableRowSelectionOnClick
                  rows={rows}
                  columns={columns}
                  hideFooter
                />
              </Box>
            )}
          </Box>
        );
      case 3:
        return (
          <Box>
            <Typography variant="body1">
              Select partition(s) to analyze:
            </Typography>
            <FormControl component="fieldset">
              <FormGroup>
                {allPartitions.map((partition, index) => (
                  <FormControlLabel
                    key={index}
                    control={
                      <Checkbox
                        checked={selectedPartitionIndices.includes(index)}
                        onChange={() => togglePartitionSelection(index)}
                      />
                    }
                    label={`Partition ${index + 1}: Type: ${partition.partition_type}, Size: ${partition.size_sectors} sectors`}
                  />
                ))}
              </FormGroup>
            </FormControl>
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
              <FormControl component="fieldset">
                <FormGroup>
                  {extractionModules.map((module) => (
                    <FormControlLabel
                      key={module.id}
                      control={
                        <Checkbox
                          checked={selectedExtractionModules.includes(
                            module.id,
                          )}
                          onChange={() =>
                            handleExtractionModuleToggle(module.id)
                          }
                        />
                      }
                      label={`${module.name} - ${module.description}`}
                    />
                  ))}
                </FormGroup>
              </FormControl>
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
            {selectedPartitionIndices.length > 0 && (
              <Typography variant="body2">
                <strong>Selected Partition(s):</strong>{" "}
                {selectedPartitionIndices
                  .map((idx) => `Partition ${idx + 1}`)
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
    <div style={{ padding: "20px" }}>
      <Stepper activeStep={activeStep} orientation="vertical">
        {steps.map((label, idx) => (
          <Step key={idx}>
            <StepLabel error={idx === activeStep && currentError !== null}>
              {idx > activeStep ? label : getStepContent(idx)}
            </StepLabel>
            {idx <= activeStep && (
              <StepContent>
                {/* If there's an error on the active (auto) step, show it with a Retry button */}
                {idx === activeStep && currentError && activeStep < 3 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2" color="error">
                      {currentError}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => runAutoStep(activeStep)}
                      sx={{ mt: 1 }}
                    >
                      Retry
                    </Button>
                  </Box>
                )}
              </StepContent>
            )}
          </Step>
        ))}
      </Stepper>
      {/* Only show navigation buttons for manual steps (steps 3 and beyond) */}
      {activeStep >= 3 && (
        <div style={{ marginTop: "20px" }}>
          <Button
            disabled={activeStep === 3}
            onClick={handleBack}
            style={{ marginRight: "10px" }}
          >
            Back
          </Button>
          <Button variant="contained" color="primary" onClick={handleNext}>
            {activeStep === steps.length - 1 ? "Finish" : "Next"}
          </Button>
        </div>
      )}
      {/* Optionally, show a loading indicator for auto steps */}
      {activeStep < 3 && !currentError && (
        <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
          <CircularProgress size={30} />
          <Typography variant="body2" sx={{ ml: 1 }}>
            Processing…
          </Typography>
        </Box>
      )}
    </div>
  );
};

export default DiskImage;
