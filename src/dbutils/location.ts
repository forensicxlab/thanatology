import { getEvidenceDb } from "./db";

/** Explicit UTC range used by location queries. Null bounds are unbounded. */
export type LocationTimeRange = {
  startMs: number | null;
  endMs: number | null;
};

export type LocationObservationQuery = {
  evidenceId: number;
  partitionId: number;
  range?: LocationTimeRange | null;
};

/**
 * A device-location observation extracted from iOS Routined. This is an
 * observation made by the device, not proof that a particular person was at
 * the coordinate.
 */
export type LocationObservation = {
  id: number;
  artifactObjectId: number;
  timestampMs: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speedMps: number | null;
  courseDegrees: number | null;
  horizontalAccuracyMeters: number | null;
  valid: boolean | null;
  parser: string;
  kind: string;
  sourcePath: string | null;
  json: string | null;
};

export type LocationCoverage = {
  totalRecords: number;
  coordinateRecords: number;
  timestampedRecords: number;
  candidateRecords: number;
  explicitlyInvalidRecords: number;
  startMs: number | null;
  endMs: number | null;
};

export type LocationContextKind = "photo" | "shared_location";

/**
 * A spatially anchored artefact shown as context on the Location map. Context
 * points are deliberately separate from Routined observations: they must not
 * be joined into a movement track or selected as the device playhead.
 */
export type LocationContextPoint = {
  id: number;
  artifactObjectId: number;
  contextKind: LocationContextKind;
  timestampMs: number | null;
  latitude: number;
  longitude: number;
  label: string;
  secondaryLabel: string | null;
  parser: string;
  kind: string;
  sourcePath: string | null;
  sourceTable: string | null;
  sourceRowId: number | null;
  assetPath: string | null;
  conversation: string | null;
  sender: string | null;
  direction: string | null;
};

export type LocationContextResult = {
  points: LocationContextPoint[];
  limitPerKind: number;
  truncatedKinds: LocationContextKind[];
};

export type LocationContextQuery = LocationObservationQuery & {
  /** Hard result bound for each independent overlay. */
  limitPerKind?: number;
};

const DEFAULT_CONTEXT_LIMIT_PER_KIND = 10_000;
const MAX_CONTEXT_LIMIT_PER_KIND = 25_000;

type RawObservation = {
  id: number | string;
  artifact_object_id: number | string;
  ts: number | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  altitude: number | string | null;
  speed: number | string | null;
  course: number | string | null;
  horizontal_accuracy: number | string | null;
  valid: number | string | boolean | null;
  parser: string;
  kind: string;
  source_path: string | null;
  json: string | null;
};

type RawContextPoint = {
  id: number | string;
  artifact_object_id: number | string;
  context_kind: LocationContextKind;
  ts: number | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  label: string | null;
  secondary_label: string | null;
  parser: string;
  kind: string;
  source_path: string | null;
  source_table: string | null;
  source_rowid: number | string | null;
  asset_path: string | null;
  conversation: string | null;
  sender: string | null;
  direction: string | null;
};

function finiteNumber(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function nullableBoolean(
  value: number | string | boolean | null,
): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted !== 0 : null;
}

function normalizedRange(
  range?: LocationTimeRange | null,
): LocationTimeRange {
  const startMs = finiteNumber(range?.startMs ?? null);
  const endMs = finiteNumber(range?.endMs ?? null);
  if (startMs != null && endMs != null && startMs > endMs) {
    return { startMs: endMs, endMs: startMs };
  }
  return { startMs, endMs };
}

/**
 * Query Routined observations using only explicit arguments. Unlike the older
 * generic helpers this function never reaches into the frontend time store,
 * which makes it safe for independent Tauri webviews.
 */
