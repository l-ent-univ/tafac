// What of a session tonAPI is handed, question by question, and what of
// tonAPI's session a new session's cookie is written with.
//
// The portal's session is the one Node lists the applications with
// (/__ent_proxy), from its own copy of the session's cookies. Node opens a
// new one when it answers /__ent_auth/session itself. So a question to the
// portal is handed the portal's cookies and none the CAS would get, its
// ticket least of all: it asks with the session there is and cannot open
// another, which Node wouldn't have.
//
// A question to another service (Moodle, ScoDoc, ADE) is the opposite: that
// service's session is tonAPI's own to open, as Node opens its own on a copy
// of its jar. It is handed the CAS ticket and nothing of the portal's. The
// session it opens is held in this process (memory.rs), not in the cookie.
//
// The CAS writes its ticket anew each time it signs someone in to a service
// (the same ticket, another cookie value). The one in the cookie stays the
// one handed, as Node keeps the one it has after signing in on a copy of its
// jar: every question is handed the ticket of the cookie as it is then. The
// ticket is bound to the User-Agent that signed in, the same for tonAPI and
// for Node (node.rs).

use tonapi_session::StoredCookie;

use crate::session::cookie::{Session, UpstreamCookie};
use crate::universities::University;

// The CAS's ticket-granting cookie: with it a service signs the student in
// without a password, and without it nothing does (Node calls such a
// session degraded, and says so itself).
pub(crate) const CAS_TICKET: &str = "TGC";

// The portal's cookies, less any the CAS would get as well (one host for
// both, a cookie of the whole domain).
pub(crate) fn portal_cookies(university: &University, session: &Session) -> Vec<StoredCookie> {
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
pub(crate) fn cas_cookies(university: &University, session: &Session) -> Vec<StoredCookie> {
    session.cookies.iter().filter(|cookie| cookie.is_sent_to(&university.cas_host, &university.cas_login_path)).map(stored_cookie).collect()
}

pub(crate) fn stored_cookie(cookie: &UpstreamCookie) -> StoredCookie {
    StoredCookie {
        domain: cookie.domain.clone(),
        path: cookie.path.clone(),
        name: cookie.name.clone(),
        value: cookie.value.clone(),
        host_only: cookie.host_only,
        expires: cookie.expires_at_ms.map(|expiry| expiry / 1000),
    }
}

// One of tonAPI's cookies, as the session's cookie holds them.
fn upstream_cookie(cookie: &StoredCookie) -> UpstreamCookie {
    UpstreamCookie {
        name: cookie.name.clone(),
        value: cookie.value.clone(),
        domain: cookie.domain.trim_start_matches('.').to_ascii_lowercase(),
        path: cookie.path.clone(),
        host_only: cookie.host_only,
        expires_at_ms: cookie.expires.map(|expiry| expiry.saturating_mul(1000)),
    }
}

// What a new session's cookie is written with, out of the cookies tonAPI's
// sign-in left: the CAS ticket, then the portal's cookies, then the CAS's
// others. That is what Node's own sign-in leaves in its jar, and all a
// session starts again from. What tonAPI got from other services as it
// signed in (the planning's, while it looked for the component) stays in
// this process (memory.rs), as Node keeps its own services' sessions.
pub(crate) fn for_the_cookie(university: &University, cookies: &[StoredCookie]) -> (Vec<UpstreamCookie>, Vec<UpstreamCookie>) {
    let cookies: Vec<UpstreamCookie> = cookies.iter().map(upstream_cookie).collect();
    let is_ticket = |cookie: &&UpstreamCookie| cookie.name == CAS_TICKET && cookie.is_for(&university.cas_host);
    let ticket = cookies.iter().filter(is_ticket).cloned().collect();
    let portal = cookies.iter().filter(|cookie| cookie.is_for(&university.portal_host) && !is_ticket(cookie));
    let cas = cookies.iter().filter(|cookie| cookie.is_for(&university.cas_host) && !cookie.is_for(&university.portal_host) && !is_ticket(cookie));
    (ticket, portal.chain(cas).cloned().collect())
}

// Whether two cookies are the same one (its value aside).
pub(crate) fn same_cookie(one: &StoredCookie, other: &StoredCookie) -> bool {
    one.name == other.name && one.domain == other.domain && one.path == other.path
}

// Whether every cookie of the portal's handed is still there with its
// value. One more is nothing: Node gets its own when it asks. One replaced
// is Node's to get: its portal requests go with its own copy of them.
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
    fn a_new_sessions_cookie_takes_the_ticket_the_portals_and_the_cas_own() {
        let campus = crate::testing::campus();
        let university = University::of(campus.settings()).unwrap();
        let at = |domain: &str, path: &str, name: &str| StoredCookie { domain: domain.into(), path: path.into(), name: name.into(), value: "v".into(), host_only: true, expires: Some(1_800_000_000) };
        let left = [
            at("127.0.0.1", "/moodle", "MoodleSession"),
            at("localhost", "/cas", "XSRF-TOKEN"),
            at("127.0.0.1", "/", "JSESSIONID"),
            at("planning.exemple.test", "/", "JSESSIONID"),
            at("localhost", "/cas", "TGC"),
        ];
        let (ticket, others) = for_the_cookie(&university, &left);
        assert_eq!(format!("{ticket:?}"), "[TGC@localhost/cas]");
        // The portal's host is Moodle's too on this campus: its cookies go.
        assert_eq!(format!("{others:?}"), "[MoodleSession@127.0.0.1/moodle, JSESSIONID@127.0.0.1/, XSRF-TOKEN@localhost/cas]");
        assert_eq!(ticket[0].expires_at_ms, Some(1_800_000_000_000));
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
