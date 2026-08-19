import * as React from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimeRangePicker } from "@mui/x-date-pickers-pro/DateTimeRangePicker";
import { MultiInputDateTimeRangeField } from "@mui/x-date-pickers-pro/MultiInputDateTimeRangeField";

import { getEvidenceTimeBounds, getTimelineDensity } from "../../../dbutils/sqlite";
import {
  FILE_TIME_FIELDS,
  useTimeFilterStore,
} from "../../../store/timeFilterStore";
import type { FileTimeField } from "../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../common/UnixToUTC";

dayjs.extend(utc);

interface TimeScopeControlProps {
  evidenceId: number;
  partitionId: number | null;
}

const DENSITY_BARS_TARGET = 160;

/** Compact UTC stamp for the active-range chip (drops sub-second noise). */
function shortStamp(ms: number): string {
  return unixToISO8601UTCString(ms).replace(/\.\d+Z$/, "Z").replace("T", " ");
}

export default function TimeScopeControl({
  evidenceId,
  partitionId,
}: TimeScopeControlProps) {
  const initForEvidence = useTimeFilterStore((s) => s.initForEvidence);
  const setRange = useTimeFilterStore((s) => s.setRange);
  const clear = useTimeFilterStore((s) => s.clear);
  const start = useTimeFilterStore((s) => s.start);
  const end = useTimeFilterStore((s) => s.end);
  const fileTimeField = useTimeFilterStore((s) => s.fileTimeField);
  const setFileTimeField = useTimeFilterStore((s) => s.setFileTimeField);

  const [bounds, setBounds] = React.useState<{
    min: number;
    max: number;
    outliers: number;
    total: number;
  } | null>(null);
  const [density, setDensity] = React.useState<{ ts: number; count: number }[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Local slider position while dragging; committed to the store on release so
  // every dependent view refetches once, not on every pixel.
  const [dragging, setDragging] = React.useState<[number, number] | null>(null);

  React.useEffect(() => {
    initForEvidence(evidenceId);
  }, [evidenceId, initForEvidence]);

  React.useEffect(() => {
    if (partitionId == null) {
      setBounds(null);
      setDensity([]);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const b = await getEvidenceTimeBounds(evidenceId, partitionId);
        if (!alive) return;
        if (b.min == null || b.max == null || b.max <= b.min) {
          setBounds(null);
          setDensity([]);
          return;
        }
        setBounds({
          min: b.min,
          max: b.max,
          outliers: b.outliers,
          total: b.total,
        });

        const spanMs = b.max - b.min;
        const bucket = spanMs <= 3 * 86_400_000 ? "hour" : "day";
        const bucketMs = bucket === "hour" ? 3_600_000 : 86_400_000;
        const profile = await getTimelineDensity(evidenceId, partitionId, bucketMs);
        if (!alive) return;
        setDensity(profile);
      } catch {
        if (alive) {
          setBounds(null);
          setDensity([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId]);

  const sliderValue = React.useMemo<[number, number] | null>(() => {
    if (!bounds) return null;
    if (dragging) return dragging;
    return [start ?? bounds.min, end ?? bounds.max];
  }, [bounds, dragging, start, end]);

  // Downsample the density profile into fixed-width bars for the strip.
  const bars = React.useMemo(() => {
    if (!bounds || density.length === 0) return [];
    const span = bounds.max - bounds.min;
    if (span <= 0) return [];
    const buckets = new Array<number>(DENSITY_BARS_TARGET).fill(0);
    for (const d of density) {
      // Outliers live outside the display domain; don't pile them onto the
      // edge bars where they would fake a spike.
      if (d.ts < bounds.min || d.ts > bounds.max) continue;
      const idx = Math.min(
        DENSITY_BARS_TARGET - 1,
        Math.max(0, Math.floor(((d.ts - bounds.min) / span) * DENSITY_BARS_TARGET)),
      );
      buckets[idx] += d.count;
    }
    const peak = Math.max(...buckets, 1);
    return buckets.map((count, i) => ({
      count,
      // sqrt keeps low-activity periods visible next to a huge spike day.
      height: count === 0 ? 0 : Math.max(0.06, Math.sqrt(count) / Math.sqrt(peak)),
      ts: bounds.min + ((i + 0.5) / DENSITY_BARS_TARGET) * span,
    }));
  }, [bounds, density]);

  const pickerValue = React.useMemo<[Dayjs | null, Dayjs | null]>(
    () => [start == null ? null : dayjs.utc(start), end == null ? null : dayjs.utc(end)],
    [start, end],
  );

  const isActive = start != null || end != null;

  const handlePickerChange = (value: [Dayjs | null, Dayjs | null]) => {
    setRange(
      value[0] ? value[0].valueOf() : null,
      value[1] ? value[1].valueOf() : null,
    );
  };

  const selection = sliderValue;

  return (
    <Stack
      direction={{ xs: "column", lg: "row" }}
      spacing={1.5}
      sx={{ alignItems: { xs: "stretch", lg: "center" }, width: "100%" }}
    >
      {/* Density strip + brush */}
      <Box sx={{ flexGrow: 1, minWidth: 240 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.25 }}>
          <Typography variant="caption" color="text.secondary">
            Activity
          </Typography>
          {loading && <CircularProgress size={10} />}
          {isActive && (
            <Chip
              size="small"
              color="warning"
              label={`Filtered · ${start != null ? shortStamp(start) : "…"} → ${
                end != null ? shortStamp(end) : "…"
              } UTC`}
              sx={{ height: 20 }}
            />
          )}
        </Stack>

        {bounds ? (
          <Box sx={{ px: 0.5 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-end",
                gap: "1px",
                height: 34,
                width: "100%",
              }}
            >
              {bars.map((b, i) => {
                const inSelection =
                  !selection || (b.ts >= selection[0] && b.ts <= selection[1]);
                return (
                  <Box
                    key={i}
                    sx={{
                      flex: 1,
                      height: `${Math.round(b.height * 100)}%`,
                      minHeight: b.count > 0 ? 2 : 0,
                      bgcolor: inSelection ? "primary.main" : "text.disabled",
                      opacity: inSelection ? 0.85 : 0.25,
                      borderRadius: "1px 1px 0 0",
                      transition: "opacity 120ms",
                    }}
                  />
                );
              })}
            </Box>

            <Slider
              size="small"
              min={bounds.min}
              max={bounds.max}
              value={selection ?? [bounds.min, bounds.max]}
              onChange={(_, v) => setDragging(v as [number, number])}
              onChangeCommitted={(_, v) => {
                const [lo, hi] = v as [number, number];
                setDragging(null);
                // Snapping back to the full span means "no filter".
                if (lo <= bounds.min && hi >= bounds.max) clear();
                else setRange(lo, hi);
              }}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => shortStamp(v as number)}
              sx={{ mt: -0.5, py: 0.5 }}
            />
            <Stack direction="row" sx={{ justifyContent: "space-between", mt: -0.75 }}>
              <Typography variant="caption" color="text.secondary">
                {shortStamp(bounds.min)}
              </Typography>
              {bounds.outliers > 0 && (
                <Tooltip
                  title={
                    "Zero-dated files and far-future entries are excluded from this " +
                    "slider's range so it stays usable. They are NOT hidden from the " +
                    "views — clear the filter, or type an exact range in the fields, to reach them."
                  }
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ textDecoration: "underline dotted", cursor: "help" }}
                  >
                    {bounds.outliers.toLocaleString()} of{" "}
                    {bounds.total.toLocaleString()} events outside slider range
                  </Typography>
                </Tooltip>
              )}
              <Typography variant="caption" color="text.secondary">
                {shortStamp(bounds.max)}
              </Typography>
            </Stack>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {partitionId == null
              ? "Select a partition to enable the time scope."
              : "No timestamped activity indexed for this partition."}
          </Typography>
        )}
      </Box>

      {/* Precise range entry */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DateTimeRangePicker
            value={pickerValue}
            onChange={(v) => handlePickerChange(v as [Dayjs | null, Dayjs | null])}
            timezone="UTC"
            ampm={false}
            slots={{ field: MultiInputDateTimeRangeField }}
            slotProps={{
              textField: { size: "small", sx: { width: 190 } },
            }}
            localeText={{ start: "From (UTC)", end: "To (UTC)" }}
          />
        </LocalizationProvider>

        <Tooltip title="Which filesystem timestamp decides whether a file is in range. Applies to the Files, System, Network, Users, Applications and AI views.">
          <FormControl size="small" sx={{ width: 160 }}>
            <InputLabel id="file-time-field-label">File match on</InputLabel>
            <Select
              labelId="file-time-field-label"
              label="File match on"
              value={fileTimeField}
              onChange={(e) => setFileTimeField(e.target.value as FileTimeField)}
            >
              {FILE_TIME_FIELDS.map((f) => (
                <MenuItem key={f.value} value={f.value}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Tooltip>

        <Tooltip title="Clear time filter">
          <span>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<RestartAltIcon />}
              onClick={() => clear()}
              disabled={!isActive}
            >
              Clear
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
