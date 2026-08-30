import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import GpsFixedRoundedIcon from "@mui/icons-material/GpsFixedRounded";
import LocationOffRoundedIcon from "@mui/icons-material/LocationOffRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCorrelationLocationObservations,
  getCorrelationTimelineEvent,
  type CorrelationLocationObservation,
  type CorrelationTimelineEvent,
} from "./correlationQueries";

export type SpatiotemporalCorrelationPanelProps = {
  evidenceId: number;
  partitionId: number;
  cursorMs: number | null;
  selectedTimelineEventId: number | null;
  correlationWindowMs: number;
};

type CorrelationState = {
  event: CorrelationTimelineEvent | null;
  eventMissing: boolean;
  observations: CorrelationLocationObservation[];
};

const EMPTY_STATE: CorrelationState = {
  event: null,
  eventMissing: false,
  observations: [],
};

/** Keep playback correlation bounded to at most two evidence queries/second. */
function useThrottledCursor(value: number | null, intervalMs = 500) {
  const [throttled, setThrottled] = useState(value);
  const latest = useRef(value);
  const lastUpdate = useRef(0);

  useEffect(() => {
    latest.current = value;
    if (value == null) {
      lastUpdate.current = Date.now();
      setThrottled(null);
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

function formatUtc(timestampMs: number | null): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return "No UTC time";
  return `${new Date(timestampMs).toISOString()} UTC`;
}

function formatDuration(milliseconds: number): string {
  const value = Math.max(0, Math.round(Math.abs(milliseconds)));
  if (value < 1_000) return `${value} ms`;
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes} min ${remainingSeconds} s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} h ${remainingMinutes} min`;
}

function observationDeltaLabel(
  observation: CorrelationLocationObservation,
  cursorMs: number,
): string {
  const delta = observation.timestampMs - cursorMs;
  if (delta === 0) return "at cursor";
  return delta < 0
    ? `${formatDuration(delta)} before cursor`
    : `${formatDuration(delta)} after cursor`;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 86, flex: "0 0 auto" }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{ minWidth: 0, overflowWrap: "anywhere", userSelect: "text" }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function ObservationCard({
  observation,
  cursorMs,
  direct,
}: {
  observation: CorrelationLocationObservation;
  cursorMs: number;
  direct: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1, minWidth: 0, flex: 1 }}>
      <Stack spacing={0.5}>
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <PlaceRoundedIcon fontSize="small" color={direct ? "success" : "action"} />
          <Typography variant="subtitle2">
            {observation.relation === "before" ? "Previous" : "Next"} device observation
          </Typography>
          <Chip
            size="small"
            color={direct ? "success" : "default"}
            label={direct ? "Direct event record" : "Temporal association only"}
          />
        </Stack>
        <DetailLine label="Observed" value={formatUtc(observation.timestampMs)} />
        <DetailLine
          label="Delta"
          value={observationDeltaLabel(observation, cursorMs)}
        />
        <DetailLine
          label="Coordinate"
          value={`${observation.latitude.toFixed(6)}, ${observation.longitude.toFixed(6)}`}
        />
        <DetailLine
          label="Accuracy"
          value={
            observation.horizontalAccuracyMeters == null
              ? "Not reported"
              : `±${observation.horizontalAccuracyMeters.toFixed(1)} m (reported horizontal)`
          }
        />
        {observation.altitudeMeters != null && (
          <DetailLine label="Altitude" value={`${observation.altitudeMeters.toFixed(1)} m`} />
        )}
        <Divider sx={{ my: 0.25 }} />
        <DetailLine label="Parser" value={observation.parser} />
        <DetailLine label="Object" value={`#${observation.id} · ${observation.kind}`} />
        <DetailLine label="Source" value={observation.sourcePath ?? "Source path not recorded"} />
      </Stack>
    </Paper>
  );
}

/**
 * Read-only forensic correlation view. It consumes shared-window state through
 * props and performs no Tauri IPC, playback, map movement, or state mutation.
 */