export async function getIosLocationObservations(
  query: LocationObservationQuery,
): Promise<LocationObservation[]> {
  const db = await getEvidenceDb(query.evidenceId);
  const range = normalizedRange(query.range);
  const params: Array<number> = [query.evidenceId, query.partitionId];
  const clauses = [
    "ao.evidence_id = $1",
    "ao.partition_id = $2",
    "ao.parser = 'mobile_ios_routined'",
    "ao.kind = 'mobile.location.fix'",
  ];
  const tsExpression =
    "CAST(json_extract(ao.json, '$.timestamps.fix.unix_ms') AS INTEGER)";

  if (range.startMs != null) {
    params.push(Math.trunc(range.startMs));
    clauses.push(`${tsExpression} >= $${params.length}`);
  }
  if (range.endMs != null) {
    params.push(Math.trunc(range.endMs));
    clauses.push(`${tsExpression} <= $${params.length}`);
  }

  const rows = await db.select<RawObservation[]>(
    `SELECT
       ao.id AS id,
       ao.id AS artifact_object_id,
       ${tsExpression} AS ts,
       json_extract(ao.json, '$.location.latitude') AS latitude,
       json_extract(ao.json, '$.location.longitude') AS longitude,
       json_extract(ao.json, '$.location.altitude') AS altitude,
       json_extract(ao.json, '$.location.speed') AS speed,
       json_extract(ao.json, '$.location.course') AS course,
       json_extract(ao.json, '$.location.horizontal_accuracy') AS horizontal_accuracy,
       json_extract(ao.json, '$.location.valid') AS valid,
       ao.parser AS parser,
       ao.kind AS kind,
       json_extract(ao.json, '$.source.path') AS source_path,
       ao.json AS json
     FROM artifact_objects ao
     WHERE ${clauses.join(" AND ")}
     ORDER BY ts ASC, ao.id ASC`,
    params,
  );

  return (rows ?? []).map((row) => ({
    id: Number(row.id),
    artifactObjectId: Number(row.artifact_object_id),
    timestampMs: finiteNumber(row.ts),
    latitude: finiteNumber(row.latitude),
    longitude: finiteNumber(row.longitude),
    altitude: finiteNumber(row.altitude),
    speedMps: finiteNumber(row.speed),
    courseDegrees: finiteNumber(row.course),
    horizontalAccuracyMeters: finiteNumber(row.horizontal_accuracy),
    valid: nullableBoolean(row.valid),
    parser: row.parser,
    kind: row.kind,
    sourcePath: row.source_path,
    json: row.json,
  }));
}

function contextRangeClauses(
  range: LocationTimeRange,
  params: number[],
): string[] {
  const clauses: string[] = [];
  if (range.startMs != null) {
    params.push(Math.trunc(range.startMs));
    clauses.push(`ts >= $${params.length}`);
  }
  if (range.endMs != null) {
    params.push(Math.trunc(range.endMs));
    clauses.push(`ts <= $${params.length}`);
  }
  return clauses;
}

function toContextPoint(row: RawContextPoint): LocationContextPoint | null {
  const latitude = finiteNumber(row.latitude);
  const longitude = finiteNumber(row.longitude);
  if (
    latitude == null ||
    longitude == null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  const id = Number(row.id);
  const artifactObjectId = Number(row.artifact_object_id);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(artifactObjectId)) {
    return null;
  }
  const sourceRowId = finiteNumber(row.source_rowid);
  return {
    id,
    artifactObjectId,
    contextKind: row.context_kind,
    timestampMs: finiteNumber(row.ts),
    latitude,
    longitude,
    label: row.label?.trim() || `${row.context_kind} object #${artifactObjectId}`,
    secondaryLabel: row.secondary_label?.trim() || null,
    parser: row.parser,
    kind: row.kind,
    sourcePath: row.source_path,
    sourceTable: row.source_table,
    sourceRowId: sourceRowId == null ? null : Math.trunc(sourceRowId),
    assetPath: row.asset_path,
    conversation: row.conversation,
    sender: row.sender,
    direction: row.direction,
  };
}

/**
 * Load non-track spatial context using explicit evidence, partition and UTC
 * bounds. The two server queries are independently bounded so a very large
 * photo library cannot starve communication locations (or vice versa).
 *
 * Communication coordinates are accepted only when the parser explicitly
 * classifies the object as a location. Some WhatsApp schema variants expose
 * image dimensions through columns named latitude/longitude; coordinate
 * bounds alone would therefore create false map markers.
 */
