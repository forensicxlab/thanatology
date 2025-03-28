import Database from "@tauri-apps/plugin-sql";
import {
  MBRPartitionEntry,
  Module,
  Case,
  Evidence,
  ProcessedEvidenceMetadata,
  LinuxFile,
} from "./types";

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

// Fetch compatible modules given a partition
export async function getMBRCompatibleModules(
  mbr_parition: MBRPartitionEntry,
  db: Database | null,
) {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  if (
    mbr_parition.partition_type === 0x83 ||
    mbr_parition.partition_type === 0x8e
  ) {
    const compatibleModules: Module[] = await db.select(
      "SELECT * FROM modules WHERE os = 'Linux'",
    );
    return compatibleModules;
  }
  return [];
}

export async function createCaseAndEvidence(
  caseData: Case,
  evidenceList: Evidence[],
  db: Database | null,
): Promise<number> {
  // Change the Promise return type to 'number'
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Insert the case into the 'cases' table.
  const caseInsertResult: Array<{ id: number }> = await db.select(
    "INSERT INTO cases (name, description) VALUES ($1, $2) RETURNING id",
    [caseData.name, caseData.description],
  );

  if (caseInsertResult.length === 0) {
    throw new Error("Failed to retrieve the case ID.");
  }
  const caseId = caseInsertResult[0].id;

  // Insert each collaborator into the join table 'case_collaborators'.
  if (caseData.collaborators && caseData.collaborators.length > 0) {
    for (const userId of caseData.collaborators) {
      await db.execute(
        "INSERT OR IGNORE INTO case_collaborators (case_id, user_id) VALUES ($1, $2)",
        [caseId, userId],
      );
    }
  }

  // Insert each piece of evidence linked to this case.
  for (const evidence of evidenceList) {
    await db.execute(
      "INSERT INTO evidence (case_id, name, type, path, description) VALUES ($1, $2, $3, $4, $5)",
      [
        caseId,
        evidence.name,
        evidence.type,
        evidence.path,
        evidence.description,
      ],
    );
  }

  return caseId;
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
    await db.execute(
      `
        INSERT INTO evidence_preprocessing_selected_partitions (
          evidence_id,
          partition_type,
          boot_indicator,
          start_chs_1,
          start_chs_2,
          start_chs_3,
          end_chs_1,
          end_chs_2,
          end_chs_3,
          start_lba,
          size_sectors,
          sector_size,
          first_byte_address,
          description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        metadata.evidenceData.id,
        partition.partition_type,
        partition.boot_indicator,
        partition.start_chs[0],
        partition.start_chs[1],
        partition.start_chs[2],
        partition.end_chs[0],
        partition.end_chs[1],
        partition.end_chs[2],
        partition.start_lba,
        partition.size_sectors,
        partition.sector_size,
        partition.first_byte_addr,
        partition.description,
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
// Fetch the selected partitions metadata for a given evidence
export async function getSelectedPartitions(
  evidenceId: number,
  db: Database | null,
): Promise<MBRPartitionEntry[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  const rows: any[] = await db.select(
    "SELECT * FROM evidence_preprocessing_selected_partitions WHERE evidence_id = $1",
    [evidenceId],
  );
  // Map raw DB rows into complete MBRPartitionEntry objects
  return rows.map((row) => ({
    id: row.id,
    boot_indicator: row.boot_indicator,
    start_chs: [row.start_chs_1, row.start_chs_2, row.start_chs_3],
    partition_type: row.partition_type,
    end_chs: [row.end_chs_1, row.end_chs_2, row.end_chs_3],
    start_lba: row.start_lba,
    size_sectors: row.size_sectors,
    sector_size: row.sector_size,
    first_byte_addr: row.first_byte_address,
    description: row.description,
  }));
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
 * @returns An array of LinuxFile objects.
 */
export async function getFilesByEvidenceAndParent(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  parentDirectory: string,
): Promise<LinuxFile[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const files: LinuxFile[] = await db.select(
    `
     SELECT *
     FROM linux_files
     WHERE evidence_id = $1 AND partition_id = $2 AND parent_directory = $3
     ORDER BY file_type DESC, filename ASC
     `,
    [evidenceId, partitionId, parentDirectory],
  );

  return files;
}

/**
 * Fetch a single partition entry by ID.
 */
export async function getPartitionById(
  db: Database | null,
  partitionId: number,
): Promise<MBRPartitionEntry> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const rows: any[] = await db.select(
    "SELECT * FROM evidence_preprocessing_selected_partitions WHERE id = ?",
    [partitionId],
  );

  if (rows.length === 0) {
    throw new Error(`Partition with ID ${partitionId} not found.`);
  }

  const row = rows[0];
  return {
    id: row.id,
    boot_indicator: row.boot_indicator,
    start_chs: [row.start_chs_1, row.start_chs_2, row.start_chs_3],
    partition_type: row.partition_type,
    end_chs: [row.end_chs_1, row.end_chs_2, row.end_chs_3],
    start_lba: row.start_lba,
    size_sectors: row.size_sectors,
    sector_size: row.sector_size,
    first_byte_addr: row.first_byte_address,
    description: row.description,
  };
}

export async function getFileByEvidenceAndAbsolutePath(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  absolutePath: string,
): Promise<LinuxFile | null> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const rows: LinuxFile[] = await db.select(
    `
      SELECT *
      FROM linux_files
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

/**
 * Searches for LinuxFiles using a SQL LIKE query.
 * @param db - The Database instance (if null, a new connection is loaded).
 * @param evidenceId - The evidence ID.
 * @param partitionId - The partition ID.
 * @param pattern - The search pattern (e.g. '%term%').
 * @returns An array of matching LinuxFile objects.
 */
export async function searchLinuxFiles(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
  pattern: string,
): Promise<LinuxFile[]> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }
  const query = `
    SELECT * FROM linux_files
    WHERE evidence_id = $1 AND partition_id = $2
      AND (filename LIKE $3 OR absolute_path LIKE $3)
    ORDER BY file_type DESC, filename ASC
  `;
  const files: LinuxFile[] = await db.select(query, [
    evidenceId,
    partitionId,
    pattern,
  ]);
  return files;
}
