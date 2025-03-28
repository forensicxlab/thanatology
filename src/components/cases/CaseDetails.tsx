import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import NewEvidenceDialog from "../evidences/dialogs/NewEvidenceDialog";
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
  const [openNewEvidenceDialog, setOpenNewEvidenceDialog] =
    useState<boolean>(false);

  const fetchCaseData = async () => {
    try {
      const { case: fetchedCase, evidences: fetchedEvidences } =
        await getCaseWithEvidences(database, id);
      setCaseDetails(fetchedCase);
      setEvidences(fetchedEvidences);
    } catch (error) {
      console.error("Error fetching case details:", error);
    }
  };

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
    setOpenNewEvidenceDialog(true);
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Grid container spacing={3}>
        {/* Left: Case Details */}
        <Grid size={12}>
          {caseDetails ? (
            <>
              <Typography variant="h6" color="secondary">
                CASES/{caseDetails.name}
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
        </Grid>

        {/* Right: Evidence List */}
        <Grid size={12}>
          <EvidenceList
            evidences={evidences}
            onSelectionChange={setSelectedEvidenceIds}
          />
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

      {caseDetails && (
        <NewEvidenceDialog
          open={openNewEvidenceDialog}
          onClose={() => setOpenNewEvidenceDialog(false)}
          caseId={caseDetails.id}
          database={database}
          onEvidenceCreated={fetchCaseData}
        />
      )}

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
