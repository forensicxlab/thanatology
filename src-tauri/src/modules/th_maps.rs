use futures::StreamExt;
use reqwest::header::{CONTENT_RANGE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const SETTINGS_FILE: &str = "map-settings.json";
const DEFAULT_MAP_DIR: &str = "maps";
const CUSTOM_MAP_DIR: &str = "Thanatology Maps";
const PROTOMAPS_BUILDS_URL: &str = "https://build-metadata.protomaps.dev/builds.json";
const PROTOMAPS_BUILD_BASE: &str = "https://build.protomaps.com";
const MAPTERHORN_PLANET_URL: &str = "https://download.mapterhorn.com/planet.pmtiles";
const BASEMAP_ASSETS_URL: &str =
    "https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.zip";

#[derive(Default)]
pub struct MapDownloadState {
    active: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct MapSettings {
    storage_root: Option<String>,
    active_pack_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapPackFile {
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapPackManifest {
    pub id: String,
    pub name: String,
    pub created_at_unix: u64,
    pub provider: String,
    pub basemap: MapPackFile,
    pub terrain: Option<MapPackFile>,
    pub attribution: Vec<String>,
    pub assets_version: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapPackSummary {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub created_at_unix: u64,
    pub size_bytes: u64,
    pub has_terrain: bool,
    pub is_active: bool,
    pub available: bool,
    pub attribution: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapStorageStatus {
    pub root: String,
    pub is_default: bool,
    pub available: bool,
    pub free_bytes: Option<u64>,
    pub used_bytes: u64,
    pub active_pack_id: Option<String>,
    pub active_pack: Option<MapPackSummary>,
    pub packs: Vec<MapPackSummary>,
    pub assets_installed: bool,
    pub download_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMapPackRequest {
    pub name: String,
    pub include_terrain: bool,
    pub basemap_url: Option<String>,
    pub terrain_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMapPackRequest {
    pub name: String,
    pub basemap_path: String,
    pub terrain_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MapDownloadProgress {
    pack_id: String,
    phase: String,
    file_name: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ProtomapsBuild {
    key: String,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SETTINGS_FILE))
}

fn load_settings(app: &AppHandle) -> Result<MapSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(MapSettings::default());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Cannot read map settings at {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid map settings: {error}"))
}

fn save_settings(app: &AppHandle, settings: &MapSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("json.partial");
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("Cannot serialize map settings: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Cannot commit {}: {error}", path.display()))
}

fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(DEFAULT_MAP_DIR))
}

fn configured_root(app: &AppHandle, settings: &MapSettings) -> Result<PathBuf, String> {
    settings
        .storage_root
        .as_ref()
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| default_root(app))
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn make_pack_id(name: &str) -> String {
    let mut normalized = name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    while normalized.contains("--") {
        normalized = normalized.replace("--", "-");
    }
    let normalized = normalized.trim_matches('-');
    let prefix = if normalized.is_empty() {
        "map-pack"
    } else {
        normalized
    };
    format!(
        "{}-{}",
        prefix.chars().take(60).collect::<String>(),
        unix_now()
    )
}

fn ensure_storage_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join("packs"))
        .map_err(|error| format!("Cannot create map storage at {}: {error}", root.display()))?;
    fs::create_dir_all(root.join("downloads"))
        .map_err(|error| format!("Cannot create map download directory: {error}"))?;
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn read_manifest(path: &Path) -> Result<MapPackManifest, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Cannot read map manifest {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid map manifest {}: {error}", path.display()))
}

fn write_manifest(path: &Path, manifest: &MapPackManifest) -> Result<(), String> {
    let temporary = path.with_extension("json.partial");
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Cannot serialize map manifest: {error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("Cannot write map manifest: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("Cannot commit map manifest: {error}"))
}

fn manifest_available(pack_dir: &Path, manifest: &MapPackManifest) -> bool {
    let basemap = pack_dir.join(&manifest.basemap.file_name);
    if !basemap.is_file() {
        return false;
    }
    manifest
        .terrain
        .as_ref()
        .map(|terrain| pack_dir.join(&terrain.file_name).is_file())
        .unwrap_or(true)
}

fn list_packs(root: &Path, active_id: Option<&str>) -> Vec<MapPackSummary> {
    let mut packs = Vec::new();
    let Ok(entries) = fs::read_dir(root.join("packs")) else {
        return packs;
    };
    for entry in entries.flatten() {
        let pack_dir = entry.path();
        let manifest_path = pack_dir.join("manifest.json");
        let Ok(manifest) = read_manifest(&manifest_path) else {
            continue;
        };
        let size_bytes = manifest.basemap.size_bytes
            + manifest
                .terrain
                .as_ref()
                .map(|terrain| terrain.size_bytes)
                .unwrap_or(0);
        let available = manifest_available(&pack_dir, &manifest);
        packs.push(MapPackSummary {
            id: manifest.id.clone(),
            name: manifest.name,
            provider: manifest.provider,
            created_at_unix: manifest.created_at_unix,
            size_bytes,
            has_terrain: manifest.terrain.is_some(),
            is_active: active_id == Some(manifest.id.as_str()),
            available,
            attribution: manifest.attribution,
        });
    }
    packs.sort_by(|left, right| right.created_at_unix.cmp(&left.created_at_unix));
    packs
}

#[tauri::command]
pub fn get_map_storage_status(
    app: AppHandle,
    download_state: State<'_, MapDownloadState>,
) -> Result<MapStorageStatus, String> {
    let settings = load_settings(&app)?;
    let root = configured_root(&app, &settings)?;
    let is_default = settings.storage_root.is_none();
    if is_default && !root.exists() {
        ensure_storage_root(&root)?;
    }
    let available = root.exists() && root.is_dir();
    let packs = if available {
        list_packs(&root, settings.active_pack_id.as_deref())
    } else {
        Vec::new()
    };
    let active_pack = packs.iter().find(|pack| pack.is_active).cloned();
    Ok(MapStorageStatus {
        root: root.display().to_string(),
        is_default,
        available,
        free_bytes: if available {
            fs2::available_space(&root).ok()
        } else {
            None
        },
        used_bytes: if available { directory_size(&root) } else { 0 },
        active_pack_id: settings.active_pack_id,
        active_pack,
        packs,
        assets_installed: root.join("assets").join(".complete").is_file(),
        download_active: download_state.active.load(Ordering::SeqCst),
    })
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Cannot read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Cannot inspect {}: {error}", source_path.display()))?;
        if metadata.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Cannot copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
            let copied_size = fs::metadata(&destination_path)
                .map_err(|error| format!("Cannot verify {}: {error}", destination_path.display()))?
                .len();
            if copied_size != metadata.len() {
                return Err(format!(
                    "Size verification failed for {}",
                    destination_path.display()
                ));
            }
        }
    }
    Ok(())
}

fn move_storage(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination || !source.exists() {
        ensure_storage_root(destination)?;
        return Ok(());
    }
    if destination.starts_with(source) || source.starts_with(destination) {
        return Err("The new map location cannot be inside the current map location.".to_string());
    }
    if destination.exists()
        && fs::read_dir(destination)
            .ok()
            .and_then(|mut it| it.next())
            .is_some()
    {
        copy_directory(source, destination)?;
        fs::remove_dir_all(source).map_err(|error| {
            format!("Maps were copied, but the old location could not be removed: {error}")
        })?;
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    if fs::rename(source, destination).is_err() {
        copy_directory(source, destination)?;
        fs::remove_dir_all(source).map_err(|error| {
            format!("Maps were copied, but the old location could not be removed: {error}")
        })?;
    }
    ensure_storage_root(destination)
}

#[tauri::command]
pub async fn set_map_storage_root(
    app: AppHandle,
    selected_directory: Option<String>,
    move_existing: bool,
) -> Result<MapStorageStatus, String> {
    let mut settings = load_settings(&app)?;
    let old_root = configured_root(&app, &settings)?;
    let new_root = match selected_directory.as_deref().map(str::trim) {
        Some(path) if !path.is_empty() => {
            let selected = PathBuf::from(path);
            if selected.file_name().and_then(|name| name.to_str()) == Some(CUSTOM_MAP_DIR) {
                selected
            } else {
                selected.join(CUSTOM_MAP_DIR)
            }
        }
        _ => default_root(&app)?,
    };
    let old_root_for_move = old_root.clone();
    let new_root_for_move = new_root.clone();
    if move_existing {
        tokio::task::spawn_blocking(move || move_storage(&old_root_for_move, &new_root_for_move))
            .await
            .map_err(|error| format!("Map move task failed: {error}"))??;
    } else {
        ensure_storage_root(&new_root)?;
        if old_root != new_root {
            settings.active_pack_id = None;
        }
    }
    settings.storage_root = if selected_directory
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .is_some()
    {
        Some(new_root.display().to_string())
    } else {
        None
    };
    save_settings(&app, &settings)?;
    let state = app.state::<MapDownloadState>();
    get_map_storage_status(app.clone(), state)
}

#[tauri::command]
pub fn activate_map_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    if !safe_id(&pack_id) {
        return Err("Invalid map pack identifier.".to_string());
    }
    let mut settings = load_settings(&app)?;
    let root = configured_root(&app, &settings)?;
    let manifest = read_manifest(&root.join("packs").join(&pack_id).join("manifest.json"))?;
    if !manifest_available(&root.join("packs").join(&pack_id), &manifest) {
        return Err("The selected map pack is incomplete or unavailable.".to_string());
    }
    settings.active_pack_id = Some(pack_id);
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn remove_map_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    if !safe_id(&pack_id) {
        return Err("Invalid map pack identifier.".to_string());
    }
    let mut settings = load_settings(&app)?;
    let root = configured_root(&app, &settings)?;
    let pack_dir = root.join("packs").join(&pack_id);
    if pack_dir.exists() {
        fs::remove_dir_all(&pack_dir)
            .map_err(|error| format!("Cannot remove map pack {}: {error}", pack_dir.display()))?;
    }
    if settings.active_pack_id.as_deref() == Some(pack_id.as_str()) {
        settings.active_pack_id = None;
        save_settings(&app, &settings)?;
    }
    Ok(())
}

async fn latest_protomaps_url(client: &reqwest::Client) -> Result<String, String> {
    let mut builds: Vec<ProtomapsBuild> = client
        .get(PROTOMAPS_BUILDS_URL)
        .send()
        .await
        .map_err(|error| format!("Cannot retrieve the Protomaps build catalog: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Protomaps build catalog returned an error: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Cannot parse the Protomaps build catalog: {error}"))?;
    builds.retain(|build| build.key.ends_with(".pmtiles"));
    builds.sort_by(|left, right| right.key.cmp(&left.key));
    let key = builds
        .first()
        .map(|build| build.key.as_str())
        .ok_or_else(|| {
            "The Protomaps build catalog did not contain a PMTiles archive.".to_string()
        })?;
    Ok(format!("{PROTOMAPS_BUILD_BASE}/{key}"))
}

fn validate_download_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Ok(())
    } else {
        Err("Map download URLs must use HTTP or HTTPS.".to_string())
    }
}

fn content_range_total(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.parse().ok()
}

async fn hash_existing_file(path: &Path, hasher: &mut Sha256) -> Result<u64, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("Cannot open partial download {}: {error}", path.display()))?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Cannot read partial download: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }
    Ok(total)
}

