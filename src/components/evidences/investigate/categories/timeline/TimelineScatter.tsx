import * as React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import CircularProgress from "@mui/material/CircularProgress";
import Checkbox from "@mui/material/Checkbox";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { ScatterChartPro } from "@mui/x-charts-pro/ScatterChartPro";
import { ChartsReferenceLine } from "@mui/x-charts-pro/ChartsReferenceLine";
import { getTimelineEventCounts } from "../../../../../dbutils/sqlite";
import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";
import type { TimelineFilterChangeReason } from "./timelineControl";

import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimeRangePicker } from "@mui/x-date-pickers-pro/DateTimeRangePicker";
import { MultiInputDateTimeRangeField } from "@mui/x-date-pickers-pro/MultiInputDateTimeRangeField";

type Bucket = "second" | "minute" | "hour" | "day";

dayjs.extend(utc);

type Props = {
  evidenceId: number;
  partitionId: number;
  bucket?: Bucket;
  /** When provided (including null), the parent owns the applied range. */
  range?: TimelineEventsFilter | null;
  /** Exact epoch-ms playhead shared with a location window. */
  cursorMs?: number | null;
  onEventFilterChange?: (
    filter: TimelineEventsFilter | null,
    reason: TimelineFilterChangeReason,
  ) => void;
};

const KNOWN_COLORS: Record<string, string> = {
  "file.created": "#4caf50",
  "file.accessed": "#2196f3",
  "file.modified": "#ff9800",
  "windows.evtx.event": "#9c27b0",
  "windows.pml.event": "#f44336",
  "mobile.communication.message": "#00bcd4",
  "mobile.communication.attachment": "#ff5722",
  "mobile.location.fix": "#4fc3f7",
};

const FALLBACK_PALETTE = [
  "#3f51b5", "#e91e63", "#795548", "#607d8b",
  "#009688", "#ff4081", "#673ab7", "#cddc39",
];

const KNOWN_LABELS: Record<string, string> = {
  "file.created": "File Created",
  "file.accessed": "File Accessed",
  "file.modified": "File Modified",
  "windows.evtx.event": "Windows Event Log",
  "windows.pml.event": "Process Monitor",
  "mobile.communication.message": "Message",
  "mobile.communication.attachment": "Attachment",
  "mobile.location.fix": "Location Fix",
};

const BUCKET_MS: Record<Bucket, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

const SCATTER_ZOOM_INTERACTION_CONFIG = {
  zoom: ["wheel", "pinch"] as const,
  pan: ["drag", "wheel"] as const,
};

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function colorForType(et: string): string {
  return KNOWN_COLORS[et] ?? FALLBACK_PALETTE[strHash(et) % FALLBACK_PALETTE.length];
}

function labelForType(et: string): string {
  return KNOWN_LABELS[et] ?? et;
}

