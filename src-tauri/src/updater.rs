// Updates: Tauri's updater plugin (the whole app each time), driven from
// here. The page has no updater command to call: it reads the state and asks
// for the install through the app's own routes (desktop.rs,
// src/desktopUpdate.js).
//
// - Checked at launch, every hour while the app runs, after the computer
//   wakes, and from the menu (« Rechercher les mises à jour… »). The answer
//   is https://tafac.fr/desktop/latest.json: Tauri's static format, plus one
//   field of ours, `minimum`.
// - A newer version is downloaded in the background, checked against its
//   signature (the public key in tauri.conf.json) and kept in the app's
//   cache folder. It replaces the app when the app quits, or right away on
//   « Redémarrer ». Found there at the next launch (the app was killed, the
//   computer shut down), it isn't downloaded again.
// - A version below `minimum` can't sign in any more: the page shows « Mise
//   à jour nécessaire » instead of the app. Only an answer that says so
//   blocks.
// - No answer (offline, tafac.fr down), a bad signature, an install that
//   fails: nothing shows, the app goes on as it is and a later check tries
//   again.
//
// A build without a release version (0.0.0, tauri.conf.json: any build but
// CI's) never checks. Development: a debug build checks only when
// TAFAC_UPDATE_URL names a latest.json (http allowed), whatever its version.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use semver::Version;
use serde::Serialize;
use tauri::async_runtime::{spawn, spawn_blocking};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::watch;

const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
// After a check that got no answer.
const RETRY_AFTER: Duration = Duration::from_secs(15 * 60);
// The clock is read this often. A timer doesn't run while the computer
// sleeps, so the time of day decides when the next check is due, and a jump
// between two readings is a wake.
const TICK: Duration = Duration::from_secs(60);
const WAKE_JUMP: Duration = Duration::from_secs(3 * 60);
// The network comes back a little after the computer does.
const AFTER_WAKE: Duration = Duration::from_secs(20);
// No more than one check per wake in this long (a napping app's timers
// jump too).
const WAKE_CHECK_SPACING: Duration = Duration::from_secs(30 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
// A download that stops moving for this long has failed.
const STALLED_AFTER: Duration = Duration::from_secs(60);
// How long the page waits, from launch, for the launch check's answer before
// it starts without one (`page_state`).
const LAUNCH_WAIT: Duration = Duration::from_secs(3);
const PROGRESS_EVERY: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    // Nothing to install (up to date, not checked, or the download failed).
    Idle,
    Downloading,
    // Downloaded and checked: installed on quit or on « Redémarrer ».
    Ready,
    Installing,
}

// What the page gets (src/desktopUpdate.js).
#[derive(Clone, Serialize)]
pub struct PageState {
    current: String,
    phase: Phase,
    // The newer version announced.
    version: Option<String>,
    // The running version is below latest.json's `minimum`.
    required: bool,
    // Bytes.
    downloaded: u64,
    total: Option<u64>,
    // The install the student asked for didn't happen.
    failed: bool,
    // Where to get the new version by hand, if latest.json says.
    download: Option<String>,
    // This build looks for updates (not a local 0.0.0 build).
    enabled: bool,
    // A check is under way.
    checking: bool,
    // When the last check got an answer, in milliseconds since 1970.
    checked: Option<u64>,
}

// The answer to « Rechercher les mises à jour… », shown by the page.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Note {
    Current { version: String },
    Downloading { version: String },
    Ready { version: String },
    Unreachable,
}

struct Inner {
    page: PageState,
    // The release announced: being downloaded, or the one the package in the
    // cache folder is.
    update: Option<Update>,
    // The student asked for the install: it follows the download.
    install_asked: bool,
    // The signature of a release whose package was refused (bad signature):
    // not downloaded again while latest.json announces the same one.
    refused: Option<String>,
    told: Instant,
}

pub struct Updates {
    inner: Mutex<Inner>,
    // True once the launch check has its answer, or none.
    launch_checked: watch::Sender<bool>,
    started: Instant,
    // The downloaded packages' folder.
    packages: PathBuf,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().build()
}

