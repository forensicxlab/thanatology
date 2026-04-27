import * as React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import {
  ChartsTooltipContainer,
  useItemTooltip,
} from "@mui/x-charts/ChartsTooltip";

import dayjs, { Dayjs } from "dayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimeRangePicker } from "@mui/x-date-pickers-pro/DateTimeRangePicker";
import { MultiInputDateTimeRangeField } from "@mui/x-date-pickers-pro/MultiInputDateTimeRangeField";

import { ScatterChartPro } from "@mui/x-charts-pro/ScatterChartPro";
import type { GridFilterModel } from "@mui/x-data-grid-pro";

import UnixToISO8601UTC from "../../../common/UnixToUTC";
import { getWindowsEventCounts } from "../../../../../dbutils/sqlite";
import type { TimelineWindowsEventFilter } from "../../../../../dbutils/sqlite";

type Props = {
  evidenceId: number;
  partitionId: number;
  bucket?: "second" | "minute" | "hour" | "day";
  gridFilterModel?: GridFilterModel;
  onEventsFilterChange?: (filter: TimelineWindowsEventFilter | null) => void;
};

type Bucket = NonNullable<Props["bucket"]>;

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

function WindowsEventsTooltip() {
  const item = useItemTooltip(); // null when closed

  // You MUST keep the container so it can position/open the Popper.
  return (
    <ChartsTooltipContainer trigger="item">
      {!item
        ? null
        : (() => {
            const v: any = item.value; // scatter value is typically { x, y }
            const ts = typeof v?.x === "number" ? v.x : null;
            const count = typeof v?.y === "number" ? v.y : null;

            return (
              <Paper sx={{ p: 1.5, maxWidth: 380 }}>
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 600, mb: 0.5 }}
                >
                  {count ?? "—"} event(s) —{" "}
                  {ts != null ? <UnixToISO8601UTC timestamp={ts} /> : "—"}
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  Click to filter the grid to this bucket.
                </Typography>
              </Paper>
            );
          })()}
    </ChartsTooltipContainer>
  );
}

const formatUtcTick = (v: number | Date) => {
  const ms = v instanceof Date ? v.getTime() : v;
  // "2016-06-21 13:17:50Z" style (UTC)
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
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

function makeRangeFilter(startMs: number | null, endMs: number | null) {
  if (!startMs || !endMs) return null;
  return { start: startMs, end: endMs } as TimelineWindowsEventFilter;
}

export default function WindowsEventTimelineScatter({
  evidenceId,
  partitionId,
  bucket = "minute",
  gridFilterModel,
  onEventsFilterChange,
}: Props) {
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [points, setPoints] = React.useState<{ x: number; y: number }[]>([]);

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

        const rows = await getWindowsEventCounts(evidenceId, partitionId, {
          bucket: bucketApplied,
          start,
          end,
          filterModel: gridFilterModel as any,
        });

        if (cancelled) return;

        const data = rows
          .filter((r) => Number.isFinite(r.ts) && r.ts > 0 && r.count > 0)
          .map((r) => ({ x: r.ts, y: r.count }));

        setPoints(data);

        // If no explicit range applied, auto-fill pending range from data extents
        if ((!rangeApplied[0] || !rangeApplied[1]) && data.length > 0) {
          const xs = data.map((d) => d.x);
          setRangePending([dayjs(Math.min(...xs)), dayjs(Math.max(...xs))]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setPoints([]);
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
    bucketApplied,
    rangeApplied?.[0]?.valueOf(),
    rangeApplied?.[1]?.valueOf(),
    gridFilterKey,
  ]);

  const applyChanges = () => {
    setBucketApplied(bucketPending);
    setRangeApplied(rangePending);

    const startMs = rangePending[0]?.valueOf() ?? null;
    const endMs = rangePending[1]?.valueOf() ?? null;
    onEventsFilterChange?.(makeRangeFilter(startMs, endMs));
  };

  const cancelPending = () => {
    setBucketPending(bucketApplied);
    setRangePending(rangeApplied);
  };

  const clearFiltersAndReload = () => {
    setRangePending([null, null]);
    setRangeApplied([null, null]);
    onEventsFilterChange?.(null);
  };

  const handlePointClick = React.useCallback(
    (_event: unknown, scatterItemIdentifier: any) => {
      const { dataIndex } = scatterItemIdentifier ?? {};
      if (dataIndex == null) return;

      const pt = points[dataIndex];
      if (!pt) return;

      const bucketStart = pt.x;
      const bucketEnd = bucketStart + BUCKET_MS[bucketApplied] - 1;

      onEventsFilterChange?.({ start: bucketStart, end: bucketEnd });
    },
    [points, bucketApplied, onEventsFilterChange],
  );

  const xMin = rangeApplied[0]?.valueOf() ?? undefined;
  const xMax = rangeApplied[1]?.valueOf() ?? undefined;

  const chartData = points.map((p, idx) => ({
    id: idx,
    x: p.x,
    y: p.y,
  }));

  const hasChartData = chartData.length > 0;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack sx={{
        gap: 2
      }}>
        <Typography variant="h6" sx={{ alignSelf: "center" }}>
          Windows Events Timeline (count over time)
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{
            gap: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "center",
            flexWrap: "wrap"
          }}>
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

          <DateTimeRangePicker
            timezone="UTC"
            value={rangePending}
            onChange={(newValue) => setRangePending(newValue)}
            slots={{ field: MultiInputDateTimeRangeField }}
            slotProps={{ textField: { size: "small" } }}
            disabled={loading}
          />

          <Stack
            direction="row"
            sx={{
              gap: 1,
              alignItems: "center"
            }}>
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

        {error ? (
          <Typography color="error" sx={{ alignSelf: "center" }}>
            {error}
          </Typography>
        ) : loading ? (
          <Stack
            sx={{
              alignItems: "center",
              justifyContent: "center",
              height: 520
            }}>
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
              No Windows event data matched the current filters.
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
                // pass Dates for min/max too
                min: xMin != null ? new Date(xMin) : undefined,
                max: xMax != null ? new Date(xMax) : undefined,
                // force tick labels to UTC
                valueFormatter: formatUtcTick,
                zoom: { slider: { enabled: true, preview: true } },
              },
            ]}
            yAxis={[{ id: "count", label: "Events", min: 0 }]}
            slotProps={{ tooltip: { trigger: "item" } }}
            series={[
              {
                id: "events",
                label: "Events",
                data: chartData,
                valueFormatter: (v) => {
                  if (!v) return "";
                  return `${v.y} event(s) — ${new Date(Number(v.x)).toISOString()}`;
                },
              },
            ]}
            onItemClick={handlePointClick}
            slots={{ tooltip: WindowsEventsTooltip }}
          />
        )}

        <Typography variant="caption" sx={{ alignSelf: "center" }}>
          Bucket (applied): {bucketApplied}.{" "}
          {rangeApplied[0] && rangeApplied[1]
            ? `Range: ${rangeApplied[0].toISOString()} → ${rangeApplied[1].toISOString()}`
            : "Range: none (full dataset)"}
        </Typography>
      </Stack>
    </LocalizationProvider>
  );
}
