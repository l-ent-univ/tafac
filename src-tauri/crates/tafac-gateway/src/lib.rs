// Tafac's gateway: the routes tonAPI answers, in front of the Node server.
//
// The page asks /__ent_auth/* and /__ent_proxy/*. The Node server
// (server.js) answers them all in JavaScript; tonAPI
// (github.com/l-ent-univ/tonAPI, in Rust: one provider per software, one
// settings file per university) takes them over a route at a time. This
// crate is where a route moves, once, for every place Tafac runs:
//
//   routes.rs        the one table: each route, tonAPI's or Node's
//   translate/       one translator per moved route: tonAPI's answer as the
//                    page gets it from Node, JSON and status
//   session_link.rs  tonAPI asks with the cookies of Node's session: one
//                    sign-in, one set of university cookies
//   universities.rs  tonAPI's settings, from the tonAPI the crate is built
//                    with (build.rs): nothing of tonAPI is copied here
//
//   the apps         call Gateway::answer from their bridge, in the app
//                    itself (src-tauri/src/bridge.rs), then ask Node
//   tafac.fr         runs the binary in front of Node (proxy.rs, main.rs):
//                    it answers the same way and passes everything else on
//
// The page doesn't change: /__ent_auth/* stays the only contract.
//
// The rule, on every side: an answer comes from here only when it is the
// one Node would give. Anything else is None, and the request goes to Node
// as it came: another university, the demo account, no session, a portal
// that no longer knows the session, an error, a slow answer. So every
// refusal, expiry and sign-out is still Node's own (server/sessionExpiry).
//
// The portal's session is shared with Node, which lists the applications
// with it (/__ent_proxy) and opens a new one only when it answers
// /__ent_auth/session itself. So tonAPI is handed the portal's cookies and
// none the CAS would get, its ticket least of all: it asks with the session
// there is and cannot open another, which Node wouldn't have. A portal that
// no longer knows the session is Node's to sign in to again.

pub mod routes;
pub mod session_link;
pub mod translate;
mod universities;

#[cfg(feature = "server")]
pub mod proxy;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::FutureExt;
use http::{HeaderMap, Method};
use tonapi_core::Profile;
use tonapi_providers::{Context, NetSettings};
use tonapi_session::{SessionData, StoredCookie};

use crate::routes::Moved;
use crate::session_link::{NodeSession, UpstreamCookie};
use crate::translate::{Translated, Unanswered};
use crate::universities::University;

pub use crate::translate::ANSWERED_BY;
pub use crate::universities::TONAPI_COMMIT;

// How a request without a session names its university to Node
// (server/universitiesApp.js).
pub const UNIVERSITY_HEADER: &str = "x-tafac-university";
// The session check, which Node also answers without a session.
pub const SESSION_PATH: &str = "/__ent_auth/session";
const LOGOUT_PATH: &str = "/__ent_auth/logout";
// Node's word, on any answer, for a session that is gone (server/sessionExpiry).
const SESSION_HEADER: &str = "x-tafac-session";
const SESSION_EXPIRED: &str = "expired";

// The CAS's ticket-granting cookie: Node calls a session without it
// degraded, and says so itself.
const CAS_TICKET: &str = "TGC";
// How long the university is waited for before Node is asked instead.
const PATIENCE: Duration = Duration::from_secs(6);
// How long the profile a session check read stands for the account asked
// after it: the page asks one, then the other.
const PROFILE_KEPT: Duration = Duration::from_secs(30);
// How long the check an app makes as it starts stands for its page's first
// one: the time Node and the page take to start, with room.
const EARLY_KEPT: Duration = Duration::from_secs(20);
// How long what Node says of itself is taken as said: it changes only when
// Node starts again, which on a server the gateway doesn't see.
const NODE_FACTS_KEPT: Duration = Duration::from_secs(5 * 60);
// How long a session seen ended is remembered, as Node does
// (ENDED_KEPT_MS): past any request still on its way with its cookie.
const ENDED_KEPT: Duration = Duration::from_secs(60 * 60);
// Students whose profile or ended session is remembered at once (tafac.fr
// serves many; an app, one).
const REMEMBERED: usize = 10_000;
// tonAPI's session wants an end; this one lives for one request.
const SESSION_SECONDS: i64 = 60;

