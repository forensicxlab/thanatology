import * as React from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SyncIcon from "@mui/icons-material/Sync";
import SyncDisabledIcon from "@mui/icons-material/SyncDisabled";
import TimelineIcon from "@mui/icons-material/Timeline";
import PlaceIcon from "@mui/icons-material/Place";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
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
import type { SpatiotemporalSnapshot } from "../../../spatiotemporal/types";
import { unixToISO8601UTCString } from "../common/UnixToUTC";

dayjs.extend(utc);

interface TimeScopeControlProps {
  evidenceId: number;
  partitionId: number | null;
  timeSync: {
    snapshot: SpatiotemporalSnapshot | null;
    loading: boolean;
    error: string | null;
    setEnabled: (
      enabled: boolean,
    ) => Promise<SpatiotemporalSnapshot | null>;
  };
}

const DENSITY_BARS_TARGET = 160;

/** Compact UTC stamp for the active-range chip (drops sub-second noise). */
function shortStamp(ms: number): string {
  return unixToISO8601UTCString(ms).replace(/\.\d+Z$/, "Z").replace("T", " ");
}

export default function TimeScopeControl({
  evidenceId,
  partitionId,
  timeSync,
}: TimeScopeControlProps) {
  const initForScope = useTimeFilterStore((s) => s.initForScope);
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
  const [syncChanging, setSyncChanging] = React.useState(false);
  const [syncActionError, setSyncActionError] = React.useState<string | null>(
    null,
  );
  // Local slider position while dragging; committed to the store on release so
  // every dependent view refetches once, not on every pixel.
  const [dragging, setDragging] = React.useState<[number, number] | null>(null);

  React.useEffect(() => {
    initForScope(evidenceId, partitionId);
  }, [evidenceId, partitionId, initForScope]);

  React.useEffect(() => {
    setSyncActionError(null);
  }, [evidenceId, partitionId]);

  React.useEffect(() => {
    // A newer accepted snapshot proves that a prior command/listener warning
    // no longer describes the current revision.
    setSyncActionError(null);
  }, [timeSync.snapshot?.sessionId, timeSync.snapshot?.revision]);

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
  const hasConnectedWorkspace =
    timeSync.snapshot?.timelineConnected === true ||
    timeSync.snapshot?.locationConnected === true;
  const hasSyncSession = partitionId != null && hasConnectedWorkspace;
  const syncEnabled = hasSyncSession && timeSync.snapshot?.syncEnabled === true;
  const syncBusy = timeSync.loading || syncChanging;
  const syncError = syncActionError ?? timeSync.error;

  const syncStatus = React.useMemo(() => {
    if (partitionId == null) return "Select a partition to link workspaces.";
    if (timeSync.loading && timeSync.snapshot == null) {
      return "Checking detached workspaces…";
    }
    if (!timeSync.snapshot) {
      return "Open Timeline or Location to enable synchronization.";
    }
    if (!hasConnectedWorkspace) {
      return "No detached workspace connected.";
    }
    if (timeSync.snapshot.syncEnabled) {
      return "Main investigation range is linked.";
    }
    return "Detached workspaces available · synchronization off.";
  }, [hasConnectedWorkspace, partitionId, timeSync.loading, timeSync.snapshot]);

  const handleSyncChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const enabled = event.target.checked;
    setSyncChanging(true);
    setSyncActionError(null);
    try {
      await timeSync.setEnabled(enabled);
    } catch (caught) {
      setSyncActionError(String(caught));
    } finally {
      setSyncChanging(false);
    }
  };

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

      {/* The same switch controls range synchronization in Main, Timeline and
          Location. Cursor/playback and Timeline event-type filters stay local
          to the detached workspaces. */}
      <Box
        sx={{
          flexShrink: 0,
          minWidth: 245,
          px: { xs: 0, lg: 1.25 },
          borderLeft: { xs: "none", lg: "1px solid" },
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Tooltip
            title={
              hasSyncSession
                ? "Link the UTC investigation range across Main, Timeline and Location."
                : "Open the Timeline or Location workspace first."
            }
          >
            <span>
              <FormControlLabel
                sx={{
                  m: 0,
                  mr: 0.5,
                  "& .MuiFormControlLabel-label": { lineHeight: 1.1 },
                }}
                control={
                  <Switch
                    size="small"
                    checked={syncEnabled}
                    disabled={!hasSyncSession || syncBusy}
                    onChange={(event) => void handleSyncChange(event)}
                    slotProps={{
                      input: {
                        "aria-label": "Sync investigation time across windows",
                      },
                    }}
                  />
                }
                label={
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    {syncEnabled ? (
                      <SyncIcon color="primary" sx={{ fontSize: 15 }} />
                    ) : (
                      <SyncDisabledIcon color="disabled" sx={{ fontSize: 15 }} />
                    )}
                    <Typography variant="caption" sx={{ fontWeight: 650 }}>
                      Sync investigation time
                    </Typography>
                  </Stack>
                }
              />
            </span>
          </Tooltip>
          {syncBusy && <CircularProgress size={12} />}
          {syncError && (
            <Tooltip title={`Synchronization warning: ${syncError}`}>
              <WarningAmberIcon color="warning" sx={{ fontSize: 16 }} />
            </Tooltip>
          )}
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: "center", mt: 0.25, flexWrap: "wrap", gap: 0.25 }}
        >
          <Chip
            size="small"
            variant="outlined"
            color={timeSync.snapshot?.timelineConnected ? "success" : "default"}
            icon={<TimelineIcon />}
            label={timeSync.snapshot?.timelineConnected ? "Timeline" : "Timeline offline"}
            sx={{ height: 19, "& .MuiChip-icon": { fontSize: 13 } }}
          />
          <Chip
            size="small"
            variant="outlined"
            color={timeSync.snapshot?.locationConnected ? "success" : "default"}
            icon={<PlaceIcon />}
            label={timeSync.snapshot?.locationConnected ? "Location" : "Location offline"}
            sx={{ height: 19, "& .MuiChip-icon": { fontSize: 13 } }}
          />
        </Stack>
        <Typography
          variant="caption"
          color={syncError ? "warning.main" : "text.secondary"}
          noWrap
          title={syncError ? `Sync warning · ${syncError}` : syncStatus}
          sx={{ display: "block", mt: 0.35, maxWidth: 275 }}
        >
          {syncError ? `Sync warning · ${syncError}` : syncStatus}
        </Typography>
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

        <Tooltip title="Selects the filesystem timestamp used by Files, raw artifact source files, Multimedia Files, Summary file statistics and AI source files. Parsed records with an intrinsic event time use that event time instead.">
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
