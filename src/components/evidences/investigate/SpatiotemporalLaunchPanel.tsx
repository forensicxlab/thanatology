import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SplitscreenIcon from "@mui/icons-material/Splitscreen";
import SyncIcon from "@mui/icons-material/Sync";
import SyncDisabledIcon from "@mui/icons-material/SyncDisabled";
import TimelineIcon from "@mui/icons-material/Timeline";
import PlaceIcon from "@mui/icons-material/Place";
import { unixToISO8601UTCString } from "../common/UnixToUTC";
import {
  openLocationWindow,
  openSpatiotemporalWindows,
  openTimelineWindow,
} from "../../../spatiotemporal/ipc";
import type { SpatiotemporalSnapshot } from "../../../spatiotemporal/types";

type Props = {
  evidenceId: number;
  partitionId: number;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  snapshot: SpatiotemporalSnapshot | null;
  syncLoading: boolean;
  syncError: string | null;
  onRefresh: () => Promise<SpatiotemporalSnapshot | null>;
};

type LaunchTarget = "timeline" | "location" | "both";

function utcStamp(value: number | null): string {
  return value == null ? "Not set" : unixToISO8601UTCString(value);
}

export default function SpatiotemporalLaunchPanel({
  evidenceId,
  partitionId,
  rangeStartMs,
  rangeEndMs,
  snapshot,
  syncLoading,
  syncError,
  onRefresh,
}: Props) {
  const [busy, setBusy] = React.useState<LaunchTarget | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);

  const open = React.useCallback(
    async (target: LaunchTarget) => {
      setBusy(target);
      setOpenError(null);
      try {
        const options = {
          evidenceId,
          partitionId,
          initialRangeStartMs: rangeStartMs,
          initialRangeEndMs: rangeEndMs,
        };
        if (target === "both") {
          const result = await openSpatiotemporalWindows(options);
          const partialErrors = [
            result.timelineError ? `Timeline: ${result.timelineError}` : null,
            result.locationError ? `Location: ${result.locationError}` : null,
          ].filter((value): value is string => value != null);
          if (partialErrors.length > 0) {
            setOpenError(partialErrors.join(" "));
          }
        } else if (target === "timeline") {
          await openTimelineWindow(options);
        } else {
          await openLocationWindow(options);
        }
        // The main bridge owns the event subscription and snapshot. Refreshing
        // through it avoids a second listener whose revision could race the
        // always-mounted investigation scope.
        await onRefresh();
      } catch (caught) {
        setOpenError(String(caught));
      } finally {
        setBusy(null);
      }
    }, [evidenceId, onRefresh, partitionId, rangeEndMs, rangeStartMs],
  );

  const timelineConnected = snapshot?.timelineConnected === true;
  const locationConnected = snapshot?.locationConnected === true;
  const hasConnectedWorkspace = timelineConnected || locationConnected;
  const syncEnabled =
    hasConnectedWorkspace && snapshot?.syncEnabled === true;
  const bothConnected = timelineConnected && locationConnected;
  const bothLabel = bothConnected
    ? "Focus both"
    : timelineConnected || locationConnected
      ? "Open / focus both"
      : "Open both";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minHeight: 250,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <SplitscreenIcon color="primary" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
            Time &amp; Location Workspaces
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Evidence {evidenceId} · Partition {partitionId} · UTC
          </Typography>
        </Box>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Open the forensic chronology and device-location map side by side. Each
        workspace remains detachable. When synchronization is enabled, its UTC
        range also constrains the Main investigation views; cursor and playback
        remain controls of the detached workspaces.
      </Typography>

      {openError && <Alert severity="error">{openError}</Alert>}
      {syncError && !openError && (
        <Alert severity="warning">
          Time synchronization is temporarily unavailable: {syncError}
        </Alert>
      )}

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
        <Chip
          size="small"
          variant="outlined"
          color={timelineConnected ? "success" : "default"}
          icon={<TimelineIcon />}
          label={`Timeline ${timelineConnected ? "connected" : "offline"}`}
        />
        <Chip
          size="small"
          variant="outlined"
          color={locationConnected ? "success" : "default"}
          icon={<PlaceIcon />}
          label={`Location ${locationConnected ? "connected" : "offline"}`}
        />
        <Chip
          size="small"
          variant="outlined"
          color={syncEnabled ? "primary" : "default"}
          icon={syncEnabled ? <SyncIcon /> : <SyncDisabledIcon />}
          label={
            syncLoading && snapshot == null
              ? "Checking synchronization"
              : !hasConnectedWorkspace
                ? "No detached workspace connected"
                : syncEnabled
                ? "Main + workspaces synchronized"
                : "Synchronization off"
          }
        />
        {syncLoading && <CircularProgress size={14} />}
      </Stack>

      <Divider />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {syncEnabled ? "Linked investigation range" : "Main investigation range"}
          </Typography>
          <Typography variant="body2">
            {utcStamp(syncEnabled ? snapshot?.rangeStartMs ?? null : rangeStartMs)} →{" "}
            {utcStamp(syncEnabled ? snapshot?.rangeEndMs ?? null : rangeEndMs)}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Linked cursor
          </Typography>
          <Typography variant="body2">
            {syncEnabled ? utcStamp(snapshot?.cursorMs ?? null) : "Not linked"}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Correlation tolerance
          </Typography>
          <Typography variant="body2">
            ±{Math.round((snapshot?.correlationWindowMs ?? 300_000) / 60_000)} min
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: "auto", flexWrap: "wrap", gap: 0.5 }}
      >
        <Button
          size="small"
          variant="contained"
          startIcon={busy === "both" ? <CircularProgress size={14} /> : <SplitscreenIcon />}
          disabled={busy != null}
          onClick={() => void open("both")}
        >
          {bothLabel}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={busy === "timeline" ? <CircularProgress size={14} /> : <TimelineIcon />}
          disabled={busy != null}
          onClick={() => void open("timeline")}
        >
          {timelineConnected ? "Focus Timeline" : "Open Timeline"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={busy === "location" ? <CircularProgress size={14} /> : <PlaceIcon />}
          disabled={busy != null}
          onClick={() => void open("location")}
        >
          {locationConnected ? "Focus Location" : "Open Location"}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Thanatology never repositions an existing workspace; place each window on
        the investigator display of your choice. Synchronization links the UTC
        investigation range across Main, Timeline and Location, is optional, and
        starts disabled.
      </Typography>
    </Paper>
  );
}
