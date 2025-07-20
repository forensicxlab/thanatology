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

import { fetchArtifactsByCategory } from "../../../dbutils/sqlite";
import * as ReactDOM from "react-dom";

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface ArtifactWithFile {
  artifact_id: number;
  artifact_name: string;
  description: string;
  parser: string | null;
  tag: string;
  category: string;
  file_id: number;
  identifer: number;
  absolute_path: string;
  file_name: string;
  ftype: string;
  size: number;
  metadata: string;
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
      const db = await Database.load("sqlite:thanatology.db");
      const data = (await fetchArtifactsByCategory(
        db,
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
          "artifact_name",
          "absolute_path",
          "size",
          "actions",
        ],
        includeOutliers: true,
        includeHeaders: true,
      });
    } catch (err) {
      setLoading(false);
      setError((err as Error).message || "Unknown error");
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
      { field: "absolute_path", headerName: "File" },

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
      <div style={{ width: "100%" }}>
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
          }}
          sx={{
            "& .MuiDataGrid-detailPanel": {
              overflow: "visible",
            },
          }}
        />
      </div>
    </Box>
  );
};

export default Artifacts;
