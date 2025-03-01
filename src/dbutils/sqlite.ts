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

// Create default modules
export async function createModules(db: Database | null) {
  if (!db) {
    throw new Error("Database connection not available");
  }

  // Insert the root module LFSI (no parent, so parent_id is NULL)
  await db.execute(
    `INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      "LFSI",
      "Filesystem",
      "1.0",
      1, // true (mandatory)
      "Linux FileSystem Indexing: Parse a given Linux filesystem metadata artefact (extfs, xfs, ...)",
      "Linux",
      null,
    ],
  );

  // Insert LDFI with LFSI as parent (using a subquery to fetch LFSI's id)
  await db.execute(
    `INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM modules WHERE name = ?));`,
    [
      "LDFI",
      "Filesystem",
      "1.0",
      1, // true (mandatory)
      "Linux Directory and File Indexing: Parse a Linux filesystem to extract files and directories",
      "Linux",
      "LFSI",
    ],
  );

  // Insert LSCI with LDFI as parent
  await db.execute(
    `INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM modules WHERE name = ?));`,
    [
      "LSCI",
      "Filesystem",
      "1.0",
      0, // false (not mandatory)
      "Linux System Configuration Indexing: Extract system configuration information from a Linux filesystem",
      "Linux",
      "LDFI",
    ],
  );

  // Insert LNCI with LDFI as parent
  await db.execute(
    `INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM modules WHERE name = ?));`,
    [
      "LNCI",
      "Filesystem",
      "1.0",
      0, // false (not mandatory)
      "Linux Network Configuration Indexing: Extract network configuration information from a Linux filesystem",
      "Linux",
      "LDFI",
    ],
  );
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
      "SELECT id, name, description FROM modules WHERE os = 'Linux'",
    );
    console.log(compatibleModules);
    return compatibleModules;
  }
  return [];
}
