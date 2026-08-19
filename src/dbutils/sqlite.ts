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
import type {
  TimestampType,
  TimelineEventCount,
  TimelineEvent,
  ParsedArtefactObjectsPage,
  ParsedArtefactObjectsPageQuery,
  DiscussionAttachmentKind,
  DiscussionAttachmentRow,
  DiscussionConversationRow,
  DiscussionMessageRow,
  IosCallRow,
  IosContactRow,
  IosBrowserVisitRow,
  BrowserActivityQuery,
  BrowserVisitRow,
  BrowserSiteRow,
  BrowserDownloadRow,
  MacosArtifactPage,
  MacosArtifactPanel,
  MacosArtifactQuery,
  IosLocationFixRow,
  IosCalendarEventRow,
  IosMailMessageRow,
  IosNoteRow,
  IosTccGrantRow,
  IosInteractionRow,
  IosDataUsageRow,
  IosPhotoAssetRow,
  IosActivityEventRow,
} from "./types";
import { closeEvidenceDb, getEvidenceDb, getMainDb } from "./db";
import { useTimeFilterStore } from "../store/timeFilterStore";
import type { FileTimeField } from "../store/timeFilterStore";
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

  const statsParams: any[] = [partitionId];
  const statsTimeWhere = fileTimeFilterClause("system_files", statsParams);
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
       ${statsTimeWhere}
     GROUP BY kind`,
    statsParams,
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

  const mediaTimeWhere = fileTimeFilterClause("system_files", params);
  const where = `WHERE partition_id = $1 AND ${typeWhere}${searchWhere}${mediaTimeWhere}`;

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

  // Global time window. Built against the params accumulated so far so its
  // placeholders land after the grid filters and before LIMIT/OFFSET.
  const queryParams = [
    category,
    evidenceId,
    partitionId,
    ...(tag ? [tag] : []),
    ...built.params,
  ];
  const timeWhere = fileTimeFilterClause("system_files", queryParams);
  const limitIdx = queryParams.length + 1;
  const offsetIdx = queryParams.length + 2;

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
      ${timeWhere}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
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
      ${timeWhere}
  `;

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
 * Distinct artifact tags for a category (e.g. "Users", "Network"), used to
 * build per-tag sub-tabs. Generalises fetchApplicationTags to any category.
 */
export async function fetchArtifactTags(
  evidenceId: number,
  partitionId: number,
  category: string,
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
    [category, evidenceId, partitionId],
  )) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/**
 * Parsed iOS call records (CallHistory.storedata) for a partition.
 * Datasets are small (typically << 1k rows), so all rows are loaded and the
 * grid paginates client-side, mirroring ArtefactObjectsGrid.
 */
export async function getIosCalls(
  evidenceId: number,
  partitionId: number,
): Promise<IosCallRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.call.unix_ms') AS INTEGER)"],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.call.unix_ms') AS INTEGER) AS ts,
      json_extract(ao.json, '$.direction') AS direction,
      CAST(json_extract(ao.json, '$.answered') AS INTEGER) AS answered,
      CAST(json_extract(ao.json, '$.missed') AS INTEGER) AS missed,
      json_extract(ao.json, '$.remote_party.name') AS party_name,
      json_extract(ao.json, '$.remote_party.address') AS party_address,
      json_extract(ao.json, '$.call.duration_seconds') AS duration_seconds,
      json_extract(ao.json, '$.call.type_family') AS call_type,
      json_extract(ao.json, '$.service.provider') AS service_provider,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_callhistory'
      ${timeClause}
    ORDER BY ts DESC, ao.id DESC
    `,
    params,
  )) as IosCallRow[];
  return rows ?? [];
}

/** Parsed iOS contacts (AddressBook.sqlitedb) for a partition. */
export async function getIosContacts(
  evidenceId: number,
  partitionId: number,
): Promise<IosContactRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  // A contact is in range if it was created OR last modified inside the window.
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.modified.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      json_extract(ao.json, '$.contact.display_name') AS display_name,
      json_extract(ao.json, '$.contact.organization') AS organization,
      json_extract(ao.json, '$.contact.job_title') AS job_title,
      json_extract(ao.json, '$.contact.phones') AS phones,
      json_extract(ao.json, '$.contact.emails') AS emails,
      json_extract(ao.json, '$.contact.note') AS note,
      CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER) AS created_ms,
      CAST(json_extract(ao.json, '$.timestamps.modified.unix_ms') AS INTEGER) AS modified_ms,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_contacts'
      ${timeClause}
    ORDER BY display_name COLLATE NOCASE ASC, ao.id ASC
    `,
    params,
  )) as IosContactRow[];
  return rows ?? [];
}

/**
 * Parsed iOS Safari browsing visits (History.db) for a partition. Only the
 * per-visit records carry a timestamp; the aggregate "site" records are excluded.
 */
export async function getIosBrowserHistory(
  evidenceId: number,
  partitionId: number,
): Promise<IosBrowserVisitRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.visit.unix_ms') AS INTEGER)"],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.visit.unix_ms') AS INTEGER) AS ts,
      json_extract(ao.json, '$.site.url') AS url,
      json_extract(ao.json, '$.site.host') AS host,
      json_extract(ao.json, '$.visit.title') AS title,
      CAST(json_extract(ao.json, '$.visit.is_redirect') AS INTEGER) AS is_redirect,
      CAST(json_extract(ao.json, '$.visit.load_successful') AS INTEGER) AS load_successful,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_safari'
      AND ao.kind = 'mobile.browser.visit'
      ${timeClause}
    ORDER BY ts DESC, ao.id DESC
    `,
    params,
  )) as IosBrowserVisitRow[];
  return rows ?? [];
}

/* ------------------------------------------------------------------ */
/* Cross-platform browser activity                                    */
/* ------------------------------------------------------------------ */

type BrowserPage<T> = { rows: T[]; rowCount: number };

function browserSearchClause(
  expressions: string[],
  search: string | undefined,
  params: any[],
): string {
  const value = search?.trim().toLocaleLowerCase();
  if (!value) return "";
  params.push(`%${value}%`);
  const placeholder = `$${params.length}`;
  return ` AND (${expressions
    .map((expr) => `LOWER(COALESCE(CAST(${expr} AS TEXT), '')) LIKE ${placeholder}`)
    .join(" OR ")})`;
}

function browserOrderBy(
  field: string | undefined,
  direction: "asc" | "desc" | undefined,
  fields: Record<string, string>,
  fallback: string,
): string {
  const expression = (field && fields[field]) || fallback;
  return `${expression} ${direction === "asc" ? "ASC" : "DESC"}`;
}

function browserPageBounds(query: BrowserActivityQuery): {
  limit: number;
  offset: number;
} {
  return {
    limit: Math.max(1, Math.min(500, Math.trunc(query.limit))),
    offset: Math.max(0, Math.trunc(query.offset)),
  };
}

/**
 * Browser visits from the neutral mobile/macOS parser envelopes.
 *
 * Filtering through `artifacts.tag` is intentional: Chrome, Edge and Brave
 * share `macos_chromium`, so filtering by parser would merge distinct browser
 * profiles in the investigator UI.
 */
export async function getBrowserActivityVisits(
  query: BrowserActivityQuery,
): Promise<BrowserPage<BrowserVisitRow>> {
  const db = await getEvidenceDb(query.evidenceId);
  const params: any[] = [query.evidenceId, query.partitionId, query.tag];
  const titleExpr =
    "COALESCE(json_extract(ao.json, '$.visit.title'), json_extract(ao.json, '$.site.title'))";
  const urlExpr = "json_extract(ao.json, '$.site.url')";
  const hostExpr = "json_extract(ao.json, '$.site.host')";
  const sourceExpr =
    "COALESCE(json_extract(ao.json, '$.source.path'), sf.absolute_path)";
  const tsExpr =
    "CAST(json_extract(ao.json, '$.timestamps.visit.unix_ms') AS INTEGER)";

  let where = `
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND a.tag = $3
      AND ao.kind IN ('mobile.browser.visit', 'macos.browser.visit')`;
  where += browserSearchClause(
    [titleExpr, urlExpr, hostExpr, sourceExpr, "ao.parser"],
    query.search,
    params,
  );
  where += msTimeFilterClause([tsExpr], params);

  const countRows = (await db.select(
    `SELECT COUNT(*) AS count
     FROM artifact_objects ao
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}`,
    params,
  )) as Array<{ count: number }>;

  const { limit, offset } = browserPageBounds(query);
  const dataParams = [...params, limit, offset];
  const orderBy = browserOrderBy(
    query.sortField,
    query.sortDirection,
    {
      ts: "ts",
      title: "title COLLATE NOCASE",
      host: "host COLLATE NOCASE",
      url: "url COLLATE NOCASE",
      parser: "ao.parser",
      source_path: "source_path COLLATE NOCASE",
    },
    "ts",
  );

  const rows = (await db.select(
    `SELECT
       ao.id AS id,
       a.tag AS tag,
       ao.parser AS parser,
       json_extract(ao.json, '$.platform') AS platform,
       ${tsExpr} AS ts,
       ${titleExpr} AS title,
       ${urlExpr} AS url,
       ${hostExpr} AS host,
       COALESCE(
         json_extract(ao.json, '$.visit.transition_core'),
         CAST(json_extract(ao.json, '$.visit.visit_type_code') AS TEXT),
         CAST(json_extract(ao.json, '$.visit.origin_code') AS TEXT)
       ) AS transition,
       CAST(json_extract(ao.json, '$.visit.is_redirect') AS INTEGER) AS is_redirect,
       CAST(json_extract(ao.json, '$.visit.load_successful') AS INTEGER) AS load_successful,
       ${sourceExpr} AS source_path,
       ao.json AS json
     FROM artifact_objects ao
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}
     ORDER BY ${orderBy}, ao.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams,
  )) as BrowserVisitRow[];

  return { rows: rows ?? [], rowCount: Number(countRows[0]?.count ?? 0) };
}

/**
 * Aggregate sites from visit records in SQL. Counts and first/last timestamps
 * therefore describe the active investigation time window, not stale counters
 * copied from a browser database's site table.
 */
export async function getBrowserActivitySites(
  query: BrowserActivityQuery,
): Promise<BrowserPage<BrowserSiteRow>> {
  const db = await getEvidenceDb(query.evidenceId);
  const params: any[] = [query.evidenceId, query.partitionId, query.tag];
  const titleExpr =
    "COALESCE(json_extract(ao.json, '$.visit.title'), json_extract(ao.json, '$.site.title'))";
  const urlExpr = "json_extract(ao.json, '$.site.url')";
  const hostExpr = "json_extract(ao.json, '$.site.host')";
  const sourceExpr =
    "COALESCE(json_extract(ao.json, '$.source.path'), sf.absolute_path)";
  const tsExpr =
    "CAST(json_extract(ao.json, '$.timestamps.visit.unix_ms') AS INTEGER)";

  let where = `
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND a.tag = $3
      AND ao.kind IN ('mobile.browser.visit', 'macos.browser.visit')`;
  where += browserSearchClause(
    [titleExpr, urlExpr, hostExpr, sourceExpr, "ao.parser"],
    query.search,
    params,
  );
  where += msTimeFilterClause([tsExpr], params);

  const groupedFrom = `
    FROM artifact_objects ao
    INNER JOIN artifacts a ON a.id = ao.artifact_id
    LEFT JOIN system_files sf ON sf.id = ao.file_id
    ${where}
    GROUP BY COALESCE(${urlExpr}, 'artifact:' || ao.id), ${hostExpr}`;

  const countRows = (await db.select(
    `SELECT COUNT(*) AS count FROM (SELECT 1 ${groupedFrom}) grouped_sites`,
    params,
  )) as Array<{ count: number }>;

  const { limit, offset } = browserPageBounds(query);
  const dataParams = [...params, limit, offset];
  const orderBy = browserOrderBy(
    query.sortField,
    query.sortDirection,
    {
      visit_count: "visit_count",
      first_visit_ms: "first_visit_ms",
      last_visit_ms: "last_visit_ms",
      title: "title COLLATE NOCASE",
      host: "host COLLATE NOCASE",
      url: "url COLLATE NOCASE",
      parser: "parser",
      source_path: "source_path COLLATE NOCASE",
    },
    "last_visit_ms",
  );

  const rows = (await db.select(
    `SELECT
       MIN(ao.id) AS id,
       a.tag AS tag,
       GROUP_CONCAT(DISTINCT ao.parser) AS parser,
       MAX(${titleExpr}) AS title,
       ${urlExpr} AS url,
       ${hostExpr} AS host,
       COUNT(*) AS visit_count,
       MIN(${tsExpr}) AS first_visit_ms,
       MAX(${tsExpr}) AS last_visit_ms,
       MIN(${sourceExpr}) AS source_path,
       MIN(ao.json) AS json
     ${groupedFrom}
     ORDER BY ${orderBy}, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams,
  )) as BrowserSiteRow[];

  return {
    rows: (rows ?? []).map((row) => ({
      ...row,
      visit_count: Number(row.visit_count ?? 0),
    })),
    rowCount: Number(countRows[0]?.count ?? 0),
  };
}

/** Parsed Chromium-family downloads for the active artifact tag. */
export async function getBrowserActivityDownloads(
  query: BrowserActivityQuery,
): Promise<BrowserPage<BrowserDownloadRow>> {
  const db = await getEvidenceDb(query.evidenceId);
  const params: any[] = [query.evidenceId, query.partitionId, query.tag];
  const targetExpr = "json_extract(ao.json, '$.download.target_path')";
  const urlExpr = "json_extract(ao.json, '$.download.url')";
  const hostExpr = "json_extract(ao.json, '$.download.host')";
  const sourceExpr =
    "COALESCE(json_extract(ao.json, '$.source.path'), sf.absolute_path)";
  const startExpr =
    "CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER)";
  const endExpr =
    "CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER)";

  let where = `
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND a.tag = $3
      AND ao.kind = 'macos.browser.download'`;
  where += browserSearchClause(
    [targetExpr, urlExpr, hostExpr, sourceExpr, "ao.parser"],
    query.search,
    params,
  );
  where += msTimeFilterClause([startExpr, endExpr], params);

  const countRows = (await db.select(
    `SELECT COUNT(*) AS count
     FROM artifact_objects ao
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}`,
    params,
  )) as Array<{ count: number }>;

  const { limit, offset } = browserPageBounds(query);
  const dataParams = [...params, limit, offset];
  const orderBy = browserOrderBy(
    query.sortField,
    query.sortDirection,
    {
      start_ms: "start_ms",
      end_ms: "end_ms",
      target_path: "target_path COLLATE NOCASE",
      host: "host COLLATE NOCASE",
      url: "url COLLATE NOCASE",
      received_bytes: "received_bytes",
      total_bytes: "total_bytes",
      parser: "ao.parser",
      source_path: "source_path COLLATE NOCASE",
    },
    "start_ms",
  );

  const rows = (await db.select(
    `SELECT
       ao.id AS id,
       a.tag AS tag,
       ao.parser AS parser,
       ${startExpr} AS start_ms,
       ${endExpr} AS end_ms,
       ${targetExpr} AS target_path,
       ${urlExpr} AS url,
       ${hostExpr} AS host,
       CAST(json_extract(ao.json, '$.download.received_bytes') AS INTEGER) AS received_bytes,
       CAST(json_extract(ao.json, '$.download.total_bytes') AS INTEGER) AS total_bytes,
       ${sourceExpr} AS source_path,
       ao.json AS json
     FROM artifact_objects ao
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}
     ORDER BY ${orderBy}, ao.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams,
  )) as BrowserDownloadRow[];

  return { rows: rows ?? [], rowCount: Number(countRows[0]?.count ?? 0) };
}

