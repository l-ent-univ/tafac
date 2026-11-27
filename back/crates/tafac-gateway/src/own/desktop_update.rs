// GET /desktop/latest.json and /desktop/download/<platform>: tafac.fr's part
// in the desktop app's updates (docs/DESKTOP.md, « Updates »;
// server/desktopUpdate/index.ts). The one file the installed apps read, and
// a lasting address for its installers.
//
// The manifest (manifest.rs) comes from Node's settings:
//   DESKTOP_LATEST_FILE  a path to it, read again whenever the file changes
//                        (no restart). tafac.fr fills it by itself from the
//                        newest GitHub release (follow.rs), or
//   DESKTOP_LATEST_JSON  the JSON itself, read once.
//
//   GET /desktop/latest.json
//     200 the manifest as published, application/json, charset utf-8;
//         Cache-Control: no-cache (asked again each time: an update is out
//         as soon as it is published)
//     404 empty: neither set, a file that isn't there or can't be read, a
//         manifest that doesn't check (the log says why, once for each
//         time the file changed). The apps take it as no answer and go on
//         as they are: nothing here can tell them they are too old by
//         accident
//   GET /desktop/download/<platform>   (darwin-aarch64, darwin-x86_64…)
//     302 to that platform's `installer`, Cache-Control: no-cache, as
//         res.redirect writes it (express.rs)
//     404 empty: no manifest, or no installer for that platform
//     400 for a platform's name that doesn't decode: Node's
//
// The file's date says when it changed, as Node's statSync: a file
// rewritten within the same instant isn't read again.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use http::Response;

use super::express::{self, Asked};
use super::{Report, Service};
use crate::routes::Servers;

mod follow;
pub(crate) mod manifest;

pub use self::follow::{follow_releases, Following};
use self::manifest::{parse_desktop_manifest, DesktopManifest};

// Asked again by every app each time: never kept as it is.
const CACHE: &str = "no-cache";
const MANIFEST_TYPE: &str = "application/json";

enum Source {
    // DESKTOP_LATEST_FILE, and what was read of it: when it had changed
    // last, and the manifest then.
    File { path: PathBuf, read: Mutex<Option<(SystemTime, Option<Arc<DesktopManifest>>)>> },
    // DESKTOP_LATEST_JSON, checked once; or neither.
    Fixed(Option<Arc<DesktopManifest>>),
}

pub struct DesktopUpdate {
    source: Source,
    report: Report,
}

fn check(text: &str, origin: &str, report: &Report) -> Option<Arc<DesktopManifest>> {
    match parse_desktop_manifest(text) {
        Ok(manifest) => Some(Arc::new(manifest)),
        Err(error) => {
            report(&format!("Desktop update manifest ({origin}) not served: {error}"));
            None
        }
    }
}

impl DesktopUpdate {
    // `file`: DESKTOP_LATEST_FILE, `json`: DESKTOP_LATEST_JSON; empty when
    // they aren't set. The file, when there is one, is the manifest.
    pub fn new(file: &str, json: &str) -> Self {
        Self::reporting(file, json, super::to_log())
    }

    pub(crate) fn reporting(file: &str, json: &str, report: Report) -> Self {
        let source = if !file.is_empty() {
            Source::File { path: PathBuf::from(file), read: Mutex::new(None) }
        } else {
            Source::Fixed((!json.is_empty()).then(|| check(json, "DESKTOP_LATEST_JSON", &report)).flatten())
        };
        Self { source, report }
    }

    // The manifest as it is now: the file's, read again when it changed,
    // else the environment's.
    fn current(&self) -> Option<Arc<DesktopManifest>> {
        let (path, read) = match &self.source {
            Source::Fixed(manifest) => return manifest.clone(),
            Source::File { path, read } => (path, read),
        };
        let mut read = read.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let Ok(changed_at) = std::fs::metadata(path).and_then(|metadata| metadata.modified()) else {
            // Not there (yet): asked again at the next request.
            *read = None;
            return None;
        };
        if let Some((_, manifest)) = read.as_ref().filter(|(at, _)| *at == changed_at) {
            return manifest.clone();
        }
        let manifest = std::fs::read(path).ok().and_then(|bytes| check(&String::from_utf8_lossy(&bytes), &path.to_string_lossy(), &self.report));
        *read = Some((changed_at, manifest.clone()));
        manifest
    }
}