// Development: the latest.json a debug build reads.
fn endpoint_override() -> Option<tauri::Url> {
    #[cfg(debug_assertions)]
    {
        std::env::var("TAFAC_UPDATE_URL").ok().and_then(|url| url.parse().ok())
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

// Whether this build looks for updates at all.
pub fn enabled(version: &Version) -> bool {
    if cfg!(debug_assertions) {
        return endpoint_override().is_some();
    }
    *version != Version::new(0, 0, 0)
}

// Errors, and in development what the updater does.
macro_rules! trace {
    ($($argument:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[tafac] update: {}", format!($($argument)*));
        }
    };
}

pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let version = app.package_info().version.clone();
    let (launch_checked, _) = watch::channel(false);
    app.manage(Updates {
        inner: Mutex::new(Inner {
            page: PageState {
                current: version.to_string(),
                phase: Phase::Idle,
                version: None,
                required: false,
                downloaded: 0,
                total: None,
                failed: false,
                download: None,
                enabled: enabled(&version),
                checking: false,
                checked: None,
            },
            update: None,
            install_asked: false,
            refused: None,
            told: Instant::now(),
        }),
        launch_checked,
        started: Instant::now(),
        packages: app.path().app_cache_dir()?.join("updates"),
    });

    if !enabled(&version) {
        trace!("off for this build ({version})");
        app.state::<Updates>().launch_checked.send_replace(true);
        return Ok(());
    }
    let app = app.clone();
    spawn(async move { keep_checking(app).await });
    Ok(())
}

async fn keep_checking(app: AppHandle) {
    let (mut answered, _) = check(&app, None).await;
    let mut checked_at = SystemTime::now();
    let mut read_at = checked_at;
    loop {
        tokio::time::sleep(TICK).await;
        let now = SystemTime::now();
        let woke = now.duration_since(read_at).is_ok_and(|gap| gap >= WAKE_JUMP);
        read_at = now;
        // A clock set back reads as nothing elapsed: the check waits.
        let since_check = now.duration_since(checked_at).unwrap_or_default();
        let due = since_check >= if answered { CHECK_EVERY } else { RETRY_AFTER };
        if !due && !(woke && since_check >= WAKE_CHECK_SPACING) {
            continue;
        }
        if woke {
            tokio::time::sleep(AFTER_WAKE).await;
        }
        (answered, _) = check(&app, None).await;
        checked_at = SystemTime::now();
        read_at = checked_at;
    }
}

// « Rechercher les mises à jour… » (menu.rs): checks now and answers with a
// note in `window`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn check_from_menu(app: &AppHandle, window: Option<WebviewWindow>) {
    let app = app.clone();
    spawn(async move {
        check(&app, window.as_ref()).await;
    });
}

// Réglages › Mises à jour, « Rechercher » (POST /__desktop/update/check):
// checks now, the answer as the menu's note.
pub async fn check_from_page(app: &AppHandle) -> Note {
    check(app, None).await.1
}

// One check, and the note that says how it went. False: no answer (offline,
// tafac.fr down, a latest.json that doesn't read).
async fn check(app: &AppHandle, asked_from: Option<&WebviewWindow>) -> (bool, Note) {
    let state = app.state::<Updates>();
    let current = app.package_info().version.clone();
    if !enabled(&current) {
        return (true, Note::Current { version: current.to_string() });
    }
    state.inner.lock().unwrap().page.checking = true;
    tell_state(app);
    let (answered, note) = match find_update(app).await {
        Err(error) => {
            trace!("no answer ({error})");
            state.install_failed();
            (false, Note::Unreachable)
        }
        Ok(None) => {
            trace!("{current} is the latest");
            state.forget();
            (true, Note::Current { version: current.to_string() })
        }
        Ok(Some(update)) => {
            let required = minimum(&update).is_some_and(|minimum| current < minimum);
            trace!("{} announced{}", update.version, if required { ", required" } else { "" });
            (true, state.found(app, update, required))
        }
    };
    {
        let mut inner = state.inner.lock().unwrap();
        inner.page.checking = false;
        if answered {
            inner.page.checked = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .ok()
                .map(|since| since.as_millis() as u64);
        }
    }
    state.launch_checked.send_replace(true);
    tell_state(app);
    if let Some(window) = asked_from {
        tell(window, "tafac:update-note", &note);
    }
    (answered, note)
}

