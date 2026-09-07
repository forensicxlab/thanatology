import { getEvidenceDb } from "./db";
import {
  msTimeMatchExpr,
  resolveInvestigationTimeScope,
  type InvestigationTimeScope,
} from "./sqlite";

export const INSTALLED_APPLICATION_PARSERS = [
  "mobile_ios_app_manifest",
  "mobile_ios_app_container",
  "mobile_ios_frontboard",
  "mobile_ios_iconstate",
  "mobile_ios_mobileinstallation_log",
  "macos_app_bundle",
  "macos_install_history",
  "macos_package_receipt",
  "macos_container_registration",
] as const;

export type InstalledApplicationSortField =
  | "display_name"
  | "bundle_id"
  | "version"
  | "platform"
  | "object_kind"
  | "parser"
  | "install_type"
  | "state"
  | "application_path"
  | "source_path"
  | "is_present"
  | "observation_count"
  | "id";

export type InstalledApplicationObservationSortField =
  | Exclude<
      InstalledApplicationSortField,
      "is_present" | "observation_count"
    >
  | "timestamp_ms"
  | "time_basis"
  | "event_type"
  | "subject_type";

export interface InstalledApplicationQuery {
  evidenceId: number;
  partitionId: number;
  offset: number;
  limit: number;
  search?: string;
  platform?: string;
  objectKind?: string;
  parser?: string;
  installType?: string;
  state?: string;
  sortField?: InstalledApplicationSortField;
  sortDirection?: "asc" | "desc";
  /** Reuse a filtered count while only page or sort changes. */
  knownRowCount?: number;
}

export interface InstalledApplicationObservationQuery {
  evidenceId: number;
  partitionId: number;
  offset: number;
  limit: number;
  search?: string;
  platform?: string;
  objectKind?: string;
  parser?: string;
  eventType?: string;
  subjectType?: string;
  sortField?: InstalledApplicationObservationSortField;
  sortDirection?: "asc" | "desc";
  knownRowCount?: number;
}

export interface InstalledApplicationRow {
  id: number;
  artifact_id: number;
  file_id: number | null;
  fs_identifier: number | null;
  file_size: number | null;
  file_path: string | null;
  source_path: string | null;
  source_artifact_name: string | null;
  source_tag: string | null;
  platform: string;
  object_kind: string;
  parser: string;
  display_name: string | null;
  bundle_id: string | null;
  version: string | null;
  build_version: string | null;
  executable: string | null;
  team_id: string | null;
  install_type: string;
  state: string;
  application_path: string | null;
  timestamp_ms: number | null;
  timestamp_label: string | null;
  time_basis: string;
  event_type: string;
  subject_type: string;
  text: string | null;
  json: string;
  is_present: number;
  is_synthetic: number;
  observation_count: number;
  association_basis: string;
}

export type InstalledApplicationObservationRow = Omit<
  InstalledApplicationRow,
  "is_present" | "is_synthetic" | "observation_count" | "association_basis"
>;

export interface InstalledApplicationPage {
  rows: InstalledApplicationRow[];
  rowCount: number;
}

export interface InstalledApplicationObservationPage {
  rows: InstalledApplicationObservationRow[];
  rowCount: number;
}

export interface InstalledApplicationFacet {
  value: string;
  count: number;
}

export interface InstalledApplicationFacets {
  instances: number;
  presentInstances: number;
  syntheticEntries: number;
  distinctIdentifiers: number;
  observations: number;
  platforms: InstalledApplicationFacet[];
  objectKinds: InstalledApplicationFacet[];
  parsers: InstalledApplicationFacet[];
  installTypes: InstalledApplicationFacet[];
  states: InstalledApplicationFacet[];
  sourcePlatforms: InstalledApplicationFacet[];
  sourceObjectKinds: InstalledApplicationFacet[];
  sourceParsers: InstalledApplicationFacet[];
}

export interface InstalledApplicationEventFacets {
  observations: number;
  platforms: InstalledApplicationFacet[];
  parsers: InstalledApplicationFacet[];
  eventTypes: InstalledApplicationFacet[];
  subjectTypes: InstalledApplicationFacet[];
}

export interface InstalledApplicationFacetQuery {
  evidenceId: number;
  partitionId: number;
  search?: string;
}

type QueryParams = Array<string | number>;
type EvidenceDb = Awaited<ReturnType<typeof getEvidenceDb>>;

