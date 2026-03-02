import Database from "@tauri-apps/plugin-sql";
import {
  MBRPartitionEntry,
  Module,
  Case,
  Evidence,
  ProcessedEvidenceMetadata,
  File,
  GPTPartitionEntry,
  LogicalPartitionEntry,
} from "./types";
import type { TimestampType, TimestampCount, ArtifactObjectRow } from "./types";
import { getEvidenceDb } from "./db";
// import { CLASS_FLEX_CENTER } from "yet-another-react-lightbox";

export async function createUser(username: string, db: Database | null) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Check if the username already exists
  const existingUsers: Array<any> = await db.select(
    "SELECT name FROM users WHERE name = $1",
    [username],
  );

  if (existingUsers.length > 0) {
    throw new Error(
      "The choose, username already exists, please try another one.",
    );
  }

  return await db.execute("INSERT INTO users (name) VALUES ($1)", [username]);
}

export async function fetchFiles(
  evidenceId: number,
  partition_id: number,
  offset: number,
  limit: number,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const rows: File[] = await db.select(
    "SELECT * FROM system_files WHERE partition_id = $1 LIMIT $2 OFFSET $3",
    [partition_id, limit, offset],
  );

  const countResult: Array<any> = await db.select(
    "SELECT COUNT(*) as count FROM system_files WHERE partition_id = $1",
    [partition_id],
  );
  const rowCount = countResult[0].count;

  return { rows, rowCount };
}

export async function getCases(db: Database | null) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  const cases: Array<any> = await db.select("SELECT * FROM cases");
  return cases;
}

export async function getEvidenceByCaseId(db: Database | null, caseId: number) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  const evidences: Array<any> = await db.select(
    "SELECT * FROM evidence WHERE case_id = ?",
    [caseId],
  );
  return evidences;
}

export async function getCaseWithEvidences(
  db: Database | null,
  caseId: string | undefined,
): Promise<{ case: Case; evidences: Evidence[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  if (!caseId) {
    throw new Error("Unknown case");
  }
  const caseData: Array<Case> = await db.select(
    "SELECT * FROM cases WHERE id = ?",
    [caseId],
  );
  if (caseData.length === 0) {
    throw new Error(`CASE-${caseId} not found`);
  }
  const evidences: Array<Evidence> = await db.select(
    "SELECT * FROM evidence WHERE case_id = ?",
    [caseId],
  );
  return { case: caseData[0], evidences };
}

export async function getEvidence(
  db: Database | null,
  evidenceId: string | undefined,
) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const evidenceData: Array<Evidence> = await db.select(
    "SELECT * FROM evidence WHERE id = ?",
    [evidenceId],
  );
  return evidenceData[0];
}

export async function deleteCase(
  caseId: number,
  db: Database | null,
): Promise<void> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Begin a transaction to ensure atomicity.
  await db.execute("BEGIN TRANSACTION");

  try {
    // Delete case collaborators associated with the case.
    await db.execute("DELETE FROM case_collaborators WHERE case_id = $1", [
      caseId,
    ]);

    // Delete any MBR partition entries associated with the evidence for this case.
    await db.execute(
      "DELETE FROM mbr_partition_entries WHERE evidence_id IN (SELECT id FROM evidence WHERE case_id = $1)",
      [caseId],
    );

    // Delete evidence records associated with the case.
    await db.execute("DELETE FROM evidence WHERE case_id = $1", [caseId]);

    // Finally, delete the case record itself.
    await db.execute("DELETE FROM cases WHERE id = $1", [caseId]);

    // Commit the transaction if all queries were successful.
    await db.execute("COMMIT");
  } catch (error) {
    // Roll back if any error occurs.
    await db.execute("ROLLBACK");
    throw error;
  }
}

export async function deleteCases(caseIds: number[]): Promise<void> {
  const db = await Database.load("sqlite:thanatology.db");

  // If there are no IDs provided, exit early.
  if (caseIds.length === 0) return;

  // Generate placeholders for parameterized queries ($1, $2, ..., $n).
  const placeholders = caseIds.map((_, index) => `$${index + 1}`).join(", ");

  // Begin transaction.
  await db.execute("BEGIN TRANSACTION");

  try {
    // Delete case collaborators associated with the cases.
    await db.execute(
      `DELETE FROM case_collaborators WHERE case_id IN (${placeholders})`,
      caseIds,
    );

    // Delete MBR partition entries associated with evidence for these cases.
    await db.execute(
      `DELETE FROM mbr_partition_entries
       WHERE evidence_id IN (
         SELECT id FROM evidence WHERE case_id IN (${placeholders})
       )`,
      caseIds,
    );

    // Delete evidence records associated with the cases.
    await db.execute(
      `DELETE FROM evidence WHERE case_id IN (${placeholders})`,
      caseIds,
    );

    // Finally, delete the cases themselves.
    await db.execute(
      `DELETE FROM cases WHERE id IN (${placeholders})`,
      caseIds,
    );

    // Commit the transaction if all queries were successful.
    await db.execute("COMMIT");
  } catch (error) {
    // Roll back the transaction if any error occurs.
    await db.execute("ROLLBACK");
    throw error;
  }
}

export async function savePreprocessingMetadata(
  metadata: ProcessedEvidenceMetadata,
  db: Database | null,
): Promise<number> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Ensure the evidence record in 'evidence' table has a valid 'id'
  if (!metadata.evidenceData.id) {
    throw new Error(
      "Evidence must have a valid ID to save preprocessing metadata.",
    );
  }

  // 1) Insert the main preprocessing record
  const insertMetadataQuery = `
    INSERT INTO evidence_preprocessing_metadata (evidence_id, disk_image_format)
    VALUES ($1, $2)
    RETURNING id
  `;
  const insertRes: Array<{ id: number }> = await db.select(
    insertMetadataQuery,
    [metadata.evidenceData.id, metadata.diskImageFormat],
  );
  if (!insertRes || insertRes.length === 0) {
    throw new Error("Failed to insert into evidence_preprocessing_metadata.");
  }
  const preprocessingId = insertRes[0].id;

  if (metadata.selectedMbrPartitions) {
    for (const partition of metadata.selectedMbrPartitions) {
      console.log(partition);
      await db.execute(
        `
        INSERT INTO mbr_partition_entries (
          evidence_id,
          partition_type,
          boot_indicator,
          start_chs,
          end_chs,
          start_lba,
          size_sectors,
          sector_size,
          first_byte_addr,
          description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
        [
          metadata.evidenceData.id,
          partition.partition_type,
          partition.boot_indicator,
          partition.start_chs,
          partition.end_chs,
          partition.start_lba,
          partition.size_sectors,
          partition.sector_size,
          partition.first_byte_addr,
          partition.description,
        ],
      );
    }
  }

  if (metadata.selectedGptPartitions) {
    for (const partition of metadata.selectedGptPartitions) {
      await db.execute(
        `
          INSERT INTO gpt_partition_entries (
            evidence_id,
            partition_guid,
            partition_type_guid,
            starting_lba,
            ending_lba,
            attributes,
            partition_name,
            description,
            first_byte_addr,
            size_sectors
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          metadata.evidenceData.id,
          partition.partition_guid_string,
          partition.partition_type_guid_string,
          partition.starting_lba,
          partition.ending_lba,
          partition.attributes,
          partition.partition_name,
          partition.description,
          partition.first_byte_addr,
          partition.size_sectors,
        ],
      );
    }
  }

  // 4) Update status
  await db.execute(
    `UPDATE evidence
           SET status = 1
         WHERE id = $1`,
    [metadata.evidenceData.id],
  );

  return preprocessingId;
}

