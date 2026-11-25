// The gateway itself: a request in, Node's own answer out, or None.
//
//   mod.rs        the Gateway: who is signed in, which route, and whether
//                 the answer made is still the session's when it is ready
//   portal.rs     the routes the portal answers: the session check and the
//                 account (one question, asked once for both)
//   services.rs   the routes another service answers (Moodle…): its turn,
//                 the answer kept, the question, what is remembered
//
// The rule, on every side: an answer comes from here only when it is the
// one Node would give. Anything else is None, and the request goes to Node
// as it came: another university, the demo account, no session, a portal
// that no longer knows the session, an error, a slow answer. So every
// refusal, expiry and sign-out is still Node's own (server/sessionExpiry).

pub(crate) mod portal;
mod services;

use std::collections::BTreeMap;
use std::future::Future;
use std::time::{SystemTime, UNIX_EPOCH};

use http::{HeaderMap, Method};
use tonapi_providers::NetSettings;

use crate::node::{self, Node};
use crate::routes::{self, Moved};
use crate::session::cookie::{self, NodeSession};
use crate::session::memory::Memory;
use crate::translate::Translated;
use crate::universities::{self, University};

// The CAS's ticket-granting cookie: Node calls a session without it
// degraded, and says so itself.
const CAS_TICKET: &str = "TGC";

pub struct Gateway {
    universities: BTreeMap<String, University>,
    cookie_name: String,
    reader: cookie::Reader,
    net: NetSettings,
    // Says every request left to Node, not only the unexpected ones.
    verbose: bool,
    pub(crate) node: Node,
    pub(crate) portal: portal::Portal,
    pub(crate) memory: Memory,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0)
}

impl Gateway {
    // `session_secret`: Node's SESSION_SECRET. `cookie_name`: its session
    // cookie's (PRODUCTION_COOKIE or DEVELOPMENT_COOKIE, as Node runs).
    pub fn new(session_secret: &str, cookie_name: &str) -> Self {
        Self::with(universities::served(), session_secret, cookie_name, NetSettings { user_agent: Some(node::USER_AGENT), ..NetSettings::default() })
    }

    fn with(universities: BTreeMap<String, University>, session_secret: &str, cookie_name: &str, net: NetSettings) -> Self {
        Self {
            universities,
            cookie_name: cookie_name.to_string(),
            reader: cookie::Reader::new(session_secret),
            net,
            verbose: std::env::var_os("TAFAC_LOG_REQUESTS").is_some(),
            node: Node::default(),
            portal: portal::Portal::default(),
            memory: Memory::default(),
        }
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

        let translated = match route {
            Moved::Session => self.session_check(university, &session, ask_node).await,
            Moved::Account => self.account(university, &session).await,
            Moved::MoodleDeadlines => self.moodle_deadlines(university, &session).await,
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

    // A request on its way to Node: a sign-out ends its session here too,
    // for any other request still on its way with the same cookie.
    pub fn saw_request(&self, method: &Method, path: &str, cookie: Option<&str>) {
        if node::is_sign_out(method, path) {
            self.end(cookie);
        }
    }

    // Node's answer to a request that came with `cookie`: when it says the
    // session is gone (its header, or the cookie cleared), it is gone here.
    pub fn saw_response(&self, cookie: Option<&str>, headers: &HeaderMap) {
        if node::says_gone(headers, &self.cookie_name) {
            self.end(cookie);
        }
    }

    // A session ended: no more answers for it, and nothing of it remembered.
    fn end(&self, cookie: Option<&str>) {
        let Some(session) = cookie.and_then(|cookie| self.reader.read(cookie, now_ms())) else { return };
        self.memory.forget(&session.id);
        self.portal.forget(&session.id);
        self.node.end(session.id);
    }

    // The session a cookie holds and its university, when it is one
    // answered from here: a real account's, at one of the universities of
    // routes.rs, with its CAS ticket, and not seen ended.
    pub(crate) fn signed_in(&self, cookie: Option<&str>) -> Option<(NodeSession, &University)> {
        let session = self.reader.read(cookie?, now_ms())?;
        let university = self.universities.get(&session.university)?;
        if session.demo || !session.has_cookie(&university.cas_host, CAS_TICKET) {
            return None;
        }
        (!self.node.ended(&session.id)).then_some((session, university))
    }

    // Why a request this crate could have answered went to Node: tonAPI's
    // error code or words of this crate, never anything of the account. A
    // session that lapsed is the ordinary case, said only when asked
    // (TAFAC_LOG_REQUESTS); anything else is worth a line.
    pub(crate) fn left_to_node(&self, why: &str) {
        let ordinary = why == tonapi_core::ErrorCode::SessionExpired.as_str() || why == crate::tonapi::Unanswered::NoPortalSession.to_string();
        if self.verbose || !ordinary {
            eprintln!("[tafac] tonapi: left to Node ({why})");
        }
    }
}
