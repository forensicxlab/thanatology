// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    let init_migrations = vec![
        // First Migration
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
    ];
    thanatology_lib::run(init_migrations)
}
