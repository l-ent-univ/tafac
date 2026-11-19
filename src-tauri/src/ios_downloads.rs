// Downloads in the iOS app: a mail's attachment, the certificate, the
// grades PDF, the planning's .ics, any file the page makes.
//
// WebKit downloads the file itself (wry's download delegate) into a folder
// of its own in the app's temporary folder; once it is there, the system's
// share sheet takes it (plugins/share): saved to Files, opened in another
// app, sent by AirDrop. The folder goes once the sheet is closed, and what
// is left of an earlier run as the app starts.
//
// Only what the page made (a blob, a data link) or the app's own address,
// which only the bridge serves: a file of the app's is fetched by the page
// first, with its session, and saved from a blob (src/desktopDownloads.js,
// as on the desktop). A web file opens over the app, as a link; anything
// else is refused, by the rule for the window's navigations
// (links::classify_navigation). Nothing is sent anywhere else.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::webview::DownloadEvent;
use tauri::{Manager, Url};

use crate::links;

// Each download under way: its address, and where it goes.
static UNDER_WAY: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());
static COUNT: AtomicUsize = AtomicUsize::new(0);

// Under the app's temporary folder (TMPDIR, which iOS gives every app),
// never anywhere else.
fn folder() -> Option<PathBuf> {
    std::env::var_os("TMPDIR")?;
    Some(std::env::temp_dir().join("tafac-downloads"))
}

// As the app starts: the files an earlier run left (closed while a sheet
// was open).
pub fn clear() {
    if let Some(folder) = folder() {
        let _ = std::fs::remove_dir_all(folder);
    }
}

pub fn handle(webview: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => requested(&url, destination),
        DownloadEvent::Finished { url, success, .. } => {
            finished(webview.app_handle(), &url, success);
            true
        }
        _ => true,
    }
}

fn requested(url: &Url, destination: &mut PathBuf) -> bool {
    // A download link skips the window's navigation rule: the same rule here.
    match links::classify_navigation(url) {
        links::Navigation::Stay => {}
        links::Navigation::Browser => {
            links::open_outside(url);
            return false;
        }
        links::Navigation::Refuse => {
            eprintln!("[tafac] download refused: {}:", url.scheme());
            return false;
        }
    }
    let Some(root) = folder() else {
        eprintln!("[tafac] download refused: no temporary folder");
        return false;
    };
    // WebKit's name for it: the page's (`download`), else the server's.
    let name = safe_name(&destination.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default());
    // A folder of its own, so the file keeps its name.
    let own = root.join(COUNT.fetch_add(1, Ordering::Relaxed).to_string());
    let _ = std::fs::remove_dir_all(&own);
    if let Err(error) = std::fs::create_dir_all(&own) {
        eprintln!("[tafac] download refused: {error}");
        return false;
    }
    let file = own.join(name);
    if let Ok(mut under_way) = UNDER_WAY.lock() {
        under_way.push((url.as_str().to_string(), file.clone()));
    }
    *destination = file;
    true
}

fn finished(app: &tauri::AppHandle, url: &Url, success: bool) {
    let file = UNDER_WAY.lock().ok().and_then(|mut under_way| {
        let index = under_way.iter().position(|(address, _)| address == url.as_str())?;
        Some(under_way.remove(index).1)
    });
    let Some(file) = file else { return };
    if !success {
        eprintln!("[tafac] a download failed ({}:)", url.scheme());
        remove_folder(&file);
        return;
    }
    // Off the main thread, where this is called: the plugin's answer is
    // awaited, and the sheet goes up there.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = app.state::<tauri_plugin_share::Share<tauri::Wry>>().file(&file) {
            eprintln!("[tafac] share sheet: {error}");
            remove_folder(&file);
        }
    });
}

fn remove_folder(file: &Path) {
    if let Some(own) = file.parent() {
        let _ = std::fs::remove_dir_all(own);
    }
}

// A name for the file in its folder: no folder in it, not hidden, not too
// long (its extension kept), never empty.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') || c.is_control() { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim_start();
    let (stem, extension) = match cleaned.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && extension.chars().count() <= 10 => (stem, format!(".{extension}")),
        _ => (cleaned, String::new()),
    };
    let stem: String = stem.chars().take(100).collect();
    if stem.trim().is_empty() {
        format!("Tafac{extension}")
    } else {
        format!("{}{extension}", stem.trim_end())
    }
}
