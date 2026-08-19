import * as React from "react";
import {
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";

import {
  getIosDataUsageTopApps,
  type IosDataUsageAppTotal,
} from "../../../../../dbutils/sqlite";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import { formatBytes } from "./common";

interface DataUsageChartProps {
  evidenceId: number;
  partitionId: number;
  /** Currently drilled-into app, highlighted in the chart. */
  selectedApp: string | null;
  onSelectApp: (app: string | null) => void;
}

type Bearer = "cellular" | "wifi" | "both";
type Direction = "both" | "in" | "out";

/**
 * Series identity is fixed: a hue always means the same measure, so changing
 * the bearer/direction filters never repaints the surviving series.
 * Slots 1-4 of the validated categorical palette (light / dark steps).
 */
const SERIES_COLORS = {
  wwan_in: { light: "#2a78d6", dark: "#3987e5" }, // slot 1 blue
  wwan_out: { light: "#eb6834", dark: "#d95926" }, // slot 2 orange
  wifi_in: { light: "#1baf7a", dark: "#199e70" }, // slot 3 aqua
  wifi_out: { light: "#eda100", dark: "#c98500" }, // slot 4 yellow
} as const;

type MeasureKey = keyof typeof SERIES_COLORS;

const MEASURES: { key: MeasureKey; label: string; bearer: Bearer; dir: Direction }[] = [
  { key: "wwan_in", label: "Cellular in", bearer: "cellular", dir: "in" },
  { key: "wwan_out", label: "Cellular out", bearer: "cellular", dir: "out" },
  { key: "wifi_in", label: "Wi-Fi in", bearer: "wifi", dir: "in" },
  { key: "wifi_out", label: "Wi-Fi out", bearer: "wifi", dir: "out" },
];

/** Trailing component of a bundle id, for a readable axis. */
function shortApp(app: string): string {
  if (!app.includes(".")) return app;
  const tail = app.split("/").pop() ?? app;
  const parts = tail.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : tail;
}

export default function DataUsageChart({
  evidenceId,
  partitionId,
  selectedApp,
  onSelectApp,
}: DataUsageChartProps) {
  const theme = useTheme();
  const mode = theme.palette.mode === "dark" ? "dark" : "light";
  const surface = theme.palette.background.paper;
  const { start, end } = useTimeFilter();

  const [bearer, setBearer] = React.useState<Bearer>("cellular");
  const [direction, setDirection] = React.useState<Direction>("both");
  const [topN, setTopN] = React.useState(10);
  const [rows, setRows] = React.useState<IosDataUsageAppTotal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosDataUsageTopApps(
      evidenceId,
      partitionId,
      topN,
      bearer === "both" ? "total" : bearer,
    )
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, topN, bearer, start, end]);

  const activeMeasures = React.useMemo(
    () =>
      MEASURES.filter(
        (m) =>
          (bearer === "both" || m.bearer === bearer) &&
          (direction === "both" || m.dir === direction),
      ),
    [bearer, direction],
  );

  // Largest at the top: the band axis renders the first entry lowest.
  const ordered = React.useMemo(() => [...rows].reverse(), [rows]);

  const series = React.useMemo(
    () =>
      activeMeasures.map((m) => ({
        id: m.key,
        label: m.label,
        data: ordered.map((r) => r[m.key] ?? 0),
        stack: "usage",
        color: SERIES_COLORS[m.key][mode],
        valueFormatter: (v: number | null) => formatBytes(v ?? 0),
      })),
    [activeMeasures, ordered, mode],
  );

  if (error) return <Alert severity="error">Failed to load usage chart: {error}</Alert>;

  const height = Math.max(180, ordered.length * 30 + 90);

  return (
    <Box sx={{ width: "100%" }}>
      {/* Filters: one row above the chart */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1, pb: 1, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={bearer}
          onChange={(_, v: Bearer | null) => v && setBearer(v)}
        >
          <ToggleButton value="cellular">Cellular</ToggleButton>
          <ToggleButton value="wifi">Wi-Fi</ToggleButton>
          <ToggleButton value="both">Both</ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          size="small"
          exclusive
          value={direction}
          onChange={(_, v: Direction | null) => v && setDirection(v)}
        >
          <ToggleButton value="both">In + out</ToggleButton>
          <ToggleButton value="in">In</ToggleButton>
          <ToggleButton value="out">Out</ToggleButton>
        </ToggleButtonGroup>

        <Select
          size="small"
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          sx={{ width: 110 }}
        >
          {[5, 10, 15, 25].map((n) => (
            <MenuItem key={n} value={n}>
              Top {n}
            </MenuItem>
          ))}
        </Select>

        <Typography variant="caption" color="text.secondary">
          Click a bar to filter the table below
        </Typography>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading usage totals…</Typography>
        </Box>
      ) : ordered.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Typography color="text.secondary" variant="body2">
            No network usage recorded for this selection.
          </Typography>
        </Box>
      ) : (
        <BarChart
          height={height}
          layout="horizontal"
          series={series}
          yAxis={[
            {
              scaleType: "band",
              // A marker on the tick label shows the drilled-into app without
              // relying on per-bar DOM hooks, which this chart does not expose.
              data: ordered.map(
                (r) => `${r.app === selectedApp ? "▸ " : ""}${shortApp(r.app)}`,
              ),
              // Leave air in the band rather than filling the slot.
              categoryGapRatio: 0.45,
              tickLabelStyle: { fontSize: 11 },
              // The band axis owns its own width; chart margin does not give
              // tick labels room, so without this the app names truncate.
              width: 150,
            },
          ]}
          xAxis={[
            {
              valueFormatter: (v: number) => formatBytes(v),
              tickLabelStyle: { fontSize: 11 },
            },
          ]}
          borderRadius={4}
          margin={{ left: 8, right: 24, top: 8, bottom: 24 }}
          onItemClick={(_, item) => {
            const row = ordered[item.dataIndex ?? -1];
            if (!row) return;
            onSelectApp(selectedApp === row.app ? null : row.app);
          }}
          slotProps={{
            legend: { position: { vertical: "top", horizontal: "center" } },
          }}
          sx={{
            cursor: "pointer",
            // 2px gap in the surface colour separates touching marks — stacked
            // segments and neighbouring bars alike. Painted as a surface-coloured
            // stroke because this chart carves the gap out rather than exposing
            // a stack-spacing prop; it adds no ink of its own.
            "& .MuiBarChart-element": {
              stroke: surface,
              strokeWidth: 2,
              paintOrder: "stroke",
            },
            // Recessive chrome.
            "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { opacity: 0.35 },
            "& .MuiChartsGrid-line": { opacity: 0.18 },
          }}
          grid={{ vertical: true }}
        />
      )}
    </Box>
  );
}
