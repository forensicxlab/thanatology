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
import { emitTo } from "@tauri-apps/api/event";
import UnixToUTC from "../common/UnixToUTC";
import { fetchArtifactsByCategory } from "../../../dbutils/sqlite";
import * as ReactDOM from "react-dom";
import { ArtifactWithFile } from "../../../dbutils/types";
import { invoke } from "@tauri-apps/api/core";

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
  const [rows, setRows] = useState<ArtifactWithFile[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 20,
  });

  const [filterModel, setFilterModel] = useState<any>({
    items: [],
  });

  const AUTOSIZE_COLS = [
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
  ];

  const runAutosize = React.useCallback(() => {
    apiRef.current?.autosizeColumns({
      columns: AUTOSIZE_COLS,
      includeHeaders: true,
      includeOutliers: true,
      disableColumnVirtualization: true, // if you want off-screen columns measured too
    });
  }, [apiRef]);

  useEffect(() => {
    if (loading) return;

    let raf1 = 0;
    let raf2 = 0;

    const schedule = () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          runAutosize();
        });
      });
    };

    // Re-run autosize whenever the viewport inner size changes (e.g. tab becomes visible)
    const unsubscribe = apiRef.current?.subscribeEvent?.(
      "viewportInnerSizeChange",
      ({ width }: { width: number }) => {
        if (width > 0) schedule();
      },
    );

    // Also try once (if already visible)
    schedule();

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      unsubscribe?.();
    };
  }, [apiRef, loading, runAutosize]);

  /* Data fetch */
  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { page, pageSize } = paginationModel;
      const offset = page * pageSize;

      const { rows: data, rowCount: total } = await fetchArtifactsByCategory(
        category,
        evidence_id,
        partition_id,
        offset,
        pageSize,
        filterModel
      );

      const dataWithId = data.map((r: any) => ({ ...r, id: r.artifact_id })) as ArtifactWithFile[];

      /* Flush the row update synchronously so the DOM is updated immediately */
      ReactDOM.flushSync(() => {
        setRowCount(total);
        setRows(dataWithId);
        setLoading(false);
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
        includeHeaders: true,
        includeOutliers: true,
        disableColumnVirtualization: true,
      });
    } catch (err) {
      setLoading(false);
      setError((err as Error).message || "Unknown error");
      console.log(error);
    }
  }, [apiRef, category, evidence_id, partition_id, paginationModel, filterModel]);

  /* Initial load + refresh when deps change */
  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [filterModel]);

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
            onClick={async () => {
              const payload = {
                evidenceId: evidence_id,
                partitionId: partition_id,
                Identifier: row.identifier,
                fileId: row.file_id,
                fileSize: row.size,
                path: row.absolute_path,
              };

              localStorage.setItem("pending_fileviewer_payload", JSON.stringify(payload));

              try {
                await invoke("new_fileviewer");
              } catch (error) {
                console.error("Error opening the file viewer:", error);
              } finally {
                await emitTo("fileviewer", "message", payload);
              }
            }}
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
        pagination
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        filterMode="server"
        filterModel={filterModel}
        onFilterModelChange={setFilterModel}
        rowCount={rowCount}
        pageSizeOptions={[25, 50, 100]}
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        initialState={{
          pinnedColumns: { left: [GRID_DETAIL_PANEL_TOGGLE_FIELD] },
          columns: {
            columnVisibilityModel: {
              permissions: false,
              group: false,
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
