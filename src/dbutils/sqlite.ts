import Database from "@tauri-apps/plugin-sql";
import {
  MBRPartitionEntry,
  Module,
  Case,
  Evidence,
  ProcessedEvidenceMetadata,
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
    console.log(compatibleModules);
    return compatibleModules;
  }
  return [];
}

export async function createCaseAndEvidence(
  caseData: Case,
  evidenceList: Evidence[],
  db: Database | null,
): Promise<void> {
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
          evidence_preprocessing_id,
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
        preprocessingId,
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
