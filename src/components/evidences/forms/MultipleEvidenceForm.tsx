// MultipleEvidenceForm.tsx
import React from "react";
import {
  Box,
  Button,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DeleteIcon from "@mui/icons-material/Delete";
import NewEvidenceForm from "./NewEvidenceForm";
import { Evidence } from "../../../dbutils/types";

interface MultipleEvidenceFormProps {
  evidences: Evidence[];
  setEvidences: React.Dispatch<React.SetStateAction<Evidence[]>>;
  defaultEmptyEvidence: Evidence;
}

const MultipleEvidenceForm: React.FC<MultipleEvidenceFormProps> = ({
  evidences,
  setEvidences,
  defaultEmptyEvidence,
}) => {
  // Add a new empty evidence form
  const addEvidence = () => {
    setEvidences((prev) => [...prev, { ...defaultEmptyEvidence }]);
  };

  // Update a field for a specific evidence (by index)
  const updateEvidenceField = <K extends keyof Evidence>(
    index: number,
    field: K,
    value: Evidence[K],
  ) => {
    setEvidences((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Remove evidence form at given index (cannot remove the first evidence)
  const removeEvidence = (index: number) => {
    if (index === 0) return; // Prevent deletion of the first form
    setEvidences((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Box component="form" sx={{ p: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Add Multiple Evidence
      </Typography>

      {evidences.map((evidence, index) => (
        <Accordion key={index} defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box
              sx={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h6">Evidence {index + 1}</Typography>
              {index > 0 && (
                <IconButton
                  onClick={(event) => {
                    // Prevent toggling the accordion when clicking delete
                    event.stopPropagation();
                    removeEvidence(index);
                  }}
                  aria-label="delete evidence"
                >
                  <DeleteIcon color="error" />
                </IconButton>
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <NewEvidenceForm
              hideSubmitButton
              evidenceName={evidence.name}
              evidenceType={evidence.type}
              evidenceLocation={evidence.path}
              evidenceDescription={evidence.description}
              onEvidenceNameChange={(value) =>
                updateEvidenceField(index, "name", value)
              }
              onEvidenceTypeChange={(value) =>
                updateEvidenceField(index, "type", value)
              }
              onEvidenceLocationChange={(value) =>
                updateEvidenceField(index, "path", value)
              }
              onEvidenceDescriptionChange={(value) =>
                updateEvidenceField(index, "description", value)
              }
            />
          </AccordionDetails>
        </Accordion>
      ))}

      <Button variant="outlined" onClick={addEvidence} sx={{ mt: 2, mb: 2 }}>
        + Add Evidence
      </Button>
    </Box>
  );
};

export default MultipleEvidenceForm;