function parserKindPredicate(alias: string, mode: "all" | "events" | "present") {
  if (mode === "present") {
    return `(
      (${alias}.parser = 'mobile_ios_app_manifest' AND ${alias}.object_kind = 'mobile.application.installed')
      OR (${alias}.parser = 'macos_app_bundle' AND ${alias}.object_kind = 'macos.application.bundle')
    )`;
  }
  if (mode === "events") {
    return `(
      (${alias}.parser = 'mobile_ios_mobileinstallation_log' AND ${alias}.object_kind = 'mobile.application.install_event')
      OR (${alias}.parser = 'macos_install_history' AND ${alias}.object_kind = 'macos.software.install_event')
      OR (${alias}.parser = 'macos_package_receipt' AND ${alias}.object_kind = 'macos.application.package_receipt')
    )`;
  }
  return `(
    (${alias}.parser = 'mobile_ios_app_manifest' AND ${alias}.kind = 'mobile.application.installed')
    OR (${alias}.parser = 'mobile_ios_app_container' AND ${alias}.kind = 'mobile.application.container')
    OR (${alias}.parser = 'mobile_ios_frontboard' AND ${alias}.kind = 'mobile.application.frontboard_state')
    OR (${alias}.parser = 'mobile_ios_iconstate' AND ${alias}.kind = 'mobile.application.home_screen_item')
    OR (${alias}.parser = 'mobile_ios_mobileinstallation_log' AND ${alias}.kind = 'mobile.application.install_event')
    OR (${alias}.parser = 'macos_app_bundle' AND ${alias}.kind = 'macos.application.bundle')
    OR (${alias}.parser = 'macos_install_history' AND ${alias}.kind = 'macos.software.install_event')
    OR (${alias}.parser = 'macos_package_receipt' AND ${alias}.kind = 'macos.application.package_receipt')
    OR (${alias}.parser = 'macos_container_registration' AND ${alias}.kind = 'macos.application.container_registration')
  )`;
}

const PLATFORM_EXPR = `CASE
  WHEN ao.parser LIKE 'mobile_ios_%' THEN 'iOS'
  WHEN ao.parser LIKE 'macos_%' THEN 'macOS'
  ELSE 'Unknown'
END`;

const SOURCE_PATH_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.source.path'), ''),
  sf.absolute_path
)`;

const DISPLAY_NAME_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.display.name'), ''),
  NULLIF(json_extract(ao.json, '$.display.bundle_name'), ''),
  NULLIF(json_extract(ao.json, '$.application.display_name'), ''),
  NULLIF(json_extract(ao.json, '$.application.bundle_name'), ''),
  NULLIF(json_extract(ao.json, '$.installation.display_name'), ''),
  NULLIF(json_extract(ao.json, '$.event.display_name'), ''),
  NULLIF(json_extract(ao.json, '$.item.display_name'), ''),
  NULLIF(json_extract(ao.json, '$.item.name'), ''),
  NULLIF(json_extract(ao.json, '$.display_name'), ''),
  NULLIF(json_extract(ao.json, '$.name'), '')
)`;

const BUNDLE_ID_EXPR = `CASE
  WHEN ao.parser = 'mobile_ios_app_container'
    AND json_extract(ao.json, '$.container.role') = 'app_group'
  THEN NULL
  ELSE COALESCE(
  NULLIF(json_extract(ao.json, '$.identity.bundle_id'), ''),
  NULLIF(json_extract(ao.json, '$.identity.identifier'), ''),
  NULLIF(json_extract(ao.json, '$.identity.package_ids[0]'), ''),
  NULLIF(json_extract(ao.json, '$.package.identifier'), ''),
  NULLIF(json_extract(ao.json, '$.event.bundle_id'), ''),
  NULLIF(json_extract(ao.json, '$.item.bundle_id'), ''),
  NULLIF(json_extract(ao.json, '$.bundle_id'), ''),
  NULLIF(json_extract(ao.json, '$.bundle_identifier'), ''),
  NULLIF(json_extract(ao.json, '$.package_id'), '')
  )
END`;

const VERSION_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.version.short'), ''),
  NULLIF(json_extract(ao.json, '$.application.version.short'), ''),
  NULLIF(json_extract(ao.json, '$.installation.display_version'), ''),
  NULLIF(json_extract(ao.json, '$.package.version'), ''),
  NULLIF(json_extract(ao.json, '$.event.version'), ''),
  NULLIF(json_extract(ao.json, '$.event.short_version'), ''),
  CASE
    WHEN json_type(ao.json, '$.version') = 'text'
    THEN NULLIF(json_extract(ao.json, '$.version'), '')
  END
)`;

const BUILD_VERSION_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.version.build'), ''),
  NULLIF(json_extract(ao.json, '$.application.version.build'), ''),
  NULLIF(json_extract(ao.json, '$.build_version'), ''),
  NULLIF(json_extract(ao.json, '$.build'), '')
)`;

const EXECUTABLE_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.paths.executable'), ''),
  NULLIF(json_extract(ao.json, '$.application.executable'), ''),
  NULLIF(json_extract(ao.json, '$.executable'), '')
)`;

const TEAM_ID_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.identity.team_id'), ''),
  NULLIF(json_extract(ao.json, '$.signing.team_id'), ''),
  NULLIF(json_extract(ao.json, '$.team_id'), '')
)`;

