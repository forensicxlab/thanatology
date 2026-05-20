import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  MBRPartitionEntry,
  Module,
  Case,
  Evidence,
  EvidenceImageInput,
  EvidenceImageRecord,
  ProcessedEvidenceMetadata,
  File,
  GPTPartitionEntry,
  LogicalPartitionEntry,
  FileQueryScope,
  FilesystemTreeItem,
} from "./types";
import type { TimestampType, TimestampCount, ArtifactObjectRow } from "./types";
import { getEvidenceDb, getMainDb } from "./db";
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
      "DELETE FROM partitions WHERE evidence_id IN (SELECT id FROM evidence WHERE case_id = $1)",
      [caseId],
    );

    await db.execute(
      "DELETE FROM evidence_images WHERE evidence_id IN (SELECT id FROM evidence WHERE case_id = $1)",
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
      `DELETE FROM partitions
       WHERE evidence_id IN (
         SELECT id FROM evidence WHERE case_id IN (${placeholders})
       )`,
      caseIds,
    );

    await db.execute(
      `DELETE FROM evidence_images
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

  await db.execute("PRAGMA busy_timeout = 30000");

  await db.execute(
    "DELETE FROM partitions WHERE evidence_id = $1",
    [metadata.evidenceData.id],
  );
  await db.execute(
    "DELETE FROM evidence_preprocessing_metadata WHERE evidence_id = $1",
    [metadata.evidenceData.id],
  );

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
      await db.execute(
        `
        INSERT INTO partitions (
          evidence_id,
          kind,
          partition_type,
          boot_indicator,
          start_chs,
          end_chs,
          start_lba,
          size_sectors,
          sector_size,
          first_byte_addr,
          size_bytes,
          description,
          fvek
        ) VALUES ($1, 'mbr', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          partition.size_sectors * partition.sector_size,
          partition.description,
          partition.fvek || null,
        ],
      );
    }
  }

  if (metadata.selectedGptPartitions) {
    for (const partition of metadata.selectedGptPartitions) {
      const sizeSectors =
        partition.size_sectors ??
        (partition.ending_lba - partition.starting_lba + 1);
      const sectorSize = 512;
      const firstByteAddr =
        partition.first_byte_addr ?? partition.starting_lba * sectorSize;

      await db.execute(
        `
          INSERT INTO partitions (
            evidence_id,
            kind,
            partition_guid,
            partition_type_guid,
            start_lba,
            end_lba,
            attributes,
            partition_name,
            description,
            first_byte_addr,
            size_sectors,
            sector_size,
            size_bytes,
            fvek
          ) VALUES ($1, 'gpt', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          firstByteAddr,
          sizeSectors,
          sectorSize,
          sizeSectors * sectorSize,
          partition.fvek || null,
        ],
      );
    }
  }

  if (metadata.selectedLogicalPartition) {
    const logicalSizeBytes = metadata.selectedLogicalPartition.size;
    const logicalSectorSize = 512;
    await db.execute(
      `
        INSERT INTO partitions (
          evidence_id,
          kind,
          first_byte_addr,
          size_sectors,
          sector_size,
          size_bytes,
          fvek
        ) VALUES ($1, 'logical', 0, $2, $3, $4, $5)
      `,
      [
        metadata.evidenceData.id,
        Math.ceil(logicalSizeBytes / logicalSectorSize),
        logicalSectorSize,
        logicalSizeBytes,
        metadata.selectedLogicalPartition.fvek || null,
      ],
    );
  }

  await db.execute(
    `UPDATE evidence
           SET status = 1
         WHERE id = $1`,
    [metadata.evidenceData.id],
  );

  return preprocessingId;
}

function mapPartitionRows(rows: any[]): {
  mbrRows: MBRPartitionEntry[];
  gptRows: GPTPartitionEntry[];
  logicalRows: LogicalPartitionEntry[];
} {
  const mbrRows: MBRPartitionEntry[] = rows
    .filter((row) => row.kind === "mbr")
    .map((row) => ({
      id: row.id,
      boot_indicator: row.boot_indicator ?? 0,
      start_chs: row.start_chs ?? [0, 0, 0],
      partition_type: row.partition_type ?? 0,
      end_chs: row.end_chs ?? [0, 0, 0],
      start_lba: row.start_lba ?? 0,
      size_sectors: row.size_sectors ?? 0,
      sector_size: row.sector_size ?? 512,
      first_byte_addr: row.first_byte_addr ?? 0,
      description: row.description ?? "",
      fvek: row.fvek ?? undefined,
    }));

  const gptRows: GPTPartitionEntry[] = rows
    .filter((row) => row.kind === "gpt")
    .map((row) => ({
      id: row.id,
      partition_guid: [],
      partition_guid_string: row.partition_guid ?? "",
      partition_type_guid: [],
      partition_type_guid_string: row.partition_type_guid ?? "",
      starting_lba: row.start_lba ?? 0,
      ending_lba: row.end_lba ?? 0,
      first_byte_addr: row.first_byte_addr ?? 0,
      size_sectors: row.size_sectors ?? 0,
      attributes: row.attributes ?? 0,
      description: row.description ?? "",
      partition_name: row.partition_name ?? "",
      fvek: row.fvek ?? undefined,
    }));

  const logicalRows: LogicalPartitionEntry[] = rows
    .filter((row) => row.kind === "logical" || row.kind === "folder")
    .map((row) => ({
      id: row.id,
      evidence_id: row.evidence_id,
      size: row.size_bytes ?? 0,
      description: row.description ?? null,
      fvek: row.fvek ?? undefined,
    }));

  return { mbrRows, gptRows, logicalRows };
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

  const rows = await db.select<any[]>(
    "SELECT * FROM partitions WHERE evidence_id = $1 ORDER BY id",
    [evidenceId],
  );

  return mapPartitionRows(rows);
}

export async function getPartitions(evidenceId: number): Promise<{
  mbrRows: MBRPartitionEntry[];
  gptRows: GPTPartitionEntry[];
  logicalRows: LogicalPartitionEntry[];
}> {
  try {
    const evidenceDb = await getEvidenceDb(evidenceId);
    const rows = await evidenceDb.select<any[]>(
      "SELECT * FROM partitions WHERE evidence_id = $1 ORDER BY id",
      [evidenceId],
    );

    if (rows.length > 0) {
      return mapPartitionRows(rows);
    }
  } catch (error) {
    const message = String(error);
    if (!message.includes("no such table: partitions")) {
      throw error;
    }
  }

  const mainDb = await getMainDb();
  const rows = await mainDb.select<any[]>(
    "SELECT * FROM partitions WHERE evidence_id = $1 ORDER BY id",
    [evidenceId],
  );

  return mapPartitionRows(rows);
}

export async function saveEvidenceImages(
  evidenceId: number,
  images: EvidenceImageInput[],
): Promise<void> {
  if (images.length === 0) {
    return;
  }

  await invoke("save_evidence_images", { evidenceId, images });
}

export async function getEvidenceImages(
  evidenceId: number,
): Promise<EvidenceImageRecord[]> {
  return invoke<EvidenceImageRecord[]>("get_evidence_images", { evidenceId });
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
    "SELECT * FROM evidence WHERE status >= 1",
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

  const normalizedParentDirectory = normalizePathKey(parentDirectory);

  const files: File[] = await db.select(
    `
     SELECT *
     FROM system_files
     WHERE evidence_id = $1
       AND partition_id = $2
       AND parent_path_key = $3
     ORDER BY is_dir DESC, LOWER(name) ASC, name ASC, id ASC
     `,
    [evidenceId, partitionId, normalizedParentDirectory],
  );

  return files;
}

type FilesystemTreeRow = {
  id: number;
  name: string;
  absolute_path: string;
  path_key: string;
  parent_path_key: string | null;
  ftype: string;
  is_dir: number;
  children_count: number;
};

export async function getFilesystemTreeChildren(
  evidenceId: number,
  partitionId: number,
  parentPathKey: string,
): Promise<FilesystemTreeItem[]> {
  const db = await getEvidenceDb(evidenceId);
  const normalizedParentPathKey = normalizePathKey(parentPathKey);

  const rows = await db.select<FilesystemTreeRow[]>((
    `
      SELECT
        sf.id,
        sf.name,
        sf.absolute_path,
        sf.path_key,
        sf.parent_path_key,
        sf.ftype,
        sf.is_dir,
        COALESCE(child_counts.child_count, 0) AS children_count
      FROM system_files sf
      LEFT JOIN (
        SELECT
          evidence_id,
          partition_id,
          parent_path_key,
          COUNT(*) AS child_count
        FROM system_files
        WHERE evidence_id = $1
          AND partition_id = $2
        GROUP BY evidence_id, partition_id, parent_path_key
      ) AS child_counts
        ON child_counts.evidence_id = sf.evidence_id
       AND child_counts.partition_id = sf.partition_id
       AND child_counts.parent_path_key = sf.path_key
      WHERE sf.evidence_id = $1
        AND sf.partition_id = $2
        AND sf.parent_path_key = $3
      ORDER BY sf.is_dir DESC, LOWER(sf.name) ASC, sf.name ASC, sf.id ASC
    `
  ), [evidenceId, partitionId, normalizedParentPathKey]);

  return rows.map((row) => {
    const isDir = Number(row.is_dir ?? 0) === 1;
    return {
      id: row.path_key,
      label: makeFilesystemTreeLabel(row.name, row.absolute_path, isDir),
      pathKey: row.path_key,
      parentPathKey: row.parent_path_key,
      absolutePath: row.absolute_path,
      name: row.name,
      ftype: row.ftype,
      isDir,
      childrenCount: Number(row.children_count ?? 0),
      itemKind: isDir ? "directory" : "file",
    };
  });
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

export interface MediaStats {
  images: number;
  videos: number;
  audio: number;
  total: number;
}

export async function getMediaStats(
  evidenceId: number,
  partitionId: number,
): Promise<MediaStats> {
  const db = await getEvidenceDb(evidenceId);

  const result: Array<{ kind: string; count: number }> = await db.select(
    `SELECT
       CASE
         WHEN sig_mime LIKE 'image%' THEN 'image'
         WHEN sig_mime LIKE 'video%' THEN 'video'
         WHEN sig_mime LIKE 'audio%' THEN 'audio'
       END AS kind,
       COUNT(*) as count
     FROM system_files
     WHERE partition_id = $1
       AND (sig_mime LIKE 'image%' OR sig_mime LIKE 'video%' OR sig_mime LIKE 'audio%')
     GROUP BY kind`,
    [partitionId],
  );

  const stats: MediaStats = { images: 0, videos: 0, audio: 0, total: 0 };
  for (const r of result) {
    if (r.kind === "image") stats.images = r.count;
    else if (r.kind === "video") stats.videos = r.count;
    else if (r.kind === "audio") stats.audio = r.count;
  }
  stats.total = stats.images + stats.videos + stats.audio;
  return stats;
}

export async function searchMediaFiltered(
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
  options?: {
    searchText?: string;
    includeImages?: boolean;
    includeVideos?: boolean;
    includeAudio?: boolean;
  },
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const includeImages = options?.includeImages ?? true;
  const includeVideos = options?.includeVideos ?? true;
  const includeAudio = options?.includeAudio ?? true;

  const typeClauses: string[] = [];
  if (includeImages) typeClauses.push("sig_mime LIKE 'image%'");
  if (includeVideos) typeClauses.push("sig_mime LIKE 'video%'");
  if (includeAudio) typeClauses.push("sig_mime LIKE 'audio%'");

  if (typeClauses.length === 0) {
    return { rows: [], rowCount: 0 };
  }

  const typeWhere = `(${typeClauses.join(" OR ")})`;
  const params: any[] = [partitionId];
  let searchWhere = "";

  if (options?.searchText && options.searchText.trim().length > 0) {
    const term = `%${options.searchText.trim()}%`;
    params.push(term, term);
    searchWhere = ` AND (name LIKE $${params.length - 1} OR absolute_path LIKE $${params.length})`;
  }

  const where = `WHERE partition_id = $1 AND ${typeWhere}${searchWhere}`;

  const countResult: Array<{ count: number }> = await db.select(
    `SELECT COUNT(*) as count FROM system_files ${where}`,
    params,
  );
  const rowCount = countResult[0].count;

  const selectParams = [...params, limit, offset];
  const rows: File[] = await db.select(
    `SELECT * FROM system_files ${where} ORDER BY absolute_path ASC LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}`,
    selectParams,
  );

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
  tag?: string,
): Promise<{ rows: any[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  // $1=category, $2=evidenceId, $3=partitionId, [$4=tag if provided]
  const fixedParamCount = tag ? 4 : 3;
  const built = buildArtifactFiltersWithDollarPlaceholders(filterModel, fixedParamCount);
  const tagWhere = tag ? ` AND artifacts.tag = $4` : "";
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
      ${tagWhere}
      ${extraWhere}
    LIMIT $${built.params.length + fixedParamCount + 1} OFFSET $${built.params.length + fixedParamCount + 2}
  `;

  const countQuery = `
    SELECT COUNT(*) as count
    FROM artifacts
    INNER JOIN system_files ON artifacts.file_id = system_files.id
    WHERE
      artifacts.category = $1 AND
      artifacts.evidence_id = $2 AND
      artifacts.partition_id = $3
      ${tagWhere}
      ${extraWhere}
  `;

  const queryParams = [category, evidenceId, partitionId, ...(tag ? [tag] : []), ...built.params];

  const countResult = (await db.select(countQuery, queryParams)) as any[];
  const rowCount = countResult[0].count;

  const rows = (await db.select(query, [
    ...queryParams,
    limit,
    offset,
  ])) as any[];

  return { rows, rowCount };
}

export async function fetchApplicationTags(
  evidenceId: number,
  partitionId: number,
): Promise<string[]> {
  const db = await getEvidenceDb(evidenceId);
  const rows = (await db.select(
    `SELECT DISTINCT artifacts.tag
     FROM artifacts
     INNER JOIN system_files ON artifacts.file_id = system_files.id
     WHERE artifacts.category = $1
       AND artifacts.evidence_id = $2
       AND artifacts.partition_id = $3
     ORDER BY artifacts.tag ASC`,
    ["Application", evidenceId, partitionId],
  )) as { tag: string }[];
  return rows.map((r) => r.tag);
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

export type FileListingMode = "subtree-files" | "direct-children";

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

export const ROOT_PATH_KEY = "/";

function normalizePathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);

  return parts.length === 0 ? ROOT_PATH_KEY : `/${parts.join("/")}`;
}

