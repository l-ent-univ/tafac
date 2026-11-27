// GET /__ent_auth/session: whether the student is signed in.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, user, sessionMode, sessionSource,
//         cookieNames, casCookieNames, canUseServerLaunch, degraded,
//         degradedReason, analyticsEnabled, university }
//       The portal knows the session. tonAPI asks the portal the same
//       question with the session's portal cookies (its profile: uPortal's
//       /api/v5-1/userinfo, where Node reads the layout): answered here.
//   the same, once the portal has been signed in to again with the CAS
//       ticket (the portal's own session lapsed): answered here too, with
//       a portal session tonAPI opens and the gateway holds
//       (gateway/portal.rs). The session's cookie isn't written.
//   200 { authenticated: false, expired: true, … }, the cookie cleared: the
//       CAS no longer knows the ticket. Answered here (translate/expired.rs),
//       and Node is told.
//   200 { authenticated: false, … }: nobody signed in, at the university
//       the request is for. Answered here (gateway/nobody.rs).
//   200 { degraded: true } without a CAS ticket: Node's. Here such a
//       session is over (gateway/mod.rs: unheld).
//   500 { error }: the portal down, slow, or answering something else
//       (the CAS still knowing the ticket, or not saying). Answered here
//       (translate/failed.rs).
//
// Where the two differ, on purpose: a portal answering for another name
// than the session's (never seen) is the same 500 here, where Node takes
// the portal's word for who is signed in.

use tonapi_core::Profile;

use super::{another_student, json_answer, same_student, unanswered, Translated, Unanswered};
use crate::session::cookie::Session;
use crate::universities::University;

fn cookie_names<'a>(session: &'a Session, host: &str) -> Vec<&'a str> {
    let mut names: Vec<&str> = session.cookies.iter().filter(|cookie| cookie.is_for(host)).map(|cookie| cookie.name.as_str()).collect();
    names.sort_by_key(|name| (name.to_lowercase(), *name));
    names
}

// `analytics_enabled`: whether the statistics are on, as Node is set up
// (node.rs).
pub fn translate(asked: Result<&Profile, Unanswered>, session: &Session, university: &University, analytics_enabled: bool) -> Translated {
    let profile = match asked {
        Ok(profile) => profile,
        Err(why) => return unanswered(why),
    };
    if !same_student(profile, session) {
        return another_student();
    }
    // The session is read from its cookie at each request: `cookie`, as
    // Node's own first answer for a session (it says `runtime` after).
    json_answer(&serde_json::json!({
        "authenticated": true,
        "user": session.user,
        "sessionMode": null,
        "sessionSource": "cookie",
        "cookieNames": cookie_names(session, &university.portal_host),
        "casCookieNames": cookie_names(session, &university.cas_host),
        "canUseServerLaunch": true,
        "degraded": false,
        "degradedReason": null,
        "analyticsEnabled": analytics_enabled,
        "university": session.university,
    }))
}