const INSTALL_TYPE_RAW_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.classification.installation_domain'), ''),
  NULLIF(json_extract(ao.json, '$.placement.kind'), ''),
  NULLIF(json_extract(ao.json, '$.placement.role'), ''),
  NULLIF(json_extract(ao.json, '$.container.role'), ''),
  NULLIF(json_extract(ao.json, '$.installation.method'), ''),
  NULLIF(json_extract(ao.json, '$.installation.scope'), ''),
  NULLIF(json_extract(ao.json, '$.event.install_type'), ''),
  NULLIF(json_extract(ao.json, '$.install_type'), '')
)`;
const INSTALL_TYPE_EXPR = `COALESCE(${INSTALL_TYPE_RAW_EXPR}, '(unknown)')`;

const STATE_RAW_EXPR = `COALESCE(
  CASE WHEN json_extract(ao.json, '$.presence.present') = 1 THEN 'present' END,
  CASE WHEN json_extract(ao.json, '$.presence.frontboard_registered') = 1 THEN 'registered' END,
  CASE
    WHEN json_extract(ao.json, '$.event.success') = 1 THEN 'success'
    WHEN json_extract(ao.json, '$.event.success') = 0 THEN 'failed'
  END,
  NULLIF(json_extract(ao.json, '$.assertion.state'), ''),
  NULLIF(json_extract(ao.json, '$.event.state'), ''),
  NULLIF(json_extract(ao.json, '$.event.status'), ''),
  NULLIF(json_extract(ao.json, '$.state.status'), ''),
  CASE
    WHEN json_type(ao.json, '$.state') = 'text'
    THEN NULLIF(json_extract(ao.json, '$.state'), '')
  END
)`;
const STATE_EXPR = `COALESCE(${STATE_RAW_EXPR}, '(unknown)')`;

const APPLICATION_PATH_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.paths.bundle'), ''),
  NULLIF(json_extract(ao.json, '$.paths.data_container'), ''),
  NULLIF(json_extract(ao.json, '$.container.path'), ''),
  NULLIF(json_extract(ao.json, '$.placement.logical_container_path'), ''),
  NULLIF(json_extract(ao.json, '$.placement.container_path'), ''),
  NULLIF(json_extract(ao.json, '$.placement.logical_bundle_path'), ''),
  NULLIF(json_extract(ao.json, '$.placement.bundle_path'), ''),
  NULLIF(json_extract(ao.json, '$.installation.prefix'), ''),
  NULLIF(json_extract(ao.json, '$.event.path'), ''),
  NULLIF(json_extract(ao.json, '$.item.path'), ''),
  NULLIF(json_extract(ao.json, '$.path'), '')
)`;

function jsonIntegerExpr(path: string): string {
  return `CASE
    WHEN json_type(ao.json, '${path}') IN ('integer', 'real')
    THEN CAST(json_extract(ao.json, '${path}') AS INTEGER)
  END`;
}

const EVENT_TIMESTAMP_EXPR = `COALESCE(
  ${jsonIntegerExpr("$.timestamps.recorded.unix_ms")},
  ${jsonIntegerExpr("$.timestamps.installed.unix_ms")},
  ${jsonIntegerExpr("$.timestamps.event.unix_ms")},
  ${jsonIntegerExpr("$.timestamps.timestamp.unix_ms")},
  ${jsonIntegerExpr("$.event.timestamp.unix_ms")},
  ${jsonIntegerExpr("$.event.timestamp_ms")},
  ${jsonIntegerExpr("$.timestamp.unix_ms")},
  ${jsonIntegerExpr("$.timestamp_ms")}
)`;

const EVENT_TIMESTAMP_LABEL_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.timestamps.recorded.rfc3339'), ''),
  NULLIF(json_extract(ao.json, '$.timestamps.installed.rfc3339'), ''),
  NULLIF(json_extract(ao.json, '$.timestamps.event.rfc3339'), ''),
  NULLIF(json_extract(ao.json, '$.timestamps.event.local'), ''),
  NULLIF(json_extract(ao.json, '$.timestamps.event.original'), ''),
  NULLIF(json_extract(ao.json, '$.event.timestamp'), ''),
  NULLIF(json_extract(ao.json, '$.timestamp'), '')
)`;

const EVENT_TYPE_RAW_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.event.action'), ''),
  NULLIF(json_extract(ao.json, '$.event.event_type'), ''),
  NULLIF(json_extract(ao.json, '$.event.operation'), ''),
  NULLIF(json_extract(ao.json, '$.event.type'), ''),
  NULLIF(json_extract(ao.json, '$.action'), ''),
  NULLIF(json_extract(ao.json, '$.operation'), ''),
  CASE WHEN ao.parser = 'macos_package_receipt' THEN 'package_receipt' END,
  NULLIF(json_extract(ao.json, '$.record_type'), '')
)`;
const EVENT_TYPE_EXPR = `COALESCE(${EVENT_TYPE_RAW_EXPR}, '(unknown)')`;