// dbutils/sqlite.ts
export async function getSelectedPartitions(
  evidenceId: number,
  db: Database | null,
): Promise<{
  mbrRows: MBRPartitionEntry[];
  gptRows: GPTPartitionEntry[];
  logicalRows: LogicalPartitionEntry[];
}> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const mbrRows: MBRPartitionEntry[] = await db.select(
    "SELECT * FROM mbr_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  const gptRows: GPTPartitionEntry[] = await db.select(
    "SELECT * FROM gpt_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  const logicalRows: LogicalPartitionEntry[] = await db.select(
    "SELECT * FROM logical_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  return { mbrRows, gptRows, logicalRows };
}

export async function getPartitions(evidenceId: number): Promise<{
  mbrRows: MBRPartitionEntry[];
  gptRows: GPTPartitionEntry[];
  logicalRows: LogicalPartitionEntry[];
}> {
  const db = await getEvidenceDb(evidenceId);

  const mbrRows: MBRPartitionEntry[] = await db.select(
    "SELECT * FROM mbr_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  const gptRows: GPTPartitionEntry[] = await db.select(
    "SELECT * FROM gpt_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  const logicalRows: LogicalPartitionEntry[] = await db.select(
    "SELECT * FROM logical_partition_entries WHERE evidence_id = $1",
    [evidenceId],
  );

  return { mbrRows, gptRows, logicalRows };
}

// Fetch modules for processing.
// Here we assume that the parent module (with parent_id IS NULL and os='Linux')
// is executed first, followed by its children modules.
export async function getModulesForProcessing(
  db: Database | null,
): Promise<Module[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  // Fetch the parent (root) module
  const parentModules: Module[] = await db.select(
    "SELECT * FROM modules WHERE parent_id IS NULL AND os = 'Linux' LIMIT 1",
  );
  if (parentModules.length === 0) return [];
  // Fetch the children modules of that parent.
  const childModules: Module[] = await db.select(
    "SELECT * FROM modules WHERE parent_id = $1",
    [parentModules[0].id],
  );
  return [parentModules[0], ...childModules];
}

// Set the processing status to running (2)
export async function setProcessingInProgress(
  db: Database | null,
  metadata: ProcessedEvidenceMetadata,
) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  await db.execute(
    `UPDATE evidence
           SET status = 2
         WHERE id = $1`,
    [metadata.evidenceData.id],
  );
}

// Set the processing status to finish for an evidence
export async function setProcessingDone(
  db: Database | null,
  metadata: ProcessedEvidenceMetadata,
) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  await db.execute(
    `UPDATE evidence
           SET status = 3
         WHERE id = $1`,
    [metadata.evidenceData.id],
  );
}

export async function getEvidencesStatus(
  db: Database | null,
): Promise<Evidence[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  const evidences: Evidence[] = await db.select(
    "SELECT * FROM evidence WHERE status = 2",
  );
  return evidences;
}

/**
 * Fetches files for a given evidence and parent directory.
 *
 * @param db - The Database instance. If null, a new connection is established.
 * @param evidenceId - The ID of the evidence.
 * @param parentDirectory - The parent directory path.
 * @returns An array of File objects.
 */
export async function getFilesByEvidenceAndParent(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  parentDirectory: string,
): Promise<File[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const files: File[] = await db.select(
    `
     SELECT *
     FROM system_files
     WHERE evidence_id = $1 AND partition_id = $2 AND parent_directory = $3
     ORDER BY file_type DESC, filename ASC
     `,
    [evidenceId, partitionId, parentDirectory],
  );

  return files;
}

