// The gateway itself: a request of the page in, its answer out, or None
// when the answer is Node's to give.
//
//   mod.rs        the Gateway: which route, whose session, whether the
//                 answer made is still the session's when it is ready, and
//                 a session the university no longer knows
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
// got from the university, and says when the session is over. Node is behind
// it for what hasn't moved (routes.rs), and for what a moved route still
// needs of it (node.rs). None from here means the request goes to Node as it
// came: a route of Node's, another university, the demo account, nobody
// signed in, a portal session to sign in to again, a service that is down
// or slow (Node words those errors).

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

use crate::node::{self, Node, NodeAnswer, NodeRequest};
use crate::routes::{self, Moved};
use crate::session::cookie;
use crate::session::handed::CAS_TICKET;
use crate::session::memory::{Ended, Memory, Turn};
use crate::session::Held;
use crate::tonapi;
use crate::translate::{self, Translated};
use crate::universities::{self, University};

// How long Node is waited for when it is told a session ended: it ends the
// webmail's session and tells the CAS too, and the page waits meanwhile.
const NODE_TOLD_PATIENCE: Duration = Duration::from_secs(6);

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
    // Says every request left to Node, not only the unexpected ones.
    verbose: bool,
    pub(crate) node: Node,
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
            verbose: std::env::var_os("TAFAC_LOG_REQUESTS").is_some(),
            node: Node::default(),
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
    // `node`: a request to Node and its answer (node.rs says which are made).
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
            return self.sign_in(asked, cookie().as_deref(), &node).await;
        }
        let value = cookie()?;
        if route != Moved::Logout {
            if let Some(expired) = self.found_expired_already(route, &value, &node).await {
                return Some(expired);
            }
        }
        let held = self.signed_in(Some(&value))?;
        let query = asked.query;

        let translated = match route {
            Moved::Login => return None,
            // The session ends: nothing to check of it after.
            Moved::Logout => return Some(self.sign_out(&held, &value, &node).await),
            Moved::Session => self.session_check(&held, &node).await,
            Moved::Account => self.account(&held).await,
            Moved::MoodleDeadlines => self.moodle_deadlines(&held).await,
            Moved::Grades => self.grades(&held, None).await,
            Moved::GradesSemester => self.grades(&held, Some(asked.path.rsplit('/').next().unwrap_or_default())).await,
            Moved::GradesMessage => self.grades_message(&held, query).await,
            Moved::GradesDistribution => self.grades_distribution(&held, query).await,
            Moved::GradesTranscript => self.grades_transcript(&held, query).await,
        };

        match translated {
            // Signed out, or in again, while the university was asked: the
            // session this answer is about is no longer the one there is.
            Translated::Answer(response) => {
                let still = self.signed_in(cookie().as_deref()).is_some_and(|current| current.session.id == held.session.id);
                still.then_some(response)
            }
            Translated::Node(why) => {
                self.left_to_node(&why);
                None
            }
            Translated::Lost => self.lost(route, &held, &value, &node).await,
        }
    }

    // tonAPI says the university no longer knows the session (its
    // `session_expired`). That may be the portal's own session lapsed, or a
    // service refusing for a reason of its own: only the CAS says a session
    // is over, when its login page, asked with the ticket, wants the
    // password again. Then the session ends here: the page is told (the
    // route's answer, `X-Tafac-Session: expired`, the cookie taken away) and
    // Node is told. Otherwise the request is Node's: it signs in to the
    // portal again for the cookies its own portal requests go with, or words
    // the service's error.
    async fn lost<N, Fut>(&self, route: Moved, held: &Held<'_>, cookie: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if self.cas_still_knows(held).await != Some(false) {
            self.left_to_node(tonapi_core::ErrorCode::SessionExpired.as_str());
            return None;
        }
        let university = &held.session.university;
        // Without what Node says of itself the session check is Node's: it
        // finds the session expired as this did.
        let analytics = match route {
            Moved::Session => Some(self.node.facts(university, node).await?.analytics_enabled),
            _ => None,
        };
        // The one request that ends the session takes its cookie away; one
        // that found it expired at the same moment says so, no more.
        let ends_it = self.memory.end(&held.session.id, Ended::Expired);
        if ends_it {
            eprintln!("[tafac] session: signed out, the CAS no longer knows it");
            self.tell_node_it_ended(cookie, node).await;
        }
        Some(translate::expired::answer(analytics.map(|analytics| (university.as_str(), analytics)), ends_it.then_some(self.cookie_name.as_str())))
    }

    // A request that still shows the cookie of a session found expired
    // here: told so again, as Node tells it (the cookie isn't touched: the
    // answer that ended the session took it).
    async fn found_expired_already<N, Fut>(&self, route: Moved, cookie: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let session = self.codec.read(cookie, now_ms())?;
        if self.memory.ended(&session.id) != Some(Ended::Expired) || !self.universities.contains_key(&session.university) {
            return None;
        }
        let analytics = match route {
            Moved::Session => Some(self.node.facts(&session.university, node).await?.analytics_enabled),
            _ => None,
        };
        Some(translate::expired::answer(analytics.map(|analytics| (session.university.as_str(), analytics)), None))
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

    // Why a request this crate could have answered went to Node: tonAPI's
    // error code or words of this crate, never anything of the account. A
    // portal session that lapsed is the ordinary case, said only when asked
    // (TAFAC_LOG_REQUESTS); anything else is worth a line.
    pub(crate) fn left_to_node(&self, why: &str) {
        let ordinary = why == tonapi_core::ErrorCode::SessionExpired.as_str() || why == crate::tonapi::Unanswered::NoPortalSession.to_string();
        if self.verbose || !ordinary {
            eprintln!("[tafac] tonapi: left to Node ({why})");
        }
    }
}