async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    state: &MapDownloadState,
    pack_id: &str,
    phase: &str,
    url: &str,
    destination: &Path,
) -> Result<MapPackFile, String> {
    validate_download_url(url)?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("map data")
        .to_string();
    let partial = destination.with_extension(format!(
        "{}.partial",
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("download")
    ));

    let mut existing = tokio::fs::metadata(&partial)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut response = {
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        request
            .send()
            .await
            .map_err(|error| format!("Cannot download {url}: {error}"))?
    };

    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        tokio::fs::remove_file(&partial).await.ok();
        existing = 0;
        response = client
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Cannot restart {url}: {error}"))?;
    }
    response = response
        .error_for_status()
        .map_err(|error| format!("Download failed for {url}: {error}"))?;

    let resumed = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if existing > 0 && !resumed {
        existing = 0;
    }
    let total_bytes = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(content_range_total)
        .or_else(|| response.content_length().map(|length| length + existing));

    let mut hasher = Sha256::new();
    if resumed {
        hash_existing_file(&partial, &mut hasher).await?;
    }
    let mut output = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&partial)
        .await
        .map_err(|error| format!("Cannot create {}: {error}", partial.display()))?;

    let mut downloaded = existing;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if state.cancel.load(Ordering::SeqCst) {
            output.flush().await.ok();
            return Err(
                "Map download cancelled. The partial file was retained for resume.".to_string(),
            );
        }
        let chunk = chunk.map_err(|error| format!("Map download interrupted: {error}"))?;
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("Cannot write {}: {error}", partial.display()))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        app.emit(
            "map-download-progress",
            MapDownloadProgress {
                pack_id: pack_id.to_string(),
                phase: phase.to_string(),
                file_name: file_name.clone(),
                downloaded_bytes: downloaded,
                total_bytes,
                message: format!("Downloading {file_name}"),
            },
        )
        .ok();
    }
    output
        .flush()
        .await
        .map_err(|error| format!("Cannot flush {}: {error}", partial.display()))?;
    drop(output);
    tokio::fs::rename(&partial, destination)
        .await
        .map_err(|error| format!("Cannot commit {}: {error}", destination.display()))?;

    Ok(MapPackFile {
        file_name,
        size_bytes: downloaded,
        sha256: hex::encode(hasher.finalize()),
        source_url: Some(url.to_string()),
    })
}