function makeFilesystemTreeLabel(
  name: string | null | undefined,
  absolutePath: string,
  isDir: boolean,
): string {
  const baseLabel = name && name.trim().length > 0 ? name : absolutePath;
  return isDir ? `${baseLabel}/` : baseLabel;
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

function buildFileScope(
  scope: FileQueryScope | undefined,
  listingMode: FileListingMode = "subtree-files",
) {
  const resolvedScope = scope ?? { kind: "root" as const };
  const clauses = ["partition_id = $1"];
  const params: any[] = [];
  let lastIndex = 1;
  let orderBy = "LOWER(path_key) ASC, path_key ASC, id ASC";

  if (listingMode === "direct-children") {
    if (resolvedScope.kind === "file") {
      clauses.push(`path_key = $${++lastIndex}`);
      params.push(normalizePathKey(resolvedScope.pathKey));
      orderBy = "id ASC";
    } else {
      const parentPath =
        resolvedScope.kind === "directory"
          ? normalizePathKey(resolvedScope.pathKey)
          : ROOT_PATH_KEY;

      clauses.push(`parent_path_key = $${++lastIndex}`);
      clauses.push("is_dir = 0");
      params.push(parentPath);
      orderBy = "LOWER(name) ASC, name ASC, id ASC";
    }

    return { clauses, params, lastIndex, orderBy };
  }

  clauses.push("is_dir = 0");

  if (resolvedScope.kind === "directory") {
    const normalizedPath = normalizePathKey(resolvedScope.pathKey);

    if (normalizedPath !== ROOT_PATH_KEY) {
      clauses.push(`path_key LIKE $${++lastIndex} ESCAPE '\\'`);
      params.push(`${escapeLike(normalizedPath)}/%`);
    }
  } else if (resolvedScope.kind === "file") {
    clauses.push(`path_key = $${++lastIndex}`);
    params.push(normalizePathKey(resolvedScope.pathKey));
  }

  return { clauses, params, lastIndex, orderBy };
}

export async function getFiles(
  evidenceId: number,
  partition_id: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
  timelineFilter?: TimelineFileFilter,
  scope?: FileQueryScope,
  listingMode: FileListingMode = "subtree-files",
): Promise<{ rows: File[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const scopeSql = buildFileScope(scope, listingMode);
  const built = buildFiltersWithDollarPlaceholders(filterModel, scopeSql.lastIndex);

  let p = built.lastIndex;
  const dynamicParams = [...scopeSql.params, ...built.params];
  const extraClauses: string[] = [];

  const hasTimelineBounds =
    timelineFilter &&
    (timelineFilter.start != null || timelineFilter.end != null) &&
    (timelineFilter.types?.length ?? 0) > 0;

  if (hasTimelineBounds) {
    const startSec =
      timelineFilter?.start != null
        ? timelineFilter.start < 1e11
          ? timelineFilter.start
          : Math.floor(timelineFilter.start / 1000)
        : null;
    const endSec =
      timelineFilter?.end != null
        ? timelineFilter.end < 1e11
          ? timelineFilter.end
          : Math.floor(timelineFilter.end / 1000)
        : null;

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

  const whereSql = [
    ...scopeSql.clauses,
    built.where,
    ...extraClauses,
  ]
    .filter(Boolean)
    .join(" AND ");

  const limitIndex = p + 1;
  const offsetIndex = p + 2;

  const rowsSql = `
    SELECT *
    FROM system_files
    WHERE ${whereSql}
    ORDER BY ${scopeSql.orderBy}
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
      "DELETE FROM partitions WHERE evidence_id = $1",
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

    await db.execute("DELETE FROM evidence_images WHERE evidence_id = $1", [
      evidenceId,
    ]);

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
      `DELETE FROM partitions
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

    await db.execute(
      `DELETE FROM evidence_images
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

// ---------------- AI Specialist Artifacts ----------------

export async function fetchAiArtifacts(
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
  filterModel?: FilterModel,
): Promise<{ rows: any[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  // Re-use standard built artifact placeholders where applicable for filtering
  const built = buildArtifactFiltersWithDollarPlaceholders(filterModel, 3);
  const extraWhere = built.where ? ` AND (${built.where})` : "";

  // Single query using COUNT(*) OVER () so the total count and the page rows come from the
  // same transaction snapshot — avoids races when the backend is actively writing.
  const query = `
    SELECT
      COUNT(*) OVER () AS total_count,
      ao.id AS artifact_id,
      ao.kind AS artifact_name,
      ao.parser,
      '' AS tag,
      '' AS category,
      sf.id AS file_id,
      sf.identifier AS identifier,
      sf.absolute_path,
      sf.name AS file_name,
      sf.ftype,
      sf.size,
      sf.created,
      sf.modified,
      sf.accessed,
      sf.permissions,
      sf."group",
      sf.owner,
      sf.sig_name,
      sf.sig_mime,
      sf.sig_exts,
      json_extract(ao.json, '$.score') AS score,
      json_extract(ao.json, '$.summary') AS description,
      ao.json AS metadata
    FROM
      artifact_objects ao
    INNER JOIN
      system_files sf ON ao.file_id = sf.id
    WHERE
      ao.parser = 'ai_specialist' AND
      ao.evidence_id = $1 AND
      ao.partition_id = $2
      ${extraWhere.replace(/artifacts\./g, 'ao.')}
    ORDER BY score DESC
    LIMIT $${built.params.length + 3} OFFSET $${built.params.length + 4}
  `;

  const queryParams = [evidenceId, partitionId, ...built.params];

  const rowsRaw = (await db.select(query, [
    ...queryParams,
    limit,
    offset,
  ])) as any[];

  const rowCount = rowsRaw.length > 0 ? Number(rowsRaw[0].total_count ?? 0) : 0;

  const rows = rowsRaw.map((r: any) => {
    return {
      ...r,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      description: r.description ?? "No summary available",
    };
  });

  return { rows, rowCount };
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

/* =========================================================================
 *  Summary statistics queries
 * ========================================================================= */

import type {
  FileStats,
  MimeTypeCount,
  ArtifactCategoryCount,
  TopSignature,
} from "./types";

export async function getFileStats(
  evidenceId: number,
  partitionId: number,
): Promise<FileStats> {
  const db = await getEvidenceDb(evidenceId);
  const rows: any[] = await db.select(
    `SELECT
       COALESCE(SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END), 0)  AS total_files,
       COALESCE(SUM(CASE WHEN is_dir = 1 THEN 1 ELSE 0 END), 0)  AS total_dirs,
       COALESCE(SUM(CASE WHEN is_dir = 0 THEN size ELSE 0 END), 0) AS total_size,
       MIN(CASE WHEN created  > 0 THEN created  END)              AS earliest_ts,
       MAX(CASE WHEN modified > 0 THEN modified
                WHEN created  > 0 THEN created  END)              AS latest_ts
     FROM system_files
     WHERE evidence_id = $1 AND partition_id = $2`,
    [evidenceId, partitionId],
  );
  const r = rows[0];
  return {
    total_files: Number(r.total_files ?? 0),
    total_dirs:  Number(r.total_dirs  ?? 0),
    total_size:  Number(r.total_size  ?? 0),
    earliest_ts: r.earliest_ts ? Number(r.earliest_ts) : null,
    latest_ts:   r.latest_ts   ? Number(r.latest_ts)   : null,
  };
}

export async function getMimeTypeDistribution(
  evidenceId: number,
  partitionId: number,
): Promise<MimeTypeCount[]> {
  const db = await getEvidenceDb(evidenceId);
  const rows: any[] = await db.select(
    `SELECT
       CASE
         WHEN sig_mime LIKE 'image/%'                          THEN 'Images'
         WHEN sig_mime LIKE 'video/%'                          THEN 'Video'
         WHEN sig_mime LIKE 'audio/%'                          THEN 'Audio'
         WHEN sig_mime LIKE 'text/%'                           THEN 'Text'
         WHEN sig_mime = 'application/pdf'
           OR sig_mime LIKE '%word%'
           OR sig_mime LIKE '%excel%'
           OR sig_mime LIKE '%powerpoint%'
           OR sig_mime LIKE '%spreadsheet%'
           OR sig_mime LIKE '%presentation%'                   THEN 'Documents'
         WHEN sig_mime IN (
               'application/zip','application/x-rar-compressed',
               'application/x-tar','application/gzip',
               'application/x-bzip2','application/x-7z-compressed',
               'application/x-xz','application/x-compress')
           OR sig_mime LIKE 'application/x-rar%'              THEN 'Archives'
         WHEN sig_mime IN (
               'application/x-dosexec','application/x-elf',
               'application/x-sharedlib',
               'application/vnd.microsoft.portable-executable')
           OR sig_mime LIKE 'application/x-executable%'       THEN 'Executables'
         WHEN sig_mime IS NULL OR sig_mime = ''                THEN 'Unknown'
         ELSE 'Other'
       END AS mime_category,
       COUNT(*) AS count
     FROM system_files
     WHERE evidence_id = $1 AND partition_id = $2 AND is_dir = 0
     GROUP BY mime_category
     ORDER BY count DESC`,
    [evidenceId, partitionId],
  );
  return rows.map((r) => ({
    mime_category: String(r.mime_category),
    count: Number(r.count),
  }));
}

export async function getArtifactCategoryCounts(
  evidenceId: number,
  partitionId: number,
): Promise<ArtifactCategoryCount[]> {
  try {
    const db = await getEvidenceDb(evidenceId);
    const rows: any[] = await db.select(
      `SELECT category, COUNT(*) AS count
       FROM artifacts
       WHERE evidence_id = $1 AND partition_id = $2
       GROUP BY category
       ORDER BY count DESC`,
      [evidenceId, partitionId],
    );
    return rows.map((r) => ({
      category: String(r.category),
      count: Number(r.count),
    }));
  } catch {
    return [];
  }
}

export async function getTopFileSignatures(
  evidenceId: number,
  partitionId: number,
  limit = 12,
): Promise<TopSignature[]> {
  const db = await getEvidenceDb(evidenceId);
  const rows: any[] = await db.select(
    `SELECT sig_name, COUNT(*) AS count
     FROM system_files
     WHERE evidence_id = $1 AND partition_id = $2
       AND is_dir = 0
       AND sig_name IS NOT NULL AND sig_name != ''
     GROUP BY sig_name
     ORDER BY count DESC
     LIMIT $3`,
    [evidenceId, partitionId, limit],
  );
  return rows.map((r) => ({
    sig_name: String(r.sig_name),
    count: Number(r.count),
  }));
}