export async function getFileByEvidenceAndAbsolutePath(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  absolutePath: string,
): Promise<File | null> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const rows: File[] = await db.select(
    `
      SELECT *
      FROM system_files
      WHERE evidence_id = $1
        AND partition_id = $2
        AND absolute_path = $3
      LIMIT 1
    `,
    [evidenceId, partitionId, absolutePath],
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

export async function searchMedia(
  evidence_id: number,
  partition_id: number,
  offset: number,
  limit: number,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await getEvidenceDb(evidence_id);

  const rows: File[] = await db.select(
    "SELECT * FROM system_files WHERE partition_id = $1 AND ( (sig_mime LIKE 'image%') OR (sig_mime LIKE 'video%') OR (sig_mime LIKE 'audio%') ) LIMIT $2 OFFSET $3",
    [partition_id, limit, offset],
  );

  const countResult: Array<any> = await db.select(
    "SELECT COUNT(*) as count FROM system_files WHERE partition_id = $1 AND ( (sig_mime LIKE 'image%') OR (sig_mime LIKE 'video%') OR (sig_mime LIKE 'audio%') )",
    [partition_id],
  );
  const rowCount = countResult[0].count;

  return { rows, rowCount };
}

const ARTIFACT_FIELD_MAP: Record<string, string> = {
  artifact_name: "artifacts.name",
  description: "artifacts.description",
  parser: "artifacts.parser",
  tag: "artifacts.tag",
  category: "artifacts.category",
  identifier: "system_files.identifier",
  absolute_path: "system_files.absolute_path",
  file_name: "system_files.name",
  ftype: "system_files.ftype",
  size: "system_files.size",
  created: "system_files.created",
  modified: "system_files.modified",
  accessed: "system_files.accessed",
  permissions: "system_files.permissions",
  owner: "system_files.owner",
  group: `system_files."group"`,
  sig_name: "system_files.sig_name",
  sig_mime: "system_files.sig_mime",
  sig_exts: "system_files.sig_exts",
};

const ARTIFACT_QUICK_FILTER_COLUMNS: string[] = [
  "artifacts.name",
  "artifacts.description",
  "artifacts.parser",
  "artifacts.tag",
  "artifacts.category",
  "system_files.absolute_path",
  "system_files.name",
  "system_files.ftype",
  "system_files.permissions",
  "system_files.owner",
  `system_files."group"`,
  "system_files.sig_name",
  "system_files.sig_mime",
  "system_files.sig_exts",
  // numeric -> cast to text for LIKE
  "CAST(system_files.identifier AS TEXT)",
  "CAST(system_files.size AS TEXT)",
];

function isArtifactTextLikeField(field: string): boolean {
  return [
    "artifact_name",
    "description",
    "parser",
    "tag",
    "category",
    "absolute_path",
    "file_name",
    "ftype",
    "permissions",
    "owner",
    "group",
    "sig_name",
    "sig_mime",
    "sig_exts",
  ].includes(field);
}

function buildArtifactFiltersWithDollarPlaceholders(
  model: FilterModel | undefined,
  startIndex: number,
) {
  const items = model?.items ?? [];
  const logic = (model?.logicOperator ?? "and").toLowerCase() as LogicOperator;
  const qfValues = model?.quickFilterValues ?? [];
  const qfLogic = (
    model?.quickFilterLogicOperator ?? "and"
  ).toLowerCase() as LogicOperator;

  let p = startIndex;
  const params: any[] = [];
  const clauses: string[] = [];

  const itemClauses: string[] = [];
  for (const item of items) {
    const mapped = ARTIFACT_FIELD_MAP[item.field];
    if (!mapped) continue;

    const op = item.operator;
    const valRaw = item.value;

    const likeOp =
      op === "contains" ||
      op === "doesNotContain" ||
      op === "startsWith" ||
      op === "endsWith";

    const exprBase =
      likeOp && !isArtifactTextLikeField(item.field)
        ? `LOWER(CAST(${mapped} AS TEXT))`
        : likeOp
          ? `LOWER(${mapped})`
          : mapped;

    switch (op) {
      case "contains": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "doesNotContain": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        const expr =
          exprBase.startsWith("LOWER(") || exprBase.startsWith("COALESCE(")
            ? `COALESCE(${exprBase}, '')`
            : `COALESCE(LOWER(CAST(${mapped} AS TEXT)), '')`;
        itemClauses.push(`${expr} NOT LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "equals": {
        const ph = `$${++p}`;
        itemClauses.push(`${mapped} = ${ph}`);
        params.push(valRaw);
        break;
      }
      case "startsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "endsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}`);
        break;
      }
      case "isEmpty": {
        itemClauses.push(
          `(${mapped} IS NULL OR TRIM(CAST(${mapped} AS TEXT)) = '')`,
        );
        break;
      }
      case "isNotEmpty": {
        itemClauses.push(
          `(${mapped} IS NOT NULL AND TRIM(CAST(${mapped} AS TEXT)) <> '')`,
        );
        break;
      }
      default:
        break;
    }
  }

  if (itemClauses.length) {
    clauses.push(`(${itemClauses.join(` ${logic.toUpperCase()} `)})`);
  }

  if (qfValues.length) {
    const perValueGroups: string[] = [];
    for (const raw of qfValues) {
      const v = String(raw ?? "").toLowerCase();
      const perColumn: string[] = [];
      for (const col of ARTIFACT_QUICK_FILTER_COLUMNS) {
        const ph = `$${++p}`;
        perColumn.push(`LOWER(${col}) LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v)}%`);
      }
      perValueGroups.push(`(${perColumn.join(" OR ")})`);
    }
    clauses.push(`(${perValueGroups.join(` ${qfLogic.toUpperCase()} `)})`);
  }

  return {
    where: clauses.length ? clauses.join(" AND ") : "",
    params,
    lastIndex: p,
  };
}