/* ------------------------------------------------------------------ */
/* Focused macOS artifact panels                                      */
/* ------------------------------------------------------------------ */

type MacosPanelSql = {
  parser: string;
  primary: string;
  secondary: string;
  tertiary: string;
  detail: string;
  state: string;
  numeric: string;
  timestamps: string[];
  sortFields: Record<string, string>;
  defaultSort: string;
};

const MACOS_SOURCE_EXPR =
  "COALESCE(NULLIF(json_extract(ao.json, '$.source.path'), ''), sf.absolute_path)";

const macosArtifactIndexCache = new Map<number, Promise<string>>();

async function macosArtifactIndexHint(
  db: Database,
  evidenceId: number,
): Promise<string> {
  let cached = macosArtifactIndexCache.get(evidenceId);
  if (!cached) {
    cached = db
      .select<Array<{ name: string }>>("PRAGMA index_list('artifact_objects')")
      .then((indexes) => {
        const names = new Set((indexes ?? []).map(({ name }) => name));
        if (names.has("idx_artifact_objects_scope_parser_kind")) {
          return " INDEXED BY idx_artifact_objects_scope_parser_kind";
        }
        if (names.has("idx_artifact_objects_parser_kind")) {
          return " INDEXED BY idx_artifact_objects_parser_kind";
        }
        return "";
      })
      .catch(() => "");
    macosArtifactIndexCache.set(evidenceId, cached);
  }
  return cached;
}

function macosPanelSql(panel: MacosArtifactPanel): MacosPanelSql {
  const commonSortFields: Record<string, string> = {
    id: "ao.id",
    parser: "ao.parser COLLATE NOCASE",
    kind: "ao.kind COLLATE NOCASE",
    source_path: `${MACOS_SOURCE_EXPR} COLLATE NOCASE`,
    timestamp_ms: "timestamp_ms",
    secondary_timestamp_ms: "secondary_timestamp_ms",
    primary_value: "primary_value COLLATE NOCASE",
    secondary_value: "secondary_value COLLATE NOCASE",
    tertiary_value: "tertiary_value COLLATE NOCASE",
    detail_value: "detail_value COLLATE NOCASE",
    state_value: "state_value COLLATE NOCASE",
    numeric_value: "numeric_value",
  };

  switch (panel) {
    case "recent_items":
      return {
        parser: "macos_sharedfilelist",
        primary:
          "COALESCE(NULLIF(json_extract(ao.json, '$.item.name'), ''), NULLIF(json_extract(ao.json, '$.item.file_name'), ''), NULLIF(ao.text, ''))",
        secondary: "json_extract(ao.json, '$.item.path')",
        tertiary: "json_extract(ao.json, '$.list')",
        detail: "json_extract(ao.json, '$.item.volume_name')",
        state: "json_extract(ao.json, '$.item.uuid')",
        numeric: "CAST(json_extract(ao.json, '$.item.cnid_count') AS INTEGER)",
        timestamps: [],
        sortFields: commonSortFields,
        defaultSort: "primary_value",
      };
    case "keychain":
      return {
        parser: "macos_keychain",
        primary: `COALESCE(
          json_extract(ao.json, '$.item.service'),
          json_extract(ao.json, '$.item.server'),
          json_extract(ao.json, '$.item.label'),
          ao.text
        )`,
        secondary: "json_extract(ao.json, '$.item.account')",
        tertiary: "json_extract(ao.json, '$.class')",
        detail: `COALESCE(
          json_extract(ao.json, '$.item.access_group'),
          json_extract(ao.json, '$.item.description')
        )`,
        state: `COALESCE(
          json_extract(ao.json, '$.item.protection_class'),
          json_extract(ao.json, '$.format')
        )`,
        numeric: `COALESCE(
          CAST(json_extract(ao.json, '$.item.port') AS INTEGER),
          CAST(json_extract(ao.json, '$.summary.record_count') AS INTEGER),
          CAST(json_extract(ao.json, '$.item.tombstone') AS INTEGER)
        )`,
        timestamps: [
          "CAST(json_extract(ao.json, '$.timestamps.modified.unix_ms') AS INTEGER)",
          "CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER)",
        ],
        sortFields: commonSortFields,
        defaultSort: "timestamp_ms",
      };
    case "quarantine":
      return {
        parser: "macos_quarantine",
        primary:
          "COALESCE(json_extract(ao.json, '$.event.agent_name'), ao.text)",
        secondary: "json_extract(ao.json, '$.event.data_url')",
        tertiary: "json_extract(ao.json, '$.event.origin_url')",
        detail: `COALESCE(
          json_extract(ao.json, '$.event.origin_title'),
          json_extract(ao.json, '$.event.sender_name'),
          json_extract(ao.json, '$.event.sender_address')
        )`,
        state: "json_extract(ao.json, '$.event.event_id')",
        numeric: "CAST(json_extract(ao.json, '$.event.type_number') AS INTEGER)",
        timestamps: [
          "CAST(json_extract(ao.json, '$.timestamps.quarantine.unix_ms') AS INTEGER)",
        ],
        sortFields: commonSortFields,
        defaultSort: "timestamp_ms",
      };
    case "persistence":
      return {
        parser: "macos_launchd",
        primary: "COALESCE(json_extract(ao.json, '$.job.label'), ao.text)",
        secondary: `COALESCE(
          json_extract(ao.json, '$.job.executable'),
          json_extract(ao.json, '$.job.program')
        )`,
        tertiary: "json_extract(ao.json, '$.job_type')",
        detail: "json_extract(ao.json, '$.domain')",
        state: `CASE
          WHEN CAST(json_extract(ao.json, '$.job.disabled') AS INTEGER) = 1 THEN 'Disabled'
          WHEN CAST(json_extract(ao.json, '$.triggers.run_at_load') AS INTEGER) = 1 THEN 'Run at load'
          WHEN json_extract(ao.json, '$.triggers.keep_alive') IS NOT NULL THEN 'Keep alive'
          ELSE NULL
        END`,
        numeric:
          "CAST(json_extract(ao.json, '$.triggers.start_interval_seconds') AS INTEGER)",
        timestamps: [],
        sortFields: commonSortFields,
        defaultSort: "primary_value",
      };
    case "login_configuration":
      return {
        parser: "macos_loginwindow",
        primary: `COALESCE(
          json_extract(ao.json, '$.session.last_user_name'),
          json_extract(ao.json, '$.item.display_name'),
          json_extract(ao.json, '$.hook.phase'),
          NULLIF(ao.text, ''),
          json_extract(ao.json, '$.record_type')
        )`,
        secondary: `COALESCE(
          json_extract(ao.json, '$.item.path'),
          json_extract(ao.json, '$.hook.path'),
          json_extract(ao.json, '$.session.auto_login_user'),
          json_extract(ao.json, '$.version.system_version')
        )`,
        tertiary: "json_extract(ao.json, '$.scope')",
        detail: `COALESCE(
          json_extract(ao.json, '$.item.bundle_id'),
          json_extract(ao.json, '$.version.build_version'),
          json_extract(ao.json, '$.persistence.login_hook')
        )`,
        state: "ao.kind",
        numeric: `COALESCE(
          CAST(json_extract(ao.json, '$.session.relaunch_item_count') AS INTEGER),
          CAST(json_extract(ao.json, '$.persistence.legacy_login_item_count') AS INTEGER)
        )`,
        timestamps: [],
        sortFields: commonSortFields,
        defaultSort: "tertiary_value",
      };
    case "network_configuration":
      return {
        parser: "macos_network",
        primary: `COALESCE(
          json_extract(ao.json, '$.network.ssid'),
          json_extract(ao.json, '$.service.name'),
          json_extract(ao.json, '$.interface.display_name'),
          json_extract(ao.json, '$.lease.ip_address'),
          ao.text
        )`,
        secondary: `COALESCE(
          json_extract(ao.json, '$.network.bssid'),
          json_extract(ao.json, '$.service.interface.device'),
          json_extract(ao.json, '$.interface.bsd_name'),
          json_extract(ao.json, '$.lease.interface')
        )`,
        tertiary: "json_extract(ao.json, '$.record_type')",
        detail: `COALESCE(
          json_extract(ao.json, '$.network.security_type'),
          json_extract(ao.json, '$.service.ipv4.method'),
          json_extract(ao.json, '$.interface.type'),
          json_extract(ao.json, '$.lease.router_ip')
        )`,
        state: `COALESCE(
          CAST(json_extract(ao.json, '$.network.auto_join') AS TEXT),
          CAST(json_extract(ao.json, '$.service.enabled') AS TEXT),
          CAST(json_extract(ao.json, '$.interface.active') AS TEXT)
        )`,
        numeric: `COALESCE(
          CAST(json_extract(ao.json, '$.lease.lease_length_seconds') AS INTEGER),
          CAST(json_extract(ao.json, '$.network.private_mac_mode') AS INTEGER)
        )`,
        timestamps: [
          `COALESCE(
            CAST(json_extract(ao.json, '$.timestamps.last_connected.unix_ms') AS INTEGER),
            CAST(json_extract(ao.json, '$.timestamps.lease_start.unix_ms') AS INTEGER),
            CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER)
          )`,
          `COALESCE(
            CAST(json_extract(ao.json, '$.timestamps.lease_expiration.unix_ms') AS INTEGER),
            CAST(json_extract(ao.json, '$.timestamps.captive_login.unix_ms') AS INTEGER)
          )`,
        ],
        sortFields: commonSortFields,
        defaultSort: "tertiary_value",
      };
  }
}

/**
 * One server-bounded page for the V4 macOS panels. All scope and parser values
 * are exact matches; only the returned page carries full JSON to the frontend.
 */
export async function getMacosArtifactPage(
  query: MacosArtifactQuery,
): Promise<MacosArtifactPage> {
  const db = await getEvidenceDb(query.evidenceId);
  const indexHint = await macosArtifactIndexHint(db, query.evidenceId);
  const config = macosPanelSql(query.panel);
  const params: any[] = [
    query.evidenceId,
    query.partitionId,
    query.tag,
    query.category,
    config.parser,
  ];
  const timestampExpr = config.timestamps[0] ?? "NULL";
  const secondaryTimestampExpr = config.timestamps[1] ?? "NULL";
  const search = query.search?.trim().toLocaleLowerCase();
  let searchClause = "";
  if (search) {
    params.push(`%${escapeSqlLike(search)}%`);
    const placeholder = `$${params.length}`;
    searchClause = ` AND (
      LOWER(COALESCE(CAST(${config.primary} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(CAST(${config.secondary} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(CAST(${config.tertiary} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(CAST(${config.detail} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(CAST(${MACOS_SOURCE_EXPR} AS TEXT), '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(ao.text, '')) LIKE ${placeholder} ESCAPE '\\'
      OR LOWER(COALESCE(ao.kind, '')) LIKE ${placeholder} ESCAPE '\\'
    )`;
  }
  const timeClause =
    config.timestamps.length > 0
      ? msTimeFilterClause(config.timestamps, params)
      : "";
  const where = `
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND a.tag = $3
      AND a.category = $4
      AND ao.parser = $5
      ${searchClause}
      ${timeClause}`;

  const countRows = await db.select<Array<{ count: number | string }>>(
    `SELECT COUNT(*) AS count
     FROM artifact_objects ao${indexHint}
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}`,
    params,
  );

  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(250, Math.trunc(query.limit)))
    : 50;
  const offset = Number.isFinite(query.offset)
    ? Math.max(0, Math.trunc(query.offset))
    : 0;
  const sortExpression =
    (query.sortField && config.sortFields[query.sortField]) ||
    config.sortFields[config.defaultSort] ||
    "ao.id";
  const sortDirection = query.sortDirection === "asc" ? "ASC" : "DESC";

  const rows = await db.select<MacosArtifactPage["rows"]>(
    `SELECT
       ao.id AS id,
       ao.artifact_id AS artifact_id,
       ao.file_id AS file_id,
       sf.identifier AS fs_identifier,
       sf.size AS file_size,
       sf.absolute_path AS file_path,
       ${MACOS_SOURCE_EXPR} AS source_path,
       a.tag AS tag,
       a.category AS category,
       ao.parser AS parser,
       ao.kind AS kind,
       json_extract(ao.json, '$.record_type') AS record_type,
       ao.text AS text,
       ${timestampExpr} AS timestamp_ms,
       ${secondaryTimestampExpr} AS secondary_timestamp_ms,
       ${config.primary} AS primary_value,
       ${config.secondary} AS secondary_value,
       ${config.tertiary} AS tertiary_value,
       ${config.detail} AS detail_value,
       ${config.state} AS state_value,
       ${config.numeric} AS numeric_value,
       ao.json AS json
     FROM artifact_objects ao${indexHint}
     INNER JOIN artifacts a ON a.id = ao.artifact_id
     LEFT JOIN system_files sf ON sf.id = ao.file_id
     ${where}
     ORDER BY ${sortExpression} ${sortDirection}, ao.id ${sortDirection}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    rows: (rows ?? []).map((row) => ({
      ...row,
      id: Number(row.id),
      artifact_id: Number(row.artifact_id),
      file_id: row.file_id == null ? null : Number(row.file_id),
      fs_identifier:
        row.fs_identifier == null ? null : Number(row.fs_identifier),
      file_size: row.file_size == null ? null : Number(row.file_size),
      timestamp_ms:
        row.timestamp_ms == null ? null : Number(row.timestamp_ms),
      secondary_timestamp_ms:
        row.secondary_timestamp_ms == null
          ? null
          : Number(row.secondary_timestamp_ms),
      numeric_value:
        row.numeric_value == null ? null : Number(row.numeric_value),
    })),
    rowCount: Number(countRows?.[0]?.count ?? 0),
  };
}

/**
 * Parsed iOS routined GPS location fixes for a partition, ordered chronologically
 * for track/timeline rendering. Only rows with a coordinate are returned.
 */
export async function getIosLocationFixes(
  evidenceId: number,
  partitionId: number,
): Promise<IosLocationFixRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.fix.unix_ms') AS INTEGER)"],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.fix.unix_ms') AS INTEGER) AS ts,
      json_extract(ao.json, '$.location.latitude') AS latitude,
      json_extract(ao.json, '$.location.longitude') AS longitude,
      json_extract(ao.json, '$.location.altitude') AS altitude,
      json_extract(ao.json, '$.location.speed') AS speed,
      json_extract(ao.json, '$.location.course') AS course,
      json_extract(ao.json, '$.location.horizontal_accuracy') AS horizontal_accuracy,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_routined'
      AND ao.kind = 'mobile.location.fix'
      AND json_extract(ao.json, '$.location.latitude') IS NOT NULL
      AND json_extract(ao.json, '$.location.longitude') IS NOT NULL
      ${timeClause}
    ORDER BY ts ASC, ao.id ASC
    `,
    params,
  )) as IosLocationFixRow[];
  return rows ?? [];
}