fn validate_pmtiles(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("Cannot open {}: {error}", path.display()))?;
    let mut header = [0_u8; 8];
    file.read_exact(&mut header).map_err(|error| {
        format!(
            "Cannot read PMTiles header from {}: {error}",
            path.display()
        )
    })?;
    if &header[..7] != b"PMTiles" || header[7] != 3 {
        return Err(format!("{} is not a PMTiles v3 archive.", path.display()));
    }
    Ok(())
}

fn unpack_assets_archive(archive_path: &Path, assets_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|error| format!("Cannot open basemap assets archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Cannot read basemap assets archive: {error}"))?;
    let temporary = assets_dir.with_extension("partial");
    if temporary.exists() {
        fs::remove_dir_all(&temporary)
            .map_err(|error| format!("Cannot clear incomplete assets: {error}"))?;
    }
    fs::create_dir_all(&temporary)
        .map_err(|error| format!("Cannot create assets directory: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot read assets archive entry: {error}"))?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let components = enclosed.components().collect::<Vec<_>>();
        if components.len() < 3 {
            continue;
        }
        let category = match components[1] {
            Component::Normal(value) if value == "fonts" || value == "sprites" => value,
            _ => continue,
        };
        let mut relative = PathBuf::from(category);
        for component in components.iter().skip(2) {
            if let Component::Normal(value) = component {
                relative.push(value);
            }
        }
        let output_path = temporary.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Cannot create {}: {error}", output_path.display()))?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
        }
        let mut output = File::create(&output_path)
            .map_err(|error| format!("Cannot create {}: {error}", output_path.display()))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract {}: {error}", output_path.display()))?;
    }
    fs::write(temporary.join(".complete"), b"Protomaps basemap assets\n")
        .map_err(|error| format!("Cannot mark assets complete: {error}"))?;
    if assets_dir.exists() {
        fs::remove_dir_all(assets_dir)
            .map_err(|error| format!("Cannot replace basemap assets: {error}"))?;
    }
    fs::rename(&temporary, assets_dir)
        .map_err(|error| format!("Cannot commit basemap assets: {error}"))
}

