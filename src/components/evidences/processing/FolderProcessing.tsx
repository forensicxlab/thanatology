import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import { useAiConfigStore } from "../../../store/aiConfigStore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
    Evidence,
    ProcessedEvidenceMetadata,
} from "../../../dbutils/types";
import ProcessingParticlesView from "./ProcessingParticlesView";
import { appLocalDataDir } from "@tauri-apps/api/path";
import {
    setProcessingInProgress,
} from "../../../dbutils/sqlite";
import { invoke } from "@tauri-apps/api/core";
import { useSnackbar } from "../../SnackbarProvider";
import { useNavigate } from "react-router";

interface FolderProcessingProps {
    evidence: Evidence;
    setEvidence: React.Dispatch<React.SetStateAction<Evidence | null>>;
}

const FolderProcessing: React.FC<FolderProcessingProps> = ({
    evidence,
    setEvidence,
}) => {
    const { display_message } = useSnackbar();
    const navigate = useNavigate();
    const { config: aiConfigStore, loadConfig } = useAiConfigStore();

    useEffect(() => { loadConfig(); }, [loadConfig]);
    const [processing, setProcessing] = useState<boolean>(false);
    const [artefactIdentificationCompleted, setArtefactIdentificationCompleted] =
        useState(false);

    const [mainDbPath, setMainDbPath] = useState<string>("");
    const [evidenceDbPath, setEvidenceDbPath] = useState<string>("");

    useEffect(() => {
        async function initPaths() {
            try {
                const baseDir = await appLocalDataDir();
                setMainDbPath(`${baseDir}/thanatology.db`);
                setEvidenceDbPath(`${baseDir}/evidences/${evidence.id}.db`);
            } catch (error) {
                console.error("Error setting paths", error);
                display_message("error", "Error setting application paths");
            }
        }
        initPaths();
    }, [evidence, display_message]);

    useEffect(() => {
        setArtefactIdentificationCompleted(false);
    }, [evidence.id]);

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
    }, [evidence.status]);

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
            diskImageFormat: "Folder",
            selectedMbrPartitions: [],
            selectedGptPartitions: [],
            logicalFilesystem: "Folder",
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

        // Let ProcessingTask mount its event listeners before the backend emits early discovery updates.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        try {
            const aiConfig = aiConfigStore;

            await invoke("process_folder", {
                evidenceId: evidence.id,
                mainDbPath: mainDbPath,
                evidenceDbPath: evidenceDbPath,
                folderPath: evidence.path,
                aiConfig: aiConfig,
            });
        } catch (err) {
            console.error("Error invoking process_folder", err);
            display_message(
                "error",
                "An error occurred while starting the processing task.",
            );
            setProcessing(false);
        }
    };

    const handleReviewEvidence = async () => {
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

    const showCompletionScreen =
        artefactIdentificationCompleted || evidence.status >= 5;

    const processingTask =
        evidence.status >= 2 && evidence.status < 5 ? (
            <ProcessingParticlesView
                evidence={evidence}
                onComplete={fetchEvidence}
                onArtefactIdentificationComplete={() =>
                    setArtefactIdentificationCompleted(true)
                }
            />
        ) : null;

    if (showCompletionScreen) {
        return (
            <>
                {evidence.status < 5 && processingTask && (
                    <Box sx={{ display: "none" }}>{processingTask}</Box>
                )}
                <Box sx={{ textAlign: "center", mt: 4 }}>
                    <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
                    <Typography variant="h5" gutterBottom>
                        {evidence.status >= 5
                            ? "Folder Indexing Completed"
                            : "Artefact Identification Completed"}
                    </Typography>
                    <Typography variant="body1">
                        {evidence.status >= 5
                            ? "The full processing pipeline for the folder is now completed. You can start or continue the investigation."
                            : "Known artefacts have been identified. You can start or continue the investigation while artefact extraction finishes in the background."}
                    </Typography>
                    <Box sx={{ mt: 3 }}>
                        <Button variant="contained" onClick={handleReviewEvidence}>
                            Review Evidence
                        </Button>
                    </Box>
                </Box>
            </>
        );
    }

    return (
        <Box sx={{ flexGrow: 1, p: 2 }}>
            {!processing && (
                <>
                    <Typography variant="h6" gutterBottom>
                        Folder Processing
                    </Typography>
                    <Typography variant="body1" gutterBottom>
                        Ready to index folder: <strong>{evidence.path}</strong>
                    </Typography>
                </>
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

export default FolderProcessing;