export default function TimelineScatter({
  evidenceId,
  partitionId,
  bucket: bucketProp = "day",
  range,
  cursorMs = null,
  onEventFilterChange,
}: Props) {
  const [markerSize, setMarkerSize] = React.useState(3);
  const [selectedKey, setSelectedKey] = React.useState<{
    event_type: string;
    dataIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [seriesData, setSeriesData] = React.useState<
    { event_type: string; x: number; y: number }[]
  >([]);

  const [visibleTypes, setVisibleTypes] = React.useState<Record<string, boolean>>({});

  // Tracks the last emitted time range so checkbox changes can re-emit in range mode.
  // null when in point-click mode or when filter is cleared.
  const [rangeFilterBase, setRangeFilterBase] = React.useState<{
    start: number;
    end: number;
  } | null>(null);

  const [bucketPending, setBucketPending] = React.useState<Bucket>(bucketProp);
  const [rangePending, setRangePending] = React.useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [bucketApplied, setBucketApplied] = React.useState<Bucket>(bucketProp);
  const [rangeApplied, setRangeApplied] = React.useState<[Dayjs | null, Dayjs | null]>([null, null]);
  // The initial unbounded aggregate already contains every point that the
  // auto-derived min/max range would request. Remember that one derived query
  // key so applying the range to the controls does not repeat a multi-million
  // row GROUP BY merely to redraw the same data.
  const skipAutoRangeFetchKeyRef = React.useRef<string | null>(null);

  const controlledRange = range !== undefined;
  const controlledStart = range?.start ?? null;
  const controlledEnd = range?.end ?? null;
  const controlledEventTypesKey = JSON.stringify(range?.event_types ?? null);
  const controlledEventTypes = React.useMemo(
    () => JSON.parse(controlledEventTypesKey) as string[] | null,
    [controlledEventTypesKey],
  );
  const controlledEventTypesRef = React.useRef(controlledEventTypes);
  controlledEventTypesRef.current = controlledEventTypes;

  // A linked window may move the range without touching this component's local
  // controls. Mirror only the primitive values so cursor-only session updates do
  // not reset the picker or refetch the chart.
  React.useEffect(() => {
    if (!controlledRange) return;
    const nextRange: [Dayjs | null, Dayjs | null] = [
      controlledStart == null ? null : dayjs.utc(controlledStart),
      controlledEnd == null ? null : dayjs.utc(controlledEnd),
    ];
    setRangePending(nextRange);
    setRangeApplied(nextRange);
    setRangeFilterBase(
      controlledStart != null && controlledEnd != null
        ? { start: controlledStart, end: controlledEnd }
        : null,
    );
    setSelectedKey(null);
  }, [controlledRange, controlledStart, controlledEnd]);

  React.useEffect(() => {
    if (!controlledRange) return;
    const enabled = controlledEventTypes == null ? null : new Set(controlledEventTypes);
    setVisibleTypes((previous) =>
      Object.fromEntries(
        Object.keys(previous).map((eventType) => [eventType, enabled?.has(eventType) ?? true]),
      ),
    );
    setSelectedKey((current) =>
      current && enabled != null && !enabled.has(current.event_type) ? null : current,
    );
  }, [controlledRange, controlledEventTypes]);

  const hasPendingChanges =
    bucketPending !== bucketApplied ||
    (rangePending[0]?.valueOf() ?? null) !== (rangeApplied[0]?.valueOf() ?? null) ||
    (rangePending[1]?.valueOf() ?? null) !== (rangeApplied[1]?.valueOf() ?? null);

  React.useEffect(() => {
    let cancelled = false;
    const start = rangeApplied[0]?.valueOf() ?? null;
    const end = rangeApplied[1]?.valueOf() ?? null;
    const queryKey = JSON.stringify([
      evidenceId,
      partitionId,
      bucketApplied,
      start,
      end,
    ]);

    if (skipAutoRangeFetchKeyRef.current === queryKey) {
      skipAutoRangeFetchKeyRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        setSelectedKey(null);
        setError(null);
        setLoading(true);

        const rows = await getTimelineEventCounts(evidenceId, partitionId, {
          bucket: bucketApplied,
          start,
          end,
        });

        if (cancelled) return;

        const data = rows
          .filter(r => Number.isFinite(r.ts) && Number.isFinite(r.count) && r.ts > 0 && r.count > 0)
          .map(r => ({ event_type: r.event_type, x: r.ts, y: r.count }));

        setSeriesData(data);

        setVisibleTypes(prev => {
          const newTypes = [...new Set(data.map(d => d.event_type))];
          const additions: Record<string, boolean> = {};
          const externallyEnabled = controlledEventTypesRef.current;
          for (const t of newTypes) {
            if (!(t in prev)) {
              additions[t] =
                controlledRange && externallyEnabled != null
                  ? externallyEnabled.includes(t)
                  : true;
            }
          }
          return Object.keys(additions).length > 0 ? { ...prev, ...additions } : prev;
        });

        if ((!rangeApplied[0] || !rangeApplied[1]) && data.length > 0) {
          const xs = data.map(d => d.x);
          const autoRange: [Dayjs, Dayjs] = [
            dayjs.utc(Math.min(...xs)),
            // Aggregates store each bucket's start. The picker must cover the
            // whole final bucket or a later Apply silently drops its events.
            dayjs.utc(Math.max(...xs) + BUCKET_MS[bucketApplied] - 1),
          ];
          skipAutoRangeFetchKeyRef.current = JSON.stringify([
            evidenceId,
            partitionId,
            bucketApplied,
            autoRange[0].valueOf(),
            autoRange[1].valueOf(),
          ]);
          setRangePending(autoRange);
          setRangeApplied(autoRange);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setSeriesData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    evidenceId,
    partitionId,
    controlledRange,
    bucketApplied,
    rangeApplied?.[0]?.valueOf(),
    rangeApplied?.[1]?.valueOf(),
  ]);

  const enabledTypes = Object.entries(visibleTypes)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const chartSeries = enabledTypes.flatMap(et => {
    const data = seriesData
      .filter(d => d.event_type === et)
      .map((d, idx) => ({ id: idx, x: d.x, y: d.y }));

    // Retain enabled types in the forensic filter even when the current range
    // has no matching points, but never give MUI X an empty scatter series: its
    // per-series spatial index requires a strictly positive item count.
    if (data.length === 0) return [];

    return [{
      id: et,
      label: labelForType(et),
      color: colorForType(et),
      data,
      markerSize,
      valueFormatter: (v: { x: number; y: number } | null) =>
        v ? `${v.y} event(s) — ${unixToISO8601UTCString(v.x)}` : "",
    }];
  });

  const selectedSeries = selectedKey
    ? {
        id: "__selected__",
        label: "Selected",
        color: "#f44336",
        data: [{ id: 0, x: selectedKey.x, y: selectedKey.y }],
        markerSize: markerSize + 2,
        valueFormatter: (v: { x: number; y: number } | null) =>
          v ? `${v.y} event(s) — ${unixToISO8601UTCString(v.x)}` : "",
      }
    : null;

  const allSeries = selectedSeries ? [...chartSeries, selectedSeries] : chartSeries;

  const handlePointClick = React.useCallback(
    (_event: unknown, scatterItemIdentifier: any) => {
      const { seriesId, dataIndex } = scatterItemIdentifier ?? {};
      if (seriesId == null || dataIndex == null) return;

      if (seriesId === "__selected__") {
        if (!selectedKey) return;
        setRangeFilterBase(null);
        onEventFilterChange?.({
          start: selectedKey.x,
          end: selectedKey.x + BUCKET_MS[bucketApplied] - 1,
          event_types: [selectedKey.event_type],
        }, "point");
        return;
      }

      const s = chartSeries.find(cs => cs.id === seriesId);
      const pt = s?.data?.[dataIndex];
      if (!pt) return;

      const bucketStart = pt.x as number;
      setSelectedKey({ event_type: seriesId, dataIndex, x: bucketStart, y: pt.y });
      setRangeFilterBase(null);
      onEventFilterChange?.({
        start: bucketStart,
        end: bucketStart + BUCKET_MS[bucketApplied] - 1,
        event_types: [seriesId],
      }, "point");
    },
    [chartSeries, bucketApplied, onEventFilterChange, selectedKey],
  );

  const hasChartData = chartSeries.length > 0;
  const xMin = rangeApplied[0]?.valueOf() ?? undefined;
  const xMax = rangeApplied[1]?.valueOf() ?? undefined;

  const handleZoomChange = React.useCallback(
    (zoomData: { axisId: string | number; start: number; end: number }[]) => {
      const timeZoom = zoomData.find(z => z.axisId === "time");
      if (!timeZoom) return;
      const effectiveMin = xMin ?? (seriesData.length > 0 ? Math.min(...seriesData.map(d => d.x)) : null);
      const effectiveMax = xMax ?? (seriesData.length > 0 ? Math.max(...seriesData.map(d => d.x)) : null);
      if (effectiveMin == null || effectiveMax == null) return;
      const range = effectiveMax - effectiveMin;
      setRangePending([
        dayjs(Math.round(effectiveMin + (timeZoom.start / 100) * range)),
        dayjs(Math.round(effectiveMin + (timeZoom.end / 100) * range)),
      ]);
    },
    [xMin, xMax, seriesData],
  );

  const applyChanges = () => {
    setBucketApplied(bucketPending);
    setRangeApplied(rangePending);
    const start = rangePending[0]?.valueOf() ?? null;
    const end = rangePending[1]?.valueOf() ?? null;
    if (start && end) {
      setRangeFilterBase({ start, end });
      onEventFilterChange?.({
        start,
        end,
        // null means every type; an empty array deliberately means none.
        event_types: [...enabledTypes],
      }, "range");
    } else {
      setRangeFilterBase(null);
      onEventFilterChange?.(null, "clear");
    }
  };

  const cancelPending = () => {
    setBucketPending(bucketApplied);
    setRangePending(rangeApplied);
  };

  const clearFiltersAndReload = () => {
    setSelectedKey(null);
    setRangeFilterBase(null);
    setRangePending([null, null]);
    setRangeApplied([null, null]);
    onEventFilterChange?.(null, "clear");
  };

  const knownTypes = Object.keys(visibleTypes);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack sx={{ gap: 2 }}>
        <Typography variant="h6" sx={{ alignSelf: "center" }}>
          Supertimeline
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{
            gap: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="bucket-select-label">Bucket</InputLabel>
            <Select
              labelId="bucket-select-label"
              value={bucketPending}
              label="Bucket"
              onChange={e => setBucketPending(e.target.value as Bucket)}
              disabled={loading}
            >
              <MenuItem value="second">Second</MenuItem>
              <MenuItem value="minute">Minute</MenuItem>
              <MenuItem value="hour">Hour</MenuItem>
              <MenuItem value="day">Day</MenuItem>
            </Select>
          </FormControl>

          {knownTypes.length > 0 && (
            <FormControl component="fieldset" variant="standard">
              <FormGroup row>
                {knownTypes.map(et => (
                  <FormControlLabel
                    key={et}
                    control={
                      <Checkbox
                        size="small"
                        checked={visibleTypes[et] ?? true}
                        onChange={e => {
                          const newVisible = { ...visibleTypes, [et]: e.target.checked };
                          setVisibleTypes(newVisible);
                          if (!e.target.checked) {
                            setSelectedKey((current) =>
                              current?.event_type === et ? null : current,
                            );
                          }
                          if (rangeFilterBase || controlledRange) {
                            const newEnabled = Object.entries(newVisible)
                              .filter(([, v]) => v)
                              .map(([k]) => k);
                            onEventFilterChange?.({
                              start: rangeFilterBase?.start ?? controlledStart,
                              end: rangeFilterBase?.end ?? controlledEnd,
                              event_types: newEnabled,
                            }, "types");
                          }
                        }}
                      />
                    }
                    label={
                      <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            bgcolor: colorForType(et),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: "0.8rem" }}>{labelForType(et)}</span>
                      </Stack>
                    }
                  />
                ))}
              </FormGroup>
            </FormControl>
          )}

          <Stack direction="row" sx={{ gap: 2, alignItems: "center" }}>
            <Typography id="marker-size-slider" variant="body2" sx={{ whiteSpace: "nowrap" }}>
              Marker size: {markerSize}
            </Typography>
            <Slider
              size="small"
              min={1}
              max={10}
              step={1}
              aria-labelledby="marker-size-slider"
              value={markerSize}
              onChange={(_, v) => setMarkerSize(v as number)}
              sx={{ width: 200 }}
              disabled={loading}
            />
          </Stack>

          <DateTimeRangePicker
            value={rangePending}
            onChange={newValue => setRangePending(newValue)}
            timezone="UTC"
            slots={{ field: MultiInputDateTimeRangeField }}
            slotProps={{ textField: { size: "small" } }}
            disabled={loading}
          />

          <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
            <Button
              variant="contained"
              size="small"
              onClick={applyChanges}
              disabled={loading || !hasPendingChanges}
            >
              Apply
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={cancelPending}
              disabled={loading || !hasPendingChanges}
            >
              Cancel
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={clearFiltersAndReload}
              disabled={loading}
            >
              Clear & reload
            </Button>
          </Stack>
        </Stack>

        {hasPendingChanges && (
          <Typography variant="caption" sx={{ alignSelf: "center" }}>
            You have unapplied changes. Click <b>Apply</b> to update the chart.
          </Typography>
        )}

        {error ? (
          <Typography color="error" sx={{ alignSelf: "center" }}>
            {error}
          </Typography>
        ) : loading ? (
          <Stack sx={{ alignItems: "center", justifyContent: "center", height: 600 }}>
            <CircularProgress />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Loading data…
            </Typography>
          </Stack>
        ) : !hasChartData ? (
          <Stack sx={{ alignItems: "center", justifyContent: "center", height: 300 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {enabledTypes.length === 0
                ? "Select at least one event type to display the timeline."
                : "No events matched the current filters."}
            </Typography>
          </Stack>
        ) : (
          <ScatterChartPro
            height={300}
            zoomInteractionConfig={SCATTER_ZOOM_INTERACTION_CONFIG}
            xAxis={[
              {
                id: "time",
                scaleType: "time",
                label: "Timestamp (UTC)",
                valueFormatter: (v: number | null) =>
                  v == null ? "" : unixToISO8601UTCString(v),
                min: xMin,
                max: xMax,
                zoom: { slider: { enabled: true, preview: true } },
              },
            ]}
            yAxis={[{ id: "count", label: "Events", min: 0 }]}
            series={allSeries as any}
            onItemClick={handlePointClick}
            onZoomChange={handleZoomChange}
          >
            {cursorMs != null && Number.isFinite(cursorMs) && (
              <ChartsReferenceLine
                axisId="time"
                x={cursorMs}
                label="Linked time"
                labelAlign="start"
                lineStyle={{ stroke: "#ffcc00", strokeWidth: 2, strokeDasharray: "5 3" }}
                labelStyle={{ fill: "#ffcc00", fontSize: 11, fontWeight: 600 }}
              />
            )}
          </ScatterChartPro>
        )}

        <Typography variant="caption" sx={{ alignSelf: "center" }}>
          Bucket (applied): {bucketApplied}. Range:{" "}
          {rangeApplied[0] && rangeApplied[1]
            ? `${unixToISO8601UTCString(rangeApplied[0].valueOf())} → ${unixToISO8601UTCString(
                rangeApplied[1].valueOf(),
              )}`
            : "none (full dataset)"}
        </Typography>
      </Stack>
    </LocalizationProvider>
  );
}
