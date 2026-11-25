// The app's own cookie jar for its local server's cookies (the encrypted
// session cookie, lent_session).
//
// The window is on the tafac:// scheme, and WebKit (macOS) does not keep
// cookies that a custom scheme's responses set. So the bridge keeps them:
// it takes Set-Cookie off each response and sends them back as Cookie on the
// next request. The page never sees them (not even through document.cookie).
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

impl CookieJar {
    pub fn load(path: PathBuf) -> Self {
        let cookies = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, cookies: Mutex::new(cookies) }
    }

    // The Cookie header for the next request, without the expired ones.
    pub fn header(&self) -> Option<String> {
        let mut cookies = self.cookies.lock().unwrap();
        let current = now();
        cookies.retain(|_, cookie| cookie.expires_at.map_or(true, |expiry| expiry > current));
        if cookies.is_empty() {
            return None;
        }
        Some(
            cookies
                .iter()
                .map(|(name, cookie)| format!("{name}={}", cookie.value))
                .collect::<Vec<_>>()
                .join("; "),
        )
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
