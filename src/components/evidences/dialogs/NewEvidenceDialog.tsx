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
import { EvidenceImageDraft, EvidenceImageInput } from "../../../dbutils/types";
import { saveEvidenceImages } from "../../../dbutils/sqlite";

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
    | "Memory Image"
    | "Procmon dump"
    | "Physical Disk image"
    | "Logical Disk image"
    | "Folder"
  >("Physical Disk image");
  const [evidenceLocation, setEvidenceLocation] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceImages, setEvidenceImages] = useState<EvidenceImageDraft[]>([]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      if (!database) {
        throw new Error("Database not initialized");
      }
      if (evidenceImages.some((image) => image.caption.trim().length === 0)) {
        throw new Error("Every attached image must include a caption.");
      }

      // Insert the new evidence record into the database.
      const insertResult = await database.execute(
        "INSERT INTO evidence (case_id, name, type, path, description) VALUES ($1, $2, $3, $4, $5)",
        [
          caseId,
          evidenceName,
          evidenceType,
          evidenceLocation,
          evidenceDescription,
        ],
      );

      const evidenceId = insertResult.lastInsertId;
      if (!evidenceId) {
        throw new Error("Unable to resolve the newly created evidence ID.");
      }

      const imagePayloads: EvidenceImageInput[] = evidenceImages.map((image) => ({
        caption: image.caption.trim(),
        file_name: image.file_name,
        mime_type: image.mime_type,
        source_kind: image.source_kind,
        bytes: image.bytes,
      }));

      await saveEvidenceImages(evidenceId, imagePayloads);

      // After creation, refresh the case data (including the evidence list)
      onEvidenceCreated();
      onClose();

      // Reset the form fields
      setEvidenceName("");
      setEvidenceType("Physical Disk image");
      setEvidenceLocation("");
      setEvidenceDescription("");
      setEvidenceImages([]);
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
          evidenceImages={evidenceImages}
          onEvidenceNameChange={setEvidenceName}
          onEvidenceTypeChange={setEvidenceType}
          onEvidenceLocationChange={setEvidenceLocation}
          onEvidenceDescriptionChange={setEvidenceDescription}
          onEvidenceImagesChange={setEvidenceImages}
          onSubmit={handleSubmit}
          isSubmitDisabled={!evidenceName.trim() || !evidenceLocation}
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
