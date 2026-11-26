// The gateway on a made-up campus (testing/): what it answers, its errors
// too, and what it leaves to Node or tells it.
//
//   signin.rs             the session made and ended: a sign-in, its
//                         refusals and limits, what is Node's, a sign-out
//   portal.rs             the session check and the account
//   apps.rs               the portal's applications: tonAPI's own list, a
//                         portal session of the gateway's own
//   expiry.rs             a session the CAS no longer knows, and a service
//                         that fails while the CAS still does
//   moodle_deadlines.rs   a route another service answers: the CAS ticket,
//                         the session held, the answer kept
//   behind.rs             the home page's answers past their freshness: the
//                         old one given while the university is asked again,
//                         whose they are, and what a sign-in asks ahead
//   grades.rs             the grades' routes: ScoDoc's shape written back,
//                         and what the routes refuse
//   launch.rs             the launch relay, its preview, and what Moodle's
//                         view may show: answered to their end here
//   student.rs            the student's photo and school certificate: the
//                         same
//   other_portals.rs      the same routes at a university whose portal is
//                         not uPortal (Drupal, iSorbonne)
//   universities.rs       Tafac's own: the universities served, their logos,
//                         and the session check nobody is signed in for
//   analytics.rs          Tafac's own statistics: what reaches a made-up
//                         PostHog, and when it is slow or down
//   icons.rs              the applications' icons, Tafac's own: Node's file
//   own.rs                tafac.fr's server on the wire: the page's files,
//                         the icons' body read on its way

mod analytics;
mod apps;
mod behind;
mod expiry;
mod grades;
mod icons;
mod launch;
mod moodle_deadlines;
mod other_portals;
#[cfg(feature = "server")]
mod own;
mod portal;
mod signin;
mod student;
mod universities;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

use http::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use http::{HeaderMap, Method};

use crate::session::cookie::clear_cookie;
use crate::testing::*;
use crate::{Asked, Gateway, NodeAnswer, NodeRequest, ANSWERED_BY};

const SESSION: &str = "/__ent_auth/session";
const ACCOUNT: &str = "/__ent_auth/account";
const LOGIN: &str = "/__ent_auth/login";
const LOGOUT: &str = "/__ent_auth/logout";

static GET: Method = Method::GET;
static POST: Method = Method::POST;
static NO_HEADERS: LazyLock<HeaderMap> = LazyLock::new(HeaderMap::new);

// A request of the page's: « path?query », as the page writes it.
fn asked<'a>(method: &'a Method, target: &'a str, headers: &'a HeaderMap, body: &'a [u8]) -> Asked<'a> {
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (target, None),
    };
    Asked { method, path, query, headers, body, peer: None }
}

fn json(status: u16, body: &str) -> http::Response<Vec<u8>> {
    http::Response::builder().status(status).header(CONTENT_TYPE, "application/json; charset=utf-8").body(body.as_bytes().to_vec()).unwrap()
}

// Node is not asked: most tests, where no session ends.
async fn never(request: NodeRequest) -> NodeAnswer {
    panic!("Node is not asked ({} {})", request.method(), request.uri().path())
}

// Node, for the tests that look at what it was told or asked: each request
// it got (its method and path, its session cookie, its body), and its own
// answer to a sign-in.
#[derive(Default)]
struct Node {
    got: Mutex<Vec<(String, String, Vec<u8>)>>,
    // What its own login answers: (status, body). Signed in when there is none.
    login: Mutex<Option<(u16, &'static str)>>,
    unreachable: AtomicBool,
}

// The session Node makes when its own login signs in: its cookie.
const NODES_SESSION: &str = "v1.made.by.node";

impl Node {
    async fn ask(&self, request: NodeRequest) -> NodeAnswer {
        let asked = format!("{} {}", request.method(), request.uri().path());
        let cookie = request.headers().get(COOKIE).and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
        self.got.lock().unwrap().push((asked.clone(), cookie, request.body().clone()));
        if self.unreachable.load(Ordering::SeqCst) {
            return None;
        }
        match asked.as_str() {
            "POST /__ent_auth/login" => match *self.login.lock().unwrap() {
                Some((status, body)) => Some(json(status, body)),
                None => {
                    let mut answer = json(200, r#"{"authenticated":true,"user":"otp-user","sessionMode":null,"university":"univ-rennes"}"#);
                    answer.headers_mut().append(SET_COOKIE, format!("{COOKIE_NAME}={NODES_SESSION}; Max-Age=2592000; Path=/; HttpOnly").parse().unwrap());
                    Some(answer)
                }
            },
            "POST /__ent_auth/logout" => {
                let mut answer = json(200, r#"{"authenticated":false}"#);
                answer.headers_mut().append(SET_COOKIE, clear_cookie(COOKIE_NAME).parse().unwrap());
                Some(answer)
            }
            _ => Some(json(200, r#"{"from":"node"}"#)),
        }
    }

    fn got(&self) -> Vec<String> {
        self.got.lock().unwrap().iter().map(|(asked, _, _)| asked.clone()).collect()
    }
}

// A route's answer made here, checked for what every one carries; None when
// it was left to Node. Node itself is asked nothing.
fn ask(gateway: &Gateway, target: &str, cookie: &str) -> Option<serde_json::Value> {
    let response = block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), never))?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    Some(serde_json::from_slice(response.body()).unwrap())
}

// A route's error made here: its status and what it says. Node is asked
// nothing, and nothing in the answer says the session is over.
fn error_of(gateway: &Gateway, target: &str, cookie: &str) -> (u16, serde_json::Value) {
    let response = block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), never)).expect("an answer made here");
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    assert!(response.headers().get("x-tafac-session").is_none() && response.headers().get(SET_COOKIE).is_none());
    (response.status().as_u16(), body_of(&response))
}

// What a route says of an error of the university's, as Node's production
// server words it.
fn unavailable() -> (u16, serde_json::Value) {
    (500, serde_json::json!({ "error": "Service indisponible pour le moment" }))
}

fn body_of(response: &http::Response<Vec<u8>>) -> serde_json::Value {
    serde_json::from_slice(response.body()).unwrap()
}

// The session cookie an answer sets: its value, or « cleared ».
fn cookie_set(response: &http::Response<Vec<u8>>) -> Option<String> {
    let set = response.headers().get(SET_COOKIE)?.to_str().unwrap();
    let value = set.strip_prefix(&format!("{COOKIE_NAME}="))?.split(';').next()?;
    Some(if value.is_empty() { "cleared".to_string() } else { value.to_string() })
}
