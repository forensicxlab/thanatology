use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use exhume_body::Body;
use exhume_filesystem::detected_fs::{DetectedFs, ImageStream, detect_filesystem};
use exhume_filesystem::filesystem::{FileCommon, Filesystem};
use exhume_filesystem::folder_impl::FolderFS;
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File as StdFile;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::State;
use tauri::http::{Method, Request as HttpRequest, Response as HttpResponse, StatusCode, header};

pub type SharedState = Arc<Mutex<Option<DetectedFs<ImageStream>>>>;
pub type MediaServeState = Arc<Mutex<HashMap<String, MediaSource>>>;

#[derive(Clone, Debug)]
pub struct MediaSource {
    file_id: u64,
    path: Option<String>,
    root_path: Option<String>,
    mime: Option<String>,
    preview: bool,
}

#[derive(Serialize)]
pub struct MediaSourceUrl {
    pub url: String,
}

#[derive(Serialize, Deserialize)]
pub struct FsInfo {
    pub filesystem_type: String,
    pub block_size: u64,
    pub metadata: Value,
    pub image_size: u64,
}

const MAX_PLIST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PLIST_NODES: usize = 100_000;
const MAX_PLIST_DEPTH: usize = 128;
const MAX_PLIST_DATA_PREVIEW_BYTES: usize = 256 * 1024;
const MAX_PLIST_DATA_PREVIEW_TOTAL_BYTES: usize = 1024 * 1024;
const MAX_PLIST_AGGREGATE_DATA_BYTES: u64 = 32 * 1024 * 1024;
const MAX_JAVASCRIPT_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const PLIST_VALUE_MARKER: &str = "$plistValue";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlistSource {
    pub source_kind: String,
    pub file_id: u64,
    pub requested_path: Option<String>,
    pub root_path: Option<String>,
    pub resolved_path: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlistStats {
    pub node_count: usize,
    pub dictionary_count: usize,
    pub array_count: usize,
    pub data_value_count: usize,
    pub data_bytes: u64,
    pub data_preview_bytes: u64,
    pub truncated_data_values: usize,
    pub max_depth: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlistParseLimits {
    pub max_input_bytes: u64,
    pub max_nodes: usize,
    pub max_depth: usize,
    pub data_preview_bytes: usize,
    pub total_data_preview_bytes: usize,
    pub max_aggregate_data_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlistDocument {
    pub format: String,
    pub root_type: String,
    pub byte_length: u64,
    pub sha256: String,
    pub source: PlistSource,
    pub stats: PlistStats,
    pub limits: PlistParseLimits,
    pub value: Value,
}

fn plist_value_type(value: &plist::Value) -> &'static str {
    match value {
        plist::Value::Array(_) => "array",
        plist::Value::Dictionary(_) => "dictionary",
        plist::Value::Boolean(_) => "boolean",
        plist::Value::Data(_) => "data",
        plist::Value::Date(_) => "date",
        plist::Value::Real(_) => "real",
        plist::Value::Integer(_) => "integer",
        plist::Value::String(_) => "string",
        plist::Value::Uid(_) => "uid",
        _ => "unknown",
    }
}

fn plist_marker(kind: &str, mut fields: JsonMap<String, Value>) -> Value {
    fields.insert("version".to_string(), Value::Number(JsonNumber::from(1)));
    fields.insert("kind".to_string(), Value::String(kind.to_string()));
    let mut wrapper = JsonMap::new();
    wrapper.insert(PLIST_VALUE_MARKER.to_string(), Value::Object(fields));
    Value::Object(wrapper)
}

fn plist_integer_value(value: plist::Integer) -> Result<Value, String> {
    if let Some(signed) = value.as_signed() {
        if (-MAX_JAVASCRIPT_SAFE_INTEGER..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&signed) {
            return Ok(Value::Number(JsonNumber::from(signed)));
        }
        let mut fields = JsonMap::new();
        fields.insert("decimal".to_string(), Value::String(signed.to_string()));
        return Ok(plist_marker("integer", fields));
    }

    if let Some(unsigned) = value.as_unsigned() {
        let mut fields = JsonMap::new();
        fields.insert("decimal".to_string(), Value::String(unsigned.to_string()));
        return Ok(plist_marker("integer", fields));
    }

    Err("Property list contains an unsupported integer".to_string())
}

fn typed_plist_value(
    value: &plist::Value,
    depth: usize,
    stats: &mut PlistStats,
) -> Result<Value, String> {
    if depth > MAX_PLIST_DEPTH {
        return Err(format!(
            "Property list exceeds the maximum nesting depth of {MAX_PLIST_DEPTH}"
        ));
    }

    stats.node_count = stats.node_count.saturating_add(1);
    if stats.node_count > MAX_PLIST_NODES {
        return Err(format!(
            "Property list exceeds the maximum node count of {MAX_PLIST_NODES}"
        ));
    }
    stats.max_depth = stats.max_depth.max(depth);

    match value {
        plist::Value::Array(values) => {
            stats.array_count = stats.array_count.saturating_add(1);
            values
                .iter()
                .map(|value| typed_plist_value(value, depth + 1, stats))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        plist::Value::Dictionary(values) => {
            stats.dictionary_count = stats.dictionary_count.saturating_add(1);
            let mut object = JsonMap::new();
            for (key, value) in values {
                object.insert(key.clone(), typed_plist_value(value, depth + 1, stats)?);
            }
            if object.contains_key(PLIST_VALUE_MARKER) {
                let mut fields = JsonMap::new();
                fields.insert("entries".to_string(), Value::Object(object));
                Ok(plist_marker("dictionary", fields))
            } else {
                Ok(Value::Object(object))
            }
        }
        plist::Value::Boolean(value) => Ok(Value::Bool(*value)),
        plist::Value::String(value) => Ok(Value::String(value.clone())),
        plist::Value::Integer(value) => plist_integer_value(*value),
        plist::Value::Real(value) if value.is_finite() => JsonNumber::from_f64(*value)
            .map(Value::Number)
            .ok_or_else(|| "Property list contains an unsupported real number".to_string()),
        plist::Value::Real(value) => {
            let mut fields = JsonMap::new();
            fields.insert("value".to_string(), Value::String(value.to_string()));
            Ok(plist_marker("real", fields))
        }
        plist::Value::Date(value) => {
            let mut fields = JsonMap::new();
            fields.insert("value".to_string(), Value::String(value.to_xml_format()));
            Ok(plist_marker("date", fields))
        }
        plist::Value::Uid(value) => {
            let mut fields = JsonMap::new();
            fields.insert(
                "decimal".to_string(),
                Value::String(value.get().to_string()),
            );
            Ok(plist_marker("uid", fields))
        }
        plist::Value::Data(value) => {
            stats.data_value_count = stats.data_value_count.saturating_add(1);
            stats.data_bytes = stats.data_bytes.saturating_add(value.len() as u64);
            let remaining_preview = MAX_PLIST_DATA_PREVIEW_TOTAL_BYTES
                .saturating_sub(stats.data_preview_bytes as usize);
            let preview_len = value
                .len()
                .min(MAX_PLIST_DATA_PREVIEW_BYTES)
                .min(remaining_preview);
            stats.data_preview_bytes = stats.data_preview_bytes.saturating_add(preview_len as u64);
            let truncated = preview_len < value.len();
            if truncated {
                stats.truncated_data_values = stats.truncated_data_values.saturating_add(1);
            }
            let mut hasher = Sha256::new();
            hasher.update(value);
            let mut fields = JsonMap::new();
            fields.insert("encoding".to_string(), Value::String("base64".to_string()));
            fields.insert(
                "byteLength".to_string(),
                Value::Number(JsonNumber::from(value.len() as u64)),
            );
            fields.insert(
                "sha256".to_string(),
                Value::String(format!("{:x}", hasher.finalize())),
            );
            fields.insert(
                "value".to_string(),
                Value::String(BASE64_STANDARD.encode(&value[..preview_len])),
            );
            fields.insert("truncated".to_string(), Value::Bool(truncated));
            Ok(plist_marker("data", fields))
        }
        _ => Err("Property list contains an unsupported value type".to_string()),
    }
}

fn detect_plist_format(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"bplist00") {
        return Ok("binary");
    }

    let prefix_len = bytes.len().min(4096);
    let prefix = std::str::from_utf8(&bytes[..prefix_len])
        .map_err(|_| "Unsupported property list encoding (expected XML or bplist00)".to_string())?;
    let prefix = prefix.trim_start_matches('\u{feff}').trim_start();
    if prefix.contains("<plist") {
        Ok("xml")
    } else {
        Err("Unsupported property list encoding (expected XML or bplist00)".to_string())
    }
}

fn preflight_plist(bytes: &[u8]) -> Result<(), String> {
    let mut depth = 0usize;
    let mut node_count = 0usize;
    let mut aggregate_data_bytes = 0u64;

    for event in plist::stream::Reader::new(Cursor::new(bytes)) {
        let event = event.map_err(|error| format!("Failed plist safety preflight: {error}"))?;
        match event {
            plist::stream::Event::StartArray(_) | plist::stream::Event::StartDictionary(_) => {
                node_count = node_count.saturating_add(1);
                if node_count > MAX_PLIST_NODES {
                    return Err(format!(
                        "Property list exceeds the maximum node count of {MAX_PLIST_NODES}"
                    ));
                }
                if depth > MAX_PLIST_DEPTH {
                    return Err(format!(
                        "Property list exceeds the maximum nesting depth of {MAX_PLIST_DEPTH}"
                    ));
                }
                depth = depth.saturating_add(1);
            }
            plist::stream::Event::EndCollection => {
                depth = depth.saturating_sub(1);
            }
            plist::stream::Event::Data(data) => {
                node_count = node_count.saturating_add(1);
                aggregate_data_bytes = aggregate_data_bytes.saturating_add(data.len() as u64);
                if aggregate_data_bytes > MAX_PLIST_AGGREGATE_DATA_BYTES {
                    return Err(format!(
                        "Property list exceeds the aggregate binary-data limit of {MAX_PLIST_AGGREGATE_DATA_BYTES} bytes"
                    ));
                }
            }
            plist::stream::Event::Boolean(_)
            | plist::stream::Event::Date(_)
            | plist::stream::Event::Integer(_)
            | plist::stream::Event::Real(_)
            | plist::stream::Event::String(_)
            | plist::stream::Event::Uid(_) => {
                node_count = node_count.saturating_add(1);
            }
            _ => {}
        }

        if node_count > MAX_PLIST_NODES {
            return Err(format!(
                "Property list exceeds the maximum node count of {MAX_PLIST_NODES}"
            ));
        }
        if depth > MAX_PLIST_DEPTH.saturating_add(1) {
            return Err(format!(
                "Property list exceeds the maximum nesting depth of {MAX_PLIST_DEPTH}"
            ));
        }
    }
    Ok(())
}

fn parse_plist_document(bytes: &[u8], source: PlistSource) -> Result<PlistDocument, String> {
    if bytes.is_empty() {
        return Err("Cannot parse an empty property list".to_string());
    }
    if bytes.len() as u64 > MAX_PLIST_BYTES {
        return Err(format!(
            "Property list is {} bytes; the viewer limit is {MAX_PLIST_BYTES} bytes",
            bytes.len()
        ));
    }

    let format = detect_plist_format(bytes)?;
    preflight_plist(bytes)?;
    let plist = plist::Value::from_reader(Cursor::new(bytes))
        .map_err(|error| format!("Failed to parse {format} property list: {error}"))?;
    let root_type = plist_value_type(&plist).to_string();
    let mut stats = PlistStats::default();
    let value = typed_plist_value(&plist, 0, &mut stats)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);

    Ok(PlistDocument {
        format: format.to_string(),
        root_type,
        byte_length: bytes.len() as u64,
        sha256: format!("{:x}", hasher.finalize()),
        source,
        stats,
        limits: PlistParseLimits {
            max_input_bytes: MAX_PLIST_BYTES,
            max_nodes: MAX_PLIST_NODES,
            max_depth: MAX_PLIST_DEPTH,
            data_preview_bytes: MAX_PLIST_DATA_PREVIEW_BYTES,
            total_data_preview_bytes: MAX_PLIST_DATA_PREVIEW_TOTAL_BYTES,
            max_aggregate_data_bytes: MAX_PLIST_AGGREGATE_DATA_BYTES,
        },
        value,
    })
}

fn resolve_host_file_path(path: Option<&str>, root_path: Option<&str>) -> Option<PathBuf> {
    let path = path?.trim();
    if path.is_empty() {
        return None;
    }

    if let Some(root_path) = root_path {
        let root = PathBuf::from(root_path.trim());
        if root.exists() {
            let relative = path.trim_start_matches(['/', '\\']);
            let joined = root.join(relative);
            if joined.exists() {
                return Some(joined);
            }
        }
    }

    let direct = PathBuf::from(path);
    if direct.exists() {
        return Some(direct);
    }

    None
}

fn resolve_scoped_host_file_path(
    path: &str,
    root_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root_path = root_path.trim();
    if root_path.is_empty() {
        return Err("Folder evidence root path is empty".to_string());
    }
    let requested_path = path.trim();
    if requested_path.is_empty() {
        return Err("Folder evidence file path is empty".to_string());
    }

    let canonical_root = std::fs::canonicalize(root_path)
        .map_err(|error| format!("Failed to resolve folder evidence root: {error}"))?;
    if !canonical_root.is_dir() {
        return Err(format!(
            "Folder evidence root is not a directory: {}",
            canonical_root.display()
        ));
    }

    let requested = PathBuf::from(requested_path);
    let evidence_relative = canonical_root.join(requested_path.trim_start_matches(['/', '\\']));
    let candidate = if evidence_relative.exists() {
        evidence_relative
    } else if requested.is_absolute() {
        requested
    } else {
        evidence_relative
    };
    let canonical_candidate = std::fs::canonicalize(&candidate).map_err(|error| {
        format!(
            "Failed to resolve selected folder-evidence file {}: {error}",
            candidate.display()
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!(
            "Selected file resolves outside the folder evidence root: {}",
            canonical_candidate.display()
        ));
    }

    Ok((canonical_root, canonical_candidate))
}

fn read_host_slice(path: &Path, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    let mut file = StdFile::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0; length];
    let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
    buffer.truncate(read);
    Ok(buffer)
}

fn read_host_prefix(path: &Path, length: usize) -> Result<Vec<u8>, String> {
    read_host_slice(path, 0, length)
}

fn read_host_bytes(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

fn read_host_bytes_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!(
            "Selected path is not a regular file: {}",
            path.display()
        ));
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "Selected file is {} bytes; the viewer limit is {max_bytes} bytes",
            metadata.len()
        ));
    }

    let file = StdFile::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "Selected file exceeds the viewer limit of {max_bytes} bytes"
        ));
    }
    Ok(bytes)
}

