// Node, seen from the gateway: what it says of itself, and the sessions it
// ended.
//
// Node holds the sessions and keeps answering every route that hasn't
// moved. Two things of it matter to an answer made here:
//
//   what it is set up for   a translated session check repeats it
//                           (`analyticsEnabled`): read from Node's own
//                           answer to a check without a session, now and then
//   the sessions it ended   a sign-out, an expiry: from then on a copy of
//                           the cookie is worth nothing here either

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use http::{HeaderMap, Method};

use crate::session::cookie;

// How Node presents itself to the university: fetch's own User-Agent, which
// server/entAuthApp.js never replaces (fetchWithJar). A CAS binds its ticket
// to the User-Agent that signed in and deletes it when another shows it
// (Rennes, Rennes 2): tonAPI asks with the cookies of Node's session, so it
// presents itself as Node does. tests/gatewayUserAgent.test.js holds Node to
// this name.
pub(crate) const USER_AGENT: &str = "node";

// How a request without a session names its university to Node
// (server/universitiesApp.js).
pub const UNIVERSITY_HEADER: &str = "x-tafac-university";
// The session check, which Node also answers without a session.
pub const SESSION_PATH: &str = "/__ent_auth/session";
const LOGOUT_PATH: &str = "/__ent_auth/logout";
// Node's word, on any answer, for a session that is gone (server/sessionExpiry).
const SESSION_HEADER: &str = "x-tafac-session";
const SESSION_EXPIRED: &str = "expired";

// How long what Node says of itself is taken as said: it changes only when
// Node starts again, which on a server the gateway doesn't see.
pub(crate) const FACTS_KEPT: Duration = Duration::from_secs(5 * 60);
// How long a session seen ended is remembered, as Node does
// (ENDED_KEPT_MS): past any request still on its way with its cookie.
const ENDED_KEPT: Duration = Duration::from_secs(60 * 60);
// Sessions seen ended that are remembered at once.
const REMEMBERED: usize = 10_000;

// What only Node knows of itself, read from its own answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NodeFacts {
    pub analytics_enabled: bool,
}

#[derive(Default)]
pub(crate) struct Node {
    // By university, and when it was said.
    pub(crate) facts: Mutex<HashMap<String, (NodeFacts, Instant)>>,
    // The sessions seen ended (signed out, expired), and when.
    ended: Mutex<HashMap<String, Instant>>,
}

impl Node {
    // `ask_node`: Node's answer to a session check without a session, for a
    // university (its body).
    pub(crate) async fn facts<F, Fut>(&self, university: &str, ask_node: F) -> Option<NodeFacts>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        if let Some((facts, said)) = self.facts.lock().unwrap().get(university) {
            if said.elapsed() < FACTS_KEPT {
                return Some(*facts);
            }
        }
        let facts = read_facts(university, &ask_node(university.to_string()).await?)?;
        self.facts.lock().unwrap().insert(university.to_string(), (facts, Instant::now()));
        Some(facts)
    }

    pub(crate) fn end(&self, session: String) {
        let mut ended = self.ended.lock().unwrap();
        ended.retain(|_, at| at.elapsed() < ENDED_KEPT);
        if ended.len() >= REMEMBERED {
            ended.clear();
        }
        ended.insert(session, Instant::now());
    }

    pub(crate) fn ended(&self, session: &str) -> bool {
        self.ended.lock().unwrap().get(session).is_some_and(|at| at.elapsed() < ENDED_KEPT)
    }
}

// A request on its way to Node that ends its session: the sign-out.
pub(crate) fn is_sign_out(method: &Method, path: &str) -> bool {
    method == Method::POST && path == LOGOUT_PATH
}

// Node's answer says the session is gone: its header, or the cookie cleared.
pub(crate) fn says_gone(headers: &HeaderMap, cookie_name: &str) -> bool {
    let expired = headers.get(SESSION_HEADER).is_some_and(|value| value == SESSION_EXPIRED);
    let cleared =
        headers.get_all(http::header::SET_COOKIE).iter().filter_map(|value| value.to_str().ok()).any(|value| cookie::clears_cookie(value, cookie_name));
    expired || cleared
}

// From Node's answer to a session check without a session:
// { authenticated: false, …, analyticsEnabled, university }.
pub(crate) fn read_facts(university: &str, body: &[u8]) -> Option<NodeFacts> {
    let answer: serde_json::Value = serde_json::from_slice(body).ok()?;
    if answer.get("university")?.as_str()? != university {
        return None;
    }
    Some(NodeFacts { analytics_enabled: answer.get("analyticsEnabled")?.as_bool()? })
}
