import React, { useState } from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowSelectionModel,
  GridActionsCellItem,
  GridRenderCellParams,
  GridToolbar,
} from "@mui/x-data-grid-pro";
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Button,
  Fab,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { Info, Numbers, Work } from "@mui/icons-material";
import AddIcon from "@mui/icons-material/Add";
import { Case } from "../../../dbutils/types";
import { useNavigate } from "react-router";

interface CaseListProps {
  cases: Case[];
  onDeleteCases: (selectedIds: number[]) => void; // Delete handler passed as a prop
}

const CaseList: React.FC<CaseListProps> = ({ cases, onDeleteCases }) => {
  const navigate = useNavigate();

  // Store selection (array of ids)
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>(
    [],
  );
  // Control the delete confirmation dialog
  const [openConfirm, setOpenConfirm] = useState(false);

  // Open the confirmation dialog when delete is clicked
  const handleDeleteSelected = () => {
    setOpenConfirm(true);
  };

  // Call the passed-in delete handler with the current selection model
  const handleConfirmDelete = () => {
    console.log("Deleting cases:", selectionModel);
    onDeleteCases(selectionModel as number[]);
    setSelectionModel([]);
    setOpenConfirm(false);
  };

  const handleCancelDelete = () => {
    setOpenConfirm(false);
  };

  // Define grid columns
  const columns: GridColDef[] = [
    {
      field: "id",
      headerName: "Identifier",
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Numbers style={{ marginRight: 8 }} />
          CASE-{params.value}
        </div>
      ),
      flex: 1,
    },
    {
      field: "name",
      headerName: "Name",
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Work style={{ marginRight: 8 }} />
          {params.value}
        </div>
      ),
      flex: 1,
    },
    {
      field: "description",
      headerName: "Description",
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Info style={{ marginRight: 8 }} />
          {params.value}
        </div>
      ),
      flex: 2,
    },
    {
      field: "actions",
      headerName: "Actions",
      type: "actions",
      getActions: (params) => [
        <GridActionsCellItem
          icon={<VisibilityIcon />}
          label="View"
          onClick={() => navigate(`/cases/${params.id}`)}
        />,
        <GridActionsCellItem
          icon={<EditIcon />}
          label="Edit"
          sx={{
            color: "primary.main",
          }}
          onClick={() => console.log("Editing case:", params.id)}
        />,
      ],
    },
  ];

  return (
    <Box sx={{ height: "70vh", width: "100%" }}>
      <DataGridPro
        pagination
        rowHeight={30}
        rows={cases}
        columns={columns}
        checkboxSelection
        onRowSelectionModelChange={(newSelection) =>
          setSelectionModel(newSelection)
        }
        slots={{ toolbar: GridToolbar }}
        rowSelectionModel={selectionModel}
        disableRowSelectionOnClick
        autoPageSize
      />

      {/* Floating Action Buttons */}
      <Box
        sx={{
          position: "absolute",
          bottom: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Fab
          color="primary"
          aria-label="add"
          onClick={() => navigate(`/case/new`)}
        >
          <AddIcon />
        </Fab>
        {selectionModel.length > 0 && (
          <Fab
            color="secondary"
            aria-label="delete"
            onClick={handleDeleteSelected}
          >
            <DeleteIcon />
          </Fab>
        )}
      </Box>

      {/* Confirmation Dialog for deletion */}
      <Dialog open={openConfirm} onClose={handleCancelDelete}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the selected case(s)?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="secondary">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CaseList;
