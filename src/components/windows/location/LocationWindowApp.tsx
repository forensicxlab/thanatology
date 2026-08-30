import {
  Box,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import LocationMap from "../../evidences/investigate/categories/mobile/LocationMap";
import type { LocationControlAdapter } from "../../evidences/investigate/categories/mobile/locationControl";

export type LocationWindowAppProps = {
  evidenceId: number;
  partitionId: number;
  evidenceName?: string;
  partitionLabel?: string;
  control: LocationControlAdapter;
  syncEnabled?: boolean;
  peerConnected?: boolean;
  onSyncEnabledChange?: (enabled: boolean) => void;
  correlationWindowMs?: number;
  onCorrelationWindowMsChange?: (windowMs: number) => void;
  correlationPanel?: ReactNode;
};

const CORRELATION_WINDOWS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function correlationWindowLabel(windowMs: number) {
  if (windowMs < 60_000) return `${Math.round(windowMs / 1_000)} seconds`;
  if (windowMs < 60 * 60_000) return `${Math.round(windowMs / 60_000)} minutes`;
  return `${Math.round(windowMs / (60 * 60_000))} hour`;
}

/**
 * Transport-agnostic detached Location workspace. It deliberately knows
 * nothing about Tauri labels or event names: the window bootstrap supplies a
 * LocationControlAdapter backed by whichever session transport owns state.
 */
export default function LocationWindowApp({
  evidenceId,
  partitionId,
  evidenceName,
  partitionLabel,
  control,
  syncEnabled = false,
  peerConnected = false,
  onSyncEnabledChange,
  correlationWindowMs = 5 * 60_000,
  onCorrelationWindowMsChange,
  correlationPanel,
}: LocationWindowAppProps) {
  return (
    <Box
      sx={{
        width: "100vw",
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          px: 1.5,
          py: 1,
          alignItems: "center",
          flexWrap: "wrap",
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ minWidth: 180, mr: "auto" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Location
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {evidenceName ?? `Evidence ${evidenceId}`} · {partitionLabel ?? `Partition ${partitionId}`}
          </Typography>
        </Box>

        <Tooltip title="All cursor and range values are synchronized as Unix epoch milliseconds in UTC">
          <Chip size="small" label="UTC evidence clock" variant="outlined" />
        </Tooltip>
        <Tooltip title="Routined coordinates are device observations. They do not, by themselves, prove that a particular person was present.">
          <Chip
            size="small"
            label="Device observations"
            color="warning"
            variant="outlined"
          />
        </Tooltip>

        <Divider orientation="vertical" flexItem />

        <FormControl size="small" sx={{ minWidth: 145 }}>
          <InputLabel id="location-correlation-window-label">Correlation</InputLabel>
          <Select
            labelId="location-correlation-window-label"
            label="Correlation"
            value={correlationWindowMs}
            disabled={!onCorrelationWindowMsChange}
            onChange={(event) =>
              onCorrelationWindowMsChange?.(Number(event.target.value))
            }
          >
            {CORRELATION_WINDOWS.map((windowMs) => (
              <MenuItem key={windowMs} value={windowMs}>
                ±{correlationWindowLabel(windowMs)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Chip
          size="small"
          color={peerConnected ? "success" : "default"}
          variant="outlined"
          label={peerConnected ? "Timeline connected" : "Timeline disconnected"}
        />
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Switch
              size="small"
              checked={syncEnabled}
              disabled={!onSyncEnabledChange}
              onChange={(event) => onSyncEnabledChange?.(event.target.checked)}
            />
          }
          label="Sync investigation time"
        />
      </Stack>

      <Box
        sx={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: correlationPanel
            ? {
                xs: "minmax(0, 1fr)",
                md: "minmax(0, 1fr) clamp(340px, 34vw, 430px)",
              }
            : "minmax(0, 1fr)",
          gridTemplateRows: correlationPanel
            ? {
                xs: "clamp(280px, 52vh, 460px) minmax(220px, auto)",
                md: "minmax(0, 1fr)",
              }
            : "minmax(0, 1fr)",
          overflowX: "hidden",
          overflowY: { xs: "auto", md: "hidden" },
        }}
      >
        <Box sx={{ minHeight: 0, display: "flex", overflow: "hidden" }}>
          <LocationMap
            evidenceId={evidenceId}
            partitionId={partitionId}
            range={control.range}
            cursorMs={control.cursorMs}
            playing={control.playing}
            playbackRate={control.playbackRate}
            selectedObservationId={control.selectedObservationId}
            onCursorChange={control.onCursorChange}
            onPlayingChange={control.onPlayingChange}
            onPlaybackRateChange={control.onPlaybackRateChange}
            onObservationSelect={control.onObservationSelect}
          />
        </Box>
        {correlationPanel && (
          <Box
            sx={{
              minHeight: 0,
              overflow: { xs: "visible", md: "auto" },
              p: 1,
              borderLeft: { xs: 0, md: 1 },
              borderTop: { xs: 1, md: 0 },
              borderColor: "divider",
              bgcolor: "background.default",
            }}
          >
            {correlationPanel}
          </Box>
        )}
      </Box>
    </Box>
  );
}