/** Parsed iOS Calendar events (Calendar.sqlitedb) for a partition. */
export async function getIosCalendarEvents(
  evidenceId: number,
  partitionId: number,
): Promise<IosCalendarEventRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  // An event is in range if it starts or ends inside the window.
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER) AS start_ms,
      CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER) AS end_ms,
      json_extract(ao.json, '$.event.summary') AS summary,
      CAST(json_extract(ao.json, '$.event.all_day') AS INTEGER) AS all_day,
      json_extract(ao.json, '$.event.status') AS status,
      json_extract(ao.json, '$.event.availability') AS availability,
      json_extract(ao.json, '$.location.title') AS location_title,
      json_extract(ao.json, '$.location.address') AS location_address,
      json_extract(ao.json, '$.event.url') AS url,
      CAST(json_extract(ao.json, '$.event.has_attendees') AS INTEGER) AS has_attendees,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_calendar'
      ${timeClause}
    ORDER BY start_ms DESC, ao.id DESC
    `,
    params,
  )) as IosCalendarEventRow[];
  return rows ?? [];
}

/** Parsed iOS Mail messages (Envelope Index + Protected Index) for a partition. */
export async function getIosMailMessages(
  evidenceId: number,
  partitionId: number,
): Promise<IosMailMessageRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  // Match on either leg so a message sent before but received inside the
  // window (or vice versa) is not lost.
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.received.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.sent.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.received.unix_ms') AS INTEGER) AS date_received_ms,
      CAST(json_extract(ao.json, '$.timestamps.sent.unix_ms') AS INTEGER) AS date_sent_ms,
      json_extract(ao.json, '$.message.subject') AS subject,
      json_extract(ao.json, '$.from.address') AS from_address,
      json_extract(ao.json, '$.to_display') AS to_addresses,
      json_extract(ao.json, '$.message.mailbox') AS mailbox,
      CAST(json_extract(ao.json, '$.message.read') AS INTEGER) AS read,
      CAST(json_extract(ao.json, '$.message.flagged') AS INTEGER) AS flagged,
      CAST(json_extract(ao.json, '$.message.deleted') AS INTEGER) AS deleted,
      CAST(json_extract(ao.json, '$.message.size') AS INTEGER) AS size,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_mail'
      ${timeClause}
    ORDER BY date_received_ms DESC, ao.id DESC
    `,
    params,
  )) as IosMailMessageRow[];
  return rows ?? [];
}

/** Parsed iOS Notes metadata (NoteStore.sqlite) for a partition. */
export async function getIosNotes(
  evidenceId: number,
  partitionId: number,
): Promise<IosNoteRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.modified.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      json_extract(ao.json, '$.note.title') AS title,
      json_extract(ao.json, '$.note.snippet') AS snippet,
      json_extract(ao.json, '$.note.folder') AS folder,
      CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER) AS created_ms,
      CAST(json_extract(ao.json, '$.timestamps.modified.unix_ms') AS INTEGER) AS modified_ms,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_notes'
      ${timeClause}
    ORDER BY modified_ms DESC, ao.id DESC
    `,
    params,
  )) as IosNoteRow[];
  return rows ?? [];
}

/* ------------------------------------------------------------------ */
/* Global time filter predicates                                       */
/* ------------------------------------------------------------------ */

/**
 * The active investigation time window, read straight from the Zustand store.
 *
 * Query helpers consult the store rather than taking the range as a parameter,
 * so a new filtered view needs no signature changes. Components still list the
 * filter in their effect dependencies so they refetch when it moves.
 */
function activeTimeWindow(): {
  start: number | null;
  end: number | null;
  fileTimeField: FileTimeField;
} {
  const s = useTimeFilterStore.getState();
  return { start: s.start, end: s.end, fileTimeField: s.fileTimeField };
}

/**
 * AND-clause constraining one or more epoch-**millisecond** expressions to the
 * active window. When several expressions are given the row matches if ANY of
 * them lies inside (e.g. a contact created OR modified in range). Appends bound
 * values to `params` and returns "" when no filter is active.
 */
export function msTimeFilterClause(exprs: string[], params: any[]): string {
  const match = msTimeMatchExpr(exprs, params);
  return match === "1" ? "" : ` AND ${match}`;
}

/**
 * Boolean SQL expression that is true when one of `exprs` (epoch ms) falls in
 * the active window; the literal `1` when no filter is set. Usable both as a
 * WHERE predicate and inside an aggregate, e.g. counting how many of a
 * conversation's messages land in the window.
 */
export function msTimeMatchExpr(exprs: string[], params: any[]): string {
  const { start, end } = activeTimeWindow();
  if ((start == null && end == null) || exprs.length === 0) return "1";

  const perExpr = exprs.map((expr) => {
    const parts: string[] = [`${expr} IS NOT NULL`];
    if (start != null) {
      params.push(start);
      parts.push(`${expr} >= $${params.length}`);
    }
    if (end != null) {
      params.push(end);
      parts.push(`${expr} <= $${params.length}`);
    }
    return `(${parts.join(" AND ")})`;
  });

  return `(${perExpr.join(" OR ")})`;
}

/**
 * AND-clause for `system_files`-style rows, whose created/modified/accessed
 * columns are stored in Unix **seconds** (the indexer multiplies by 1000 when
 * building timeline_events). The investigator-selected field decides which
 * column(s) are consulted.
 */
export function fileTimeFilterClause(alias: string, params: any[]): string {
  const { start, end, fileTimeField } = activeTimeWindow();
  if (start == null && end == null) return "";

  const columns =
    fileTimeField === "any"
      ? ["created", "modified", "accessed"]
      : [fileTimeField];

  const perColumn = columns.map((col) => {
    const expr = `${alias}.${col}`;
    const parts: string[] = [`${expr} IS NOT NULL`, `${expr} > 0`];
    if (start != null) {
      params.push(Math.floor(start / 1000));
      parts.push(`${expr} >= $${params.length}`);
    }
    if (end != null) {
      params.push(Math.ceil(end / 1000));
      parts.push(`${expr} <= $${params.length}`);
    }
    return `(${parts.join(" AND ")})`;
  });

  return ` AND (${perColumn.join(" OR ")})`;
}

/** Timestamps below this are treated as unset/garbage for domain purposes. */
const TIME_DOMAIN_FLOOR_MS = 631_152_000_000; // 1990-01-01T00:00:00Z

export type EvidenceTimeBounds = {
  /** Robust display domain for the brush (epoch ms). */
  min: number | null;
  max: number | null;
  /** True extremes, including outliers. */
  absMin: number | null;
  absMax: number | null;
  /** Events falling outside [min, max] — disclosed, never silently dropped. */
  outliers: number;
  total: number;
};

/**
 * Activity bounds for a partition, used to size the global time-filter brush.
 *
 * A handful of zero-dated files or far-future calendar entries would otherwise
 * stretch the domain across decades and make the brush unusable, so the
 * displayed domain uses 0.1%/99.9% percentiles (with a sanity floor) while the
 * true extremes and the number of excluded events are reported alongside. The
 * date pickers remain unrestricted, so nothing becomes unreachable.
 */
export async function getEvidenceTimeBounds(
  evidenceId: number,
  partitionId: number,
): Promise<EvidenceTimeBounds> {
  const db = await getEvidenceDb(evidenceId);

  const rows = await db.select<
    Array<{
      n: number | null;
      abs_min: number | null;
      abs_max: number | null;
      p_lo: number | null;
      p_hi: number | null;
    }>
  >(
    `
    WITH t AS (
      SELECT ts FROM timeline_events
      WHERE evidence_id = $1 AND partition_id = $2 AND ts IS NOT NULL
    ), c AS (SELECT COUNT(*) AS n FROM t)
    SELECT
      (SELECT n FROM c) AS n,
      (SELECT MIN(ts) FROM t) AS abs_min,
      (SELECT MAX(ts) FROM t) AS abs_max,
      (SELECT ts FROM t ORDER BY ts ASC  LIMIT 1 OFFSET CAST((SELECT n FROM c) * 0.001 AS INTEGER)) AS p_lo,
      (SELECT ts FROM t ORDER BY ts DESC LIMIT 1 OFFSET CAST((SELECT n FROM c) * 0.001 AS INTEGER)) AS p_hi
    `,
    [evidenceId, partitionId],
  );

  const row = rows?.[0];
  const total = Number(row?.n ?? 0);
  const absMin = row?.abs_min == null ? null : Number(row.abs_min);
  const absMax = row?.abs_max == null ? null : Number(row.abs_max);

  if (!total || absMin == null || absMax == null) {
    return { min: null, max: null, absMin, absMax, outliers: 0, total };
  }

  // Percentiles only pay off with enough samples; small sets use true extremes.
  const useP = total >= 1000;
  let min = useP && row?.p_lo != null ? Number(row.p_lo) : absMin;
  let max = useP && row?.p_hi != null ? Number(row.p_hi) : absMax;

  if (min < TIME_DOMAIN_FLOOR_MS && absMax > TIME_DOMAIN_FLOOR_MS) {
    min = Math.max(min, TIME_DOMAIN_FLOOR_MS);
  }
  if (max <= min) {
    min = absMin;
    max = absMax;
  }

  const outlierRows = await db.select<Array<{ n: number }>>(
    `
    SELECT COUNT(*) AS n FROM timeline_events
    WHERE evidence_id = $1 AND partition_id = $2 AND ts IS NOT NULL
      AND (ts < $3 OR ts > $4)
    `,
    [evidenceId, partitionId, min, max],
  );

  return {
    min,
    max,
    absMin,
    absMax,
    outliers: Number(outlierRows?.[0]?.n ?? 0),
    total,
  };
}

/**
 * Parsed Photos library assets (ZASSET). This is the user's curated library —
 * distinct from every media file on disk — and is the only place the
 * hidden/trashed/favorite state and true capture date are recorded.
 */
export async function getIosPhotoAssetsPage(
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
): Promise<{ rows: IosPhotoAssetRow[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);
  const root = await getPhotoPathRoot(evidenceId, partitionId);

  const params: any[] = [evidenceId, partitionId, root];
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      json_extract(ao.json, '$.asset.filename') AS filename,
      json_extract(ao.json, '$.asset.relative_path') AS relative_path,
      json_extract(ao.json, '$.asset.kind') AS kind,
      CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER) AS created_ms,
      CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER) AS added_ms,
      CAST(json_extract(ao.json, '$.timestamps.trashed.unix_ms') AS INTEGER) AS trashed_ms,
      json_extract(ao.json, '$.location.latitude') AS latitude,
      json_extract(ao.json, '$.location.longitude') AS longitude,
      CAST(json_extract(ao.json, '$.asset.width') AS INTEGER) AS width,
      CAST(json_extract(ao.json, '$.asset.height') AS INTEGER) AS height,
      json_extract(ao.json, '$.asset.duration_seconds') AS duration_seconds,
      CAST(json_extract(ao.json, '$.asset.favorite') AS INTEGER) AS favorite,
      CAST(json_extract(ao.json, '$.asset.hidden') AS INTEGER) AS hidden,
      CAST(json_extract(ao.json, '$.asset.trashed') AS INTEGER) AS trashed,
      ao.json AS json,
      sf.id AS file_id,
      sf.host_path AS host_path,
      tf.id AS thumb_file_id,
      tf.host_path AS thumb_host_path,
      COUNT(*) OVER () AS total_count
    FROM artifact_objects ao
    LEFT JOIN system_files sf
      ON sf.evidence_id = ao.evidence_id
     AND sf.absolute_path =
         $3 || '${IOS_MEDIA_ROOT}' || json_extract(ao.json, '$.asset.relative_path')
    -- Photos keeps a rendered JPEG per asset under Thumbnails/V2/<path>/5005.JPG.
    LEFT JOIN system_files tf
      ON tf.evidence_id = ao.evidence_id
     AND tf.absolute_path =
         $3 || '${IOS_THUMBNAIL_ROOT}' || json_extract(ao.json, '$.asset.relative_path')
         || '/${IOS_THUMBNAIL_FILE}'
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_photos'
      ${timeClause}
    ORDER BY created_ms DESC, ao.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    [...params, limit, offset],
  )) as (IosPhotoAssetRow & { total_count: number })[];

  return {
    rows: rows ?? [],
    rowCount: rows?.length ? Number(rows[0].total_count ?? 0) : 0,
  };
}

/** Unpaginated variant retained for aggregate callers. */
export async function getIosPhotoAssets(
  evidenceId: number,
  partitionId: number,
): Promise<IosPhotoAssetRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  // Capture date, or failing that the date it entered the library.
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      json_extract(ao.json, '$.asset.filename') AS filename,
      json_extract(ao.json, '$.asset.relative_path') AS relative_path,
      json_extract(ao.json, '$.asset.kind') AS kind,
      CAST(json_extract(ao.json, '$.timestamps.created.unix_ms') AS INTEGER) AS created_ms,
      CAST(json_extract(ao.json, '$.timestamps.added.unix_ms') AS INTEGER) AS added_ms,
      CAST(json_extract(ao.json, '$.timestamps.trashed.unix_ms') AS INTEGER) AS trashed_ms,
      json_extract(ao.json, '$.location.latitude') AS latitude,
      json_extract(ao.json, '$.location.longitude') AS longitude,
      CAST(json_extract(ao.json, '$.asset.width') AS INTEGER) AS width,
      CAST(json_extract(ao.json, '$.asset.height') AS INTEGER) AS height,
      json_extract(ao.json, '$.asset.duration_seconds') AS duration_seconds,
      CAST(json_extract(ao.json, '$.asset.favorite') AS INTEGER) AS favorite,
      CAST(json_extract(ao.json, '$.asset.hidden') AS INTEGER) AS hidden,
      CAST(json_extract(ao.json, '$.asset.trashed') AS INTEGER) AS trashed,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_photos'
      ${timeClause}
    ORDER BY created_ms DESC, ao.id DESC
    `,
    params,
  )) as IosPhotoAssetRow[];
  return rows ?? [];
}

