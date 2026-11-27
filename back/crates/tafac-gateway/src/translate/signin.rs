// POST /__ent_auth/login and POST /__ent_auth/logout: a session made, a
// session ended.
//
// Node's answers to a login (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, user, sessionMode, university }, the
//       session's cookie set: tonAPI signed in at the CAS: answered here,
//       with the cookie written here (session/cookie.rs). `user` is the
//       portal's name for the student, as Node takes it from the portal.
//   401 { error, code: 'login_refused' }: the CAS answered the form itself
//       (a wrong password, a locked account). Answered here: tonAPI's
//       `invalid_credentials`. The desktop app forgets the login it kept on
//       this code (src-tauri/src/signin.rs), so it is said for nothing else.
//   401 { error }, no code: the sign-in couldn't be tried through (the CAS
//       or the portal down, a page of the CAS's tonAPI doesn't know).
//       Answered here.
//   429 { error }, Retry-After: too many failed attempts from this address
//       or for this login. Answered here (gateway/attempts.rs).
//   401 { error, code: 'mfa_required', mfa: { methods, sent } }: the CAS
//       took the password and asks for a one-time code (Esup OTP).
//       `methods`: what the student can type a code from ({ app, sms, mail }:
//       an authenticator application, the masked number and address a code
//       can be sent to), null when the university's API doesn't say; `sent`:
//       the transport ('sms', 'mail') a code was just sent by. Answered
//       here: tonAPI reads the code page and asks the API.
//   401 { error, code: 'mfa_invalid' }: the CAS refused the code, or the
//       code is not one (four to ten digits). Answered here.
//   401 { error, code: 'mfa_send_failed', mfa }: the code asked for by SMS
//       or mail didn't leave. Answered here.
//   429 { error, code: 'mfa_send_limit' }, Retry-After: too many codes sent
//       to this login. Answered here (gateway/attempts.rs).
//   400 { error }: no login or no password. Answered here
//       (gateway/signin.rs).
//   400 { error: 'Unknown university "<id>".' }: a university the gateway
//       doesn't serve, Node's words for one it doesn't know. Answered here,
//       Node never asked.
//
// The page reads `error` for its wording (src/App.jsx:
// getFrenchAuthErrorMessage looks for « CAS login failed », « fetch »…): the
// sentences below are Node's own, or hold the word the page looks for.

use http::header::{RETRY_AFTER, SET_COOKIE};

use tonapi_providers::OtpTransport;

use super::json_response;
use crate::session::cookie::{clear_cookie, set_cookie};
use crate::tonapi::signin::Ways;

// Node's own sentences.
const REFUSED: &str = "CAS login failed. Check your username and password.";
const NO_PORTAL_SESSION: &str = "CAS login completed, but the portal session was not established.";
const TOO_MANY: &str = "Too many login attempts. Please try again later.";
const CODE_WANTED: &str = "MFA required.";
const CODE_REFUSED: &str = "Invalid OTP.";
const CODE_NOT_SENT: &str = "Could not send the code.";
const TOO_MANY_CODES: &str = "Too many codes requested. Please try again later.";
// Node says what it couldn't read there; the page words both the same.
const UNKNOWN_PAGE: &str = "The university's sign-in answered a page Tafac doesn't know.";
// Node says « fetch failed » there, and the page words it from « fetch ».
const UNREACHABLE: &str = "The university's sign-in could not be reached (fetch failed).";
// What the desktop app forgets its kept login on (server/casLogin/refusal.ts).
const LOGIN_REFUSED: &str = "login_refused";
// The second factor's codes: a right password waiting for its code, a code
// refused, a code that didn't leave, too many codes sent.
const MFA_REQUIRED: &str = "mfa_required";
const MFA_INVALID: &str = "mfa_invalid";
const MFA_SEND_FAILED: &str = "mfa_send_failed";
const MFA_SEND_LIMIT: &str = "mfa_send_limit";

fn json(status: u16, body: &serde_json::Value) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default())
}

// Signed in: `cookie`, the new session's (its name and its value).
pub fn signed_in(user: &str, university: &str, cookie: (&str, &str)) -> http::Response<Vec<u8>> {
    let mut response = json(200, &serde_json::json!({ "authenticated": true, "user": user, "sessionMode": null, "university": university }));
    if let Ok(value) = set_cookie(cookie.0, cookie.1).parse() {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

// The CAS refused the login: `said`, its own words when it had some.
pub fn refused(said: Option<&str>) -> http::Response<Vec<u8>> {
    let error = said.map(str::trim).filter(|said| !said.is_empty()).unwrap_or(REFUSED);
    json(401, &serde_json::json!({ "error": error, "code": LOGIN_REFUSED }))
}

// The CAS let the login through and the portal knows nobody: Node's words.
pub fn no_portal_session() -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": NO_PORTAL_SESSION }))
}

pub fn unreachable() -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": UNREACHABLE }))
}

// Too many failed attempts: `seconds` until the next one may be made.
pub fn too_many(seconds: u64) -> http::Response<Vec<u8>> {
    let mut response = json(429, &serde_json::json!({ "error": TOO_MANY }));
    response.headers_mut().insert(RETRY_AFTER, seconds.into());
    response
}