impl Service for DesktopUpdate {
    fn answer(&self, asked: &Asked<'_>) -> Option<Response<Vec<u8>>> {
        match asked.route {
            Servers::DesktopManifest => Some(match self.current() {
                Some(manifest) => express::text(asked, CACHE, MANIFEST_TYPE, manifest.text.clone()),
                None => express::nothing(asked),
            }),
            Servers::DesktopInstaller => {
                let platform = asked.under.as_deref()?;
                Some(match self.current().and_then(|manifest| manifest.installers.get(platform).cloned()) {
                    Some(installer) => express::found(asked, CACHE, &installer),
                    None => express::nothing(asked),
                })
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use http::{HeaderMap, HeaderValue, Method};

    use super::manifest::tests::manifest;
    use super::*;

    fn reporting() -> (Report, Arc<Mutex<Vec<String>>>) {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let kept = messages.clone();
        (Arc::new(move |message: &str| kept.lock().unwrap().push(message.to_string())), messages)
    }

    fn get(update: &DesktopUpdate, path: &str, headers: &HeaderMap) -> Response<Vec<u8>> {
        let asked = express::asked(&Method::GET, path, headers).unwrap_or_else(|| panic!("{path} is one of the server's own"));
        update.answer(&asked).unwrap()
    }

    fn version(update: &DesktopUpdate) -> Option<String> {
        update.current().map(|manifest| manifest.version.clone())
    }

    // The file's date, set as Node's test sets it (utimesSync).
    fn dated(file: &std::path::Path, text: &str, seconds: u64) {
        std::fs::write(file, text).unwrap();
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(seconds);
        std::fs::File::options().write(true).open(file).unwrap().set_modified(at).unwrap();
    }

    #[test]
    fn the_manifest_comes_from_the_file_read_again_when_it_changes_else_from_the_environment() {
        let (report, messages) = reporting();
        assert_eq!(version(&DesktopUpdate::reporting("", "", report.clone())), None);
        assert_eq!(version(&DesktopUpdate::reporting("", &manifest().to_string(), report.clone())).as_deref(), Some("0.26.0"));
        assert_eq!(version(&DesktopUpdate::reporting("", r#"{"version":"nope"}"#, report.clone())), None);
        assert_eq!(*messages.lock().unwrap(), ["Desktop update manifest (DESKTOP_LATEST_JSON) not served: \"version\" is not x.y.z"]);

        let folder = std::env::temp_dir().join(format!("tafac-desktop-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("latest.json");
        let current = DesktopUpdate::reporting(file.to_str().unwrap(), "{}", report.clone());
        assert_eq!(version(&current), None);

        dated(&file, &manifest().to_string(), 1_000);
        assert_eq!(version(&current).as_deref(), Some("0.26.0"));
        let mut newer = manifest();
        newer["version"] = "0.27.0".into();
        dated(&file, &newer.to_string(), 2_000);
        assert_eq!(version(&current).as_deref(), Some("0.27.0"));
        // Rewritten with the same date: not read again, as Node.
        dated(&file, &manifest().to_string(), 2_000);
        assert_eq!(version(&current).as_deref(), Some("0.27.0"));

        // A broken publish is taken back, not served, and said once.
        dated(&file, "{ \"version\": ", 3_000);
        assert_eq!(version(&current), None);
        assert_eq!(version(&current), None);
        let said = messages.lock().unwrap().clone();
        assert_eq!(said.len(), 2);
        assert_eq!(said[1], format!("Desktop update manifest ({}) not served: not JSON", file.display()));

        std::fs::remove_file(&file).unwrap();
        assert_eq!(version(&current), None);
        // Back, with the date it had before it went: read again.
        dated(&file, &newer.to_string(), 2_000);
        assert_eq!(version(&current).as_deref(), Some("0.27.0"));
        // A folder in its place: nothing.
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        assert_eq!(version(&current), None);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn tafac_fr_serves_the_manifest_and_sends_to_the_installers() {
        let text = manifest().to_string();
        let (report, _) = reporting();
        let update = DesktopUpdate::reporting("", &text, report);
        let headers = HeaderMap::new();

        let answer = get(&update, "/desktop/latest.json", &headers);
        assert_eq!(answer.status(), 200);
        assert_eq!(answer.headers()["content-type"], "application/json; charset=utf-8");
        assert_eq!(answer.headers()["cache-control"], "no-cache");
        assert_eq!(answer.headers()["strict-transport-security"], "max-age=31536000");
        assert_eq!(answer.body(), text.as_bytes());

        let answer = get(&update, "/desktop/download/darwin-aarch64", &headers);
        assert_eq!(answer.status(), 302);
        assert_eq!(answer.headers()["location"], "https://example.org/Tafac_0.26.0_aarch64.dmg");
        assert_eq!(answer.headers()["cache-control"], "no-cache");
        assert_eq!(answer.headers()["content-type"], "text/plain; charset=utf-8");
        assert_eq!(answer.body(), b"Found. Redirecting to https://example.org/Tafac_0.26.0_aarch64.dmg");
        // A browser's link: HTML.
        let mut browser = HeaderMap::new();
        browser.insert("accept", HeaderValue::from_static("text/html,application/xhtml+xml,*/*;q=0.8"));
        assert_eq!(get(&update, "/desktop/download/darwin-aarch64/", &browser).body(), b"<p>Found. Redirecting to https://example.org/Tafac_0.26.0_aarch64.dmg</p>");

        for path in ["/desktop/download/darwin-x86_64", "/desktop/download/windows-x86_64", "/desktop/download/DARWIN-AARCH64", "/desktop/download/darwin-aarch64%2F"] {
            let answer = get(&update, path, &headers);
            assert_eq!((answer.status().as_u16(), answer.body().len()), (404, 0), "{path}");
            assert!(answer.headers().get("cache-control").is_none());
        }
        // Its name, decoded.
        assert_eq!(get(&update, "/desktop/download/darwin%2Daarch64", &headers).status(), 302);
        // One that doesn't decode is Node's (its 400).
        assert!(express::asked(&Method::GET, "/desktop/download/%E0", &headers).is_none());
    }

    #[test]
    fn without_a_manifest_the_apps_get_no_answer() {
        let (report, _) = reporting();
        let update = DesktopUpdate::reporting("", "", report);
        let headers = HeaderMap::new();
        for path in ["/desktop/latest.json", "/desktop/download/darwin-aarch64"] {
            let answer = get(&update, path, &headers);
            assert_eq!((answer.status().as_u16(), answer.body().len()), (404, 0), "{path}");
        }
        // Nor are another service's routes its.
        let asked = express::asked(&Method::GET, "/app/settings.json", &headers).unwrap();
        assert!(update.answer(&asked).is_none());
    }

}