async fn find_update(app: &AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    let mut builder = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .configure_client(|client| client.connect_timeout(CONNECT_TIMEOUT).read_timeout(STALLED_AFTER));
    if let Some(url) = endpoint_override() {
        builder = builder.endpoints(vec![url])?;
    }
    builder.build()?.check().await
}

// latest.json's own field: the oldest version that can still sign in.
fn minimum(update: &Update) -> Option<Version> {
    let minimum = update.raw_json.get("minimum")?.as_str()?;
    Version::parse(minimum.trim().trim_start_matches('v')).ok()
}

// latest.json's own field, next to this computer's package: its installer
// (the DMG), for the student to get by hand if the install fails.
fn installer(update: &Update) -> Option<String> {
    let platform = format!("{}-{}", update.target, std::env::consts::ARCH);
    let url = update.raw_json.get("platforms")?.get(platform)?.get("installer")?.as_str()?;
    url.starts_with("https://").then(|| url.to_string())
}

impl Updates {
    fn package(&self, version: &str) -> PathBuf {
        self.packages.join(format!("Tafac-{version}.update"))
    }

    // Nothing newer is announced (any more): what was downloaded goes.
    fn forget(&self) {
        let mut inner = self.inner.lock().unwrap();
        if inner.page.phase == Phase::Installing {
            return;
        }
        inner.update = None;
        inner.install_asked = false;
        inner.refused = None;
        inner.page.phase = Phase::Idle;
        inner.page.version = None;
        inner.page.required = false;
        inner.page.failed = false;
        inner.page.download = None;
        let _ = std::fs::remove_dir_all(&self.packages);
    }

    // A newer version is announced: downloaded, unless it already is.
    fn found(&self, app: &AppHandle, update: Update, required: bool) -> Note {
        let version = update.version.clone();
        let mut inner = self.inner.lock().unwrap();
        inner.page.required = required;
        inner.page.download = installer(&update);
        let known = inner.update.as_ref().is_some_and(|known| known.signature == update.signature);
        match inner.page.phase {
            Phase::Downloading if known => return Note::Downloading { version },
            Phase::Ready | Phase::Installing if known => return Note::Ready { version },
            Phase::Installing => return Note::Ready { version },
            _ => {}
        }
        inner.page.version = Some(version.clone());
        if inner.refused.as_deref() == Some(update.signature.as_str()) && !inner.install_asked {
            // Its package was refused: no use downloading it again.
            inner.page.phase = Phase::Idle;
            return Note::Unreachable;
        }
        inner.update = Some(update.clone());
        inner.refused = None;
        inner.page.phase = Phase::Downloading;
        inner.page.downloaded = 0;
        inner.page.total = None;
        inner.page.failed = false;
        drop(inner);

        let app = app.clone();
        spawn(async move { fetch_package(app, update).await });
        Note::Downloading { version }
    }

    // The install the student asked for can't go on.
    fn install_failed(&self) {
        let mut inner = self.inner.lock().unwrap();
        if std::mem::take(&mut inner.install_asked) {
            inner.page.failed = true;
        }
    }

    // The package that is ready and its release, the state moved on to
    // `phase`.
    fn take_ready(&self, phase: Phase) -> Option<(Update, PathBuf)> {
        let mut inner = self.inner.lock().unwrap();
        if inner.page.phase != Phase::Ready {
            return None;
        }
        let update = inner.update.clone()?;
        inner.page.phase = phase;
        inner.page.failed = false;
        let path = self.package(&update.version);
        Some((update, path))
    }
}