/**
 * Parsed knowledgeC behavioural events (app usage, device lock, backlight,
 * web usage, notifications). Drives the Activity swimlane and event grid.
 */
export async function getIosActivityEvents(
  evidenceId: number,
  partitionId: number,
): Promise<IosActivityEventRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER) AS start_ms,
      CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER) AS end_ms,
      json_extract(ao.json, '$.event.stream') AS stream,
      json_extract(ao.json, '$.event.family') AS family,
      json_extract(ao.json, '$.event.bundle_id') AS bundle_id,
      json_extract(ao.json, '$.summary') AS summary,
      CAST(json_extract(ao.json, '$.event.value_int') AS INTEGER) AS value_int,
      json_extract(ao.json, '$.event.duration_seconds') AS duration_seconds,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_knowledgec'
      ${timeClause}
    ORDER BY start_ms ASC, ao.id ASC
    `,
    params,
  )) as IosActivityEventRow[];
  return rows ?? [];
}

const IOS_MEDIA_ROOT = "/private/var/mobile/Media/";
const IOS_THUMBNAIL_ROOT = "/private/var/mobile/Media/PhotoData/Thumbnails/V2/";
const IOS_THUMBNAIL_FILE = "5005.JPG";

/** Cached per evidence+partition: the path prefix in front of the iOS root. */
const photoRootCache = new Map<string, string>();

/**
 * Path prefix that evidence paths carry in front of `/private/var/mobile/`.
 *
 * Derived from the Photos artifact's own file row (a primary-key lookup, ~40ms)
 * rather than scanning system_files. Knowing it turns asset resolution into an
 * equality match on absolute_path, which uses idx_files_ev_path — roughly 12x
 * faster than suffix-matching a filename set client-side.
 */
async function getPhotoPathRoot(
  evidenceId: number,
  partitionId: number,
): Promise<string> {
  const key = `${evidenceId}:${partitionId}`;
  const cached = photoRootCache.get(key);
  if (cached !== undefined) return cached;

  const db = await getEvidenceDb(evidenceId);
  const rows = await db.select<{ root: string | null }[]>(
    `
    SELECT substr(sf.absolute_path, 1, instr(sf.absolute_path, '/private/var/mobile/') - 1) AS root
    FROM artifacts a
    JOIN system_files sf ON sf.id = a.file_id
    WHERE a.evidence_id = $1 AND a.partition_id = $2 AND a.parser = 'mobile_ios_photos'
    LIMIT 1
    `,
    [evidenceId, partitionId],
  );
  const root = rows?.[0]?.root ?? "";
  photoRootCache.set(key, root);
  return root;
}

/** Parsed iOS TCC privacy grants (which app was allowed each resource). */
export async function getIosTccGrants(
  evidenceId: number,
  partitionId: number,
): Promise<IosTccGrantRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.last_modified.unix_ms') AS INTEGER)"],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      json_extract(ao.json, '$.client.id') AS client,
      json_extract(ao.json, '$.client.type') AS client_type,
      json_extract(ao.json, '$.permission.service') AS service,
      json_extract(ao.json, '$.permission.service_name') AS service_name,
      json_extract(ao.json, '$.permission.decision') AS decision,
      CAST(json_extract(ao.json, '$.permission.auth_reason_code') AS INTEGER) AS auth_reason_code,
      json_extract(ao.json, '$.permission.indirect_object') AS indirect_object,
      CAST(json_extract(ao.json, '$.timestamps.last_modified.unix_ms') AS INTEGER) AS last_modified_ms,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_tcc'
      ${timeClause}
    ORDER BY last_modified_ms DESC, ao.id DESC
    `,
    params,
  )) as IosTccGrantRow[];
  return rows ?? [];
}

/** Parsed CoreDuet interactions (per-app communication counterparts). */
export async function getIosInteractions(
  evidenceId: number,
  partitionId: number,
): Promise<IosInteractionRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    [
      "CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER)",
      "CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER)",
    ],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.start.unix_ms') AS INTEGER) AS start_ms,
      CAST(json_extract(ao.json, '$.timestamps.end.unix_ms') AS INTEGER) AS end_ms,
      json_extract(ao.json, '$.interaction.bundle_id') AS bundle_id,
      json_extract(ao.json, '$.interaction.target_bundle_id') AS target_bundle_id,
      json_extract(ao.json, '$.interaction.direction') AS direction,
      json_extract(ao.json, '$.counterpart.display_name') AS counterpart_name,
      json_extract(ao.json, '$.counterpart.identifier') AS counterpart_id,
      CAST(json_extract(ao.json, '$.interaction.recipient_count') AS INTEGER) AS recipient_count,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_interactionc'
      ${timeClause}
    ORDER BY start_ms DESC, ao.id DESC
    `,
    params,
  )) as IosInteractionRow[];
  return rows ?? [];
}

export type IosDataUsageAppTotal = {
  app: string;
  wwan_in: number;
  wwan_out: number;
  wifi_in: number;
  wifi_out: number;
  total: number;
};

/**
 * Per-application network totals, aggregated in SQL and capped to the busiest
 * `limit` apps so the chart never pulls the full row set into the frontend.
 */
export async function getIosDataUsageTopApps(
  evidenceId: number,
  partitionId: number,
  limit: number,
  orderBy: "cellular" | "wifi" | "total" = "cellular",
): Promise<IosDataUsageAppTotal[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.usage.unix_ms') AS INTEGER)"],
    params,
  );
  const orderExpr =
    orderBy === "wifi"
      ? "(wifi_in + wifi_out)"
      : orderBy === "total"
        ? "total"
        : "(wwan_in + wwan_out)";
  const limitIdx = params.length + 1;

  const rows = (await db.select(
    `
    SELECT
      COALESCE(
        NULLIF(json_extract(ao.json, '$.process.bundle_name'), ''),
        NULLIF(json_extract(ao.json, '$.process.name'), ''),
        'unknown'
      ) AS app,
      SUM(COALESCE(json_extract(ao.json, '$.usage.wwan_in'), 0))  AS wwan_in,
      SUM(COALESCE(json_extract(ao.json, '$.usage.wwan_out'), 0)) AS wwan_out,
      SUM(COALESCE(json_extract(ao.json, '$.usage.wifi_in'), 0))  AS wifi_in,
      SUM(COALESCE(json_extract(ao.json, '$.usage.wifi_out'), 0)) AS wifi_out,
      SUM(
        COALESCE(json_extract(ao.json, '$.usage.wwan_in'), 0) +
        COALESCE(json_extract(ao.json, '$.usage.wwan_out'), 0) +
        COALESCE(json_extract(ao.json, '$.usage.wifi_in'), 0) +
        COALESCE(json_extract(ao.json, '$.usage.wifi_out'), 0)
      ) AS total
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_datausage'
      ${timeClause}
    GROUP BY app
    HAVING ${orderExpr} > 0
    ORDER BY ${orderExpr} DESC
    LIMIT $${limitIdx}
    `,
    [...params, limit],
  )) as IosDataUsageAppTotal[];

  return (rows ?? []).map((r) => ({
    app: r.app,
    wwan_in: Number(r.wwan_in ?? 0),
    wwan_out: Number(r.wwan_out ?? 0),
    wifi_in: Number(r.wifi_in ?? 0),
    wifi_out: Number(r.wifi_out ?? 0),
    total: Number(r.total ?? 0),
  }));
}

/** Parsed per-process cellular/Wi-Fi network usage. */
export async function getIosDataUsage(
  evidenceId: number,
  partitionId: number,
): Promise<IosDataUsageRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const timeClause = msTimeFilterClause(
    ["CAST(json_extract(ao.json, '$.timestamps.usage.unix_ms') AS INTEGER)"],
    params,
  );
  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.timestamps.usage.unix_ms') AS INTEGER) AS ts,
      json_extract(ao.json, '$.process.name') AS process_name,
      json_extract(ao.json, '$.process.bundle_name') AS bundle_name,
      json_extract(ao.json, '$.usage.wifi_in') AS wifi_in,
      json_extract(ao.json, '$.usage.wifi_out') AS wifi_out,
      json_extract(ao.json, '$.usage.wwan_in') AS wwan_in,
      json_extract(ao.json, '$.usage.wwan_out') AS wwan_out,
      ao.json AS json
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_datausage'
      ${timeClause}
    ORDER BY (COALESCE(wwan_in,0) + COALESCE(wwan_out,0)) DESC, ao.id DESC
    `,
    params,
  )) as IosDataUsageRow[];
  return rows ?? [];
}

/* ------------------------------------------------------------------ */
/* Canonical chat envelope (chat.v1) — app-agnostic                    */
/* ------------------------------------------------------------------ */

/** Every chat parser emits this canonical `chat.v1` message kind. */
const CHAT_KIND = "mobile.communication.message";
/**
 * A parser guarantees `conversation.id` is unique inside its own store, but it
 * cannot know about other apps — Android SMS thread 3 and WhatsApp chat 3 are
 * unrelated. Global thread identity is therefore composed here as
 * `parser:conversation.id`, so browsing every app at once never merges threads.
 */
const CHAT_CONVERSATION_KEY = `(ao.parser || ':' || COALESCE(NULLIF(json_extract(ao.json,'$.conversation.id'),''), 'unknown'))`;
const CHAT_TS = `CAST(json_extract(ao.json,'$.timestamps.message.unix_ms') AS INTEGER)`;

export interface ChatQueryScope {
  /** Optional exact parser facet, retained for callers that need it. */
  parser?: string;
  /** Exact artifact tag (iMessage, WhatsApp, SMS, …). */
  tag?: string;
}

function appendChatScope(
  scope: ChatQueryScope | undefined,
  params: any[],
): string[] {
  const clauses: string[] = [];
  if (scope?.parser) {
    params.push(scope.parser);
    clauses.push(`ao.parser = $${params.length}`);
  }
  if (scope?.tag) {
    params.push(scope.tag);
    clauses.push(`EXISTS (
      SELECT 1
      FROM artifacts chat_artifact
      WHERE chat_artifact.id = ao.artifact_id
        AND chat_artifact.tag = $${params.length}
    )`);
  }
  return clauses;
}

/**
 * Messages stored before the chat.v1 envelope existed.
 *
 * Such rows have no `conversation.id` or `body`, so they would silently collapse
 * into a single "unknown" thread with empty bubbles. Surfacing the count turns
 * that into an obvious "re-process this evidence" instead of a mystery.
 */
export async function getLegacyChatMessageCount(
  evidenceId: number,
  partitionId: number,
  scope?: ChatQueryScope,
): Promise<number> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const scopeClauses = appendChatScope(scope, params);
  const rows = await db.select<Array<{ n: number }>>(
    `
    SELECT COUNT(*) AS n
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.kind = '${CHAT_KIND}'
      AND json_extract(ao.json, '$.schema') IS NULL
      ${scopeClauses.map((clause) => `AND ${clause}`).join("\n")}
    `,
    params,
  );
  return Number(rows?.[0]?.n ?? 0);
}