// What only Node knows of itself, read from its own answer.
#[derive(Clone, Copy, Debug, PartialEq)]
struct NodeFacts {
    analytics_enabled: bool,
}

struct KeptProfile {
    at: Instant,
    profile: Profile,
}

// The session check an app made as it started.
struct EarlyCheck {
    session: String,
    // The portal cookies it was made with: the session's, at that moment.
    sent: Vec<StoredCookie>,
    at: Instant,
    profile: Result<Profile, Unanswered>,
}

pub struct Gateway {
    universities: BTreeMap<String, University>,
    cookie_name: String,
    reader: session_link::Reader,
    net: NetSettings,
    // Says every request left to Node, not only the unexpected ones.
    verbose: bool,
    // By university, and when it was said.
    node_facts: Mutex<HashMap<String, (NodeFacts, Instant)>>,
    // By session: the last session check's profile.
    profiles: Mutex<HashMap<String, KeptProfile>>,
    // The check an app makes as it starts, until its page's first one takes
    // it. Locked while it is made: the page's question, if it comes before
    // the portal's answer, waits for it rather than ask a second time.
    early: tokio::sync::Mutex<Option<EarlyCheck>>,
    // The sessions seen ended (signed out, expired), and when.
    ended: Mutex<HashMap<String, Instant>>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0)
}

impl Gateway {
    // `session_secret`: Node's SESSION_SECRET. `cookie_name`: its session
    // cookie's (session_link's PRODUCTION_COOKIE or DEVELOPMENT_COOKIE, as
    // Node runs).
    pub fn new(session_secret: &str, cookie_name: &str) -> Self {
        Self::with(universities::served(), session_secret, cookie_name, NetSettings::default())
    }

    fn with(universities: BTreeMap<String, University>, session_secret: &str, cookie_name: &str, net: NetSettings) -> Self {
        Self {
            universities,
            cookie_name: cookie_name.to_string(),
            reader: session_link::Reader::new(session_secret),
            net,
            verbose: std::env::var_os("TAFAC_LOG_REQUESTS").is_some(),
            node_facts: Mutex::new(HashMap::new()),
            profiles: Mutex::new(HashMap::new()),
            early: tokio::sync::Mutex::new(None),
            ended: Mutex::new(HashMap::new()),
        }
    }

    // For the tests: the universities given, asked without TLS.
    #[cfg(any(test, feature = "testing"))]
    pub fn for_tests(universities: Vec<tonapi_config::ResolvedUniversity>, session_secret: &str, cookie_name: &str) -> Self {
        let universities =
            universities.into_iter().filter_map(|settings| Some((settings.university.id.clone(), University::of(settings)?))).collect();
        Self::with(universities, session_secret, cookie_name, NetSettings { https_only: false })
    }

    pub fn cookie_name(&self) -> &str {
        &self.cookie_name
    }

    // The ids of the universities whose moved routes are answered here.
    pub fn universities(&self) -> Vec<&str> {
        self.universities.keys().map(String::as_str).collect()
    }

    // The answer to a request, when its route has moved (routes.rs) and
    // tonAPI has Node's own answer for it. None: Node's to give.
    //
    // `cookie`: the value of Node's session cookie as it is now (asked
    // again before answering: the session may have ended meanwhile).
    // `ask_node`: Node's answer to a session check without a session, for a
    // university (its body), to read what Node says of itself.
    pub async fn answer<C, F, Fut>(&self, method: &Method, path: &str, cookie: C, ask_node: F) -> Option<http::Response<Vec<u8>>>
    where
        C: Fn() -> Option<String>,
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        let route = routes::moved_route(method, path)?;
        let (session, university) = self.signed_in(cookie().as_deref())?;
        let sent = portal_cookies(university, &session);

        let translated = match route {
            Moved::Session => {
                // The check made as the app started, if it was about this
                // very session a moment ago; taken once.
                let early = self.early.lock().await.take();
                let early = early.filter(|check| check.session == session.id && check.sent == sent && check.at.elapsed() < EARLY_KEPT);
                let profile = async {
                    match early {
                        Some(check) => check.profile,
                        None => self.read_profile(university, &session, &sent).await,
                    }
                };
                let (profile, facts) = tokio::join!(profile, self.node_facts(&session.university, ask_node));
                match facts {
                    Some(facts) => {
                        if let Ok(profile) = &profile {
                            self.keep_profile(&session.id, profile);
                        }
                        translate::session::translate(profile.as_ref().map_err(|why| *why), &session, university, facts.analytics_enabled)
                    }
                    None => Translated::Node("Node didn't say what it is set up for".to_string()),
                }
            }
            Moved::Account => {
                let profile = match self.kept_profile(&session.id) {
                    Some(profile) => Ok(profile),
                    None => self.read_profile(university, &session, &sent).await,
                };
                translate::account::translate(profile.as_ref().map_err(|why| *why), &session)
            }
        };

