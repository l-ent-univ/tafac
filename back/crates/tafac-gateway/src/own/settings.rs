// GET /app/settings.json and /app/settings.json.sig: the apps' remote
// settings (docs/REMOTE_SETTINGS.md), from the file APP_SETTINGS_FILE names
// and the same path plus « .sig » (server/remoteSettings/index.ts,
// createAppSettingsRouter).
//
// tafac.fr holds no key and checks nothing: it sends both files as they
// are, so whoever got into it could not make a file the apps take. Each is
// read again at each request: a file published is out at once, no restart.
//
//   200 the file's text (read as UTF-8: what isn't is U+FFFD), as
//       application/json or text/plain, charset utf-8; Cache-Control:
//       no-store. A file that doesn't read as settings, or is badly signed,
//       is sent all the same: the apps refuse it
//   404 empty: the file isn't there, or can't be read (a folder, no right
//       to it)
//   without APP_SETTINGS_FILE: Node's. It has no such route then, and
//       answers its page (a 404)
//
// What the apps check the file with is here too, as Node's
// (server/remoteSettings/): its signature (minisign.rs), what it says
// (document.rs) and what a patch may not do (guard.rs). Nothing calls them
// yet: the apps still read the file in their own Node server
// (server/remoteSettings/index.ts: asking tafac.fr, keeping the file,
// laying the patches over its universities' settings), which isn't
// ported. They are for the day the apps' gateway reads it instead, and
// their tests hold them to Node's, on Node's own signed fixtures.

use std::path::PathBuf;

use http::Response;

use super::express::{self, Asked};
use super::Service;
use crate::routes::Servers;

#[cfg_attr(not(test), allow(dead_code))]
mod document;
#[cfg_attr(not(test), allow(dead_code))]
mod guard;
#[cfg_attr(not(test), allow(dead_code))]
mod minisign;

// Never kept by anyone between the server and the app: each request reads
// the file as it is now.
const CACHE: &str = "no-store";
const SETTINGS_TYPE: &str = "application/json";
const SIGNATURE_TYPE: &str = "text/plain";

pub struct AppSettings {
    // APP_SETTINGS_FILE; None: Node answers.
    file: Option<PathBuf>,
}

impl AppSettings {
    // `file`: APP_SETTINGS_FILE, empty when it isn't set.
    pub fn new(file: &str) -> Self {
        Self { file: (!file.is_empty()).then(|| PathBuf::from(file)) }
    }

    fn send(asked: &Asked<'_>, path: PathBuf, kind: &str) -> Response<Vec<u8>> {
        match std::fs::read(path) {
            Ok(bytes) => express::text(asked, CACHE, kind, String::from_utf8_lossy(&bytes).into_owned()),
            Err(_) => express::nothing(asked),
        }
    }
}

