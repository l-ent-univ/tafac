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
//   the same, once Node has signed in to the portal again with the CAS
//       ticket (the portal's session lapsed, tonAPI's `session_expired`):
//       Node. The session it opens is the one it lists the applications
//       with; tonAPI has no CAS ticket to open another.
//   200 { authenticated: false, expired: true, … }, the cookie cleared: the
//       CAS no longer knows the ticket either. Node, which ends the session.
//   200 { authenticated: false, … }: nobody signed in. Node (nothing is
//       asked of tonAPI without a session).
//   200 for the demo account, and 200 { degraded: true } without a CAS
//       ticket: Node.
//   500 { error }: the portal down, slow, or answering something else.
//       Node, which asks it itself and words the error.

use tonapi_core::Profile;

use super::{another_student, json_answer, same_student, Translated, Unanswered};
use crate::session_link::NodeSession;
use crate::universities::University;

fn cookie_names<'a>(session: &'a NodeSession, host: &str) -> Vec<&'a str> {
    let mut names: Vec<&str> = session.cookies.iter().filter(|cookie| cookie.is_for(host)).map(|cookie| cookie.name.as_str()).collect();
    names.sort_by_key(|name| (name.to_lowercase(), *name));
    names
}

// `analytics_enabled`: what Node says of itself there (lib.rs asks it).
pub fn translate(asked: Result<&Profile, Unanswered>, session: &NodeSession, university: &University, analytics_enabled: bool) -> Translated {
    let profile = match asked {
        Ok(profile) => profile,
        Err(why) => return Translated::Node(why.to_string()),
    };
    if !same_student(profile, session) {
        return another_student();
    }
    // The session is read from its cookie at each request: `cookie`, as
    // Node's own first answer after it starts (it says `runtime` after).
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
