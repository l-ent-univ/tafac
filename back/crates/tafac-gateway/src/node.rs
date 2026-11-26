// Node, behind the gateway: what it is asked, what it is told, and what
// the two share.
//
// Node answers every route that hasn't moved (routes.rs), with the
// session's cookie, which it reads as the gateway does. For the routes that
// have moved, the gateway goes to it for four things, each a request to one
// of Node's own routes:
//
//   what it is set up for   a session check repeats it (`analyticsEnabled`):
//                           read from Node's own answer to a check without
//                           a session, now and then
//   its own sign-in         for what tonAPI's can't finish: the CAS's second
//                           factor (Node reads Rennes' code page and has a
//                           code sent), a page tonAPI doesn't know. The
//                           session Node makes is one like any other: the
//                           same cookie, the same User-Agent
//   a session ended         signed out here, or found expired: Node drops
//                           what it kept of it (its copy of the cookies,
//                           the webmail's session)
//   the portal signed in to again
//                           when the portal's own session lapsed: Node's
//                           portal requests (/__ent_proxy) go with Node's
//                           copy of the cookies, so Node is the one to get
//                           the new ones. No request is made here for it:
//                           the session check goes to Node as it came
//
// The other way, Node says a session is gone on its own answers (its
// header: expired; the cookie cleared): it is gone here too.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use http::header::{CONTENT_LENGTH, COOKIE, TRANSFER_ENCODING};
use http::{HeaderMap, HeaderValue, Method};

use crate::gateway::Asked;
use crate::session::cookie;
use crate::session::memory::Ended;

// How the whole of Tafac presents itself to the university: fetch's own
// User-Agent, which Node sets on every request it makes there
// (server/upstreamAgent). A CAS binds its ticket to the User-Agent that
// signed in and deletes it when another shows it (Rennes, Rennes 2): a
// session made by tonAPI is used by Node, and one made by Node by tonAPI, so
// both go under the one name. tests/upstreamAgent.test.js holds Node to it.
pub(crate) const USER_AGENT: &str = "node";

// How a request without a session names its university to Node
// (server/universitiesApp.js).
pub const UNIVERSITY_HEADER: &str = "x-tafac-university";
// The session check, which Node also answers without a session.
pub const SESSION_PATH: &str = "/__ent_auth/session";
pub(crate) const LOGOUT_PATH: &str = "/__ent_auth/logout";
// The word, on any answer, for a session that is gone (server/sessionExpiry).
pub(crate) const SESSION_HEADER: &str = "x-tafac-session";
pub(crate) const SESSION_EXPIRED: &str = "expired";

// How long what Node says of itself is taken as said: it changes only when
// Node starts again, which on a server the gateway doesn't see.
pub(crate) const FACTS_KEPT: Duration = Duration::from_secs(5 * 60);

// A request to Node, and its answer: None when Node can't be reached.
pub type NodeRequest = http::Request<Vec<u8>>;
pub type NodeAnswer = Option<http::Response<Vec<u8>>>;

// What only Node knows of itself, read from its own answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NodeFacts {
    pub analytics_enabled: bool,
}

#[derive(Default)]
pub(crate) struct Node {
    // By university, and when it was said.
    pub(crate) facts: Mutex<HashMap<String, (NodeFacts, Instant)>>,
}

impl Node {
    // What Node is set up for at a university: asked of it, then kept a
    // while.
    pub(crate) async fn facts<N, Fut>(&self, university: &str, node: &N) -> Option<NodeFacts>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if let Some((facts, said)) = self.facts.lock().unwrap().get(university) {
            if said.elapsed() < FACTS_KEPT {
                return Some(*facts);
            }
        }
        // A session check without a session: no cookie goes, none comes back.
        let request = http::Request::builder().method(Method::GET).uri(SESSION_PATH).header(UNIVERSITY_HEADER, university).body(Vec::new()).ok()?;
        let answer = node(request).await.filter(|answer| answer.status() == http::StatusCode::OK)?;
        let facts = read_facts(university, answer.body())?;
        self.facts.lock().unwrap().insert(university.to_string(), (facts, Instant::now()));
        Some(facts)
    }
}

// The page's request, for Node to answer as it came: its method, path,
// headers and body (a sign-in's, the one body read here). Where the caller
// keeps the session's cookie itself (the apps: the window never sees it),
// the cookie is put on it.
pub(crate) fn as_it_came(asked: &Asked<'_>, cookie_name: &str, cookie: Option<&str>) -> Option<NodeRequest> {
    let target = match asked.query {
        Some(query) => format!("{}?{query}", asked.path),
        None => asked.path.to_string(),
    };
    let mut request = http::Request::builder().method(asked.method.clone()).uri(target).body(asked.body.to_vec()).ok()?;
    *request.headers_mut() = asked.headers.clone();
    // The body's length is the one of the body that goes: said again by
    // whoever sends it, never copied from a request whose body wasn't read.
    request.headers_mut().remove(TRANSFER_ENCODING);
    request.headers_mut().insert(CONTENT_LENGTH, asked.body.len().into());
    let carried = asked.headers.get_all(COOKIE).iter().filter_map(|value| value.to_str().ok()).any(|header| cookie::cookie_in_header(header, cookie_name).is_some());
    if let Some(value) = cookie.filter(|_| !carried) {
        request.headers_mut().append(COOKIE, HeaderValue::from_str(&format!("{cookie_name}={value}")).ok()?);
    }
    Some(request)
}

// What tells Node a session ended here (signed out, or found expired): its
// own sign-out, with the session's cookie and nothing else. Node drops what
// it kept of the session and ends the webmail's; what it answers is not the
// page's.
pub(crate) fn session_ended(cookie_name: &str, cookie: &str) -> Option<NodeRequest> {
    http::Request::builder()
        .method(Method::POST)
        .uri(LOGOUT_PATH)
        .header(COOKIE, format!("{cookie_name}={cookie}"))
        .header(CONTENT_LENGTH, "0")
        .body(Vec::new())
        .ok()
}

// A request on its way to Node that ends its session: the sign-out.
pub(crate) fn is_sign_out(method: &Method, path: &str) -> bool {
    method == Method::POST && path == LOGOUT_PATH
}

// What Node's answer says of the session it came for: expired (its header),
// or gone without a reason given (the cookie cleared: a sign-out it
// answered). None: nothing, the session lives.
pub(crate) fn says_ended(headers: &HeaderMap, cookie_name: &str) -> Option<Ended> {
    if headers.get(SESSION_HEADER).is_some_and(|value| value == SESSION_EXPIRED) {
        return Some(Ended::Expired);
    }
    let cleared =
        headers.get_all(http::header::SET_COOKIE).iter().filter_map(|value| value.to_str().ok()).any(|value| cookie::clears_cookie(value, cookie_name));
    cleared.then_some(Ended::SignedOut)
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
