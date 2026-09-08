// src/dbutils/tauriCommands.ts
import { invoke } from "@tauri-apps/api/core";
import type Database from "@tauri-apps/plugin-sql";
import type { EvidenceImageInput } from "./types";
import { getMainDb } from "./db";

type CaseInput = {
  name: string;
  description: string;
  collaboratorIds: number[]; // adjust to your IDs
};

type EvidenceInput = {
  name: string;
  type: string;
  path: string;
  description: string;
  images?: EvidenceImageInput[];
};

export type CaseMetadataInput = {
  name: string;
  description: string;
};

export type UpdatedCaseMetadata = CaseMetadataInput & {
  id: number;
};

export async function createCaseAndEvidences(
  caseData: CaseInput,
  evidences: EvidenceInput[],
): Promise<number> {
  // Returns the created case_id
  return await invoke<number>("create_case_with_evidence", {
    case: caseData,
    evidences,
  });
}

export async function updateCaseMetadata(
  database: Database | null,
  caseId: number,
  input: CaseMetadataInput,
): Promise<UpdatedCaseMetadata> {
  const name = input.name.trim();
  const description = input.description.trim();

  if (!Number.isInteger(caseId) || caseId <= 0) {
    throw new Error("Invalid case identifier.");
  }
  if (!name) {
    throw new Error("Case name is required.");
  }
  if (!description) {
    throw new Error("Case description is required.");
  }

  const db = database ?? (await getMainDb());
  const result = await db.execute(
    "UPDATE cases SET name = $1, description = $2 WHERE id = $3",
    [name, description, caseId],
  );

  if (result.rowsAffected !== 1) {
    throw new Error(`CASE-${caseId} no longer exists.`);
  }

  return { id: caseId, name, description };
}
