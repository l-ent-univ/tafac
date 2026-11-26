// POST /__ent_auth/analytics: Tafac's own anonymous statistics, which the
// page posts and the server sends on to PostHog (server/entAuthApp.js, the
// route; server/analytics.js, what is sent; docs/ANALYTICS.md, why).
//
// Nobody needs to be signed in: the login page posts its own events. The
// browser never talks to PostHog. Node's answers, all made here:
//
//   204, nothing more (Cache-Control: no-store, no body), always: the
//       statistics are off (no POSTHOG_PROJECT_KEY), the request came from
//       another site (Sec-Fetch-Site), the batch is not one, every event of
//       it was dropped, or it was taken and is on its way to PostHog. The
//       page is never told which, and never waits for PostHog
//       (analytics/posthog.rs). The session's cookie is never touched
//   413 the body is longer than 8 kB
//
// What is sent of a batch is what the allowlist keeps (analytics/schema.rs),
// with three properties of the gateway's own, never the page's:
// `university` (the one Node sends the request to, below), `demo` (false:
// a demo session is nobody's here) for a session, and
// `$process_person_profile: false`. A session's events go under an id that
// says nothing of it: an HMAC of its id with a salt drawn at random each
// UTC day and held in this process only, so that two days can't be linked
// and nothing leads back to the student. Without a session, a random id
// for the request. An account of ANALYTICS_EXCLUDED_USERS (the instance's
// own developers) sends nothing at all.
//
// Which university: Node runs one app per university, each tagging the
// events it is sent with its id (server/universitiesApp.js). A session's
// events are its university's when Node serves it; a request without one
// goes to the university it is for (universities.rs: the one it names, an
// old address', the default one).
//
// Still Node's, as the request came (None): anything this route would read
// another way than Node, which no page sends. A session cookie the gateway
// doesn't read (one of SESSION_SECRET_PREVIOUS, one from before sessions
// named their university), a body that isn't UTF-8 or is compressed, one
// whose length isn't said, and a body that isn't JSON serde reads
// (JavaScript's JSON.parse takes a few more).
// And every request where the gateway isn't told where PostHog is
// (Gateway::sending_statistics): the apps, today.

mod posthog;
pub(crate) mod schema;

use std::collections::BTreeSet;
use std::sync::Mutex;

use chrono::{NaiveDate, Utc};
use hkdf::Hkdf;
use http::header::{CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE};
use http::HeaderMap;
use serde_json::Value;
use sha2::Sha256;

use self::posthog::PostHog;
use super::universities::Served;
use crate::gateway::{now_ms, Asked, Gateway};
use crate::session::cookie::Session;
use crate::translate;

// The longest body read (server/analyticsSchema.js:
// ANALYTICS_MAX_BODY_BYTES); a longer one is refused.
const MAX_BODY_BYTES: usize = 8 * 1024;
// PostHog's address when POSTHOG_HOST says none: its EU one.
const DEFAULT_POSTHOG_HOST: &str = "https://eu.i.posthog.com";
// How much of the HMAC names a session: 32 hexadecimal digits.
const DISTINCT_ID_LENGTH: usize = 32;
// Where Tafac's statistics go and whose are kept out, read from Node's own
// settings, and what this process holds for them (the day's salt).
pub struct Statistics {
    // None: the statistics are off, and nothing is sent.
    posthog: Option<PostHog>,
    excluded: BTreeSet<String>,
    // Which universities the Node behind serves, and which one a request
    // is for (universities.rs).
    universities: Served,
    salt: DailySalt,
}

impl Statistics {
    // `posthog_project_key`: POSTHOG_PROJECT_KEY as the Node behind is given
    // it (None where it sends nothing whatever its key, as for
    // Gateway::with_statistics). `setting`: the environment Node reads, by
    // the names it reads (POSTHOG_HOST, ANALYTICS_EXCLUDED_USERS; UNIVERSITY,
    // MULTI_UNIVERSITY, UNIVERSITIES and their former names, for which
    // universities it serves).
    pub fn read(posthog_project_key: Option<&str>, setting: impl Fn(&str) -> Option<String>) -> Self {
        let key = posthog_project_key.map(str::trim).filter(|key| !key.is_empty());
        let host = setting("POSTHOG_HOST").map(|host| host.trim().to_string()).filter(|host| !host.is_empty()).unwrap_or_else(|| DEFAULT_POSTHOG_HOST.to_string());
        let excluded = setting("ANALYTICS_EXCLUDED_USERS").unwrap_or_default().split(|character: char| character == ',' || character.is_whitespace()).map(user).filter(|user| !user.is_empty()).collect();
        // An unknown university: Node doesn't start, and neither does the
        // server (main.rs). Here, what is served without any setting.
        let universities = Served::from_environment(&setting, false).unwrap_or_else(|_| Served::from_environment(|_| None, false).expect("the default university is one of the directory's"));
        Self { posthog: key.map(|key| PostHog::new(key, &host)), excluded, universities, salt: DailySalt::default() }
    }

