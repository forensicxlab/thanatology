// components/TimelineScatter.tsx
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
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import { ScatterChartPro } from "@mui/x-charts-pro/ScatterChartPro";
import { getTimestampCountsByType } from "../../../../../dbutils/sqlite";
import type { TimestampType } from "../../../../../dbutils/types";

import UnixToISO8601UTC from "../../../common/UnixToUTC";
import dayjs, { Dayjs } from "dayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimeRangePicker } from "@mui/x-date-pickers-pro/DateTimeRangePicker";
import { MultiInputDateTimeRangeField } from "@mui/x-date-pickers-pro/MultiInputDateTimeRangeField";
import type { GridFilterModel } from "@mui/x-data-grid-pro";
import type { TimelineFileFilter } from "../../../../../dbutils/sqlite";
type Props = {
  evidenceId: number;
  partitionId: number;
  bucket?: "second" | "minute" | "hour" | "day";
  gridFilterModel?: GridFilterModel;
  onFilesFilterChange?: (filter: TimelineFileFilter | null) => void;
};

type Bucket = NonNullable<Props["bucket"]>;

const COLORS: Record<TimestampType, string> = {
  created: "#4caf50",
  accessed: "#2196f3",
  modified: "#ff9800",
};
const ALL_TYPES: TimestampType[] = ["created", "accessed", "modified"];