export async function fetchArtifactsByCategory(
  category: string,
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
): Promise<{ rows: any[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const built = buildArtifactFiltersWithDollarPlaceholders(filterModel, 3);
  const extraWhere = built.where ? ` AND (${built.where})` : "";

  const query = `
    SELECT
      artifacts.id AS artifact_id,
      artifacts.name AS artifact_name,
      artifacts.description,
      artifacts.parser,
      artifacts.tag,
      artifacts.category,
      system_files.id AS file_id,
      system_files.identifier AS identifier,
      system_files.absolute_path,
      system_files.name AS file_name,
      system_files.ftype,
      system_files.size,
      system_files.created,
      system_files.modified,
      system_files.accessed,
      system_files.permissions,
      system_files."group",
      system_files.owner,
      system_files.sig_name,
      system_files.sig_mime,
      system_files.sig_exts,
      system_files.metadata
    FROM
      artifacts
    INNER JOIN
      system_files ON artifacts.file_id = system_files.id
    WHERE
      artifacts.category = $1 AND
      artifacts.evidence_id = $2 AND
      artifacts.partition_id = $3
      ${extraWhere}
    LIMIT $${built.params.length + 4} OFFSET $${built.params.length + 5}
  `;

  const countQuery = `
    SELECT COUNT(*) as count
    FROM artifacts
    INNER JOIN system_files ON artifacts.file_id = system_files.id
    WHERE
      artifacts.category = $1 AND
      artifacts.evidence_id = $2 AND
      artifacts.partition_id = $3
      ${extraWhere}
  `;

  const queryParams = [category, evidenceId, partitionId, ...built.params];

  const countResult = (await db.select(countQuery, queryParams)) as any[];
  const rowCount = countResult[0].count;

  const rows = (await db.select(query, [
    ...queryParams,
    limit,
    offset,
  ])) as any[];

  return { rows, rowCount };
}

/**
 * Aggregates timestamps from system_files into (type, ts, count).
 * DB columns are Unix time **seconds** (INTEGER). We convert to **ms** for JS.
 */
export async function getTimestampCountsByType(
  evidenceId: number,
  partitionId: number,
  opts?: {
    bucket?: "second" | "minute" | "hour" | "day";
    /** Range boundaries; accept ms or seconds (we normalize) */
    start?: number | null;
    end?: number | null;
    filterModel?: FilterModel;
  },
): Promise<TimestampCount[]> {
  const db = await getEvidenceDb(evidenceId);

  const bucket = opts?.bucket ?? "second";

  // ---- normalize inputs: accept sec or ms and convert to *seconds* for SQL
  const toMs = (ts: number) => (ts < 1e11 ? ts * 1000 : ts); // < 1e11 -> seconds
  const startSec =
    opts?.start != null ? Math.floor(toMs(opts.start) / 1000) : null;
  const endSec = opts?.end != null ? Math.ceil(toMs(opts.end) / 1000) : null;

  // Group in epoch *seconds*
  const bucketExpr = (() => {
    switch (bucket) {
      case "minute":
        return `(CAST(ts AS INTEGER) / 60) * 60`;
      case "hour":
        return `(CAST(ts AS INTEGER) / 3600) * 3600`;
      case "day":
        return `(CAST(ts AS INTEGER) / 86400) * 86400`;
      default:
        return `CAST(ts AS INTEGER)`;
    }
  })();
  const built = buildFiltersWithDollarPlaceholders(opts?.filterModel, 4);

  const extraWhere = built.where ? ` AND (${built.where})` : "";

  const rows = await db.select<Array<{
    type: TimestampType;
    ts_sec: number;
    count: number;
  }>>(
    `
    WITH events AS (
      SELECT 'created' AS type, created AS ts
      FROM system_files
      WHERE evidence_id = $1 AND partition_id = $2
        AND created IS NOT NULL
        AND ($3 IS NULL OR created >= $3)
        AND ($4 IS NULL OR created <= $4)
        ${extraWhere}
      UNION ALL
      SELECT 'accessed' AS type, accessed AS ts
      FROM system_files
      WHERE evidence_id = $1 AND partition_id = $2
        AND accessed IS NOT NULL
        AND ($3 IS NULL OR accessed >= $3)
        AND ($4 IS NULL OR accessed <= $4)
        ${extraWhere}
      UNION ALL
      SELECT 'modified' AS type, modified AS ts
      FROM system_files
      WHERE evidence_id = $1 AND partition_id = $2
        AND modified IS NOT NULL
        AND ($3 IS NULL OR modified >= $3)
        AND ($4 IS NULL OR modified <= $4)
        ${extraWhere}
    ),
      norm AS (
        SELECT type, ${bucketExpr} AS ts_sec
        FROM events
      )
      SELECT type, ts_sec, COUNT(*) AS count
      FROM norm
      GROUP BY type, ts_sec
      ORDER BY ts_sec ASC, type ASC
    `,
    [evidenceId, partitionId, startSec, endSec, ...built.params],
  );

  return rows
    .map((r: any) => ({
      type: r.type,
      ts: r.ts_sec * 1000, // seconds → ms for chart
      count: r.count,
    }))
    .filter((r: any) => Number.isFinite(r.ts) && r.ts > 0 && r.count > 0);
}

/*  SERVER-SIDE FILTERING FOR FILES Exploration */

/* Server side processing for FilesDataGrid.tsx, To be put in another file */

type LogicOperator = "and" | "or";
type Operator =
  | "contains"
  | "doesNotContain"
  | "equals"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty";

type FilterItem = {
  field: string;
  operator: Operator;
  value?: string | number | null;
};

export type FilterModel = {
  items?: FilterItem[];
  logicOperator?: LogicOperator;
  quickFilterValues?: (string | number)[];
  quickFilterLogicOperator?: LogicOperator;
};

const FIELD_MAP: Record<string, string> = {
  id: "id",
  evidence_id: "evidence_id",
  partition_id: "partition_id",
  identifier: "identifier",
  absolute_path: "absolute_path",
  name: "name",
  ftype: "ftype",
  size: "size",
  created: "created",
  modified: "modified",
  accessed: "accessed",
  permissions: "permissions",
  owner: "owner",
  group: `"group"`,
  sig_name: "sig_name",
  sig_mime: "sig_mime",
  sig_exts: "sig_exts",
  metadata: "metadata",
};

const QUICK_FILTER_COLUMNS: string[] = [
  "absolute_path",
  "name",
  "ftype",
  "permissions",
  "owner",
  `"group"`,
  "sig_name",
  "sig_mime",
  "sig_exts",
  // numeric -> cast to text for LIKE
  "CAST(identifier AS TEXT)",
  "CAST(size AS TEXT)",
];

function isTextLikeField(field: string): boolean {
  return [
    "absolute_path",
    "name",
    "ftype",
    "permissions",
    "owner",
    "group",
    "sig_name",
    "sig_mime",
    "sig_exts",
    "metadata",
  ].includes(field);
}

function escapeLike(raw: string): string {
  return raw.replace(/[%_\\]/g, (m) => "\\" + m);
}

function buildFiltersWithDollarPlaceholders(
  model: FilterModel | undefined,
  startIndex: number, // first $ index available (we'll use 2 because $1 is partition_id)
) {
  const items = model?.items ?? [];
  const logic = (model?.logicOperator ?? "and").toLowerCase() as LogicOperator;
  const qfValues = model?.quickFilterValues ?? [];
  const qfLogic = (
    model?.quickFilterLogicOperator ?? "and"
  ).toLowerCase() as LogicOperator;

  let p = startIndex;
  const params: any[] = [];
  const clauses: string[] = [];

  const itemClauses: string[] = [];
  for (const item of items) {
    const mapped = FIELD_MAP[item.field];
    if (!mapped) continue;

    const op = item.operator;
    const valRaw = item.value;

    const likeOp =
      op === "contains" ||
      op === "doesNotContain" ||
      op === "startsWith" ||
      op === "endsWith";

    const exprBase =
      likeOp && !isTextLikeField(item.field)
        ? `LOWER(CAST(${mapped} AS TEXT))`
        : likeOp
          ? `LOWER(${mapped})`
          : mapped;

    switch (op) {
      case "contains": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "doesNotContain": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        const expr =
          exprBase.startsWith("LOWER(") || exprBase.startsWith("COALESCE(")
            ? `COALESCE(${exprBase}, '')`
            : `COALESCE(LOWER(CAST(${mapped} AS TEXT)), '')`;
        itemClauses.push(`${expr} NOT LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "equals": {
        const ph = `$${++p}`;
        itemClauses.push(`${mapped} = ${ph}`);
        params.push(valRaw);
        break;
      }
      case "startsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "endsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}`);
        break;
      }
      case "isEmpty": {
        itemClauses.push(
          `(${mapped} IS NULL OR TRIM(CAST(${mapped} AS TEXT)) = '')`,
        );
        break;
      }
      case "isNotEmpty": {
        itemClauses.push(
          `(${mapped} IS NOT NULL AND TRIM(CAST(${mapped} AS TEXT)) <> '')`,
        );
        break;
      }
      default:
        break;
    }
  }

  if (itemClauses.length) {
    clauses.push(`(${itemClauses.join(` ${logic.toUpperCase()} `)})`);
  }

  if (qfValues.length) {
    const perValueGroups: string[] = [];
    for (const raw of qfValues) {
      const v = String(raw ?? "").toLowerCase();
      const perColumn: string[] = [];
      for (const col of QUICK_FILTER_COLUMNS) {
        const ph = `$${++p}`;
        perColumn.push(`LOWER(${col}) LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v)}%`);
      }
      perValueGroups.push(`(${perColumn.join(" OR ")})`);
    }
    clauses.push(`(${perValueGroups.join(` ${qfLogic.toUpperCase()} `)})`);
  }

  return {
    where: clauses.length ? clauses.join(" AND ") : "",
    params,
    lastIndex: p,
  };
}