const SUBJECT_TYPE_RAW_EXPR = `COALESCE(
  NULLIF(json_extract(ao.json, '$.event.subject_type'), ''),
  NULLIF(json_extract(ao.json, '$.subject_type'), ''),
  CASE WHEN ao.parser = 'macos_package_receipt' THEN 'package' END,
  NULLIF(json_extract(ao.json, '$.event.subject'), ''),
  NULLIF(json_extract(ao.json, '$.subject'), '')
)`;
const SUBJECT_TYPE_EXPR = `COALESCE(${SUBJECT_TYPE_RAW_EXPR}, '(unknown)')`;

const NORMALIZED_CTE = `normalized AS MATERIALIZED (
  SELECT
    ao.id AS id,
    ao.artifact_id AS artifact_id,
    ao.file_id AS file_id,
    sf.identifier AS fs_identifier,
    sf.size AS file_size,
    sf.absolute_path AS file_path,
    ${SOURCE_PATH_EXPR} AS source_path,
    a.name AS source_artifact_name,
    a.tag AS source_tag,
    ${PLATFORM_EXPR} AS platform,
    ao.kind AS object_kind,
    ao.parser AS parser,
    ${DISPLAY_NAME_EXPR} AS display_name,
    ${BUNDLE_ID_EXPR} AS bundle_id,
    ${VERSION_EXPR} AS version,
    ${BUILD_VERSION_EXPR} AS build_version,
    ${EXECUTABLE_EXPR} AS executable,
    ${TEAM_ID_EXPR} AS team_id,
    ${INSTALL_TYPE_EXPR} AS install_type,
    ${STATE_EXPR} AS state,
    ${APPLICATION_PATH_EXPR} AS application_path,
    ${EVENT_TIMESTAMP_EXPR} AS timestamp_ms,
    ${EVENT_TIMESTAMP_LABEL_EXPR} AS timestamp_label,
    CASE
      WHEN ${EVENT_TIMESTAMP_EXPR} IS NOT NULL THEN 'UTC resolved'
      WHEN ao.parser = 'mobile_ios_mobileinstallation_log' THEN 'Device-local; timezone unresolved'
      ELSE 'No resolved timestamp'
    END AS time_basis,
    ${EVENT_TYPE_EXPR} AS event_type,
    ${SUBJECT_TYPE_EXPR} AS subject_type,
    ao.text AS text,
    ao.json AS json
  FROM artifact_objects ao
  LEFT JOIN artifacts a
    ON a.id = ao.artifact_id
   AND a.evidence_id = ao.evidence_id
   AND a.partition_id = ao.partition_id
  LEFT JOIN system_files sf
    ON sf.id = ao.file_id
   AND sf.evidence_id = ao.evidence_id
   AND sf.partition_id = ao.partition_id
  WHERE ao.evidence_id = $1
    AND ao.partition_id = $2
    AND ${parserKindPredicate("ao", "all")}
)`;

const INVENTORY_CTE = `WITH
${NORMALIZED_CTE},
identifier_counts AS (
  SELECT platform, bundle_id, COUNT(*) AS observation_count
  FROM normalized
  WHERE bundle_id IS NOT NULL AND bundle_id <> ''
  GROUP BY platform, bundle_id
),
present_records AS (
  SELECT
    n.*,
    1 AS is_present,
    0 AS is_synthetic,
    COALESCE(c.observation_count, 1) AS observation_count,
    CASE
      WHEN n.bundle_id IS NULL THEN 'Source observation only'
      ELSE 'Exact identifier text only'
    END AS association_basis
  FROM normalized n
  LEFT JOIN identifier_counts c
    ON c.platform = n.platform AND c.bundle_id = n.bundle_id
  WHERE ${parserKindPredicate("n", "present")}
),
fallback_groups AS (
  SELECT n.platform, n.bundle_id, MAX(n.id) AS representative_id,
         COUNT(*) AS observation_count
  FROM normalized n
  WHERE n.bundle_id IS NOT NULL AND n.bundle_id <> ''
    AND NOT EXISTS (
      SELECT 1 FROM present_records p
      WHERE p.platform = n.platform AND p.bundle_id = n.bundle_id
    )
    AND (
      n.platform <> 'macOS'
      OR EXISTS (
        SELECT 1 FROM normalized corroborator
        WHERE corroborator.platform = n.platform
          AND corroborator.bundle_id = n.bundle_id
          AND (
            (corroborator.parser = 'macos_install_history'
              AND corroborator.subject_type = 'application')
            OR corroborator.parser = 'macos_container_registration'
          )
      )
    )
  GROUP BY n.platform, n.bundle_id
),
fallback_records AS (
  SELECT
    n.*,
    0 AS is_present,
    1 AS is_synthetic,
    g.observation_count AS observation_count,
    'Exact identifier text only; no present bundle observed' AS association_basis
  FROM fallback_groups g
  INNER JOIN normalized n ON n.id = g.representative_id
),
inventory AS MATERIALIZED (
  SELECT * FROM present_records
  UNION ALL
  SELECT * FROM fallback_records
)`;

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function addExactFilter(
  clauses: string[],
  params: QueryParams,
  field: string,
  value?: string,
): void {
  if (!value) return;
  params.push(value);
  clauses.push(`${field} = $${params.length}`);
}