fn hash_media_source(
    file_id: u64,
    path: Option<&str>,
    root_path: Option<&str>,
    mime: Option<&str>,
    preview: bool,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_id.to_le_bytes());
    hasher.update([u8::from(preview)]);

    for value in [path, root_path, mime] {
        match value {
            Some(value) => {
                hasher.update([1]);
                hasher.update(value.as_bytes());
            }
            None => hasher.update([0]),
        }
    }

    format!("{:x}", hasher.finalize())
}

fn clean_mime(mime: Option<&str>) -> String {
    let mime = mime.unwrap_or("application/octet-stream").trim();
    if mime.is_empty() || mime.contains('\r') || mime.contains('\n') {
        "application/octet-stream".to_string()
    } else {
        mime.to_string()
    }
}

fn build_image_preview(original: &[u8]) -> Result<Vec<u8>, String> {
    const MAX_PREVIEW_SIDE: u32 = 512;

    let image = image::load_from_memory(original).map_err(|e| e.to_string())?;
    let preview = image.thumbnail(MAX_PREVIEW_SIDE, MAX_PREVIEW_SIDE);
    let mut cursor = Cursor::new(Vec::new());
    preview
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}

fn parse_single_range(header_value: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }

    let range = header_value
        .strip_prefix("bytes=")?
        .split(',')
        .next()?
        .trim();
    let (start_raw, end_raw) = range.split_once('-')?;

    if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix_len);
        return Some((start, total_len - 1));
    }

    let start = start_raw.parse::<u64>().ok()?;
    if start >= total_len {
        return None;
    }

    let end = if end_raw.is_empty() {
        total_len - 1
    } else {
        end_raw.parse::<u64>().ok()?.min(total_len - 1)
    };

    if end < start {
        None
    } else {
        Some((start, end))
    }
}