export default function SpatiotemporalCorrelationPanel({
  evidenceId,
  partitionId,
  cursorMs,
  selectedTimelineEventId,
  correlationWindowMs,
}: SpatiotemporalCorrelationPanelProps) {
  const [state, setState] = useState<CorrelationState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const throttledCursorMs = useThrottledCursor(cursorMs);
  // Playback can be sampled, but an explicit event selection is an atomic
  // forensic anchor: query its newly selected timestamp immediately so the
  // panel never pairs the new event with an older throttled cursor.
  const queryCursorMs =
    selectedTimelineEventId == null ? throttledCursorMs : cursorMs;

  useEffect(() => {
    let cancelled = false;
    if (queryCursorMs == null || !Number.isFinite(queryCursorMs)) {
      setState(EMPTY_STATE);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    const eventRequest =
      selectedTimelineEventId == null
        ? Promise.resolve(null)
        : getCorrelationTimelineEvent(
            evidenceId,
            partitionId,
            selectedTimelineEventId,
          );

    Promise.all([
      eventRequest,
      getCorrelationLocationObservations(
        evidenceId,
        partitionId,
        queryCursorMs,
        correlationWindowMs,
      ),
    ])
      .then(([event, observations]) => {
        if (cancelled) return;
        setState({
          event,
          eventMissing: selectedTimelineEventId != null && event == null,
          observations,
        });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState(EMPTY_STATE);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    evidenceId,
    partitionId,
    queryCursorMs,
    selectedTimelineEventId,
    correlationWindowMs,
  ]);

  const uniqueObservations = useMemo(() => {
    const seen = new Set<number>();
    return state.observations.filter((observation) => {
      if (seen.has(observation.id)) return false;
      seen.add(observation.id);
      return true;
    });
  }, [state.observations]);

  const directObservationId =
    state.event?.objectKind === "mobile.location.fix"
      ? state.event.artifactObjectId
      : null;
  const before = state.observations.find((item) => item.relation === "before") ?? null;
  const after = state.observations.find((item) => item.relation === "after") ?? null;
  const observedGapMs =
    before && after && before.id !== after.id
      ? after.timestampMs - before.timestampMs
      : null;
  const anchorCursorMs = queryCursorMs;

  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 0 }}>
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <GpsFixedRoundedIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">Timeline ↔ Location correlation</Typography>
          <Chip size="small" label={`Evidence ${evidenceId} · Partition ${partitionId}`} />
          <Chip
            size="small"
            variant="outlined"
            label={`±${formatDuration(correlationWindowMs)} search`}
          />
          {loading && <CircularProgress size={16} />}
        </Stack>

        <Alert severity="info" icon={<GpsFixedRoundedIcon fontSize="inherit" />}>
          Coordinates are device observations, not proof that a particular person was
          present. Nearby records are shown without interpolation.
        </Alert>

        {anchorCursorMs == null ? (
          <Alert severity="warning" icon={<AccessTimeRoundedIcon fontSize="inherit" />}>
            No shared UTC cursor is set. Select a timeline event or scrub the location
            playback to inspect nearby observations.
          </Alert>
        ) : (
          <DetailLine label="UTC cursor" value={formatUtc(anchorCursorMs)} />
        )}

        {error && <Alert severity="error">Correlation query failed: {error}</Alert>}

        {state.eventMissing && (
          <Alert severity="warning">
            Selected timeline event #{selectedTimelineEventId} is not available in this
            evidence and partition. The location search remains anchored to the cursor.
          </Alert>
        )}

        {state.event ? (
          <Paper variant="outlined" sx={{ p: 1 }}>
            <Stack spacing={0.5}>
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <AccessTimeRoundedIcon fontSize="small" />
                <Typography variant="subtitle2">Selected timeline event</Typography>
                <Chip size="small" label={`#${state.event.id}`} />
                <Chip size="small" variant="outlined" label={state.event.eventType} />
              </Stack>
              <DetailLine label="Timestamp" value={formatUtc(state.event.timestampMs)} />
              <DetailLine label="Description" value={state.event.description ?? "No description"} />
              <DetailLine label="Actor" value={state.event.actor ?? "Not recorded"} />
              <DetailLine label="Source" value={state.event.source} />
              <DetailLine
                label="Parser object"
                value={
                  state.event.artifactObjectId == null
                    ? "No parsed-object link"
                    : `#${state.event.artifactObjectId} · ${state.event.objectParser ?? "unknown parser"} · ${state.event.objectKind ?? "unknown kind"}`
                }
              />
              <DetailLine
                label="Source path"
                value={
                  state.event.filePath ??
                  state.event.objectSourcePath ??
                  "Source path not recorded"
                }
              />
            </Stack>
          </Paper>
        ) : selectedTimelineEventId == null && anchorCursorMs != null ? (
          <Alert severity="info">
            No timeline event is selected. Nearby device observations are correlated to
            the playback cursor only.
          </Alert>
        ) : null}

        {!loading && anchorCursorMs != null && uniqueObservations.length === 0 && !error ? (
          <Alert severity="warning" icon={<LocationOffRoundedIcon fontSize="inherit" />}>
            No valid device location observation exists within ±
            {formatDuration(correlationWindowMs)} of the cursor. No position is inferred
            for this time.
          </Alert>
        ) : null}

        {uniqueObservations.length > 0 && anchorCursorMs != null && (
          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={1}
            sx={{ alignItems: "stretch" }}
          >
            {uniqueObservations.map((observation) => (
              <ObservationCard
                key={observation.id}
                observation={observation}
                cursorMs={anchorCursorMs}
                direct={directObservationId === observation.id}
              />
            ))}
          </Stack>
        )}

        {!loading && anchorCursorMs != null && uniqueObservations.length > 0 && (
          <Alert severity={observedGapMs == null ? "info" : "warning"}>
            {observedGapMs != null
              ? `Observed gap between the surrounding fixes: ${formatDuration(observedGapMs)}. Movement inside this gap is unknown; the application does not interpolate a route.`
              : before == null
                ? "No valid earlier observation exists inside the correlation window; only the next observed device position is shown."
                : after == null
                  ? "No valid later observation exists inside the correlation window; only the previous observed device position is shown."
                  : "The cursor coincides with one device observation. No surrounding route is inferred."}
          </Alert>
        )}

        <Box sx={{ color: "text.secondary" }}>
          <Typography variant="caption">
            Correlation is temporal unless the selected event directly references the
            same location object. Reported accuracy is preserved as provenance, not used
            to fabricate a more precise coordinate.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
