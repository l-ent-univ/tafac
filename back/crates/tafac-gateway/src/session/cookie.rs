// The session's cookie: read, and written.
//
// A student's session is one encrypted cookie the browser holds: who it
// is, at which university, and the university's own cookies (the CAS
// ticket, the portal's session…). No server keeps a session: this cookie
// is all there is to start again from. The gateway writes it when it signs
// a student in (gateway/signin.rs) and reads it at every request.
//
// Node reads the same cookie for the routes that are still its own, and
// writes it again as it answers them (the portal's cookies it got since).
// So the format is the one Node reads (server/sessionCookie.js):
// `v1.<iv>.<ciphertext>.<tag>`, each part in base64url, AES-256-GCM under a
// key derived from SESSION_SECRET (HKDF-SHA256, no salt), the payload
// { id, uni, user, mode, demoState, createdAt, jar }. Two fixtures hold both
// sides to it: a cookie Node made is read here, and one made here is read by
// Node (tests/fixtures/session-cookie-v1.json, session-cookie-gateway-v1.json).
//
// When in doubt a cookie is not read (None), and Node answers: a part that
// doesn't decode, a session past its lifetime, an entry of the jar in a
// shape this file doesn't know, a secret Node has since replaced
// (SESSION_SECRET_PREVIOUS: Node reads those cookies and issues them again).

use aes_gcm::aead::{Aead, Generate, KeyInit, Payload};
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
// How long the browser keeps the cookie (SESSION_COOKIE_MAX_AGE_MS).
const MAX_AGE_SECONDS: u64 = 30 * 24 * 60 * 60;
// A browser drops a cookie past 4096 bytes, name and attributes included
// (MAX_SESSION_COOKIE_VALUE_BYTES).
const MAX_VALUE_BYTES: usize = 3800;
// A cookie of the university's longer than this isn't written
// (MAX_PERSISTED_COOKIE_VALUE_LENGTH).
const MAX_UPSTREAM_VALUE_BYTES: usize = 1024;
// `mode` of a cookie Node made for the demo account, when Node served it.
// The page serves the demo by itself now (src/demoSession.js), with no
// session: such a cookie is one from before.
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

// A session, as its cookie says it.
#[derive(Clone, Debug)]
pub struct Session {
    // The session's own id: a new one at each sign-in.
    pub id: String,
    // The university's id (universities/<id>).
    pub university: String,
    // The portal's name for the student, or the login where it has none.
    pub user: String,
    pub cookies: Vec<UpstreamCookie>,
}

impl Session {
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

// A session to write: what a sign-in made.
pub struct NewSession<'a> {
    pub university: &'a str,
    pub user: &'a str,
    // The CAS ticket: always written, whatever its size. Without it nothing
    // signs in again.
    pub ticket: &'a [UpstreamCookie],
    // The university's other cookies, the most useful first: each is
    // written while the cookie still has room for it.
    pub others: &'a [UpstreamCookie],
    // Whether the university is asked over https: its cookies then go to
    // nothing else (Node's jar holds each one's Secure flag).
    pub secure: bool,
}

pub struct Codec {
    cipher: Aes256Gcm,
}

fn base64url_length(bytes: usize) -> usize {
    (bytes * 4).div_ceil(3)
}

// packJarCookies' tuple, for one cookie.
fn packed(cookie: &UpstreamCookie, secure: bool) -> serde_json::Value {
    serde_json::json!([cookie.name, cookie.value, cookie.domain, cookie.path, u8::from(cookie.host_only), u8::from(secure), cookie.expires_at_ms])
}

// A session id as Node makes them (randomUUID): a version 4 UUID.
// A random id, as a session's (the system's random bytes): a mail's
// Content-ID, unique to it.
pub(crate) fn random_id() -> Option<String> {
    new_id()
}

fn new_id() -> Option<String> {
    let mut bytes = <[u8; 16]>::try_generate().ok()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Some(format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32]))
}

