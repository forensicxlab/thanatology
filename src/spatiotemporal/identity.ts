import type { SpatiotemporalIdentity, SpatiotemporalRole } from "./types";

export function parseSpatiotemporalIdentity(
  role: SpatiotemporalRole,
  search = window.location.search,
): SpatiotemporalIdentity | null {
  const params = new URLSearchParams(search);
  const evidenceId = Number(params.get("evidenceId"));
  const partitionId = Number(params.get("partitionId"));
  if (
    !Number.isSafeInteger(evidenceId) ||
    evidenceId <= 0 ||
    !Number.isSafeInteger(partitionId) ||
    partitionId <= 0
  ) {
    return null;
  }
  return { evidenceId, partitionId, role };
}