// POST /__ent_auth/logout: 200 { authenticated: false }, the cookie taken
// away. Answered here for anyone (gateway/nobody.rs).
pub fn signed_out(cookie_name: &str) -> http::Response<Vec<u8>> {
    let mut response = json(200, &serde_json::json!({ "authenticated": false }));
    if let Ok(value) = clear_cookie(cookie_name).parse() {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

// `mfa` of a second factor's answer: `methods` and `sent`, as Node says them.
fn second_factor(ways: Option<&Ways>, sent: Option<OtpTransport>) -> serde_json::Value {
    let methods = ways.map(|ways| serde_json::json!({ "app": ways.app, "sms": ways.sms, "mail": ways.mail }));
    serde_json::json!({ "methods": methods, "sent": sent.map(OtpTransport::as_str) })
}

// The CAS took the password and asks for a one-time code. `sent`: the
// transport a code just left by.
pub(crate) fn code_wanted(ways: Option<&Ways>, sent: Option<OtpTransport>) -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": CODE_WANTED, "code": MFA_REQUIRED, "mfa": second_factor(ways, sent) }))
}

// The CAS refused the code, or it is not a code.
pub fn code_refused() -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": CODE_REFUSED, "code": MFA_INVALID }))
}

// The code the student asked for didn't leave.
pub(crate) fn code_not_sent(ways: Option<&Ways>) -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": CODE_NOT_SENT, "code": MFA_SEND_FAILED, "mfa": second_factor(ways, None) }))
}

// Too many codes sent to this login: `seconds` until one more may be asked.
pub fn too_many_codes(seconds: u64) -> http::Response<Vec<u8>> {
    let mut response = json(429, &serde_json::json!({ "error": TOO_MANY_CODES, "code": MFA_SEND_LIMIT }));
    response.headers_mut().insert(RETRY_AFTER, seconds.into());
    response
}

// After the code the CAS showed its login form again: Node's words for a
// sign-in to start over, and no code (the desktop app keeps its login).
pub fn started_over() -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": REFUSED }))
}

// The CAS answered a page tonAPI doesn't know: nothing says the login is
// wrong, so no code.
pub fn unknown_page() -> http::Response<Vec<u8>> {
    json(401, &serde_json::json!({ "error": UNKNOWN_PAGE }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::cookie::{clears_cookie, PRODUCTION_COOKIE};
    use crate::ANSWERED_BY;

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn a_sign_in_is_nodes_answer_with_the_sessions_cookie() {
        let response = signed_in("jdoe", "univ-rennes-2", (PRODUCTION_COOKIE, "v1.a.b.c"));
        assert_eq!(response.status(), 200);
        assert_eq!(body(&response), serde_json::json!({ "authenticated": true, "user": "jdoe", "sessionMode": null, "university": "univ-rennes-2" }));
        assert_eq!(response.headers()[SET_COOKIE], "__Host-lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax");
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(response.headers()["cache-control"], "no-store");
    }

    #[test]
    fn a_refusal_names_itself_and_nothing_else_does() {
        let response = refused(None);
        assert_eq!(response.status(), 401);
        assert_eq!(body(&response), serde_json::json!({ "error": "CAS login failed. Check your username and password.", "code": "login_refused" }));
        assert_eq!(body(&refused(Some(" Invalid credentials. ")))["error"], "Invalid credentials.");
        assert_eq!(body(&refused(Some(" ")))["error"], REFUSED);

        // The desktop app keeps its login on these: no code.
        for response in [no_portal_session(), unreachable()] {
            assert_eq!(response.status(), 401);
            assert!(body(&response).get("code").is_none());
        }
        // The word the page looks for to say the service can't be reached.
        assert!(body(&unreachable())["error"].as_str().unwrap().contains("fetch"));
    }

    #[test]
    fn too_many_attempts_say_how_long_to_wait() {
        let response = too_many(290);
        assert_eq!(response.status(), 429);
        assert_eq!(response.headers()[RETRY_AFTER], "290");
        assert_eq!(body(&response), serde_json::json!({ "error": "Too many login attempts. Please try again later." }));
    }

    #[test]
    fn a_sign_out_takes_the_cookie_away() {
        let response = signed_out(PRODUCTION_COOKIE);
        assert_eq!((response.status(), body(&response)), (http::StatusCode::OK, serde_json::json!({ "authenticated": false })));
        assert!(clears_cookie(response.headers()[SET_COOKIE].to_str().unwrap(), PRODUCTION_COOKIE));
    }

    #[test]
    fn a_second_factor_is_said_as_node_says_it() {
        let ways = Ways { app: false, sms: None, mail: Some("j***@exemple.test".to_string()) };
        let response = code_wanted(Some(&ways), Some(OtpTransport::Mail));
        assert_eq!(response.status(), 401);
        assert_eq!(
            body(&response),
            serde_json::json!({ "error": "MFA required.", "code": "mfa_required", "mfa": { "methods": { "app": false, "sms": null, "mail": "j***@exemple.test" }, "sent": "mail" } })
        );
        // The API didn't say: no methods, and the form still takes a code.
        assert_eq!(body(&code_wanted(None, None))["mfa"], serde_json::json!({ "methods": null, "sent": null }));

        assert_eq!((code_refused().status(), body(&code_refused())), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "Invalid OTP.", "code": "mfa_invalid" })));
        let not_sent = code_not_sent(Some(&Ways { app: true, sms: Some("06******12".to_string()), mail: None }));
        assert_eq!(not_sent.status(), 401);
        assert_eq!(
            body(&not_sent),
            serde_json::json!({ "error": "Could not send the code.", "code": "mfa_send_failed", "mfa": { "methods": { "app": true, "sms": "06******12", "mail": null }, "sent": null } })
        );
        let wait = too_many_codes(120);
        assert_eq!((wait.status(), wait.headers()[RETRY_AFTER].to_str().unwrap()), (http::StatusCode::TOO_MANY_REQUESTS, "120"));
        assert_eq!(body(&wait), serde_json::json!({ "error": "Too many codes requested. Please try again later.", "code": "mfa_send_limit" }));

        // Neither says the login is wrong: no code for the desktop app to
        // forget its kept login on.
        for response in [started_over(), unknown_page()] {
            assert_eq!(response.status(), 401);
            assert!(body(&response).get("code").is_none());
        }
    }
}
