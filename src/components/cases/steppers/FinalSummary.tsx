import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import { Evidence } from "../../../dbutils/types";

// MUI Icons
import PersonIcon from "@mui/icons-material/Person";
import DescriptionIcon from "@mui/icons-material/Description";
import { DeveloperBoard, PeopleAltRounded } from "@mui/icons-material";
import MemoryIcon from "@mui/icons-material/Memory";

interface FinalSummaryProps {
  name: string;
  description: string;
  selectedCollaborators: string[];
  evidences: Evidence[];
}

const FinalSummary: React.FC<FinalSummaryProps> = ({
  name,
  description,
  selectedCollaborators,
  evidences,
}) => {
  const getEvidenceIcon = (evidenceType: string) => {
    const lowerType = evidenceType.toLowerCase();
    if (lowerType.includes("disk")) {
      return <DeveloperBoard sx={{ mr: 1 }} />;
    }
    if (lowerType.includes("memory")) {
      return <MemoryIcon sx={{ mr: 1 }} />;
    }
    //TODO: ProcMon
    return null;
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Paper elevation={3} sx={{ p: 2 }}>
        <Typography variant="h5" gutterBottom>
          Your case metadata
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          Case Information
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <PersonIcon sx={{ mr: 1 }} />
          <Typography variant="body1">{name}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <DescriptionIcon sx={{ mr: 1 }} />
          <Typography variant="body1">{description}</Typography>
        </Box>
        {selectedCollaborators.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <PeopleAltRounded sx={{ mr: 1 }} />
            <Typography variant="body1">{selectedCollaborators}</Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle1" gutterBottom>
          Evidences
        </Typography>
        {evidences.length > 0 && evidences[0].name.trim() !== "" ? (
          <List>
            {evidences.map((evidence, index) => (
              <ListItem key={index} alignItems="flex-start">
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      {getEvidenceIcon(evidence.type)}
                      <Typography variant="subtitle1">
                        {evidence.name}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <React.Fragment>
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.primary"
                      >
                        {evidence.type}
                      </Typography>
                      {" — " + evidence.description}
                      <br />
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.primary"
                      >
                        {evidence.path}
                      </Typography>
                    </React.Fragment>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No evidence provided.
          </Typography>
        )}
      </Paper>
    </Box>
  );
};

export default FinalSummary;
