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
//   200 { authenticated: true, account: <the portal's guest> }: the portal's
//       session lapsed (tonAPI's `session_expired`) and the portal says so
//       with a guest's token, which Node passes on. Node, as before.
//   401 { error: 'session_expired' } with X-Tafac-Session: expired, the
//       cookie cleared: the portal answers something else than a token and
//       the CAS no longer knows the ticket. Node, which ends the session.
//   200 { authenticated: false, account: null }: nobody signed in. Node.
//   200 for the demo account: Node.
//   500 { error }: Node, which asks the portal itself and words the error.

use tonapi_core::Profile;

use super::{another_student, json_answer, same_student, Translated, Unanswered};
use crate::session::cookie::NodeSession;

pub fn translate(asked: Result<&Profile, Unanswered>, session: &NodeSession) -> Translated {
    let profile = match asked {
        Ok(profile) => profile,
        Err(why) => return Translated::Node(why.to_string()),
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
