import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useTimeFilterStore } from "../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../common/UnixToUTC";

/**
 * Universal indicator for the global investigation time scope.
 *
 * Any view that hides rows outside the active window should render this so the
 * constraint is never invisible. It deliberately does NOT own a filter of its
 * own — it reflects and clears the single global scope set in the Investigation
 * Scope bar, so there is only ever one time filter in play.
 */
export default function TimeFilterBanner({
  /** What the view is hiding, e.g. "messages", "files". */
  noun = "rows",
  /** Optional "showing X of Y" disclosure. */
  shown,
  total,
  sx,
}: {
  noun?: string;
  shown?: number;
  total?: number;
  sx?: object;
}) {
  const start = useTimeFilterStore((s) => s.start);
  const end = useTimeFilterStore((s) => s.end);
  const clear = useTimeFilterStore((s) => s.clear);

  if (start == null && end == null) return null;

  const stamp = (ms: number) =>
    unixToISO8601UTCString(ms).replace(/\.\d+Z$/, "Z").replace("T", " ");

  const counts =
    typeof shown === "number" && typeof total === "number" && total > 0
      ? ` — showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}`
      : "";

  return (
    <Box sx={{ px: 1, pt: 1, ...sx }}>
      <Alert
        severity="warning"
        variant="outlined"
        action={
          <Button color="inherit" size="small" onClick={() => clear()}>
            Clear
          </Button>
        }
        sx={{ py: 0.25 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2">
            Time scope active: {start != null ? stamp(start) : "…"} →{" "}
            {end != null ? stamp(end) : "…"} UTC{counts}. Out-of-range {noun} are
            hidden.
          </Typography>
        </Stack>
      </Alert>
    </Box>
  );
}
