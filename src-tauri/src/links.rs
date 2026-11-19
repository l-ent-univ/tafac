// What leaves the app window: web links, new tabs, downloads.
//
// - A web address (http, https, mailto, tel) opens in the student's browser,
//   whether the window navigates to it or opens it in a new tab.
// - An app address in a new tab is mostly the launch relay
//   (/__ent_auth/launch): its redirect, the university service with its CAS
//   ticket, opens in the browser. Any other app page gets its own window.
// - A new tab on Moodle (a deadline, Moodle's tile, a link in a mail),
//   straight or through the relay, opens in the app's « Moodle » where the
//   university has it (moodle.rs), signed in.
// - A download (the app's blob links with a file name: certificate, .ics,
//   printed mail, attachments…) goes where the student picks in the Save
//   panel (macOS), else to the Downloads folder.
//
// iOS (ios.rs) has one window and no browser beside it: the rules are the
// same ones, and what the desktop sends to the browser opens over the app.
// A download goes to the share sheet there (ios_downloads.rs).

#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[cfg(desktop)]
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder, Wry};

use crate::bridge::{self, Bridge};

pub fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tafac" => true,
        // WebView2 (Windows) serves the tafac scheme as http://tafac.localhost.
        "http" | "https" => url.host_str() == Some("tafac.localhost"),
        _ => false,
    }
}

pub fn is_outside_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto" | "tel") && !is_app_url(url)
}

#[cfg(desktop)]
pub fn open_outside(url: &Url) {
    if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
        eprintln!("[tafac] could not open {url}: {error}");
    }
}

#[cfg(mobile)]
pub fn open_outside(url: &Url) {
    crate::ios::open_outside(url);
}

#[derive(Debug, PartialEq)]
pub enum Navigation {
    // Loads in the window.
    Stay,
    // Opens in the student's browser.
    Browser,
    Refuse,
}

// Where a navigation of the window (or of one of its frames) goes. Only what
// the app is made of loads in the window: its own pages, about:blank and
// srcdoc (the mail reader's frame, the print view), its blob and data links.
// A web address goes to the browser. Anything else is refused: a file:// or
// javascript: address, another program's scheme, none of which a page of the
// app has a reason to open, and which a mail's link could otherwise reach.
pub fn classify_navigation(url: &Url) -> Navigation {
    if is_app_url(url) {
        return Navigation::Stay;
    }
    match url.scheme() {
        "about" | "blob" | "data" => Navigation::Stay,
        "http" | "https" | "mailto" | "tel" => Navigation::Browser,
        _ => Navigation::Refuse,
    }
}

pub fn allow_navigation(url: &Url) -> bool {
    match classify_navigation(url) {
        Navigation::Stay => true,
        Navigation::Browser => {
            open_outside(url);
            false
        }
        Navigation::Refuse => {
            // The scheme only: the rest may hold what a page was fed.
            eprintln!("[tafac] navigation refused: {}:", url.scheme());
            false
        }
    }
}

// window.open and target="_blank", from the page of the window `label`.
#[cfg(desktop)]
pub fn new_window(app: &AppHandle, label: &str, url: Url) -> NewWindowResponse<Wry> {
    if is_outside_url(&url) || is_app_url(&url) {
        let app = app.clone();
        let label = label.to_string();
        tauri::async_runtime::spawn(async move {
            // Moodle's: in « Moodle », which that page then shows.
            let in_moodle = match crate::moodle::link_target(&app, &url).await {
                Some(target) => crate::moodle::open_in_page(&app, &label, &target),
                None => false,
            };
            if in_moodle {
                return;
            }
            if is_outside_url(&url) {
                open_outside(&url);
            } else {
                open_app_link(&app, url).await;
            }
        });
    }
    NewWindowResponse::Deny
}

// Where an app address opened in a new tab leads: for the launch relay, the
// address its redirect points to (asked with the student's session); any
// other app page, itself.
pub async fn app_link_target(app: &AppHandle, url: Url) -> Url {
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

    if response.status().is_redirection() {
        response
            .headers()
            .get(http::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|location| url.join(location).ok())
            .unwrap_or(url)
    } else {
        url
    }
}

#[cfg(desktop)]
async fn open_app_link(app: &AppHandle, url: Url) {
    let target = app_link_target(app, url).await;
    if is_outside_url(&target) {
        open_outside(&target);
    } else if let Err(error) = open_app_window(app, target) {
        eprintln!("[tafac] could not open a window: {error}");
    }
}

// A window's page starts loading (again): Moodle's view, if that page had
// it on screen, leaves it (moodle.rs).
#[cfg(desktop)]
pub fn page_load(window: tauri::WebviewWindow, payload: tauri::webview::PageLoadPayload<'_>) {
    if payload.event() == tauri::webview::PageLoadEvent::Started {
        crate::moodle::page_reloaded(window.app_handle(), window.label());
    }
}

#[cfg(desktop)]
static WINDOW_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(desktop)]
pub fn open_app_window(app: &AppHandle, url: Url) -> tauri::Result<()> {
    let label = format!("page-{}", WINDOW_COUNT.fetch_add(1, Ordering::Relaxed));
    let handle = app.clone();
    let opener = label.clone();
    let window = crate::window::style(WebviewWindowBuilder::new(app, label, WebviewUrl::CustomProtocol(url)))
        .title("Tafac")
        .inner_size(1100.0, 780.0)
        .on_navigation(allow_navigation)
        .on_new_window(move |url, _features| new_window(&handle, &opener, url))
        .on_download(download)
        .on_page_load(page_load)
        .build()?;
    crate::window::show(&window)
}

