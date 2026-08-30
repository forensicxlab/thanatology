import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, Chip, CircularProgress, Typography } from "@mui/material";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import { getIosInteractions } from "../../../../../dbutils/sqlite";
import { IosInteractionRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, renderTimestampCell } from "./common";

interface InteractionsGridProps {
  evidenceId: number;
  partitionId: number;
}

export default function InteractionsGrid({
  evidenceId,
  partitionId,
}: InteractionsGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosInteractionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosInteractions(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<IosInteractionRow>[]>(
    () => [
      {
        field: "start_ms",
        headerName: "When (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      { field: "bundle_id", headerName: "Application", flex: 1, minWidth: 200 },
      {
        field: "direction",
        headerName: "Direction",
        width: 130,
        renderCell: (p) => {
          const v = String(p.value ?? "unknown");
          if (v === "outgoing")
            return (
              <Chip size="small" color="primary" variant="outlined" icon={<CallMadeIcon />} label="outgoing" />
            );
          if (v === "incoming")
            return <Chip size="small" variant="outlined" icon={<CallReceivedIcon />} label="incoming" />;
          return <Chip size="small" variant="outlined" label={v} />;
        },
      },
      {
        field: "counterpart",
        headerName: "Counterpart",
        flex: 1,
        minWidth: 180,
        valueGetter: (_v, row) => row.counterpart_name || row.counterpart_id || "",
        renderCell: (p) => String(p.value || "—"),
      },
      {
        field: "recipient_count",
        headerName: "Recipients",
        width: 110,
        type: "number",
      },
      {
        field: "target_bundle_id",
        headerName: "Target app",
        flex: 1,
        minWidth: 180,
        renderCell: (p) => String(p.value ?? "—"),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load interactions: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading interactions…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          mode="interval"
          noun="interactions"
          timestampLabel="start/end interval"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed interactions found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        mode="interval"
        noun="interactions"
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
        getDetailPanelContent={(params: GridRowParams<IosInteractionRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
