import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";
import Timeliner from "./Timeliner";
import type { TimelineControlAdapter } from "./timelineControl";

/** Transport-neutral contract for the future Timeline/Location session hook. */
export type TimelineWindowSessionAdapter = {
  control: TimelineControlAdapter;
  syncEnabled: boolean;
  peerConnected: boolean;
  onSyncEnabledChange: (enabled: boolean) => void;
  statusMessage?: string | null;
};

export type TimelineWindowAppProps = {
  evidenceId: number;
  partitionId: number;
  evidenceName?: string | null;
  session: TimelineWindowSessionAdapter;
};

/**
 * Window-ready Timeline workspace. Window creation, URL/bootstrap parsing and
 * synchronization transport deliberately live outside this component.
 */
export default function TimelineWindowApp({
  evidenceId,
  partitionId,
  evidenceName,
  session,
}: TimelineWindowAppProps) {
  const cursorMs = session.control.cursorMs;

  return (
    <Box
      sx={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 1,
        p: 1,
        bgcolor: "background.default",
      }}
    >
      <Paper variant="outlined" sx={{ px: 1.5, py: 1 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { xs: "stretch", sm: "center" } }}
        >
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Timeline
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {evidenceName ? `${evidenceName} · ` : ""}Evidence #{evidenceId} · Partition #{partitionId}
            </Typography>
          </Box>

          {cursorMs != null && Number.isFinite(cursorMs) && (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`Playhead ${unixToISO8601UTCString(cursorMs)}`}
            />
          )}
          <Chip
            size="small"
            color={session.peerConnected ? "success" : "default"}
            variant="outlined"
            icon={session.peerConnected ? <LinkIcon /> : <LinkOffIcon />}
            label={session.peerConnected ? "Location connected" : "Location not connected"}
          />
          <FormControlLabel
            sx={{ m: 0, whiteSpace: "nowrap" }}
            control={
              <Switch
                size="small"
                checked={session.syncEnabled}
                onChange={(event) => session.onSyncEnabledChange(event.target.checked)}
              />
            }
            label="Sync investigation time"
          />
        </Stack>
        {session.statusMessage && (
          <Alert severity={session.peerConnected ? "info" : "warning"} sx={{ mt: 1, py: 0 }}>
            {session.statusMessage}
          </Alert>
        )}
      </Paper>

      <Box sx={{ minHeight: 0, overflow: "auto" }}>
        <Timeliner
          evidenceId={evidenceId}
          partitionId={partitionId}
          controller={session.control}
        />
      </Box>
    </Box>
  );
}