export async function getIosLocationContext(
  query: LocationContextQuery,
): Promise<LocationContextResult> {
  const db = await getEvidenceDb(query.evidenceId);
  const range = normalizedRange(query.range);
  const requestedLimit = Math.trunc(
    finiteNumber(query.limitPerKind ?? DEFAULT_CONTEXT_LIMIT_PER_KIND) ??
      DEFAULT_CONTEXT_LIMIT_PER_KIND,
  );
  const limitPerKind = Math.min(
    MAX_CONTEXT_LIMIT_PER_KIND,
    Math.max(100, requestedLimit),
  );

  const photoParams: number[] = [query.evidenceId, query.partitionId];
  const photoRangeClauses = contextRangeClauses(range, photoParams);
  photoParams.push(limitPerKind + 1);
  const photoRows = await db.select<RawContextPoint[]>(
    `WITH photo_context AS (
       SELECT
         ao.id AS id,
         ao.id AS artifact_object_id,
         'photo' AS context_kind,
         COALESCE(
           CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER),
           CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER)
         ) AS ts,
         json_extract(ao.json, '$.location.latitude') AS latitude,
         json_extract(ao.json, '$.location.longitude') AS longitude,
         COALESCE(
           NULLIF(json_extract(ao.json, '$.asset.filename'), ''),
           'Photo asset #' || ao.id
         ) AS label,
         json_extract(ao.json, '$.asset.kind') AS secondary_label,
         ao.parser AS parser,
         ao.kind AS kind,
         json_extract(ao.json, '$.source.path') AS source_path,
         json_extract(ao.json, '$.source.table') AS source_table,
         json_extract(ao.json, '$.source.rowid') AS source_rowid,
         json_extract(ao.json, '$.asset.relative_path') AS asset_path,
         NULL AS conversation,
         NULL AS sender,
         NULL AS direction
       FROM artifact_objects ao
       WHERE ao.evidence_id = $1
         AND ao.partition_id = $2
         AND ao.parser = 'mobile_ios_photos'
         AND ao.kind = 'mobile.media.asset'
    )
    SELECT *
    FROM photo_context
    WHERE typeof(latitude) IN ('integer', 'real')
      AND typeof(longitude) IN ('integer', 'real')
      AND latitude BETWEEN -90.0 AND 90.0
      AND longitude BETWEEN -180.0 AND 180.0
      ${photoRangeClauses.length > 0 ? `AND ${photoRangeClauses.join(" AND ")}` : ""}
    ORDER BY ts IS NULL ASC, ts ASC, id ASC
    LIMIT $${photoParams.length}`,
    photoParams,
  );

  const sharedParams: number[] = [query.evidenceId, query.partitionId];
  const sharedRangeClauses = contextRangeClauses(range, sharedParams);
  sharedParams.push(limitPerKind + 1);
  const sharedRows = await db.select<RawContextPoint[]>(
    `WITH shared_context AS (
       SELECT
         ao.id AS id,
         ao.id AS artifact_object_id,
         'shared_location' AS context_kind,
         CASE ao.kind
           WHEN 'mobile.communication.attachment' THEN COALESCE(
             CAST(json_extract(ao.json, '$.timestamps.message.unix_ms') AS INTEGER),
             CAST(json_extract(ao.json, '$.timestamps.sent.unix_ms') AS INTEGER)
           )
           ELSE COALESCE(
             CAST(json_extract(ao.json, '$.timestamps.message.unix_ms') AS INTEGER),
             CAST(json_extract(ao.json, '$.timestamps.sent.unix_ms') AS INTEGER),
             CAST(json_extract(ao.json, '$.timestamps.received.unix_ms') AS INTEGER)
           )
         END AS ts,
         CASE ao.kind
           WHEN 'mobile.communication.attachment'
             THEN json_extract(ao.json, '$.media.location.latitude')
           ELSE json_extract(ao.json, '$.details.media.location.latitude')
         END AS latitude,
         CASE ao.kind
           WHEN 'mobile.communication.attachment'
             THEN json_extract(ao.json, '$.media.location.longitude')
           ELSE json_extract(ao.json, '$.details.media.location.longitude')
         END AS longitude,
         COALESCE(
           NULLIF(json_extract(ao.json, '$.attachment.caption'), ''),
           NULLIF(json_extract(ao.json, '$.attachment.file_name'), ''),
           NULLIF(json_extract(ao.json, '$.conversation.display_name'), ''),
           NULLIF(json_extract(ao.json, '$.chat.name'), ''),
           'Shared location'
         ) AS label,
         COALESCE(
           NULLIF(json_extract(ao.json, '$.app.label'), ''),
           NULLIF(json_extract(ao.json, '$.app'), '')
         ) AS secondary_label,
         ao.parser AS parser,
         ao.kind AS kind,
         json_extract(ao.json, '$.source.path') AS source_path,
         json_extract(ao.json, '$.source.table') AS source_table,
         json_extract(ao.json, '$.source.rowid') AS source_rowid,
         json_extract(ao.json, '$.attachment.local_path') AS asset_path,
         COALESCE(
           json_extract(ao.json, '$.conversation.display_name'),
           json_extract(ao.json, '$.chat.name'),
           json_extract(ao.json, '$.conversation.id'),
           json_extract(ao.json, '$.chat.jid')
         ) AS conversation,
         COALESCE(
           json_extract(ao.json, '$.sender.display_name'),
           json_extract(ao.json, '$.sender.push_name'),
           json_extract(ao.json, '$.sender.id'),
           json_extract(ao.json, '$.sender.jid')
         ) AS sender,
         json_extract(ao.json, '$.direction') AS direction
       FROM artifact_objects ao
       WHERE ao.evidence_id = $1
         AND ao.partition_id = $2
         AND (
           (
             ao.kind = 'mobile.communication.attachment'
             AND json_extract(ao.json, '$.attachment.kind') = 'location'
           ) OR (
             ao.kind = 'mobile.communication.message'
             AND json_extract(ao.json, '$.details.message.type_family') = 'location'
           )
         )
    )
    SELECT *
    FROM shared_context
    WHERE typeof(latitude) IN ('integer', 'real')
      AND typeof(longitude) IN ('integer', 'real')
      AND latitude BETWEEN -90.0 AND 90.0
      AND longitude BETWEEN -180.0 AND 180.0
      AND NOT (latitude = 0.0 AND longitude = 0.0)
      ${sharedRangeClauses.length > 0 ? `AND ${sharedRangeClauses.join(" AND ")}` : ""}
    ORDER BY ts IS NULL ASC, ts ASC, id ASC
    LIMIT $${sharedParams.length}`,
    sharedParams,
  );

  const truncatedKinds: LocationContextKind[] = [];
  if ((photoRows?.length ?? 0) > limitPerKind) truncatedKinds.push("photo");
  if ((sharedRows?.length ?? 0) > limitPerKind) {
    truncatedKinds.push("shared_location");
  }

  const points = [
    ...(photoRows ?? []).slice(0, limitPerKind),
    ...(sharedRows ?? []).slice(0, limitPerKind),
  ]
    .map(toContextPoint)
    .filter((point): point is LocationContextPoint => point != null)
    .sort(
      (left, right) =>
        (left.timestampMs ?? Number.POSITIVE_INFINITY) -
          (right.timestampMs ?? Number.POSITIVE_INFINITY) ||
        left.id - right.id,
    );

  return { points, limitPerKind, truncatedKinds };
}

