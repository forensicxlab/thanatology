use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAIN_DATABASE_FILE_NAME: &str = "thanatology.db";

fn main_database_path_in(config_dir: &Path) -> PathBuf {
    config_dir.join(MAIN_DATABASE_FILE_NAME)
}

/// Resolve the database managed by `tauri-plugin-sql`.
///
/// Relative plugin database URLs are rooted in Tauri's application config
/// directory. Keeping backend access on the same path is especially important
/// on Windows, where the config and local-data directories are distinct.
pub(crate) fn main_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config directory: {error}"))?;
    Ok(main_database_path_in(&config_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_database_is_resolved_below_the_config_directory() {
        let config_dir = Path::new("root with spaces").join("com.thanatology.app");

        assert_eq!(
            main_database_path_in(&config_dir),
            config_dir.join("thanatology.db")
        );
    }
}
