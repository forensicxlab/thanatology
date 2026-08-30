import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Alert, Box, CircularProgress, Tooltip, Typography } from "@mui/material";
import { getIosContacts } from "../../../../../dbutils/sqlite";
import { IosContactRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import {
  IosJsonDetailPanel,
  joinLabeledValues,
  renderTimestampCell,
} from "./common";

interface ContactsGridProps {
  evidenceId: number;
  partitionId: number;
}

type ContactDisplayRow = IosContactRow & {
  phones_display: string;
  emails_display: string;
};

function truncatedCell(value: string) {
  const text = value || "—";
  return (
    <Tooltip title={value || ""} placement="bottom-start">
      <span>{text}</span>
    </Tooltip>
  );
}

export default function ContactsGrid({ evidenceId, partitionId }: ContactsGridProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<ContactDisplayRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosContacts(evidenceId, partitionId)
      .then((data) => {
        if (!alive) return;
        setRows(
          data.map((r) => ({
            ...r,
            phones_display: joinLabeledValues(r.phones),
            emails_display: joinLabeledValues(r.emails),
          })),
        );
      })
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  const columns = React.useMemo<GridColDef<ContactDisplayRow>[]>(
    () => [
      { field: "display_name", headerName: "Name", flex: 1, minWidth: 160 },
      {
        field: "phones_display",
        headerName: "Phones",
        flex: 1,
        minWidth: 180,
        renderCell: (params) => truncatedCell(String(params.value ?? "")),
      },
      {
        field: "emails_display",
        headerName: "Emails",
        flex: 1,
        minWidth: 180,
        renderCell: (params) => truncatedCell(String(params.value ?? "")),
      },
      {
        field: "organization",
        headerName: "Organization",
        flex: 1,
        minWidth: 140,
        renderCell: (params) => String(params.value ?? "—"),
      },
      {
        field: "created_ms",
        headerName: "Created (UTC)",
        width: 230,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "modified_ms",
        headerName: "Modified (UTC)",
        width: 230,
        renderCell: (params) => renderTimestampCell(params.value),
      },
    ],
    [],
  );

  if (error) {
    return <Alert severity="error">Failed to load contacts: {error}</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading contacts…</Typography>
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner noun="contacts" timestampLabel="created or modified time" />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed contacts found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner noun="contacts" timestampLabel="created or modified time" />
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
          sorting: { sortModel: [{ field: "display_name", sort: "asc" }] },
        }}
        getDetailPanelContent={(params: GridRowParams<ContactDisplayRow>) => (
          <IosJsonDetailPanel jsonRaw={params.row.json} />
        )}
        getDetailPanelHeight={() => 420}
      />
    </Box>
  );
}
