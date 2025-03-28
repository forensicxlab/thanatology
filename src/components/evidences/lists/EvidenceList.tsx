import React, { useEffect } from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowSelectionModel,
  GridRenderCellParams,
  GridActionsCellItem,
  useGridApiRef,
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

export type Evidence = {
  id: number;
  case_id: number;
  name: string;
  type: "Disk image" | "Memory Image" | "Procmon dump";
  path: string;
  description: string;
  status: number; // Assuming status is either 0 or 1
};

interface EvidenceListProps {
  evidences: Evidence[];
  onSelectionChange: (selectedIds: number[]) => void;
}

const EvidenceList: React.FC<EvidenceListProps> = ({
  evidences,
  onSelectionChange,
}) => {
  const apiRef = useGridApiRef();
  const navigate = useNavigate();

  useEffect(() => {
    if (apiRef.current) {
      apiRef.current.autosizeColumns({
        columns: ["id", "name", "type", "description", "status"],
        includeOutliers: true,
        includeHeaders: true,
      });
    }
  }, [evidences, apiRef]);

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
          EV-{params.value}
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
          case 3:
            statusColor = "green";
            statusText = "Ready";
            break;
          default:
            statusColor = "grey";
            statusText = "Unknown";
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
            <Tooltip key="review" title="Stop processing">
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
        } else if (status === 3) {
          return [
            <Tooltip key="review" title="Investigate">
              <GridActionsCellItem
                icon={<PlayArrow />}
                label="Investigate the evidence"
                onClick={() => navigate(`/evidences/investigate/${params.id}`)}
              />
            </Tooltip>,
          ];
        }
        return [];
      },
    },
  ];

  return (
    <div style={{ height: 400, width: "100%" }}>
      <DataGridPro
        apiRef={apiRef}
        rows={evidences}
        columns={columns}
        checkboxSelection
        onRowSelectionModelChange={(newSelection: GridRowSelectionModel) => {
          onSelectionChange(newSelection as number[]);
        }}
        autosizeOnMount
        disableRowSelectionOnClick
        autosizeOptions={{
          columns: ["id", "name", "type", "description", "status"],
          includeOutliers: true,
          includeHeaders: true,
        }}
      />
    </div>
  );
};

export default EvidenceList;
