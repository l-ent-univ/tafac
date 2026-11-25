// What of a session tonAPI is handed, question by question.
//
// The portal's session is shared with Node, which lists the applications
// with it (/__ent_proxy) and opens a new one only when it answers
// /__ent_auth/session itself. So a question to the portal is handed the
// portal's cookies and none the CAS would get, its ticket least of all: it
// asks with the session there is and cannot open another, which Node
// wouldn't have.
//
// A question to another service (Moodle, ScoDoc, ADE) is the opposite: that
// service's session is tonAPI's own to open, as Node opens its own on a copy
// of the jar. It is handed the CAS ticket and nothing of the portal's. The
// session it opens is remembered here (memory.rs), never written to Node's
// cookie.
//
// The CAS writes its ticket anew each time it signs someone in to a service
// (the same ticket, another cookie value): Node keeps the one it has, as it
// does after signing in on a copy of its jar, and the new one isn't kept
// here either. Every question is handed the ticket of Node's session as it
// is then. The ticket is bound to the User-Agent that signed in, so tonAPI
// presents itself as Node (node.rs).

use tonapi_session::StoredCookie;

use crate::session::cookie::{NodeSession, UpstreamCookie};
use crate::universities::University;

// The portal's cookies, less any the CAS would get as well (one host for
// both, a cookie of the whole domain).
pub(crate) fn portal_cookies(university: &University, session: &NodeSession) -> Vec<StoredCookie> {
    session
        .cookies
        .iter()
        .filter(|cookie| cookie.is_for(&university.portal_host))
        .filter(|cookie| !cookie.is_sent_to(&university.cas_host, &university.cas_login_path))
        .map(stored_cookie)
        .collect()
}

// The cookies the CAS's login page gets: its ticket, with which a service
// signs the student in without a password.
pub(crate) fn cas_cookies(university: &University, session: &NodeSession) -> Vec<StoredCookie> {
    session.cookies.iter().filter(|cookie| cookie.is_sent_to(&university.cas_host, &university.cas_login_path)).map(stored_cookie).collect()
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

// Whether two cookies are the same one (its value aside).
pub(crate) fn same_cookie(one: &StoredCookie, other: &StoredCookie) -> bool {
    one.name == other.name && one.domain == other.domain && one.path == other.path
}

// Whether every cookie of the portal's handed is still there with its
// value. One more is nothing: Node gets its own when it asks. One replaced
// is Node's to get: it holds the session, and nothing here writes its
// cookie.
pub(crate) fn still_held(handed: &[StoredCookie], after: &[StoredCookie]) -> bool {
    handed.iter().all(|cookie| after.iter().any(|other| same_cookie(other, cookie) && other.value == cookie.value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, value: &str) -> StoredCookie {
        StoredCookie { domain: "ent.exemple.test".into(), path: "/".into(), name: name.into(), value: value.into(), host_only: true, expires: None }
    }

    #[test]
    fn a_cookie_the_university_replaced_is_noticed() {
        let handed = [cookie("JSESSIONID", "one")];
        assert!(still_held(&handed, &[cookie("JSESSIONID", "one")]));
        assert!(still_held(&handed, &[cookie("JSESSIONID", "one"), cookie("lb", "node2")]));
        assert!(!still_held(&handed, &[cookie("JSESSIONID", "two")]));
        assert!(!still_held(&handed, &[]));
    }
}
