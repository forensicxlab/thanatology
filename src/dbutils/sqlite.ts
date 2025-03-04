import Database from "@tauri-apps/plugin-sql";
import { MBRPartitionEntry, Module } from "./types";
export async function createUser(username: string, db: Database | null) {
  if (!db) {
    throw new Error("Database connection not available");
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
    throw new Error("Database connection not available");
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