// The release's package into the cache folder: the one an earlier run
// downloaded, if it still matches the signature, else downloaded now.
async fn fetch_package(app: AppHandle, update: Update) {
    let state = app.state::<Updates>();
    let path = state.package(&update.version);

    let kept = {
        let (update, path, folder) = (update.clone(), path.clone(), state.packages.clone());
        spawn_blocking(move || {
            // Other versions' packages are of no use any more.
            for entry in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
                if entry.path() != path {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            let bytes = std::fs::read(&path).ok()?;
            update.verify(&bytes).is_ok().then_some(bytes.len() as u64)
        })
        .await
        .unwrap_or(None)
    };
    let outcome = if kept.is_some() { Ok(()) } else { download(&app, &update, &path).await };

    let install = {
        let mut inner = state.inner.lock().unwrap();
        if !inner.update.as_ref().is_some_and(|known| known.signature == update.signature) {
            // Withdrawn, or another release announced meanwhile.
            drop(inner);
            let _ = std::fs::remove_file(&path);
            return;
        }
        let asked = std::mem::take(&mut inner.install_asked);
        match outcome {
            Ok(()) => {
                trace!("{} ready{}", update.version, if kept.is_some() { " (kept from an earlier run)" } else { "" });
                if let Some(size) = kept {
                    inner.page.downloaded = size;
                    inner.page.total = Some(size);
                }
                inner.page.phase = Phase::Ready;
                inner.page.failed = false;
                asked
            }
            Err(error) => {
                eprintln!("[tafac] update {} not downloaded: {error}", update.version);
                if is_refusal(&error) {
                    inner.refused = Some(update.signature.clone());
                }
                inner.page.phase = Phase::Idle;
                inner.page.failed = asked;
                false
            }
        }
    };
    tell_state(&app);
    if install {
        install_now(&app).await;
    }
}

async fn download(app: &AppHandle, update: &Update, path: &Path) -> tauri_plugin_updater::Result<()> {
    let progress_app = app.clone();
    let signature = update.signature.clone();
    let mut downloaded = 0u64;
    // The plugin checks the signature before it hands the package over.
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                progress(&progress_app, &signature, downloaded, total);
            },
            || {},
        )
        .await?;

    let path = path.to_path_buf();
    spawn_blocking(move || -> std::io::Result<()> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        crate::jar::write_private(&path, &bytes)
    })
    .await??;
    Ok(())
}

fn progress(app: &AppHandle, signature: &str, downloaded: u64, total: Option<u64>) {
    let state = app.state::<Updates>();
    {
        let mut inner = state.inner.lock().unwrap();
        if !inner.update.as_ref().is_some_and(|known| known.signature == signature) {
            return;
        }
        inner.page.downloaded = downloaded;
        inner.page.total = total;
        if inner.told.elapsed() < PROGRESS_EVERY {
            return;
        }
    }
    tell_state(app);
}

// A package that isn't what was signed, whatever the network did.
fn is_refusal(error: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error;
    matches!(
        error,
        Error::Minisign(_)
            | Error::Base64(_)
            | Error::SignatureUtf8(_)
            | Error::SignedVersionMismatch { .. }
            | Error::MissingSignedVersion
    )
}

enum Failure {
    // The package is gone or no longer matches its signature.
    Package,
    Install,
}

// The package in place of the running app. The plugin checks its signature
// again first: what's installed is what was signed, whatever happened to the
// file since the download.
fn install_package(update: &Update, path: &Path) -> Result<(), Failure> {
    let bytes = std::fs::read(path).map_err(|_| Failure::Package)?;
    if let Err(error) = update.verify(&bytes) {
        eprintln!("[tafac] update {} refused: {error}", update.version);
        let _ = std::fs::remove_file(path);
        return Err(Failure::Package);
    }
    if !is_bundled() {
        // `cargo run`: there is no app to replace, only the build folder.
        eprintln!("[tafac] update {} not installed: not a packaged app", update.version);
        return Err(Failure::Install);
    }
    update.install(bytes).map_err(|error| {
        eprintln!("[tafac] update {} not installed: {error}", update.version);
        Failure::Install
    })?;
    let _ = std::fs::remove_file(path);
    Ok(())
}

// « Redémarrer », or « Mettre à jour » once the package is there: installed,
// then the app starts again as the new version.
async fn install_now(app: &AppHandle) {
    let state = app.state::<Updates>();
    let Some((update, path)) = state.take_ready(Phase::Installing) else { return };
    tell_state(app);
    trace!("installing {}", update.version);

    let result = spawn_blocking(move || install_package(&update, &path)).await.unwrap_or(Err(Failure::Install));
    match result {
        // RunEvent::Exit (main.rs) stops the server, then Tauri starts the
        // app again.
        Ok(()) => app.request_restart(),
        Err(failure) => {
            {
                let mut inner = state.inner.lock().unwrap();
                inner.page.failed = true;
                inner.page.phase = match failure {
                    Failure::Package => Phase::Idle,
                    Failure::Install => Phase::Ready,
                };
            }
            tell_state(app);
        }
    }
}

