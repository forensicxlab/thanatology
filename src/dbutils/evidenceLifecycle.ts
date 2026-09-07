import { invoke } from "@tauri-apps/api/core";

import { closeEvidenceDb } from "./db";
import type { Evidence } from "./types";

export type CancelEvidenceProcessingResult = {
  outcome: "stopped" | "resetToNotProcessed";
  status: number;
};

export type RelinkEvidenceSourceResult = {
  evidenceId: number;
  oldPath: string;
  newPath: string;
  status: number;
};

export type EvidenceSourceStatus = {
  available: boolean;
  reason: string | null;
  path: string;
  evidenceType: Evidence["type"];
};

/**
 * Close the renderer's SQLite handle before the backend stops or discards an
 * evidence analysis database. This is especially important on Windows, where
 * an open plugin-sql connection prevents the database from being removed.
 */
export async function cancelEvidenceProcessing(
  evidenceId: number,
): Promise<CancelEvidenceProcessingResult> {
  await closeEvidenceDb(evidenceId);
  return invoke<CancelEvidenceProcessingResult>("cancel_processing", {
    evidenceId,
  });
}

export async function restartEvidenceProcessing(evidenceId: number): Promise<void> {
  await closeEvidenceDb(evidenceId);
  await invoke("reset_evidence", { evidenceId });
}

export async function relinkEvidenceSourceAndReset(
  evidenceId: number,
  newPath: string,
): Promise<RelinkEvidenceSourceResult> {
  // Release the renderer handle before the backend atomically validates the
  // new source, removes generated analysis, and commits the new path/status.
  await closeEvidenceDb(evidenceId);
  return invoke<RelinkEvidenceSourceResult>(
    "relink_evidence_source_and_reset",
    { evidenceId, newPath },
  );
}

export async function getEvidenceSourceStatus(
  evidenceId: number,
): Promise<EvidenceSourceStatus> {
  return invoke<EvidenceSourceStatus>("get_evidence_source_status", {
    evidenceId,
  });
}
