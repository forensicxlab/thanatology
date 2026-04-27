import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import Grid from "@mui/material/Grid";
import {
  Box,
  Typography,
  CircularProgress,
  Card,
  CardContent,
  Divider,
  Chip,
  Link,
} from "@mui/material";
import { useNavigate } from "react-router";

import Database from "@tauri-apps/plugin-sql";
import { Evidence } from "../../../dbutils/types";
import { getEvidence } from "../../../dbutils/sqlite";
import DiskImage from "./DiskImage";
import FolderImage from "./FolderImage";
import LogicalImage from "./LogicalImage";
import { useSnackbar } from "../../SnackbarProvider";

interface PreProcessingProps {
  database: Database | null;
}

const PreProcessing: React.FC<PreProcessingProps> = ({ database }) => {
  const navigate = useNavigate();
  const { display_message } = useSnackbar();

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    getEvidence(database, id)
      .then((result: Evidence) => {
        setEvidence(result);
      })
      .catch((error: any) => {
        console.error("Error fetching evidence:", error);
        display_message("error", `Error fetching evidence: ${error}`);
      });
  }, [database, id, display_message]);

  if (!evidence) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh"
        }}>
        <CircularProgress />
      </Box>
    );
  }

  /**
   * Decide which preprocessing wizard to show depending on the evidence type.
   */
  const renderPreprocessingComponent = () => {
    switch (evidence.type) {
      case "Logical Disk image":
        return <LogicalImage database={database} evidenceData={evidence} />;
      case "Folder":
        return <FolderImage database={database} evidenceData={evidence} />;
      default:
        // Fallback to DiskImage for physical/raw disk images, memory dumps, etc.
        return <DiskImage database={database} evidenceData={evidence} />;
    }
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Grid container spacing={3}>
        {/* Metadata */}
        <Grid size={12}>
          <Card sx={{ p: 2, bgcolor: "background.paper", boxShadow: 3 }}>
            <CardContent>
              <Typography variant="h6" color="secondary">
                Evidence Metadata
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body1">
                <strong>Name:</strong> {evidence.name}
              </Typography>
              <Typography variant="body1">
                <strong>Type:</strong>{" "}
                <Chip
                  label={evidence.type}
                  color="primary"
                  variant="outlined"
                />
              </Typography>
              <Typography variant="body1">
                <strong>Related case: </strong>
                <Link
                  component="button"
                  color="textPrimary"
                  onClick={() => navigate(`/cases/${evidence.case_id}`)}
                >
                  CASE-{evidence.case_id}
                </Link>
              </Typography>
              <Typography variant="body1">
                <strong>Path:</strong> {evidence.path}
              </Typography>
              <Typography variant="body1">
                <strong>Description:</strong> {evidence.description}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Preprocessing wizard (DiskImage or LogicalImage) */}
        <Grid size={12}>
          <Typography variant="h6" color="secondary" gutterBottom>
            Preprocessing
          </Typography>
          <Divider sx={{ my: 2 }} />
          {renderPreprocessingComponent()}
        </Grid>
      </Grid>
    </Box>
  );
};

export default PreProcessing;
