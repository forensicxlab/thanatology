import React, { useEffect, useRef, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import type { Case } from "../../../dbutils/types";
import {
  updateCaseMetadata,
  type UpdatedCaseMetadata,
} from "../../../dbutils/cases";
import { useSnackbar } from "../../SnackbarProvider";

interface EditCaseDialogProps {
  open: boolean;
  caseDetails: Case | null;
  database: Database | null;
  onClose: () => void;
  onSaved: (updatedCase: UpdatedCaseMetadata) => void;
}

function formatUpdateError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const message = String(error).replace(/\s+/g, " ").trim();
  return message || "Unknown error";
}

const EditCaseDialog: React.FC<EditCaseDialogProps> = ({
  open,
  caseDetails,
  database,
  onClose,
  onSaved,
}) => {
  const { display_message } = useSnackbar();
  const mountedRef = useRef(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || !caseDetails) return;
    setName(caseDetails.name);
    setDescription(caseDetails.description);
    setSubmitted(false);
    setSaveError(null);
  }, [caseDetails, open]);

  const nameMissing = name.trim().length === 0;
  const descriptionMissing = description.trim().length === 0;
  const unchanged =
    name.trim() === caseDetails?.name.trim() &&
    description.trim() === caseDetails?.description.trim();

  const handleClose = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);

    if (
      !caseDetails ||
      nameMissing ||
      descriptionMissing ||
      unchanged ||
      saving
    ) {
      return;
    }

    setSaving(true);
    try {
      const updatedCase = await updateCaseMetadata(database, caseDetails.id, {
        name,
        description,
      });
      if (!mountedRef.current) return;

      onSaved(updatedCase);
      display_message("success", `CASE-${caseDetails.id} updated.`);
      onClose();
    } catch (error) {
      if (!mountedRef.current) return;
      const message = formatUpdateError(error);
      setSaveError(message);
      display_message("error", `Could not update case: ${message}`);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit}
      aria-labelledby="edit-case-dialog-title"
    >
      <DialogTitle id="edit-case-dialog-title">
        Edit {caseDetails ? `CASE-${caseDetails.id}` : "case"}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {saveError && <Alert severity="error">{saveError}</Alert>}
        <TextField
          autoFocus
          required
          fullWidth
          label="Case name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={submitted && nameMissing}
          helperText={submitted && nameMissing ? "Enter a case name." : " "}
          disabled={saving}
          sx={{ mt: 1 }}
        />
        <TextField
          required
          fullWidth
          multiline
          minRows={4}
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={submitted && descriptionMissing}
          helperText={
            submitted && descriptionMissing ? "Enter a case description." : " "
          }
          disabled={saving}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={
            saving ||
            !caseDetails ||
            nameMissing ||
            descriptionMissing ||
            unchanged
          }
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditCaseDialog;
