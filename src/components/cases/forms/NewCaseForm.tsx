// NewCaseForm.tsx

import React from "react";
import { TextField, Autocomplete, Box, Typography } from "@mui/material";

interface NewCaseFormProps {
  availableCollaborators: string[];
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  selectedCollaborators: string[];
  setSelectedCollaborators: React.Dispatch<React.SetStateAction<string[]>>;
}

const NewCaseForm: React.FC<NewCaseFormProps> = ({
  availableCollaborators,
  name,
  setName,
  description,
  setDescription,
  selectedCollaborators,
  setSelectedCollaborators,
}) => {
  return (
    <Box
      component="form"
      noValidate
      sx={{
        maxWidth: 600,
        mx: "auto",
        p: 2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography variant="h5" component="h1" gutterBottom>
        Case information
      </Typography>

      <TextField
        variant="outlined"
        required
        fullWidth
        label="Case Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        margin="normal"
      />
      <TextField
        key="Description"
        required
        fullWidth
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        margin="normal"
        multiline
        rows={4}
      />
      <Autocomplete
        multiple
        options={availableCollaborators}
        getOptionLabel={(option) => option}
        value={selectedCollaborators}
        onChange={(_event, newValue) => setSelectedCollaborators(newValue)}
        renderInput={(params) => (
          <TextField
            {...params}
            variant="outlined"
            label="Collaborators"
            placeholder="Select collaborators"
            margin="normal"
          />
        )}
      />
    </Box>
  );
};

export default NewCaseForm;