export async function getFiles(
  evidenceId: number,
  partition_id: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
  timelineFilter?: TimelineFileFilter,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  // $1 is always the partition_id
  const base = `partition_id = $1`;

  const built = buildFiltersWithDollarPlaceholders(filterModel, 1);

  // We'll append extra filters after built.where
  let p = built.lastIndex;
  const dynamicParams = [...built.params];
  const extraClauses: string[] = [];

  // ---- Timeline filter (created/accessed/modified in range)
  const hasTimelineBounds =
    timelineFilter &&
    (timelineFilter.start != null || timelineFilter.end != null) &&
    (timelineFilter.types?.length ?? 0) > 0;

  if (hasTimelineBounds) {
    const startSec =
      timelineFilter?.start != null
        ? (timelineFilter.start < 1e11 ? timelineFilter.start : Math.floor(timelineFilter.start / 1000))
        : null;
    const endSec =
      timelineFilter?.end != null
        ? (timelineFilter.end < 1e11 ? timelineFilter.end : Math.floor(timelineFilter.end / 1000))
        : null;

    // Only apply if at least one bound exists
    if (startSec != null || endSec != null) {
      const phStart = `$${++p}`;
      const phEnd = `$${++p}`;
      dynamicParams.push(startSec, endSec);

      const COL: Record<TimestampType, string> = {
        created: "created",
        accessed: "accessed",
        modified: "modified",
      };

      const perType = timelineFilter!.types.map((t) => {
        const col = COL[t];
        return `(
          ${col} IS NOT NULL
          AND (${phStart} IS NULL OR ${col} >= ${phStart})
          AND (${phEnd}   IS NULL OR ${col} <= ${phEnd})
        )`;
      });

      extraClauses.push(`(${perType.join(" OR ")})`);
    }
  }

  const whereSql = [base, built.where, ...extraClauses]
    .filter(Boolean)
    .join(" AND ");

  const limitIndex = p + 1;
  const offsetIndex = p + 2;

  const rowsSql = `
    SELECT *
    FROM system_files
    WHERE ${whereSql}
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const countSql = `
    SELECT COUNT(*) AS count
    FROM system_files
    WHERE ${whereSql}
  `;

  const rowsParams = [partition_id, ...dynamicParams, limit, offset];
  const countParams = [partition_id, ...dynamicParams];

  const rows: File[] = await db.select(rowsSql, rowsParams);
  const countResult: Array<{ count: number }> = await db.select(
    countSql,
    countParams,
  );
  const rowCount = Number(countResult?.[0]?.count ?? 0);

  return { rows, rowCount };
}

export type TimelineFileFilter = {
  /** boundaries can be ms or seconds */
  start?: number | null;
  end?: number | null;
  /** which timestamp columns participate (OR-ed together) */
  types: TimestampType[];
};

export async function deleteEvidence(
  evidenceId: number,
  db: Database | null,
): Promise<void> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  await db.execute("BEGIN TRANSACTION");

  try {
    // Delete partition-related entries
    await db.execute(
      "DELETE FROM mbr_partition_entries WHERE evidence_id = $1",
      [evidenceId],
    );
    await db.execute(
      "DELETE FROM gpt_partition_entries WHERE evidence_id = $1",
      [evidenceId],
    );
    await db.execute(
      "DELETE FROM logical_partition_entries WHERE evidence_id = $1",
      [evidenceId],
    );

    // Delete artifacts and system files linked to this evidence
    await db.execute("DELETE FROM artifacts WHERE evidence_id = $1", [
      evidenceId,
    ]);
    await db.execute("DELETE FROM system_files WHERE evidence_id = $1", [
      evidenceId,
    ]);

    // Delete preprocessing metadata
    await db.execute(
      "DELETE FROM evidence_preprocessing_metadata WHERE evidence_id = $1",
      [evidenceId],
    );

    // Finally delete the evidence itself
    await db.execute("DELETE FROM evidence WHERE id = $1", [evidenceId]);

    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK");
    throw error;
  }
}

export async function deleteEvidences(evidenceIds: number[]): Promise<void> {
  if (evidenceIds.length === 0) return;

  const db = await Database.load("sqlite:thanatology.db");

  const placeholders = evidenceIds.map((_, i) => `$${i + 1}`).join(", ");

  await db.execute("BEGIN TRANSACTION");

  try {
    // Partition-related entries
    await db.execute(
      `DELETE FROM mbr_partition_entries
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );
    await db.execute(
      `DELETE FROM gpt_partition_entries
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );
    await db.execute(
      `DELETE FROM logical_partition_entries
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );

    // Artifacts and system files
    await db.execute(
      `DELETE FROM artifacts
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );
    await db.execute(
      `DELETE FROM system_files
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );

    // Preprocessing metadata
    await db.execute(
      `DELETE FROM evidence_preprocessing_metadata
       WHERE evidence_id IN (${placeholders})`,
      evidenceIds,
    );

    // Finally evidences
    await db.execute(
      `DELETE FROM evidence
       WHERE id IN (${placeholders})`,
      evidenceIds,
    );

    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK");
    throw error;
  }
}

export async function fetchParsedArtefactObjects(params: {
  evidenceId: number;
  partitionId: number;
  fileId: number;
}): Promise<ArtifactObjectRow[]> {
  const db = await getEvidenceDb(params.evidenceId);

  const rows = await db.select<ArtifactObjectRow[]>(
    `
    SELECT
      id,
      evidence_id,
      partition_id,
      artifact_id,
      file_id,
      parser,
      kind,
      text,
      json
    FROM artifact_objects
    WHERE evidence_id = $1
      AND partition_id = $2
      AND file_id = $3
    ORDER BY id ASC
    `,
    [params.evidenceId, params.partitionId, params.fileId],
  );

  return rows ?? [];
}

import type { WindowsEventRow, WindowsEventCount } from "./types";

// ---------------- Windows Events filtering ----------------

export type TimelineWindowsEventFilter = {
  /** boundaries can be ms or seconds */
  start?: number | null;
  end?: number | null;
};

