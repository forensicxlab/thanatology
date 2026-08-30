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
import CallMissedIcon from "@mui/icons-material/CallMissed";
import { getIosCalls } from "../../../../../dbutils/sqlite";
import { IosCallRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import {
  IosJsonDetailPanel,
  formatDuration,
  renderTimestampCell,
} from "./common";

interface CallsGridProps {
  evidenceId: number;
  partitionId: number;
}

type CallDisplayRow = IosCallRow & { party: string };

function directionChip(row: CallDisplayRow) {
  if (row.missed === 1) {
    return (
      <Chip
        size="small"
        color="error"
        variant="outlined"
        icon={<CallMissedIcon />}
        label="Missed"
      />
    );
  }
  if (row.direction === "outgoing") {
    return (
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        icon={<CallMadeIcon />}
        label="Outgoing"
      />
    );
  }
  if (row.direction === "incoming") {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<CallReceivedIcon />}
        label="Incoming"
      />
    );
  }
  return <Chip size="small" variant="outlined" label="Unknown" />;
}

export default function CallsGrid({ evidenceId, partitionId }: CallsGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<CallDisplayRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosCalls(evidenceId, partitionId)
      .then((data) => {
        if (!alive) return;
        setRows(
          data.map((r) => ({
            ...r,
            party: r.party_name || r.party_address || "Unknown",
          })),
        );
      })
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<CallDisplayRow>[]>(
    () => [
      {
        field: "direction",
        headerName: "Direction",
        width: 130,
        renderCell: (params) => directionChip(params.row),
      },
      { field: "party", headerName: "Contact", flex: 1, minWidth: 160 },
      { field: "party_address", headerName: "Number", flex: 1, minWidth: 150 },
      {
        field: "ts",
        headerName: "Time (UTC)",
        width: 230,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "duration_seconds",
        headerName: "Duration",
        width: 110,
        renderCell: (params) => formatDuration(params.value as number | null),
      },
      {
        field: "call_type",
        headerName: "Type",
        width: 150,
        renderCell: (params) =>
          params.value ? (
            <Chip size="small" variant="outlined" label={String(params.value)} />
          ) : (
            "—"
          ),
      },
      {
        field: "service_provider",
        headerName: "Service",
        flex: 1,
        minWidth: 150,
        renderCell: (params) => String(params.value ?? "—"),
      },
    ],
    [],
  );

  if (error) {
    return <Alert severity="error">Failed to load calls: {error}</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading calls…</Typography>
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner noun="call records" timestampLabel="call time" />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed call records found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner noun="call records" timestampLabel="call time" />
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
          sorting: { sortModel: [{ field: "ts", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<CallDisplayRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
