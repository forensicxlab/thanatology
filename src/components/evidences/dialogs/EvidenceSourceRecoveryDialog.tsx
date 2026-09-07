import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteForeverOutlinedIcon from "@mui/icons-material/DeleteForeverOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import { open as openPathDialog } from "@tauri-apps/plugin-dialog";
import { Evidence } from "../../../dbutils/types";

export type EvidenceSourceRecoveryIntent =
  | "preprocess"
  | "process"
  | "restart"
  | "review";

interface EvidenceSourceRecoveryDialogProps {
  open: boolean;
  evidence: Evidence;
  intent: EvidenceSourceRecoveryIntent;
  reason: string;
  busy: boolean;
  onClose: () => void;
  onRelink: (newPath: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * Recovery path for an evidence whose registered source is no longer
 * accessible. Keeping this in one dialog gives every evidence-lifecycle entry
 * point the same recovery path and, critically, leaves existing analysis
 * untouched until the investigator has chosen an explicit action.
 */
const EvidenceSourceRecoveryDialog: React.FC<
  EvidenceSourceRecoveryDialogProps
> = ({
  open,
  evidence,
  intent,
  reason,
  busy,
  onClose,
  onRelink,
  onDelete,
}) => {
  const [selectedPath, setSelectedPath] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedPath("");
    setSelectionError(null);
    setDeleteConfirmationOpen(false);
  }, [open, evidence.id, intent]);

  const chooseSource = async () => {
    setSelectionError(null);
    try {
      const selected = await openPathDialog({
        multiple: false,
        directory: evidence.type === "Folder",
        title:
          evidence.type === "Folder"
            ? `Locate source folder for EV-${evidence.id}`
            : `Locate source file for EV-${evidence.id}`,
      });
      if (typeof selected === "string") {
        setSelectedPath(selected);
      }
    } catch (error) {
      setSelectionError(`Unable to open the source picker: ${String(error)}`);
    }
  };

  const submitRelink = async () => {
    if (!selectedPath) {
      setSelectionError("Choose the relocated evidence source first.");
      return;
    }
    setSelectionError(null);
    try {
      await onRelink(selectedPath);
    } catch (error) {
      setSelectionError(String(error));
    }
  };

  const primaryLabel = {
    preprocess: "Relink and Preprocess",
    process: "Relink and Process",
    restart: "Relink and Restart",
    review: "Relink and Reprocess",
  }[intent];

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby="evidence-source-recovery-title"
      >
        <DialogTitle id="evidence-source-recovery-title" sx={{ pb: 1 }}>
          Evidence source unavailable
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Alert severity="warning" variant="outlined">
              {reason}
            </Alert>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "max-content minmax(0, 1fr)",
                columnGap: 1.5,
                rowGap: 0.5,
                fontSize: "0.78rem",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Evidence
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                EV-{evidence.id} · {evidence.type}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Registered path
              </Typography>
              <Typography
                variant="caption"
                sx={{ overflowWrap: "anywhere", fontFamily: "monospace" }}
              >
                {evidence.path}
              </Typography>
            </Box>

            <Alert severity="info" icon={false} sx={{ py: 0.25 }}>
              Existing analysis has not been changed. Select the same acquired
              source at its new location, or delete this evidence record.
            </Alert>

            <Divider />

            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FolderOpenOutlinedIcon />}
                disabled={busy}
                onClick={() => void chooseSource()}
                sx={{ flexShrink: 0 }}
              >
                Locate source…
              </Button>
              <TextField
                size="small"
                fullWidth
                label="Relocated source"
                value={selectedPath}
                placeholder={
                  evidence.type === "Folder"
                    ? "Select the relocated folder"
                    : "Select the relocated evidence file"
                }
                slotProps={{ input: { readOnly: true } }}
                error={Boolean(selectionError)}
                helperText={selectionError ?? "The evidence type and readability will be validated."}
              />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              {intent === "preprocess" ? (
                <>
                  The relocated source will be registered and opened in
                  preprocessing. Any generated analysis is removed first.
                </>
              ) : intent === "restart" || intent === "process" ? (
                <>
                  Relinking removes generated analysis data and returns the
                  evidence to Pending start. Saved preprocessing and partition
                  selections are retained.
                </>
              ) : (
                <>
                  Thanatology cannot cryptographically verify that a relocated
                  source is the same acquisition. Relinking therefore resets
                  generated analysis and requires processing again before
                  review.
                </>
              )}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            color="error"
            startIcon={<DeleteForeverOutlinedIcon />}
            disabled={busy}
            onClick={() => setDeleteConfirmationOpen(true)}
            sx={{ mr: "auto" }}
          >
            Delete Evidence
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={
              busy ? <CircularProgress size={15} color="inherit" /> : <LinkOutlinedIcon />
            }
            disabled={busy || !selectedPath}
            onClick={() => void submitRelink()}
          >
            {primaryLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteConfirmationOpen}
        onClose={busy ? undefined : () => setDeleteConfirmationOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete EV-{evidence.id}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the evidence record, attachments,
            preprocessing metadata, partitions, and generated analysis files.
            This action cannot be undone.
          </DialogContentText>
          <Alert severity="info" icon={false} sx={{ mt: 2 }}>
            The original source at <strong>{evidence.path}</strong> will not be
            deleted.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={busy}
            onClick={() => setDeleteConfirmationOpen(false)}
          >
            Keep Evidence
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            startIcon={
              busy ? (
                <CircularProgress size={15} color="inherit" />
              ) : (
                <DeleteForeverOutlinedIcon />
              )
            }
            onClick={() => void onDelete()}
          >
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default EvidenceSourceRecoveryDialog;
