import { Box, Chip, Stack, Typography } from "@mui/material";

export type ParserProgressPhase = "started" | "completed" | "failed";

export interface ParserProgressPayload {
  current: number;
  total: number;
  parser: string;
  filePath: string;
  artifactId: number;
  fileId: number | null;
  phase: ParserProgressPhase;
  elapsedMs: number | null;
  setupMs: number | null;
  parseMs: number | null;
  persistenceMs: number | null;
  objectsEmitted: number | null;
  message: string;
}

interface ParserActivityStatusProps {
  activity: ParserProgressPayload;
  compact?: boolean;
}

function phasePresentation(phase: ParserProgressPhase) {
  switch (phase) {
    case "completed":
      return { label: "Completed", color: "success" as const };
    case "failed":
      return { label: "Failed", color: "error" as const };
    default:
      return { label: "Running", color: "info" as const };
  }
}

function formatDuration(elapsedMs: number | null): string | null {
  if (elapsedMs === null) return null;
  if (elapsedMs < 1_000) return `${elapsedMs} ms`;
  if (elapsedMs < 60_000) return `${(elapsedMs / 1_000).toFixed(2)} s`;
  return `${Math.floor(elapsedMs / 60_000)}m ${((elapsedMs % 60_000) / 1_000).toFixed(1)}s`;
}

export default function ParserActivityStatus({
  activity,
  compact = false,
}: ParserActivityStatusProps) {
  const phase = phasePresentation(activity.phase);
  const duration = formatDuration(activity.elapsedMs);
  const setupDuration = formatDuration(activity.setupMs);
  const parseDuration = formatDuration(activity.parseMs);
  const persistenceDuration = formatDuration(activity.persistenceMs);

  return (
    <Box
      sx={{
        mt: compact ? 0.75 : 1,
        px: compact ? 1 : 1.25,
        py: compact ? 0.75 : 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        backgroundColor: "action.hover",
        minWidth: 0,
        textAlign: "left",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ minWidth: 0, alignItems: "center" }}
      >
        <Chip size="small" color={phase.color} label={phase.label} sx={{ height: 20 }} />
        <Typography
          variant="body2"
          sx={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontWeight: 700,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={activity.parser}
        >
          {activity.parser}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto !important" }}>
          {activity.current}/{activity.total}
        </Typography>
      </Stack>

      <Typography
        variant="caption"
        title={activity.filePath}
        sx={{
          display: "block",
          mt: 0.5,
          color: "text.secondary",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {activity.filePath}
      </Typography>

      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ mt: 0.35, flexWrap: "wrap" }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Artifact #{activity.artifactId}
        </Typography>
        {activity.fileId !== null && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            File row #{activity.fileId}
          </Typography>
        )}
        {duration && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Total {duration}
          </Typography>
        )}
        {setupDuration && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Setup {setupDuration}
          </Typography>
        )}
        {parseDuration && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Parse {parseDuration}
          </Typography>
        )}
        {persistenceDuration && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            DB {persistenceDuration}
          </Typography>
        )}
        {activity.objectsEmitted !== null && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {activity.objectsEmitted.toLocaleString()} objects
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