async fn ensure_assets(
    app: &AppHandle,
    client: &reqwest::Client,
    state: &MapDownloadState,
    root: &Path,
    pack_id: &str,
) -> Result<(), String> {
    let assets_dir = root.join("assets");
    if assets_dir.join(".complete").is_file() {
        return Ok(());
    }
    let archive = root.join("downloads").join("basemaps-assets.zip");
    let _ = download_file(
        app,
        client,
        state,
        pack_id,
        "assets",
        BASEMAP_ASSETS_URL,
        &archive,
    )
    .await?;
    let archive_for_task = archive.clone();
    let assets_for_task = assets_dir.clone();
    tokio::task::spawn_blocking(move || unpack_assets_archive(&archive_for_task, &assets_for_task))
        .await
        .map_err(|error| format!("Basemap asset extraction task failed: {error}"))??;
    tokio::fs::remove_file(archive).await.ok();
    Ok(())
}

async fn perform_download(
    app: &AppHandle,
    state: &MapDownloadState,
    request: DownloadMapPackRequest,
) -> Result<MapPackManifest, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Map pack name is required.".to_string());
    }
    let settings = load_settings(app)?;
    let root = configured_root(app, &settings)?;
    ensure_storage_root(&root)?;
    let pack_id = make_pack_id(name);
    let pack_dir = root.join("packs").join(&pack_id);
    fs::create_dir_all(&pack_dir)
        .map_err(|error| format!("Cannot create map pack directory: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent("Thanatology/0.1 map-pack-downloader")
        .build()
        .map_err(|error| format!("Cannot create map download client: {error}"))?;

    let basemap_url = match request.basemap_url.as_deref().map(str::trim) {
        Some(url) if !url.is_empty() => url.to_string(),
        _ => latest_protomaps_url(&client).await?,
    };
    let terrain_url = if request.include_terrain {
        Some(
            request
                .terrain_url
                .as_deref()
                .map(str::trim)
                .filter(|url| !url.is_empty())
                .unwrap_or(MAPTERHORN_PLANET_URL)
                .to_string(),
        )
    } else {
        None
    };

    let basemap = download_file(
        app,
        &client,
        state,
        &pack_id,
        "basemap",
        &basemap_url,
        &pack_dir.join("basemap.pmtiles"),
    )
    .await?;
    validate_pmtiles(&pack_dir.join("basemap.pmtiles"))?;

    let terrain = if let Some(url) = terrain_url {
        let terrain = download_file(
            app,
            &client,
            state,
            &pack_id,
            "terrain",
            &url,
            &pack_dir.join("terrain.pmtiles"),
        )
        .await?;
        validate_pmtiles(&pack_dir.join("terrain.pmtiles"))?;
        Some(terrain)
    } else {
        None
    };
    ensure_assets(app, &client, state, &root, &pack_id).await?;

    let manifest = MapPackManifest {
        id: pack_id.clone(),
        name: name.to_string(),
        created_at_unix: unix_now(),
        provider: if request
            .basemap_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .is_some()
        {
            "Custom PMTiles".to_string()
        } else {
            "Protomaps v4 + Mapterhorn".to_string()
        },
        basemap,
        terrain,
        attribution: vec![
            "© OpenStreetMap contributors".to_string(),
            "Protomaps".to_string(),
            "Mapterhorn terrain data sources".to_string(),
        ],
        assets_version: 4,
    };
    write_manifest(&pack_dir.join("manifest.json"), &manifest)?;
    let mut updated_settings = settings;
    updated_settings.active_pack_id = Some(pack_id.clone());
    save_settings(app, &updated_settings)?;
    app.emit(
        "map-download-progress",
        MapDownloadProgress {
            pack_id,
            phase: "complete".to_string(),
            file_name: String::new(),
            downloaded_bytes: manifest.basemap.size_bytes
                + manifest
                    .terrain
                    .as_ref()
                    .map(|file| file.size_bytes)
                    .unwrap_or(0),
            total_bytes: None,
            message: "Map pack installed and activated.".to_string(),
        },
    )
    .ok();
    Ok(manifest)
}

#[tauri::command]
pub async fn download_map_pack(
    app: AppHandle,
    state: State<'_, MapDownloadState>,
    request: DownloadMapPackRequest,
) -> Result<MapPackManifest, String> {
    if state
        .active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Another map download or import is already running.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = perform_download(&app, &state, request).await;
    state.active.store(false, Ordering::SeqCst);
    state.cancel.store(false, Ordering::SeqCst);
    result
}

fn copy_and_hash(
    source: &Path,
    destination: &Path,
    app: &AppHandle,
    pack_id: &str,
    phase: &str,
    cancel: &AtomicBool,
) -> Result<MapPackFile, String> {
    validate_pmtiles(source)?;
    let total = fs::metadata(source)
        .map_err(|error| format!("Cannot inspect {}: {error}", source.display()))?
        .len();
    let partial = destination.with_extension("pmtiles.partial");
    let mut input =
        File::open(source).map_err(|error| format!("Cannot open {}: {error}", source.display()))?;
    let mut output = File::create(&partial)
        .map_err(|error| format!("Cannot create {}: {error}", partial.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut copied = 0_u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Map import cancelled.".to_string());
        }
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read {}: {error}", source.display()))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write {}: {error}", partial.display()))?;
        hasher.update(&buffer[..read]);
        copied += read as u64;
        app.emit(
            "map-download-progress",
            MapDownloadProgress {
                pack_id: pack_id.to_string(),
                phase: phase.to_string(),
                file_name: destination
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("map data")
                    .to_string(),
                downloaded_bytes: copied,
                total_bytes: Some(total),
                message: format!("Importing {}", source.display()),
            },
        )
        .ok();
    }
    output
        .flush()
        .map_err(|error| format!("Cannot flush {}: {error}", partial.display()))?;
    fs::rename(&partial, destination)
        .map_err(|error| format!("Cannot commit {}: {error}", destination.display()))?;
    Ok(MapPackFile {
        file_name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("map.pmtiles")
            .to_string(),
        size_bytes: copied,
        sha256: hex::encode(hasher.finalize()),
        source_url: None,
    })
}

