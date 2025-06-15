/* thanatology/src/components/common/ArtefactsGrid.tsx */

import { useEffect, useState, useCallback, useMemo } from "react";
import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridActionsCellItem,
  GridRowParams,
  DataGridProProps,
} from "@mui/x-data-grid-pro";
import {
  Box,
  Backdrop,
  CircularProgress,
  Typography,
  Divider,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import SendIcon from "@mui/icons-material/Send";
import { emit, emitTo, listen } from "@tauri-apps/api/event";

/* ---------- types ---------- */

export interface BaseRow {
  id: number | string;
  /** If present, the detail panel will render this key-value object */
  metadata?: Record<string, unknown>;
}

export interface ArtefactsGridProps<RowType extends BaseRow> {
  /** Async loader that returns all rows */
  fetchRows: () => Promise<RowType[]>;
  /** Column definitions for the grid */
  columns: GridColDef<RowType>[];
  /** Optional container height (defaults to 80 vh) */
  height?: string | number;
  /**
   * Optional custom detail renderer. If omitted and `row.metadata`
   * exists, the grid shows the default metadata panel. Returning
   * `null` disables the panel for that row.
   */
  renderDetailPanel?: (row: RowType) => React.ReactNode;
}

/* ---------- component ---------- */

function ArtefactsGrid<RowType extends BaseRow>({
  fetchRows,
  columns,
  height = "80vh",
  renderDetailPanel,
}: ArtefactsGridProps<RowType>) {
  const [rows, setRows] = useState<RowType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------- data fetch ---------- */

  useEffect(() => {
    (async () => {
      try {
        setRows(await fetchRows());
      } catch (err) {
        console.error(err);
        setError("Failed to load artefacts.");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchRows]);

  /* ---------- master–detail helpers ---------- */

  /** Default metadata panel (simple `<dl>`). */
  const defaultDetailPanel = useCallback(
    (row: RowType) =>
      row.metadata ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Metadata
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <Box component="dl" sx={{ m: 0 }}>
            {Object.entries(row.metadata).map(([k, v]) => (
              <Box
                key={k}
                component="div"
                sx={{ display: "flex", mb: 0.5, flexWrap: "wrap" }}
              >
                <Typography component="dt" sx={{ fontWeight: 600, mr: 1 }}>
                  {k}:
                </Typography>
                <Typography component="dd" sx={{ m: 0 }}>
                  {String(v)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null,
    [],
  );

  const getDetailPanelContent = React.useCallback<
    NonNullable<DataGridProProps["getDetailPanelContent"]>
  >(
    ({ row }) =>
      renderDetailPanel ? renderDetailPanel(row) : defaultDetailPanel(row),
    [renderDetailPanel, defaultDetailPanel],
  );

  /** Height resolver—return `"auto"` so the grid sizes itself. */
  const getDetailPanelHeight = useCallback<
    NonNullable<
      React.ComponentProps<typeof DataGridPro>["getDetailPanelHeight"]
    >
  >(() => "auto" as const, []);

  /* ---------- action handlers ---------- */

  const handleView = (row: RowType) => {
    // TODO: Replace with real view logic
    console.log("View artefact:", row);
  };

  const handleDownload = (row: RowType) => {
    // TODO: Replace with real download logic
    console.log("Download artefact:", row);
  };

  const handleSend = (row: RowType) => {
    // TODO: Replace with real send/share logic
    console.log("Send artefact:", row);
    emitTo("fileviewer", "message", row);
  };

  /* ---------- action-column definition ---------- */

  const actionColumn: GridColDef<RowType> = {
    field: "actions",
    type: "actions",
    headerName: "Actions",
    width: 100,
    getActions: (params: GridRowParams<RowType>) => [
      <GridActionsCellItem
        key="view"
        icon={<VisibilityIcon />}
        label="View"
        onClick={() => handleView(params.row)}
      />,
      <GridActionsCellItem
        key="download"
        icon={<DownloadIcon />}
        label="Download"
        onClick={() => handleDownload(params.row)}
      />,
      <GridActionsCellItem
        key="send"
        icon={<SendIcon />}
        label="Send"
        onClick={() => handleSend(params.row)}
      />,
    ],
  };

  /** Memoise merged columns to avoid unnecessary re-renders. */
  const gridColumns = useMemo(
    () => [...columns, actionColumn],
    [columns, actionColumn],
  );

  /* ---------- early-return states ---------- */

  if (loading) {
    return (
      <Box sx={{ height, width: "100%" }}>
        <Backdrop
          sx={(theme) => ({
            color: "#fff",
            zIndex: theme.zIndex.drawer + 1,
          })}
          open
        >
          <CircularProgress color="inherit" />
        </Backdrop>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          height,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  /* ---------- main render ---------- */

  return (
    <Box sx={{ height, width: "100%" }}>
      <DataGridPro<RowType>
        rows={rows}
        columns={gridColumns}
        showToolbar
        checkboxSelection
        pagination
        rowHeight={30}
        autoPageSize
        disableRowSelectionOnClick
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        sx={{
          "& .MuiDataGrid-columnHeaders": {
            backgroundColor: "#1976d2",
            color: "#fff",
          },
          "& .MuiDataGrid-row:hover": {
            backgroundColor: "rgba(25,118,210,0.1)",
          },
        }}
      />
    </Box>
  );
}

export default ArtefactsGrid;
