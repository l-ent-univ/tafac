// The gateway itself: a request of the page in, its answer out, or None
// when the answer is Node's to give.
//
//   mod.rs        the Gateway: which route, whose session, whether the
//                 answer made is still the session's when it is ready, a
//                 route that fails, and a session the university no longer
//                 knows
//   signin.rs     POST /login and /logout: the session made (tonAPI signs
//                 in, the cookie is written) and ended
//   attempts.rs   the sign-in's limits, and the address a request came from
//   portal.rs     the routes the portal answers: the session check and the
//                 account (one question, asked once for both)
//   services.rs   the routes another service answers (Moodle, ScoDoc): its
//                 turn, the answer kept, the question, what the session
//                 holds of the service
//
// The session is the gateway's: it signs the student in, holds what tonAPI
// got from the university, and says when the session is over. For a session
// it holds, every moved route is answered here, its errors too
// (translate/failed.rs). Node is behind it for what hasn't moved
// (routes.rs), and is told when a session ends (node.rs). None from here
// means the request goes to Node as it came: a route of Node's, another
// university, the demo account, nobody signed in, a cookie that isn't read.

mod attempts;
pub(crate) mod portal;
mod services;
mod signin;

use std::collections::BTreeMap;
use std::future::Future;
use std::net::IpAddr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use http::{HeaderMap, Method};
use tonapi_providers::NetSettings;

pub use attempts::TrustedProxies;

use crate::node::{self, NodeAnswer, NodeRequest};
use crate::routes::{self, Moved};
use crate::session::cookie;
use crate::session::handed::CAS_TICKET;
use crate::session::memory::{Ended, Memory, Turn};
use crate::session::Held;
use crate::tonapi;
use crate::translate::{self, Failure, Translated};
use crate::universities::{self, University};

// How long Node is waited for when it is told a session ended: it ends the
// webmail's session and tells the CAS too, and the page waits meanwhile.
const NODE_TOLD_PATIENCE: Duration = Duration::from_secs(6);
// Why a route failed when tonAPI said `session_expired` of a session the
// CAS still knows, or doesn't say is over: the service's own refusal.
const REFUSED_NOT_OVER: &str = "session_expired, and the CAS doesn't say the session is over";

// A request of the page's.
pub struct Asked<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    // What follows the path's « ? », as it came.
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
    // A sign-in's body; nothing for a request whose body isn't read here.
    pub body: &'a [u8],
    // The address the connection came from, where there is one (a server);
    // the apps have none.
    pub peer: Option<IpAddr>,
}

pub struct Gateway {
    universities: BTreeMap<String, University>,
    cookie_name: String,
    codec: cookie::Codec,
    net: NetSettings,
    trusted: TrustedProxies,
    // Whether the statistics are on, as Node is set up (node.rs).
    statistics: bool,
    // Says every request a moved route refused, not only the ones that
    // failed.
    verbose: bool,
    pub(crate) memory: Memory,
    pub(crate) attempts: attempts::Attempts,
    pub(crate) early: portal::Early,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0)
}

impl Gateway {
    // `session_secret`: SESSION_SECRET, which Node is given too. `cookie_name`:
    // the session cookie's (PRODUCTION_COOKIE or DEVELOPMENT_COOKIE, as Node
    // runs).
    pub fn new(session_secret: &str, cookie_name: &str) -> Self {
        Self::with(universities::served(), session_secret, cookie_name, NetSettings { user_agent: Some(node::USER_AGENT), ..NetSettings::default() })
    }

    fn with(universities: BTreeMap<String, University>, session_secret: &str, cookie_name: &str, net: NetSettings) -> Self {
        Self {
            universities,
            cookie_name: cookie_name.to_string(),
            codec: cookie::Codec::new(session_secret),
            net,
            trusted: TrustedProxies::Private,
            statistics: false,
            verbose: std::env::var_os("TAFAC_LOG_REQUESTS").is_some(),
            memory: Memory::default(),
            attempts: attempts::Attempts::default(),
            early: portal::Early::default(),
        }
    }

    // Whose word is taken for the address a request came from (the
    // sign-in's limits), on a server behind another: Node's TRUST_PROXY.
    pub fn trusting(mut self, trusted: TrustedProxies) -> Self {
        self.trusted = trusted;
        self
    }

    // Whether the statistics are on, which a session check says to the page
    // (`analyticsEnabled`). `posthog_project_key`: POSTHOG_PROJECT_KEY as
    // the Node behind is given it, which decides it for Node; None where
    // Node sends nothing whatever its key (a development server without
    // POSTHOG_IN_DEV).
    pub fn with_statistics(mut self, posthog_project_key: Option<&str>) -> Self {
        self.statistics = node::statistics_on(posthog_project_key);
        self
    }