const WIN_EVT_FIELD_MAP: Record<string, string> = {
  id: "ao.id",
  evidence_id: "ao.evidence_id",
  partition_id: "sf.partition_id",
  file_id: "ao.file_id",

  event_record_id:
    "CAST(json_extract(ao.json, '$.event_record_id') AS INTEGER)",

  // NEW: filterable timestamp fields
  timestamp_unix_ms: winEvtTsMsExpr(),
  timestamp_unix: "CAST(json_extract(ao.json, '$.timestamp_unix') AS INTEGER)",
  timestamp: "json_extract(ao.json, '$.timestamp')",

  event_id:
    "CAST(json_extract(ao.json, '$.event.Event.System.EventID') AS INTEGER)",
  provider_name:
    "json_extract(ao.json, '$.event.Event.System.Provider.#attributes.Name')",
  provider_guid:
    "json_extract(ao.json, '$.event.Event.System.Provider.#attributes.Guid')",
  channel: "json_extract(ao.json, '$.event.Event.System.Channel')",
  computer: "json_extract(ao.json, '$.event.Event.System.Computer')",
  level: "CAST(json_extract(ao.json, '$.event.Event.System.Level') AS INTEGER)",
  task: "CAST(json_extract(ao.json, '$.event.Event.System.Task') AS INTEGER)",
  opcode:
    "CAST(json_extract(ao.json, '$.event.Event.System.Opcode') AS INTEGER)",
  keywords: "json_extract(ao.json, '$.event.Event.System.Keywords')",
  user_sid:
    "json_extract(ao.json, '$.event.Event.System.Security.#attributes.UserID')",
  process_id:
    "CAST(json_extract(ao.json, '$.event.Event.System.Execution.#attributes.ProcessID') AS INTEGER)",
  thread_id:
    "CAST(json_extract(ao.json, '$.event.Event.System.Execution.#attributes.ThreadID') AS INTEGER)",
};

const WIN_EVT_QUICK_FILTER_COLUMNS: string[] = [
  // keep human timestamp (nice for search)
  "COALESCE(json_extract(ao.json, '$.timestamp'), '')",
  // NEW: allow searching unix ms/sec too
  `COALESCE(CAST(json_extract(ao.json, '$.timestamp_unix_ms') AS TEXT), '')`,
  `COALESCE(CAST(json_extract(ao.json, '$.timestamp_unix') AS TEXT), '')`,

  "COALESCE(json_extract(ao.json, '$.event.Event.System.Provider.#attributes.Name'), '')",
  "COALESCE(json_extract(ao.json, '$.event.Event.System.Channel'), '')",
  "COALESCE(json_extract(ao.json, '$.event.Event.System.Computer'), '')",
  "COALESCE(json_extract(ao.json, '$.event.Event.System.Security.#attributes.UserID'), '')",
  "COALESCE(CAST(json_extract(ao.json, '$.event.Event.System.EventID') AS TEXT), '')",
  "COALESCE(json_extract(ao.json, '$.event.Event.System.Keywords'), '')",
];

function winEvtIsTextLikeField(field: string): boolean {
  return [
    "timestamp",
    "provider_name",
    "provider_guid",
    "channel",
    "computer",
    "keywords",
    "user_sid",
  ].includes(field);
}

function winEvtEscapeLike(raw: string): string {
  return raw.replace(/[%_\\]/g, (m) => "\\" + m);
}

/**
 * Build WHERE + params from a DataGridPro-like filter model,
 * but mapping fields to JSON-extract expressions.
 */
function buildWinEvtFiltersWithDollarPlaceholders(
  model: FilterModel | undefined,
  startIndex: number,
) {
  const items = model?.items ?? [];
  const logic = (model?.logicOperator ?? "and").toLowerCase() as LogicOperator;
  const qfValues = model?.quickFilterValues ?? [];
  const qfLogic = (
    model?.quickFilterLogicOperator ?? "and"
  ).toLowerCase() as LogicOperator;

  let p = startIndex;
  const params: any[] = [];
  const clauses: string[] = [];

  const itemClauses: string[] = [];

  for (const item of items) {
    const mapped = WIN_EVT_FIELD_MAP[item.field];
    if (!mapped) continue;

    const op = item.operator;
    const valRaw = item.value;

    const likeOp =
      op === "contains" ||
      op === "doesNotContain" ||
      op === "startsWith" ||
      op === "endsWith";

    const exprBase =
      likeOp && !winEvtIsTextLikeField(item.field)
        ? `LOWER(CAST(${mapped} AS TEXT))`
        : likeOp
          ? `LOWER(${mapped})`
          : mapped;

    switch (op) {
      case "contains": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${winEvtEscapeLike(v.toLowerCase())}%`);
        break;
      }
      case "doesNotContain": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        const expr = `COALESCE(${exprBase}, '')`;
        itemClauses.push(`${expr} NOT LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${winEvtEscapeLike(v.toLowerCase())}%`);
        break;
      }
      case "equals": {
        const ph = `$${++p}`;
        itemClauses.push(`${mapped} = ${ph}`);
        params.push(valRaw);
        break;
      }
      case "startsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`${winEvtEscapeLike(v.toLowerCase())}%`);
        break;
      }
      case "endsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${winEvtEscapeLike(v.toLowerCase())}`);
        break;
      }
      case "isEmpty": {
        itemClauses.push(
          `(${mapped} IS NULL OR TRIM(CAST(${mapped} AS TEXT)) = '')`,
        );
        break;
      }
      case "isNotEmpty": {
        itemClauses.push(
          `(${mapped} IS NOT NULL AND TRIM(CAST(${mapped} AS TEXT)) <> '')`,
        );
        break;
      }
      default:
        break;
    }
  }

  if (itemClauses.length) {
    clauses.push(`(${itemClauses.join(` ${logic.toUpperCase()} `)})`);
  }

  if (qfValues.length) {
    const perValueGroups: string[] = [];
    for (const raw of qfValues) {
      const v = String(raw ?? "").toLowerCase();
      const perColumn: string[] = [];
      for (const colExpr of WIN_EVT_QUICK_FILTER_COLUMNS) {
        const ph = `$${++p}`;
        perColumn.push(`LOWER(${colExpr}) LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${winEvtEscapeLike(v)}%`);
      }
      perValueGroups.push(`(${perColumn.join(" OR ")})`);
    }
    clauses.push(`(${perValueGroups.join(` ${qfLogic.toUpperCase()} `)})`);
  }

  return {
    where: clauses.length ? clauses.join(" AND ") : "",
    params,
    lastIndex: p,
  };
}

// ---- Windows EVTX: timestamp helpers (JSON contains unix ms)
function toEpochMs(ts: number): number {
  // seconds are ~1e9, ms are ~1e12
  return ts < 1e11 ? ts * 1000 : ts;
}

