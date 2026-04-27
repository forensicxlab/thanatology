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
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT NOT NULL,
                    category   TEXT NOT NULL,
                    version    TEXT NOT NULL,
                    description TEXT NOT NULL,
                    os         TEXT NOT NULL CHECK (os IN ('Linux', 'Windows', 'MacOs', 'Any')),
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
                -- Insert the root module DFI (no parent)
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
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    case_id     INTEGER NOT NULL,
                    name        TEXT NOT NULL,
                    type        TEXT NOT NULL CHECK (type IN ('Physical Disk image', 'Logical Disk image', 'Memory Image', 'Procmon dump', 'Folder')),
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
        // Migration 6: Create portable partitions table referencing evidence.
        Migration {
            version: 6,
            description: "create_partitions_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS partitions (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id         INTEGER NOT NULL,
                    kind                TEXT NOT NULL CHECK (kind IN ('mbr', 'gpt', 'logical', 'folder')),
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
                    description         TEXT NOT NULL DEFAULT '',
                    fvek                TEXT,
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
            description: "create_preprocessing_evidence_metadata_table",
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
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "evidence_system_file",
            sql: r#"
                CREATE TABLE IF NOT EXISTS system_files (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    evidence_id     INTEGER NOT NULL,
                    partition_id    INTEGER NOT NULL,
                    identifier      INTEGER NOT NULL,
                    absolute_path   TEXT    NOT NULL,
                    name            TEXT    NOT NULL,
                    ftype           TEXT    NOT NULL,
                    size            INTEGER NOT NULL,
                    created         INTEGER,
                    modified        INTEGER,
                    accessed        INTEGER,
                    permissions     TEXT,
                    owner           TEXT,
                    "group"         TEXT,
                    display         TEXT,
                    path_key        TEXT    NOT NULL,
                    parent_path_key TEXT,
                    depth           INTEGER NOT NULL DEFAULT 0,
                    is_dir          INTEGER NOT NULL DEFAULT 0,
                    sig_name        TEXT,
                    sig_mime TEXT,
                    sig_exts TEXT,
                    metadata        JSON    NOT NULL,
                    FOREIGN KEY (evidence_id)
                        REFERENCES evidence(id)
                        ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "evidence_artifacts",
            sql: r#"
            CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                evidence_id     INTEGER NOT NULL,
                file_id INTEGER NOT NULL,
                partition_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                parser TEXT,
                tag TEXT NOT NULL,
                category TEXT NOT NULL,
                FOREIGN KEY (evidence_id)
                    REFERENCES evidence(id)
                    ON DELETE CASCADE
                FOREIGN KEY (file_id)
                    REFERENCES system_files(id)
                    ON DELETE CASCADE
            );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "evidence_artifacts",
            sql: r#"
            CREATE INDEX IF NOT EXISTS idx_sysfiles_ev_part ON system_files (evidence_id, partition_id);
            CREATE INDEX IF NOT EXISTS idx_sysfiles_created  ON system_files (created);
            CREATE INDEX IF NOT EXISTS idx_sysfiles_accessed ON system_files (accessed);
            CREATE INDEX IF NOT EXISTS idx_sysfiles_modified ON system_files (modified);
            CREATE INDEX IF NOT EXISTS idx_sysfiles_tree_path
              ON system_files (evidence_id, partition_id, path_key);
            CREATE INDEX IF NOT EXISTS idx_sysfiles_tree_parent
              ON system_files (evidence_id, partition_id, parent_path_key, is_dir, name);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "evidence_artefacts_parser",
            sql: r#"
            CREATE TABLE IF NOT EXISTS artifact_objects (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,

              evidence_id  INTEGER NOT NULL,
              partition_id INTEGER NOT NULL,

              artifact_id  INTEGER NOT NULL,
              file_id      INTEGER,

              parser       TEXT NOT NULL,
              kind         TEXT NOT NULL,

              text         TEXT,
              json         TEXT NOT NULL,

              created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),

              FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE,
              FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
              FOREIGN KEY (file_id)     REFERENCES system_files(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_artifact_objects_evp
              ON artifact_objects(evidence_id, partition_id);

            CREATE INDEX IF NOT EXISTS idx_artifact_objects_artifact
              ON artifact_objects(artifact_id);

            CREATE INDEX IF NOT EXISTS idx_artifact_objects_file
              ON artifact_objects(file_id);

            CREATE INDEX IF NOT EXISTS idx_artifact_objects_parser_kind
              ON artifact_objects(parser, kind);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "evidence_images",
            sql: r#"
            CREATE TABLE IF NOT EXISTS evidence_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                evidence_id INTEGER NOT NULL,
                caption TEXT NOT NULL CHECK (LENGTH(TRIM(caption)) > 0),
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                source_kind TEXT NOT NULL CHECK (source_kind IN ('camera', 'file')),
                data BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (evidence_id)
                    REFERENCES evidence(id)
                    ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_evidence_images_evidence_id
                ON evidence_images (evidence_id);
            "#,
            kind: MigrationKind::Up,
        },
    ];

    thanatology_lib::run(init_migrations);
}
