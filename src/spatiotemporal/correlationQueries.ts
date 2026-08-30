import { getEvidenceDb } from "../dbutils/db";

export type CorrelationTimelineEvent = {
  id: number;
  timestampMs: number;
  source: string;
  eventType: string;
  description: string | null;
  actor: string | null;
  fileId: number | null;
  artifactObjectId: number | null;
  fileName: string | null;
  filePath: string | null;
  objectParser: string | null;
  objectKind: string | null;
  objectText: string | null;
  objectSourcePath: string | null;
};

export type CorrelationLocationObservation = {
  id: number;
  timestampMs: number;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  horizontalAccuracyMeters: number | null;
  parser: string;
  kind: string;
  sourcePath: string | null;
  relation: "before" | "after";
};

type RawTimelineEvent = {
  id: number | string;
  ts: number | string;
  source: string;
  event_type: string;
  description: string | null;
  actor: string | null;
  file_id: number | string | null;
  artifact_object_id: number | string | null;
  file_name: string | null;
  file_path: string | null;
  object_parser: string | null;
  object_kind: string | null;
  object_text: string | null;
  object_source_path: string | null;
};

type RawLocationObservation = {
  id: number | string;
  ts: number | string;
  latitude: number | string;
  longitude: number | string;
  altitude: number | string | null;
  horizontal_accuracy: number | string | null;
  parser: string;
  kind: string;
  source_path: string | null;
  relation: "before" | "after";
};

