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
                    id   INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT    NOT NULL CHECK (LENGTH(name) > 2)
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
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT    NOT NULL,
                    category    TEXT    NOT NULL,
                    version     TEXT    NOT NULL,
                    description TEXT    NOT NULL,
                    os          TEXT    NOT NULL CHECK (os IN ('Linux', 'Windows', 'MacOs', 'Any')),
                    parent_id   INTEGER,
                    FOREIGN KEY (parent_id) REFERENCES modules(id)
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 3: Seed default modules (only if they do not already exist).
        Migration {
            version: 3,
            description: "seed_default_modules",
            sql: r#"
                INSERT INTO modules (name, category, version, description, os, parent_id)
                SELECT 'DFI', 'Filesystem', '1.0',
                       'Directory and File Indexing: Parse a filesystem to extract files and directories',
                       'Any', NULL
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'DFI');
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 4: Create cases table and join table for collaborators (with CASCADE).
        Migration {
            version: 4,
            description: "create_cases_and_collaborators",
            sql: r#"
                CREATE TABLE IF NOT EXISTS cases (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT    NOT NULL,
                    description TEXT    NOT NULL
                );

                CREATE TABLE IF NOT EXISTS case_collaborators (
                    case_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    PRIMARY KEY (case_id, user_id),
                    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    case_id     INTEGER NOT NULL,
                    name        TEXT    NOT NULL,
                    type        TEXT    NOT NULL CHECK (type IN ('Physical Disk image', 'Logical Disk image', 'Memory Image', 'Procmon dump', 'Folder')),
                    path        TEXT    NOT NULL,
                    description TEXT    NOT NULL,
                    status      INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 6: Create partitions table referencing evidence (with CASCADE).
        Migration {
            version: 6,
            description: "create_partitions_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS partitions (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id         INTEGER NOT NULL,
                    kind                TEXT    NOT NULL CHECK (kind IN ('mbr', 'gpt', 'logical', 'folder')),
                    first_byte_addr     INTEGER NOT NULL DEFAULT 0,
                    size_sectors        INTEGER NOT NULL DEFAULT 0,
                    sector_size         INTEGER NOT NULL DEFAULT 512,
                    size_bytes          INTEGER NOT NULL DEFAULT 0,
                    start_lba           INTEGER,
                    end_lba             INTEGER,
                    partition_guid      TEXT,
                    partition_type_guid TEXT,
                    partition_name      TEXT,
                    partition_type      INTEGER,
                    boot_indicator      INTEGER,
                    start_chs           BLOB,
                    end_chs             BLOB,
                    attributes          INTEGER,
                    description         TEXT    NOT NULL DEFAULT '',
                    fvek                TEXT,
                    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 7: Create evidence preprocessing metadata table (with CASCADE).
        Migration {
            version: 7,
            description: "create_evidence_preprocessing_metadata_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS evidence_preprocessing_metadata (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id       INTEGER NOT NULL,
                    disk_image_format TEXT    NOT NULL,
                    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 8: Create evidence images table (with CASCADE).
        Migration {
            version: 8,
            description: "create_evidence_images_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS evidence_images (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id INTEGER NOT NULL,
                    caption     TEXT    NOT NULL CHECK (LENGTH(TRIM(caption)) > 0),
                    file_name   TEXT    NOT NULL,
                    mime_type   TEXT    NOT NULL,
                    source_kind TEXT    NOT NULL CHECK (source_kind IN ('camera', 'file')),
                    data        BLOB    NOT NULL,
                    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_evidence_images_evidence_id
                    ON evidence_images (evidence_id);
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 9: User-configured local and remote web applications.
        Migration {
            version: 9,
            description: "create_external_applications_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS external_applications (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    name                TEXT    NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 64),
                    description         TEXT    NOT NULL DEFAULT '' CHECK (LENGTH(description) <= 256),
                    url                 TEXT    NOT NULL CHECK (LENGTH(url) BETWEEN 1 AND 2048),
                    open_mode           TEXT    NOT NULL DEFAULT 'managed'
                                                CHECK (open_mode IN ('managed', 'browser')),
                    allow_insecure_http INTEGER NOT NULL DEFAULT 0
                                                CHECK (allow_insecure_http IN (0, 1)),
                    enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    show_dashboard      INTEGER NOT NULL DEFAULT 1 CHECK (show_dashboard IN (0, 1)),
                    show_sidebar        INTEGER NOT NULL DEFAULT 1 CHECK (show_sidebar IN (0, 1)),
                    icon_data_url       TEXT CHECK (icon_data_url IS NULL OR LENGTH(icon_data_url) <= 700000),
                    sort_order          INTEGER NOT NULL DEFAULT 0,
                    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
                    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_external_applications_navigation
                    ON external_applications (enabled, sort_order, name);
            "#,
            kind: MigrationKind::Up,
        },
    ];

    thanatology_lib::run(init_migrations);
}
