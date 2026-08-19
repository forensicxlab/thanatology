import * as React from "react";
import Stack from "@mui/material/Stack";
import TimelineScatter from "./TimelineScatter";
import TimelineEventsGrid from "./TimelineEventsGrid";
import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import { useTimeFilterStore } from "../../../../../store/timeFilterStore";

export default function Timeliner({
  evidenceId,
  partitionId,
}: {
  evidenceId: number;
  partitionId: number;
}) {
  const [eventsFilter, setEventsFilter] = React.useState<TimelineEventsFilter | null>(null);

  const globalStart = useTimeFilterStore((s) => s.start);
  const globalEnd = useTimeFilterStore((s) => s.end);
  const setRange = useTimeFilterStore((s) => s.setRange);

  // Brushing the scatter promotes its range to the global scope, so the whole
  // investigation follows the selection made here.
  const handleScatterFilter = React.useCallback(
    (filter: TimelineEventsFilter | null) => {
      setEventsFilter(filter);
      if (filter && (filter.start != null || filter.end != null)) {
        setRange(filter.start, filter.end);
      }
    },
    [setRange],
  );

  // Conversely, a range chosen in the scope bar drives this tab's grid.
  const effectiveFilter = React.useMemo<TimelineEventsFilter | null>(() => {
    if (eventsFilter) {
      return { ...eventsFilter, start: globalStart, end: globalEnd };
    }
    if (globalStart == null && globalEnd == null) return null;
    return { start: globalStart, end: globalEnd, event_types: null };
  }, [eventsFilter, globalStart, globalEnd]);

  return (
    <Stack sx={{ gap: 2 }}>
      <TimelineScatter
        evidenceId={evidenceId}
        partitionId={partitionId}
        onEventFilterChange={handleScatterFilter}
      />
      <TimelineEventsGrid
        evidenceId={evidenceId}
        partitionId={partitionId}
        filter={effectiveFilter}
      />
    </Stack>
  );
}
