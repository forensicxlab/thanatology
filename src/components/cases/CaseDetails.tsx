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
  Divider,
  Backdrop,
  CircularProgress,
} from "@mui/material";
import Grid from "@mui/material/Grid";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EvidenceList from "../evidences/lists/EvidenceList";
import { Case, Evidence } from "../../dbutils/types";
import { getCaseWithEvidences, deleteEvidences } from "../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";
import { GridRowSelectionModel } from "@mui/x-data-grid-pro";

interface CaseDetailsProps {
  database: Database | null;
}

const CaseDetails: React.FC<CaseDetailsProps> = ({ database }) => {
  const { id } = useParams<{ id: string }>();
  const [caseDetails, setCaseDetails] = useState<Case | null>(null);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>({
    type: "include",
    ids: new Set(),
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);
  const [openNewEvidenceDialog, setOpenNewEvidenceDialog] =
    useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Helper: normalize the selection model into number[]
  const getSelectedEvidenceIds = (): number[] => {
    const sm = selectionModel as any;

    // New style: { type: 'include' | 'exclude', ids: Set<GridRowId> }
    if (sm && typeof sm === "object" && "ids" in sm && sm.ids instanceof Set) {
      return Array.from(sm.ids).map((id) => Number(id));
    }

    // Old style: GridRowId[]
    if (Array.isArray(sm)) {
      return sm.map((id) => Number(id));
    }

    return [];
  };

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
      try {
        const { case: fetchedCase, evidences: fetchedEvidences } =
          await getCaseWithEvidences(database, id);
        setEvidences(fetchedEvidences);
        setCaseDetails(fetchedCase);
      } catch (error) {
        console.error("Error fetching case details:", error);
      }
    }
    fetchData();
  }, [id, database]);

  const handleDeleteSelected = async () => {
    const selectedEvidenceIds = getSelectedEvidenceIds();
    if (selectedEvidenceIds.length === 0) {
      // Nothing selected => just close dialog defensively
      setDeleteDialogOpen(false);
      return;
    }

    try {
      setDeleting(true);
      await deleteEvidences(selectedEvidenceIds);
      setEvidences((prev) =>
        prev.filter((evidence) => !selectedEvidenceIds.includes(evidence.id)),
      );

      // Clear selection in a way compatible with both APIs
      setSelectionModel({ type: "include", ids: new Set() });

      // Explicitly close the dialog
      setDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting evidences:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddEvidence = () => {
    setOpenNewEvidenceDialog(true);
  };

  const selectedEvidenceIds = getSelectedEvidenceIds();

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
            onSelectionChange={setSelectionModel}
            onEvidenceChange={fetchCaseData}
          />
        </Grid>
      </Grid>

      {/* Floating Action Buttons */}
      <Box
        sx={{
          position: "fixed",
          bottom: 35,
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

      {/* Full-screen loader while deleting evidences */}
      <Backdrop
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={deleting}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </Box>
  );
};

export default CaseDetails;