/** Partition-wide coverage, intentionally independent of the active range. */
export async function getIosLocationCoverage(
  evidenceId: number,
  partitionId: number,
): Promise<LocationCoverage> {
  const db = await getEvidenceDb(evidenceId);
  const rows = await db.select<
    Array<{
      total_records: number | string;
      coordinate_records: number | string;
      timestamped_records: number | string;
      candidate_records: number | string;
      explicitly_invalid_records: number | string;
      start_ms: number | string | null;
      end_ms: number | string | null;
    }>
  >(
    `SELECT
       COUNT(*) AS total_records,
       SUM(CASE WHEN
         json_extract(ao.json, '$.location.latitude') IS NOT NULL AND
         json_extract(ao.json, '$.location.longitude') IS NOT NULL
         THEN 1 ELSE 0 END) AS coordinate_records,
       SUM(CASE WHEN
         json_extract(ao.json, '$.timestamps.fix.unix_ms') IS NOT NULL
         THEN 1 ELSE 0 END) AS timestamped_records,
       SUM(CASE WHEN
         json_extract(ao.json, '$.location.latitude') IS NOT NULL AND
         json_extract(ao.json, '$.location.longitude') IS NOT NULL AND
         json_extract(ao.json, '$.timestamps.fix.unix_ms') IS NOT NULL
         THEN 1 ELSE 0 END) AS candidate_records,
       SUM(CASE WHEN
         CAST(json_extract(ao.json, '$.location.valid') AS INTEGER) = 0
         THEN 1 ELSE 0 END) AS explicitly_invalid_records,
       MIN(CAST(json_extract(ao.json, '$.timestamps.fix.unix_ms') AS INTEGER)) AS start_ms,
       MAX(CAST(json_extract(ao.json, '$.timestamps.fix.unix_ms') AS INTEGER)) AS end_ms
     FROM artifact_objects ao
     WHERE ao.evidence_id = $1
       AND ao.partition_id = $2
       AND ao.parser = 'mobile_ios_routined'
       AND ao.kind = 'mobile.location.fix'`,
    [evidenceId, partitionId],
  );
  const row = rows?.[0];
  return {
    totalRecords: Number(row?.total_records ?? 0),
    coordinateRecords: Number(row?.coordinate_records ?? 0),
    timestampedRecords: Number(row?.timestamped_records ?? 0),
    candidateRecords: Number(row?.candidate_records ?? 0),
    explicitlyInvalidRecords: Number(row?.explicitly_invalid_records ?? 0),
    startMs: finiteNumber(row?.start_ms ?? null),
    endMs: finiteNumber(row?.end_ms ?? null),
  };
}
