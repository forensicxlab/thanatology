import * as React from "react";
import Stack from "@mui/material/Stack";
import TimelineScatter from "./TimelineScatter";
import TimelineEventsGrid from "./TimelineEventsGrid";
import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import type { TimelineEvent } from "../../../../../dbutils/types";
import { useTimeFilterStore } from "../../../../../store/timeFilterStore";
import type { TimelineControlAdapter } from "./timelineControl";
import type { TimelineFilterChangeReason } from "./timelineControl";

export type TimelinerProps = {
  evidenceId: number;
  partitionId: number;
  /** Optional owner for a separate-window/cross-window timeline session. */
  controller?: TimelineControlAdapter;
};

export default function Timeliner({
  evidenceId,
  partitionId,
  controller,
}: TimelinerProps) {
  const [eventsFilter, setEventsFilter] =
    React.useState<TimelineEventsFilter | null>(null);
  const [localSelection, setLocalSelection] =
    React.useState<TimelineEvent | null>(null);

  const globalStart = useTimeFilterStore((s) => s.start);
  const globalEnd = useTimeFilterStore((s) => s.end);
  const setRange = useTimeFilterStore((s) => s.setRange);
  const clearRange = useTimeFilterStore((s) => s.clear);

  const controlledStart = controller?.range?.start ?? null;
  const controlledEnd = controller?.range?.end ?? null;
  const controlledTypesKey = JSON.stringify(
    controller?.range?.event_types ?? null,
  );

  // Brushing or clicking the scatter either updates the future cross-window
  // adapter, or preserves the existing global investigation-scope behaviour.
  const handleScatterFilter = React.useCallback(
    (filter: TimelineEventsFilter | null, reason: TimelineFilterChangeReason) => {
      if (controller) {
        controller.onRangeChange(filter, reason);
        return;
      }

      setEventsFilter(filter);
      if (filter && (filter.start != null || filter.end != null)) {
        setRange(filter.start, filter.end);
      } else {
        clearRange();
      }
    },
    [controller, setRange, clearRange],
  );

  const effectiveFilter = React.useMemo<TimelineEventsFilter | null>(() => {
    if (controller) {
      return controller.range == null
        ? null
        : {
            start: controlledStart,
            end: controlledEnd,
            event_types: JSON.parse(controlledTypesKey) as string[] | null,
          };
    }
    if (eventsFilter) {
      return { ...eventsFilter, start: globalStart, end: globalEnd };
    }
    if (globalStart == null && globalEnd == null) return null;
    return { start: globalStart, end: globalEnd, event_types: null };
  }, [
    controller,
    controlledStart,
    controlledEnd,
    controlledTypesKey,
    eventsFilter,
    globalStart,
    globalEnd,
  ]);

  const selectedEventId = controller?.selectedEventId ?? localSelection?.id ?? null;
  const cursorMs = controller?.cursorMs ?? localSelection?.ts ?? null;

  const handleEventSelect = React.useCallback(
    (event: TimelineEvent | null) => {
      if (controller) controller.onEventSelect(event);
      else setLocalSelection(event);
    },
    [controller],
  );

  return (
    <Stack sx={{ gap: 2, minHeight: 0 }}>
      <TimelineScatter
        evidenceId={evidenceId}
        partitionId={partitionId}
        range={controller ? effectiveFilter : undefined}
        cursorMs={cursorMs}
        onEventFilterChange={handleScatterFilter}
      />
      <TimelineEventsGrid
        evidenceId={evidenceId}
        partitionId={partitionId}
        filter={effectiveFilter}
        cursorMs={controller?.cursorMs ?? null}
        cursorWindow={controller?.cursorWindow ?? null}
        selectedEventId={selectedEventId}
        onEventSelect={handleEventSelect}
      />
    </Stack>
  );
}

export type { TimelineControlAdapter } from "./timelineControl";
