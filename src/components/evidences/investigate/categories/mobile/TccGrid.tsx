import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, Chip, CircularProgress, Typography } from "@mui/material";
import { getIosTccGrants } from "../../../../../dbutils/sqlite";
import { IosTccGrantRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, renderTimestampCell } from "./common";

interface TccGridProps {
  evidenceId: number;
  partitionId: number;
}

function decisionChip(decision: string | null) {
  if (decision === "allowed") {
    return <Chip size="small" color="success" variant="outlined" label="allowed" />;
  }
  if (decision === "denied") {
    return <Chip size="small" color="error" label="denied" />;
  }
  if (decision === "limited") {
    return <Chip size="small" color="warning" variant="outlined" label="limited" />;
  }
  return <Chip size="small" variant="outlined" label={decision ?? "unknown"} />;
}

export default function TccGrid({ evidenceId, partitionId }: TccGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosTccGrantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosTccGrants(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<IosTccGrantRow>[]>(
    () => [
      { field: "client", headerName: "Application", flex: 1, minWidth: 220 },
      { field: "service_name", headerName: "Resource", width: 190 },
      {
        field: "decision",
        headerName: "Decision",
        width: 120,
        renderCell: (p) => decisionChip(p.value as string | null),
      },
      {
        field: "last_modified_ms",
        headerName: "Decided (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      {
        field: "client_type",
        headerName: "Client type",
        width: 130,
        renderCell: (p) => String(p.value ?? "—"),
      },
      {
        field: "service",
        headerName: "TCC service key",
        flex: 1,
        minWidth: 200,
        renderCell: (p) => String(p.value ?? "—"),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load privacy grants: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading privacy grants…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          noun="permission decisions"
          timestampLabel="decision time"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed privacy permissions found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        noun="permission decisions"
        timestampLabel="decision time"
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
          sorting: { sortModel: [{ field: "last_modified_ms", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<IosTccGrantRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