impl Service for AppSettings {
    fn answer(&self, asked: &Asked<'_>) -> Option<Response<Vec<u8>>> {
        let file = self.file.as_ref()?;
        match asked.route {
            Servers::AppSettings => Some(Self::send(asked, file.clone(), SETTINGS_TYPE)),
            Servers::AppSettingsSignature => {
                let mut signature = file.clone().into_os_string();
                signature.push(".sig");
                Some(Self::send(asked, signature.into(), SIGNATURE_TYPE))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use http::{HeaderMap, Method};

    use super::*;

    const NODE: &str = include_str!("../../../../../server/remoteSettings/index.ts");
    const FIXTURES: &str = include_str!("../../../../../tests/fixtures/remoteSettings.js");

    // Node's tests' files, signed with a key made for them alone
    // (tests/fixtures/remoteSettings.js): its public key, and each file's
    // text and signature by its name (TAKEN, NEWER, OLDER).
    pub(crate) fn public_key() -> String {
        let line = FIXTURES.lines().find_map(|line| line.strip_prefix("export const PUBLIC_KEY = ")).expect("the fixtures' key");
        serde_json::from_str(line).unwrap()
    }

    pub(crate) fn fixture(name: &str) -> (String, String) {
        let start = format!("export const {name} = {{");
        let mut lines = FIXTURES.lines().skip_while(|line| *line != start).skip(1);
        let mut field = |key: &str| -> String {
            let line = lines.next().and_then(|line| line.trim().strip_prefix(key)).unwrap_or_else(|| panic!("{name}.{key}"));
            serde_json::from_str(line.trim_end_matches(',')).unwrap()
        };
        let text = field("text: ");
        (text, field("signature: "))
    }

    struct Folder(PathBuf);

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn folder() -> Folder {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!("tafac-app-settings-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        std::fs::create_dir_all(&path).unwrap();
        Folder(path)
    }

    fn get(settings: &AppSettings, method: Method, path: &str) -> Option<Response<Vec<u8>>> {
        let headers = HeaderMap::new();
        let services: Vec<Box<dyn Service>> = vec![Box::new(AppSettings { file: settings.file.clone() })];
        super::super::answer(&services, &method, path, &headers)
    }

    #[test]
    fn the_file_and_its_signature_are_sent_as_they_are() {
        let folder = folder();
        let file = folder.0.join("settings.json");
        // A signature that isn't this file's: tafac.fr checks nothing.
        let (text, _) = fixture("TAKEN");
        let (_, signature) = fixture("NEWER");
        std::fs::write(&file, &text).unwrap();
        std::fs::write(folder.0.join("settings.json.sig"), &signature).unwrap();
        let settings = AppSettings::new(file.to_str().unwrap());

        let answer = get(&settings, Method::GET, "/app/settings.json").unwrap();
        assert_eq!(answer.status(), 200);
        assert_eq!(answer.headers()["content-type"], "application/json; charset=utf-8");
        assert_eq!(answer.headers()["cache-control"], "no-store");
        assert_eq!(answer.headers()["x-content-type-options"], "nosniff");
        assert_eq!(answer.body(), text.as_bytes());

        let answer = get(&settings, Method::GET, "/app/settings.json.sig").unwrap();
        assert_eq!(answer.headers()["content-type"], "text/plain; charset=utf-8");
        assert_eq!(answer.body(), signature.as_bytes());

        // As Express matches it, and HEAD without the body.
        assert_eq!(get(&settings, Method::GET, "/APP/Settings.json/").unwrap().body(), text.as_bytes());
        let answer = get(&settings, Method::HEAD, "/app/settings.json").unwrap();
        assert_eq!(answer.headers()["content-length"], text.len().to_string().as_str());
        assert!(answer.body().is_empty());
        // Another method is Node's.
        assert!(get(&settings, Method::POST, "/app/settings.json").is_none());
    }

    #[test]
    fn a_file_changed_missing_or_unreadable_is_read_at_each_request() {
        let folder = folder();
        let file = folder.0.join("settings.json");
        let settings = AppSettings::new(file.to_str().unwrap());
        // Not there (yet), neither is its signature.
        for path in ["/app/settings.json", "/app/settings.json.sig"] {
            let answer = get(&settings, Method::GET, path).unwrap();
            assert_eq!((answer.status().as_u16(), answer.body().len()), (404, 0), "{path}");
            assert_eq!(answer.headers()["content-length"], "0");
            assert!(answer.headers().get("content-type").is_none());
        }

        std::fs::write(&file, r#"{"serial":1,"patches":[]}"#).unwrap();
        assert_eq!(get(&settings, Method::GET, "/app/settings.json").unwrap().body(), br#"{"serial":1,"patches":[]}"#);
        // Changed on disk: the next request has it, whatever its date.
        std::fs::write(&file, b"\xef\xbb\xbf{\"serial\":2}\xff").unwrap();
        // As Node reads it: the BOM kept, a byte that isn't UTF-8 replaced.
        assert_eq!(get(&settings, Method::GET, "/app/settings.json").unwrap().body(), "\u{feff}{\"serial\":2}\u{fffd}".as_bytes());
        // A folder where the file should be: nothing.
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        assert_eq!(get(&settings, Method::GET, "/app/settings.json").unwrap().status(), 404);
    }

    #[test]
    fn without_app_settings_file_the_routes_are_nodes() {
        let settings = AppSettings::new("");
        assert!(get(&settings, Method::GET, "/app/settings.json").is_none());
        assert!(get(&settings, Method::GET, "/app/settings.json.sig").is_none());
        // Nor are another service's routes its.
        let settings = AppSettings::new("/nowhere/settings.json");
        let headers = HeaderMap::new();
        let asked = Asked { route: Servers::DesktopManifest, under: None, head: false, headers: &headers };
        assert!(settings.answer(&asked).is_none());
    }

    #[test]
    fn what_is_sent_is_what_nodes_router_sends() {
        let router = NODE.split("export function createAppSettingsRouter").nth(1).expect("Node's router");
        assert!(router.contains(&format!("res.setHeader('Cache-Control', '{CACHE}')")));
        assert!(router.contains(&format!("router.get('/app/settings.json', send(file, '{SETTINGS_TYPE}'))")));
        assert!(router.contains(&format!("router.get('/app/settings.json.sig', send(`${{file}}.sig`, '{SIGNATURE_TYPE}'))")));
        assert!(router.contains("env.APP_SETTINGS_FILE?.trim()"));
        assert!(router.contains("res.status(404).end()"));
    }
}
