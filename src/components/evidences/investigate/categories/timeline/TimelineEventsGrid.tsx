import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRenderCellParams,
} from "@mui/x-data-grid-pro";
import { Chip, Typography, Stack } from "@mui/material";
import { getTimelineEvents } from "../../../../../dbutils/sqlite";
import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import type { TimelineEvent } from "../../../../../dbutils/types";
import UnixToISO8601UTC from "../../../common/UnixToUTC";

const KNOWN_EVENT_LABELS: Record<string, string> = {
  "file.created": "File Created",
  "file.accessed": "File Accessed",
  "file.modified": "File Modified",
  "windows.evtx.event": "Windows Event Log",
  "windows.pml.event": "Process Monitor",
  "mobile.communication.message": "Message",
  "mobile.communication.attachment": "Attachment",
  "mobile.communication.call": "Call",
  "mobile.contact.created": "Contact Created",
  "mobile.contact.modified": "Contact Modified",
  "mobile.browser.visit": "Web Visit",
  "mobile.config.privacy_permission": "Privacy Permission",
  "mobile.usage.event": "Device Usage",
};

function formatEventType(et: string): string {
  return KNOWN_EVENT_LABELS[et] ?? et;
}

interface Props {
  evidenceId: number;
  partitionId: number;
  filter: TimelineEventsFilter | null;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

export default function TimelineEventsGrid({ evidenceId, partitionId, filter }: Props) {
  const [rows, setRows] = React.useState<TimelineEvent[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [paginationModel, setPaginationModel] = React.useState({
    page: 0,
    pageSize: PAGE_SIZE_OPTIONS[0],
  });

  React.useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, [filter]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await getTimelineEvents(
          evidenceId,
          partitionId,
          paginationModel.page * paginationModel.pageSize,
          paginationModel.pageSize,
          filter ?? undefined,
        );
        if (!cancelled) {
          setRows(result.rows);
          setRowCount(result.rowCount);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setRowCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [evidenceId, partitionId, paginationModel.page, paginationModel.pageSize, filter]);

  const columns = React.useMemo<GridColDef[]>(
    () => [
      {
        field: "ts",
        headerName: "Timestamp (UTC)",
        minWidth: 200,
        renderCell: (p: GridRenderCellParams) =>
          p.value != null ? <UnixToISO8601UTC timestamp={p.value} /> : null,
      },
      {
        field: "event_type",
        headerName: "Event Type",
        minWidth: 180,
        renderCell: (p: GridRenderCellParams) => (
          <Chip
            label={formatEventType(p.value as string)}
            size="small"
            variant="outlined"
            color="primary"
          />
        ),
      },
      {
        field: "source",
        headerName: "Source",
        minWidth: 160,
      },
      {
        field: "description",
        headerName: "Description",
        flex: 2,
        minWidth: 200,
      },
      {
        field: "actor",
        headerName: "Actor",
        minWidth: 160,
      },
      {
        field: "file_path",
        headerName: "File",
        flex: 2,
        minWidth: 200,
      },
    ],
    [],
  );

  if (!filter) {
    return (
      <Stack sx={{ alignItems: "center", justifyContent: "center", height: 200 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Click a point on the chart or apply a date range to browse events.
        </Typography>
      </Stack>
    );
  }

  return (
    <DataGridPro
      rows={rows}
      getRowId={row => row.id}
      columns={columns}
      rowCount={rowCount}
      loading={loading}
      paginationMode="server"
      pagination
      paginationModel={paginationModel}
      onPaginationModelChange={setPaginationModel}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      autoHeight
      disableRowSelectionOnClick
    />
  );
}
