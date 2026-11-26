// Node, behind the gateway: what it is told, and what the two share.
//
// Node answers every route that hasn't moved (routes.rs), with the
// session's cookie, which it reads as the gateway does. For the routes that
// have moved, the gateway goes to it for one thing, a request to one of
// Node's own routes:
//
//   a session ended         signed out here, or found expired: Node drops
//                           what it kept of it (its copy of the cookies,
//                           the webmail's session)
//
// The other way, Node says a session is gone on its own answers (its
// header: expired; the cookie cleared): it is gone here too.
//
// What the two share is read here from where Node reads it, and never asked
// of Node: the name they go to the university under, and whether the
// statistics are on.

use http::header::{CONTENT_LENGTH, COOKIE};
use http::{HeaderMap, Method};

use crate::session::cookie;
use crate::session::memory::Ended;

// How the whole of Tafac presents itself to the university: fetch's own
// User-Agent, which Node sets on every request it makes there
// (server/upstreamAgent). A CAS binds its ticket to the User-Agent that
// signed in and deletes it when another shows it (Rennes, Rennes 2): a
// session made by tonAPI is used by Node, and one made by Node by tonAPI, so
// both go under the one name. tests/upstreamAgent.test.js holds Node to it.
pub(crate) const USER_AGENT: &str = "node";

// How a request without a session names its university
// (server/universitiesApp.js): a sign-in's is read here too
// (gateway/signin.rs).
pub const UNIVERSITY_HEADER: &str = "x-tafac-university";
pub(crate) const LOGOUT_PATH: &str = "/__ent_auth/logout";
// The word, on any answer, for a session that is gone (server/sessionExpiry).
pub(crate) const SESSION_HEADER: &str = "x-tafac-session";
pub(crate) const SESSION_EXPIRED: &str = "expired";

// A request to Node, and its answer: None when Node can't be reached.
pub type NodeRequest = http::Request<Vec<u8>>;
pub type NodeAnswer = Option<http::Response<Vec<u8>>>;

// Whether Tafac's anonymous statistics are on, which the session check
// repeats to the page (`analyticsEnabled`: the page then shows its
// « Statistiques anonymes » switch, and sends its events to Node's own
// route). Node's are on when it has PostHog's project key
// (server/analytics.js: readAnalyticsConfig, createAnalytics). `key`:
// POSTHOG_PROJECT_KEY, as Node is given it.
pub(crate) fn statistics_on(key: Option<&str>) -> bool {
    key.is_some_and(|key| !key.trim().is_empty())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_statistics_are_on_when_node_has_a_key() {
        assert!(statistics_on(Some("phc_made_up")));
        assert!(statistics_on(Some(" phc_made_up\n")));
        for none in [None, Some(""), Some("  \n")] {
            assert!(!statistics_on(none), "{none:?}");
        }
        // Node's own reading, from its source: the key without the spaces
        // around it, and nothing sent without one.
        let node = include_str!("../../../../server/analytics.js");
        assert!(node.contains("const projectKey = String(env.POSTHOG_PROJECT_KEY ?? '').trim()"));
        assert!(node.contains("if (!projectKey) {\n    return DISABLED_ANALYTICS"));
    }
}
