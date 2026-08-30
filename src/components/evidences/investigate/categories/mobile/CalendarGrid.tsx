import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, Chip, CircularProgress, Tooltip, Typography } from "@mui/material";
import { getIosCalendarEvents } from "../../../../../dbutils/sqlite";
import { IosCalendarEventRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, renderTimestampCell } from "./common";

interface CalendarGridProps {
  evidenceId: number;
  partitionId: number;
}

export default function CalendarGrid({ evidenceId, partitionId }: CalendarGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosCalendarEventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosCalendarEvents(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<IosCalendarEventRow>[]>(
    () => [
      {
        field: "start_ms",
        headerName: "Start (UTC)",
        width: 230,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      { field: "summary", headerName: "Event", flex: 1, minWidth: 200 },
      {
        field: "all_day",
        headerName: "All day",
        width: 90,
        renderCell: (p) => (p.value === 1 ? <Chip size="small" label="all-day" variant="outlined" /> : "—"),
      },
      {
        field: "location",
        headerName: "Location",
        flex: 1,
        minWidth: 180,
        valueGetter: (_v, row) =>
          [row.location_title, row.location_address].filter(Boolean).join(" — "),
        renderCell: (p) => {
          const v = String(p.value ?? "");
          return (
            <Tooltip title={v} placement="bottom-start">
              <span>{v || "—"}</span>
            </Tooltip>
          );
        },
      },
      {
        field: "status",
        headerName: "Status",
        width: 120,
        renderCell: (p) => (p.value ? <Chip size="small" variant="outlined" label={String(p.value)} /> : "—"),
      },
      {
        field: "end_ms",
        headerName: "End (UTC)",
        width: 230,
        renderCell: (p) => renderTimestampCell(p.value),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load calendar events: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading calendar events…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          mode="interval"
          noun="calendar events"
          timestampLabel="start/end interval"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed calendar events found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        mode="interval"
        noun="calendar events"
        timestampLabel="start/end interval"
      />
      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        density="compact"
        showToolbar
        disableRowSelectionOnClick
        pagination
        pageSizeOptions={[25, 50, 100, 250]}
        initialState={{
          pagination: { paginationModel: { pageSize: 50, page: 0 } },
          sorting: { sortModel: [{ field: "start_ms", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<IosCalendarEventRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
