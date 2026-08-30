import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRenderCellParams,
  GridRowSelectionModel,
} from "@mui/x-data-grid-pro";
import { Alert, Chip, Typography, Stack } from "@mui/material";
import {
  getTimelineEvents,
  getTimelineEventsNearCursor,
} from "../../../../../dbutils/sqlite";
import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import type { TimelineEvent } from "../../../../../dbutils/types";
import UnixToISO8601UTC, {
  unixToISO8601UTCString,
} from "../../../common/UnixToUTC";
import type { TimelineCursorWindow } from "./timelineControl";

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
  "mobile.location.fix": "Location Fix",
};

function formatEventType(et: string): string {
  return KNOWN_EVENT_LABELS[et] ?? et;
}

interface Props {
  evidenceId: number;
  partitionId: number;
  filter: TimelineEventsFilter | null;
  cursorMs?: number | null;
  cursorWindow?: TimelineCursorWindow | null;
  selectedEventId?: number | null;
  onEventSelect?: (event: TimelineEvent | null) => void;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * Limit cursor-driven DB work to one query per interval while still updating
 * during continuous playback. Unlike a debounce, this does not wait for
 * playback to stop before advancing the nearby-event list.
 */
function useThrottledCursor(
  value: number | null,
  intervalMs: number,
): number | null {
  const [throttled, setThrottled] = React.useState(value);
  const latest = React.useRef(value);
  const lastUpdate = React.useRef(0);

  React.useEffect(() => {
    latest.current = value;
    if (value == null || intervalMs <= 0) {
      lastUpdate.current = Date.now();
      setThrottled(value);
      return;
    }

    const elapsed = Date.now() - lastUpdate.current;
    if (elapsed >= intervalMs) {
      lastUpdate.current = Date.now();
      setThrottled(value);
      return;
    }

    const timer = window.setTimeout(() => {
      lastUpdate.current = Date.now();
      setThrottled(latest.current);
    }, intervalMs - elapsed);
    return () => window.clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}

export default function TimelineEventsGrid({
  evidenceId,
  partitionId,
  filter,
  cursorMs = null,
  cursorWindow = null,
  selectedEventId = null,
  onEventSelect,
}: Props) {
  const [rows, setRows] = React.useState<TimelineEvent[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paginationModel, setPaginationModel] = React.useState({
    page: 0,
    pageSize: PAGE_SIZE_OPTIONS[0],
  });

  const cursorIsFinite = cursorMs != null && Number.isFinite(cursorMs);
  const nearCursorActive = cursorWindow != null && cursorIsFinite;
  const cursorBeforeMs = Math.max(0, cursorWindow?.beforeMs ?? 0);
  const cursorAfterMs = Math.max(0, cursorWindow?.afterMs ?? 0);
  const cursorLimit = cursorWindow?.limit;
  const queryIntervalMs = Math.max(0, cursorWindow?.queryIntervalMs ?? 250);
  const hasFilter = filter != null;
  const filterStart = filter?.start ?? null;
  const filterEnd = filter?.end ?? null;
  const filterEventTypesKey = JSON.stringify(filter?.event_types ?? null);
  const throttledCursor = useThrottledCursor(
    cursorIsFinite ? cursorMs : null,
    queryIntervalMs,
  );

  React.useEffect(() => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [filterStart, filterEnd, filterEventTypesKey, nearCursorActive]);

  React.useEffect(() => {
    if (!hasFilter && !nearCursorActive) {
      setRows([]);
      setRowCount(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const effectiveFilter: TimelineEventsFilter | undefined = hasFilter
          ? {
              start: filterStart,
              end: filterEnd,
              event_types: JSON.parse(filterEventTypesKey) as string[] | null,
            }
          : undefined;
        if (nearCursorActive && throttledCursor != null) {
          const nearbyRows = await getTimelineEventsNearCursor(
            evidenceId,
            partitionId,
            {
              cursorMs: throttledCursor,
              beforeMs: cursorBeforeMs,
              afterMs: cursorAfterMs,
              limit: cursorLimit,
              filter: effectiveFilter,
            },
          );
          if (!cancelled) {
            setRows(nearbyRows);
            setRowCount(nearbyRows.length);
          }
          return;
        }

        const result = await getTimelineEvents(
          evidenceId,
          partitionId,
          paginationModel.page * paginationModel.pageSize,
          paginationModel.pageSize,
          effectiveFilter,
        );
        if (!cancelled) {
          setRows(result.rows);
          setRowCount(result.rowCount);
        }
      } catch (caught) {
        if (!cancelled) {
          setRows([]);
          setRowCount(0);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    evidenceId,
    partitionId,
    paginationModel.page,
    paginationModel.pageSize,
    hasFilter,
    filterStart,
    filterEnd,
    filterEventTypesKey,
    nearCursorActive,
    throttledCursor,
    cursorBeforeMs,
    cursorAfterMs,
    cursorLimit,
  ]);

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

  const selectionModel = React.useMemo<GridRowSelectionModel>(
    () => ({
      type: "include",
      ids: new Set(selectedEventId == null ? [] : [selectedEventId]),
    }),
    [selectedEventId],
  );

  const handleSelectionChange = React.useCallback(
    (model: GridRowSelectionModel) => {
      if (!onEventSelect) return;
      const firstId = model.ids.values().next().value;
      if (firstId == null) {
        onEventSelect(null);
        return;
      }
      onEventSelect(rows.find((row) => row.id === Number(firstId)) ?? null);
    },
    [onEventSelect, rows],
  );

  if (!hasFilter && !nearCursorActive) {
    return (
      <Stack sx={{ alignItems: "center", justifyContent: "center", height: 200 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Click a point on the chart or apply a date range to browse events.
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={1}>
      {nearCursorActive && throttledCursor != null && (
        <Chip
          size="small"
          color="info"
          variant="outlined"
          sx={{ alignSelf: "flex-start" }}
          label={`Following ${unixToISO8601UTCString(throttledCursor)} · −${Math.round(
            cursorBeforeMs / 1000,
          )}s / +${Math.round(cursorAfterMs / 1000)}s · ${rowCount} nearby event${
            rowCount === 1 ? "" : "s"
          }`}
        />
      )}
      {error && <Alert severity="error">Failed to load timeline events: {error}</Alert>}
      <DataGridPro
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        rowCount={nearCursorActive ? rows.length : rowCount}
        loading={loading}
        paginationMode={nearCursorActive ? "client" : "server"}
        pagination={!nearCursorActive}
        paginationModel={nearCursorActive ? undefined : paginationModel}
        onPaginationModelChange={nearCursorActive ? undefined : setPaginationModel}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        hideFooterPagination={nearCursorActive}
        rowSelectionModel={selectionModel}
        onRowSelectionModelChange={handleSelectionChange}
        disableMultipleRowSelection
        disableRowSelectionOnClick={!onEventSelect}
        keepNonExistentRowsSelected
        density="compact"
        autoHeight
      />
    </Stack>
  );
}