function toISO8601UTCString(ts: number): string {
  if (ts.toString().length === 10) ts *= 1000;
  const d = new Date(ts);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  const micro = (ms: number) => (ms * 1000).toString().padStart(6, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${micro(d.getUTCMilliseconds())}Z`;
}

const BUCKET_MS: Record<Bucket, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

const SCATTER_ZOOM_INTERACTION_CONFIG = {
  zoom: ["wheel", "pinch"] as const,
  pan: ["drag", "wheel"] as const,
};

function stableStringifyFilterModel(m: GridFilterModel | undefined) {
  const items = [...(m?.items ?? [])]
    .map((it) => ({
      field: it.field,
      operator: it.operator,
      value: it.value ?? null,
    }))
    .sort((a, b) =>
      `${a.field}|${a.operator}|${a.value}`.localeCompare(
        `${b.field}|${b.operator}|${b.value}`,
      ),
    );

  const qf = [...(m?.quickFilterValues ?? [])].map(String).sort();

  return JSON.stringify({
    logicOperator: (m?.logicOperator ?? "and").toLowerCase(),
    quickFilterLogicOperator: (
      m?.quickFilterLogicOperator ?? "and"
    ).toLowerCase(),
    items,
    quickFilterValues: qf,
  });
}

function makeRangeFilter(
  startMs: number | null,
  endMs: number | null,
  types: TimestampType[],
): TimelineFileFilter | null {
  if (!startMs || !endMs || types.length === 0) return null;
  return { start: startMs, end: endMs, types };
}

// Tooltip showing "{count} file(s) — <timestamp>" prominently
type ItemPoint = {
  seriesId: string;
  color: string;
  value: { x: number; y: number };
  label?: string;
};
function TooltipContent(props: {
  item?: ItemPoint | null;
  items?: ItemPoint[];
}) {
  const item = props.item ?? props.items?.[0] ?? null;
  if (!item) return null;

  const seriesLabel =
    item.label ??
    (typeof item.seriesId === "string"
      ? item.seriesId.charAt(0).toUpperCase() + item.seriesId.slice(1)
      : String(item.seriesId));

  const ts = item.value?.x;
  const count = item.value?.y ?? "";

  return (
    <Paper sx={{ p: 1.5, maxWidth: 380 }}>
      {/* Header: count + timestamp */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {count} file(s) — <UnixToISO8601UTC timestamp={ts} />
      </Typography>
      <Divider sx={{ my: 1 }} />
      {/* Series badge */}
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            bgcolor: item.color,
          }}
        />
        <Typography variant="body2">{seriesLabel}</Typography>
      </Stack>
    </Paper>
  );
}

export default function TimelineScatter({
  evidenceId,
  partitionId,
  bucket = "second",
  onFilesFilterChange,
  gridFilterModel,
}: Props) {
  const [markerSize, setMarkerSize] = React.useState(3);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [seriesData, setSeriesData] = React.useState<
    { type: TimestampType; x: number; y: number }[]
  >([]);

  const [visibleTypes, setVisibleTypes] = React.useState<
    Record<TimestampType, boolean>
  >({
    created: true,
    accessed: true,
    modified: true,
  });
  // Pending vs Applied controls
  const [bucketPending, setBucketPending] = React.useState<Bucket>(bucket);
  const [rangePending, setRangePending] = React.useState<
    [Dayjs | null, Dayjs | null]
  >([null, null]);

  const [bucketApplied, setBucketApplied] = React.useState<Bucket>(bucket);
  const [rangeApplied, setRangeApplied] = React.useState<
    [Dayjs | null, Dayjs | null]
  >([null, null]);

  const hasPendingChanges =
    bucketPending !== bucketApplied ||
    (rangePending[0]?.valueOf() ?? null) !==
      (rangeApplied[0]?.valueOf() ?? null) ||
    (rangePending[1]?.valueOf() ?? null) !==
      (rangeApplied[1]?.valueOf() ?? null);

  const gridFilterKey = React.useMemo(
    () => stableStringifyFilterModel(gridFilterModel),
    [gridFilterModel],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        setLoading(true);

        const start = rangeApplied[0]?.valueOf() ?? null;
        const end = rangeApplied[1]?.valueOf() ?? null;

        const rows = await getTimestampCountsByType(evidenceId, partitionId, {
          bucket: bucketApplied,
          start,
          end,
          filterModel: gridFilterModel as any,
        });

        if (cancelled) return;

        const data = rows
          .filter(
            (r) =>
              Number.isFinite(r.ts) &&
              Number.isFinite(r.count) &&
              r.ts > 0 &&
              r.count > 0,
          )
          .map((r) => ({ type: r.type, x: r.ts, y: r.count }));

        setSeriesData(data);

        const xs = data.map((d) => d.x);
        if ((!rangeApplied[0] || !rangeApplied[1]) && xs.length > 0) {
          const min = Math.min(...xs);
          const max = Math.max(...xs);
          setRangePending([dayjs(min), dayjs(max)]);
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

    return () => {
      cancelled = true;
    };
    // IMPORTANT: depend on gridFilterKey (APPLIED), not raw model
  }, [
    evidenceId,
    partitionId,
    bucketApplied,
    rangeApplied?.[0]?.valueOf(),
    rangeApplied?.[1]?.valueOf(),
    gridFilterKey,
  ]);

  const enabledTypes = ALL_TYPES.filter((t) => visibleTypes[t]);

  const chartSeries = enabledTypes.map((t) => ({
    id: t,
    label: t.charAt(0).toUpperCase() + t.slice(1),
    color: COLORS[t],
    data: seriesData
      .filter((d) => d.type === t)
      .map((d, idx) => ({ id: idx, x: d.x, y: d.y })), // add id for robust click behavior
    preview: { markerSize },
    valueFormatter: (v: { x: number; y: number } | null) =>
      v ? `${v.y} file(s) — ${toISO8601UTCString(v.x)}` : "",
  }));

  const handlePointClick = React.useCallback(
    (_event: unknown, scatterItemIdentifier: any) => {
      const { seriesId, dataIndex } = scatterItemIdentifier ?? {};
      if (seriesId == null || dataIndex == null) return;

      const type = seriesId as TimestampType;
      const s = chartSeries.find((cs) => cs.id === type);
      const pt = s?.data?.[dataIndex];
      if (!pt) return;

      const bucketStart = pt.x as number;
      const bucketEnd = bucketStart + BUCKET_MS[bucketApplied] - 1;

      onFilesFilterChange?.({
        start: bucketStart,
        end: bucketEnd,
        types: [type],
      });
    },
    [chartSeries, bucketApplied, onFilesFilterChange],
  );

  const hasChartData = chartSeries.some((series) => series.data.length > 0);

  const xMin = rangeApplied[0]?.valueOf() ?? undefined;
  const xMax = rangeApplied[1]?.valueOf() ?? undefined;

  const applyChanges = () => {
    setBucketApplied(bucketPending);
    setRangeApplied(rangePending);

    const startMs = rangePending[0]?.valueOf() ?? null;
    const endMs = rangePending[1]?.valueOf() ?? null;
    onFilesFilterChange?.(makeRangeFilter(startMs, endMs, enabledTypes));
  };

  const cancelPending = () => {
    setBucketPending(bucketApplied);
    setRangePending(rangeApplied);
  };

  const clearFiltersAndReload = () => {
    setRangePending([null, null]);
    setRangeApplied([null, null]);
    onFilesFilterChange?.(null);
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack
        sx={{
          gap: 2,
        }}
      >
        <Typography variant="h6" sx={{ alignSelf: "center" }}>
          File Timestamps Timeline (Created / Accessed / Modified)
        </Typography>

        {/* Controls */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{
            gap: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Bucket selector (pending) */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="bucket-select-label">Bucket</InputLabel>
            <Select
              labelId="bucket-select-label"
              value={bucketPending}
              label="Bucket"
              onChange={(e) => setBucketPending(e.target.value as Bucket)}
              disabled={loading}
            >
              <MenuItem value="second">Second</MenuItem>
              <MenuItem value="minute">Minute</MenuItem>
              <MenuItem value="hour">Hour</MenuItem>
              <MenuItem value="day">Day</MenuItem>
            </Select>
          </FormControl>

          {/* Type visibility toggles */}
          <FormControl component="fieldset" variant="standard" sx={{ ml: 1 }}>
            <FormGroup row>
              {ALL_TYPES.map((t) => (
                <FormControlLabel
                  key={t}
                  control={
                    <Checkbox
                      size="small"
                      checked={visibleTypes[t]}
                      onChange={(e) =>
                        setVisibleTypes((prev) => ({
                          ...prev,
                          [t]: e.target.checked,
                        }))
                      }
                    />
                  }
                  label={
                    <Stack
                      direction="row"
                      sx={{
                        gap: 1,
                        alignItems: "center",
                      }}
                    >
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          bgcolor: COLORS[t],
                        }}
                      />
                      <span style={{ textTransform: "capitalize" }}>{t}</span>
                    </Stack>
                  }
                />
              ))}
            </FormGroup>
          </FormControl>

          {/* Marker size */}
          <Stack
            direction="row"
            sx={{
              gap: 2,
              alignItems: "center",
            }}
          >
            <Typography
              id="marker-size-slider"
              variant="body2"
              sx={{ whiteSpace: "nowrap" }}
            >
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

          {/* Date & Time range picker (pending) */}
          <DateTimeRangePicker
            value={rangePending}
            onChange={(newValue) => setRangePending(newValue)}
            slots={{ field: MultiInputDateTimeRangeField }}
            slotProps={{ textField: { size: "small" } }}
            disabled={loading}
          />

          {/* Action buttons */}
          <Stack
            direction="row"
            sx={{
              gap: 1,
              alignItems: "center",
            }}
          >
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
              Clear filters & reload
            </Button>
          </Stack>
        </Stack>

        {hasPendingChanges && (
          <Typography variant="caption" sx={{ alignSelf: "center" }}>
            You have unapplied changes. Click <b>Apply</b> to update the chart.
          </Typography>
        )}

        {/* Chart area */}
        {error ? (
          <Typography color="error" sx={{ alignSelf: "center" }}>
            {error}
          </Typography>
        ) : loading ? (
          <Stack
            sx={{
              alignItems: "center",
              justifyContent: "center",
              height: 600,
            }}
          >
            <CircularProgress />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Loading data…
            </Typography>
          </Stack>
        ) : !hasChartData ? (
          <Stack
            sx={{
              alignItems: "center",
              justifyContent: "center",
              height: 300,
            }}
          >
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {enabledTypes.length === 0
                ? "Select at least one timestamp type to display the timeline."
                : "No timestamp data matched the current filters."}
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
                  v == null ? "" : toISO8601UTCString(v),
                min: xMin,
                max: xMax,
                zoom: { slider: { enabled: true, preview: true } },
              },
            ]}
            yAxis={[{ id: "count", label: "Events", min: 0 }]}
            series={chartSeries as any}
            onItemClick={handlePointClick}
            slots={{ tooltip: TooltipContent as any }}
          />
        )}

        <Typography variant="caption" sx={{ alignSelf: "center" }}>
          Bucket (applied): {bucketApplied}. Range:{" "}
          {rangeApplied[0] && rangeApplied[1]
            ? `${toISO8601UTCString(rangeApplied[0].valueOf())} → ${toISO8601UTCString(
                rangeApplied[1].valueOf(),
              )}`
            : "none (full dataset)"}
        </Typography>
      </Stack>
    </LocalizationProvider>
  );
}
