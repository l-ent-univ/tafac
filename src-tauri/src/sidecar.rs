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
    // The socket's path, removed with the server (Unix; a pipe goes by itself).
    #[cfg_attr(not(unix), allow(dead_code))]
    endpoint: String,
}

impl Sidecar {
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
            // The server is killed, not closed: its socket file stays.
            #[cfg(unix)]
            let _ = std::fs::remove_file(&self.endpoint);
        }
    }
}

// Where the server listens: a Unix socket, or a named pipe on Windows. Named
// after this process, so two copies of the app don't collide.
//
// The socket sits in a folder only the student's account can enter. The
// bridge connects to whatever is at that path and shows its answers in the
// window, and the shared /tmp of a Linux machine lets anyone put a socket
// there first, under a name that is easy to guess: their server would then
// be the one the window shows (a login page of their own). So, in order:
// the session's runtime folder ($XDG_RUNTIME_DIR, private by definition),
// the app's data folder, a folder of the app's own in the temporary one.
#[cfg(unix)]
pub fn endpoint(data_dir: &Path) -> std::io::Result<String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    // The data folder is the app's: closed to others, and its owner is who
    // the other folders must belong to.
    std::fs::set_permissions(data_dir, std::fs::Permissions::from_mode(0o700))?;
    let owner = std::fs::metadata(data_dir)?.uid();

    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).filter(|dir| dir.is_absolute());
    let temporary_dir = std::env::temp_dir().join(format!("tafac-{owner}"));
    let name = format!("s-{}.sock", std::process::id());

    let folders = runtime_dir.into_iter().chain([data_dir.to_path_buf(), temporary_dir.clone()]);
    for folder in folders {
        if folder == temporary_dir {
            // Made for the occasion; one already there is checked like the others.
            use std::os::unix::fs::DirBuilderExt;
            let _ = std::fs::DirBuilder::new().mode(0o700).create(&folder);
        }
        let Some(path) = socket_path(&folder, &name, is_private_dir(&folder, owner)) else { continue };
        remove_stale_sockets(&folder);
        return Ok(path.to_string_lossy().into_owned());
    }

    Err(std::io::Error::other("no private folder for the local server's socket (path too long, or the folder belongs to someone else)"))
}

#[cfg(windows)]
pub fn endpoint(_data_dir: &Path) -> std::io::Result<String> {
    Ok(format!(r"\\.\pipe\tafac-{}-{}", std::process::id(), random_hex(8)))
}

// A Unix socket's path fits in ~104 bytes on macOS, 108 on Linux.
#[cfg(unix)]
const MAX_SOCKET_PATH_BYTES: usize = 100;

// The socket's path in `folder`, when the folder is private and the path
// short enough to bind.
#[cfg(unix)]
fn socket_path(folder: &Path, name: &str, folder_is_private: bool) -> Option<PathBuf> {
    let path = folder.join(name);
    (folder_is_private && path.as_os_str().len() <= MAX_SOCKET_PATH_BYTES).then_some(path)
}

// A folder of `owner`'s that nobody else can enter or write to.
#[cfg(unix)]
fn is_private_dir(folder: &Path, owner: u32) -> bool {
    use std::os::unix::fs::MetadataExt;
    // symlink_metadata: a link to somewhere else is not the folder itself.
    std::fs::symlink_metadata(folder).is_ok_and(|metadata| metadata.is_dir() && metadata.uid() == owner && metadata.mode() & 0o077 == 0)
}

