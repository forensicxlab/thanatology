// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    let init_migrations = vec![
        // Migration 1: Create users table.
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL CHECK (LENGTH(name) > 2)
                );
            ",
            kind: MigrationKind::Up,
        },
        // Migration 2: Create modules table with OS and parent-child relationship.
        Migration {
            version: 2,
            description: "create_modules_table",
            sql: "
                CREATE TABLE IF NOT EXISTS modules (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    version TEXT NOT NULL,
                    mandatory BOOLEAN NOT NULL,
                    description TEXT NOT NULL,
                    os TEXT NOT NULL CHECK (os IN ('Linux', 'Windows', 'MacOs')),
                    parent_id INTEGER,
                    FOREIGN KEY (parent_id) REFERENCES modules(id)
                );
            ",
            kind: MigrationKind::Up,
        },
        // Migration 3: Insert default modules (only if they do not already exist).
        Migration {
            version: 3,
            description: "insert_default_modules",
            sql: "
                -- Insert the root module LFSI (no parent)
                INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
                SELECT 'LFSI', 'Filesystem', '1.0', 1,
                       'Linux FileSystem Indexing: Parse a given Linux filesystem metadata artefact (extfs, xfs, ...)',
                       'Linux', NULL
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'LFSI');

                -- Insert LDFI with LFSI as parent
                INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
                SELECT 'LDFI', 'Filesystem', '1.0', 1,
                       'Linux Directory and File Indexing: Parse a Linux filesystem to extract files and directories',
                       'Linux',
                       (SELECT id FROM modules WHERE name = 'LFSI')
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'LDFI');

                -- Insert LSCI with LDFI as parent
                INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
                SELECT 'LSCI', 'Filesystem', '1.0', 0,
                       'Linux System Configuration Indexing: Extract system configuration information from a Linux filesystem',
                       'Linux',
                       (SELECT id FROM modules WHERE name = 'LDFI')
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'LSCI');

                -- Insert LNCI with LDFI as parent
                INSERT INTO modules (name, category, version, mandatory, description, os, parent_id)
                SELECT 'LNCI', 'Filesystem', '1.0', 0,
                       'Linux Network Configuration Indexing: Extract network configuration information from a Linux filesystem',
                       'Linux',
                       (SELECT id FROM modules WHERE name = 'LDFI')
                WHERE NOT EXISTS (SELECT 1 FROM modules WHERE name = 'LNCI');
            ",
            kind: MigrationKind::Up,
        },
    ];
    thanatology_lib::run(init_migrations)
}