#[cfg(desktop)]
pub fn download(_webview: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    if let DownloadEvent::Requested { url, .. } = &event {
        // A download link skips allow_navigation: the same rules here.
        // A web file goes to the browser, which downloads it itself.
        match classify_navigation(url) {
            Navigation::Stay => {}
            Navigation::Browser => {
                open_outside(url);
                return false;
            }
            Navigation::Refuse => {
                eprintln!("[tafac] download refused: {}:", url.scheme());
                return false;
            }
        }
    }
    save_download(event)
}

// A download whose address is accepted: where it goes (the Save panel), and
// whether it failed. Moodle's view (moodle.rs) accepts its own site's files.
#[cfg(desktop)]
pub fn save_download(event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Some(folder) = downloads_folder() else { return false };
            let name = destination
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .or_else(|| url.path_segments().and_then(|mut segments| segments.next_back().map(str::to_string)))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "Tafac".to_string());
            match choose_destination(&free_path(&folder, &name)) {
                Some(path) => {
                    *destination = path;
                    true
                }
                // « Annuler »
                None => false,
            }
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

// macOS: the system's Save panel, on the Downloads folder with the file's
// name, so the student picks where it goes; None when they cancel. The
// download waits for the answer (the panel is modal, on the main thread,
// where WebKit asks).
#[cfg(target_os = "macos")]
fn choose_destination(proposed: &Path) -> Option<PathBuf> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::{NSString, NSURL};

    // Off the main thread no panel can open: the proposed path, as before.
    let Some(mtm) = MainThreadMarker::new() else { return Some(proposed.to_path_buf()) };
    let panel = NSSavePanel::savePanel(mtm);
    panel.setCanCreateDirectories(true);
    if let Some(name) = proposed.file_name() {
        panel.setNameFieldStringValue(&NSString::from_str(&name.to_string_lossy()));
    }
    if let Some(folder) = proposed.parent() {
        let folder = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&folder.to_string_lossy()), true);
        panel.setDirectoryURL(Some(&folder));
    }
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    // The panel already asked before replacing a file of that name: an old
    // one there is replaced, as the student agreed.
    let path = PathBuf::from(panel.URL()?.path()?.to_string());
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Some(path)
}

// Elsewhere: straight to the Downloads folder.
#[cfg(all(desktop, not(target_os = "macos")))]
fn choose_destination(proposed: &Path) -> Option<PathBuf> {
    Some(proposed.to_path_buf())
}

#[cfg(desktop)]
fn downloads_folder() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join("Downloads"))
}

// "name.pdf", else "name (2).pdf", "name (3).pdf"…
#[cfg(desktop)]
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

#[cfg(test)]
mod tests {
    use super::*;

    fn navigation(url: &str) -> Navigation {
        classify_navigation(&Url::parse(url).unwrap())
    }

    #[test]
    fn the_app_and_what_it_is_made_of_stay_in_the_window() {
        // The app's address, as macOS and Linux spell it, then Windows.
        assert_eq!(navigation("tafac://localhost/login"), Navigation::Stay);
        assert_eq!(navigation("tafac://localhost/__ent_auth/launch?url=https%3A%2F%2Fmoodle.example.fr%2F"), Navigation::Stay);
        assert_eq!(navigation("http://tafac.localhost/login"), Navigation::Stay);
        assert_eq!(navigation("https://tafac.localhost/"), Navigation::Stay);

        assert_eq!(navigation("about:blank"), Navigation::Stay);
        assert_eq!(navigation("about:srcdoc"), Navigation::Stay);
        assert_eq!(navigation("blob:tafac://localhost/0b1c8a52-6c0f-4e0a-9c53-1d1f0a6f8e11"), Navigation::Stay);
        assert_eq!(navigation("data:application/pdf;base64,JVBERi0="), Navigation::Stay);
    }

    #[test]
    fn a_web_address_goes_to_the_browser() {
        assert_eq!(navigation("https://moodle.example.fr/my/"), Navigation::Browser);
        assert_eq!(navigation("http://example.fr/"), Navigation::Browser);
        assert_eq!(navigation("mailto:scolarite@example.fr"), Navigation::Browser);
        assert_eq!(navigation("tel:+33299000000"), Navigation::Browser);
        // A look-alike of the app's Windows address is the web too.
        assert_eq!(navigation("http://tafac.localhost.evil.example/"), Navigation::Browser);
        assert_eq!(navigation("https://evil.example/tafac.localhost"), Navigation::Browser);
    }

    #[test]
    fn anything_else_is_refused() {
        assert_eq!(navigation("file:///etc/passwd"), Navigation::Refuse);
        assert_eq!(navigation("file:///Users/camille/Library/Application%20Support/fr.tafac.desktop/cookies.json"), Navigation::Refuse);
        assert_eq!(navigation("javascript:alert(1)"), Navigation::Refuse);
        assert_eq!(navigation("zoommtg://zoom.us/join?confno=1"), Navigation::Refuse);
        assert_eq!(navigation("ms-msdt:/id%20PCWDiagnostic"), Navigation::Refuse);
        assert_eq!(navigation("smb://server/share"), Navigation::Refuse);
        assert_eq!(navigation("ftp://example.fr/file"), Navigation::Refuse);
        assert_eq!(navigation("tauri://localhost/"), Navigation::Refuse);
    }
}
