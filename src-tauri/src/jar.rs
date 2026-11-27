// The app's own cookie jar for its server's cookies (the encrypted session
// cookie, __Host-lent_session, which the gateway writes and reads).
//
// The window is on the tafac:// scheme, and WebKit (macOS) does not keep
// cookies that a custom scheme's responses set. So the bridge keeps them:
// it takes Set-Cookie off each answer and hands the session's back to the
// gateway with the next request. The page never sees them (not even through
// document.cookie).
//
// One site, one user: cookies are kept by name only. The ones with an
// expiry are saved to the app's data folder, so the student stays signed in
// across restarts like on the web; session-only ones last until the app quits.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
struct StoredCookie {
    value: String,
    // Unix seconds; None: until the app quits.
    expires_at: Option<i64>,
}

pub struct CookieJar {
    path: PathBuf,
    cookies: Mutex<BTreeMap<String, StoredCookie>>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

// A session saved by a version older than this one is dropped once, as the
// app starts (the version that saved the jar is written beside it,
// `cookies.version`). 0.31.0, the first without Node, kept a restored
// session without the component its sign-in found (the IUT de Lannion), and
// its grades then said there were none: dropped, the app signs in again by
// itself with the kept login (signin.rs), and the sign-in finds it again.
// Raise it only to sign every app out once more.
const SESSIONS_KEPT_FROM: (u64, u64, u64) = (0, 31, 1);

// "x.y.z" as numbers; None for anything else.
fn version_of(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.trim().split('.').map(|part| part.parse::<u64>().ok());
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(Some(major)), Some(Some(minor)), Some(Some(patch)), None) => Some((major, minor, patch)),
        _ => None,
    }
}

impl CookieJar {
    // The jar, for the app at `version`: a session an older app saved
    // (before SESSIONS_KEPT_FROM, or with no version said: every install
    // until 0.31.1) is dropped once. A development build (0.0.0) drops
    // nothing.
    pub fn load_for(path: PathBuf, version: &str) -> Self {
        let marker = path.with_extension("version");
        let saved_by = std::fs::read_to_string(&marker).ok().and_then(|text| version_of(&text));
        let jar = Self::load(path);
        let running = version_of(version);
        let from_before = saved_by.is_none_or(|saved| saved < SESSIONS_KEPT_FROM);
        if running.is_some_and(|running| running >= SESSIONS_KEPT_FROM) && from_before {
            let mut cookies = jar.cookies.lock().unwrap();
            if !cookies.is_empty() {
                cookies.clear();
                jar.save(&cookies);
                eprintln!("[tafac] session: signed out once, kept by an older version of the app");
            }
        }
        if let Err(error) = write_private(&marker, version.as_bytes()) {
            eprintln!("[tafac] the jar's version not saved: {error}");
        }
        jar
    }

    pub fn load(path: PathBuf) -> Self {
        let cookies = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, cookies: Mutex::new(cookies) }
    }

    // One cookie's value, unless it has expired: the server's session
    // cookie, for what the app answers itself (bridge.rs).
    pub fn get(&self, name: &str) -> Option<String> {
        let cookies = self.cookies.lock().unwrap();
        let cookie = cookies.get(name)?;
        cookie.expires_at.map_or(true, |expiry| expiry > now()).then(|| cookie.value.clone())
    }

    // A response's Set-Cookie headers: stored, replaced, or cleared (empty
    // value, Max-Age=0 or a past Expires, as the server's logout sends).
    pub fn store<'a>(&self, set_cookies: impl Iterator<Item = &'a str>) {
        let mut cookies = self.cookies.lock().unwrap();
        let mut changed = false;
        let current = now();

        for raw in set_cookies {
            let Ok(parsed) = cookie::Cookie::parse(raw) else { continue };
            let expires_at = match parsed.max_age() {
                Some(max_age) => Some(current + max_age.whole_seconds()),
                None => parsed.expires_datetime().map(|expiry| expiry.unix_timestamp()),
            };
            let name = parsed.name().to_string();

            if parsed.value().is_empty() || expires_at.is_some_and(|expiry| expiry <= current) {
                changed |= cookies.remove(&name).is_some();
            } else {
                cookies.insert(name, StoredCookie { value: parsed.value().to_string(), expires_at });
                changed = true;
            }
        }

        if changed {
            self.save(&cookies);
        }
    }

    fn save(&self, cookies: &BTreeMap<String, StoredCookie>) {
        let lasting: BTreeMap<&String, &StoredCookie> =
            cookies.iter().filter(|(_, cookie)| cookie.expires_at.is_some()).collect();
        let Ok(bytes) = serde_json::to_vec(&lasting) else { return };
        if let Err(error) = write_private(&self.path, &bytes) {
            eprintln!("[tafac] cookies not saved: {error}");
        }
    }
}

// Readable by the student's account only.
pub fn write_private(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options.open(path)?.write_all(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A jar saved in a folder of its own, holding a lasting session cookie,
    // its version file as given (None: none, as every install before 0.31.1).
    fn saved(name: &str, saved_by: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tafac-jar-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cookies.json");
        CookieJar::load(path.clone()).store(["__Host-lent_session=v1.kept; Max-Age=2592000; Path=/"].into_iter());
        if let Some(version) = saved_by {
            std::fs::write(path.with_extension("version"), version).unwrap();
        }
        path
    }

    fn session(jar: &CookieJar) -> Option<String> {
        jar.get("__Host-lent_session")
    }

    #[test]
    fn a_session_an_older_app_kept_is_dropped_once() {
        for (name, saved_by) in [("none", None), ("old", Some("0.31.0"))] {
            let path = saved(name, saved_by);
            let jar = CookieJar::load_for(path.clone(), "0.31.1");
            assert_eq!(session(&jar), None, "{name}");
            // Dropped on disk too, and not again: the version is written.
            assert_eq!(session(&CookieJar::load(path.clone())), None, "{name}");
            assert_eq!(std::fs::read_to_string(path.with_extension("version")).unwrap(), "0.31.1");
            jar.store(["__Host-lent_session=v1.new; Max-Age=2592000; Path=/"].into_iter());
            assert_eq!(session(&CookieJar::load_for(path.clone(), "0.31.2")).as_deref(), Some("v1.new"), "{name}");
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        }
    }

    #[test]
    fn a_session_this_app_kept_stays() {
        let path = saved("same", Some("0.31.1"));
        assert_eq!(session(&CookieJar::load_for(path.clone(), "0.32.0")).as_deref(), Some("v1.kept"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_development_build_drops_nothing() {
        let path = saved("dev", None);
        assert_eq!(session(&CookieJar::load_for(path.clone(), "0.0.0")).as_deref(), Some("v1.kept"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn versions_are_read_as_numbers() {
        assert!(version_of("0.31.1") > version_of("0.9.9"));
        assert_eq!(version_of(" 0.31.1\n"), Some((0, 31, 1)));
        for not_one in ["", "0.31", "0.31.1.2", "v0.31.1", "0.31.x"] {
            assert_eq!(version_of(not_one), None, "{not_one}");
        }
    }
}