async fn perform_import(
    app: &AppHandle,
    state: &MapDownloadState,
    request: ImportMapPackRequest,
) -> Result<MapPackManifest, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Map pack name is required.".to_string());
    }
    let settings = load_settings(app)?;
    let root = configured_root(app, &settings)?;
    ensure_storage_root(&root)?;
    let pack_id = make_pack_id(name);
    let pack_dir = root.join("packs").join(&pack_id);
    fs::create_dir_all(&pack_dir)
        .map_err(|error| format!("Cannot create map pack directory: {error}"))?;

    let basemap_source = PathBuf::from(&request.basemap_path);
    let basemap_destination = pack_dir.join("basemap.pmtiles");
    let app_for_copy = app.clone();
    let id_for_copy = pack_id.clone();
    let cancel_for_copy = state.cancel.clone();
    let basemap = tokio::task::spawn_blocking(move || {
        copy_and_hash(
            &basemap_source,
            &basemap_destination,
            &app_for_copy,
            &id_for_copy,
            "basemap",
            cancel_for_copy.as_ref(),
        )
    })
    .await
    .map_err(|error| format!("Map import task failed: {error}"))??;

    let terrain = if let Some(path) = request
        .terrain_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let terrain_source = PathBuf::from(path);
        let terrain_destination = pack_dir.join("terrain.pmtiles");
        let app_for_copy = app.clone();
        let id_for_copy = pack_id.clone();
        let cancel_for_copy = state.cancel.clone();
        Some(
            tokio::task::spawn_blocking(move || {
                copy_and_hash(
                    &terrain_source,
                    &terrain_destination,
                    &app_for_copy,
                    &id_for_copy,
                    "terrain",
                    cancel_for_copy.as_ref(),
                )
            })
            .await
            .map_err(|error| format!("Terrain import task failed: {error}"))??,
        )
    } else {
        None
    };

    let client = reqwest::Client::builder()
        .user_agent("Thanatology/0.1 map-pack-downloader")
        .build()
        .map_err(|error| format!("Cannot create map asset client: {error}"))?;
    ensure_assets(app, &client, state, &root, &pack_id).await?;

    let manifest = MapPackManifest {
        id: pack_id.clone(),
        name: name.to_string(),
        created_at_unix: unix_now(),
        provider: "Imported PMTiles".to_string(),
        basemap,
        terrain,
        attribution: vec![
            "© OpenStreetMap contributors".to_string(),
            "Imported map data — verify provider attribution".to_string(),
        ],
        assets_version: 4,
    };
    write_manifest(&pack_dir.join("manifest.json"), &manifest)?;
    let mut updated_settings = settings;
    updated_settings.active_pack_id = Some(pack_id);
    save_settings(app, &updated_settings)?;
    Ok(manifest)
}

