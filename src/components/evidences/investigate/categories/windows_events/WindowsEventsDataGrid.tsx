import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  DataGridPro,
  GridColDef,
  GridRenderCellParams,
  useGridApiRef,
  GridFilterModel,
  GridRowParams,
} from "@mui/x-data-grid-pro";
import {
  Box,
  Chip,
  Stack,
  Typography,
  Paper,
  Divider,
  IconButton,
  Tooltip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoOutlined from "@mui/icons-material/InfoOutlined";

import UnixToISO8601UTC from "../../../common/UnixToUTC";
import { getWindowsEvents } from "../../../../../dbutils/sqlite";
import type { WindowsEventRow } from "../../../../../dbutils/types";
import type { TimelineWindowsEventFilter } from "../../../../../dbutils/sqlite";

interface Props {
  evidenceId: number;
  partitionId: number;

  filterModel?: GridFilterModel;
  onFilterModelChange?: (m: GridFilterModel) => void;

  timelineFilter?: TimelineWindowsEventFilter | null;
  onClearTimelineFilter?: () => void;

  onRowActivate?: (row: WindowsEventRow) => void;
}

const pageSizeDefault = 50;

function levelLabel(level: number | null | undefined) {
  switch (level) {
    case 1:
      return { label: "Critical", color: "error" as const };
    case 2:
      return { label: "Error", color: "error" as const };
    case 3:
      return { label: "Warning", color: "warning" as const };
    case 4:
      return { label: "Information", color: "info" as const };
    case 5:
      return { label: "Verbose", color: "default" as const };
    default:
      return { label: "Unknown", color: "default" as const };
  }
}

function JsonDetailPanel({ row }: { row: any }) {
  const raw = (row.json_raw ?? "") as string;

  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // keep raw
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty || "");
    } catch {
      // ignore
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">Event JSON</Typography>
        <Tooltip title="Copy JSON">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Divider sx={{ my: 1 }} />

      <Paper
        variant="outlined"
        sx={{
          p: 1,
          bgcolor: "background.default",
          overflow: "auto",
          maxHeight: 380,
        }}
      >
        <Box component="pre" sx={{ m: 0, fontSize: 12 }}>
          {pretty || "(empty)"}
        </Box>
      </Paper>
    </Box>
  );
}

export default function WindowsEventsDataGrid({
  evidenceId,
  partitionId,
  filterModel,
  onFilterModelChange,
  timelineFilter,
  onClearTimelineFilter,
  onRowActivate,
}: Props) {
  const apiRef = useGridApiRef();

  const [rows, setRows] = React.useState<WindowsEventRow[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [paginationModel, setPaginationModel] = React.useState({
    page: 0,
    pageSize: pageSizeDefault,
  });

  const columns = React.useMemo<GridColDef[]>(
    () => [
      {
        field: "ts",
        headerName: "Timestamp (UTC)",
        minWidth: 210,
        renderCell: (p: GridRenderCellParams) =>
          p.value ? <UnixToISO8601UTC timestamp={p.value} /> : <span>—</span>,
      },
      {
        field: "event_id",
        headerName: "EventID",
        type: "number",
        minWidth: 110,
        renderCell: (p) =>
          p.value != null ? (
            <Chip size="small" label={p.value} variant="outlined" />
          ) : (
            <span>—</span>
          ),
      },
      {
        field: "provider_name",
        headerName: "Provider",
        flex: 1,
        minWidth: 220,
        renderCell: (p) => (
          <Stack direction="row" gap={1} alignItems="center">
            <span>{String(p.value ?? "unknown")}</span>
            {p.row.provider_guid ? (
              <Tooltip title={String(p.row.provider_guid)} arrow>
                <InfoOutlined
                  fontSize="small"
                  sx={{ color: "text.secondary" }}
                />
              </Tooltip>
            ) : null}
          </Stack>
        ),
      },
      { field: "channel", headerName: "Channel", minWidth: 140 },
      { field: "computer", headerName: "Computer", minWidth: 160 },
      {
        field: "level",
        headerName: "Level",
        minWidth: 140,
        renderCell: (p) => {
          const lv = levelLabel(p.value as any);
          return (
            <Chip
              size="small"
              label={lv.label}
              color={lv.color}
              variant="outlined"
            />
          );
        },
      },
      { field: "user_sid", headerName: "User SID", minWidth: 200 },
      {
        field: "event_record_id",
        headerName: "Record ID",
        type: "number",
        minWidth: 120,
      },

      // less important (hidden by default)
      { field: "task", headerName: "Task", type: "number", minWidth: 110 },
      { field: "opcode", headerName: "Opcode", type: "number", minWidth: 110 },
      { field: "keywords", headerName: "Keywords", minWidth: 220 },
      { field: "process_id", headerName: "PID", type: "number", minWidth: 90 },
      { field: "thread_id", headerName: "TID", type: "number", minWidth: 90 },
      {
        field: "file_id",
        headerName: "File ID",
        type: "number",
        minWidth: 110,
      },
    ],
    [],
  );

  const fetchData = React.useCallback(async () => {
    const { page, pageSize } = paginationModel;
    const offset = page * pageSize;

    setIsLoading(true);

    const { rows: newRows, rowCount: total } = await getWindowsEvents(
      evidenceId,
      partitionId,
      offset,
      pageSize,
      filterModel as any,
      timelineFilter ?? undefined,
    );

    ReactDOM.flushSync(() => {
      setRows(newRows);
      setRowCount(total);
      setIsLoading(false);
    });

    apiRef.current?.autosizeColumns({
      columns: [
        "ts",
        "event_id",
        "provider_name",
        "channel",
        "computer",
        "level",
        "user_sid",
        "event_record_id",
      ],
      includeHeaders: true,
      includeOutliers: true,
      disableColumnVirtualization: true,
    });
  }, [
    paginationModel,
    evidenceId,
    partitionId,
    filterModel,
    timelineFilter,
    apiRef,
  ]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  React.useEffect(() => {
    // reset to page 0 when timeline filter changes
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [timelineFilter]);

  const handleRowDoubleClick = React.useCallback(
    (params: GridRowParams) => onRowActivate?.(params.row as WindowsEventRow),
    [onRowActivate],
  );

  return (
    <Box sx={{ width: "100%" }}>
      {timelineFilter?.start != null && timelineFilter?.end != null && (
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{ mb: 1, flexWrap: "wrap" }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Timeline filter:
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={
              <>
                <UnixToISO8601UTC timestamp={timelineFilter.start} /> →{" "}
                <UnixToISO8601UTC timestamp={timelineFilter.end} />
              </>
            }
            onDelete={onClearTimelineFilter}
          />
        </Stack>
      )}

      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowCount={rowCount}
        pagination
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[25, 50, 100, 250]}
        density="compact"
        showToolbar
        onRowDoubleClick={handleRowDoubleClick}
        filterModel={filterModel}
        onFilterModelChange={(m) => onFilterModelChange?.(m)}
        initialState={{
          columns: {
            columnVisibilityModel: {
              task: false,
              opcode: false,
              keywords: false,
              process_id: false,
              thread_id: false,
              file_id: false,
            },
          },
        }}
        getDetailPanelContent={(params) => <JsonDetailPanel row={params.row} />}
        getDetailPanelHeight={() => 460}
        disableRowSelectionOnClick
      />
    </Box>
  );
}
