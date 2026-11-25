// Node's session cookie, read for tonAPI.
//
// The Node server keeps a student's session in one encrypted cookie
// (server/sessionCookie.js): who it is, at which university, and the
// university's own cookies (the CAS ticket, the portal's session…). This
// reads it, so tonAPI asks the university with those very cookies: one
// sign-in, one set of university cookies. Read only: Node alone writes that
// cookie, and nothing of tonAPI's side is kept beside it.
//
// The format is Node's: `v1.<iv>.<ciphertext>.<tag>`, each part in
// base64url, AES-256-GCM under a key derived from SESSION_SECRET
// (HKDF-SHA256, no salt). A cookie Node made is read by both sides' tests
// (tests/fixtures/session-cookie-v1.json): a change of format there fails
// here.
//
// When in doubt the cookie is not read (None), and Node answers: a part
// that doesn't decode, a session past its lifetime, an entry of the jar in a
// shape this file doesn't know, a secret Node has since replaced
// (SESSION_SECRET_PREVIOUS: Node reads those cookies and issues them again).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use hkdf::Hkdf;
use serde::Deserialize;
use sha2::Sha256;

// The cookie's name (getSessionCookieName): server.js's, on tafac.fr and in
// the apps, and the development server's (`npm run dev`).
pub const PRODUCTION_COOKIE: &str = "__Host-lent_session";
pub const DEVELOPMENT_COOKIE: &str = "lent_session";

const FORMAT: &str = "v1";
const HKDF_INFO: &[u8] = b"l-ent session cookie v1";
const ASSOCIATED_DATA: &[u8] = b"l-ent session v1";
const KEY_BYTES: usize = 32;
const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;
// A session older than this is gone, whatever its cookie's own expiry says
// (SESSION_ABSOLUTE_TTL_MS).
const ABSOLUTE_TTL_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const DEMO_MODE: &str = "demo";

// One of the university's cookies, as Node's jar holds it
// (server/cookieJar/cookie.ts).
#[derive(Clone, PartialEq)]
pub struct UpstreamCookie {
    pub name: String,
    pub value: String,
    // The host that set it, or its Domain attribute (no leading dot).
    pub domain: String,
    pub path: String,
    // No Domain attribute: for that host only, not its subdomains.
    pub host_only: bool,
    // Milliseconds since the epoch; None: for the session.
    pub expires_at_ms: Option<i64>,
}

// Never the value, even in a debug print.
impl std::fmt::Debug for UpstreamCookie {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}@{}{}", self.name, self.domain, self.path)
    }
}

impl UpstreamCookie {
    // Whether it is one of `host`'s cookies (cookieMatchesHost).
    pub fn is_for(&self, host: &str) -> bool {
        if self.host_only {
            return self.domain == host;
        }
        host == self.domain || host.ends_with(&format!(".{}", self.domain))
    }

    // Whether a request to `path` on `host` carries it: the cookie's path is
    // the request's, or a folder above it (pathMatches).
    pub fn is_sent_to(&self, host: &str, path: &str) -> bool {
        let below = path.strip_prefix(self.path.as_str()).is_some_and(|rest| self.path.ends_with('/') || rest.starts_with('/'));
        self.is_for(host) && (path == self.path || below)
    }
}

#[derive(Debug)]
pub struct NodeSession {
    // The session's own id: a new one at each sign-in.
    pub id: String,
    // The university's id (universities/<id>).
    pub university: String,
    // The portal's name for the student, or the login where it has none.
    pub user: String,
    // The demo account's: it never reaches a university.
    pub demo: bool,
    pub cookies: Vec<UpstreamCookie>,
}

impl NodeSession {
    pub fn has_cookie(&self, host: &str, name: &str) -> bool {
        self.cookies.iter().any(|cookie| cookie.name == name && cookie.is_for(host))
    }
}

#[derive(Deserialize)]
struct Stored {
    id: String,
    #[serde(default)]
    uni: Option<String>,
    #[serde(default)]
    user: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default, rename = "createdAt")]
    created_at: Option<f64>,
    #[serde(default)]
    jar: Vec<StoredCookie>,
}

// packJarCookies' tuple: name, value, domain, path, host only, secure,
// expiry. The two flags are 0 or 1.
#[derive(Deserialize)]
struct StoredCookie(String, String, String, Option<String>, serde_json::Value, serde_json::Value, Option<f64>);

fn is_set(flag: &serde_json::Value) -> bool {
    match flag {
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        _ => false,
    }
}

