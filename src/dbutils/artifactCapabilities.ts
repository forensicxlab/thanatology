import { getEvidenceDb } from "./db";

export type ArtifactCategory =
  | "Application"
  | "Users"
  | "Network"
  | "System"
  | "Media";

/** A parser actually bound to at least one source file in an artifact group. */
export interface ArtifactCapability {
  parser: string | null;
  artifactCount: number;
}

/** One outer category tab and the parsers that make semantic views possible. */
export interface ArtifactTagDescriptor {
  tag: string;
  capabilities: readonly ArtifactCapability[];
}

interface CapabilityRow {
  tag: string;
  parser: string | null;
  artifact_count: number | string;
}

/**
 * Load category tabs and their parser capabilities without scanning
 * `artifact_objects`. Some evidence sets contain hundreds of thousands of
 * parsed Spotlight rows, while `artifacts` only contains one row per matched
 * source file and already records the parser selected by the catalog.
 */
export async function fetchArtifactTagDescriptors(
  evidenceId: number,
  partitionId: number,
  category: ArtifactCategory,
): Promise<ArtifactTagDescriptor[]> {
  const db = await getEvidenceDb(evidenceId);
  const rows = await db.select<CapabilityRow[]>(
    `SELECT tag, parser, COUNT(*) AS artifact_count
     FROM artifacts
     WHERE evidence_id = $1
       AND partition_id = $2
       AND category = $3
     GROUP BY tag, parser
     ORDER BY tag COLLATE NOCASE ASC, parser COLLATE NOCASE ASC`,
    [evidenceId, partitionId, category],
  );

  const descriptors = new Map<string, ArtifactCapability[]>();
  for (const row of rows ?? []) {
    const tag = String(row.tag ?? "").trim();
    if (!tag) continue;

    const capabilities = descriptors.get(tag) ?? [];
    capabilities.push({
      parser: row.parser?.trim() || null,
      artifactCount: Number(row.artifact_count ?? 0),
    });
    descriptors.set(tag, capabilities);
  }

  return Array.from(descriptors, ([tag, capabilities]) => ({
    tag,
    capabilities,
  }));
}

export function hasParserCapability(
  descriptor: ArtifactTagDescriptor,
  ...parsers: readonly string[]
): boolean {
  const expected = new Set(parsers);
  return descriptor.capabilities.some(
    ({ parser }) => parser != null && expected.has(parser),
  );
}