function winEvtTsMsExpr() {
  // Stored by backend as integer ms
  return `CAST(json_extract(ao.json, '$.timestamp_unix_ms') AS INTEGER)`;
}

function winEvtTsSecExpr() {
  // Derive seconds for bucketing
  return `CAST((${winEvtTsMsExpr()} / 1000) AS INTEGER)`;
}

// ---------------- Windows Events: grid rows ----------------

export async function getWindowsEvents(
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
  timelineFilter?: TimelineWindowsEventFilter,
): Promise<{ rows: WindowsEventRow[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const baseWhere = `
    ao.evidence_id = $1
    AND sf.partition_id = $2
    AND ao.kind = 'windows.evtx.event'
  `;

  const built = buildWinEvtFiltersWithDollarPlaceholders(filterModel, 2);

  let p = built.lastIndex;
  const paramsDyn = [...built.params];
  const extraClauses: string[] = [];

  const tsMsExpr = winEvtTsMsExpr();

  // Timeline bounds (based on JSON unix ms)
  if (
    timelineFilter &&
    (timelineFilter.start != null || timelineFilter.end != null)
  ) {
    const startMs =
      timelineFilter.start != null ? toEpochMs(timelineFilter.start) : null;
    const endMs =
      timelineFilter.end != null ? toEpochMs(timelineFilter.end) : null;

    const phStart = `$${++p}`;
    const phEnd = `$${++p}`;
    paramsDyn.push(startMs, endMs);

    extraClauses.push(
      `(
        ${tsMsExpr} IS NOT NULL
        AND (${phStart} IS NULL OR ${tsMsExpr} >= ${phStart})
        AND (${phEnd}   IS NULL OR ${tsMsExpr} <= ${phEnd})
      )`,
    );
  }

  const whereSql = [baseWhere, built.where, ...extraClauses]
    .filter(Boolean)
    .join(" AND ");

  const limitIndex = p + 1;
  const offsetIndex = p + 2;

  const selectSql = `
    SELECT
      ao.id AS id,
      ao.evidence_id AS evidence_id,
      sf.partition_id AS partition_id,
      ao.file_id AS file_id,

      CAST(json_extract(ao.json, '$.event_record_id') AS INTEGER) AS event_record_id,

      json_extract(ao.json, '$.timestamp') AS timestamp_iso,
      ${tsMsExpr} AS ts,

      CAST(json_extract(ao.json, '$.event.Event.System.EventID') AS INTEGER) AS event_id,
      json_extract(ao.json, '$.event.Event.System.Provider.#attributes.Name') AS provider_name,
      json_extract(ao.json, '$.event.Event.System.Provider.#attributes.Guid') AS provider_guid,

      json_extract(ao.json, '$.event.Event.System.Channel') AS channel,
      json_extract(ao.json, '$.event.Event.System.Computer') AS computer,

      CAST(json_extract(ao.json, '$.event.Event.System.Level') AS INTEGER) AS level,
      CAST(json_extract(ao.json, '$.event.Event.System.Task') AS INTEGER) AS task,
      CAST(json_extract(ao.json, '$.event.Event.System.Opcode') AS INTEGER) AS opcode,
      json_extract(ao.json, '$.event.Event.System.Keywords') AS keywords,

      json_extract(ao.json, '$.event.Event.System.Security.#attributes.UserID') AS user_sid,
      CAST(json_extract(ao.json, '$.event.Event.System.Execution.#attributes.ProcessID') AS INTEGER) AS process_id,
      CAST(json_extract(ao.json, '$.event.Event.System.Execution.#attributes.ThreadID') AS INTEGER) AS thread_id,

      ao.json AS json_raw
    FROM artifact_objects ao
    JOIN system_files sf ON sf.id = ao.file_id
    WHERE ${whereSql}
    ORDER BY ts ASC, ao.id ASC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const countSql = `
    SELECT COUNT(*) AS count
    FROM artifact_objects ao
    JOIN system_files sf ON sf.id = ao.file_id
    WHERE ${whereSql}
  `;

  const rowsParams = [evidenceId, partitionId, ...paramsDyn, limit, offset];
  const countParams = [evidenceId, partitionId, ...paramsDyn];

  const rows = (await db.select(selectSql, rowsParams)) as WindowsEventRow[];
  const countResult = (await db.select(countSql, countParams)) as Array<{
    count: number;
  }>;

  return { rows, rowCount: Number(countResult?.[0]?.count ?? 0) };
}

// ---------------- Windows Events: chart counts ----------------

export async function getWindowsEventCounts(
  evidenceId: number,
  partitionId: number,
  opts?: {
    bucket?: "second" | "minute" | "hour" | "day";
    start?: number | null; // ms or sec
    end?: number | null; // ms or sec
    filterModel?: FilterModel;
  },
): Promise<WindowsEventCount[]> {
  const db = await getEvidenceDb(evidenceId);

  const bucket = opts?.bucket ?? "minute";

  const startMs = opts?.start != null ? (opts.start < 1e11 ? opts.start * 1000 : opts.start) : null;
  const endMs = opts?.end != null ? (opts.end < 1e11 ? opts.end * 1000 : opts.end) : null;

  const tsMsExpr = winEvtTsMsExpr();
  const tsSecExpr = winEvtTsSecExpr(); // ms -> sec

  // bucket in epoch seconds, then convert back to ms for chart
  const bucketExpr = (() => {
    switch (bucket) {
      case "minute":
        return `(CAST(ts_sec AS INTEGER) / 60) * 60`;
      case "hour":
        return `(CAST(ts_sec AS INTEGER) / 3600) * 3600`;
      case "day":
        return `(CAST(ts_sec AS INTEGER) / 86400) * 86400`;
      default:
        return `CAST(ts_sec AS INTEGER)`;
    }
  })();

  const built = buildWinEvtFiltersWithDollarPlaceholders(opts?.filterModel, 4);
  const extraWhere = built.where ? ` AND (${built.where})` : "";

  const rows = await db.select<Array<{ ts_bucket: number; count: number }>>(
    `
    WITH base AS (
      SELECT ${tsSecExpr} AS ts_sec, ${tsMsExpr} AS ts_ms
      FROM artifact_objects ao
      JOIN system_files sf ON sf.id = ao.file_id
      WHERE ao.evidence_id = $1
        AND sf.partition_id = $2
        AND ao.kind = 'windows.evtx.event'
        AND (${tsMsExpr} IS NOT NULL)
        AND ($3 IS NULL OR ${tsMsExpr} >= $3)
        AND ($4 IS NULL OR ${tsMsExpr} <= $4)
        ${extraWhere}
    ),
    buck AS (
      SELECT ${bucketExpr} AS ts_bucket
      FROM base
    )
    SELECT ts_bucket, COUNT(*) AS count
    FROM buck
    GROUP BY ts_bucket
    ORDER BY ts_bucket ASC
    `,
    [evidenceId, partitionId, startMs, endMs, ...built.params],
  );

  return rows
    .map((r) => ({ ts: r.ts_bucket * 1000, count: r.count }))
    .filter((r) => Number.isFinite(r.ts) && r.ts > 0 && r.count > 0);
}

// ---------------- PML Events ----------------

export const PML_FIELD_MAP: Record<string, string> = {
  time: `CAST(json_extract(ao.json, '$.timestamp_unix_ms') AS INTEGER)`,
  process: "json_extract(ao.json, '$.details.process_name')",
  pid: "CAST(json_extract(ao.json, '$.details.pid') AS INTEGER)",
  operation: "json_extract(ao.json, '$.operation')",
  path: "COALESCE(json_extract(ao.json, '$.details.path'), json_extract(ao.json, '$.details.raw'))",
  result: "COALESCE(json_extract(ao.json, '$.result_text'), json_extract(ao.json, '$.result'))",
};

export const PML_QUICK_FILTER_COLUMNS: string[] = [
  "COALESCE(CAST(json_extract(ao.json, '$.timestamp_unix_ms') AS TEXT), '')",
  "COALESCE(json_extract(ao.json, '$.details.process_name'), '')",
  "COALESCE(CAST(json_extract(ao.json, '$.details.pid') AS TEXT), '')",
  "COALESCE(json_extract(ao.json, '$.operation'), '')",
  "COALESCE(json_extract(ao.json, '$.details.path'), json_extract(ao.json, '$.details.raw'), '')",
  "COALESCE(json_extract(ao.json, '$.result_text'), json_extract(ao.json, '$.result'), '')",
];

export function buildPmlFiltersWithDollarPlaceholders(
  model: FilterModel | undefined,
  startIndex: number,
) {
  const items = model?.items ?? [];
  const logic = (model?.logicOperator ?? "and").toLowerCase() as LogicOperator;
  const qfValues = model?.quickFilterValues ?? [];
  const qfLogic = (
    model?.quickFilterLogicOperator ?? "and"
  ).toLowerCase() as LogicOperator;

  let p = startIndex;
  const params: any[] = [];
  const clauses: string[] = [];

  const itemClauses: string[] = [];
  for (const item of items) {
    const mapped = PML_FIELD_MAP[item.field];
    if (!mapped) continue;

    const op = item.operator;
    const valRaw = item.value;

    const isTextField = ["process", "operation", "path", "result"].includes(
      item.field
    );

    const likeOp =
      op === "contains" ||
      op === "doesNotContain" ||
      op === "startsWith" ||
      op === "endsWith";

    const exprBase =
      likeOp && !isTextField
        ? `LOWER(CAST(${mapped} AS TEXT))`
        : likeOp
          ? `LOWER(${mapped})`
          : mapped;

    switch (op) {
      case "contains": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "doesNotContain": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        const expr = `COALESCE(${exprBase}, '')`;
        itemClauses.push(`${expr} NOT LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "equals": {
        const ph = `$${++p}`;
        itemClauses.push(`${mapped} = ${ph}`);
        params.push(valRaw);
        break;
      }
      case "startsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`${escapeLike(v.toLowerCase())}%`);
        break;
      }
      case "endsWith": {
        const v = String(valRaw ?? "");
        const ph = `$${++p}`;
        itemClauses.push(`${exprBase} LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v.toLowerCase())}`);
        break;
      }
      case "isEmpty": {
        itemClauses.push(
          `(${mapped} IS NULL OR TRIM(CAST(${mapped} AS TEXT)) = '')`,
        );
        break;
      }
      case "isNotEmpty": {
        itemClauses.push(
          `(${mapped} IS NOT NULL AND TRIM(CAST(${mapped} AS TEXT)) <> '')`,
        );
        break;
      }
      default:
        break;
    }
  }

  if (itemClauses.length) {
    clauses.push(`(${itemClauses.join(` ${logic.toUpperCase()} `)})`);
  }

  if (qfValues.length) {
    const perValueGroups: string[] = [];
    for (const raw of qfValues) {
      const v = String(raw ?? "").toLowerCase();
      const perColumn: string[] = [];
      for (const colExpr of PML_QUICK_FILTER_COLUMNS) {
        const ph = `$${++p}`;
        perColumn.push(`LOWER(${colExpr}) LIKE ${ph} ESCAPE '\\'`);
        params.push(`%${escapeLike(v)}%`);
      }
      perValueGroups.push(`(${perColumn.join(" OR ")})`);
    }
    clauses.push(`(${perValueGroups.join(` ${qfLogic.toUpperCase()} `)})`);
  }

  return {
    where: clauses.length ? clauses.join(" AND ") : "",
    params,
    lastIndex: p,
  };
}