pub struct Reader {
    cipher: Aes256Gcm,
}

impl Reader {
    // `secret`: SESSION_SECRET, as Node is given it.
    pub fn new(secret: &str) -> Self {
        let mut key = [0_u8; KEY_BYTES];
        Hkdf::<Sha256>::new(None, secret.trim().as_bytes())
            .expand(HKDF_INFO, &mut key)
            .expect("32 bytes are within HKDF-SHA256's output");
        Self { cipher: Aes256Gcm::new_from_slice(&key).expect("the key is 32 bytes") }
    }

    // The session a cookie's value holds, at `now_ms` (milliseconds since
    // the epoch). None: not one of this server's, tampered with, past its
    // lifetime, or not understood.
    pub fn read(&self, value: &str, now_ms: i64) -> Option<NodeSession> {
        let stored: Stored = serde_json::from_slice(&self.open(value)?).ok()?;
        let created_at = stored.created_at.filter(|created_at| created_at.is_finite())?;
        if now_ms as f64 - created_at > ABSOLUTE_TTL_MS || stored.id.is_empty() {
            return None;
        }
        let cookies = stored
            .jar
            .into_iter()
            .filter(|cookie| cookie.6.map_or(true, |expiry| expiry > now_ms as f64))
            .map(|StoredCookie(name, value, domain, path, host_only, _secure, expires_at)| UpstreamCookie {
                name,
                value,
                domain,
                path: path.filter(|path| !path.is_empty()).unwrap_or_else(|| "/".to_string()),
                host_only: is_set(&host_only),
                expires_at_ms: expires_at.filter(|expiry| expiry.is_finite()).map(|expiry| expiry as i64),
            })
            .collect();
        Some(NodeSession {
            id: stored.id,
            university: stored.uni.filter(|id| !id.is_empty())?,
            user: stored.user.filter(|user| !user.is_empty())?,
            demo: stored.mode.as_deref() == Some(DEMO_MODE),
            cookies,
        })
    }

    fn open(&self, value: &str) -> Option<Vec<u8>> {
        let mut parts = value.split('.');
        let (Some(FORMAT), Some(iv), Some(ciphertext), Some(tag), None) =
            (parts.next(), parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        let iv = URL_SAFE_NO_PAD.decode(iv).ok().filter(|iv| iv.len() == IV_BYTES)?;
        let tag = URL_SAFE_NO_PAD.decode(tag).ok().filter(|tag| tag.len() == TAG_BYTES)?;
        // The cipher takes the tag after the ciphertext.
        let mut sealed = URL_SAFE_NO_PAD.decode(ciphertext).ok()?;
        sealed.extend_from_slice(&tag);
        let nonce = Nonce::try_from(iv.as_slice()).ok()?;
        self.cipher.decrypt(&nonce, Payload { msg: &sealed, aad: ASSOCIATED_DATA }).ok()
    }
}

// The session cookie's value in a request's Cookie header.
pub fn cookie_in_header<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header.split(';').find_map(|pair| {
        let (found, value) = pair.trim().split_once('=')?;
        (found == name && !value.is_empty()).then_some(value)
    })
}

// Whether a Set-Cookie header takes that cookie away: no value, Max-Age=0
// or a date in 1970, as Node's clearCookie writes it.
pub fn clears_cookie(set_cookie: &str, name: &str) -> bool {
    let mut parts = set_cookie.split(';');
    let Some((found, value)) = parts.next().and_then(|pair| pair.trim().split_once('=')) else { return false };
    if found != name {
        return false;
    }
    value.is_empty()
        || parts.any(|attribute| {
            let attribute = attribute.trim().to_ascii_lowercase();
            attribute == "max-age=0" || (attribute.starts_with("expires=") && attribute.contains(" 1970 "))
        })
}

