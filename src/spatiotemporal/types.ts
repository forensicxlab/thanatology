export type SpatiotemporalRole = "timeline" | "location";
export type SpatiotemporalOrigin = SpatiotemporalRole | "investigation";

export interface SpatiotemporalIdentity {
  evidenceId: number;
  partitionId: number;
  role: SpatiotemporalRole;
}

export interface SpatiotemporalSnapshot {
  schemaVersion: 2;
  /** Opaque identity for one backend session lifetime. */
  sessionId: string;
  evidenceId: number;
  partitionId: number;
  syncEnabled: boolean;
  cursorMs: number | null;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  correlationWindowMs: number;
  playing: boolean;
  playbackRate: number;
  controller: SpatiotemporalRole | null;
  playbackGeneration: number;
  playbackTickSequence: number;
  selectedTimelineEventId: number | null;
  selectedLocationObservationId: number | null;
  revision: number;
  origin: SpatiotemporalOrigin | null;
  timelineConnected: boolean;
  locationConnected: boolean;
}

/** A main-window update is deliberately limited to the shared time range. */
export interface MainSpatiotemporalRangeRequest {
  evidenceId: number;
  partitionId: number;
  expectedSessionId?: string | null;
  expectedRevision?: number | null;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
}

export interface MainSpatiotemporalSyncRequest
  extends MainSpatiotemporalRangeRequest {
  syncEnabled: boolean;
}

export interface SpatiotemporalOpenOptions {
  evidenceId: number;
  partitionId: number;
  initialRangeStartMs?: number | null;
  initialRangeEndMs?: number | null;
}

export interface OpenSpatiotemporalWindowsResult {
  timelineLabel: string | null;
  locationLabel: string | null;
  timelineError: string | null;
  locationError: string | null;
}

export interface SpatiotemporalStatePatch {
  cursorMs?: number | null;
  rangeStartMs?: number | null;
  rangeEndMs?: number | null;
  correlationWindowMs?: number;
  playing?: boolean;
  playbackRate?: number;
  controller?: SpatiotemporalRole | null;
  selectedTimelineEventId?: number | null;
  selectedLocationObservationId?: number | null;
}

export interface SpatiotemporalSyncSeed {
  cursorMs: number | null;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  correlationWindowMs: number;
  playing: boolean;
  playbackRate: number;
  selectedTimelineEventId: number | null;
  selectedLocationObservationId: number | null;
}