fn media_source_size(state: &SharedState, source: &MediaSource) -> Result<u64, String> {
    if let Some(host_path) =
        resolve_host_file_path(source.path.as_deref(), source.root_path.as_deref())
    {
        return std::fs::metadata(host_path)
            .map(|metadata| metadata.len())
            .map_err(|e| e.to_string());
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    let file = match fs.get_file(source.file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(path) = source.path.as_deref() {
                fs.get_file_by_path(path, source.file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    source.file_id
                ));
            }
        }
    };

    Ok(file.size())
}

fn read_media_source_slice(
    state: &SharedState,
    source: &MediaSource,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    if let Some(host_path) =
        resolve_host_file_path(source.path.as_deref(), source.root_path.as_deref())
    {
        return read_host_slice(&host_path, offset, length);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    let file = match fs.get_file(source.file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(path) = source.path.as_deref() {
                fs.get_file_by_path(path, source.file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    source.file_id
                ));
            }
        }
    };

    fs.read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())
}

fn empty_response(status: StatusCode, message: &str) -> HttpResponse<Vec<u8>> {
    HttpResponse::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

pub fn serve_media_source_request(
    fs_state: SharedState,
    media_state: MediaServeState,
    request: HttpRequest<Vec<u8>>,
) -> HttpResponse<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return HttpResponse::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "range")
            .body(Vec::new())
            .unwrap();
    }

    if request.method() != Method::GET && request.method() != Method::HEAD {
        return empty_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }

    let token = request.uri().path().trim_start_matches('/').to_string();
    if token.is_empty() {
        return empty_response(StatusCode::BAD_REQUEST, "missing media token");
    }

    let source = {
        let media_sources = match media_state.lock() {
            Ok(media_sources) => media_sources,
            Err(_) => {
                return empty_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "media registry is unavailable",
                );
            }
        };
        match media_sources.get(&token) {
            Some(source) => source.clone(),
            None => return empty_response(StatusCode::NOT_FOUND, "media token not found"),
        }
    };

    let total_len = match media_source_size(&fs_state, &source) {
        Ok(total_len) => total_len,
        Err(error) => return empty_response(StatusCode::NOT_FOUND, &error),
    };
    let mime = clean_mime(source.mime.as_deref());
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    let builder = HttpResponse::builder()
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "accept-ranges, content-length, content-range",
        );

    if request.method() == Method::HEAD {
        return builder
            .header(header::CONTENT_TYPE, &mime)
            .header(header::CONTENT_LENGTH, total_len)
            .body(Vec::new())
            .unwrap();
    }

    if source.preview && range_header.is_none() {
        if let Ok(original) = read_media_source_slice(&fs_state, &source, 0, total_len as usize) {
            if let Ok(body) = build_image_preview(&original) {
                return builder
                    .header(header::CONTENT_TYPE, "image/jpeg")
                    .header(header::CONTENT_LENGTH, body.len())
                    .body(body)
                    .unwrap();
            }
        }
    }

    if let Some(range_header) = range_header {
        let Some((start, requested_end)) = parse_single_range(range_header, total_len) else {
            return HttpResponse::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total_len}"))
                .body(Vec::new())
                .unwrap();
        };

        const MAX_RANGE_BYTES: u64 = 2 * 1024 * 1024;
        let end = requested_end.min(start + MAX_RANGE_BYTES - 1);
        let length = (end - start + 1) as usize;
        let body = match read_media_source_slice(&fs_state, &source, start, length) {
            Ok(body) => body,
            Err(error) => return empty_response(StatusCode::NOT_FOUND, &error),
        };

        return builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, &mime)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total_len}"),
            )
            .header(header::CONTENT_LENGTH, body.len())
            .body(body)
            .unwrap();
    }

    let body = match read_media_source_slice(&fs_state, &source, 0, total_len as usize) {
        Ok(body) => body,
        Err(error) => return empty_response(StatusCode::NOT_FOUND, &error),
    };

    builder
        .header(header::CONTENT_TYPE, &mime)
        .header(header::CONTENT_LENGTH, body.len())
        .body(body)
        .unwrap()
}

