import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, CircularProgress, Tooltip, Typography } from "@mui/material";
import { getIosNotes } from "../../../../../dbutils/sqlite";
import { IosNoteRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, renderTimestampCell } from "./common";

interface NotesGridProps {
  evidenceId: number;
  partitionId: number;
}

export default function NotesGrid({ evidenceId, partitionId }: NotesGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosNoteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosNotes(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<IosNoteRow>[]>(
    () => [
      { field: "title", headerName: "Title", flex: 1, minWidth: 200 },
      {
        field: "snippet",
        headerName: "Snippet",
        flex: 2,
        minWidth: 240,
        renderCell: (p) => {
          const v = String(p.value ?? "");
          return (
            <Tooltip title={v} placement="bottom-start">
              <span>{v || "—"}</span>
            </Tooltip>
          );
        },
      },
      { field: "folder", headerName: "Folder", width: 140 },
      {
        field: "modified_ms",
        headerName: "Modified (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      {
        field: "created_ms",
        headerName: "Created (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load notes: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading notes…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner noun="notes" timestampLabel="created or modified time" />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed notes found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner noun="notes" timestampLabel="created or modified time" />
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
          sorting: { sortModel: [{ field: "modified_ms", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<IosNoteRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
