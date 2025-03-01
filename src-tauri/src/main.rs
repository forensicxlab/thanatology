// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    let init_migrations = vec![
        // First Migration: Create users table.
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL CHECK (LENGTH(name) > 2)
                );
            ",
            kind: MigrationKind::Up,
        },
        // Second Migration: Create modules table with OS and parent-child relationship.
        Migration {
            version: 2,
            description: "create_modules_table",
            sql: "
                CREATE TABLE modules (
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
    ];
    thanatology_lib::run(init_migrations)
}
