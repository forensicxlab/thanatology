// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    // A vector of migrations that will run in ascending order by version.
    let init_migrations = vec![
        // Migration 1: Create users table.
        Migration {
            version: 1,
            description: "create_users_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS users (
                    id   INTEGER PRIMARY KEY,
                    name TEXT NOT NULL CHECK (LENGTH(name) > 2)
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 2: Create modules table with OS and parent-child relationship.
        Migration {
            version: 2,
            description: "create_modules_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS modules (
                    id         INTEGER PRIMARY KEY,
                    name       TEXT NOT NULL,
                    category   TEXT NOT NULL,
                    version    TEXT NOT NULL,
                    description TEXT NOT NULL,
                    os         TEXT NOT NULL CHECK (os IN ('Linux', 'Windows', 'MacOs')),
                    parent_id  INTEGER,
                    FOREIGN KEY (parent_id) REFERENCES modules(id)
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 3: Insert default modules (only if they do not already exist).
        Migration {
            version: 3,
            description: "insert_default_modules",
            sql: r#"
                -- Insert the root module LDFI (no parent)
                INSERT INTO modules (name, category, version, description, os, parent_id)
                SELECT 'LDFI', 'Filesystem', '1.0',
                       'Linux Directory and File Indexing: Parse a Linux filesystem to extract files and directories',
                       'Linux', NULL
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'LDFI');
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 4: Create cases table and join table for collaborators (with CASCADE).
        Migration {
            version: 4,
            description: "create_cases_and_collaborators",
            sql: r#"
                CREATE TABLE IF NOT EXISTS cases (
                    id          INTEGER PRIMARY KEY,
                    name        TEXT NOT NULL,
                    description TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS case_collaborators (
                    case_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    PRIMARY KEY (case_id, user_id),
                    FOREIGN KEY (case_id)
                        REFERENCES cases(id)
                        ON DELETE CASCADE,
                    FOREIGN KEY (user_id)
                        REFERENCES users(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 5: Create evidence table linked to cases (with CASCADE).
        Migration {
            version: 5,
            description: "create_evidence_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS evidence (
                    id          INTEGER PRIMARY KEY,
                    case_id     INTEGER NOT NULL,
                    name        TEXT NOT NULL,
                    type        TEXT NOT NULL CHECK (type IN ('Disk image', 'Memory Image', 'Procmon dump')),
                    path        TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status      INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (case_id)
                        REFERENCES cases(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 6: Create MBR partition entries referencing evidence (with CASCADE).
        Migration {
            version: 6,
            description: "create_mbr_partition_entries_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS mbr_partition_entries (
                    evidence_id        INTEGER PRIMARY KEY,
                    boot_indicator     INTEGER NOT NULL,
                    start_chs_1        INTEGER NOT NULL,
                    start_chs_2        INTEGER NOT NULL,
                    start_chs_3        INTEGER NOT NULL,
                    end_chs_1          INTEGER NOT NULL,
                    end_chs_2          INTEGER NOT NULL,
                    end_chs_3          INTEGER NOT NULL,
                    start_lba          INTEGER NOT NULL,
                    size_sectors       INTEGER NOT NULL,
                    sector_size        INTEGER NOT NULL,
                    first_byte_address INTEGER NOT NULL,
                    description        TEXT NOT NULL,
                    FOREIGN KEY (evidence_id)
                        REFERENCES evidence(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 7: Create evidence preprocessing metadata & related tables (with CASCADE).
        Migration {
            version: 7,
            description: "create_preprocessing_evidence_metadata_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS evidence_preprocessing_metadata (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id      INTEGER NOT NULL,
                    disk_image_format TEXT NOT NULL,
                    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY(evidence_id)
                        REFERENCES evidence(id)
                        ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS evidence_preprocessing_selected_partitions (
                    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id               INTEGER NOT NULL,
                    partition_type            INTEGER NOT NULL,
                    boot_indicator            INTEGER,
                    start_chs_1              INTEGER,
                    start_chs_2              INTEGER,
                    start_chs_3              INTEGER,
                    end_chs_1                INTEGER,
                    end_chs_2                INTEGER,
                    end_chs_3                INTEGER,
                    start_lba                INTEGER,
                    size_sectors             INTEGER,
                    sector_size              INTEGER,
                    first_byte_address       INTEGER,
                    description              TEXT,
                    FOREIGN KEY (evidence_id)
                        REFERENCES evidence(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "evidence_linux_file",
            sql: r#"
                CREATE TABLE IF NOT EXISTS linux_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id INTEGER NOT NULL,
                    absolute_path TEXT,
                    filename TEXT,
                    parent_directory TEXT,
                    inode_number INTEGER,
                    file_type TEXT,
                    size_bytes INTEGER,
                    owner_uid INTEGER,
                    group_gid INTEGER,
                    permissions_mode INTEGER,
                    hard_link_count INTEGER,
                    access_time TEXT,
                    modification_time TEXT,
                    change_time TEXT,
                    creation_time TEXT,
                    extended_attributes TEXT,
                    symlink_target TEXT,
                    mount_point TEXT,
                    filesystem_type TEXT,
                    FOREIGN KEY (evidence_id)
                        REFERENCES evidence(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
    ];

    thanatology_lib::run(init_migrations);
}