        match translated {
            // Signed out, or in again, while the university was asked: the
            // session this answer is about is no longer the one there is.
            Translated::Answer(response) => {
                let still = self.signed_in(cookie().as_deref()).is_some_and(|(current, _)| current.id == session.id);
                still.then_some(response)
            }
            Translated::Node(why) => {
                self.left_to_node(&why);
                None
            }
        }
    }

    // As an app starts: the session check its page is about to ask for,
    // made while Node and the page start, and what Node says of itself
    // (`ask_node`, as answer's: it waits for Node to be up). Nothing when
    // nobody is signed in. Not for a server: it has no start a student
    // waits for.
    pub async fn check_early<F, Fut>(&self, cookie: Option<&str>, ask_node: F)
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        let Some((session, university)) = self.signed_in(cookie) else { return };
        {
            let mut early = self.early.lock().await;
            let sent = portal_cookies(university, &session);
            let profile = self.read_profile(university, &session, &sent).await;
            if let Err(why) = &profile {
                self.left_to_node(&why.to_string());
            }
            *early = Some(EarlyCheck { session: session.id.clone(), sent, at: Instant::now(), profile });
        }
        let _ = self.node_facts(&session.university, ask_node).await;
    }

    // A request on its way to Node: a sign-out ends its session here too,
    // for any other request still on its way with the same cookie.
    pub fn saw_request(&self, method: &Method, path: &str, cookie: Option<&str>) {
        if method == Method::POST && path == LOGOUT_PATH {
            self.end(cookie);
        }
    }

    // Node's answer to a request that came with `cookie`: when it says the
    // session is gone (its header, or the cookie cleared), it is gone here.
    pub fn saw_response(&self, cookie: Option<&str>, headers: &HeaderMap) {
        let expired = headers.get(SESSION_HEADER).is_some_and(|value| value == SESSION_EXPIRED);
        let cleared = headers
            .get_all(http::header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .any(|value| session_link::clears_cookie(value, &self.cookie_name));
        if expired || cleared {
            self.end(cookie);
        }
    }

    fn end(&self, cookie: Option<&str>) {
        let Some(session) = cookie.and_then(|cookie| self.reader.read(cookie, now_ms())) else { return };
        let mut ended = self.ended.lock().unwrap();
        ended.retain(|_, at| at.elapsed() < ENDED_KEPT);
        if ended.len() >= REMEMBERED {
            ended.clear();
        }
        ended.insert(session.id, Instant::now());
    }

    // The session a cookie holds and its university, when it is one
    // answered from here: a real account's, at one of the universities of
    // routes.rs, with its CAS ticket, and not seen ended.
    fn signed_in(&self, cookie: Option<&str>) -> Option<(NodeSession, &University)> {
        let session = self.reader.read(cookie?, now_ms())?;
        let university = self.universities.get(&session.university)?;
        if session.demo || !session.has_cookie(&university.cas_host, CAS_TICKET) {
            return None;
        }
        let ended = self.ended.lock().unwrap().get(&session.id).is_some_and(|at| at.elapsed() < ENDED_KEPT);
        (!ended).then_some((session, university))
    }

    // The student's profile, asked of the portal with the session's own
    // portal cookies (`sent`).
    async fn read_profile(&self, university: &University, session: &NodeSession, sent: &[StoredCookie]) -> Result<Profile, Unanswered> {
        if sent.is_empty() {
            return Err(Unanswered::NoPortalSession);
        }
        let now = chrono::Utc::now();
        let mut data = SessionData {
            university: session.university.clone(),
            username: session.user.clone(),
            establishment: tonapi_providers::pick_establishment(&university.settings, None).map_err(|problem| Unanswered::Problem(problem.code))?,
            cookies: sent.to_vec(),
            tokens: BTreeMap::new(),
            pending: false,
            issued_at: now.timestamp(),
            expires_at: now.timestamp() + SESSION_SECONDS,
        };
        let mut context = Context { university: &university.settings, session: &mut data, now, net: self.net };
        let asked = std::panic::AssertUnwindSafe(tokio::time::timeout(PATIENCE, tonapi_providers::profile(&mut context)));
        let profile = match asked.catch_unwind().await {
            Ok(Ok(Ok(fetched))) => fetched.data,
            Ok(Ok(Err(problem))) => return Err(Unanswered::Problem(problem.code)),
            Ok(Err(_)) => return Err(Unanswered::Slow),
            Err(_) => return Err(Unanswered::Failed),
        };
        if !still_held(sent, &data.cookies) {
            return Err(Unanswered::CookiesChanged);
        }
        Ok(profile)
    }

    async fn node_facts<F, Fut>(&self, university: &str, ask_node: F) -> Option<NodeFacts>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        if let Some((facts, said)) = self.node_facts.lock().unwrap().get(university) {
            if said.elapsed() < NODE_FACTS_KEPT {
                return Some(*facts);
            }
        }
        let facts = read_node_facts(university, &ask_node(university.to_string()).await?)?;
        self.node_facts.lock().unwrap().insert(university.to_string(), (facts, Instant::now()));
        Some(facts)
    }

    fn keep_profile(&self, session: &str, profile: &Profile) {
        let mut profiles = self.profiles.lock().unwrap();
        profiles.retain(|_, kept| kept.at.elapsed() < PROFILE_KEPT);
        if profiles.len() >= REMEMBERED {
            profiles.clear();
        }
        profiles.insert(session.to_string(), KeptProfile { at: Instant::now(), profile: profile.clone() });
    }

    fn kept_profile(&self, session: &str) -> Option<Profile> {
        let profiles = self.profiles.lock().unwrap();
        let kept = profiles.get(session).filter(|kept| kept.at.elapsed() < PROFILE_KEPT)?;
        Some(kept.profile.clone())
    }

    // Why a request this crate could have answered went to Node: tonAPI's
    // error code or words of this crate, never anything of the account. A
    // portal session that lapsed is the ordinary case, said only when asked
    // (TAFAC_LOG_REQUESTS); anything else is worth a line.
    fn left_to_node(&self, why: &str) {
        let ordinary = why == tonapi_core::ErrorCode::SessionExpired.as_str() || why == Unanswered::NoPortalSession.to_string();
        if self.verbose || !ordinary {
            eprintln!("[tafac] tonapi: left to Node ({why})");
        }
    }
}