export async function getPmlEvents(
  evidenceId: number,
  partitionId: number,
  fileId: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
): Promise<{ rows: any[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const baseWhere = `
    ao.evidence_id = $1
    AND ao.partition_id = $2
    AND ao.file_id = $3
    AND ao.parser = 'windows_pml'
  `;

  // startIndex is 3, so built filters start at $4
  const built = buildPmlFiltersWithDollarPlaceholders(filterModel, 3);

  let p = built.lastIndex;
  const paramsDyn = [...built.params];

  const whereSql = [baseWhere, built.where]
    .filter(Boolean)
    .join(" AND ");

  const limitIndex = p + 1;
  const offsetIndex = p + 2;

  const selectSql = `
    SELECT ao.json
    FROM artifact_objects ao
    WHERE ${whereSql}
    ORDER BY ao.id ASC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const countSql = `
    SELECT COUNT(*) AS count
    FROM artifact_objects ao
    WHERE ${whereSql}
  `;

  const rowsParams = [evidenceId, partitionId, fileId, ...paramsDyn, limit, offset];
  const countParams = [evidenceId, partitionId, fileId, ...paramsDyn];

  const rows = (await db.select(selectSql, rowsParams)) as any[];
  const countResult = (await db.select(countSql, countParams)) as Array<{
    count: number;
  }>;

  // Since db.select returns an array of objects representing rows: [{ json: "{\"key\": \"val\"}" }, ...]
  const parsedRows = rows.map((row) => JSON.parse(row.json));

  return { rows: parsedRows, rowCount: Number(countResult?.[0]?.count ?? 0) };
}
