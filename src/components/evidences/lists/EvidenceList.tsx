import React, { useState } from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowSelectionModel,
  GridRenderCellParams,
  GridActionsCellItem,
} from "@mui/x-data-grid-pro";
import {
  Badge,
  Description,
  DoubleArrowSharp,
  Info,
  Numbers,
  PlayArrow,
  Stop,
  Visibility,
} from "@mui/icons-material";
import Tooltip from "@mui/material/Tooltip";
import { useNavigate } from "react-router";
import { Evidence } from "../../../dbutils/types";
import { RestartAlt } from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { useSnackbar } from "../../SnackbarProvider";

interface EvidenceListProps {
  evidences: Evidence[];
  onSelectionChange: (selectionModel: GridRowSelectionModel) => void;
  onEvidenceChange?: () => void;
}

const EvidenceList: React.FC<EvidenceListProps> = ({
  evidences,
  onSelectionChange,
  onEvidenceChange,
}) => {
  const navigate = useNavigate();
  const { display_message } = useSnackbar();
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>({
    type: "include",
    ids: new Set(),
  });

  const handleRowSelectionModelChange = (
    newSelection: GridRowSelectionModel,
  ) => {
    setSelectionModel(newSelection);
    onSelectionChange(newSelection);
  };

  const handleRestart = async (evidenceId: number) => {
    try {
      const baseDir = await appLocalDataDir();
      const mainDbPath = `${baseDir}/thanatology.db`;
      const evidenceDbPath = `${baseDir}/evidences/${evidenceId}.db`;

      await invoke("reset_evidence", {
        evidenceId,
        mainDbPath,
        evidenceDbPath,
      });

      display_message("success", "Evidence processing restarted.");
      if (onEvidenceChange) {
        onEvidenceChange();
      }
    } catch (err) {
      console.error("Failed to restart evidence:", err);
      display_message("error", `Failed to restart evidence: ${err}`);
    }
  };

  const columns: GridColDef[] = [
    {
      field: "id",
      headerName: "ID",
      flex: 1,
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Numbers style={{ marginRight: 8 }} />
          EV-{params.value}
        </div>
      ),
    },
    {
      field: "name",
      headerName: "Name",
      flex: 1,
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Badge style={{ marginRight: 8 }} />
          EV-{params.value}
        </div>
      ),
    },
    {
      field: "type",
      headerName: "Type",
      flex: 1,
    },
    {
      field: "description",
      headerName: "Description",
      flex: 1,
      renderCell: (params: GridRenderCellParams) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Description style={{ marginRight: 8 }} />
          {params.value ? params.value : "No description provided."}
        </div>
      ),
    },
    {
      field: "status",
      headerName: "Status",
      flex: 1,
      renderCell: (params: GridRenderCellParams) => {
        let statusColor;
        let statusText;

        switch (params.value) {
          case 0:
            statusColor = "red";
            statusText = "Not processed";
            break;
          case 1:
            statusColor = "orange";
            statusText = "Pending start";
            break;
          case 2:
            statusColor = "orange";
            statusText = "Processing";
            break;
          default:
            statusColor = "green";
            statusText = "Ready";
        }

        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: statusColor,
            }}
          >
            <Info style={{ marginRight: 8 }} />
            {statusText}
          </div>
        );
      },
    },
    {
      field: "actions",
      headerName: "Actions",
      type: "actions",
      getActions: (params) => {
        const { status } = params.row;
        if (status === 0) {
          return [
            <Tooltip key="launch" title="Review for processing.">
              <GridActionsCellItem
                icon={<DoubleArrowSharp />}
                label="Review for Pre-Process"
                onClick={() => navigate(`/evidences/preprocess/${params.id}`)}
              />
            </Tooltip>,
          ];
        } else if (status === 1) {
          return [
            <Tooltip key="extract" title="Start Extraction">
              <GridActionsCellItem
                icon={<PlayArrow />}
                label="Start Extraction"
                onClick={() => {
                  navigate(`/evidences/process/${params.id}`);
                }}
              />
            </Tooltip>,
          ];
        } else if (status === 2) {
          return [
            <Tooltip key="stop" title="Stop processing">
              <GridActionsCellItem
                icon={<Stop />}
                label="Stop processing the evidence"
                onClick={() => {
                  console.log("TODO");
                }}
              />
            </Tooltip>,
            <Tooltip key="review" title="View more">
              <GridActionsCellItem
                icon={<Visibility />}
                label="Check the evidence analysis status."
                onClick={() => {
                  navigate(`/evidences/process/${params.id}`);
                }}
              />
            </Tooltip>,
          ];
        } else if (status >= 3) {
          return [
            <Tooltip key="investigate" title="Investigate">
              <GridActionsCellItem
                icon={<PlayArrow />}
                label="Investigate the evidence"
                onClick={() => navigate(`/evidences/investigate/${params.id}`)}
              />
            </Tooltip>,
            <Tooltip key="restart" title="Restart processing">
              <GridActionsCellItem
                icon={<RestartAlt />}
                label="Restart processing"
                onClick={() => handleRestart(params.row.id)}
              />
            </Tooltip>,
          ];
        }
        return [];
      },
    },
  ];

  return (
    <div style={{ width: "100%" }}>
      <DataGridPro
        rows={evidences}
        columns={columns}
        checkboxSelection
        rowSelectionModel={selectionModel}
        onRowSelectionModelChange={handleRowSelectionModelChange}
        autosizeOptions={{
          columns: ["id", "name", "type", "description", "status", "actions"],
          includeOutliers: true,
          includeHeaders: true,
        }}
        disableRowSelectionOnClick
      />
    </div>
  );
};

export default EvidenceList;
