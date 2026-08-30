import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTimeFilterStore } from "../../../store/timeFilterStore";
import type { FileTimeField } from "../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../common/UnixToUTC";

/** How the authoritative investigation window applies to a panel's records. */
export type TimeFilterMode =
  | "intrinsic"
  | "interval"
  | "source-file"
  | "timeless";

export interface TimeFilterBannerProps {
  mode?: TimeFilterMode;
  /** What the view contains, e.g. "messages", "source files". */
  noun?: string;
  /** Forensic timestamp basis, e.g. "message timestamp" or "updated time". */
  timestampLabel?: string;
  /** Optional "showing X of Y" disclosure. */
  shown?: number;
  total?: number;
  /**
   * Optional range override for a local drill-down. When omitted, the global
   * investigation range is used. This never creates a second store.
   */
  range?: { start: number | null; end: number | null };
  /** Override the global clear action when `range` is a local drill-down. */
  onClear?: () => void;
  sx?: SxProps<Theme>;
}

const FILE_TIME_LABELS: Record<FileTimeField, string> = {
  any: "created, modified or accessed time",
  created: "created time",
  modified: "modified time",
  accessed: "accessed time",
};

function stamp(ms: number): string {
  return unixToISO8601UTCString(ms)
    .replace(/\.\d+Z$/, "Z")
    .replace("T", " ");
}

function rangeLabel(start: number | null, end: number | null): string {
  if (start != null && end != null) return `${stamp(start)} → ${stamp(end)} UTC`;
  if (start != null) return `from ${stamp(start)} UTC onward`;
  if (end != null) return `through ${stamp(end)} UTC`;
  return "all time";
}

/**
 * Compact, universal disclosure for the single global investigation time scope.
 *
 * Any view that hides rows outside the active window should render this so the
 * constraint is never invisible. Timeless views render it too, explicitly
 * explaining why their records remain visible. The component reflects the
 * authoritative scope editor; it never owns an independent filter.
 */
export default function TimeFilterBanner({
  mode = "intrinsic",
  noun = "rows",
  timestampLabel,
  shown,
  total,
  range,
  onClear,
  sx,
}: TimeFilterBannerProps) {
  const globalStart = useTimeFilterStore((state) => state.start);
  const globalEnd = useTimeFilterStore((state) => state.end);
  const fileTimeField = useTimeFilterStore((state) => state.fileTimeField);
  const clearGlobal = useTimeFilterStore((state) => state.clear);

  const start = range === undefined ? globalStart : range.start;
  const end = range === undefined ? globalEnd : range.end;
  if (start == null && end == null) return null;

  const counts =
    typeof shown === "number" && typeof total === "number" && total > 0
      ? ` Showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}.`
      : "";
  const basis = timestampLabel?.trim();
  const window = rangeLabel(start, end);

  let message: string;
  switch (mode) {
    case "interval":
      message = `Investigation time: ${window}. ${noun} whose${
        basis ? ` ${basis}` : " time interval"
      } overlaps the window are shown; non-overlapping ${noun} are hidden.${counts}`;
      break;
    case "source-file":
      message = `Investigation time: ${window}. ${noun} are matched on ${
        basis || `backing-file ${FILE_TIME_LABELS[fileTimeField]}`
      }; out-of-range ${noun} are hidden.${counts}`;
      break;
    case "timeless":
      message = `Investigation time is active (${window}), but ${noun} have no intrinsic timestamp. All ${noun} remain visible.`;
      break;
    default:
      message = `Investigation time: ${window}. Out-of-range ${noun} are hidden${
        basis ? ` using ${basis}` : ""
      }.${counts}`;
      break;
  }

  // A local override must opt into its own clear callback. Otherwise a Clear
  // button could misleadingly erase the unrelated global investigation range.
  const clearAction = range === undefined ? clearGlobal : onClear;

  return (
    <Box sx={{ px: 1, pt: 0.75, ...sx }}>
      <Alert
        severity={mode === "timeless" ? "info" : "warning"}
        variant="outlined"
        icon={false}
        action={
          clearAction ? (
            <Button color="inherit" size="small" onClick={clearAction}>
              Clear
            </Button>
          ) : undefined
        }
        sx={{
          py: 0,
          px: 1,
          alignItems: "center",
          "& .MuiAlert-message": { py: 0.45, minWidth: 0 },
          "& .MuiAlert-action": { py: 0.15, mr: 0 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="caption" sx={{ lineHeight: 1.35 }}>
            {message}
          </Typography>
        </Stack>
      </Alert>
    </Box>
  );
}
