// NewEvidenceForm.tsx
import React, { ChangeEvent } from "react";
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Typography,
} from "@mui/material";

export interface NewEvidenceFormProps {
  evidenceName: string;
  evidenceType: "Disk image" | "Memory Image" | "Procmon dump";
  evidenceDescription: string;
  sealNumber: string;
  sealingDateTime: string; // expecting a string formatted as "YYYY-MM-DDThh:mm"
  sealingLocation: string;
  sealingPerson: string;
  sealReason: string;
  sealReferenceFile?: File | null;
  // Handlers for controlled fields:
  onEvidenceNameChange: (value: string) => void;
  onEvidenceTypeChange: (
    value: "Disk image" | "Memory Image" | "Procmon dump",
  ) => void;
  onEvidenceDescriptionChange: (value: string) => void;
  onSealNumberChange: (value: string) => void;
  onSealingDateTimeChange: (value: string) => void;
  onSealingLocationChange: (value: string) => void;
  onSealingPersonChange: (value: string) => void;
  onSealReasonChange: (value: string) => void;
  onSealReferenceFileChange: (file: File | null) => void;
  // Form submit handler (used when not embedded)
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  // When true, the component will render without a form wrapper and submit button.
  hideSubmitButton?: boolean;
}

const NewEvidenceForm: React.FC<NewEvidenceFormProps> = (props) => {
  const {
    evidenceName,
    evidenceType,
    evidenceDescription,
    sealNumber,
    sealingDateTime,
    sealingLocation,
    sealingPerson,
    sealReason,
    sealReferenceFile,
    onEvidenceNameChange,
    onEvidenceTypeChange,
    onEvidenceDescriptionChange,
    onSealNumberChange,
    onSealingDateTimeChange,
    onSealingLocationChange,
    onSealingPersonChange,
    onSealReasonChange,
    onSealReferenceFileChange,
    onSubmit,
    hideSubmitButton,
  } = props;

  // Handle file input change for the reference file.
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onSealReferenceFileChange(event.target.files[0]);
    } else {
      onSealReferenceFileChange(null);
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
              e.target.value as "Disk image" | "Memory Image",
            )
          }
        >
          <MenuItem value="Disk image">Disk image</MenuItem>
          <MenuItem value="Memory Image" disabled>
            Memory Image
          </MenuItem>
        </Select>
      </FormControl>

      {/* Description */}
      <TextField
        label="Description"
        value={evidenceDescription}
        onChange={(e) => onEvidenceDescriptionChange(e.target.value)}
        fullWidth
        multiline
        rows={4}
      />

      {/* Seal Number */}
      <TextField
        label="Seal Number"
        value={sealNumber}
        onChange={(e) => onSealNumberChange(e.target.value)}
        fullWidth
        required
      />

      {/* Sealing Date and Time */}
      <TextField
        label="Sealing Date and Time"
        type="datetime-local"
        value={sealingDateTime}
        onChange={(e) => onSealingDateTimeChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        fullWidth
        required
      />

      {/* Sealing Location */}
      <TextField
        label="Sealing Location"
        value={sealingLocation}
        onChange={(e) => onSealingLocationChange(e.target.value)}
        fullWidth
        required
      />

      {/* Sealing Person */}
      <TextField
        label="Sealing Person"
        value={sealingPerson}
        onChange={(e) => onSealingPersonChange(e.target.value)}
        fullWidth
        required
      />

      {/* Seal Reason */}
      <TextField
        label="Seal Reason and Reference to Authority/Decision"
        value={sealReason}
        onChange={(e) => onSealReasonChange(e.target.value)}
        fullWidth
        multiline
        rows={3}
      />

      {/* Reference File Upload */}
      <Box>
        <Button variant="contained" component="label">
          Upload Reference File
          <input type="file" hidden onChange={handleFileChange} />
        </Button>
        {sealReferenceFile && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Selected File: {sealReferenceFile.name}
          </Typography>
        )}
      </Box>

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