impl Codec {
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
    // lifetime, not understood, or the demo account's from before (nobody
    // signed in, as for Node).
    pub fn read(&self, value: &str, now_ms: i64) -> Option<Session> {
        let stored: Stored = serde_json::from_slice(&self.open(value)?).ok()?;
        let created_at = stored.created_at.filter(|created_at| created_at.is_finite())?;
        if now_ms as f64 - created_at > ABSOLUTE_TTL_MS || stored.id.is_empty() || stored.mode.as_deref() == Some(DEMO_MODE) {
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
        Some(Session {
            id: stored.id,
            university: stored.uni.filter(|id| !id.is_empty())?,
            user: stored.user.filter(|user| !user.is_empty())?,
            cookies,
        })
    }

    // The id a cookie's value holds, whatever else it holds (an expired
    // session's, the demo account's): what the mail routes' limit counts by
    // (Node's readSessionCookie(req)?.data?.id). None: not this server's.
    pub fn read_id(&self, value: &str) -> Option<String> {
        #[derive(Deserialize)]
        struct OnlyId {
            id: serde_json::Value,
        }
        let stored: OnlyId = serde_json::from_slice(&self.open(value)?).ok()?;
        stored.id.as_str().filter(|id| !id.is_empty()).map(str::to_string)
    }

    // A new session's cookie (its value) and the session it holds, signed in
    // at `now_ms`. None when the system gives no random bytes: no session is
    // made with an id or a nonce that could be guessed.
    pub fn write(&self, new: &NewSession<'_>, now_ms: i64) -> Option<(String, Session)> {
        let id = new_id()?;
        let (payload, kept) = Self::payload(&id, new, now_ms);
        let value = self.seal(&payload, <[u8; IV_BYTES]>::try_generate().ok()?)?;
        let session = Session { id, university: new.university.to_string(), user: new.user.to_string(), cookies: kept };
        Some((value, session))
    }

    // The payload Node reads, with as many of the university's cookies as
    // the cookie's size allows, in the order given (fitSessionPayload).
    fn payload(id: &str, new: &NewSession<'_>, now_ms: i64) -> (serde_json::Value, Vec<UpstreamCookie>) {
        let mut payload = serde_json::json!({
            "id": id, "uni": new.university, "user": new.user, "mode": null, "demoState": null, "createdAt": now_ms, "jar": [],
        });
        let mut kept = new.ticket.to_vec();
        payload["jar"] = new.ticket.iter().map(|cookie| packed(cookie, new.secure)).collect();
        for cookie in new.others.iter().filter(|cookie| cookie.value.len() <= MAX_UPSTREAM_VALUE_BYTES) {
            let Some(jar) = payload["jar"].as_array_mut() else { break };
            jar.push(packed(cookie, new.secure));
            if Self::sealed_length(&payload) <= MAX_VALUE_BYTES {
                kept.push(cookie.clone());
            } else if let Some(jar) = payload["jar"].as_array_mut() {
                jar.pop();
            }
        }
        (payload, kept)
    }

    // How long a payload's cookie is, without sealing it (encodedLength).
    fn sealed_length(payload: &serde_json::Value) -> usize {
        let plaintext = serde_json::to_vec(payload).map_or(usize::MAX / 4, |bytes| bytes.len());
        FORMAT.len() + 3 + base64url_length(IV_BYTES) + base64url_length(plaintext) + base64url_length(TAG_BYTES)
    }

    fn seal(&self, payload: &serde_json::Value, iv: [u8; IV_BYTES]) -> Option<String> {
        let nonce = Nonce::try_from(iv.as_slice()).ok()?;
        let plaintext = serde_json::to_vec(payload).ok()?;
        let sealed = self.cipher.encrypt(&nonce, Payload { msg: &plaintext, aad: ASSOCIATED_DATA }).ok()?;
        let (ciphertext, tag) = sealed.split_at(sealed.len().checked_sub(TAG_BYTES)?);
        Some([FORMAT.to_string(), URL_SAFE_NO_PAD.encode(iv), URL_SAFE_NO_PAD.encode(ciphertext), URL_SAFE_NO_PAD.encode(tag)].join("."))
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

// The Set-Cookie that gives the browser a session's cookie, as Node sets it
// (buildSessionCookieOptions): for this site only, out of the page's reach,
// thirty days. `name` says how the server runs: the production cookie only
// travels over https.
pub fn set_cookie(name: &str, value: &str) -> String {
    format!("{name}={value}; Max-Age={MAX_AGE_SECONDS}; Path=/; HttpOnly{}; SameSite=Lax", secure_attribute(name))
}

// The Set-Cookie that takes it away (Express's clearCookie).
pub fn clear_cookie(name: &str) -> String {
    format!("{name}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly{}; SameSite=Lax", secure_attribute(name))
}

fn secure_attribute(name: &str) -> &'static str {
    if name == PRODUCTION_COOKIE {
        "; Secure"
    } else {
        ""
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

// A cookie holding any payload, for the tests here and of what uses the
// crate: one Node made, or one no server would make.
#[cfg(any(test, feature = "testing"))]
pub fn seal(secret: &str, payload: &serde_json::Value) -> String {
    Codec::new(secret).seal(payload, [7_u8; IV_BYTES]).unwrap()
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
        let session = Codec::new(&fixture.secret).read(&fixture.cookie, fixture.created_at + DAY_MS).unwrap();
        assert_eq!(session.id, "3f2a9c1e-7b64-4d0f-9a51-2c8e6d7f0b13");
        assert_eq!(session.university, "univ-exemple");
        assert_eq!(session.user, "jdoe");
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
        assert!(Codec::new(&padded).read(&fixture.cookie, fixture.created_at).is_some());
    }

    #[test]
    fn another_secret_or_a_changed_cookie_reads_nothing() {
        let fixture = fixture();
        let now = fixture.created_at;
        assert!(Codec::new("another secret, as long as the first one is").read(&fixture.cookie, now).is_none());

        let reader = Codec::new(&fixture.secret);
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
        let reader = Codec::new(&fixture.secret);
        assert!(reader.read(&fixture.cookie, fixture.created_at + 30 * DAY_MS).is_some());
        assert!(reader.read(&fixture.cookie, fixture.created_at + 30 * DAY_MS + 1).is_none());
    }

    #[test]
    fn what_the_test_seals_reads_back() {
        let session = Codec::new(SECRET).read(&seal(SECRET, &payload(serde_json::json!({}))), NOW).unwrap();
        assert_eq!((session.id.as_str(), session.user.as_str()), ("one-session", "jdoe"));
        assert!(session.has_cookie("cas.exemple.test", "TGC"));
    }

    // The page serves the demo by itself: a cookie Node made for it, when
    // Node did, holds nobody's session, whatever else it says.
    #[test]
    fn a_demo_cookie_from_before_is_nobodys() {
        let demo = payload(serde_json::json!({ "mode": "demo", "user": "demo", "jar": [] }));
        assert!(Codec::new(SECRET).read(&seal(SECRET, &demo), NOW).is_none());
        let with_a_ticket = payload(serde_json::json!({ "mode": "demo" }));
        assert!(Codec::new(SECRET).read(&seal(SECRET, &with_a_ticket), NOW).is_none());
        let another_mode = payload(serde_json::json!({ "mode": "something else" }));
        assert!(Codec::new(SECRET).read(&seal(SECRET, &another_mode), NOW).is_some());
    }

    #[test]
    fn a_payload_without_what_a_session_needs_reads_nothing() {
        let reader = Codec::new(SECRET);
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
        let session = Codec::new(SECRET).read(&seal(SECRET, &payload(jar)), NOW).unwrap();
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

    fn upstream(name: &str, value: &str, domain: &str, path: &str) -> UpstreamCookie {
        UpstreamCookie { name: name.into(), value: value.into(), domain: domain.into(), path: path.into(), host_only: true, expires_at_ms: None }
    }

    #[test]
    fn a_session_written_reads_back_with_an_id_of_its_own() {
        let codec = Codec::new(SECRET);
        let cookies = [upstream("TGC", "ticket", "cas.exemple.test", "/cas"), upstream("JSESSIONID", "portal", "ent.exemple.test", "/")];
        let new = NewSession { university: "univ-exemple", user: "jdoe", ticket: &cookies[..1], others: &cookies[1..], secure: true };
        let (value, made) = codec.write(&new, NOW).unwrap();
        let read = codec.read(&value, NOW).unwrap();
        assert_eq!((read.id.as_str(), read.university.as_str(), read.user.as_str()), (made.id.as_str(), "univ-exemple", "jdoe"));
        assert_eq!(read.cookies, cookies);
        assert_eq!(made.cookies, cookies);

        // A version 4 UUID, as Node's, and never the same twice.
        let id: Vec<&str> = made.id.split('-').collect();
        assert_eq!(id.iter().map(|part| part.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
        assert!(id[2].starts_with('4') && made.id.bytes().all(|byte| byte == b'-' || byte.is_ascii_hexdigit()));
        let (other_value, other) = codec.write(&new, NOW).unwrap();
        assert_ne!(other.id, made.id);
        assert_ne!(other_value, value);
    }

    #[test]
    fn what_doesnt_fit_the_cookie_is_left_out_from_the_end() {
        let codec = Codec::new(SECRET);
        let long = "x".repeat(1000);
        // A ticket longer than any other cookie may be is written all the same.
        let ticket = [upstream("TGC", &"t".repeat(MAX_UPSTREAM_VALUE_BYTES + 100), "cas.exemple.test", "/cas")];
        let others = [
            // Longer than a cookie of the university's may be: never written.
            upstream("huge", &"x".repeat(MAX_UPSTREAM_VALUE_BYTES + 1), "ent.exemple.test", "/"),
            upstream("one", &long, "ent.exemple.test", "/"),
            upstream("two", &long, "ent.exemple.test", "/"),
            // The last still fits where the one before it didn't.
            upstream("small", "1", "ent.exemple.test", "/"),
        ];
        let (value, made) = codec.write(&NewSession { university: "univ-exemple", user: "jdoe", ticket: &ticket, others: &others, secure: true }, NOW).unwrap();
        assert!(value.len() <= MAX_VALUE_BYTES, "{}", value.len());
        assert_eq!(format!("{:?}", made.cookies), "[TGC@cas.exemple.test/cas, one@ent.exemple.test/, small@ent.exemple.test/]");
        assert_eq!(codec.read(&value, NOW).unwrap().cookies, made.cookies);
    }

    // Read by Node's own codec too (tests/sessionCookie.test.js): what is
    // written here is a session there.
    #[test]
    fn what_is_written_is_what_node_reads() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../../tests/fixtures/session-cookie-gateway-v1.json")).unwrap();
        let cookies = [
            upstream("TGC", "TGT-made-up-ticket", "cas.exemple.test", "/cas"),
            upstream("JSESSIONID", "made-up-portal-session", "ent.exemple.test", "/"),
            UpstreamCookie { host_only: false, expires_at_ms: Some(1_795_000_000_000), ..upstream("lang", "fr", "exemple.test", "/") },
        ];
        let new = NewSession { university: "univ-exemple", user: "jdoe", ticket: &cookies[..1], others: &cookies[1..], secure: true };
        let (payload, kept) = Codec::payload("5d0c8a52-1e3b-4f6a-8c97-0b2d4e6f8a1c", &new, 1_790_000_000_000);
        assert_eq!(kept, cookies);
        assert_eq!(payload, fixture["payload"]);
        assert_eq!(seal(fixture["secret"].as_str().unwrap(), &payload), fixture["cookie"].as_str().unwrap());
    }

    #[test]
    fn the_cookie_is_set_as_node_sets_it_and_cleared_as_node_clears_it() {
        let set = set_cookie(PRODUCTION_COOKIE, "v1.a.b.c");
        assert_eq!(set, "__Host-lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax");
        assert!(!clears_cookie(&set, PRODUCTION_COOKIE));
        // The development server's is plain http.
        assert_eq!(set_cookie(DEVELOPMENT_COOKIE, "v1.a.b.c"), "lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax");

        let cleared = clear_cookie(PRODUCTION_COOKIE);
        assert!(cleared.starts_with("__Host-lent_session=;") && cleared.contains("; Secure"));
        assert!(clears_cookie(&cleared, PRODUCTION_COOKIE));
        assert!(clears_cookie(&clear_cookie(DEVELOPMENT_COOKIE), DEVELOPMENT_COOKIE));
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
