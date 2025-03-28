import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import NewEvidenceForm from "../forms/NewEvidenceForm";
import Database from "@tauri-apps/plugin-sql";

interface NewEvidenceDialogProps {
  open: boolean;
  onClose: () => void;
  caseId: number;
  database: Database | null;
  onEvidenceCreated: () => void;
}

const NewEvidenceDialog: React.FC<NewEvidenceDialogProps> = ({
  open,
  onClose,
  caseId,
  database,
  onEvidenceCreated,
}) => {
  const [evidenceName, setEvidenceName] = useState("");
  const [evidenceType, setEvidenceType] = useState<
    "Disk image" | "Memory Image" | "Procmon dump"
  >("Disk image");
  const [evidenceLocation, setEvidenceLocation] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      if (!database) {
        throw new Error("Database not initialized");
      }
      // Insert the new evidence record into the database.
      await database.execute(
        "INSERT INTO evidence (case_id, name, type, path, description) VALUES ($1, $2, $3, $4, $5)",
        [
          caseId,
          evidenceName,
          evidenceType,
          evidenceLocation,
          evidenceDescription,
        ],
      );
      // After creation, refresh the case data (including the evidence list)
      onEvidenceCreated();
      onClose();

      // Reset the form fields
      setEvidenceName("");
      setEvidenceType("Disk image");
      setEvidenceLocation("");
      setEvidenceDescription("");
    } catch (error) {
      console.error("Error creating new evidence:", error);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add New Evidence</DialogTitle>
      <DialogContent>
        <NewEvidenceForm
          evidenceName={evidenceName}
          evidenceType={evidenceType}
          evidenceLocation={evidenceLocation}
          evidenceDescription={evidenceDescription}
          onEvidenceNameChange={setEvidenceName}
          onEvidenceTypeChange={setEvidenceType}
          onEvidenceLocationChange={setEvidenceLocation}
          onEvidenceDescriptionChange={setEvidenceDescription}
          onSubmit={handleSubmit}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewEvidenceDialog;