// The page asks for the update now (POST /__desktop/update/install): the
// install if the package is ready, else the download first (again from
// latest.json if it had failed).
pub fn install(app: &AppHandle) {
    let state = app.state::<Updates>();
    let phase = {
        let mut inner = state.inner.lock().unwrap();
        inner.page.failed = false;
        if matches!(inner.page.phase, Phase::Idle | Phase::Downloading) {
            inner.install_asked = true;
        }
        inner.page.phase
    };
    tell_state(app);
    let app = app.clone();
    spawn(async move {
        match phase {
            Phase::Ready => install_now(&app).await,
            Phase::Idle => {
                check(&app, None).await;
            }
            Phase::Downloading | Phase::Installing => {}
        }
    });
}

// The app quits (RunEvent::Exit, main.rs): a package that is ready replaces
// the app, when that takes no password. Else it waits for « Redémarrer »,
// where the system's prompt has a reason to show.
pub fn install_on_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<Updates>() else { return };
    if !installs_unasked() {
        return;
    }
    let Some((update, path)) = state.take_ready(Phase::Installing) else { return };
    if install_package(&update, &path).is_ok() {
        trace!("{} installed on quit", update.version);
    }
}

// The app's bundle: …/Tafac.app, from …/Tafac.app/Contents/MacOS/<binary>.
#[cfg(target_os = "macos")]
fn bundle() -> Option<PathBuf> {
    let executable = tauri::utils::platform::current_exe().ok()?;
    let folder = executable.parent()?;
    let bundle = folder.parent()?.parent()?;
    (folder.ends_with("Contents/MacOS") && bundle.extension().is_some_and(|extension| extension == "app"))
        .then(|| bundle.to_path_buf())
}

// The plugin replaces whatever folder the binary is in: the app's bundle,
// or for `cargo run` the build folder.
fn is_bundled() -> bool {
    #[cfg(target_os = "macos")]
    {
        bundle().is_some()
    }
    #[cfg(not(target_os = "macos"))]
    {
        tauri::utils::platform::bundle_type().is_some()
    }
}

// Whether replacing the app needs nothing from the student: their account
// can write to the bundle and to the folder it is in (not an app another
// account installed, nor one run from a read-only place). macOS only for
// now: elsewhere the install runs an installer.
fn installs_unasked() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let writable = |path: &Path| {
            CString::new(path.as_os_str().as_bytes())
                // SAFETY: a NUL-terminated path, only read.
                .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::W_OK) } == 0)
        };
        bundle().is_some_and(|bundle| writable(&bundle) && bundle.parent().is_some_and(writable))
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

// GET-like: the state for a page that starts (POST /__desktop/update/state).
// It waits for the launch check's answer, a few seconds from launch at most:
// a version that can't sign in any more is known before the page asks the
// university anything, and a check without an answer never holds the page.
pub async fn page_state(app: &AppHandle) -> PageState {
    let state = app.state::<Updates>();
    let mut launch_checked = state.launch_checked.subscribe();
    let wait = LAUNCH_WAIT.saturating_sub(state.started.elapsed());
    let _ = tokio::time::timeout(wait, launch_checked.wait_for(|checked| *checked)).await;
    let page = state.inner.lock().unwrap().page.clone();
    page
}

// The state to every window's page, as a `tafac:update` event.
fn tell_state(app: &AppHandle) {
    let state = app.state::<Updates>();
    let page = {
        let mut inner = state.inner.lock().unwrap();
        inner.told = Instant::now();
        inner.page.clone()
    };
    for window in app.webview_windows().into_values() {
        tell(&window, "tafac:update", &page);
    }
}

fn tell(window: &WebviewWindow, event: &str, detail: &impl Serialize) {
    let Ok(detail) = serde_json::to_string(detail) else { return };
    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('{event}', {{ detail: {detail} }}))"));
}
