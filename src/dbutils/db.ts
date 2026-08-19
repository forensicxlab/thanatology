import Database from "@tauri-apps/plugin-sql";
import { appLocalDataDir, join } from "@tauri-apps/api/path";

let mainDbPromise: Promise<Database> | null = null;
const evidenceDbPromises = new Map<number, Promise<Database>>();

function toSqliteUrl(p: string) {
  return p.startsWith("sqlite:") ? p : `sqlite:${p}`;
}

export async function getMainDb(): Promise<Database> {
  if (!mainDbPromise) {
    mainDbPromise = Database.load("sqlite:thanatology.db");
  }
  return mainDbPromise;
}

export async function getEvidenceDbPath(evidenceId: number): Promise<string> {
  const base = await appLocalDataDir();
  return join(base, "evidences", `${evidenceId}.db`);
}

export async function getEvidenceDb(evidenceId: number): Promise<Database> {
  const cached = evidenceDbPromises.get(evidenceId);
  if (cached) return cached;

  const p = (async () => {
    const path = await getEvidenceDbPath(evidenceId);
    return Database.load(toSqliteUrl(path));
  })();

  evidenceDbPromises.set(evidenceId, p);
  return p;
}

export async function closeEvidenceDb(evidenceId: number): Promise<void> {
  const pending = evidenceDbPromises.get(evidenceId);
  evidenceDbPromises.delete(evidenceId);
  if (!pending) return;

  const database = await pending;
  await database.close(database.path);
}
