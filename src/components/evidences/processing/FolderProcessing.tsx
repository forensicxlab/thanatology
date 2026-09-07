import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { getEvidence } from "../../../dbutils/sqlite";
import { useAiConfigStore } from "../../../store/aiConfigStore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { Evidence } from "../../../dbutils/types";
import ProcessingParticlesView from "./ProcessingParticlesView";
import { invoke } from "@tauri-apps/api/core";
import { useSnackbar } from "../../SnackbarProvider";
import { useNavigate } from "react-router";
import { getEvidenceStatusInfo } from "../../../dbutils/evidenceStatus";

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
        // Disable duplicate starts locally while the backend atomically admits
        // the lifecycle transition and registers the processing task.
        setProcessing(true);

        try {
            const aiConfig = aiConfigStore;

            await invoke("process_folder", {
                evidenceId: evidence.id,
                aiConfig: aiConfig,
            });
            setEvidence((current) =>
                current ? { ...current, status: 2 } : current,
            );
            await fetchEvidence();
            display_message("info", "Processing Started");
        } catch (err) {
            console.error("Error invoking process_folder", err);
            display_message(
                "error",
                `Could not start processing: ${String(err)}`,
            );
            setProcessing(false);
        }
    };

    const handleReviewEvidence = async () => {
        const statusInfo = getEvidenceStatusInfo(evidence.status);
        if (!statusInfo.isReviewable) {
            display_message(
                "warning",
                statusInfo.blockedReason ?? "Artefact parsing has not completed yet.",
            );
            return;
        }
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

    const showCompletionScreen = evidence.status >= 5;

    const processingTask =
        evidence.status >= 2 && evidence.status < 5 ? (
            <ProcessingParticlesView
                evidence={evidence}
                onComplete={fetchEvidence}
            />
        ) : null;

    if (showCompletionScreen) {
        return (
            <Box sx={{ textAlign: "center", mt: 4 }}>
                    <CheckCircleIcon sx={{ fontSize: 80, color: "green" }} />
                    <Typography variant="h5" gutterBottom>
                        Evidence Ready for Review
                    </Typography>
                    <Typography variant="body1">
                        Artefact parsing is complete. You can review the evidence while any
                        remaining AI specialist analysis continues in the background.
                    </Typography>
                    <Box sx={{ mt: 3 }}>
                        <Button variant="contained" onClick={handleReviewEvidence}>
                            Review Evidence
                        </Button>
                    </Box>
                </Box>
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
