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

interface FolderImageProps {
    database: Database | null;
    evidenceData: Evidence;
}

const FolderImage: React.FC<FolderImageProps> = ({
    database,
    evidenceData,
}) => {
    const { display_message } = useSnackbar();
    const navigate = useNavigate();

    const steps = ["Check Folder Existence"];

    const [activeStep, setActiveStep] = useState<number>(0);
    const [currentError, setCurrentError] = useState<string | null>(null);

    const [finalInsertStatus, setFinalInsertStatus] = useState<
        "idle" | "loading" | "success" | "error"
    >("idle");

    const runAutoStep = useCallback(
        async (step: number) => {
            try {
                if (step === 0) {
                    const exists: boolean = await invoke("check_evidence_exists", {
                        path: evidenceData.path,
                    });
                    if (!exists)
                        throw new Error("Folder not found at the specified location.");
                    setCurrentError(null);
                    setActiveStep(1); // Finished wizard
                }
            } catch (err: any) {
                console.error("FolderImage auto step error", err);
                setCurrentError(err.toString());
            }
        },
        [evidenceData.path],
    );

    useEffect(() => {
        if (activeStep < 1) runAutoStep(activeStep);
    }, [activeStep, runAutoStep]);

    const handleFinish = async () => {
        setFinalInsertStatus("loading");

        const metadata: ProcessedEvidenceMetadata = {
            evidenceData,
            diskImageFormat: "Folder",
            selectedMbrPartitions: [],
            selectedGptPartitions: [],
            // For logical images/folders we store the detected FS name as the "format" detail:
            // The LogicalImage component logic saves this field differently but ProcessedEvidenceMetadata
            // might need 'logicalFilesystem' to be optional or we just omit it if not needed?
            // Wait, ProcessedEvidenceMetadata in types.tsx has optional properties?
            // Let's check types.tsx again. No, it doesn't have logicalFilesystem in interface definition shown previously.
            // But LogicalImage.tsx was casting: } as ProcessedEvidenceMetadata;
            // I will assume it's fine or I will cast it.
            // I'll add logicalFilesystem: "Folder"
        } as any;

        metadata.logicalFilesystem = "Folder";

        try {
            await savePreprocessingMetadata(metadata, database);
            setFinalInsertStatus("success");
        } catch (err: any) {
            console.error("Error saving preprocessing metadata", err);
            display_message("error", `Error saving metadata: ${err}`);
            setFinalInsertStatus("error");
        }
    };

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

    return (
        <Box>
            <Stepper activeStep={activeStep} orientation="vertical">
                {steps.map((label, idx) => (
                    <Step key={label}>
                        <StepLabel error={idx === activeStep && currentError !== null}>
                            {idx > activeStep ? label :
                                (idx === 0 ? <Typography variant="body1">Checking existence of {evidenceData.path}</Typography> : label)
                            }
                        </StepLabel>
                        {idx <= activeStep && (
                            <StepContent>
                                {idx === activeStep && currentError && (
                                    <Box sx={{ mt: 1 }}>
                                        <Typography variant="body2" color="error">
                                            {currentError}
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            color="error"
                                            size="small"
                                            onClick={() => runAutoStep(idx)}
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

            {activeStep === steps.length && (
                <Button variant="contained" color="primary" onClick={handleFinish} sx={{ mt: 2 }}>
                    Finish
                </Button>
            )}

            {activeStep < 1 && !currentError && (
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

export default FolderImage;
