// GET /__ent_auth/account: the student's name and address.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, account, sessionMode }
//       `account` is what the portal says of the student: the claims of
//       uPortal's /api/v5-1/userinfo. tonAPI reads the same place into its
//       profile: answered here, with the claims the profile holds, under
//       their names there. They are the ones the page reads (src/App.jsx:
//       name, given_name, family_name, email); the token's own claims (aud,
//       exp, iat, iss), which Node passes on and the page never reads, are
//       not in tonAPI's profile and so not here.
//   the same, the portal's own session lapsed while the CAS still knows
//       the ticket: answered here, with a portal session tonAPI opens with
//       the ticket (Node passed the portal's guest token on).
//   401 { error: 'session_expired' } with X-Tafac-Session: expired, the
//       cookie cleared: the CAS no longer knows the ticket. Answered here
//       (translate/expired.rs), and Node is told.
//   200 { authenticated: false, account: null }: nobody signed in. Node.
//   500 { error }: the portal down, slow, or answering something else, or
//       for another name than the session's. Answered here
//       (translate/failed.rs).

use tonapi_core::Profile;

use super::{another_student, json_answer, same_student, unanswered, Translated, Unanswered};
use crate::session::cookie::Session;

pub fn translate(asked: Result<&Profile, Unanswered>, session: &Session) -> Translated {
    let profile = match asked {
        Ok(profile) => profile,
        Err(why) => return unanswered(why),
    };
    if !same_student(profile, session) {
        return another_student();
    }
    let mut account = serde_json::Map::new();
    account.insert("sub".to_string(), profile.username.clone().into());
    for (claim, value) in [
        ("name", &profile.display_name),
        ("given_name", &profile.first_name),
        ("family_name", &profile.last_name),
        ("email", &profile.email),
    ] {
        if let Some(value) = value {
            account.insert(claim.to_string(), value.clone().into());
        }
    }
    json_answer(&serde_json::json!({ "authenticated": true, "account": account, "sessionMode": null }))
}