// A cookie as Node would write it, for the tests here and of what uses the
// crate: nothing else ever writes one.
#[cfg(any(test, feature = "testing"))]
pub fn seal(secret: &str, payload: &serde_json::Value) -> String {
    let reader = Reader::new(secret);
    let iv = [7_u8; IV_BYTES];
    let nonce = Nonce::try_from(iv.as_slice()).unwrap();
    let plaintext = serde_json::to_vec(payload).unwrap();
    let sealed = reader.cipher.encrypt(&nonce, Payload { msg: &plaintext, aad: ASSOCIATED_DATA }).unwrap();
    let (ciphertext, tag) = sealed.split_at(sealed.len() - TAG_BYTES);
    [FORMAT.to_string(), URL_SAFE_NO_PAD.encode(iv), URL_SAFE_NO_PAD.encode(ciphertext), URL_SAFE_NO_PAD.encode(tag)].join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made by Node's own codec (tests/sessionCookie.test.js reads it too).
    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/session-cookie-v1.json");
    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    struct Fixture {
        secret: String,
        cookie: String,
        created_at: i64,
    }

    fn fixture() -> Fixture {
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        Fixture {
            secret: fixture["secret"].as_str().unwrap().to_string(),
            cookie: fixture["cookie"].as_str().unwrap().to_string(),
            created_at: fixture["payload"]["createdAt"].as_i64().unwrap(),
        }
    }

    fn payload(overrides: serde_json::Value) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "id": "one-session",
            "uni": "univ-exemple",
            "user": "jdoe",
            "mode": null,
            "demoState": null,
            "createdAt": 1_790_000_000_000_i64,
            "jar": [["TGC", "ticket", "cas.exemple.test", "/cas", 1, 1, null]],
        });
        for (name, value) in overrides.as_object().unwrap() {
            payload[name] = value.clone();
        }
        payload
    }

    const SECRET: &str = "a secret of the tests, long enough to be one";
    const NOW: i64 = 1_790_000_000_000 + DAY_MS;

    #[test]
    fn nodes_cookie_is_read() {
        let fixture = fixture();
        let session = Reader::new(&fixture.secret).read(&fixture.cookie, fixture.created_at + DAY_MS).unwrap();
        assert_eq!(session.id, "3f2a9c1e-7b64-4d0f-9a51-2c8e6d7f0b13");
        assert_eq!(session.university, "univ-exemple");
        assert_eq!(session.user, "jdoe");
        assert!(!session.demo);
        assert_eq!(format!("{:?}", session.cookies), "[TGC@cas.exemple.test/cas, JSESSIONID@ent.exemple.test/, lang@exemple.test/]");
        let ticket = &session.cookies[0];
        assert_eq!((ticket.value.as_str(), ticket.host_only, ticket.expires_at_ms), ("TGT-made-up-ticket", true, None));
        let language = &session.cookies[2];
        assert_eq!((language.host_only, language.expires_at_ms), (false, Some(1_795_000_000_000)));
    }

    #[test]
    fn a_secret_with_spaces_around_it_is_nodes_trimmed_one() {
        let fixture = fixture();
        let padded = format!("  {}\n", fixture.secret);
        assert!(Reader::new(&padded).read(&fixture.cookie, fixture.created_at).is_some());
    }

    #[test]
    fn another_secret_or_a_changed_cookie_reads_nothing() {
        let fixture = fixture();
        let now = fixture.created_at;
        assert!(Reader::new("another secret, as long as the first one is").read(&fixture.cookie, now).is_none());

        let reader = Reader::new(&fixture.secret);
        let parts: Vec<&str> = fixture.cookie.split('.').collect();
        let flipped = |part: &str| {
            let first = if part.starts_with('A') { "B" } else { "A" };
            format!("{first}{}", &part[1..])
        };
        for changed in 1..4 {
            let mut tampered: Vec<String> = parts.iter().map(|part| part.to_string()).collect();
            tampered[changed] = flipped(parts[changed]);
            assert!(reader.read(&tampered.join("."), now).is_none(), "part {changed}");
        }
        assert!(reader.read(&fixture.cookie.replacen("v1.", "v2.", 1), now).is_none());
        assert!(reader.read(&format!("{}.extra", fixture.cookie), now).is_none());
        assert!(reader.read("", now).is_none());
        assert!(reader.read("v1...", now).is_none());
    }

    #[test]
    fn a_session_past_thirty_days_is_gone() {
        let fixture = fixture();
        let reader = Reader::new(&fixture.secret);
        assert!(reader.read(&fixture.cookie, fixture.created_at + 30 * DAY_MS).is_some());
        assert!(reader.read(&fixture.cookie, fixture.created_at + 30 * DAY_MS + 1).is_none());
    }

    #[test]
    fn what_the_test_seals_reads_back() {
        let session = Reader::new(SECRET).read(&seal(SECRET, &payload(serde_json::json!({}))), NOW).unwrap();
        assert_eq!((session.id.as_str(), session.user.as_str(), session.demo), ("one-session", "jdoe", false));
        assert!(session.has_cookie("cas.exemple.test", "TGC"));
    }

    #[test]
    fn the_demo_account_is_told_apart() {
        let demo = payload(serde_json::json!({ "mode": "demo", "user": "demo", "jar": [] }));
        assert!(Reader::new(SECRET).read(&seal(SECRET, &demo), NOW).unwrap().demo);
    }

    #[test]
    fn a_payload_without_what_a_session_needs_reads_nothing() {
        let reader = Reader::new(SECRET);
        for missing in [
            serde_json::json!({ "uni": null }),
            serde_json::json!({ "user": null }),
            serde_json::json!({ "user": "" }),
            serde_json::json!({ "id": "" }),
            serde_json::json!({ "createdAt": null }),
            serde_json::json!({ "createdAt": "yesterday" }),
            // The jar's older shape ([key, cookie] pairs): left to Node.
            serde_json::json!({ "jar": [["cas.exemple.test|/cas|TGC", { "name": "TGC", "value": "ticket" }]] }),
        ] {
            assert!(reader.read(&seal(SECRET, &payload(missing.clone())), NOW).is_none(), "{missing}");
        }
    }

    #[test]
    fn expired_cookies_of_the_jar_are_left_out() {
        let jar = serde_json::json!({ "jar": [
            ["old", "1", "ent.exemple.test", "/", 1, 1, NOW - 1],
            ["kept", "1", "ent.exemple.test", "", 1, 1, NOW + 1],
        ] });
        let session = Reader::new(SECRET).read(&seal(SECRET, &payload(jar)), NOW).unwrap();
        // An empty path is the root, as Node reads it.
        assert_eq!(format!("{:?}", session.cookies), "[kept@ent.exemple.test/]");
    }

    fn cookie(domain: &str, path: &str, host_only: bool) -> UpstreamCookie {
        UpstreamCookie { name: "n".into(), value: "v".into(), domain: domain.into(), path: path.into(), host_only, expires_at_ms: None }
    }

    #[test]
    fn a_cookie_goes_to_its_host_or_its_domain() {
        assert!(cookie("ent.exemple.test", "/", true).is_for("ent.exemple.test"));
        assert!(!cookie("exemple.test", "/", true).is_for("ent.exemple.test"));
        assert!(cookie("exemple.test", "/", false).is_for("ent.exemple.test"));
        assert!(cookie("exemple.test", "/", false).is_for("exemple.test"));
        assert!(!cookie("exemple.test", "/", false).is_for("autre-exemple.test"));
    }

    #[test]
    fn a_cookie_goes_to_its_path_and_below() {
        let host = "cas.exemple.test";
        assert!(cookie(host, "/", true).is_sent_to(host, "/cas/login"));
        assert!(cookie(host, "/cas", true).is_sent_to(host, "/cas"));
        assert!(cookie(host, "/cas", true).is_sent_to(host, "/cas/login"));
        assert!(cookie(host, "/cas/", true).is_sent_to(host, "/cas/login"));
        assert!(!cookie(host, "/cas", true).is_sent_to(host, "/casino"));
        assert!(!cookie(host, "/cas/login", true).is_sent_to(host, "/cas"));
        assert!(!cookie(host, "/", true).is_sent_to("ent.exemple.test", "/cas/login"));
    }

    #[test]
    fn the_session_cookie_is_found_in_a_cookie_header() {
        let header = "theme=dark; __Host-lent_session=v1.a.b.c; other=1";
        assert_eq!(cookie_in_header(header, PRODUCTION_COOKIE), Some("v1.a.b.c"));
        assert_eq!(cookie_in_header(header, DEVELOPMENT_COOKIE), None);
        assert_eq!(cookie_in_header("lent_session=", DEVELOPMENT_COOKIE), None);
        assert_eq!(cookie_in_header("", DEVELOPMENT_COOKIE), None);
    }

    #[test]
    fn a_cleared_session_cookie_is_told_from_one_set_again() {
        let name = PRODUCTION_COOKIE;
        // Express's clearCookie, and a cookie emptied with Max-Age.
        assert!(clears_cookie("__Host-lent_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax", name));
        assert!(clears_cookie("__Host-lent_session=; Path=/; Max-Age=0", name));
        assert!(clears_cookie("__Host-lent_session=x; Max-Age=0; Path=/", name));
        assert!(!clears_cookie("__Host-lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax", name));
        assert!(!clears_cookie("other=; Max-Age=0", name));
        assert!(!clears_cookie("nonsense", name));
    }
}