    // Whether Node runs as on tafac.fr and in the apps, which the cookie's
    // name says (getSessionCookieName): its routes then say one sentence
    // for an error of the university's, and the reason in development
    // (server/routeErrors).
    fn in_production(&self) -> bool {
        self.cookie_name != cookie::DEVELOPMENT_COOKIE
    }

    // For the tests: the universities given, asked without TLS.
    #[cfg(any(test, feature = "testing"))]
    pub fn for_tests(universities: Vec<tonapi_config::ResolvedUniversity>, session_secret: &str, cookie_name: &str) -> Self {
        let universities =
            universities.into_iter().filter_map(|settings| Some((settings.university.id.clone(), University::of(settings)?))).collect();
        Self::with(universities, session_secret, cookie_name, NetSettings { https_only: false, user_agent: Some(node::USER_AGENT) })
    }

    pub fn cookie_name(&self) -> &str {
        &self.cookie_name
    }

    // The ids of the universities whose moved routes are answered here.
    pub fn universities(&self) -> Vec<&str> {
        self.universities.keys().map(String::as_str).collect()
    }

    // Whether a request's body is read here: a sign-in's, which says who
    // signs in. Every other body goes to Node as it streams.
    pub fn reads_body(method: &Method, path: &str) -> bool {
        matches!(routes::moved_route(method, path), Some(Moved::Login))
    }

    // The answer to a request, when its route has moved (routes.rs) and the
    // answer is one made here. None: Node's to give, as the request came.
    //
    // `cookie`: the value of the session cookie as the caller holds it now
    // (asked again before answering: the session may have ended meanwhile).
    // `node`: a request to Node and its answer (node.rs says which is made:
    // Node told that a session ended).
    //
    // An answer may set or clear the session's cookie (Set-Cookie): a
    // caller that keeps the cookie itself takes it from there.
    pub async fn answer<C, N, Fut>(&self, asked: &Asked<'_>, cookie: C, node: N) -> Option<http::Response<Vec<u8>>>
    where
        C: Fn() -> Option<String>,
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let route = routes::moved_route(asked.method, asked.path)?;
        // A sign-in is the one route without a session to answer for.
        if route == Moved::Login {
            return self.sign_in(asked).await;
        }
        let value = cookie()?;
        if route != Moved::Logout {
            if let Some(expired) = self.found_expired_already(route, &value) {
                return Some(expired);
            }
        }
        let held = self.signed_in(Some(&value))?;
        let query = asked.query;

        let translated = match route {
            Moved::Login => return None,
            // The session ends: nothing to check of it after.
            Moved::Logout => return Some(self.sign_out(&held, &value, &node).await),
            Moved::Session => self.session_check(&held).await,
            Moved::Account => self.account(&held).await,
            Moved::Apps => self.apps(&held).await,
            Moved::MoodleDeadlines => self.moodle_deadlines(&held).await,
            Moved::Grades => self.grades(&held, None).await,
            // Node's route reads one part of the path after the folder: a
            // path with none, or more, is no route of the page's.
            Moved::GradesSemester => self.grades(&held, Some(routes::under(route, asked.path).filter(|id| !id.is_empty() && !id.contains('/'))?)).await,
            Moved::GradesMessage => self.grades_message(&held, query).await,
            Moved::GradesDistribution => self.grades_distribution(&held, query).await,
            Moved::GradesTranscript => self.grades_transcript(&held, query).await,
        };

        let response = match translated {
            Translated::Answer(response) => response,
            Translated::Failed(failure) => self.route_failed(route, &failure),
            Translated::Lost => match self.lost(route, &held, &value, &node).await {
                Some(expired) => return Some(expired),
                // The CAS still knows the ticket, or doesn't say: the
                // service refused for a reason of its own.
                None => self.route_failed(route, &Failure::Unavailable(REFUSED_NOT_OVER.to_string())),
            },
        };
        // Signed out, or in again, while the university was asked: the
        // session this answer is about is no longer the one there is.
        let still = self.signed_in(cookie().as_deref()).is_some_and(|current| current.session.id == held.session.id);
        still.then_some(response)
    }

    // A moved route without an answer of its own: its error, worded here as
    // Node words its own (translate/failed.rs). An error of the
    // university's is worth a line: the route as the table writes it, and
    // tonAPI's error code or words of this crate, never anything of the
    // account. A request refused is said only when asked
    // (TAFAC_LOG_REQUESTS).
    fn route_failed(&self, route: Moved, failure: &Failure) -> http::Response<Vec<u8>> {
        match failure {
            Failure::Unavailable(why) => eprintln!("[tafac] tonapi: {} failed ({why})", routes::written(route)),
            Failure::Said(status, _) if self.verbose => eprintln!("[tafac] tonapi: {} refused ({status})", routes::written(route)),
            Failure::Said(..) => {}
        }
        translate::failed::answer(route, failure, self.in_production())
    }

