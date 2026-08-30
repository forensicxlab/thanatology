import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, Chip, CircularProgress, Stack, Tooltip, Typography } from "@mui/material";
import { getIosMailMessages } from "../../../../../dbutils/sqlite";
import { IosMailMessageRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import { IosJsonDetailPanel, renderTimestampCell } from "./common";

interface MailGridProps {
  evidenceId: number;
  partitionId: number;
}

/** Show the trailing folder of an IMAP mailbox URL (e.g. ".../INBOX" -> "INBOX"). */
function shortMailbox(url: string | null): string {
  if (!url) return "—";
  try {
    const tail = url.split("/").filter(Boolean).pop() ?? url;
    return decodeURIComponent(tail);
  } catch {
    return url;
  }
}

export default function MailGrid({ evidenceId, partitionId }: MailGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosMailMessageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosMailMessages(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<IosMailMessageRow>[]>(
    () => [
      {
        field: "date_received_ms",
        headerName: "Received (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      { field: "subject", headerName: "Subject", flex: 1, minWidth: 220 },
      { field: "from_address", headerName: "From", flex: 1, minWidth: 180 },
      {
        field: "to_addresses",
        headerName: "To",
        flex: 1,
        minWidth: 180,
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
        field: "mailbox",
        headerName: "Mailbox",
        width: 130,
        valueGetter: (_v, row) => shortMailbox(row.mailbox),
      },
      {
        field: "flags",
        headerName: "Flags",
        width: 150,
        sortable: false,
        renderCell: (p) => (
          <Stack direction="row" spacing={0.5}>
            {p.row.read !== 1 && <Chip size="small" color="primary" label="unread" />}
            {p.row.flagged === 1 && <Chip size="small" color="warning" label="flag" />}
            {p.row.deleted === 1 && <Chip size="small" color="error" variant="outlined" label="del" />}
          </Stack>
        ),
      },
      { field: "size", headerName: "Size (B)", width: 100, type: "number" },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load mail: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading mail…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          noun="mail messages"
          timestampLabel="sent or received time"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed mail messages found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        noun="mail messages"
        timestampLabel="sent or received time"
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
          sorting: { sortModel: [{ field: "date_received_ms", sort: "desc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<IosMailMessageRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
