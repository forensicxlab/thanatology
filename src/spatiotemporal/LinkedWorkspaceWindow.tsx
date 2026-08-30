import * as React from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import {
  WindowDragRegion,
  WindowTitlebar,
} from "../components/windows/shared/WindowTitlebar";
import type { SpatiotemporalIdentity } from "./types";
import {
  type SpatiotemporalSessionApi,
  useSpatiotemporalSession,
} from "./useSpatiotemporalSession";

export interface LinkedWorkspaceWindowProps {
  identity: SpatiotemporalIdentity;
  children: (session: SpatiotemporalSessionApi) => React.ReactNode;
}

function formatUtc(timestamp: number | null | undefined): string {
  if (timestamp == null) return "No cursor";
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? "Invalid cursor" : date.toISOString();
}

function Titlebar({
  identity,
  session,
}: {
  identity: SpatiotemporalIdentity;
  session: SpatiotemporalSessionApi;
}) {
  const roleName = identity.role === "timeline" ? "Timeline" : "Location";
  const snapshot = session.snapshot;

  return (
    <WindowTitlebar windowName={`${roleName.toLowerCase()} window`}>
      <WindowDragRegion
        sx={{ alignItems: "center", gap: 1, minWidth: 0, height: "100%", px: 1 }}
      >
        <Typography
          data-tauri-drag-region
          variant="caption"
          noWrap
          sx={{ fontWeight: 600 }}
        >
          {roleName}
        </Typography>
        <Chip
          data-tauri-drag-region
          size="small"
          variant="outlined"
          label={`Evidence ${identity.evidenceId}`}
        />
        <Chip
          data-tauri-drag-region
          size="small"
          variant="outlined"
          label={`Partition ${identity.partitionId}`}
        />
        <Typography
          data-tauri-drag-region
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ ml: 0.5 }}
        >
          {snapshot?.syncEnabled
            ? `Shared cursor: ${formatUtc(snapshot.cursorMs)}`
            : "Independent local clock shown below"}
        </Typography>
      </WindowDragRegion>

      {session.loading && <CircularProgress size={14} />}
      <Chip
        size="small"
        variant="outlined"
        color={session.peerConnected ? "success" : "default"}
        label={session.peerConnected ? "Peer connected" : "Peer disconnected"}
      />
      <Tooltip
        title={
          snapshot?.syncEnabled
            ? "UTC range, cursor, selection and playback are synchronized."
            : "This workspace is independent. Enable synchronization from the workspace controls."
        }
      >
        <Chip
          size="small"
          variant="outlined"
          color={snapshot?.syncEnabled ? "primary" : "default"}
          icon={snapshot?.syncEnabled ? <LinkIcon /> : <LinkOffIcon />}
          label={snapshot?.syncEnabled ? "Synced" : "Independent"}
        />
      </Tooltip>
    </WindowTitlebar>
  );
}

export default function LinkedWorkspaceWindow({
  identity,
  children,
}: LinkedWorkspaceWindowProps) {
  const session = useSpatiotemporalSession(identity);
  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Titlebar identity={identity} session={session} />
      {session.error && (
        <Alert severity="error" sx={{ borderRadius: 0, flexShrink: 0 }}>
          Spatiotemporal coordination error: {session.error}
        </Alert>
      )}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
        {session.loading && !session.snapshot ? (
          <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              Connecting {identity.role} workspace…
            </Typography>
          </Stack>
        ) : (
          children(session)
        )}
      </Box>
    </Box>
  );
}

export function WorkspaceFoundationNotice({ role }: { role: "timeline" | "location" }) {
  return (
    <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", p: 3 }}>
      <Typography variant="subtitle1">
        {role === "timeline" ? "Timeline" : "Location"} workspace connected
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, textAlign: "center" }}>
        Evidence and partition scope are validated. The synchronized feature view will mount here.
      </Typography>
    </Stack>
  );
}