    // For the tests: an attempt that waits `attempt`, the next one
    // `between` after it, and as many batches on their way at once.
    #[cfg(test)]
    pub(crate) fn hurried(mut self, attempt: std::time::Duration, between: std::time::Duration, in_flight: usize) -> Self {
        if let Some(posthog) = &mut self.posthog {
            posthog.hurried(posthog::Patience { attempt, between }, in_flight);
        }
        self
    }

    // A batch, sent on: what the allowlist keeps of it, with the gateway's
    // own properties, under the session's id of the day or a random one.
    fn ingest(&self, posthog: &PostHog, payload: &Value, session: Option<&Session>, university: &str) {
        if session.is_some_and(|session| self.excluded.contains(&user(&session.user))) {
            return;
        }
        let events = schema::batch(payload, session.is_some());
        if events.is_empty() {
            return;
        }
        let now = Utc::now();
        let distinct_id = match session {
            Some(session) => self.salt.hash(&session.id, now.date_naive(), || posthog::random_bytes::<32>().map(Vec::from)),
            None => posthog::uuid_v4(),
        };
        // No random bytes from the system: nothing that could be guessed is sent.
        let Some(distinct_id) = distinct_id else { return };
        let batch = events
            .into_iter()
            .filter_map(|(name, mut properties)| {
                if session.is_some() {
                    properties.insert("demo".to_string(), false.into());
                }
                properties.insert("university".to_string(), university.into());
                properties.insert("$process_person_profile".to_string(), false.into());
                posthog::event(name, &distinct_id, properties, now)
            })
            .collect();
        posthog.send(batch, now);
    }
}

// An account as ANALYTICS_EXCLUDED_USERS names it: without the spaces
// around it, in lower case.
fn user(name: &str) -> String {
    name.trim().to_lowercase()
}

impl Gateway {
    // Has the gateway answer the statistics' route, and send them to
    // PostHog itself, as Node is set up. Without it, the route is Node's.
    pub fn sending_statistics(mut self, statistics: Statistics) -> Self {
        self.statistics_sent = Some(statistics);
        self
    }

    // The route's answer; None: Node's, as the request came. `cookie`: the
    // session's cookie, when the request has one.
    pub(crate) fn statistics_posted(&self, asked: &Asked<'_>, cookie: Option<String>) -> Option<http::Response<Vec<u8>>> {
        let statistics = self.statistics_sent.as_ref()?;
        // Off: the body isn't even read.
        let Some(posthog) = &statistics.posthog else { return Some(said(204)) };
        // Same-origin only: the browser says where a fetch or a beacon
        // comes from.
        if from_another_site(asked.headers) {
            return Some(said(204));
        }
        let text = match body(asked) {
            Body::Text(text) => text,
            Body::TooLong => return Some(said(413)),
            Body::Nodes => return None,
        };
        // A session goes to its university's app, which may still find it
        // over (signed out a moment ago): its events are then a visitor's.
        let session = match cookie {
            Some(value) => Some(self.codec.read(&value, now_ms())?),
            None => None,
        };
        let routed = session.filter(|session| statistics.universities.serves(&session.university));
        let university = match &routed {
            Some(session) => session.university.clone(),
            None => statistics.universities.for_nobody(asked.headers).to_string(),
        };
        let session = routed.filter(|session| self.memory.ended(&session.id).is_none());
        // Nothing but spaces: JSON.parse fails, and nothing is sent.
        let payload = if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).ok()? };
        statistics.ingest(posthog, &payload, session.as_ref(), &university);
        Some(said(204))
    }
}

