import type { LocationTimeRange } from "../../../../../dbutils/location";

export type LocationCursorChangeReason =
  | "playback"
  | "scrub"
  | "restart"
  | "observation";

/**
 * Transport-independent contract for the Location workspace. A future Tauri
 * session adapter can implement these callbacks without coupling the map to
 * window labels or event names.
 */
export type LocationControlAdapter = {
  range: LocationTimeRange | null;
  cursorMs: number | null;
  playing: boolean;
  playbackRate: number;
  /** artifact_objects.id for the selected Routined observation. */
  selectedObservationId?: number | null;
  onCursorChange: (
    cursorMs: number,
    reason: LocationCursorChangeReason,
  ) => void;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackRateChange: (rate: number) => void;
  onObservationSelect?: (artifactObjectId: number | null) => void;
};
