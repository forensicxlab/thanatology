import type { TimelineEventsFilter } from "../../../../../dbutils/sqlite";
import type { TimelineEvent } from "../../../../../dbutils/types";

/** Bounded event neighbourhood rendered while following an external playhead. */
export type TimelineCursorWindow = {
  beforeMs: number;
  afterMs: number;
  limit?: number;
  /** Maximum SQLite refresh rate while the external playhead is moving. */
  queryIntervalMs?: number;
};

/** Why the Timeline changed its event filter. Clock ownership depends on this. */
export type TimelineFilterChangeReason = "point" | "range" | "types" | "clear";

/**
 * Narrow bridge between the timeline UI and a future cross-window session.
 * The adapter owns synchronized state; timeline components remain unaware of
 * the transport (Tauri events, a Rust coordinator, or an in-process store).
 */
export type TimelineControlAdapter = {
  range: TimelineEventsFilter | null;
  cursorMs: number | null;
  selectedEventId: number | null;
  cursorWindow?: TimelineCursorWindow | null;
  onRangeChange: (
    range: TimelineEventsFilter | null,
    reason: TimelineFilterChangeReason,
  ) => void;
  onEventSelect: (event: TimelineEvent | null) => void;
};
