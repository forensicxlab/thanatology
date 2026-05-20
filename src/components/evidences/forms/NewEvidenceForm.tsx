// NewEvidenceForm.tsx
import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  TextField,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  CircularProgress,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  EvidenceImageDraft,
} from "../../../dbutils/types";
import EvidenceImageAttachments from "./EvidenceImageAttachments";

type PhysicalDevice = {
  path: string;
  name: string;
  size: number;
  size_human: string;
  is_internal: boolean;
  protocol: string;
};

export interface NewEvidenceFormProps {
  evidenceName: string;
  evidenceType:
  | "Physical Disk image"
  | "Logical Disk image"
  | "Memory Image"
  | "Procmon dump"
  | "Folder";
  evidenceLocation: string;
  evidenceDescription: string;
  evidenceImages: EvidenceImageDraft[];
  // Handlers for controlled fields:
  onEvidenceNameChange: (value: string) => void;
  onEvidenceTypeChange: (
    value:
      | "Physical Disk image"
      | "Logical Disk image"
      | "Memory Image"
      | "Procmon dump"
      | "Folder",
  ) => void;
  onEvidenceLocationChange: (value: string) => void;
  onEvidenceDescriptionChange: (value: string) => void;
  onEvidenceImagesChange: (value: EvidenceImageDraft[]) => void;
  // Form submit handler (used when not embedded)
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  // When true, the component will render without a form wrapper and submit button.
  hideSubmitButton?: boolean;
  // When true, disables the submit button.
  isSubmitDisabled?: boolean;
}

const NewEvidenceForm: React.FC<NewEvidenceFormProps> = (props) => {
  const {
    evidenceName,
    evidenceType,
    evidenceLocation,
    evidenceDescription,
    evidenceImages,
    onEvidenceNameChange,
    onEvidenceTypeChange,
    onEvidenceLocationChange,
    onEvidenceDescriptionChange,
    onEvidenceImagesChange,
    onSubmit,
    hideSubmitButton,
    isSubmitDisabled,
  } = props;

  const [nameTouched, setNameTouched] = useState(false);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devices, setDevices] = useState<PhysicalDevice[]>([]);
  const [deviceScanError, setDeviceScanError] = useState<string | null>(null);

  const hasImageCaptionError = evidenceImages.some(
    (image) => image.caption.trim().length === 0,
  );

  const handleScanDevices = async () => {
    setDeviceDialogOpen(true);
    setDevicesLoading(true);
    setDeviceScanError(null);
    setDevices([]);
    try {
      const result = await invoke<PhysicalDevice[]>("list_physical_devices");
      setDevices(result);
    } catch (e: any) {
      setDeviceScanError(e?.message ?? String(e));
    } finally {
      setDevicesLoading(false);
    }
  };

  const handleSelectDevice = (device: PhysicalDevice) => {
    onEvidenceLocationChange(device.path);
    onEvidenceTypeChange("Physical Disk image");
    setDeviceDialogOpen(false);
  };

  const handleFileSelect = async () => {
    try {
      // Open the file dialog; adjust filters as needed.
      const selected = await open({
        multiple: false,
        directory: evidenceType === "Folder",
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
        onBlur={() => setNameTouched(true)}
        error={nameTouched && !evidenceName.trim()}
        helperText={nameTouched && !evidenceName.trim() ? "Required" : undefined}
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
              e.target.value as
              | "Physical Disk image"
              | "Logical Disk image"
              | "Memory Image"
              | "Procmon dump"
              | "Folder",
            )
          }
        >
          <MenuItem value="Physical Disk image">Physical Disk image</MenuItem>
          <MenuItem value="Logical Disk image">Logical Disk image</MenuItem>
          <MenuItem value="Folder">Folder</MenuItem>

          <MenuItem value="Memory Image" disabled>
            Memory Image
          </MenuItem>
          <MenuItem value="Procmon dump" disabled>
            Procmon dump
          </MenuItem>
        </Select>
      </FormControl>

      <TextField
        label="Selected File / Device"
        value={evidenceLocation}
        fullWidth
        slotProps={{ input: { readOnly: true } }}
        helperText={!evidenceLocation ? "Select a file or scan for connected devices" : undefined}
      />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button variant="contained" onClick={handleFileSelect} sx={{ flex: 1 }}>
          Locate the evidence...
        </Button>
        <Button variant="outlined" onClick={handleScanDevices} sx={{ flex: 1 }}>
          Scan for devices...
        </Button>
      </Box>

      <Dialog open={deviceDialogOpen} onClose={() => setDeviceDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Select a Device</DialogTitle>
        <DialogContent>
          {devicesLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 4, gap: 2 }}>
              <CircularProgress size={24} />
              <Typography variant="body2">Scanning connected devices...</Typography>
            </Box>
          ) : deviceScanError ? (
            <Alert severity="error">{deviceScanError}</Alert>
          ) : devices.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
              No devices found.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Device</TableCell>
                    <TableCell>Name / Model</TableCell>
                    <TableCell>Size</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Protocol</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {devices.map((dev) => (
                    <TableRow
                      key={dev.path}
                      hover
                      onClick={() => handleSelectDevice(dev)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>{dev.path}</TableCell>
                      <TableCell>{dev.name}</TableCell>
                      <TableCell>{dev.size_human}</TableCell>
                      <TableCell>{dev.is_internal ? "Internal" : "External"}</TableCell>
                      <TableCell>{dev.protocol}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeviceDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Description */}
      <TextField
        label="Description"
        value={evidenceDescription}
        onChange={(e) => onEvidenceDescriptionChange(e.target.value)}
        fullWidth
        multiline
        rows={4}
      />

      <EvidenceImageAttachments
        images={evidenceImages}
        onChange={onEvidenceImagesChange}
      />

      {hasImageCaptionError && (
        <Alert severity="warning">
          Each attached image must include a caption before the evidence can be
          created.
        </Alert>
      )}

      {/* Conditionally render submit button if not embedded */}
      {!hideSubmitButton && (
        <Button
          type="submit"
          variant="contained"
          color="primary"
          disabled={isSubmitDisabled || hasImageCaptionError}
        >
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
