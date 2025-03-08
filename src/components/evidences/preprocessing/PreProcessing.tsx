import React, { useState, useEffect } from "react";
import { useParams } from "react-router";
import Grid from "@mui/material/Grid2";

import {
  Box,
  Typography,
  CircularProgress,
  Card,
  CardContent,
  Divider,
  Chip,
} from "@mui/material";
import Link from "@mui/material/Link";

import Database from "@tauri-apps/plugin-sql";
import { Evidence } from "../../../dbutils/types";
import { getEvidence } from "../../../dbutils/sqlite";
import DiskImage from "./DiskImage";
import { useNavigate } from "react-router";

interface PreProcessingProps {
  database: Database | null;
}

const PreProcessing: React.FC<PreProcessingProps> = ({ database }) => {
  const navigate = useNavigate();

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    getEvidence(database, id)
      .then((result: Evidence) => {
        setEvidence(result);
      })
      .catch((error: any) => {
        console.error("Error fetching evidence:", error);
      });
  }, [database, id]);

  if (!evidence) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Grid container spacing={3}>
        {/* Left: Evidence Metadata */}
        <Grid size={{ xs: 12, md: 12, lg: 12, xl: 4 }}>
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
                  onClick={() => {
                    console.log("HJAHA");
                    location.replace(`/cases/${evidence.case_id}`);
                    //navigate(`/cases/${evidence.case_id}`);
                  }}
                >
                  CASE-{evidence.case_id}
                </Link>
              </Typography>
              <Typography variant="body1">
                <strong>Path:</strong>
                {evidence.path}
              </Typography>
              <Typography variant="body1">
                <strong>Description:</strong> {evidence.description}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Disk Image Component */}
        <Grid size={{ xs: 12, md: 12, lg: 12, xl: 8 }}>
          <Card sx={{ p: 2, boxShadow: 3, bgcolor: "background.paper" }}>
            <CardContent>
              <Typography variant="h6" color="secondary" gutterBottom>
                Preprocessing
              </Typography>
              <Divider sx={{ my: 2 }} />
              <DiskImage
                database={database}
                evidenceData={evidence}
                onComplete={() => {}}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default PreProcessing;
