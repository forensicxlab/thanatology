// NewEvidenceForm.tsx
import React from "react";
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
} from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";

export interface NewEvidenceFormProps {
  evidenceName: string;
  evidenceType: "Disk image" | "Memory Image" | "Procmon dump";
  evidenceLocation: string;
  evidenceDescription: string;
  // Handlers for controlled fields:
  onEvidenceNameChange: (value: string) => void;
  onEvidenceTypeChange: (
    value: "Disk image" | "Memory Image" | "Procmon dump",
  ) => void;
  onEvidenceLocationChange: (value: string) => void;
  onEvidenceDescriptionChange: (value: string) => void;
  // Form submit handler (used when not embedded)
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  // When true, the component will render without a form wrapper and submit button.
  hideSubmitButton?: boolean;
}

const NewEvidenceForm: React.FC<NewEvidenceFormProps> = (props) => {
  const {
    evidenceName,
    evidenceType,
    evidenceLocation,
    evidenceDescription,
    onEvidenceNameChange,
    onEvidenceTypeChange,
    onEvidenceLocationChange,
    onEvidenceDescriptionChange,
    onSubmit,
    hideSubmitButton,
  } = props;

  const handleFileSelect = async () => {
    try {
      // Open the file dialog; adjust filters as needed.
      const selected = await open({
        multiple: false,
        directory: false,
      });

      // When multiple is false, selected is either a string or null.
      if (selected) {
        onEvidenceLocationChange(selected as string);
      }
    } catch (error) {
      console.error("Error selecting file:", error);
    }
  };

  // All the content of the form (fields only)
  const content = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {/* Evidence Name */}
      <TextField
        label="Evidence Name"
        value={evidenceName}
        onChange={(e) => onEvidenceNameChange(e.target.value)}
        fullWidth
        required
      />

      {/* Evidence Type */}
      <FormControl fullWidth required>
        <InputLabel id="evidence-type-label">Evidence Type</InputLabel>
        <Select
          labelId="evidence-type-label"
          value={evidenceType}
          label="Evidence Type"
          onChange={(e) =>
            onEvidenceTypeChange(
              e.target.value as "Disk image" | "Memory Image" | "Procmon dump",
            )
          }
        >
          <MenuItem value="Disk image">Disk image</MenuItem>
          <MenuItem value="Memory Image" disabled>
            Memory Image
          </MenuItem>
          <MenuItem value="Procmon dump" disabled>
            Procmon dump
          </MenuItem>
        </Select>
      </FormControl>

      <TextField
        label="Selected File"
        value={evidenceLocation}
        fullWidth
        slotProps={{ input: { readOnly: true } }}
      />
      <Button variant="contained" onClick={handleFileSelect}>
        Locate the evidence...
      </Button>

      {/* Description */}
      <TextField
        label="Description"
        value={evidenceDescription}
        onChange={(e) => onEvidenceDescriptionChange(e.target.value)}
        fullWidth
        multiline
        rows={4}
      />

      {/* Conditionally render submit button if not embedded */}
      {!hideSubmitButton && (
        <Button type="submit" variant="contained" color="primary">
          Create Evidence
        </Button>
      )}
    </Box>
  );

  // When embedded (i.e. hideSubmitButton is true) we don't wrap in a form.
  if (hideSubmitButton) {
    return <>{content}</>;
  }

  // Otherwise, wrap in a form so it can be submitted individually.
  return (
    <Box component="form" onSubmit={onSubmit} noValidate sx={{ p: 2 }}>
      {content}
    </Box>
  );
};

export default NewEvidenceForm;