#[tauri::command]
pub async fn import_map_pack(
    app: AppHandle,
    state: State<'_, MapDownloadState>,
    request: ImportMapPackRequest,
) -> Result<MapPackManifest, String> {
    if state
        .active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Another map download or import is already running.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = perform_import(&app, &state, request).await;
    state.active.store(false, Ordering::SeqCst);
    state.cancel.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn cancel_map_download(state: State<'_, MapDownloadState>) -> bool {
    if state.active.load(Ordering::SeqCst) {
        state.cancel.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

fn active_manifest(app: &AppHandle) -> Result<(PathBuf, MapPackManifest), String> {
    let settings = load_settings(app)?;
    let root = configured_root(app, &settings)?;
    let pack_id = settings
        .active_pack_id
        .ok_or_else(|| "No local map pack is active.".to_string())?;
    if !safe_id(&pack_id) {
        return Err("Invalid active map pack identifier.".to_string());
    }
    let pack_dir = root.join("packs").join(pack_id);
    let manifest = read_manifest(&pack_dir.join("manifest.json"))?;
    Ok((pack_dir, manifest))
}

#[tauri::command]
pub fn read_map_range(
    app: AppHandle,
    kind: String,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    const MAX_RANGE: u64 = 16 * 1024 * 1024;
    if length == 0 || length > MAX_RANGE {
        return Err(format!(
            "Map range length must be between 1 and {MAX_RANGE} bytes."
        ));
    }
    let (pack_dir, manifest) = active_manifest(&app)?;
    let file = match kind.as_str() {
        "basemap" => &manifest.basemap,
        "terrain" => manifest
            .terrain
            .as_ref()
            .ok_or_else(|| "The active map pack has no terrain archive.".to_string())?,
        _ => return Err("Unknown map archive kind.".to_string()),
    };
    let path = pack_dir.join(&file.file_name);
    let mut input = File::open(&path)
        .map_err(|error| format!("Cannot open local map archive {}: {error}", path.display()))?;
    let file_length = input
        .metadata()
        .map_err(|error| format!("Cannot inspect local map archive: {error}"))?
        .len();
    if offset >= file_length {
        return Err("Requested map range begins beyond the end of the archive.".to_string());
    }
    let readable = length.min(file_length - offset);
    input
        .seek(SeekFrom::Start(offset))
        .map_err(|error| format!("Cannot seek local map archive: {error}"))?;
    let mut bytes = vec![0_u8; readable as usize];
    input
        .read_exact(&mut bytes)
        .map_err(|error| format!("Cannot read local map archive: {error}"))?;
    Ok(bytes)
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid map asset path.".to_string());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
pub fn read_map_asset(app: AppHandle, relative_path: String) -> Result<Vec<u8>, String> {
    let settings = load_settings(&app)?;
    let root = configured_root(&app, &settings)?;
    let relative = safe_relative_path(&relative_path)?;
    let path = root.join("assets").join(relative);
    fs::read(&path).map_err(|error| format!("Cannot read map asset {}: {error}", path.display()))
}
