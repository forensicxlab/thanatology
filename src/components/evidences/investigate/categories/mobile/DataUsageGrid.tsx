import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, Chip, CircularProgress, Divider, Paper, Typography } from "@mui/material";
import { getIosDataUsage } from "../../../../../dbutils/sqlite";
import { IosDataUsageRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, formatBytes, renderTimestampCell } from "./common";
import DataUsageChart from "./DataUsageChart";

interface DataUsageGridProps {
  evidenceId: number;
  partitionId: number;
}

export default function DataUsageGrid({ evidenceId, partitionId }: DataUsageGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [selectedApp, setSelectedApp] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<IosDataUsageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // The application drill-down belongs to the current result set. Do not let
  // a previously selected app make a newly scoped table appear empty.
  React.useEffect(() => {
    setSelectedApp(null);
  }, [evidenceId, partitionId, start, end]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosDataUsage(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  // Clicking a bar drills the table into that application.
  const visibleRows = React.useMemo(
    () =>
      selectedApp
        ? rows.filter((r) => (r.bundle_name || r.process_name || "unknown") === selectedApp)
        : rows,
    [rows, selectedApp],
  );

  const columns = React.useMemo<GridColDef<IosDataUsageRow>[]>(
    () => [
      {
        field: "bundle_name",
        headerName: "Application",
        flex: 1,
        minWidth: 220,
        valueGetter: (_v, row) => row.bundle_name || row.process_name || "",
        renderCell: (p) => String(p.value || "—"),
      },
      {
        field: "wwan_in",
        headerName: "Cellular in",
        width: 120,
        type: "number",
        renderCell: (p) => formatBytes(p.value as number | null),
      },
      {
        field: "wwan_out",
        headerName: "Cellular out",
        width: 120,
        type: "number",
        renderCell: (p) => formatBytes(p.value as number | null),
      },
      {
        field: "wifi_in",
        headerName: "Wi-Fi in",
        width: 110,
        type: "number",
        renderCell: (p) => formatBytes(p.value as number | null),
      },
      {
        field: "wifi_out",
        headerName: "Wi-Fi out",
        width: 110,
        type: "number",
        renderCell: (p) => formatBytes(p.value as number | null),
      },
      {
        field: "ts",
        headerName: "Recorded (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      {
        field: "process_name",
        headerName: "Process",
        flex: 1,
        minWidth: 200,
        renderCell: (p) => String(p.value ?? "—"),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load network usage: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading network usage…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          noun="usage records"
          timestampLabel="recorded usage time"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed network usage found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        noun="usage records"
        timestampLabel="recorded usage time"
      />
      <Paper variant="outlined" sx={{ mb: 1, pt: 1, flexShrink: 0 }}>
        <DataUsageChart
          evidenceId={evidenceId}
          partitionId={partitionId}
          selectedApp={selectedApp}
          onSelectApp={setSelectedApp}
        />
      </Paper>

      {selectedApp && (
        <>
          <Box sx={{ pb: 1 }}>
            <Chip
              size="small"
              color="primary"
              label={`Table filtered to ${selectedApp}`}
              onDelete={() => setSelectedApp(null)}
            />
          </Box>
          <Divider sx={{ mb: 1 }} />
        </>
      )}

      {/* Keep the table usable: the chart must not squeeze it to a single row. */}
      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 340 }}>
      <DataGridPro
        apiRef={apiRef}
        rows={visibleRows}
        columns={columns}
        getRowId={(r) => r.id}
        density="compact"
        showToolbar
        disableRowSelectionOnClick
        pagination
        pageSizeOptions={[25, 50, 100, 250]}
        initialState={{
          pagination: { paginationModel: { pageSize: 50, page: 0 } },
          sorting: { sortModel: [{ field: "wwan_in", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<IosDataUsageRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
      </Box>
    </Box>
  );
}
