// thanatology/src/components/evidences/preprocessing/LogicalImage.tsx
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
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  TextField,
  DialogActions,
} from "@mui/material";
import { useNavigate } from "react-router";

import Database from "@tauri-apps/plugin-sql";
import { Evidence, ProcessedEvidenceMetadata } from "../../../dbutils/types";
import { savePreprocessingMetadata } from "../../../dbutils/sqlite";
import { useSnackbar } from "../../SnackbarProvider";

interface LogicalImageProps {
  database: Database | null;
  evidenceData: Evidence; // MUST have an 'id' that exists in DB
}

/**
 * LogicalImage preprocessing wizard.
 * A logical image represents a single filesystem snapshot captured at
 * file-level. We therefore:
 *   (1) confirm the file exists
 *   (2) identify the image container format (E01/AFF4/RAW/etc.)
 *   (3) detect the filesystem inside the logical image (NTFS/ext4/APFS/…)
 */
const LogicalImage: React.FC<LogicalImageProps> = ({
  database,
  evidenceData,
}) => {
  const { display_message } = useSnackbar();
  const navigate = useNavigate();

  const steps = [
    "Check Evidence Existence",
    "Detect Image Format",
    "Detect Filesystem",
  ];

  const [activeStep, setActiveStep] = useState<number>(0);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const [diskImageFormat, setDiskImageFormat] = useState<string>("");
  const [filesystemName, setFilesystemName] = useState<string>("");

  const [finalInsertStatus, setFinalInsertStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const [fvekPromptOpen, setFvekPromptOpen] = useState(false);
  const [fvekInput, setFvekInput] = useState("");
  const [logicalFvek, setLogicalFvek] = useState<string | undefined>(undefined);

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
          setActiveStep(2);
        } else if (step === 2) {
          const fsName: string = await invoke("detect_logical_filesystem", {
            path: evidenceData.path,
          });
          setFilesystemName(fsName);
          setCurrentError(null);
          setActiveStep(3); // finished wizard
        }
      } catch (err: any) {
        console.error("LogicalImage auto step error", err);
        const errMsg = err.toString();
        if (step === 2 && errMsg.toLowerCase().includes("bitlocker")) {
          setFvekPromptOpen(true);
          setCurrentError("BitLocker encryption detected. Please provide FVEK.");
        } else {
          setCurrentError(errMsg);
        }
      }
    },
    [evidenceData.path],
  );

  const handleFvekSubmit = async () => {
    setLogicalFvek(fvekInput);
    setFvekPromptOpen(false);
    setCurrentError(null);
    // For now, if detect_logical_filesystem doesn't support fvek dynamically in the UI preview,
    // we just assume it will succeed later during processing, or we can just proceed to Finish. 
    // User requested "propose the user to enter decryption key. It will then be used when processing".
    setFilesystemName("BitLocker (Encrypted)");
    setActiveStep(3);
  };

  const handleFvekCancel = () => {
    setFvekPromptOpen(false);
    setFvekInput("");
    // Leave error
  };

  useEffect(() => {
    if (activeStep < 3 && !fvekPromptOpen) runAutoStep(activeStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, fvekPromptOpen]);

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

    try {
      const logicalSize: number = await invoke("file_size", {
        path: evidenceData.path,
      });

      const metadata: ProcessedEvidenceMetadata = {
        evidenceData,
        diskImageFormat,
        selectedMbrPartitions: [],
        selectedGptPartitions: [],
        selectedLogicalPartition: {
          id: evidenceData.id,
          size: logicalSize,
          fvek: logicalFvek,
        },
        logicalFilesystem: filesystemName,
      };

      await savePreprocessingMetadata(metadata, database);
      setFinalInsertStatus("success");
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
      case 2:
        return filesystemName ? (
          <Typography variant="body1">
            Filesystem detected: {filesystemName}
          </Typography>
        ) : (
          <Typography variant="body1">Detecting filesystem…</Typography>
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
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexDirection: "column",
            mt: 2
          }}>
          <CircularProgress size={40} />
          <Typography variant="body2" sx={{ mt: 1 }}>
            Saving preprocessing metadata…
          </Typography>
        </Box>
      );
    }
    if (finalInsertStatus === "success") {
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexDirection: "column",
            mt: 2
          }}>
          <CheckCircleIcon fontSize="large" />
          <Typography variant="h6" sx={{ mt: 1 }}>
            Preprocessing metadata saved successfully!
          </Typography>
          <Box sx={{
            mt: 2
          }}>
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
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexDirection: "column",
            mt: 2
          }}>
          <CancelIcon fontSize="large" color="error" />
          <Typography variant="h6" color="error" sx={{ mt: 1 }}>
            Error saving preprocessing metadata
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Please check the logs or try again.
          </Typography>
          <Box sx={{
            mt: 2
          }}>
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
                    {idx < 3 && (
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
          disabled={currentError !== null || activeStep < 2}
        >
          Next
        </Button>
      )}
      {activeStep === steps.length && (
        <Button variant="contained" color="primary" onClick={handleFinish}>
          Finish
        </Button>
      )}

      {/* Auto-step spinner */}
      {activeStep < 3 && !currentError && (
        <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
          <CircularProgress size={30} />
          <Typography variant="body2" sx={{ ml: 1 }}>
            Processing…
          </Typography>
        </Box>
      )}

      <Dialog open={fvekPromptOpen} onClose={handleFvekCancel}>
        <DialogTitle>BitLocker Detected</DialogTitle>
        <DialogContent>
          <DialogContentText>
            BitLocker encryption was detected on this logical image. Please enter the Full Volume Encryption Key (FVEK) in hexadecimal format to decrypt it during processing.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="FVEK (Hexadecimal)"
            type="text"
            fullWidth
            variant="outlined"
            value={fvekInput}
            onChange={(e) => setFvekInput(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleFvekCancel}>Cancel</Button>
          <Button onClick={handleFvekSubmit} variant="contained" disabled={!fvekInput}>
            Save Key & Continue
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LogicalImage;
