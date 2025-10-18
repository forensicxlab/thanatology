// src/dbutils/tauriCommands.ts
import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir } from "@tauri-apps/api/path";

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
};

export async function createCaseAndEvidences(
  caseData: CaseInput,
  evidences: EvidenceInput[],
): Promise<number> {
  const appLocalDataDirPath = await appLocalDataDir();
  // Returns the created case_id
  return await invoke<number>("create_case_with_evidence", {
    case: caseData,
    evidences,
    dbPath: `${appLocalDataDirPath}/thanatology.db`,
  });
}
