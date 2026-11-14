// What leaves the app window: web links, new tabs, downloads.
//
// - A web address (http, https, mailto, tel) opens in the student's browser,
//   whether the window navigates to it or opens it in a new tab.
// - An app address in a new tab is mostly the launch relay
//   (/__ent_auth/launch): its redirect, the university service with its CAS
//   ticket, opens in the browser. Any other app page gets its own window.
// - A download (the app's blob links with a file name: certificate, .ics,
//   printed mail…) goes to the Downloads folder.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};

use crate::bridge::{self, Bridge};

pub fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tafac" => true,
        // WebView2 (Windows) serves the tafac scheme as http://tafac.localhost.
        "http" | "https" => url.host_str() == Some("tafac.localhost"),
        _ => false,
    }
}

fn is_outside_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto" | "tel") && !is_app_url(url)
}

fn open_outside(url: &Url) {
    if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
        eprintln!("[tafac] could not open {url}: {error}");
    }
}

// The window's own navigations (and its frames'): app pages, about:blank,
// srcdoc, blob and data stay; a web address goes to the browser instead.
pub fn allow_navigation(url: &Url) -> bool {
    if is_outside_url(url) {
        open_outside(url);
        return false;
    }
    true
}

// window.open and target="_blank".
pub fn new_window(app: &AppHandle, url: Url) -> NewWindowResponse<Wry> {
    if is_outside_url(&url) {
        open_outside(&url);
    } else if is_app_url(&url) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { open_app_link(&app, url).await });
    }
    NewWindowResponse::Deny
}

async fn open_app_link(app: &AppHandle, url: Url) {
    let bridge = app.state::<Arc<Bridge>>().inner().clone();
    let path = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let request = http::Request::get(path)
        .header(http::header::ACCEPT, "text/html,*/*")
        .body(Vec::new())
        .unwrap();
    let response = bridge::forward(&bridge, request).await;

    let target = if response.status().is_redirection() {
        response
            .headers()
            .get(http::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|location| url.join(location).ok())
            .unwrap_or(url)
    } else {
        url
    };

    if is_outside_url(&target) {
        open_outside(&target);
    } else if let Err(error) = open_app_window(app, target) {
        eprintln!("[tafac] could not open a window: {error}");
    }
}

static WINDOW_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn open_app_window(app: &AppHandle, url: Url) -> tauri::Result<()> {
    let label = format!("page-{}", WINDOW_COUNT.fetch_add(1, Ordering::Relaxed));
    let handle = app.clone();
    let window = crate::window::style(WebviewWindowBuilder::new(app, label, WebviewUrl::CustomProtocol(url)))
        .title("Tafac")
        .inner_size(1100.0, 780.0)
        .on_navigation(allow_navigation)
        .on_new_window(move |url, _features| new_window(&handle, url))
        .on_download(download)
        .build()?;
    crate::window::show(&window)
}

pub fn download(_webview: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Some(folder) = downloads_folder() else { return false };
            let name = destination
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .or_else(|| url.path_segments().and_then(|mut segments| segments.next_back().map(str::to_string)))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "Tafac".to_string());
            *destination = free_path(&folder, &name);
            true
        }
        DownloadEvent::Finished { success, .. } => {
            if !success {
                eprintln!("[tafac] a download failed");
            }
            true
        }
        _ => true,
    }
}

fn downloads_folder() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join("Downloads"))
}

// "name.pdf", else "name (2).pdf", "name (3).pdf"…
fn free_path(folder: &Path, name: &str) -> PathBuf {
    let candidate = folder.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|index| folder.join(format!("{stem} ({index}){extension}")))
        .find(|path| !path.exists())
        .unwrap()
}