function finiteNumber(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function nullableId(value: number | string | null): number | null {
  const converted = finiteNumber(value);
  return converted == null ? null : Math.trunc(converted);
}

/**
 * Fetch exactly one selected timeline event. Both the event and joined source
 * records are constrained to the active evidence and partition, so a stale
 * selection from another auxiliary window cannot cross evidence boundaries.
 */
export async function getCorrelationTimelineEvent(
  evidenceId: number,
  partitionId: number,
  timelineEventId: number,
): Promise<CorrelationTimelineEvent | null> {
  if (
    !Number.isInteger(evidenceId) ||
    evidenceId <= 0 ||
    !Number.isInteger(partitionId) ||
    partitionId <= 0 ||
    !Number.isInteger(timelineEventId) ||
    timelineEventId <= 0
  ) {
    return null;
  }

  const db = await getEvidenceDb(evidenceId);
  const rows = await db.select<RawTimelineEvent[]>(
    `SELECT
       te.id,
       te.ts,
       te.source,
       te.event_type,
       te.description,
       te.actor,
       te.file_id,
       te.artifact_object_id,
       sf.name AS file_name,
       sf.absolute_path AS file_path,
       ao.parser AS object_parser,
       ao.kind AS object_kind,
       ao.text AS object_text,
       json_extract(ao.json, '$.source.path') AS object_source_path
     FROM timeline_events te
     LEFT JOIN system_files sf
       ON sf.id = te.file_id
      AND sf.evidence_id = te.evidence_id
      AND sf.partition_id = te.partition_id
     LEFT JOIN artifact_objects ao
       ON ao.id = te.artifact_object_id
      AND ao.evidence_id = te.evidence_id
      AND ao.partition_id = te.partition_id
     WHERE te.id = $1
       AND te.evidence_id = $2
       AND te.partition_id = $3
     LIMIT 1`,
    [timelineEventId, evidenceId, partitionId],
  );
  const row = rows?.[0];
  const timestampMs = row ? finiteNumber(row.ts) : null;
  if (!row || timestampMs == null) return null;

  return {
    id: Number(row.id),
    timestampMs,
    source: row.source,
    eventType: row.event_type,
    description: row.description,
    actor: row.actor,
    fileId: nullableId(row.file_id),
    artifactObjectId: nullableId(row.artifact_object_id),
    fileName: row.file_name,
    filePath: row.file_path,
    objectParser: row.object_parser,
    objectKind: row.object_kind,
    objectText: row.object_text,
    objectSourcePath: row.object_source_path,
  };
}

/**
 * Return at most two valid device observations: the closest at-or-before and
 * the closest at-or-after the UTC cursor, restricted to the requested window.
 * Duplicate timestamps prefer the observation with the best declared
 * horizontal accuracy and then the lowest stable object id. No interpolation
 * is performed here or by the presentation component.
 */
export async function getCorrelationLocationObservations(
  evidenceId: number,
  partitionId: number,
  cursorMs: number,
  correlationWindowMs: number,
): Promise<CorrelationLocationObservation[]> {
  if (
    !Number.isInteger(evidenceId) ||
    evidenceId <= 0 ||
    !Number.isInteger(partitionId) ||
    partitionId <= 0 ||
    !Number.isFinite(cursorMs)
  ) {
    return [];
  }

  const cursor = Math.trunc(cursorMs);
  const windowMs = Number.isFinite(correlationWindowMs)
    ? Math.max(1_000, Math.min(24 * 60 * 60 * 1_000, Math.trunc(correlationWindowMs)))
    : 5 * 60 * 1_000;
  const startMs = cursor - windowMs;
  const endMs = cursor + windowMs;
  const db = await getEvidenceDb(evidenceId);

  const rows = await db.select<RawLocationObservation[]>(
    `WITH valid_location AS (
       SELECT
         ao.id,
         te.ts,
         CAST(json_extract(ao.json, '$.location.latitude') AS REAL) AS latitude,
         CAST(json_extract(ao.json, '$.location.longitude') AS REAL) AS longitude,
         CASE
           WHEN typeof(json_extract(ao.json, '$.location.altitude'))
                  IN ('integer', 'real')
           THEN CAST(json_extract(ao.json, '$.location.altitude') AS REAL)
           ELSE NULL
         END AS altitude,
         CASE
           WHEN typeof(json_extract(ao.json, '$.location.horizontal_accuracy'))
                  IN ('integer', 'real')
           THEN CAST(json_extract(ao.json, '$.location.horizontal_accuracy') AS REAL)
           ELSE NULL
         END AS horizontal_accuracy,
         ao.parser,
         ao.kind,
         json_extract(ao.json, '$.source.path') AS source_path
       FROM timeline_events te
       JOIN artifact_objects ao
         ON ao.id = te.artifact_object_id
        AND ao.evidence_id = te.evidence_id
        AND ao.partition_id = te.partition_id
       WHERE te.evidence_id = $1
         AND te.partition_id = $2
         AND te.event_type = 'mobile.location.fix'
         AND te.ts BETWEEN $3 AND $4
         AND ao.parser = 'mobile_ios_routined'
         AND ao.kind = 'mobile.location.fix'
         AND typeof(json_extract(ao.json, '$.location.latitude'))
               IN ('integer', 'real')
         AND typeof(json_extract(ao.json, '$.location.longitude'))
               IN ('integer', 'real')
         AND CAST(json_extract(ao.json, '$.location.latitude') AS REAL)
               BETWEEN -90.0 AND 90.0
         AND CAST(json_extract(ao.json, '$.location.longitude') AS REAL)
               BETWEEN -180.0 AND 180.0
         AND (
           json_extract(ao.json, '$.location.valid') IS NULL
           OR CAST(json_extract(ao.json, '$.location.valid') AS INTEGER) <> 0
         )
         AND (
           json_extract(ao.json, '$.location.horizontal_accuracy') IS NULL
           OR (
             typeof(json_extract(ao.json, '$.location.horizontal_accuracy'))
                   IN ('integer', 'real')
             AND CAST(json_extract(ao.json, '$.location.horizontal_accuracy') AS REAL) >= 0.0
           )
         )
     )
     SELECT * FROM (
       SELECT
         id, ts, latitude, longitude, altitude, horizontal_accuracy,
         parser, kind, source_path, 'before' AS relation
       FROM valid_location
       WHERE ts <= $5
       ORDER BY
         ts DESC,
         horizontal_accuracy IS NULL ASC,
         horizontal_accuracy ASC,
         id ASC
       LIMIT 1
     )
     UNION ALL
     SELECT * FROM (
       SELECT
         id, ts, latitude, longitude, altitude, horizontal_accuracy,
         parser, kind, source_path, 'after' AS relation
       FROM valid_location
       WHERE ts >= $5
       ORDER BY
         ts ASC,
         horizontal_accuracy IS NULL ASC,
         horizontal_accuracy ASC,
         id ASC
       LIMIT 1
     )`,
    [evidenceId, partitionId, startMs, endMs, cursor],
  );

  return (rows ?? []).flatMap((row) => {
    const timestampMs = finiteNumber(row.ts);
    const latitude = finiteNumber(row.latitude);
    const longitude = finiteNumber(row.longitude);
    if (timestampMs == null || latitude == null || longitude == null) return [];
    return [
      {
        id: Number(row.id),
        timestampMs,
        latitude,
        longitude,
        altitudeMeters: finiteNumber(row.altitude),
        horizontalAccuracyMeters: finiteNumber(row.horizontal_accuracy),
        parser: row.parser,
        kind: row.kind,
        sourcePath: row.source_path,
        relation: row.relation,
      },
    ];
  });
}