// What Node's route says: a status, nothing else (`res.status(…).end()`).
fn said(status: u16) -> http::Response<Vec<u8>> {
    translate::answer(status).header("cache-control", "no-store").body(Vec::new()).unwrap()
}

// Sec-Fetch-Site, as Node reads it (its values joined, when there are
// several): any but same-origin. None said: a browser that doesn't say.
fn from_another_site(headers: &HeaderMap) -> bool {
    let said: Vec<&[u8]> = headers.get_all("sec-fetch-site").iter().map(|value| value.as_bytes()).collect();
    let said = said.join(&b", "[..]);
    !said.is_empty() && said != b"same-origin"
}

enum Body {
    Text(String),
    TooLong,
    // Read another way than here: Node's to read.
    Nodes,
}

// The body as express.text reads it (any type, UTF-8 unless the type says
// another charset, the byte order mark taken off): only the ones it reads
// as plain UTF-8 text are read here.
fn body(asked: &Asked<'_>) -> Body {
    let headers = asked.headers;
    // Compressed: Node inflates it.
    let mut encodings = headers.get_all(CONTENT_ENCODING).iter();
    if let Some(encoding) = encodings.next() {
        if encodings.next().is_some() || !(encoding.is_empty() || encoding.as_bytes().eq_ignore_ascii_case(b"identity")) {
            return Body::Nodes;
        }
    }
    if let Some(content_type) = headers.get(CONTENT_TYPE) {
        let Ok(content_type) = content_type.to_str() else { return Body::Nodes };
        let charset = content_type.split(';').skip(1).find_map(|parameter| {
            let (name, value) = parameter.split_once('=')?;
            name.trim().eq_ignore_ascii_case("charset").then(|| value.trim().trim_matches('"').to_ascii_lowercase())
        });
        if charset.is_some_and(|charset| charset != "utf-8" && charset != "utf8") {
            return Body::Nodes;
        }
    }
    // Its length said, and all of it here (a body without one is passed on
    // as it streams, not read).
    let Some(length) = headers.get(CONTENT_LENGTH).and_then(|length| length.to_str().ok()?.trim().parse::<u64>().ok()) else { return Body::Nodes };
    if length > MAX_BODY_BYTES as u64 {
        return Body::TooLong;
    }
    if length != asked.body.len() as u64 {
        return Body::Nodes;
    }
    let text = String::from_utf8_lossy(asked.body);
    Body::Text(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

// The salt of the day, drawn at random the first time a session's events
// are sent on a UTC day, and forgotten the next day.
#[derive(Default)]
struct DailySalt(Mutex<Option<(NaiveDate, Vec<u8>)>>);

impl DailySalt {
    // The id of `value` today: HMAC-SHA256 with the day's salt as its key,
    // in hexadecimal, its first 32 digits (createDailyHasher). HKDF's
    // extract step is that HMAC, salt as the key (RFC 5869, 2.2): the hash
    // this crate already has for the session's cookie.
    fn hash(&self, value: &str, day: NaiveDate, draw: impl FnOnce() -> Option<Vec<u8>>) -> Option<String> {
        let mut current = self.0.lock().ok()?;
        if current.as_ref().map(|(drawn_on, _)| *drawn_on) != Some(day) {
            *current = Some((day, draw()?));
        }
        let (_, salt) = current.as_ref()?;
        let (mac, _) = Hkdf::<Sha256>::extract(Some(salt), value.as_bytes());
        let hex: String = mac.iter().map(|byte| format!("{byte:02x}")).collect();
        Some(hex[..DISTINCT_ID_LENGTH].to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANALYTICS: &str = include_str!("../../../../../server/analytics.js");
    const SCHEMA: &str = include_str!("../../../../../server/analyticsSchema.js");
    const ROUTES: &str = include_str!("../../../../../server/entAuthApp.js");

    fn environment(settings: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| settings.iter().find(|(found, _)| *found == name).map(|(_, value)| value.to_string())
    }

    fn day(date: &str) -> NaiveDate {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_settings_and_limits_are_nodes() {
        assert!(ANALYTICS.contains(&format!("export const DEFAULT_POSTHOG_HOST = '{DEFAULT_POSTHOG_HOST}'")));
        assert!(ANALYTICS.contains(&format!("const DISTINCT_ID_HEX_LENGTH = {DISTINCT_ID_LENGTH}")));
        assert!(ANALYTICS.contains("const host = String(env.POSTHOG_HOST ?? '').trim() || DEFAULT_POSTHOG_HOST"));
        assert!(ANALYTICS.contains("const excludedUsers = String(env.ANALYTICS_EXCLUDED_USERS ?? '')\n    .split(/[\\s,]+/)"));
        assert!(ANALYTICS.contains("return String(user ?? '').trim().toLowerCase()"));
        assert!(ANALYTICS.contains("$process_person_profile: false,"));
        assert!(ANALYTICS.contains("...(hasSession ? { demo: Boolean(session.demo) } : null),"));
        assert!(ANALYTICS.contains("...(universityId ? { university: universityId } : null),"));
        assert!(SCHEMA.contains("export const ANALYTICS_MAX_BODY_BYTES = 8 * 1024"));
        assert_eq!(MAX_BODY_BYTES, 8 * 1024);
        // The route itself: same-origin only, 413 for a body too long, 204
        // for everything else.
        let route = ROUTES.split("app.post('/__ent_auth/analytics'").nth(1).unwrap().split("\n})\n").next().unwrap();
        assert!(route.contains("res.setHeader('Cache-Control', 'no-store')"));
        assert!(route.contains("if (fetchSite && fetchSite !== 'same-origin') {"));
        assert!(route.contains("return res.status(error.status === 413 ? 413 : 204).end()"));
        assert_eq!(route.matches("status(204).end()").count(), 3);
        assert!(ROUTES.contains("const parseAnalyticsBody = express.text({ type: () => true, limit: ANALYTICS_MAX_BODY_BYTES })"));
    }

    #[test]
    fn the_id_of_a_session_is_the_hmac_node_makes() {
        let salt = DailySalt::default();
        // Node's createHmac('sha256', 'fixed').update('session-123'), its
        // first 32 digits.
        assert_eq!(salt.hash("session-123", day("2026-10-08"), || Some(b"fixed".to_vec())).unwrap(), "37829b0c945897a6eff2517c7bb80509");
        // RFC 4231's first case, for HMAC-SHA256 itself.
        let rfc = DailySalt::default();
        assert_eq!(rfc.hash("Hi There", day("2026-10-08"), || Some(vec![0x0b; 20])).unwrap(), "b0344c61d8db38535ca8afceaf0bf12b");
    }

    #[test]
    fn the_id_of_a_session_holds_for_a_utc_day_and_changes_the_next() {
        let salt = DailySalt::default();
        let drawn = std::cell::Cell::new(0);
        let draw = || {
            drawn.set(drawn.get() + 1);
            Some(format!("salt-{}", drawn.get()).into_bytes())
        };
        let morning = salt.hash("session-a", day("2026-10-08"), draw).unwrap();
        assert_eq!(morning, "e9057cf70a1561a2dd00242e8c355a9a");
        assert_eq!(salt.hash("session-a", day("2026-10-08"), draw).unwrap(), morning);
        assert_ne!(salt.hash("session-b", day("2026-10-08"), draw).unwrap(), morning);
        assert_eq!(drawn.get(), 1);
        let next_day = salt.hash("session-a", day("2026-10-09"), draw).unwrap();
        assert_ne!(next_day, morning);
        assert_eq!(drawn.get(), 2);
        assert!(morning.len() == 32 && morning.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
        // Drawn at random: two processes never give the same id.
        let random = || posthog::random_bytes::<32>().map(Vec::from);
        assert_ne!(DailySalt::default().hash("session-a", day("2026-10-08"), random), DailySalt::default().hash("session-a", day("2026-10-08"), random));
        // No random bytes, no id.
        assert_eq!(DailySalt::default().hash("session-a", day("2026-10-08"), || None), None);
    }

    #[test]
    fn the_excluded_accounts_are_read_as_node_reads_them() {
        let statistics = Statistics::read(Some("phc_made_up"), environment(&[("ANALYTICS_EXCLUDED_USERS", " Dev1, dev2  dev3,\n\tDEV4")]));
        assert_eq!(statistics.excluded.into_iter().collect::<Vec<_>>(), ["dev1", "dev2", "dev3", "dev4"]);
        assert!(Statistics::read(None, environment(&[])).posthog.is_none());
        assert!(Statistics::read(Some("  "), environment(&[])).posthog.is_none());
        assert!(Statistics::read(Some(" phc_made_up "), environment(&[])).posthog.is_some());
    }
}
