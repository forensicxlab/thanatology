import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Fab,
  Box,
  Card,
  CardContent,
  Divider,
} from "@mui/material";
import Grid from "@mui/material/Grid2";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EvidenceList from "../evidences/lists/EvidenceList";
import { Case, Evidence } from "../../dbutils/types";
import { getCaseWithEvidences } from "../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";

// Function to perform deletion from the database.
async function deleteEvidences(evidenceIds: number[]): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("Deleted evidences with IDs:", evidenceIds);
      resolve();
    }, 1000);
  });
}

interface CaseDetailsProps {
  database: Database | null;
}

const CaseDetails: React.FC<CaseDetailsProps> = ({ database }) => {
  const { id } = useParams<{ id: string }>();
  const [caseDetails, setCaseDetails] = useState<Case | null>(null);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);

  useEffect(() => {
    async function fetchData() {
      getCaseWithEvidences(database, id)
        .then(({ case: fetchedCase, evidences: fetchedEvidences }) => {
          setEvidences(fetchedEvidences);
          setCaseDetails(fetchedCase);
        })
        .catch((error: any) => {
          console.error("Error fetching case details:", error);
        });
    }
    fetchData();
  }, [id, database]);

  const handleDeleteSelected = async () => {
    try {
      await deleteEvidences(selectedEvidenceIds);
      setEvidences((prev) =>
        prev.filter((evidence) => !selectedEvidenceIds.includes(evidence.id)),
      );
      setSelectedEvidenceIds([]);
      setDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting evidences:", error);
    }
  };

  const handleAddEvidence = () => {
    console.log("Navigate to add evidence page");
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Typography variant="h4" gutterBottom color="primary">
        Case Details
      </Typography>

      <Grid container spacing={3}>
        {/* Left: Case Details */}
        <Grid size={12}>
          <Card sx={{ p: 2, bgcolor: "background.paper", boxShadow: 3 }}>
            <CardContent>
              {caseDetails ? (
                <>
                  <Typography variant="h6" color="secondary">
                    {caseDetails.name}
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="body1">
                    <strong>Identifier:</strong> CASE-{caseDetails.id}
                  </Typography>
                  <Typography variant="body1">
                    <strong>Description:</strong> {caseDetails.description}
                  </Typography>
                </>
              ) : (
                <Typography>Loading case details...</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Evidence List */}
        <Grid size={12}>
          <Card sx={{ p: 2, boxShadow: 3, bgcolor: "background.paper" }}>
            <CardContent>
              <Typography variant="h6" color="secondary" gutterBottom>
                Evidences
              </Typography>
              <Divider sx={{ my: 2 }} />
              <EvidenceList
                evidences={evidences}
                onSelectionChange={setSelectedEvidenceIds}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Floating Action Buttons */}
      <Box
        sx={{
          position: "fixed",
          bottom: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Fab color="primary" onClick={handleAddEvidence}>
          <AddIcon />
        </Fab>
        {selectedEvidenceIds.length > 0 && (
          <Fab color="secondary" onClick={() => setDeleteDialogOpen(true)}>
            <DeleteIcon />
          </Fab>
        )}
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the selected evidences? This action
            cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDeleteSelected} color="secondary">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CaseDetails;
