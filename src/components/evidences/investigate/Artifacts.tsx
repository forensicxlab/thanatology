import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataGridPro,
  GridColDef,
  GridActionsCellItem,
  GridRowParams,
  GRID_DETAIL_PANEL_TOGGLE_FIELD,
  useGridApiContext,
  useGridSelector,
  gridDimensionsSelector,
  useGridApiRef,
  GridRenderCellParams,
} from "@mui/x-data-grid-pro";
import { Box, Tooltip, Typography, Paper, Stack, Chip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router";
import Database from "@tauri-apps/plugin-sql";
import UnixToUTC from "../common/UnixToUTC";
import { fetchArtifactsByCategory } from "../../../dbutils/sqlite";
import * as ReactDOM from "react-dom";
import { ArtifactWithFile } from "../../../dbutils/types";
/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface ArtifactsProps {
  evidence_id: number;
  partition_id: number;
  category: string;
}

/* ------------------------------------------------------------------ */
/* Detail-panel component                                              */
/* ------------------------------------------------------------------ */
function ArtifactDetailPanel({ row }: { row: ArtifactWithFile }) {
  const apiRef = useGridApiContext();
  const width = useGridSelector(apiRef, gridDimensionsSelector)
    .viewportInnerSize.width;

  /* Pretty-print JSON metadata when possible */
  let pretty = row.metadata;
  try {
    pretty = JSON.stringify(JSON.parse(row.metadata), null, 2);
  } catch {
    /* leave as-is if not JSON */
  }

  return (
    <Stack
      sx={{
        py: 2,
        height: "100%",
        boxSizing: "border-box",
        position: "sticky",
        left: 0,
        width,
      }}
      direction="column"
    >
      <Paper sx={{ flex: 1, mx: "auto", width: "90%", p: 2, overflow: "auto" }}>
        <Typography variant="h6" gutterBottom>
          Metadata
        </Typography>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty}</pre>
      </Paper>
    </Stack>
  );
}

/* ------------------------------------------------------------------ */
/* Main grid component                                                 */
/* ------------------------------------------------------------------ */
const Artifacts: React.FC<ArtifactsProps> = ({
  evidence_id,
  partition_id,
  category,
}) => {
  const apiRef = useGridApiRef();
  const navigate = useNavigate();

  /* Keep a stable, empty array reference as rows prop (grid will be driven through `updateRows`) */
  const [rows] = useState<ArtifactWithFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Data fetch */
  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchArtifactsByCategory(
        category,
        evidence_id,
        partition_id,
      )) as ArtifactWithFile[];

      /* Flush the row update synchronously so the DOM is updated immediately */
      ReactDOM.flushSync(() => {
        setLoading(false);
        apiRef.current?.updateRows(data);
      });

      /* Defer autosizing to the next macrotask so the grid has time to render the new content */
      await sleep(0);

      apiRef.current?.autosizeColumns({
        /* Limit autosize to the columns we actually render */
        columns: [
          "identifier",
          "tag",
          "sig_mime",
          "artifact_name",
          "absolute_path",
          "size",
          "created",
          "modified",
          "accessed",
          "permissions",
          "group",
          "owner",
          "actions",
        ],
        includeOutliers: true,
        includeHeaders: true,
      });
    } catch (err) {
      setLoading(false);
      setError((err as Error).message || "Unknown error");
      console.log(error);
    }
  }, [apiRef, category, evidence_id, partition_id]);

  /* Initial load + refresh when deps change */
  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  /* Columns */
  const columns: GridColDef[] = useMemo(
    () => [
      { field: "identifier", headerName: "File Identifier" },

      {
        field: "sig_mime",
        headerName: "MIME",
        renderCell: (params: GridRenderCellParams) => (
          <Chip
            label={params.value}
            size="small"
            color="primary"
            variant="outlined"
          />
        ),
      },

      {
        field: "permissions",
        headerName: "Permissions",
      },

      {
        field: "group",
        headerName: "Group",
      },

      {
        field: "owner",
        headerName: "Owner",
      },

      {
        field: "created",
        headerName: "Created",
        renderCell: (params: GridRenderCellParams) =>
          params.value ? (
            <UnixToUTC timestamp={params.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },

      {
        field: "modified",
        headerName: "Modified",
        renderCell: (params: GridRenderCellParams) =>
          params.value ? (
            <UnixToUTC timestamp={params.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },

      {
        field: "accessed",
        headerName: "Accessed",
        renderCell: (params: GridRenderCellParams) =>
          params.value ? (
            <UnixToUTC timestamp={params.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },

      {
        field: "absolute_path",
        headerName: "File",
        renderCell: (params: GridRenderCellParams) => (
          <div style={{ color: "orange" }}>{params.value}</div>
        ),
      },

      {
        field: "tag",
        headerName: "Tag",
        renderCell: (params: GridRenderCellParams) => (
          <Chip
            label={params.value}
            size="small"
            color="primary"
            variant="outlined"
          />
        ),
      },
      { field: "artifact_name", headerName: "Name" },

      { field: "size", headerName: "Size (B)", type: "number" },
      {
        field: "actions",
        type: "actions",
        headerName: "",
        getActions: ({ row }) => [
          <GridActionsCellItem
            key="view"
            icon={<VisibilityIcon />}
            label="View file"
            onClick={() => navigate(`/viewer/${row.file_id}`)}
            showInMenu={false}
          />,
          <Tooltip key="info" title={row.description} arrow>
            <InfoOutlinedIcon
              fontSize="small"
              sx={{ color: "text.secondary" }}
            />
          </Tooltip>,
        ],
      },
    ],
    [navigate],
  );

  /* Detail panel handlers */
  const getDetailPanelContent = useCallback(
    ({ row }: GridRowParams<ArtifactWithFile>) => (
      <ArtifactDetailPanel row={row} />
    ),
    [],
  );

  const getDetailPanelHeight = useCallback(() => 500, []);

  /* Render */
  return (
    <Box sx={{ width: "100%" }}>
      <DataGridPro
        apiRef={apiRef}
        density="compact"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.artifact_id}
        loading={loading}
        rowHeight={50}
        showToolbar
        disableRowSelectionOnClick
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        initialState={{
          pinnedColumns: { left: [GRID_DETAIL_PANEL_TOGGLE_FIELD] },
          columns: {
            columnVisibilityModel: {
              permissions: false, // Hide 'age' column by default
              group: false, // Hide 'fullName' column by default
              modified: false,
              accessed: false,
            },
          },
        }}
        sx={{
          "& .MuiDataGrid-detailPanel": {
            overflow: "visible",
          },
        }}
      />
    </Box>
  );
};

export default Artifacts;
