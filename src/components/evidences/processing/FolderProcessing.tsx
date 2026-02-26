import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
    Evidence,
    ProcessedEvidenceMetadata,
} from "../../../dbutils/types";
import ProcessingTask from "./ProcessingTask";
import { appLocalDataDir } from "@tauri-apps/api/path";
import {
    setProcessingInProgress,
} from "../../../dbutils/sqlite";
import { invoke } from "@tauri-apps/api/core";
import { useSnackbar } from "../../SnackbarProvider";

interface FolderProcessingProps {
    evidence: Evidence;
    setEvidence: React.Dispatch<React.SetStateAction<Evidence | null>>;
}

const FolderProcessing: React.FC<FolderProcessingProps> = ({
    evidence,
    setEvidence,
}) => {
    const { display_message } = useSnackbar();
    const [processing, setProcessing] = useState<boolean>(false);

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
        if (evidence.status === 2) setProcessing(true);
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

        try {
            await invoke("process_folder", {
                evidenceId: evidence.id,
                mainDbPath: mainDbPath,
                evidenceDbPath: evidenceDbPath,
                folderPath: evidence.path,
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

    if (evidence.status === 3 || evidence.status === 4 || evidence.status === 5) {
        return (
            <Box sx={{ textAlign: "center", mt: 4 }}>
                <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
                <Typography variant="h5" gutterBottom>
                    Folder Indexing Completed
                </Typography>
                <Typography variant="body1">
                    The indexation process of the folder is now completed. You can
                    already start your investigation while other modules run.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ flexGrow: 1, p: 2 }}>
            <Typography variant="h6" gutterBottom>
                Folder Processing
            </Typography>
            <Typography variant="body1" gutterBottom>
                Ready to index folder: <strong>{evidence.path}</strong>
            </Typography>

            {evidence.status === 2 && (
                <ProcessingTask
                    evidence={evidence}
                    onComplete={fetchEvidence}
                />
            )}
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
