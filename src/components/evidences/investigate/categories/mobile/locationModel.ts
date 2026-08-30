import type { LocationObservation } from "../../../../../dbutils/location";

export const DEFAULT_TRACK_GAP_MS = 30 * 60 * 1_000;
export const DEFAULT_MAX_TRACK_SPEED_MPS = 400;
export const DEFAULT_OBSERVATION_MAX_AGE_MS = 15 * 60 * 1_000;

export type ValidLocationObservation = LocationObservation & {
  timestampMs: number;
  latitude: number;
  longitude: number;
};

export type LocationValidationSummary = {
  inputCount: number;
  usableCount: number;
  missingTimestamp: number;
  missingCoordinate: number;
  invalidCoordinate: number;
  explicitlyInvalid: number;
  invalidAccuracy: number;
};

export type ValidatedLocationSet = {
  observations: ValidLocationObservation[];
  summary: LocationValidationSummary;
};

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

/** Validate and sort without altering source records or silently clamping data. */
export function validateLocationObservations(
  input: LocationObservation[],
): ValidatedLocationSet {
  const summary: LocationValidationSummary = {
    inputCount: input.length,
    usableCount: 0,
    missingTimestamp: 0,
    missingCoordinate: 0,
    invalidCoordinate: 0,
    explicitlyInvalid: 0,
    invalidAccuracy: 0,
  };
  const observations: ValidLocationObservation[] = [];

  for (const observation of input) {
    if (!finite(observation.timestampMs) || observation.timestampMs <= 0) {
      summary.missingTimestamp += 1;
      continue;
    }
    if (!finite(observation.latitude) || !finite(observation.longitude)) {
      summary.missingCoordinate += 1;
      continue;
    }
    if (
      observation.latitude < -90 ||
      observation.latitude > 90 ||
      observation.longitude < -180 ||
      observation.longitude > 180
    ) {
      summary.invalidCoordinate += 1;
      continue;
    }
    if (observation.valid === false) {
      summary.explicitlyInvalid += 1;
      continue;
    }
    if (
      observation.horizontalAccuracyMeters != null &&
      (!Number.isFinite(observation.horizontalAccuracyMeters) ||
        observation.horizontalAccuracyMeters < 0)
    ) {
      summary.invalidAccuracy += 1;
      continue;
    }
    observations.push(observation as ValidLocationObservation);
  }

  observations.sort(
    (left, right) =>
      left.timestampMs - right.timestampMs || left.id - right.id,
  );
  summary.usableCount = observations.length;
  return { observations, summary };
}

function accuracyRank(observation: ValidLocationObservation): number {
  return observation.horizontalAccuracyMeters ?? Number.POSITIVE_INFINITY;
}

/**
 * Return the latest observation at or before the UTC cursor. No interpolation
 * or future observation is used. Duplicate timestamps prefer best accuracy,
 * then the lowest stable object id.
 */
export function observationAtOrBefore(
  observations: ValidLocationObservation[],
  cursorMs: number | null,
  maxAgeMs = DEFAULT_OBSERVATION_MAX_AGE_MS,
): ValidLocationObservation | null {
  if (cursorMs == null || !Number.isFinite(cursorMs) || observations.length === 0) {
    return null;
  }

  let low = 0;
  let high = observations.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (observations[mid].timestampMs <= cursorMs) low = mid + 1;
    else high = mid;
  }
  const latestIndex = low - 1;
  if (latestIndex < 0) return null;
  const latestTimestamp = observations[latestIndex].timestampMs;
  if (cursorMs - latestTimestamp > Math.max(0, maxAgeMs)) return null;

  let firstAtTimestamp = latestIndex;
  while (
    firstAtTimestamp > 0 &&
    observations[firstAtTimestamp - 1].timestampMs === latestTimestamp
  ) {
    firstAtTimestamp -= 1;
  }
  let selected = observations[firstAtTimestamp];
  for (let i = firstAtTimestamp + 1; i <= latestIndex; i += 1) {
    const candidate = observations[i];
    const accuracyDelta = accuracyRank(candidate) - accuracyRank(selected);
    if (accuracyDelta < 0 || (accuracyDelta === 0 && candidate.id < selected.id)) {
      selected = candidate;
    }
  }
  return selected;
}

/** Haversine distance in metres. */
export function distanceMeters(
  left: ValidLocationObservation,
  right: ValidLocationObservation,
): number {
  const radians = Math.PI / 180;
  const lat1 = left.latitude * radians;
  const lat2 = right.latitude * radians;
  const deltaLat = (right.latitude - left.latitude) * radians;
  const deltaLon = (right.longitude - left.longitude) * radians;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type TrackSegmentationOptions = {
  maxGapMs?: number;
  maxSpeedMps?: number;
};

function shouldSplitTrack(
  previous: ValidLocationObservation,
  current: ValidLocationObservation,
  options: Required<TrackSegmentationOptions>,
): boolean {
  const elapsedMs = current.timestampMs - previous.timestampMs;
  if (elapsedMs < 0 || elapsedMs > options.maxGapMs) return true;
  // A GeoJSON line crossing ±180 degrees draws across the whole world.
  if (Math.abs(current.longitude - previous.longitude) > 180) return true;

  const distance = distanceMeters(previous, current);
  if (elapsedMs === 0) return distance > 1;
  return distance / (elapsedMs / 1_000) > options.maxSpeedMps;
}

/**
 * Split observed points at data gaps, the antimeridian, or physically
 * implausible jumps. Singletons remain visible in the point layer but are not
 * fabricated into movement lines.
 */
export function segmentLocationTrack(
  observations: ValidLocationObservation[],
  options: TrackSegmentationOptions = {},
): ValidLocationObservation[][] {
  if (observations.length === 0) return [];
  const resolved = {
    maxGapMs: Math.max(0, options.maxGapMs ?? DEFAULT_TRACK_GAP_MS),
    maxSpeedMps: Math.max(0, options.maxSpeedMps ?? DEFAULT_MAX_TRACK_SPEED_MPS),
  };
  const segments: ValidLocationObservation[][] = [];
  let currentSegment = [observations[0]];

  for (let i = 1; i < observations.length; i += 1) {
    const observation = observations[i];
    const previous = observations[i - 1];
    if (shouldSplitTrack(previous, observation, resolved)) {
      segments.push(currentSegment);
      currentSegment = [observation];
    } else {
      currentSegment.push(observation);
    }
  }
  segments.push(currentSegment);
  return segments;
}

