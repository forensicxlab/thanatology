import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  Button,
  CircularProgress,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { useNavigate } from "react-router";

import Database from "@tauri-apps/plugin-sql";
import { Evidence, ProcessedEvidenceMetadata } from "../../../dbutils/types";
import { savePreprocessingMetadata } from "../../../dbutils/sqlite";
import { useSnackbar } from "../../SnackbarProvider";

interface LogicalImageProps {
  database: Database | null;
  evidenceData: Evidence; // MUST have an 'id' that exists in DB
  onComplete: (metadata: ProcessedEvidenceMetadata) => void;
}

/**
 * LogicalImage preprocessing wizard.
 * A logical image represents a single filesystem snapshot captured at
 * file‑level.  We therefore only need to (1) confirm the file exists and
 * (2) verify/identify the image format (E01, AFF4, ZIP, etc.).
 */
const LogicalImage: React.FC<LogicalImageProps> = ({
  database,
  evidenceData,
  onComplete,
}) => {
  const { display_message } = useSnackbar();
  const navigate = useNavigate();

  const steps = ["Check Evidence Existence", "Detect Image Format"];

  const [activeStep, setActiveStep] = useState<number>(0);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const [diskImageFormat, setDiskImageFormat] = useState<string>("");

  const [finalInsertStatus, setFinalInsertStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  /* -------------------------------------------------------------- */
  /* Auto steps                                                      */
  /* -------------------------------------------------------------- */
  const runAutoStep = useCallback(
    async (step: number) => {
      try {
        if (step === 0) {
          const exists: boolean = await invoke("check_evidence_exists", {
            path: evidenceData.path,
          });
          if (!exists)
            throw new Error("Evidence not found at the specified location.");
          setCurrentError(null);
          setActiveStep(1);
        } else if (step === 1) {
          const fmt: string = await invoke("check_disk_image_format", {
            path: evidenceData.path,
          });
          setDiskImageFormat(fmt);
          setCurrentError(null);
          setActiveStep(2); // finished wizard
        }
      } catch (err: any) {
        console.error("LogicalImage auto step error", err);
        setCurrentError(err.toString());
      }
    },
    [evidenceData.path],
  );

  useEffect(() => {
    if (activeStep < 2) runAutoStep(activeStep);
    // eslint‑disable‑next‑line react‑hooks/exhaustive‑deps
  }, [activeStep]);

  /* -------------------------------------------------------------- */
  /* Navigation                                                      */
  /* -------------------------------------------------------------- */
  const handleBack = () => {
    setCurrentError(null);
    setActiveStep((prev) => (prev > 0 ? prev - 1 : prev));
  };
  const handleNext = () => {
    setCurrentError(null);
    setActiveStep((prev) => prev + 1);
  };

  /* -------------------------------------------------------------- */
  /* Finish                                                          */
  /* -------------------------------------------------------------- */
  const handleFinish = async () => {
    setFinalInsertStatus("loading");

    const metadata: ProcessedEvidenceMetadata = {
      evidenceData,
      diskImageFormat,
      selectedMbrPartitions: [],
      selectedGptPartitions: [],
      selectedLogicalPartition,
      extractionModules: [],
    };

    try {
      await savePreprocessingMetadata(metadata, database);
      setFinalInsertStatus("success");
      onComplete(metadata);
    } catch (err: any) {
      console.error("Error saving preprocessing metadata", err);
      display_message("error", `Error saving metadata: ${err}`);
      setFinalInsertStatus("error");
    }
  };

  /* -------------------------------------------------------------- */
  /* Helpers                                                         */
  /* -------------------------------------------------------------- */
  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Typography variant="body1">
            Checked evidence existence at: {evidenceData.path}
          </Typography>
        );
      case 1:
        return diskImageFormat ? (
          <Typography variant="body1">
            Image format detected: {diskImageFormat}
          </Typography>
        ) : (
          <Typography variant="body1">Detecting image format…</Typography>
        );
      default:
        return <Typography variant="body1">Unknown step</Typography>;
    }
  };

  /* -------------------------------------------------------------- */
  /* Render – final states                                           */
  /* -------------------------------------------------------------- */
  if (finalInsertStatus !== "idle") {
    if (finalInsertStatus === "loading") {
      return (
        <Box display="flex" alignItems="center" flexDirection="column" mt={2}>
          <CircularProgress size={40} />
          <Typography variant="body2" sx={{ mt: 1 }}>
            Saving preprocessing metadata…
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
              onClick={() => navigate(`/evidences/process/${evidenceData.id}`)}
              sx={{ mr: 2 }}
            >
              Launch Processing Action
            </Button>
            <Button variant="outlined" onClick={() => navigate(`/cases/`)}>
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
  }

  /* -------------------------------------------------------------- */
  /* Render – wizard                                                 */
  /* -------------------------------------------------------------- */
  return (
    <Box>
      <Stepper activeStep={activeStep} orientation="vertical">
        {steps.map((label, idx) => (
          <Step key={label}>
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
                    {idx < 2 && (
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => runAutoStep(idx)}
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

      {/* Navigation buttons */}
      {activeStep > 0 && activeStep < steps.length && (
        <Button onClick={handleBack} sx={{ mr: 2 }}>
          Back
        </Button>
      )}
      {activeStep < steps.length && (
        <Button
          variant="contained"
          onClick={handleNext}
          disabled={currentError !== null || activeStep < 1}
        >
          Next
        </Button>
      )}
      {activeStep === steps.length && (
        <Button variant="contained" color="primary" onClick={handleFinish}>
          Finish
        </Button>
      )}

      {/* Auto‑step spinner */}
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

export default LogicalImage;