function addNormalizedSearch(
  clauses: string[],
  params: QueryParams,
  searchValue: string | undefined,
  alias: string,
): void {
  const search = searchValue?.trim().toLocaleLowerCase();
  if (!search) return;
  params.push(`%${escapeSqlLike(search)}%`);
  const placeholder = `$${params.length}`;
  const fields = [
    "display_name",
    "bundle_id",
    "version",
    "application_path",
    "source_path",
    "parser",
    "object_kind",
    "text",
    "event_type",
    "subject_type",
  ];
  clauses.push(`(${fields
    .map(
      (field) =>
        `LOWER(COALESCE(CAST(${alias}.${field} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'`,
    )
    .join(" OR ")})`);
}

function inventoryWhere(query: InstalledApplicationQuery | InstalledApplicationFacetQuery) {
  const params: QueryParams = [query.evidenceId, query.partitionId];
  const clauses = ["1"];
  addNormalizedSearch(clauses, params, query.search, "i");
  if ("platform" in query) {
    addExactFilter(clauses, params, "i.platform", query.platform);
    addExactFilter(clauses, params, "i.object_kind", query.objectKind);
    addExactFilter(clauses, params, "i.parser", query.parser);
    addExactFilter(clauses, params, "i.install_type", query.installType);
    addExactFilter(clauses, params, "i.state", query.state);
  }
  return { where: clauses.join(" AND "), params };
}

function observationWhere(
  query: InstalledApplicationObservationQuery | InstalledApplicationFacetQuery,
  mode: "all" | "events",
  timeScope?: InvestigationTimeScope,
) {
  const params: QueryParams = [query.evidenceId, query.partitionId];
  const clauses = [mode === "events" ? parserKindPredicate("n", "events") : "1"];
  addNormalizedSearch(clauses, params, query.search, "n");
  if ("platform" in query) {
    addExactFilter(clauses, params, "n.platform", query.platform);
    addExactFilter(clauses, params, "n.object_kind", query.objectKind);
    addExactFilter(clauses, params, "n.parser", query.parser);
    addExactFilter(clauses, params, "n.event_type", query.eventType);
    addExactFilter(clauses, params, "n.subject_type", query.subjectType);
  }
  if (mode === "events") {
    // InstallHistory also contains OS/configuration records. They remain in
    // raw Observations and the global timeline, but are not application events.
    clauses.push(`(
      n.parser <> 'macos_install_history'
      OR n.subject_type IN ('application', 'package')
    )`);
    const scope = resolveInvestigationTimeScope(
      query.evidenceId,
      query.partitionId,
      timeScope,
    );
    const timeMatch = msTimeMatchExpr(["n.timestamp_ms"], params, scope);
    if (timeMatch !== "1") {
      clauses.push(`(
        (n.parser = 'mobile_ios_mobileinstallation_log' AND n.timestamp_ms IS NULL)
        OR ${timeMatch}
      )`);
    }
  }
  return { where: clauses.join(" AND "), params };
}

function boundedLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(250, Math.trunc(value))) : 50;
}

function boundedOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function validKnownCount(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const INVENTORY_SORT_FIELDS: Record<InstalledApplicationSortField, string> = {
  display_name: "i.display_name COLLATE NOCASE",
  bundle_id: "i.bundle_id COLLATE NOCASE",
  version: "i.version COLLATE NOCASE",
  platform: "i.platform COLLATE NOCASE",
  object_kind: "i.object_kind COLLATE NOCASE",
  parser: "i.parser COLLATE NOCASE",
  install_type: "i.install_type COLLATE NOCASE",
  state: "i.state COLLATE NOCASE",
  application_path: "i.application_path COLLATE NOCASE",
  source_path: "i.source_path COLLATE NOCASE",
  is_present: "i.is_present",
  observation_count: "i.observation_count",
  id: "i.id",
};

const OBSERVATION_SORT_FIELDS: Record<InstalledApplicationObservationSortField, string> = {
  display_name: "n.display_name COLLATE NOCASE",
  bundle_id: "n.bundle_id COLLATE NOCASE",
  version: "n.version COLLATE NOCASE",
  platform: "n.platform COLLATE NOCASE",
  object_kind: "n.object_kind COLLATE NOCASE",
  parser: "n.parser COLLATE NOCASE",
  install_type: "n.install_type COLLATE NOCASE",
  state: "n.state COLLATE NOCASE",
  application_path: "n.application_path COLLATE NOCASE",
  source_path: "n.source_path COLLATE NOCASE",
  timestamp_ms: "n.timestamp_ms",
  time_basis: "n.time_basis COLLATE NOCASE",
  event_type: "n.event_type COLLATE NOCASE",
  subject_type: "n.subject_type COLLATE NOCASE",
  id: "n.id",
};

async function countFrom(
  db: EvidenceDb,
  cte: string,
  tableAlias: string,
  where: string,
  params: QueryParams,
): Promise<number> {
  const rows = await db.select<Array<{ count: number | string }>>(
    `${cte} SELECT COUNT(*) AS count FROM ${tableAlias} WHERE ${where}`,
    params,
  );
  return Number(rows?.[0]?.count ?? 0);
}

function normalizeBaseRow<T extends InstalledApplicationObservationRow>(row: T): T {
  return {
    ...row,
    id: Number(row.id),
    artifact_id: Number(row.artifact_id),
    file_id: row.file_id == null ? null : Number(row.file_id),
    fs_identifier: row.fs_identifier == null ? null : Number(row.fs_identifier),
    file_size: row.file_size == null ? null : Number(row.file_size),
    timestamp_ms: row.timestamp_ms == null ? null : Number(row.timestamp_ms),
  };
}

/** Default inventory: one row per present bundle path plus evidence-only fallbacks. */
export async function getInstalledApplicationsPage(
  query: InstalledApplicationQuery,
): Promise<InstalledApplicationPage> {
  const db = await getEvidenceDb(query.evidenceId);
  const built = inventoryWhere(query);
  const limit = boundedLimit(query.limit);
  const offset = boundedOffset(query.offset);
  const direction = query.sortDirection === "desc" ? "DESC" : "ASC";
  const sort =
    INVENTORY_SORT_FIELDS[query.sortField ?? "display_name"] ??
    INVENTORY_SORT_FIELDS.display_name;
  const rowCount =
    validKnownCount(query.knownRowCount) ??
    (await countFrom(db, INVENTORY_CTE, "inventory i", built.where, built.params));
  const rows = await db.select<InstalledApplicationRow[]>(
    `${INVENTORY_CTE}
     SELECT i.* FROM inventory i
     WHERE ${built.where}
     ORDER BY ${sort} ${direction}, i.id ${direction}
     LIMIT $${built.params.length + 1} OFFSET $${built.params.length + 2}`,
    [...built.params, limit, offset],
  );
  return {
    rows: (rows ?? []).map((row) => ({
      ...normalizeBaseRow(row),
      is_present: Number(row.is_present),
      is_synthetic: Number(row.is_synthetic),
      observation_count: Number(row.observation_count),
    })),
    rowCount: Number(rowCount),
  };
}

async function observationsPage(
  query: InstalledApplicationObservationQuery,
  mode: "all" | "events",
  timeScope?: InvestigationTimeScope,
): Promise<InstalledApplicationObservationPage> {
  const db = await getEvidenceDb(query.evidenceId);
  const built = observationWhere(query, mode, timeScope);
  const limit = boundedLimit(query.limit);
  const offset = boundedOffset(query.offset);
  const defaultSort: InstalledApplicationObservationSortField =
    mode === "events" ? "timestamp_ms" : "display_name";
  const direction =
    query.sortDirection === "asc" || (query.sortDirection == null && mode === "all")
      ? "ASC"
      : "DESC";
  const sort =
    OBSERVATION_SORT_FIELDS[query.sortField ?? defaultSort] ??
    OBSERVATION_SORT_FIELDS[defaultSort];
  const cte = `WITH ${NORMALIZED_CTE}`;
  const rowCount =
    validKnownCount(query.knownRowCount) ??
    (await countFrom(db, cte, "normalized n", built.where, built.params));
  const rows = await db.select<InstalledApplicationObservationRow[]>(
    `${cte}
     SELECT n.* FROM normalized n
     WHERE ${built.where}
     ORDER BY ${sort} ${direction}, n.id ${direction}
     LIMIT $${built.params.length + 1} OFFSET $${built.params.length + 2}`,
    [...built.params, limit, offset],
  );
  return { rows: (rows ?? []).map(normalizeBaseRow), rowCount: Number(rowCount) };
}

/** Every application source object, without correlation or deduplication. */
export async function getInstalledApplicationObservationsPage(
  query: InstalledApplicationObservationQuery,
): Promise<InstalledApplicationObservationPage> {
  return observationsPage(query, "all");
}

/** Intrinsic installation evidence; unresolved device-local iOS rows stay visible. */
export async function getInstalledApplicationEventsPage(
  query: InstalledApplicationObservationQuery,
  timeScope?: InvestigationTimeScope,
): Promise<InstalledApplicationObservationPage> {
  return observationsPage(query, "events", timeScope);
}

/** Exact identifier-text corroboration for a selected inventory entry. */
export async function getInstalledApplicationCorroboration(
  evidenceId: number,
  partitionId: number,
  row: Pick<InstalledApplicationRow, "id" | "platform" | "bundle_id">,
  limit = 100,
): Promise<InstalledApplicationObservationPage> {
  const db = await getEvidenceDb(evidenceId);
  const params: QueryParams = [evidenceId, partitionId];
  let where: string;
  if (row.bundle_id) {
    params.push(row.platform, row.bundle_id);
    where = `n.platform = $3 AND n.bundle_id = $4`;
  } else {
    params.push(row.id);
    where = `n.id = $3`;
  }
  const cte = `WITH ${NORMALIZED_CTE}`;
  const rowCount = await countFrom(db, cte, "normalized n", where, params);
  const safeLimit = boundedLimit(limit);
  const rows = await db.select<InstalledApplicationObservationRow[]>(
    `${cte}
     SELECT n.* FROM normalized n
     WHERE ${where}
     ORDER BY n.timestamp_ms DESC, n.id DESC
     LIMIT $${params.length + 1}`,
    [...params, safeLimit],
  );
  return { rows: (rows ?? []).map(normalizeBaseRow), rowCount };
}

interface CombinedFacetRow {
  facet_group: string;
  value: string | null;
  count: number | string | null;
  facet_rank: number | string;
  instances: number | string | null;
  present_instances: number | string | null;
  synthetic_entries: number | string | null;
  distinct_identifiers: number | string | null;
  observations: number | string | null;
}

function facetsFromRows(
  rows: CombinedFacetRow[],
  group: string,
): InstalledApplicationFacet[] {
  return rows
    .filter((row) => row.facet_group === group)
    .map((row) => ({
      value: String(row.value ?? "(unknown)"),
      count: Number(row.count ?? 0),
    }));
}

export async function getInstalledApplicationsFacets(
  query: InstalledApplicationFacetQuery,
): Promise<InstalledApplicationFacets> {
  const db = await getEvidenceDb(query.evidenceId);
  const inventory = inventoryWhere(query);
  const observations = observationWhere(query, "all");
  // Facet queries are derived from the same evidence/partition/search tuple, so
  // both predicates intentionally share the same positional parameters. Keeping
  // them in one statement prevents a view mount from occupying ten pool slots.
  const rows = await db.select<CombinedFacetRow[]>(
    `${INVENTORY_CTE},
     facet_values AS MATERIALIZED (
       SELECT 'platforms' AS facet_group, i.platform AS value
       FROM inventory i WHERE ${inventory.where}
       UNION ALL
       SELECT 'objectKinds', i.object_kind
       FROM inventory i WHERE ${inventory.where}
       UNION ALL
       SELECT 'parsers', i.parser
       FROM inventory i WHERE ${inventory.where}
       UNION ALL
       SELECT 'installTypes', i.install_type
       FROM inventory i WHERE ${inventory.where}
       UNION ALL
       SELECT 'states', i.state
       FROM inventory i WHERE ${inventory.where}
       UNION ALL
       SELECT 'sourcePlatforms', n.platform
       FROM normalized n WHERE ${observations.where}
       UNION ALL
       SELECT 'sourceObjectKinds', n.object_kind
       FROM normalized n WHERE ${observations.where}
       UNION ALL
       SELECT 'sourceParsers', n.parser
       FROM normalized n WHERE ${observations.where}
     ),
     facet_counts AS (
       SELECT facet_group, value, COUNT(*) AS count
       FROM facet_values
       GROUP BY facet_group, value
     ),
     ranked_facets AS (
       SELECT
         facet_group,
         value,
         count,
         ROW_NUMBER() OVER (
           PARTITION BY facet_group
           ORDER BY count DESC, value COLLATE NOCASE ASC
         ) AS facet_rank
       FROM facet_counts
     ),
     inventory_summary AS (
       SELECT
         COUNT(*) AS instances,
         SUM(i.is_present) AS present_instances,
         SUM(i.is_synthetic) AS synthetic_entries,
         COUNT(DISTINCT NULLIF(i.bundle_id, '')) AS distinct_identifiers
       FROM inventory i WHERE ${inventory.where}
     ),
     observation_summary AS (
       SELECT COUNT(*) AS observations
       FROM normalized n WHERE ${observations.where}
     )
     SELECT
       'summary' AS facet_group,
       NULL AS value,
       NULL AS count,
       0 AS facet_rank,
       s.instances,
       s.present_instances,
       s.synthetic_entries,
       s.distinct_identifiers,
       o.observations
     FROM inventory_summary s
     CROSS JOIN observation_summary o
     UNION ALL
     SELECT
       r.facet_group,
       r.value,
       r.count,
       r.facet_rank,
       NULL,
       NULL,
       NULL,
       NULL,
       NULL
     FROM ranked_facets r
     WHERE
       (r.facet_group = 'platforms' AND r.facet_rank <= 10)
       OR (r.facet_group IN ('objectKinds', 'parsers', 'sourceObjectKinds', 'sourceParsers')
           AND r.facet_rank <= 50)
       OR (r.facet_group IN ('installTypes', 'states') AND r.facet_rank <= 100)
       OR (r.facet_group = 'sourcePlatforms' AND r.facet_rank <= 10)
     ORDER BY facet_group, facet_rank`,
    inventory.params,
  );
  const first = (rows ?? []).find((row) => row.facet_group === "summary");
  return {
    instances: Number(first?.instances ?? 0),
    presentInstances: Number(first?.present_instances ?? 0),
    syntheticEntries: Number(first?.synthetic_entries ?? 0),
    distinctIdentifiers: Number(first?.distinct_identifiers ?? 0),
    observations: Number(first?.observations ?? 0),
    platforms: facetsFromRows(rows ?? [], "platforms"),
    objectKinds: facetsFromRows(rows ?? [], "objectKinds"),
    parsers: facetsFromRows(rows ?? [], "parsers"),
    installTypes: facetsFromRows(rows ?? [], "installTypes"),
    states: facetsFromRows(rows ?? [], "states"),
    sourcePlatforms: facetsFromRows(rows ?? [], "sourcePlatforms"),
    sourceObjectKinds: facetsFromRows(rows ?? [], "sourceObjectKinds"),
    sourceParsers: facetsFromRows(rows ?? [], "sourceParsers"),
  };
}

export async function getInstalledApplicationEventFacets(
  query: InstalledApplicationFacetQuery,
  timeScope?: InvestigationTimeScope,
): Promise<InstalledApplicationEventFacets> {
  const db = await getEvidenceDb(query.evidenceId);
  const built = observationWhere(query, "events", timeScope);
  const rows = await db.select<CombinedFacetRow[]>(
    `WITH ${NORMALIZED_CTE},
     facet_values AS MATERIALIZED (
       SELECT 'platforms' AS facet_group, n.platform AS value
       FROM normalized n WHERE ${built.where}
       UNION ALL
       SELECT 'parsers', n.parser
       FROM normalized n WHERE ${built.where}
       UNION ALL
       SELECT 'eventTypes', n.event_type
       FROM normalized n WHERE ${built.where}
       UNION ALL
       SELECT 'subjectTypes', n.subject_type
       FROM normalized n WHERE ${built.where}
     ),
     facet_counts AS (
       SELECT facet_group, value, COUNT(*) AS count
       FROM facet_values
       GROUP BY facet_group, value
     ),
     ranked_facets AS (
       SELECT
         facet_group,
         value,
         count,
         ROW_NUMBER() OVER (
           PARTITION BY facet_group
           ORDER BY count DESC, value COLLATE NOCASE ASC
         ) AS facet_rank
       FROM facet_counts
     ),
     event_summary AS (
       SELECT COUNT(*) AS observations
       FROM normalized n WHERE ${built.where}
     )
     SELECT
       'summary' AS facet_group,
       NULL AS value,
       NULL AS count,
       0 AS facet_rank,
       NULL AS instances,
       NULL AS present_instances,
       NULL AS synthetic_entries,
       NULL AS distinct_identifiers,
       s.observations
     FROM event_summary s
     UNION ALL
     SELECT
       r.facet_group,
       r.value,
       r.count,
       r.facet_rank,
       NULL,
       NULL,
       NULL,
       NULL,
       NULL
     FROM ranked_facets r
     WHERE
       (r.facet_group = 'platforms' AND r.facet_rank <= 10)
       OR (r.facet_group = 'parsers' AND r.facet_rank <= 50)
       OR (r.facet_group IN ('eventTypes', 'subjectTypes') AND r.facet_rank <= 100)
     ORDER BY facet_group, facet_rank`,
    built.params,
  );
  const first = (rows ?? []).find((row) => row.facet_group === "summary");
  return {
    observations: Number(first?.observations ?? 0),
    platforms: facetsFromRows(rows ?? [], "platforms"),
    parsers: facetsFromRows(rows ?? [], "parsers"),
    eventTypes: facetsFromRows(rows ?? [], "eventTypes"),
    subjectTypes: facetsFromRows(rows ?? [], "subjectTypes"),
  };
}