export async function getChatConversations(
  evidenceId: number,
  partitionId: number,
  scope?: ChatQueryScope,
): Promise<DiscussionConversationRow[]> {
  const db = await getEvidenceDb(evidenceId);
  const params: any[] = [evidenceId, partitionId];
  const scopeClauses = appendChatScope(scope, params);
  const inWindow = msTimeMatchExpr([CHAT_TS], params);
  const hasAttachmentRefs = await hasArtifactAttachmentRefs(db);
  const attachmentExists = hasAttachmentRefs
    ? `EXISTS (
        SELECT 1
        FROM artifact_attachment_refs attachment_ref
        WHERE attachment_ref.evidence_id = ao.evidence_id
          AND attachment_ref.partition_id = ao.partition_id
          AND attachment_ref.parser = ao.parser
          AND attachment_ref.message_rowid =
              CAST(json_extract(ao.json,'$.source.rowid') AS INTEGER)
      )`
    : "0";

  const rows = (await db.select(
    `
    SELECT
      ${CHAT_CONVERSATION_KEY} AS id,
      COALESCE(
        MAX(NULLIF(json_extract(ao.json,'$.conversation.display_name'), '')),
        MAX(NULLIF(json_extract(ao.json,'$.conversation.participants[0].display_name'), '')),
        MAX(NULLIF(json_extract(ao.json,'$.conversation.participants[0].id'), '')),
        MAX(NULLIF(json_extract(ao.json,'$.sender.display_name'), '')),
        MAX(NULLIF(json_extract(ao.json,'$.sender.id'), '')),
        ${CHAT_CONVERSATION_KEY}
      ) AS title,
      MAX(NULLIF(json_extract(ao.json,'$.conversation.id'), '')) AS chat_jid,
      MIN(json_extract(ao.json,'$.app.label')) AS subtitle,
      MIN(json_extract(ao.json,'$.source.path')) AS source_path,
      COUNT(*) AS message_count,
      SUM(CASE WHEN ${inWindow} THEN 1 ELSE 0 END) AS in_window_count,
      SUM(CASE WHEN json_extract(ao.json,'$.direction') = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
      SUM(CASE WHEN json_extract(ao.json,'$.direction') = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
      SUM(CASE
        WHEN CAST(json_extract(ao.json,'$.has_attachments') AS INTEGER) = 1
          OR ${attachmentExists}
        THEN 1 ELSE 0 END
      ) AS media_count,
      MIN(${CHAT_TS}) AS first_timestamp_ms,
      MAX(${CHAT_TS}) AS last_timestamp_ms
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.kind = '${CHAT_KIND}'
      ${scopeClauses.map((clause) => `AND ${clause}`).join("\n")}
    GROUP BY ${CHAT_CONVERSATION_KEY}
    ORDER BY last_timestamp_ms DESC, title ASC
    `,
    params,
  )) as DiscussionConversationRow[];

  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    message_count: Number(row.message_count ?? 0),
    in_window_count: Number(row.in_window_count ?? 0),
    incoming_count: Number(row.incoming_count ?? 0),
    outgoing_count: Number(row.outgoing_count ?? 0),
    media_count: Number(row.media_count ?? 0),
    first_timestamp_ms: row.first_timestamp_ms == null ? null : Number(row.first_timestamp_ms),
    last_timestamp_ms: row.last_timestamp_ms == null ? null : Number(row.last_timestamp_ms),
  }));
}

export async function getChatMessages(params: {
  evidenceId: number;
  partitionId: number;
  conversationId: string;
  offset: number;
  limit: number;
  search?: string;
  scope?: ChatQueryScope;
}): Promise<{ rows: DiscussionMessageRow[]; rowCount: number }> {
  const db = await getEvidenceDb(params.evidenceId);
  const hasAttachmentRefs = await hasArtifactAttachmentRefs(db);
  const queryParams: any[] = [params.evidenceId, params.partitionId, params.conversationId];
  const clauses = [
    "ao.evidence_id = $1",
    "ao.partition_id = $2",
    `ao.kind = '${CHAT_KIND}'`,
    `${CHAT_CONVERSATION_KEY} = $3`,
    ...appendChatScope(params.scope, queryParams),
  ];
  const search = params.search?.trim();
  if (search) {
    queryParams.push(`%${escapeSqlLike(search.toLowerCase())}%`);
    const searchParameter = `$${queryParams.length}`;
    const searchableValues = [
      "json_extract(ao.json,'$.body')",
      "json_extract(ao.json,'$.sender.display_name')",
      "json_extract(ao.json,'$.sender.id')",
      "json_extract(ao.json,'$.conversation.display_name')",
      "json_extract(ao.json,'$.conversation.id')",
      "json_extract(ao.json,'$.conversation.participants')",
    ];
    const searchClauses = searchableValues.map(
      (value) =>
        `LOWER(COALESCE(CAST(${value} AS TEXT),'')) LIKE ${searchParameter} ESCAPE '\\'`,
    );
    if (hasAttachmentRefs) {
      searchClauses.push(`EXISTS (
        SELECT 1
        FROM artifact_attachment_refs search_ref
        WHERE search_ref.evidence_id = ao.evidence_id
          AND search_ref.partition_id = ao.partition_id
          AND search_ref.parser = ao.parser
          AND search_ref.message_rowid =
              CAST(json_extract(ao.json,'$.source.rowid') AS INTEGER)
          AND LOWER(COALESCE(
                search_ref.file_name,
                search_ref.resolved_name,
                search_ref.local_path,
                search_ref.remote_url,
                ''
              )) LIKE ${searchParameter} ESCAPE '\\'
      )`);
    }
    clauses.push(`(${searchClauses.join(" OR ")})`);
  }
  const timeMatch = msTimeMatchExpr([CHAT_TS], queryParams);
  if (timeMatch !== "1") clauses.push(timeMatch);

  const whereSql = clauses.join(" AND ");
  const limitIndex = queryParams.length + 1;
  const offsetIndex = queryParams.length + 2;

  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      -- Canonical link back to the parser's own row, used to attach media.
      CAST(json_extract(ao.json,'$.source.rowid') AS INTEGER) AS message_rowid,
      ${CHAT_CONVERSATION_KEY} AS conversation_id,
      ${CHAT_TS} AS timestamp_ms,
      json_extract(ao.json,'$.direction') AS direction,
      json_extract(ao.json,'$.body') AS text,
      COALESCE(
        NULLIF(json_extract(ao.json,'$.sender.display_name'), ''),
        NULLIF(json_extract(ao.json,'$.sender.id'), '')
      ) AS sender,
      json_extract(ao.json,'$.sender.id') AS sender_jid,
      NULL AS recipient_jid,
      COALESCE(
        NULLIF(json_extract(ao.json,'$.details.message.type_family'), ''),
        CASE WHEN CAST(json_extract(ao.json,'$.has_attachments') AS INTEGER) = 1
             THEN 'media' ELSE 'text' END
      ) AS type_family,
      CAST(json_extract(ao.json,'$.details.message.type_code') AS INTEGER) AS type_code,
      CAST(json_extract(ao.json,'$.details.message.status_code') AS INTEGER) AS status_code,
      json_extract(ao.json,'$.details.media.local_path') AS media_path,
      CAST(json_extract(ao.json,'$.details.media.file_size') AS INTEGER) AS media_file_size,
      json_extract(ao.json,'$.details.media.mime_type') AS media_mime,
      NULL AS media_url,
      json_extract(ao.json,'$.source.path') AS source_path,
      json_extract(ao.json,'$.app.label') AS app_label,
      ao.parser AS parser,
      ao.json AS json_raw
    FROM artifact_objects ao
    WHERE ${whereSql}
    ORDER BY ${CHAT_TS} ASC, ao.id ASC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    [...queryParams, params.limit, params.offset],
  )) as DiscussionMessageRow[];

  const countRows = await db.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM artifact_objects ao WHERE ${whereSql}`,
    queryParams,
  );

  const withMedia = await attachChatAttachments(
    db,
    params.evidenceId,
    params.partitionId,
    (rows ?? []) as any[],
  );

  return { rows: withMedia, rowCount: Number(countRows?.[0]?.count ?? 0) };
}

/**
 * Populate `attachments` for a page of canonical chat messages.
 *
 * Media lives in `artifact_attachment_refs` (resolved to files on disk by the
 * indexer) and, for some apps, additionally as `mobile.communication.attachment`
 * objects. Both are keyed by the parser's own row id, which the envelope exposes
 * as `source.rowid` — so this works for any chat parser without app-specific code.
 * Lookups stay scoped to the parsers present in the page, because row ids are
 * only unique within a parser.
 */
async function attachChatAttachments(
  db: Database,
  evidenceId: number,
  partitionId: number,
  rows: any[],
): Promise<DiscussionMessageRow[]> {
  const rowids = Array.from(
    new Set(
      rows
        .map((r) => (r.message_rowid == null ? null : Number(r.message_rowid)))
        .filter((v): v is number => v != null && Number.isFinite(v)),
    ),
  );
  const parsers = Array.from(new Set(rows.map((r) => r.parser).filter(Boolean)));
  if (rowids.length === 0 || parsers.length === 0) {
    return rows.map((r) => ({ ...r, attachments: [] })) as DiscussionMessageRow[];
  }

  const attachmentKey = (parser: unknown, rowid: unknown) =>
    `${String(parser ?? "")}\u0000${Number(rowid)}`;
  const byMessage = new Map<string, any[]>();
  const idPh = rowids.map((_, i) => `$${i + 3}`).join(", ");
  const parserPh = parsers.map((_, i) => `$${i + 3 + rowids.length}`).join(", ");
  const args = [evidenceId, partitionId, ...rowids, ...parsers];

  if (await hasArtifactAttachmentRefs(db)) {
    const refs = (await db.select(
      `
      SELECT id, parser, message_rowid, kind, mime, file_name, file_size, duration_seconds,
             width, height, latitude, longitude, local_path, remote_url,
             thumbnail_local_path, resolved_file_id, resolved_fs_identifier,
             resolved_absolute_path, resolved_host_path, resolved_sig_mime,
             resolved_name, resolved_size, preview_mime, preview_base64
      FROM artifact_attachment_refs
      WHERE evidence_id = $1 AND partition_id = $2
        AND message_rowid IN (${idPh})
        AND parser IN (${parserPh})
      ORDER BY message_rowid ASC, id ASC
      `,
      args,
    )) as Array<WhatsAppAttachmentRefRow & { parser: string }>;

    for (const ref of refs) {
      if (ref.message_rowid == null) continue;
      const key = attachmentKey(ref.parser, ref.message_rowid);
      const list = byMessage.get(key) ?? [];
      list.push(mapAttachmentRef(ref));
      byMessage.set(key, list);
    }
  }

  // Apps that also emit standalone attachment objects (iMessage, WhatsApp).
  const objects = (await db.select(
    `
    SELECT
      ao.id AS id,
      ao.parser AS parser,
      CAST(json_extract(ao.json,'$.message.rowid') AS INTEGER) AS message_rowid,
      json_extract(ao.json,'$.attachment.kind') AS kind,
      json_extract(ao.json,'$.attachment.mime') AS mime,
      json_extract(ao.json,'$.attachment.file_name') AS file_name,
      CAST(json_extract(ao.json,'$.attachment.total_bytes') AS INTEGER) AS file_size,
      COALESCE(
        NULLIF(json_extract(ao.json,'$.attachment.local_path'), ''),
        NULLIF(json_extract(ao.json,'$.attachment.filename'), '')
      ) AS local_path,
      json_extract(ao.json,'$.attachment.remote_url') AS remote_url,
      json_extract(ao.json,'$.attachment.thumbnail_path') AS thumbnail_local_path
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1 AND ao.partition_id = $2
      AND ao.kind = 'mobile.communication.attachment'
      AND CAST(json_extract(ao.json,'$.message.rowid') AS INTEGER) IN (${idPh})
      AND ao.parser IN (${parserPh})
    ORDER BY message_rowid ASC, ao.id ASC
    `,
    args,
  )) as Array<
    WhatsAppAttachmentRefRow & {
      id: number;
      parser: string;
      message_rowid: number | null;
    }
  >;

  for (const object of objects) {
    if (object.message_rowid == null) continue;
    const key = attachmentKey(object.parser, object.message_rowid);
    const list = byMessage.get(key) ?? [];
    // Only add when the refs table did not already describe this message.
    if (list.length === 0) list.push(mapAttachmentRef(object));
    byMessage.set(key, list);
  }

  return rows.map((r) => ({
    ...r,
    attachments:
      r.message_rowid == null
        ? []
        : (byMessage.get(attachmentKey(r.parser, r.message_rowid)) ?? []),
  })) as DiscussionMessageRow[];
}

/**
 * Total events per time bucket — the activity profile behind the scope bar.
 *
 * Deliberately does NOT group by event_type: the caller sums those away, and
 * including it forces SQLite to read full rows instead of an index-only scan of
 * idx_timeline_events_ev_part (evidence_id, partition_id, ts). On a million-row
 * timeline that difference is seconds versus milliseconds — and because the
 * evidence pool holds a single connection, a slow aggregate here stalls every
 * other query in the app.
 */
export async function getTimelineDensity(
  evidenceId: number,
  partitionId: number,
  bucketMs: number,
): Promise<{ ts: number; count: number }[]> {
  const db = await getEvidenceDb(evidenceId);
  const rows = await db.select<Array<{ ts_bucket: number; count: number }>>(
    `
    SELECT (ts / ${bucketMs}) * ${bucketMs} AS ts_bucket, COUNT(*) AS count
    FROM timeline_events
    WHERE evidence_id = $1
      AND partition_id = $2
      AND ts IS NOT NULL
    GROUP BY ts_bucket
    ORDER BY ts_bucket ASC
    `,
    [evidenceId, partitionId],
  );
  return (rows ?? [])
    .filter((r) => Number.isFinite(r.ts_bucket) && r.ts_bucket > 0 && r.count > 0)
    .map((r) => ({ ts: Number(r.ts_bucket), count: Number(r.count) }));
}

export async function getTimelineEventCounts(
  evidenceId: number,
  partitionId: number,
  opts?: {
    bucket?: "second" | "minute" | "hour" | "day";
    start?: number | null;
    end?: number | null;
  },
): Promise<TimelineEventCount[]> {
  const db = await getEvidenceDb(evidenceId);

  const BUCKET_MS: Record<NonNullable<typeof opts>["bucket"] & string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
  };
  const bucketMs = BUCKET_MS[opts?.bucket ?? "day"];

  const rows = await db.select<Array<{
    event_type: string;
    ts_bucket: number;
    count: number;
  }>>(
    `
    SELECT
      event_type,
      (ts / ${bucketMs}) * ${bucketMs} AS ts_bucket,
      COUNT(*) AS count
    FROM timeline_events
    WHERE evidence_id = $1
      AND partition_id = $2
      AND ts IS NOT NULL
      AND ($3 IS NULL OR ts >= $3)
      AND ($4 IS NULL OR ts <= $4)
    GROUP BY event_type, ts_bucket
    ORDER BY ts_bucket ASC, event_type ASC
    `,
    [evidenceId, partitionId, opts?.start ?? null, opts?.end ?? null],
  );

  return rows
    .filter(r => Number.isFinite(r.ts_bucket) && r.ts_bucket > 0 && r.count > 0)
    .map(r => ({ event_type: r.event_type, ts: r.ts_bucket, count: r.count }));
}

export type TimelineEventsFilter = {
  start: number | null;
  end: number | null;
  /** null = all types; array = only these event_type values */
  event_types: string[] | null;
};

export async function getTimelineEvents(
  evidenceId: number,
  partitionId: number,
  offset: number,
  limit: number,
  filter?: TimelineEventsFilter,
): Promise<{ rows: TimelineEvent[]; rowCount: number }> {
  const db = await getEvidenceDb(evidenceId);

  const eventTypesJson =
    filter?.event_types && filter.event_types.length > 0
      ? JSON.stringify(filter.event_types)
      : null;

  const params = [
    evidenceId,
    partitionId,
    filter?.start ?? null,
    filter?.end ?? null,
    eventTypesJson,
  ];

  const baseWhere = `
    te.evidence_id = $1
    AND te.partition_id = $2
    AND ($3 IS NULL OR te.ts >= $3)
    AND ($4 IS NULL OR te.ts <= $4)
    AND ($5 IS NULL OR te.event_type IN (SELECT value FROM json_each($5)))
  `;

  const rows = await db.select<TimelineEvent[]>(
    `
    SELECT
      te.id,
      te.ts,
      te.source,
      te.event_type,
      te.description,
      te.actor,
      te.file_id,
      te.artifact_object_id,
      sf.name AS file_name,
      COALESCE(
        sf.absolute_path,
        CASE te.source
          WHEN 'mobile_ios_whatsapp' THEN json_extract(ao.json, '$.attachment.local_path')
          WHEN 'mobile_ios_imessage' THEN json_extract(ao.json, '$.attachment.filename')
          ELSE NULL
        END
      ) AS file_path
    FROM timeline_events te
    LEFT JOIN system_files sf
      ON sf.id = te.file_id
      AND sf.evidence_id = te.evidence_id
      AND sf.partition_id = te.partition_id
    LEFT JOIN artifact_objects ao
      ON ao.id = te.artifact_object_id
    WHERE ${baseWhere}
    ORDER BY te.ts ASC
    LIMIT $6 OFFSET $7
    `,
    [...params, limit, offset],
  );

  const countResult = await db.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM timeline_events te WHERE ${baseWhere}`,
    params,
  );

  return { rows, rowCount: Number(countResult?.[0]?.count ?? 0) };
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
  _db: Database | null,
): Promise<void> {
  await deleteEvidences([evidenceId]);
}

