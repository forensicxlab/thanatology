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
import { Box, CircularProgress, Typography, Divider } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import SendIcon from "@mui/icons-material/Send";
import { emitTo } from "@tauri-apps/api/event";

/* ---------- types ---------- */

export interface BaseRow {
  id: number | string;
  metadata?: Record<string, unknown>;
}

export interface ArtefactsGridProps<RowType extends BaseRow> {
  fetchRows: () => Promise<RowType[]>;
  columns: GridColDef<RowType>[];
  height?: string | number;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRows();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setError("Failed to load artefacts.");
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchRows]);

  const defaultDetailPanel = useCallback(
    (row: RowType) =>
      row.metadata ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Metadata</Typography>
          <Divider sx={{ mb: 1 }} />
          <Box component="dl" sx={{ m: 0 }}>
            {Object.entries(row.metadata).map(([k, v]) => (
              <Box key={k} sx={{ display: "flex", mb: 0.5, flexWrap: "wrap" }}>
                <Typography component="dt" sx={{ fontWeight: 600, mr: 1 }}>{k}:</Typography>
                <Typography component="dd" sx={{ m: 0 }}>{String(v)}</Typography>
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
    ({ row }) => renderDetailPanel ? renderDetailPanel(row) : defaultDetailPanel(row),
    [renderDetailPanel, defaultDetailPanel],
  );

  const getDetailPanelHeight = useCallback<
    NonNullable<React.ComponentProps<typeof DataGridPro>["getDetailPanelHeight"]>
  >(() => "auto" as const, []);

  const handleView = useCallback((row: RowType) => {
    console.log("View artefact:", row);
  }, []);

  const handleDownload = useCallback((row: RowType) => {
    console.log("Download artefact:", row);
  }, []);

  const handleSend = useCallback((row: RowType) => {
    emitTo("fileviewer", "message", row);
  }, []);

  const actionColumn = useMemo<GridColDef<RowType>>(() => ({
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
  }), [handleView, handleDownload, handleSend]);

  const gridColumns = useMemo(
    () => [...columns, actionColumn],
    [columns, actionColumn],
  );

  if (loading) {
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
        <CircularProgress />
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

  return (
    /* Explicit height on outer box → DataGrid's height:100% resolves correctly */
    <Box sx={{ height, width: "100%", isolation: "isolate" }}>
      <DataGridPro<RowType>
        rows={rows}
        columns={gridColumns}
        showToolbar
        checkboxSelection
        pagination
        rowHeight={30}
        pageSizeOptions={[25, 50, 100]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        disableRowSelectionOnClick
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        sx={{
          height: "100%",
          "& .MuiDataGrid-row:hover": {
            backgroundColor: "rgba(25,118,210,0.1)",
          },
        }}
      />
    </Box>
  );
}

export default ArtefactsGrid;
