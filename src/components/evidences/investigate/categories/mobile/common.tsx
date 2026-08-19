import * as React from "react";
import { Box, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import UnixToISO8601UTC from "../../../common/UnixToUTC";

/** Labeled multi-value entry (phone / email) as stored by the contacts parser. */
export type LabeledValue = { value: string; label?: string | null };

/** Parse a JSON array string of {value,label} objects; tolerant of bad input. */
export function parseLabeledValues(raw: string | null | undefined): LabeledValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (entry && typeof entry === "object" && "value" in entry) {
          const value = String((entry as LabeledValue).value ?? "").trim();
          if (!value) return null;
          const label = (entry as LabeledValue).label;
          return { value, label: label ? String(label) : null };
        }
        if (typeof entry === "string" && entry.trim()) {
          return { value: entry.trim(), label: null };
        }
        return null;
      })
      .filter((v): v is { value: string; label: string | null } => v !== null);
  } catch {
    return [];
  }
}

/** Join labeled values into a compact, scannable string for a grid cell. */
export function joinLabeledValues(raw: string | null | undefined): string {
  return parseLabeledValues(raw)
    .map((v) => (v.label ? `${v.value} (${v.label})` : v.value))
    .join(", ");
}

/** Render an epoch-ms timestamp as a UTC string, or an em dash when absent. */
export function renderTimestampCell(value: unknown): React.ReactNode {
  if (value == null || value === "") {
    return <span style={{ color: "var(--mui-palette-text-disabled)" }}>—</span>;
  }
  return <UnixToISO8601UTC timestamp={Number(value)} />;
}

/** Byte count as a compact human string (e.g. 850289163 -> "811.0 MB"). */
export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Human-readable call duration from seconds (e.g. 3661 -> "1h 01m 01s"). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** Detail panel showing the full parsed JSON blob with a copy button. */
export function IosJsonDetailPanel({ jsonRaw }: { jsonRaw: string | null }) {
  const pretty = React.useMemo(() => {
    if (!jsonRaw) return "";
    try {
      return JSON.stringify(JSON.parse(jsonRaw), null, 2);
    } catch {
      return jsonRaw;
    }
  }, [jsonRaw]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty || "");
    } catch {
      /* ignore */
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="overline" color="text.secondary">
          Parsed record (JSON)
        </Typography>
        <Tooltip title="Copy JSON">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          borderRadius: 1,
          bgcolor: "background.default",
          overflow: "auto",
          maxHeight: 360,
          fontSize: 12,
        }}
      >
        {pretty || "(empty)"}
      </Box>
    </Box>
  );
}