    // tonAPI says the university no longer knows the session (its
    // `session_expired`): the CAS wouldn't sign it in to the portal or to a
    // service, or a service refuses for a reason of its own. Only the CAS
    // says a session is over, when its login page, asked with the ticket,
    // wants the password again. Then the session ends here: the page is
    // told (the route's answer, `X-Tafac-Session: expired`, the cookie
    // taken away) and Node is told. None otherwise: the session lives, and
    // the route has failed.
    async fn lost<N, Fut>(&self, route: Moved, held: &Held<'_>, cookie: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if self.cas_still_knows(held).await != Some(false) {
            return None;
        }
        // The one request that ends the session takes its cookie away; one
        // that found it expired at the same moment says so, no more.
        let ends_it = self.memory.end(&held.session.id, Ended::Expired);
        if ends_it {
            eprintln!("[tafac] session: signed out, the CAS no longer knows it");
            self.tell_node_it_ended(cookie, node).await;
        }
        Some(self.expired(route, &held.session.university, ends_it))
    }

    // A request that still shows the cookie of a session found expired
    // here: told so again, as Node tells it (the cookie isn't touched: the
    // answer that ended the session took it).
    fn found_expired_already(&self, route: Moved, cookie: &str) -> Option<http::Response<Vec<u8>>> {
        let session = self.codec.read(cookie, now_ms())?;
        if self.memory.ended(&session.id) != Some(Ended::Expired) || !self.universities.contains_key(&session.university) {
            return None;
        }
        Some(self.expired(route, &session.university, false))
    }

    // What a route says of a session that is over (translate/expired.rs).
    // `ends_it`: on the answer that ends the session.
    fn expired(&self, route: Moved, university: &str, ends_it: bool) -> http::Response<Vec<u8>> {
        let session_check = (route == Moved::Session).then_some((university, self.statistics));
        translate::expired::answer(session_check, ends_it.then_some(self.cookie_name.as_str()))
    }

    // Whether the CAS still knows the session's ticket; None when it doesn't
    // say. One question at a time for a session, and its « yes » stands a
    // minute for the requests that fail together.
    pub(crate) async fn cas_still_knows(&self, held: &Held<'_>) -> Option<bool> {
        let _turn = held.memory.turn(Turn::Cas).await;
        if self.memory.ended(&held.session.id) == Some(Ended::Expired) {
            return Some(false);
        }
        if held.memory.cas_knew() {
            return Some(true);
        }
        let known = tonapi::signin::still_known(held.university, &held.session, self.net).await;
        match known {
            Some(true) => held.memory.cas_knows(),
            Some(false) => {}
            None => eprintln!("[tafac] session: the CAS didn't say whether it still knows the session (down, slow, or another page)"),
        }
        known
    }

    // Node told a session ended here, with the session's cookie: its own
    // sign-out, whose answer isn't the page's.
    pub(crate) async fn tell_node_it_ended<N, Fut>(&self, cookie: &str, node: &N)
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let Some(request) = node::session_ended(&self.cookie_name, cookie) else { return };
        if tokio::time::timeout(NODE_TOLD_PATIENCE, node(request)).await.ok().flatten().is_none() {
            eprintln!("[tafac] session: Node wasn't told that a session ended (it didn't answer)");
        }
    }

    // A request on its way to Node: a sign-out ends its session here too,
    // for any other request still on its way with the same cookie. (The
    // sign-out of a session held here is answered here: this is for the
    // ones that aren't.)
    pub fn saw_request(&self, method: &Method, path: &str, cookie: Option<&str>) {
        if node::is_sign_out(method, path) {
            self.end(cookie, Ended::SignedOut);
        }
    }

    // Node's answer to a request that came with `cookie`: when it says the
    // session is gone (its header: expired; or the cookie cleared), it is
    // gone here.
    pub fn saw_response(&self, cookie: Option<&str>, headers: &HeaderMap) {
        if let Some(why) = node::says_ended(headers, &self.cookie_name) {
            self.end(cookie, why);
        }
    }

    // A session ended: no more answers for it, and nothing of it held.
    fn end(&self, cookie: Option<&str>, why: Ended) {
        let Some(session) = cookie.and_then(|cookie| self.codec.read(cookie, now_ms())) else { return };
        self.memory.end(&session.id, why);
    }

    // The session a cookie holds, when it is one answered from here: a real
    // account's, at one of the universities of routes.rs, with its CAS
    // ticket, and not ended.
    pub(crate) fn signed_in(&self, cookie: Option<&str>) -> Option<Held<'_>> {
        let session = self.codec.read(cookie?, now_ms())?;
        let university = self.universities.get(&session.university)?;
        if session.demo || !session.has_cookie(&university.cas_host, CAS_TICKET) || self.memory.ended(&session.id).is_some() {
            return None;
        }
        let memory = self.memory.of(&session.id);
        Some(Held { session, university, memory })
    }
}