// The sockets of earlier runs that ended without cleaning up (a crash, a
// kill): nothing answers behind them any more. One that still answers is
// another copy of the app, left alone.
#[cfg(unix)]
fn remove_stale_sockets(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_ours = name
            .strip_prefix("s-")
            .and_then(|rest| rest.strip_suffix(".sock"))
            .is_some_and(|pid| !pid.is_empty() && pid.bytes().all(|byte| byte.is_ascii_digit()));
        if !is_ours {
            continue;
        }
        let refused = std::os::unix::net::UnixStream::connect(entry.path())
            .is_err_and(|error| error.kind() == std::io::ErrorKind::ConnectionRefused);
        if refused {
            let _ = std::fs::remove_file(entry.path());
        }
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

pub fn random_hex(bytes: usize) -> String {
    (0..bytes).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
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

    Ok(Sidecar { child: Mutex::new(Some(child)), endpoint: endpoint.to_string() })
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tafac-sidecar-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn owner_of(folder: &Path) -> u32 {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(folder).unwrap().uid()
    }

    fn set_mode(folder: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    #[test]
    fn the_socket_goes_in_a_private_folder_only() {
        let folder = Path::new("/run/user/1000");
        assert_eq!(socket_path(folder, "s-42.sock", true), Some(PathBuf::from("/run/user/1000/s-42.sock")));
        assert_eq!(socket_path(folder, "s-42.sock", false), None);
    }

    #[test]
    fn a_path_too_long_to_bind_is_passed_over() {
        let long = PathBuf::from(format!("/Users/{}/Library/Application Support/fr.tafac.desktop", "a".repeat(60)));
        assert_eq!(socket_path(&long, "s-42.sock", true), None);
        let usual = Path::new("/Users/camille/Library/Application Support/fr.tafac.desktop");
        assert!(socket_path(usual, "s-4194304.sock", true).is_some());
    }

    #[test]
    fn a_folder_others_can_enter_is_not_private() {
        let folder = scratch_dir("private");
        let owner = owner_of(&folder);

        set_mode(&folder, 0o700);
        assert!(is_private_dir(&folder, owner));
        // Someone else's, whatever its mode.
        assert!(!is_private_dir(&folder, owner + 1));

        for open_mode in [0o755, 0o770, 0o701, 0o1777] {
            set_mode(&folder, open_mode);
            assert!(!is_private_dir(&folder, owner), "{open_mode:o}");
        }

        // Not a folder, not there, a link to one.
        let file = folder.join("file");
        std::fs::write(&file, "").unwrap();
        assert!(!is_private_dir(&file, owner));
        assert!(!is_private_dir(&folder.join("missing"), owner));
        set_mode(&folder, 0o700);
        let link = std::env::temp_dir().join(format!("tafac-sidecar-test-{}-link", std::process::id()));
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&folder, &link).unwrap();
        assert!(!is_private_dir(&link, owner));
        let _ = std::fs::remove_file(&link);
    }

    #[test]
    fn the_endpoint_is_in_the_data_folder_closed_to_others() {
        use std::os::unix::fs::MetadataExt;
        // Whatever $XDG_RUNTIME_DIR holds on this machine, the folder chosen
        // is private and the data folder is closed.
        let data_dir = scratch_dir("data");
        set_mode(&data_dir, 0o755);
        let endpoint = PathBuf::from(endpoint(&data_dir).unwrap());

        assert_eq!(std::fs::metadata(&data_dir).unwrap().mode() & 0o777, 0o700);
        assert_eq!(endpoint.file_name().unwrap().to_string_lossy(), format!("s-{}.sock", std::process::id()));
        assert!(is_private_dir(endpoint.parent().unwrap(), owner_of(&data_dir)));
        assert!(endpoint.as_os_str().len() <= MAX_SOCKET_PATH_BYTES);
    }

    #[test]
    fn sockets_nobody_answers_behind_are_removed() {
        use std::os::unix::net::UnixListener;
        let folder = scratch_dir("stale");

        // A crashed run's socket: bound, then its listener gone.
        let stale = folder.join("s-111.sock");
        drop(UnixListener::bind(&stale).unwrap());
        // Another copy of the app, still listening.
        let live = folder.join("s-222.sock");
        let _listener = UnixListener::bind(&live).unwrap();
        // Not ours.
        let other = folder.join("cookies.json");
        std::fs::write(&other, "{}").unwrap();
        let lookalike = folder.join("s-abc.sock");
        drop(UnixListener::bind(&lookalike).unwrap());

        remove_stale_sockets(&folder);
        assert!(!stale.exists());
        assert!(live.exists());
        assert!(other.exists());
        assert!(lookalike.exists());
    }
}