fn dump_host_file(path: &Path, destination_path: &str) -> Result<(), String> {
    let mut source = StdFile::open(path).map_err(|e| e.to_string())?;
    let mut destination = StdFile::create(destination_path).map_err(|e| e.to_string())?;
    std::io::copy(&mut source, &mut destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn compute_hash_from_host_file(path: &Path, algorithm: &str) -> Result<String, String> {
    use md5::Md5;
    use sha2::{Digest, Sha256};

    let mut file = StdFile::open(path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1024 * 1024];

    match algorithm {
        "md5" => {
            let mut hasher = Md5::new();
            loop {
                let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            loop {
                let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        _ => Err(format!("Unsupported algorithm: {}", algorithm)),
    }
}

#[tauri::command]
pub fn get_fs_info(
    state: tauri::State<'_, SharedState>,
    path: String,
    offset: u64,
    size: u64,
    fvek: Option<String>,
) -> Result<FsInfo, String> {
    if Path::new(&path).is_dir() {
        let mut fs = FolderFS::new(PathBuf::from(&path));
        let _ = fs.walk_fs(&mut |_| {}); // Populate cache for subsequent reads
        let filesystem_type = fs.filesystem_type();
        let block_size = fs.block_size();
        let metadata = fs.get_metadata().map_err(|e| e.to_string())?;

        let info = FsInfo {
            filesystem_type,
            block_size,
            metadata,
            image_size: 0,
        };

        let mut state_lock = state.lock().unwrap();
        *state_lock = Some(DetectedFs::Folder(fs));
        return Ok(info);
    }

    let mut body: Body = Body::new(path.to_string(), "auto");
    // For a whole-disk logical image (offset == 0), always use the body's declared
    // logical size so compressed formats (AFF4, EWF) report the uncompressed size.
    // For sub-partitions (offset > 0) the caller-supplied sector count is authoritative.
    let bytes_size = if offset == 0 {
        body.get_image_size()
    } else {
        body.get_sector_size() as u64 * size
    };
    let key_material = fvek.and_then(|h| hex::decode(h).ok()).map(|f| {
        exhume_filesystem::detected_fs::KeyMaterial {
            bitlocker_fvek: Some(f),
        }
    });
    let fs = match detect_filesystem(&mut body, offset, bytes_size, key_material) {
        Ok(fs) => fs,
        Err(err) => {
            return Err(format!(
                "Error detecting the filesystem: {}",
                err.to_string()
            ));
        }
    };

    let filesystem_type = fs.filesystem_type();
    let block_size = fs.block_size();
    let metadata = fs.get_metadata().unwrap();
    let info = FsInfo {
        filesystem_type,
        block_size,
        metadata,
        image_size: body.get_image_size(),
    };

    let mut state_lock = state.lock().unwrap();
    *state_lock = Some(fs);
    Ok(info)
}

#[tauri::command]
pub fn register_media_source(
    media_state: State<'_, MediaServeState>,
    file_id: u64,
    path: Option<String>,
    root_path: Option<String>,
    mime: Option<String>,
    preview: Option<bool>,
) -> Result<MediaSourceUrl, String> {
    let preview = preview.unwrap_or(false);
    let token = hash_media_source(
        file_id,
        path.as_deref(),
        root_path.as_deref(),
        mime.as_deref(),
        preview,
    );

    let source = MediaSource {
        file_id,
        path,
        root_path,
        mime,
        preview,
    };

    media_state
        .lock()
        .map_err(|_| "Failed to lock media registry".to_string())?
        .insert(token.clone(), source);

    Ok(MediaSourceUrl {
        url: format!("thanatology-media://localhost/{token}"),
    })
}

#[tauri::command]
pub fn read_file_slice(
    state: tauri::State<'_, SharedState>,
    file_id: u64,
    offset: u64,
    length: usize,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Reading file {:?} slice ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        let content = read_host_slice(&host_path, offset, length)?;
        return Ok(String::from_utf8_lossy(&content).to_string());
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let content = fs
        .read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&content).to_string())
}

#[tauri::command]
pub fn read_file_prefix(
    state: tauri::State<'_, SharedState>,
    file_id: u64,
    length: usize,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Reading file {:?} prefix ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        let content = read_host_prefix(&host_path, length)?;
        return Ok(String::from_utf8_lossy(&content).to_string());
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let content = fs
        .read_file_prefix(&file, length)
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&content).to_string())
}

#[tauri::command]
pub fn read_file_slice_bytes(
    state: State<'_, SharedState>,
    file_id: u64,
    offset: u64,
    length: usize,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<Vec<u8>, String> {
    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return read_host_slice(&host_path, offset, length);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let content = fs
        .read_file_slice(&file, offset, length)
        .map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
pub fn read_file_bytes(
    state: State<'_, SharedState>,
    file_id: u64,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<Vec<u8>, String> {
    info!("Reading file {:?} bytes ", file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return read_host_bytes(&host_path);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let content = fs.read_file_content(&file).map_err(|e| e.to_string())?;

    Ok(content)
}

#[tauri::command]
pub fn parse_plist_file(
    state: State<'_, SharedState>,
    file_id: u64,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<PlistDocument, String> {
    let requested_path = path.clone();

    if let Some(root) = root_path.as_deref() {
        let requested = path
            .as_deref()
            .ok_or_else(|| "Folder evidence requires a selected file path".to_string())?;
        let (canonical_root, host_path) = resolve_scoped_host_file_path(requested, root)?;
        let bytes = read_host_bytes_bounded(&host_path, MAX_PLIST_BYTES)?;
        let source = PlistSource {
            source_kind: "host_file".to_string(),
            file_id,
            requested_path,
            root_path: Some(canonical_root.to_string_lossy().into_owned()),
            resolved_path: Some(host_path.to_string_lossy().into_owned()),
        };
        return parse_plist_document(&bytes, source);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;
    let file = if let Some(path) = path.as_deref() {
        let path_file = fs
            .get_file_by_path(path, file_id)
            .map_err(|error| format!("Failed to resolve selected evidence path {path}: {error}"))?;
        let id_file = fs.get_file(file_id).map_err(|error| {
            format!("Selected path resolved, but file identifier {file_id} did not: {error}")
        })?;
        let path_metadata = path_file.to_json();
        let id_metadata = id_file.to_json();
        let identity_matches = path_file.id() == id_file.id()
            && path_metadata.get("fs_index") == id_metadata.get("fs_index")
            && path_metadata.get("path") == id_metadata.get("path");
        if !identity_matches {
            return Err(format!(
                "Selected evidence path {path} does not match file identifier {file_id}"
            ));
        }
        path_file
    } else {
        fs.get_file(file_id)
            .map_err(|error| format!("File identifier {file_id} could not be resolved: {error}"))?
    };

    if file.size() > MAX_PLIST_BYTES {
        return Err(format!(
            "Selected file is {} bytes; the viewer limit is {MAX_PLIST_BYTES} bytes",
            file.size()
        ));
    }
    let bytes = fs
        .read_file_slice(&file, 0, file.size() as usize)
        .map_err(|error| error.to_string())?;
    drop(lock);
    let source = PlistSource {
        source_kind: "evidence_filesystem".to_string(),
        file_id,
        requested_path: requested_path.clone(),
        root_path,
        resolved_path: requested_path,
    };
    parse_plist_document(&bytes, source)
}

#[tauri::command]
pub fn dump_file_to_disk(
    state: State<'_, SharedState>,
    file_id: u64,
    destination_path: String,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<(), String> {
    info!("Dumping file {:?} to {}", file_id, destination_path);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return dump_host_file(&host_path, &destination_path);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let file_size = file.size();

    let mut dest_file = std::fs::File::create(&destination_path).map_err(|e| e.to_string())?;

    let chunk_size = 1024 * 1024; // 1MB
    let mut offset = 0;

    while offset < file_size {
        let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
        let data = fs
            .read_file_slice(&file, offset, len)
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        dest_file.write_all(&data).map_err(|e| e.to_string())?;
        offset += len as u64;
    }

    Ok(())
}

use md5::Md5;

#[tauri::command]
pub fn compute_hash(
    state: State<'_, SharedState>,
    file_id: u64,
    algorithm: String,
    path: Option<String>,
    root_path: Option<String>,
) -> Result<String, String> {
    info!("Computing {} hash for file {:?}", algorithm, file_id);

    if let Some(host_path) = resolve_host_file_path(path.as_deref(), root_path.as_deref()) {
        return compute_hash_from_host_file(&host_path, &algorithm);
    }

    let mut lock = state
        .lock()
        .map_err(|_| "Failed to lock state".to_string())?;
    let fs = lock.as_mut().ok_or("No filesystem loaded")?;

    let file = match fs.get_file(file_id) {
        Ok(f) => f,
        Err(_) => {
            if let Some(p) = path {
                fs.get_file_by_path(&p, file_id)
                    .map_err(|e| e.to_string())?
            } else {
                return Err(format!(
                    "File ID {} not found and no path provided",
                    file_id
                ));
            }
        }
    };

    let file_size = file.size();

    let chunk_size = 1024 * 1024; // 1MB
    let mut offset = 0;

    match algorithm.as_str() {
        "md5" => {
            let mut hasher = Md5::new();
            while offset < file_size {
                let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
                let data = fs
                    .read_file_slice(&file, offset, len)
                    .map_err(|e| e.to_string())?;
                hasher.update(&data);
                offset += len as u64;
            }
            let result = hasher.finalize();
            Ok(format!("{:x}", result))
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            while offset < file_size {
                let len = std::cmp::min(chunk_size, (file_size - offset) as usize);
                let data = fs
                    .read_file_slice(&file, offset, len)
                    .map_err(|e| e.to_string())?;
                hasher.update(&data);
                offset += len as u64;
            }
            let result = hasher.finalize();
            Ok(format!("{:x}", result))
        }
        _ => Err(format!("Unsupported algorithm: {}", algorithm)),
    }
}

#[cfg(test)]
mod plist_tests {
    use super::*;

    fn test_source() -> PlistSource {
        PlistSource {
            source_kind: "test".to_string(),
            file_id: 42,
            requested_path: Some("/Library/LaunchAgents/test.plist".to_string()),
            root_path: None,
            resolved_path: None,
        }
    }

    #[test]
    fn parses_xml_plist_with_typed_values() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0"><dict>
              <key>Label</key><string>com.example.agent</string>
              <key>Created</key><date>2024-07-21T06:13:20Z</date>
              <key>Payload</key><data>AQID</data>
            </dict></plist>"#;

        let document = parse_plist_document(xml, test_source()).expect("valid XML plist");
        assert_eq!(document.format, "xml");
        assert_eq!(document.root_type, "dictionary");
        assert_eq!(document.value["Label"], "com.example.agent");
        assert_eq!(document.value["Created"]["$plistValue"]["kind"], "date");
        assert_eq!(document.value["Payload"]["$plistValue"]["kind"], "data");
        assert_eq!(document.value["Payload"]["$plistValue"]["byteLength"], 3);
        assert_eq!(document.stats.node_count, 4);
    }

    #[test]
    fn parses_binary_plist() {
        let mut dictionary = plist::Dictionary::new();
        dictionary.insert("Enabled".to_string(), plist::Value::Boolean(true));
        let plist = plist::Value::Dictionary(dictionary);
        let mut bytes = Vec::new();
        plist
            .to_writer_binary(&mut bytes)
            .expect("write binary plist");

        let document = parse_plist_document(&bytes, test_source()).expect("valid binary plist");
        assert_eq!(document.format, "binary");
        assert_eq!(document.value["Enabled"], true);
    }

    #[test]
    fn preserves_extreme_integers_and_uids_as_decimal_strings() {
        let mut dictionary = plist::Dictionary::new();
        dictionary.insert("MinI64".to_string(), plist::Value::Integer(i64::MIN.into()));
        dictionary.insert("MaxI64".to_string(), plist::Value::Integer(i64::MAX.into()));
        dictionary.insert("MaxU64".to_string(), plist::Value::Integer(u64::MAX.into()));
        dictionary.insert(
            "SafeMax".to_string(),
            plist::Value::Integer(MAX_JAVASCRIPT_SAFE_INTEGER.into()),
        );
        dictionary.insert(
            "Uid".to_string(),
            plist::Value::Uid(plist::Uid::new(u64::MAX)),
        );
        let mut bytes = Vec::new();
        plist::Value::Dictionary(dictionary)
            .to_writer_binary(&mut bytes)
            .expect("write integer fixture");

        let document = parse_plist_document(&bytes, test_source()).expect("parse integer fixture");
        assert_eq!(
            document.value["MinI64"]["$plistValue"]["decimal"],
            i64::MIN.to_string()
        );
        assert_eq!(
            document.value["MaxI64"]["$plistValue"]["decimal"],
            i64::MAX.to_string()
        );
        assert_eq!(
            document.value["MaxU64"]["$plistValue"]["decimal"],
            u64::MAX.to_string()
        );
        assert_eq!(document.value["SafeMax"], MAX_JAVASCRIPT_SAFE_INTEGER);
        assert_eq!(
            document.value["Uid"]["$plistValue"]["decimal"],
            u64::MAX.to_string()
        );
        let raw_json = serde_json::to_string(&document.value).expect("serialize typed JSON");
        assert!(raw_json.contains(&u64::MAX.to_string()));
    }

    #[test]
    fn escapes_an_ordinary_dictionary_using_the_reserved_marker_key() {
        let mut dictionary = plist::Dictionary::new();
        dictionary.insert(
            PLIST_VALUE_MARKER.to_string(),
            plist::Value::String("ordinary evidence value".to_string()),
        );
        let mut bytes = Vec::new();
        plist::Value::Dictionary(dictionary)
            .to_writer_binary(&mut bytes)
            .expect("write reserved-key fixture");

        let document = parse_plist_document(&bytes, test_source()).expect("parse reserved key");
        assert_eq!(document.value["$plistValue"]["kind"], "dictionary");
        assert_eq!(
            document.value["$plistValue"]["entries"]["$plistValue"],
            "ordinary evidence value"
        );
    }

    #[test]
    fn bounds_binary_data_previews_in_aggregate() {
        let values = (0..5)
            .map(|_| plist::Value::Data(vec![0x41; 300 * 1024]))
            .collect();
        let mut bytes = Vec::new();
        plist::Value::Array(values)
            .to_writer_binary(&mut bytes)
            .expect("write data fixture");

        let document = parse_plist_document(&bytes, test_source()).expect("parse data fixture");
        assert_eq!(
            document.stats.data_preview_bytes,
            MAX_PLIST_DATA_PREVIEW_TOTAL_BYTES as u64
        );
        assert_eq!(document.stats.truncated_data_values, 5);
    }

    #[test]
    fn confines_host_paths_to_the_explicit_evidence_root() {
        let base = std::env::temp_dir().join(format!(
            "thanatology-plist-scope-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let root = base.join("evidence");
        std::fs::create_dir_all(&root).expect("create test evidence root");
        std::fs::write(root.join("inside.plist"), b"fixture").expect("write inside file");
        std::fs::write(base.join("outside.plist"), b"fixture").expect("write outside file");

        let (_, inside) =
            resolve_scoped_host_file_path("/inside.plist", root.to_str().expect("UTF-8 test root"))
                .expect("inside path should resolve");
        assert!(inside.starts_with(std::fs::canonicalize(&root).expect("canonical root")));

        let absolute_outside = base.join("outside.plist");
        let mirrored_inside = root.join(
            absolute_outside
                .strip_prefix(std::path::Path::new("/"))
                .expect("absolute test path"),
        );
        std::fs::create_dir_all(mirrored_inside.parent().expect("mirrored parent"))
            .expect("create mirrored evidence path");
        std::fs::write(&mirrored_inside, b"evidence copy").expect("write mirrored evidence file");
        let (_, resolved_mirror) = resolve_scoped_host_file_path(
            absolute_outside.to_str().expect("UTF-8 absolute path"),
            root.to_str().expect("UTF-8 test root"),
        )
        .expect("evidence-relative candidate must win over analyst-host absolute path");
        assert_eq!(
            resolved_mirror,
            std::fs::canonicalize(mirrored_inside).expect("canonical mirrored evidence file")
        );

        let outside = resolve_scoped_host_file_path(
            "../outside.plist",
            root.to_str().expect("UTF-8 test root"),
        )
        .expect_err("traversal outside the evidence root must fail");
        assert!(outside.contains("outside the folder evidence root"));

        std::fs::remove_dir_all(&base).expect("clean test fixture");
    }

    #[test]
    fn rejects_non_plist_input() {
        let error = parse_plist_document(b"not a plist", test_source())
            .err()
            .expect("non-plist should fail");
        assert!(error.contains("expected XML or bplist00"));
    }
}
