// The CAS: a student signed in, signed out, and whether it still knows a
// session.
//
//   sign_in      tonAPI's own sign-in: the CAS's form reached through the
//                portal's entry, the login and password posted once, the
//                way back to the portal followed, the student's component
//                looked for. What comes back is tonAPI's session: the
//                university's cookies (the CAS ticket, the portal's
//                session, what it got while it looked for the component)
//   sign_out     the CAS told to end the session behind the ticket
//   still_known  the CAS asked, with the ticket, whether the session lives:
//                only its login page can say a session is over
//
// Each presents itself to the CAS as Node does (node.rs): the CAS binds its
// ticket to the User-Agent that signed in.

use std::time::Duration;

use tonapi_core::ErrorCode;
use tonapi_providers::{LoginInput, LoginOutcome, NetSettings};
use tonapi_session::SessionData;

use super::{bounded, session_data, Unanswered};
use crate::session::cookie::Session;
use crate::session::handed;
use crate::universities::University;

// How long a sign-in may take: the CAS, the portal, then the component,
// which is the slow one (the university's planning is asked).
const SIGN_IN_PATIENCE: Duration = Duration::from_secs(45);
// The page waits on a sign-out, and on the answer that finds a session
// expired.
const CAS_PATIENCE: Duration = Duration::from_secs(6);
// tonAPI's session wants an end. The cookie has its own (thirty days), and
// the CAS ends its ticket long before.
const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;

pub(crate) enum SignIn {
    // Signed in: tonAPI's session, with the university's cookies.
    Done(Box<SessionData>),
    // The CAS answered the form itself: a wrong login or password, a locked
    // account, a password to change. Its own words, when it had some.
    Refused(Option<String>),
    // The CAS asks for a second factor, or answered a page tonAPI doesn't
    // know: nothing says the login is wrong, and nothing says it is right.
    Unsure(&'static str),
    // The CAS didn't answer, or tonAPI failed.
    Unreachable(Unanswered),
}

pub(crate) async fn sign_in(university: &University, username: &str, password: &str, net: NetSettings) -> SignIn {
    let input = LoginInput { username, password, establishment: None, previous_cookies: Vec::new(), now: chrono::Utc::now(), ttl_secs: SESSION_SECONDS, net };
    match bounded(SIGN_IN_PATIENCE, tonapi_providers::login(&university.settings, input)).await {
        Ok(Ok(LoginOutcome::SignedIn(session))) => SignIn::Done(Box::new(session)),
        Ok(Ok(LoginOutcome::SecondFactor(..))) => SignIn::Unsure("the CAS asks for a second factor"),
        Ok(Err(problem)) => match problem.code {
            ErrorCode::InvalidCredentials => SignIn::Refused(problem.detail),
            ErrorCode::AccountActionRequired => SignIn::Refused(Some("The university asks for an action on the account (a password to change).".to_string())),
            // A step of the CAS's tonAPI doesn't take (Rennes' code page).
            ErrorCode::NotImplemented => SignIn::Unsure("the CAS asks for a step tonAPI doesn't take"),
            ErrorCode::UpstreamChanged => SignIn::Unsure("the CAS answered a page tonAPI doesn't know"),
            code => SignIn::Unreachable(Unanswered::Problem(code)),
        },
        Err(why) => SignIn::Unreachable(why),
    }
}

// The CAS told to end the session, with the session's ticket. Best effort:
// a CAS that doesn't answer doesn't keep the student signed in here.
pub(crate) async fn sign_out(university: &University, session: &Session, net: NetSettings) {
    let Ok(data) = session_data(university, session, handed::cas_cookies(university, session)) else { return };
    let _ = bounded(CAS_PATIENCE, tonapi_providers::logout(&university.settings, &data, net)).await;
}

// Whether the CAS still knows the session: its login page, asked with the
// ticket, shows its form again only once the ticket is worth nothing. None
// when it doesn't say (down, slow, another page): not a session ended.
pub(crate) async fn still_known(university: &University, session: &Session, net: NetSettings) -> Option<bool> {
    let ticket = handed::cas_cookies(university, session);
    if ticket.is_empty() {
        return Some(false);
    }
    let data = session_data(university, session, ticket).ok()?;
    bounded(CAS_PATIENCE, tonapi_providers::still_signed_in(&university.settings, &data, net)).await.ok()?.ok()
}
