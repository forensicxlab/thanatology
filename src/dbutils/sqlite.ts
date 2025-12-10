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
import type { TimestampType, TimestampCount } from "./types";

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
  partition_id: number,
  offset: number,
  limit: number,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await Database.load("sqlite:thanatology.db");

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

  // 2) Insert each selected MBR partition
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
  partition_id: number,
  offset: number,
  limit: number,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await Database.load("sqlite:thanatology.db");

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

export async function fetchArtifactsByCategory(
  db: Database | null,
  category: string,
  evidenceId: number,
  partitionId: number,
): Promise<any[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

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
  `;

  const rows = (await db.select(query, [
    category,
    evidenceId,
    partitionId,
  ])) as any[];
  console.log(rows);
  return rows;
}

/**
 * Aggregates timestamps from system_files into (type, ts, count).
 * DB columns are Unix time **seconds** (INTEGER). We convert to **ms** for JS.
 */
export async function getTimestampCountsByType(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  opts?: {
    bucket?: "second" | "minute" | "hour" | "day";
    /** Range boundaries; accept ms or seconds (we normalize) */
    start?: number | null;
    end?: number | null;
  },
): Promise<TimestampCount[]> {
  if (!db) db = await Database.load("sqlite:thanatology.db");

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

  const rows = await db.select<{
    type: TimestampType;
    ts_sec: number;
    count: number;
  }>(
    `
      WITH events AS (
        SELECT 'created'  AS type, created  AS ts
        FROM system_files
        WHERE evidence_id = $1 AND partition_id = $2
          AND created IS NOT NULL
          AND ($3 IS NULL OR created >= $3)
          AND ($4 IS NULL OR created <= $4)
        UNION ALL
        SELECT 'accessed' AS type, accessed AS ts
        FROM system_files
        WHERE evidence_id = $1 AND partition_id = $2
          AND accessed IS NOT NULL
          AND ($3 IS NULL OR accessed >= $3)
          AND ($4 IS NULL OR accessed <= $4)
        UNION ALL
        SELECT 'modified' AS type, modified AS ts
        FROM system_files
        WHERE evidence_id = $1 AND partition_id = $2
          AND modified IS NOT NULL
          AND ($3 IS NULL OR modified >= $3)
          AND ($4 IS NULL OR modified <= $4)
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
    [evidenceId, partitionId, startSec, endSec],
  );

  return rows
    .map((r) => ({
      type: r.type,
      ts: r.ts_sec * 1000, // seconds → ms for chart
      count: r.count,
    }))
    .filter((r) => Number.isFinite(r.ts) && r.ts > 0 && r.count > 0);
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

type FilterModel = {
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
  partition_id: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await Database.load("sqlite:thanatology.db");

  // $1 is always the partition_id
  const base = `partition_id = $1`;

  const built = buildFiltersWithDollarPlaceholders(
    filterModel,
    /* startIndex */ 1,
  );

  // Next placeholders after dynamic filters:
  const limitIndex = built.lastIndex + 1;
  const offsetIndex = built.lastIndex + 2;

  const whereSql = [base, built.where].filter(Boolean).join(" AND ");

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

  const dynamicParams = built.params; // corresponds to $2..$N depending on how many were created
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
