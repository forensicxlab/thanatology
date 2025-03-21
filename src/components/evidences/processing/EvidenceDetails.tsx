import React from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import { Evidence } from "../../../dbutils/types";
import { Fingerprint } from "@mui/icons-material";
interface EvidenceDetailsProps {
  evidence: Evidence;
}

const EvidenceDetails: React.FC<EvidenceDetailsProps> = ({ evidence }) => {
  return (
    <Paper
      elevation={3}
      sx={{
        p: 2,
        borderLeft: "6px solid #8bc34a",
      }}
    >
      <Box display="flex" alignItems="center" mb={1}>
        <Fingerprint sx={{ mr: 1, color: "#8bc34a" }} fontSize="large" />
        <Typography variant="h6" color="textPrimary">
          {evidence.name}
        </Typography>
      </Box>
      <Box mb={1}>
        <Typography variant="body1">
          <strong>Identifier:</strong> EV-{evidence.id}
        </Typography>
        <Typography variant="body1"></Typography>
      </Box>
      <Box mb={1}>
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ display: "flex", alignItems: "center" }}
        >
          <DescriptionIcon sx={{ mr: 0.5 }} />
          <strong>Path:</strong> {evidence.path}
        </Typography>
      </Box>
      <Box mb={1}>
        <Typography variant="body2" color="textSecondary">
          <strong>Description:</strong> {evidence.description}
        </Typography>
      </Box>
    </Paper>
  );
};

export default EvidenceDetails;
