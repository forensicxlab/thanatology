import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { getIosActivityEvents } from "../../../../../dbutils/sqlite";
import { IosActivityEventRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import { IosJsonDetailPanel, formatDuration, renderTimestampCell } from "./common";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";

interface ActivityViewProps {
  evidenceId: number;
  partitionId: number;
}

const APP_USAGE_STREAM = "/app/usage";
const LOCK_STREAM = "/device/isLocked";
const MAX_LANES = 12;

const stamp = (ms: number) =>
  unixToISO8601UTCString(ms).replace(/\.\d+Z$/, "Z").replace("T", " ");

/** Trailing component of a bundle id, e.g. net.whatsapp.WhatsApp -> WhatsApp. */
function shortBundle(bundle: string): string {
  const tail = bundle.split(".").pop();
  return tail && tail.length > 1 ? tail : bundle;
}

export default function ActivityView({ evidenceId, partitionId }: ActivityViewProps) {
  const apiRef = useGridApiRef();
  const { start, end } = useTimeFilter();
  const [rows, setRows] = React.useState<IosActivityEventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosActivityEvents(evidenceId, partitionId)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, start, end]);

  /** Time domain covered by the loaded events. */
  const domain = React.useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const r of rows) {
      if (typeof r.start_ms === "number") min = Math.min(min, r.start_ms);
      const e = typeof r.end_ms === "number" ? r.end_ms : r.start_ms;
      if (typeof e === "number") max = Math.max(max, e);
    }
    return Number.isFinite(min) && Number.isFinite(max) && max > min
      ? { min, max, span: max - min }
      : null;
  }, [rows]);

  /** App-usage sessions grouped into lanes, busiest app first. */
  const lanes = React.useMemo(() => {
    const byApp = new Map<
      string,
      { total: number; sessions: { start: number; end: number; seconds: number }[] }
    >();
    for (const r of rows) {
      if (r.stream !== APP_USAGE_STREAM || !r.bundle_id) continue;
      if (typeof r.start_ms !== "number") continue;
      const seconds = r.duration_seconds ?? 0;
      const endMs = typeof r.end_ms === "number" ? r.end_ms : r.start_ms;
      const entry = byApp.get(r.bundle_id) ?? { total: 0, sessions: [] };
      entry.total += seconds;
      entry.sessions.push({ start: r.start_ms, end: endMs, seconds });
      byApp.set(r.bundle_id, entry);
    }
    return Array.from(byApp.entries())
      .map(([bundle, v]) => ({ bundle, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_LANES);
  }, [rows]);

  /** Spans where the device was reported locked. */
  const lockSpans = React.useMemo(() => {
    return rows
      .filter(
        (r) =>
          r.stream === LOCK_STREAM &&
          r.value_int === 1 &&
          typeof r.start_ms === "number",
      )
      .map((r) => ({
        start: r.start_ms as number,
        end: typeof r.end_ms === "number" ? r.end_ms : (r.start_ms as number),
      }));
  }, [rows]);

  const columns = React.useMemo<GridColDef<IosActivityEventRow>[]>(
    () => [
      {
        field: "start_ms",
        headerName: "Start (UTC)",
        width: 210,
        renderCell: (p) => renderTimestampCell(p.value),
      },
      {
        field: "family",
        headerName: "Family",
        width: 130,
        renderCell: (p) =>
          p.value ? <Chip size="small" variant="outlined" label={String(p.value)} /> : "—",
      },
      { field: "stream", headerName: "Stream", width: 190 },
      { field: "summary", headerName: "Event", flex: 1, minWidth: 260 },
      {
        field: "duration_seconds",
        headerName: "Duration",
        width: 110,
        renderCell: (p) => formatDuration(p.value as number | null),
      },
      {
        field: "bundle_id",
        headerName: "Application",
        flex: 1,
        minWidth: 180,
        renderCell: (p) => String(p.value ?? "—"),
      },
    ],
    [],
  );

  if (error) return <Alert severity="error">Failed to load activity: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading device activity…</Typography>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">
          No parsed device activity found for this partition.
        </Typography>
      </Box>
    );
  }

  const pct = (ms: number) =>
    domain ? ((ms - domain.min) / domain.span) * 100 : 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", flexGrow: 1, minHeight: 0, gap: 1 }}>
      {/* Swimlane: foreground app sessions over the covered period */}
      {domain && lanes.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5, flexShrink: 0 }}>
          <Stack
            direction="row"
            sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
          >
            <Typography variant="subtitle2">
              Foreground app usage — top {lanes.length} of {rows.length.toLocaleString()} events
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {stamp(domain.min)} → {stamp(domain.max)} UTC
            </Typography>
          </Stack>

          {/* Device locked band */}
          <Stack direction="row" sx={{ alignItems: "center", mb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ width: 130, flexShrink: 0, color: "text.secondary" }}
            >
              device locked
            </Typography>
            <Box
              sx={{
                position: "relative",
                flexGrow: 1,
                height: 10,
                bgcolor: "action.hover",
                borderRadius: 0.5,
                overflow: "hidden",
              }}
            >
              {lockSpans.map((s, i) => (
                <Box
                  key={i}
                  sx={{
                    position: "absolute",
                    left: `${pct(s.start)}%`,
                    width: `${Math.max(0.25, pct(s.end) - pct(s.start))}%`,
                    top: 0,
                    bottom: 0,
                    bgcolor: "text.disabled",
                    opacity: 0.6,
                  }}
                />
              ))}
            </Box>
          </Stack>

          {lanes.map((lane) => (
            <Stack key={lane.bundle} direction="row" sx={{ alignItems: "center", mb: 0.25 }}>
              <Tooltip title={lane.bundle} placement="right">
                <Typography
                  variant="caption"
                  sx={{
                    width: 130,
                    flexShrink: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortBundle(lane.bundle)}
                </Typography>
              </Tooltip>
              <Box
                sx={{
                  position: "relative",
                  flexGrow: 1,
                  height: 14,
                  bgcolor: "action.hover",
                  borderRadius: 0.5,
                  overflow: "hidden",
                }}
              >
                {lane.sessions.map((s, i) => (
                  <Tooltip
                    key={i}
                    title={`${stamp(s.start)} UTC · ${formatDuration(s.seconds)}`}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        // Sub-minute sessions would be invisible at this scale,
                        // so every session keeps a minimum hit area.
                        left: `${pct(s.start)}%`,
                        width: `${Math.max(0.4, pct(s.end) - pct(s.start))}%`,
                        top: 0,
                        bottom: 0,
                        bgcolor: "primary.main",
                        opacity: 0.85,
                        borderRadius: "1px",
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
              <Typography
                variant="caption"
                sx={{ width: 70, textAlign: "right", flexShrink: 0, color: "text.secondary" }}
              >
                {formatDuration(lane.total)}
              </Typography>
            </Stack>
          ))}
        </Paper>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 300 }}>
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
          getDetailPanelContent={(params: GridRowParams<IosActivityEventRow>) => (
            <IosJsonDetailPanel jsonRaw={params.row.json} />
          )}
          getDetailPanelHeight={() => 420}
        />
      </Box>
    </Box>
  );
}
