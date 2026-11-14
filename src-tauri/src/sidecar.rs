// The local server: Node running desktop/sidecar.mjs (server.js, as on
// tafac.fr), started with the app and stopped with it.
//
// Development (debug build): the Node on the PATH and the repository's own
// files (`npm run desktop:dev` builds dist/ first).
// Packaged app: the Node binary shipped next to the app's executable
// (externalBin) and the server copy in its resources
// (scripts/desktop-prepare.mjs).

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;

pub struct Sidecar {
    child: Mutex<Option<Child>>,
}

impl Sidecar {
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// Where the server listens: a socket in the student's own temporary folder
// (private to their account on macOS), or a named pipe on Windows. Named
// after this process, so two copies of the app don't collide.
pub fn endpoint() -> String {
    #[cfg(unix)]
    {
        std::env::temp_dir()
            .join(format!("tafac-{}.sock", std::process::id()))
            .to_string_lossy()
            .into_owned()
    }
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\tafac-{}-{}", std::process::id(), random_hex(8))
    }
}

// The address the window opens: Tauri serves custom schemes as
// <scheme>://localhost, except on Windows (WebView2) where it is
// http://<scheme>.localhost. On /login, not /: the server sends / with the
// landing page in it while signed out (for search engines); the app goes
// on to / by itself once signed in (src/desktopApp.js, App.jsx).
pub fn app_url() -> &'static str {
    if cfg!(windows) {
        "http://tafac.localhost/login"
    } else {
        "tafac://localhost/login"
    }
}

fn random_hex(bytes: usize) -> String {
    (0..bytes).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

// SESSION_SECRET: made once per install, kept in the app's data folder.
// It encrypts the session cookie, which jar.rs saves next to it.
pub fn session_secret(data_dir: &Path) -> std::io::Result<String> {
    let path = data_dir.join("session-secret");
    if let Ok(secret) = std::fs::read_to_string(&path) {
        let secret = secret.trim().to_string();
        if secret.len() >= 64 {
            return Ok(secret);
        }
    }
    let secret = random_hex(32);
    crate::jar::write_private(&path, secret.as_bytes())?;
    Ok(secret)
}

pub fn spawn(app: &AppHandle, endpoint: &str, secret: &str, data_dir: &Path) -> Result<Sidecar, Box<dyn std::error::Error>> {
    #[cfg(unix)]
    let _ = std::fs::remove_file(endpoint);

    let (node, script) = locate(app)?;
    let child = Command::new(node)
        .arg(script)
        .env("PORT", endpoint)
        .env("SESSION_SECRET", secret)
        .env("DATA_DIR", data_dir.join("server"))
        .env("NODE_ENV", "production")
        .env("MULTI_UNIVERSITY", "1")
        // Anonymous statistics, as tafac.fr's (server/analytics.js): only in
        // the builds CI makes (TAFAC_POSTHOG_PROJECT_KEY at build time, the
        // project's public key); a local build sends nothing. Sent from this
        // computer to PostHog, not through tafac.fr, and only while the
        // student leaves « Statistiques anonymes » on.
        .envs(option_env!("TAFAC_POSTHOG_PROJECT_KEY").filter(|key| !key.is_empty()).map(|key| ("POSTHOG_PROJECT_KEY", key)))
        // Kept open: closing it (the app quits or crashes) stops the server.
        .stdin(Stdio::piped())
        .spawn()?;

    Ok(Sidecar { child: Mutex::new(Some(child)) })
}

#[cfg(debug_assertions)]
fn locate(_app: &AppHandle) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    Ok((PathBuf::from("node"), repository.join("desktop").join("sidecar.mjs")))
}

#[cfg(not(debug_assertions))]
fn locate(app: &AppHandle) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let executable_dir = std::env::current_exe()?
        .parent()
        .ok_or("no executable folder")?
        .to_path_buf();
    let node = executable_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let script = app.path().resource_dir()?.join("server").join("desktop").join("sidecar.mjs");
    Ok((node, script))
}