// What of a session tonAPI is handed: the portal's cookies, less any the CAS
// would get as well (one host for both, a cookie of the whole domain).
fn portal_cookies(university: &University, session: &NodeSession) -> Vec<StoredCookie> {
    session
        .cookies
        .iter()
        .filter(|cookie| cookie.is_for(&university.portal_host))
        .filter(|cookie| !cookie.is_sent_to(&university.cas_host, &university.cas_login_path))
        .map(stored_cookie)
        .collect()
}

fn stored_cookie(cookie: &UpstreamCookie) -> StoredCookie {
    StoredCookie {
        domain: cookie.domain.clone(),
        path: cookie.path.clone(),
        name: cookie.name.clone(),
        value: cookie.value.clone(),
        host_only: cookie.host_only,
        expires: cookie.expires_at_ms.map(|expiry| expiry / 1000),
    }
}

// Whether every cookie sent is still there with its value. One more is
// nothing: Node gets its own when it asks.
fn still_held(sent: &[StoredCookie], after: &[StoredCookie]) -> bool {
    sent.iter().all(|cookie| {
        after.iter().any(|other| {
            other.name == cookie.name && other.domain == cookie.domain && other.path == cookie.path && other.value == cookie.value
        })
    })
}

// From Node's answer to a session check without a session:
// { authenticated: false, …, analyticsEnabled, university }.
fn read_node_facts(university: &str, body: &[u8]) -> Option<NodeFacts> {
    let answer: serde_json::Value = serde_json::from_slice(body).ok()?;
    if answer.get("university")?.as_str()? != university {
        return None;
    }
    Some(NodeFacts { analytics_enabled: answer.get("analyticsEnabled")?.as_bool()? })
}

#[cfg(test)]
mod tests;