export interface EvidenceDeletionResult {
  deletedEvidenceIds: number[];
  cleanupWarnings: string[];
}

export async function deleteEvidences(
  evidenceIds: number[],
): Promise<EvidenceDeletionResult> {
  if (evidenceIds.length === 0) {
    return { deletedEvidenceIds: [], cleanupWarnings: [] };
  }

  await Promise.all(evidenceIds.map((evidenceId) => closeEvidenceDb(evidenceId)));
  return invoke<EvidenceDeletionResult>("delete_evidences", { evidenceIds });
}

const PARSED_ARTEFACT_OBJECT_SORT_FIELDS = {
  id: "ao.id",
  parser: "ao.parser COLLATE NOCASE",
  kind: "ao.kind COLLATE NOCASE",
  artifact_id: "ao.artifact_id",
  text: "ao.text COLLATE NOCASE",
  source_path: "source_path COLLATE NOCASE",
  created_at: "ao.created_at",
} as const;

type ParsedArtefactObjectIndexPlan = {
  pageHint: string;
  hasComposite: boolean;
  hasFileIndex: boolean;
};

const parsedArtefactObjectIndexCache = new Map<
  number,
  Promise<ParsedArtefactObjectIndexPlan>
>();

/**
 * Prefer the composite scope/order index introduced in newer evidence schemas,
 * while keeping already-created databases fast through their `file_id` index.
 */
async function parsedArtefactObjectIndexHint(
  db: Database,
  evidenceId: number,
): Promise<ParsedArtefactObjectIndexPlan> {
  let cached = parsedArtefactObjectIndexCache.get(evidenceId);
  if (!cached) {
    cached = db
      .select<Array<{ name: string }>>("PRAGMA index_list('artifact_objects')")
      .then((indexes) => {
        const names = new Set((indexes ?? []).map(({ name }) => name));
        if (names.has("idx_artifact_objects_scope_file_id")) {
          return {
            pageHint: " INDEXED BY idx_artifact_objects_scope_file_id",
            hasComposite: true,
            hasFileIndex: names.has("idx_artifact_objects_file"),
          };
        }
        if (names.has("idx_artifact_objects_file")) {
          return {
            pageHint: " INDEXED BY idx_artifact_objects_file",
            hasComposite: false,
            hasFileIndex: true,
          };
        }
        return { pageHint: "", hasComposite: false, hasFileIndex: false };
      })
      .catch(() => ({
        pageHint: "",
        hasComposite: false,
        hasFileIndex: false,
      }));
    parsedArtefactObjectIndexCache.set(evidenceId, cached);
  }
  return cached;
}

/**
 * Return one bounded page of parser output for a single source file.
 *
 * Spotlight stores can produce hundreds of thousands of objects from one file,
 * so this deliberately keeps JSON opaque and leaves all filtering, sorting and
 * pagination in SQLite. The caller should only parse JSON for the returned page.
 */
export async function fetchParsedArtefactObjectsPage(
  query: ParsedArtefactObjectsPageQuery,
): Promise<ParsedArtefactObjectsPage> {
  const db = await getEvidenceDb(query.evidenceId);
  const indexPlan = await parsedArtefactObjectIndexHint(db, query.evidenceId);
  const params: Array<string | number> = [
    query.evidenceId,
    query.partitionId,
    query.fileId,
  ];
  const search = query.search?.trim();
  let searchClause = "";
  if (search) {
    params.push(search);
    const placeholder = `$${params.length}`;
    searchClause = `
      AND (
        instr(LOWER(COALESCE(ao.parser, '')), LOWER(${placeholder})) > 0
        OR instr(LOWER(COALESCE(ao.kind, '')), LOWER(${placeholder})) > 0
        OR instr(LOWER(COALESCE(ao.text, '')), LOWER(${placeholder})) > 0
        OR instr(
          LOWER(COALESCE(json_extract(ao.json, '$.source.path'), '')),
          LOWER(${placeholder})
        ) > 0
      )`;
  }

  const where = `
    ao.evidence_id = $1
    AND ao.partition_id = $2
    AND ao.file_id = $3
    ${searchClause}`;
  const sortExpression =
    PARSED_ARTEFACT_OBJECT_SORT_FIELDS[query.sortField ?? "id"] ??
    PARSED_ARTEFACT_OBJECT_SORT_FIELDS.id;
  const sortDirection = query.sortDirection === "desc" ? "DESC" : "ASC";
  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(250, Math.trunc(query.limit)))
    : 50;
  const offset = Number.isFinite(query.offset)
    ? Math.max(0, Math.trunc(query.offset))
    : 0;

  let rowCount: number;
  if (
    query.knownRowCount != null &&
    Number.isFinite(query.knownRowCount) &&
    query.knownRowCount >= 0
  ) {
    rowCount = Math.trunc(query.knownRowCount);
  } else if (!search) {
    // The evidence database is per-evidence and system_files.id is its primary
    // key, so file_id alone identifies the scope. This lets legacy databases
    // answer the initial count directly from the small single-column index.
    const countRows = await db.select<Array<{ count: number | string }>>(
      `SELECT COUNT(*) AS count
       FROM artifact_objects${
         indexPlan.hasFileIndex ? " INDEXED BY idx_artifact_objects_file" : ""
       }
       WHERE file_id = $1`,
      [query.fileId],
    );
    rowCount = Number(countRows?.[0]?.count ?? 0);
  } else {
    const countRows = await db.select<Array<{ count: number | string }>>(
      `SELECT COUNT(*) AS count
       FROM artifact_objects ao${indexPlan.pageHint}
       WHERE ${where}`,
      params,
    );
    rowCount = Number(countRows?.[0]?.count ?? 0);
  }

  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;
  const useLegacyIdPage =
    !indexPlan.hasComposite &&
    indexPlan.hasFileIndex &&
    !search &&
    (query.sortField == null || query.sortField === "id");
  const pageFrom = useLegacyIdPage
    ? `
      FROM (
        SELECT id
        FROM artifact_objects INDEXED BY idx_artifact_objects_file
        WHERE file_id = $3
        ORDER BY id ${sortDirection}
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      ) page_ids
      CROSS JOIN artifact_objects ao ON ao.id = page_ids.id`
    : `FROM artifact_objects ao${indexPlan.pageHint}`;
  const pageBounds = useLegacyIdPage
    ? ""
    : `LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
  const rows = await db.select<ParsedArtefactObjectsPage["rows"]>(
    `
    SELECT
      ao.id,
      ao.evidence_id,
      ao.partition_id,
      ao.artifact_id,
      ao.file_id,
      ao.parser,
      ao.kind,
      ao.text,
      ao.json,
      ao.created_at,
      json_extract(ao.json, '$.source.path') AS source_path,
      json_extract(ao.json, '$.source.table') AS source_table,
      json_extract(ao.json, '$.source.record') AS source_record,
      json_extract(ao.json, '$.source.role') AS source_role,
      COALESCE(
        json_extract(ao.json, '$.source.rowid'),
        json_extract(ao.json, '$.source.index')
      ) AS source_rowid,
      json_extract(ao.json, '$.source.schema_variant') AS source_schema
    ${pageFrom}
    WHERE ${where}
    ORDER BY ${sortExpression} ${sortDirection}, ao.id ${sortDirection}
    ${pageBounds}
    `,
    [...params, limit, offset],
  );

  return {
    rows: rows ?? [],
    rowCount,
  };
}

/** Cheap capability check for deciding whether FileViewer shows the tab. */
export async function countParsedArtefactObjects(params: {
  evidenceId: number;
  partitionId: number;
  fileId: number;
}): Promise<number> {
  const db = await getEvidenceDb(params.evidenceId);
  const indexPlan = await parsedArtefactObjectIndexHint(db, params.evidenceId);
  const rows = await db.select<Array<{ count: number | string }>>(
    `SELECT COUNT(*) AS count
     FROM artifact_objects${
       indexPlan.hasFileIndex ? " INDEXED BY idx_artifact_objects_file" : ""
     }
     WHERE file_id = $1`,
    [params.fileId],
  );
  return Number(rows?.[0]?.count ?? 0);
}

const WHATSAPP_CHAT_KEY_EXPR = `
  COALESCE(
    CAST(json_extract(ao.json, '$.chat.rowid') AS TEXT),
    json_extract(ao.json, '$.chat.jid'),
    json_extract(ao.json, '$.source.path'),
    'unknown'
  )
`;

const WHATSAPP_TS_EXPR = `
  CAST(json_extract(ao.json, '$.timestamps.message.unix_ms') AS INTEGER)
`;

const WHATSAPP_MEDIA_LOCAL_EXPR = `json_extract(ao.json, '$.media.local_path')`;
const WHATSAPP_MEDIA_MIME_EXPR = `
  COALESCE(
    NULLIF(json_extract(ao.json, '$.media.mime_type'), ''),
    NULLIF(json_extract(ao.json, '$.media.content_type'), ''),
    NULLIF(json_extract(ao.json, '$.media.mime'), '')
  )
`;

const IMESSAGE_CHAT_KEY_EXPR = `
  COALESCE(
    CAST(json_extract(ao.json, '$.chat.rowid') AS TEXT),
    NULLIF(json_extract(ao.json, '$.chat.identifier'), ''),
    NULLIF(json_extract(ao.json, '$.chat.guid'), ''),
    json_extract(ao.json, '$.source.path'),
    'unknown'
  )
`;

const IMESSAGE_TS_EXPR = `
  CAST(json_extract(ao.json, '$.timestamps.message.unix_ms') AS INTEGER)
`;

const IMESSAGE_ATTACHMENT_LOCAL_EXPR = `
  COALESCE(
    NULLIF(json_extract(ao.json, '$.attachment.local_path'), ''),
    NULLIF(json_extract(ao.json, '$.attachment.filename'), '')
  )
