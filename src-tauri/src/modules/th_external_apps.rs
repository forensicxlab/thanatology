use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const MAX_NAME_LENGTH: usize = 64;
const MAX_URL_LENGTH: usize = 2_048;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApplicationLaunch {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub open_mode: String,
    #[serde(default)]
    pub allow_insecure_http: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApplicationProbe {
    pub url: String,
    #[serde(default)]
    pub allow_insecure_http: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApplicationProbeResult {
    pub reachable: bool,
    pub status: u16,
    pub status_text: String,
    pub final_url: String,
}

fn is_local_or_private_host(host: &str) -> bool {
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return true;
    }

    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
        }
        Err(_) => false,
    }
}

fn validate_external_url(raw: &str, allow_insecure_http: bool) -> Result<tauri::Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("The external application URL is required.".to_string());
    }
    if raw.len() > MAX_URL_LENGTH {
        return Err(format!(
            "The external application URL cannot exceed {MAX_URL_LENGTH} characters."
        ));
    }

    let url = tauri::Url::parse(raw).map_err(|_| "Enter a valid absolute URL.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials must not be embedded in an external application URL.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "The external application URL must include a hostname.".to_string())?;

    match url.scheme() {
        "https" => Ok(url),
        "http" if is_local_or_private_host(host) || allow_insecure_http => Ok(url),
        "http" => Err(
            "Public HTTP endpoints require explicit acknowledgement because traffic is unencrypted."
                .to_string(),
        ),
        _ => Err("Only HTTP and HTTPS external applications are supported.".to_string()),
    }
}

#[tauri::command]
pub async fn open_external_application(
    app: AppHandle,
    request: ExternalApplicationLaunch,
) -> Result<(), String> {
    if request.id <= 0 {
        return Err("The external application identifier is invalid.".to_string());
    }

    let name = request.name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LENGTH {
        return Err(format!(
            "The external application name must contain 1 to {MAX_NAME_LENGTH} characters."
        ));
    }

    let url = validate_external_url(&request.url, request.allow_insecure_http)?;
    match request.open_mode.as_str() {
        "browser" => app
            .opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|error| format!("Failed to open the system browser: {error}")),
        "managed" => {
            let label = format!("external-tool-{}", request.id);
            if let Some(window) = app.get_webview_window(&label) {
                window
                    .navigate(url)
                    .map_err(|error| format!("Failed to navigate the external tool: {error}"))?;
                let _ = window.show();
                let _ = window.unminimize();
                window
                    .set_focus()
                    .map_err(|error| format!("Failed to focus the external tool: {error}"))?;
                return Ok(());
            }

            let allow_insecure_http = request.allow_insecure_http;
            WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
                .title(name)
                .maximized(true)
                .on_navigation(move |navigation_url| {
                    validate_external_url(navigation_url.as_str(), allow_insecure_http).is_ok()
                })
                .build()
                .map(|_| ())
                .map_err(|error| format!("Failed to open the external tool: {error}"))
        }
        _ => Err("The external application launch mode is invalid.".to_string()),
    }
}

#[tauri::command]
pub async fn test_external_application(
    request: ExternalApplicationProbe,
) -> Result<ExternalApplicationProbeResult, String> {
    let url = validate_external_url(&request.url, request.allow_insecure_http)?;
    let allow_insecure_http = request.allow_insecure_http;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5
                || validate_external_url(attempt.url().as_str(), allow_insecure_http).is_err()
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| format!("Failed to prepare the connection test: {error}"))?;

    let mut response = client.head(url.clone()).send().await;
    if matches!(
        response.as_ref().map(|value| value.status()),
        Ok(reqwest::StatusCode::METHOD_NOT_ALLOWED | reqwest::StatusCode::NOT_IMPLEMENTED)
    ) {
        response = client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .await;
    }

    let response = response.map_err(|error| {
        if error.is_timeout() {
            "The connection test timed out after 10 seconds.".to_string()
        } else if error.is_connect() {
            format!("Could not connect to the external application: {error}")
        } else {
            format!("The external application could not be reached: {error}")
        }
    })?;

    let status = response.status();
    Ok(ExternalApplicationProbeResult {
        reachable: true,
        status: status.as_u16(),
        status_text: status
            .canonical_reason()
            .unwrap_or("HTTP response received")
            .to_string(),
        final_url: response.url().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_local_http_and_public_https() {
        assert!(validate_external_url("http://127.0.0.1:8080", false).is_ok());
        assert!(validate_external_url("http://localhost:8080", false).is_ok());
        assert!(validate_external_url("https://example.com", false).is_ok());
    }

    #[test]
    fn requires_acknowledgement_for_public_http() {
        assert!(validate_external_url("http://example.com", false).is_err());
        assert!(validate_external_url("http://example.com", true).is_ok());
    }

    #[test]
    fn rejects_credentials_and_non_web_schemes() {
        assert!(validate_external_url("https://user:pass@example.com", false).is_err());
        assert!(validate_external_url("file:///tmp/tool.html", false).is_err());
        assert!(validate_external_url("javascript:alert(1)", false).is_err());
    }
}