`;
function escapeSqlLike(raw: string): string {
  return raw.replace(/[%_\\]/g, (m) => "\\" + m);
}

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).pop() || path;
}

function hasExtension(
  values: Array<string | null | undefined>,
  extensions: string[],
): boolean {
  return values.some((value) => {
    if (!value) return false;
    const lower = value.toLowerCase().split(/[?#]/, 1)[0];
    return extensions.some((extension) => lower.endsWith(extension));
  });
}

function classifyDiscussionAttachmentKind(
  mime: string | null,
  typeFamily: string | null,
  fileName: string | null,
  localPath: string | null,
  remoteUrl: string | null,
  hasVcard: boolean,
): DiscussionAttachmentKind {
  const normalizedMime = mime?.toLowerCase() ?? "";
  const normalizedType = typeFamily?.toLowerCase() ?? "";
  const pathHints = [fileName, localPath, remoteUrl];

  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime.startsWith("audio/")) return "audio";
  if (
    hasExtension(pathHints, [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".heic",
      ".heif",
      ".webp",
      ".tif",
      ".tiff",
      ".bmp",
    ])
  ) {
    return "image";
  }
  if (
    hasExtension(pathHints, [
      ".mp4",
      ".mov",
      ".m4v",
      ".3gp",
      ".avi",
      ".mkv",
      ".webm",
    ])
  ) {
    return "video";
  }
  if (
    hasExtension(pathHints, [
      ".aac",
      ".amr",
      ".m4a",
      ".mp3",
      ".ogg",
      ".opus",
      ".wav",
    ])
  ) {
    return "audio";
  }
  if (normalizedType.includes("location")) return "location";
  if (
    normalizedType.includes("contact") ||
    normalizedMime.includes("vcard") ||
    hasVcard ||
    hasExtension(pathHints, [".vcf"])
  ) {
    return "contact";
  }
  if (normalizedMime) return "document";
  return "unknown";
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isNewsletterJid(value: string | null | undefined): boolean {
  return value?.endsWith("@newsletter") ?? false;
}

function looksLikeOpaqueWhatsAppToken(value: string | null | undefined): boolean {
  const trimmed = nonEmptyString(value);
  if (!trimmed || trimmed.length < 12 || /\s/.test(trimmed)) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(trimmed);
}

function displayWhatsAppSender(raw: any): string | null {
  const chatJid = nonEmptyString(raw.chat_jid);
  if (isNewsletterJid(chatJid)) return null;

  const groupMemberName = nonEmptyString(raw.sender_group_member_name);
  if (groupMemberName && !looksLikeOpaqueWhatsAppToken(groupMemberName)) {
    return groupMemberName;
  }

  const pushName = nonEmptyString(raw.sender_push_name);
  if (pushName && !looksLikeOpaqueWhatsAppToken(pushName)) {
    return pushName;
  }

  const groupMemberJid = nonEmptyString(raw.sender_group_member_jid);
  if (groupMemberJid) return groupMemberJid;

  return nonEmptyString(raw.sender_jid);
}

function displayIMessageSender(raw: any): string | null {
  if (raw.direction === "outgoing") return "Me";
  return (
    nonEmptyString(raw.sender_id) ??
    nonEmptyString(raw.sender_jid) ??
    nonEmptyString(raw.handle_id)
  );
}

function messageTypeCanHaveAttachment(typeCode: number | null): boolean {
  return ![0, 7, 14, 46, 55, 59, 66].includes(typeCode ?? -1);
}

function normalizeWhatsAppTypeFamily(raw: any): string | null {
  const typeCode = raw.type_code == null ? null : Number(raw.type_code);
  const existing = nonEmptyString(raw.type_family);

  if (typeCode === 14) return "reaction";
  if ([46, 55, 59, 66].includes(typeCode ?? -1)) return "service_or_system";
  if (typeCode === 0) return nonEmptyString(raw.text) ? "text" : "empty_text";
  if (existing === "media" && !messageTypeCanHaveAttachment(typeCode)) {
    return nonEmptyString(raw.text) ? "text" : "service_or_system";
  }

  return existing;
}

async function hasArtifactAttachmentRefs(db: Database): Promise<boolean> {
  const rows = (await db.select(
    `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'artifact_attachment_refs'
    LIMIT 1
    `,
  )) as Array<{ name: string }>;

  return rows.length > 0;
}

function normalizeAttachmentKind(
  value: string | null | undefined,
): DiscussionAttachmentKind {
  if (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "document" ||
    value === "location" ||
    value === "contact" ||
    value === "sticker" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

type WhatsAppAttachmentRefRow = {
  id: number;
  message_rowid: number | null;
  kind: string | null;
  mime: string | null;
  file_name: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  local_path: string | null;
  remote_url: string | null;
  thumbnail_local_path: string | null;
  resolved_file_id: number | null;
  resolved_fs_identifier: number | null;
  resolved_absolute_path: string | null;
  resolved_host_path: string | null;
  resolved_sig_mime: string | null;
  resolved_name: string | null;
  resolved_size: number | null;
  preview_mime: string | null;
  preview_base64: string | null;
};

function mapAttachmentRef(row: WhatsAppAttachmentRefRow): DiscussionAttachmentRow {
  const mime = row.resolved_sig_mime ?? row.mime ?? row.preview_mime ?? null;
  const fileName =
    row.resolved_name ??
    row.file_name ??
    basename(row.local_path);
  const fileSize = row.resolved_size ?? row.file_size ?? null;

  return {
    id: `attachment:${row.id}`,
    kind: normalizeAttachmentKind(row.kind),
    mime,
    file_name: fileName,
    file_size: fileSize == null ? null : Number(fileSize),
    duration_seconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    local_path: row.local_path ?? null,
    remote_url: row.remote_url ?? null,
    thumbnail_path: row.thumbnail_local_path ?? null,
    file_id:
      row.resolved_file_id == null ? null : Number(row.resolved_file_id),
    fs_identifier:
      row.resolved_fs_identifier == null
        ? null
        : Number(row.resolved_fs_identifier),
    absolute_path: row.resolved_absolute_path ?? null,
    host_path: row.resolved_host_path ?? null,
    sig_mime: row.resolved_sig_mime ?? null,
    preview_mime: row.preview_mime ?? null,
    preview_base64: row.preview_base64 ?? null,
  };
}

export async function getWhatsAppConversations(
  evidenceId: number,
  partitionId: number,
): Promise<DiscussionConversationRow[]> {
  const db = await getEvidenceDb(evidenceId);

  const convParams: any[] = [evidenceId, partitionId];
  const inWindow = msTimeMatchExpr([WHATSAPP_TS_EXPR], convParams);

  const rows = (await db.select(
    `
    SELECT
      ${WHATSAPP_CHAT_KEY_EXPR} AS id,
      COALESCE(
        NULLIF(json_extract(ao.json, '$.chat.name'), ''),
        NULLIF(json_extract(ao.json, '$.chat.jid'), ''),
        'Unknown discussion'
      ) AS title,
      json_extract(ao.json, '$.chat.jid') AS chat_jid,
      json_extract(ao.json, '$.chat.jid') AS subtitle,
      MIN(json_extract(ao.json, '$.source.path')) AS source_path,
      COUNT(*) AS message_count,
      SUM(CASE WHEN ${inWindow} THEN 1 ELSE 0 END) AS in_window_count,
      SUM(CASE WHEN json_extract(ao.json, '$.direction') = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
      SUM(CASE WHEN json_extract(ao.json, '$.direction') = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
      SUM(CASE WHEN json_extract(ao.json, '$.media') IS NOT NULL THEN 1 ELSE 0 END) AS media_count,
      MIN(${WHATSAPP_TS_EXPR}) AS first_timestamp_ms,
      MAX(${WHATSAPP_TS_EXPR}) AS last_timestamp_ms
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_whatsapp'
      AND ao.kind = 'mobile.communication.message'
    GROUP BY ${WHATSAPP_CHAT_KEY_EXPR}
    ORDER BY last_timestamp_ms DESC, title ASC
    `,
    convParams,
  )) as DiscussionConversationRow[];

  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    message_count: Number(row.message_count ?? 0),
    in_window_count: Number(row.in_window_count ?? 0),
    incoming_count: Number(row.incoming_count ?? 0),
    outgoing_count: Number(row.outgoing_count ?? 0),
    media_count: Number(row.media_count ?? 0),
    first_timestamp_ms:
      row.first_timestamp_ms == null ? null : Number(row.first_timestamp_ms),
    last_timestamp_ms:
      row.last_timestamp_ms == null ? null : Number(row.last_timestamp_ms),
  }));
}

export async function getWhatsAppMessages(params: {
  evidenceId: number;
  partitionId: number;
  conversationId: string;
  offset: number;
  limit: number;
  search?: string;
}): Promise<{ rows: DiscussionMessageRow[]; rowCount: number }> {
  const db = await getEvidenceDb(params.evidenceId);

  const queryParams: any[] = [
    params.evidenceId,
    params.partitionId,
    params.conversationId,
  ];
  const clauses = [
    "ao.evidence_id = $1",
    "ao.partition_id = $2",
    "ao.parser = 'mobile_ios_whatsapp'",
    "ao.kind = 'mobile.communication.message'",
    `${WHATSAPP_CHAT_KEY_EXPR} = $3`,
  ];

  const search = params.search?.trim();
  if (search) {
    const ph = `$${queryParams.length + 1}`;
    queryParams.push(`%${escapeSqlLike(search.toLowerCase())}%`);
    clauses.push(`
      (
        LOWER(COALESCE(json_extract(ao.json, '$.message.text'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.sender.jid'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.sender.push_name'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.sender.group_member_name'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.message.type_family'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.media.local_path'), '')) LIKE ${ph} ESCAPE '\\'
      )
    `);
  }

  const timeMatch = msTimeMatchExpr([WHATSAPP_TS_EXPR], queryParams);
  if (timeMatch !== "1") clauses.push(timeMatch);

  const whereSql = clauses.join(" AND ");
  const limitIndex = queryParams.length + 1;
  const offsetIndex = queryParams.length + 2;

  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.message.rowid') AS INTEGER) AS message_rowid,
      ${WHATSAPP_CHAT_KEY_EXPR} AS conversation_id,
      ${WHATSAPP_TS_EXPR} AS timestamp_ms,
      json_extract(ao.json, '$.direction') AS direction,
      json_extract(ao.json, '$.chat.jid') AS chat_jid,
      CAST(json_extract(ao.json, '$.chat.session_type_code') AS INTEGER) AS chat_session_type,
      json_extract(ao.json, '$.sender.group_member_name') AS sender_group_member_name,
      json_extract(ao.json, '$.sender.group_member_jid') AS sender_group_member_jid,
      json_extract(ao.json, '$.sender.push_name') AS sender_push_name,
      json_extract(ao.json, '$.sender.jid') AS sender_jid,
      json_extract(ao.json, '$.recipient.jid') AS recipient_jid,
      COALESCE(
        NULLIF(json_extract(ao.json, '$.message.display_text'), ''),
        NULLIF(json_extract(ao.json, '$.message.text'), ''),
        CASE
          WHEN CAST(json_extract(ao.json, '$.message.type_code') AS INTEGER) NOT IN (14, 46, 55, 59, 66)
          THEN NULLIF(json_extract(ao.json, '$.media.title'), '')
          ELSE NULL
        END
      ) AS text,
      json_extract(ao.json, '$.message.type_family') AS type_family,
      CAST(json_extract(ao.json, '$.message.type_code') AS INTEGER) AS type_code,
      CAST(json_extract(ao.json, '$.message.status_code') AS INTEGER) AS status_code,
      ${WHATSAPP_MEDIA_LOCAL_EXPR} AS media_path,
      CAST(json_extract(ao.json, '$.media.file_size') AS INTEGER) AS media_file_size,
      ${WHATSAPP_MEDIA_MIME_EXPR} AS media_mime,
      json_extract(ao.json, '$.media.url') AS media_url,
      json_extract(ao.json, '$.media.thumbnail_local_path') AS media_thumbnail_path,
      json_extract(ao.json, '$.media.vcard_name') AS media_vcard_name,
      json_extract(ao.json, '$.media.vcard_string') AS media_vcard_string,
      CAST(json_extract(ao.json, '$.media.movie_duration') AS INTEGER) AS media_duration_seconds,
      CAST(json_extract(ao.json, '$.media.width') AS INTEGER) AS media_width,
      CAST(json_extract(ao.json, '$.media.height') AS INTEGER) AS media_height,
      CAST(json_extract(ao.json, '$.media.location.latitude') AS REAL) AS media_latitude,
      CAST(json_extract(ao.json, '$.media.location.longitude') AS REAL) AS media_longitude,
      json_extract(ao.json, '$.source.path') AS source_path,
      ao.json AS json_raw
    FROM artifact_objects ao
    WHERE ${whereSql}
    ORDER BY timestamp_ms ASC, ao.id ASC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
    `,
    [...queryParams, params.limit, params.offset],
  )) as any[];

  const countResult = (await db.select(
    `
    SELECT COUNT(*) AS count
    FROM artifact_objects ao
    WHERE ${whereSql}
    `,
    queryParams,
  )) as Array<{ count: number }>;

  const attachmentsByMessageRowid = new Map<
    number,
    ReturnType<typeof mapAttachmentRef>[]
  >();
  const messageRowids = Array.from(
    new Set(
      rows
        .map((row) =>
          row.message_rowid == null ? null : Number(row.message_rowid),
        )
        .filter((value): value is number => value != null && Number.isFinite(value)),
    ),
  );

  if (messageRowids.length > 0 && (await hasArtifactAttachmentRefs(db))) {
    const attachmentPlaceholders = messageRowids
      .map((_, index) => `$${index + 3}`)
      .join(", ");
    const attachmentRows = (await db.select(
      `
      SELECT
        id,
        message_rowid,
        kind,
        mime,
        file_name,
        file_size,
        duration_seconds,
        width,
        height,
        latitude,
        longitude,
        local_path,
        remote_url,
        thumbnail_local_path,
        resolved_file_id,
        resolved_fs_identifier,
        resolved_absolute_path,
        resolved_host_path,
        resolved_sig_mime,
        resolved_name,
        resolved_size,
        preview_mime,
        preview_base64
      FROM artifact_attachment_refs
      WHERE evidence_id = $1
        AND partition_id = $2
        AND parser = 'mobile_ios_whatsapp'
        AND message_rowid IN (${attachmentPlaceholders})
      ORDER BY message_rowid ASC, id ASC
      `,
      [params.evidenceId, params.partitionId, ...messageRowids],
    )) as WhatsAppAttachmentRefRow[];

    for (const attachment of attachmentRows) {
      if (attachment.message_rowid == null) continue;
      const messageRowid = Number(attachment.message_rowid);
      const existing = attachmentsByMessageRowid.get(messageRowid) ?? [];
      existing.push(mapAttachmentRef(attachment));
      attachmentsByMessageRowid.set(messageRowid, existing);
    }
  }

  return {
    rows: rows.map((raw: any) => {
      const typeCode = raw.type_code == null ? null : Number(raw.type_code);
      const typeFamily = normalizeWhatsAppTypeFamily(raw);
      const canHaveAttachment = messageTypeCanHaveAttachment(typeCode);
      const materializedAttachments =
        raw.message_rowid == null
          ? []
          : (attachmentsByMessageRowid.get(Number(raw.message_rowid)) ?? []);
      const mime = raw.media_mime ?? null;
      const fileName = basename(raw.media_path);
      const fileSize = raw.media_file_size ?? null;
      const hasAttachment =
        canHaveAttachment &&
        materializedAttachments.length === 0 &&
        (raw.media_path != null ||
          raw.media_url != null ||
          raw.media_mime != null ||
          raw.media_file_size != null ||
          raw.media_vcard_name != null ||
          raw.media_vcard_string != null ||
          raw.media_width != null ||
          raw.media_height != null ||
          raw.media_latitude != null ||
          raw.media_longitude != null);

      const fallbackAttachments: DiscussionAttachmentRow[] = hasAttachment
        ? [
            {
              id: `${raw.id}:media`,
              kind: classifyDiscussionAttachmentKind(
                mime,
                typeFamily,
                fileName,
                raw.media_path ?? null,
                raw.media_url ?? null,
                raw.media_vcard_name != null || raw.media_vcard_string != null,
              ),
              mime,
              file_name: fileName,
              file_size: fileSize == null ? null : Number(fileSize),
              duration_seconds:
                raw.media_duration_seconds == null
                  ? null
                  : Number(raw.media_duration_seconds),
              width: raw.media_width == null ? null : Number(raw.media_width),
              height: raw.media_height == null ? null : Number(raw.media_height),
              latitude:
                raw.media_latitude == null ? null : Number(raw.media_latitude),
              longitude:
                raw.media_longitude == null
                  ? null
                  : Number(raw.media_longitude),
              local_path: raw.media_path ?? null,
              remote_url: raw.media_url ?? null,
              thumbnail_path: raw.media_thumbnail_path ?? null,
              file_id: null,
              fs_identifier: null,
              absolute_path: null,
              host_path: null,
              sig_mime: null,
              preview_mime: null,
              preview_base64: null,
            },
          ]
        : [];

      const attachments =
        canHaveAttachment && materializedAttachments.length > 0
          ? materializedAttachments
          : fallbackAttachments;

      return {
        ...raw,
        id: Number(raw.id),
        sender: displayWhatsAppSender(raw),
        message_rowid:
          raw.message_rowid == null ? null : Number(raw.message_rowid),
        conversation_id: String(raw.conversation_id),
        timestamp_ms:
          raw.timestamp_ms == null ? null : Number(raw.timestamp_ms),
        type_code: typeCode,
        type_family: typeFamily,
        status_code:
          raw.status_code == null ? null : Number(raw.status_code),
        media_file_size:
          raw.media_file_size == null ? null : Number(raw.media_file_size),
        media_mime: raw.media_mime ?? null,
        media_url: raw.media_url ?? null,
        attachments,
      };
    }),
    rowCount: Number(countResult?.[0]?.count ?? 0),
  };
}

export async function getIMessageConversations(
  evidenceId: number,
  partitionId: number,
): Promise<DiscussionConversationRow[]> {
  const db = await getEvidenceDb(evidenceId);

  const convParams: any[] = [evidenceId, partitionId];
  const inWindow = msTimeMatchExpr([IMESSAGE_TS_EXPR], convParams);

  const rows = (await db.select(
    `
    SELECT
      ${IMESSAGE_CHAT_KEY_EXPR} AS id,
      COALESCE(
        NULLIF(json_extract(ao.json, '$.chat.display_name'), ''),
        NULLIF(json_extract(ao.json, '$.chat.identifier'), ''),
        NULLIF(json_extract(ao.json, '$.chat.guid'), ''),
        'Unknown discussion'
      ) AS title,
      json_extract(ao.json, '$.chat.identifier') AS chat_jid,
      COALESCE(
        NULLIF(json_extract(ao.json, '$.chat.service'), ''),
        NULLIF(json_extract(ao.json, '$.source.path'), '')
      ) AS subtitle,
      MIN(json_extract(ao.json, '$.source.path')) AS source_path,
      COUNT(*) AS message_count,
      SUM(CASE WHEN ${inWindow} THEN 1 ELSE 0 END) AS in_window_count,
      SUM(CASE WHEN json_extract(ao.json, '$.direction') = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
      SUM(CASE WHEN json_extract(ao.json, '$.direction') = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
      SUM(CASE WHEN CAST(json_extract(ao.json, '$.message.has_attachments') AS INTEGER) = 1 THEN 1 ELSE 0 END) AS media_count,
      MIN(${IMESSAGE_TS_EXPR}) AS first_timestamp_ms,
      MAX(${IMESSAGE_TS_EXPR}) AS last_timestamp_ms
    FROM artifact_objects ao
    WHERE ao.evidence_id = $1
      AND ao.partition_id = $2
      AND ao.parser = 'mobile_ios_imessage'
      AND ao.kind = 'mobile.communication.message'
    GROUP BY ${IMESSAGE_CHAT_KEY_EXPR}
    ORDER BY last_timestamp_ms DESC, title ASC
    `,
    convParams,
  )) as DiscussionConversationRow[];

  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    message_count: Number(row.message_count ?? 0),
    in_window_count: Number(row.in_window_count ?? 0),
    incoming_count: Number(row.incoming_count ?? 0),
    outgoing_count: Number(row.outgoing_count ?? 0),
    media_count: Number(row.media_count ?? 0),
    first_timestamp_ms:
      row.first_timestamp_ms == null ? null : Number(row.first_timestamp_ms),
    last_timestamp_ms:
      row.last_timestamp_ms == null ? null : Number(row.last_timestamp_ms),
  }));
}

export async function getIMessageMessages(params: {
  evidenceId: number;
  partitionId: number;
  conversationId: string;
  offset: number;
  limit: number;
  search?: string;
}): Promise<{ rows: DiscussionMessageRow[]; rowCount: number }> {
  const db = await getEvidenceDb(params.evidenceId);

  const queryParams: any[] = [
    params.evidenceId,
    params.partitionId,
    params.conversationId,
  ];
  const clauses = [
    "ao.evidence_id = $1",
    "ao.partition_id = $2",
    "ao.parser = 'mobile_ios_imessage'",
    "ao.kind = 'mobile.communication.message'",
    `${IMESSAGE_CHAT_KEY_EXPR} = $3`,
  ];

  const search = params.search?.trim();
  if (search) {
    const ph = `$${queryParams.length + 1}`;
    queryParams.push(`%${escapeSqlLike(search.toLowerCase())}%`);
    clauses.push(`
      (
        LOWER(COALESCE(json_extract(ao.json, '$.message.text'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.sender.id'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.recipient.id'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.handle.id'), '')) LIKE ${ph} ESCAPE '\\'
        OR LOWER(COALESCE(json_extract(ao.json, '$.message.type_family'), '')) LIKE ${ph} ESCAPE '\\'
      )
    `);
  }

  const timeMatch = msTimeMatchExpr([IMESSAGE_TS_EXPR], queryParams);
  if (timeMatch !== "1") clauses.push(timeMatch);

  const whereSql = clauses.join(" AND ");
  const limitIndex = queryParams.length + 1;
  const offsetIndex = queryParams.length + 2;

  const rows = (await db.select(
    `
    SELECT
      ao.id AS id,
      CAST(json_extract(ao.json, '$.message.rowid') AS INTEGER) AS message_rowid,
      ${IMESSAGE_CHAT_KEY_EXPR} AS conversation_id,
      ${IMESSAGE_TS_EXPR} AS timestamp_ms,
      json_extract(ao.json, '$.direction') AS direction,
      json_extract(ao.json, '$.sender.id') AS sender_id,
      json_extract(ao.json, '$.sender.handle_id') AS sender_handle_id,
      json_extract(ao.json, '$.recipient.id') AS recipient_jid,
      json_extract(ao.json, '$.handle.id') AS handle_id,
      json_extract(ao.json, '$.chat.identifier') AS chat_jid,
      COALESCE(
        NULLIF(json_extract(ao.json, '$.message.display_text'), ''),
        NULLIF(json_extract(ao.json, '$.message.text'), '')
      ) AS text,
      json_extract(ao.json, '$.message.type_family') AS type_family,
      CAST(json_extract(ao.json, '$.message.item_type_code') AS INTEGER) AS type_code,
      CAST(json_extract(ao.json, '$.message.error_code') AS INTEGER) AS status_code,
      CAST(json_extract(ao.json, '$.message.has_attachments') AS INTEGER) AS has_attachments,
      json_extract(ao.json, '$.source.path') AS source_path,
      ao.json AS json_raw
    FROM artifact_objects ao
    WHERE ${whereSql}
    ORDER BY timestamp_ms ASC, ao.id ASC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
    `,
    [...queryParams, params.limit, params.offset],
  )) as any[];

  const countResult = (await db.select(
    `
    SELECT COUNT(*) AS count
    FROM artifact_objects ao
    WHERE ${whereSql}
    `,
    queryParams,
  )) as Array<{ count: number }>;

  const attachmentsByMessageRowid = new Map<
    number,
    ReturnType<typeof mapAttachmentRef>[]
  >();
  const messageRowids = Array.from(
    new Set(
      rows
        .map((row) =>
          row.message_rowid == null ? null : Number(row.message_rowid),
        )
        .filter((value): value is number => value != null && Number.isFinite(value)),
    ),
  );

  if (messageRowids.length > 0 && (await hasArtifactAttachmentRefs(db))) {
    const attachmentPlaceholders = messageRowids
      .map((_, index) => `$${index + 3}`)
      .join(", ");
    const attachmentRows = (await db.select(
      `
      SELECT
        id,
        message_rowid,
        kind,
        mime,
        file_name,
        file_size,
        duration_seconds,
        width,
        height,
        latitude,
        longitude,
        local_path,
        remote_url,
        thumbnail_local_path,
        resolved_file_id,
        resolved_fs_identifier,
        resolved_absolute_path,
        resolved_host_path,
        resolved_sig_mime,
        resolved_name,
        resolved_size,
        preview_mime,
        preview_base64
      FROM artifact_attachment_refs
      WHERE evidence_id = $1
        AND partition_id = $2
        AND parser = 'mobile_ios_imessage'
        AND message_rowid IN (${attachmentPlaceholders})
      ORDER BY message_rowid ASC, id ASC
      `,
      [params.evidenceId, params.partitionId, ...messageRowids],
    )) as WhatsAppAttachmentRefRow[];

    for (const attachment of attachmentRows) {
      if (attachment.message_rowid == null) continue;
      const messageRowid = Number(attachment.message_rowid);
      const existing = attachmentsByMessageRowid.get(messageRowid) ?? [];
      existing.push(mapAttachmentRef(attachment));
      attachmentsByMessageRowid.set(messageRowid, existing);
    }
  }

  if (messageRowids.length > 0) {
    const objectPlaceholders = messageRowids
      .map((_, index) => `$${index + 3}`)
      .join(", ");
    const attachmentObjects = (await db.select(
      `
      SELECT
        ao.id AS id,
        CAST(json_extract(ao.json, '$.message.rowid') AS INTEGER) AS message_rowid,
        json_extract(ao.json, '$.attachment.kind') AS kind,
        json_extract(ao.json, '$.attachment.mime') AS mime,
        json_extract(ao.json, '$.attachment.file_name') AS file_name,
        CAST(json_extract(ao.json, '$.attachment.total_bytes') AS INTEGER) AS file_size,
        ${IMESSAGE_ATTACHMENT_LOCAL_EXPR} AS local_path,
        json_extract(ao.json, '$.attachment.remote_url') AS remote_url,
        json_extract(ao.json, '$.attachment.thumbnail_path') AS thumbnail_local_path
      FROM artifact_objects ao
      WHERE ao.evidence_id = $1
        AND ao.partition_id = $2
        AND ao.parser = 'mobile_ios_imessage'
        AND ao.kind = 'mobile.communication.attachment'
        AND CAST(json_extract(ao.json, '$.message.rowid') AS INTEGER) IN (${objectPlaceholders})
      ORDER BY message_rowid ASC, ao.id ASC
      `,
      [params.evidenceId, params.partitionId, ...messageRowids],
    )) as Array<
      WhatsAppAttachmentRefRow & {
        id: number;
        message_rowid: number | null;
      }
    >;

    for (const attachment of attachmentObjects) {
      if (attachment.message_rowid == null) continue;
      const messageRowid = Number(attachment.message_rowid);
      const existing = attachmentsByMessageRowid.get(messageRowid) ?? [];
      const fallback = mapAttachmentRef(attachment);
      if (existing.length > 0) {
        existing[0] = {
          ...existing[0],
          kind:
            existing[0].kind === "unknown" ? fallback.kind : existing[0].kind,
          mime: existing[0].mime ?? fallback.mime,
          file_name: existing[0].file_name ?? fallback.file_name,
          file_size: existing[0].file_size ?? fallback.file_size,
          local_path: existing[0].local_path ?? fallback.local_path,
          remote_url: existing[0].remote_url ?? fallback.remote_url,
          thumbnail_path: existing[0].thumbnail_path ?? fallback.thumbnail_path,
        };
      } else {
        existing.push(fallback);
      }
      attachmentsByMessageRowid.set(messageRowid, existing);
    }
  }

  return {
    rows: rows.map((raw: any) => {
      const materializedAttachments =
        raw.message_rowid == null
          ? []
          : (attachmentsByMessageRowid.get(Number(raw.message_rowid)) ?? []);

      return {
        ...raw,
        id: Number(raw.id),
        sender: displayIMessageSender(raw),
        sender_jid: raw.sender_id ?? raw.handle_id ?? null,
        message_rowid:
          raw.message_rowid == null ? null : Number(raw.message_rowid),
        conversation_id: String(raw.conversation_id),
        timestamp_ms:
          raw.timestamp_ms == null ? null : Number(raw.timestamp_ms),
        type_code: raw.type_code == null ? null : Number(raw.type_code),
        type_family: nonEmptyString(raw.type_family),
        status_code:
          raw.status_code == null ? null : Number(raw.status_code),
        media_path: materializedAttachments[0]?.local_path ?? null,
        media_file_size: materializedAttachments[0]?.file_size ?? null,
        media_mime: materializedAttachments[0]?.mime ?? null,
        media_url: materializedAttachments[0]?.remote_url ?? null,
        attachments: materializedAttachments,
      };
    }),
    rowCount: Number(countResult?.[0]?.count ?? 0),
  };
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

  // Global time window over the backing file's timestamps.
  const queryParams = [evidenceId, partitionId, ...built.params];
  const timeWhere = fileTimeFilterClause("sf", queryParams);
  const aiLimitIdx = queryParams.length + 1;
  const aiOffsetIdx = queryParams.length + 2;

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
    ${timeWhere}
    LIMIT $${aiLimitIdx} OFFSET $${aiOffsetIdx}
  `;


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
  const fsParams: any[] = [evidenceId, partitionId];
  const fsTimeWhere = fileTimeFilterClause("system_files", fsParams);
  const rows: any[] = await db.select(
    `SELECT
       COALESCE(SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END), 0)  AS total_files,
       COALESCE(SUM(CASE WHEN is_dir = 1 THEN 1 ELSE 0 END), 0)  AS total_dirs,
       COALESCE(SUM(CASE WHEN is_dir = 0 THEN size ELSE 0 END), 0) AS total_size,
       MIN(CASE WHEN created  > 0 THEN created  END)              AS earliest_ts,
       MAX(CASE WHEN modified > 0 THEN modified
                WHEN created  > 0 THEN created  END)              AS latest_ts
     FROM system_files
     WHERE evidence_id = $1 AND partition_id = $2 ${fsTimeWhere}`,
    fsParams,
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
