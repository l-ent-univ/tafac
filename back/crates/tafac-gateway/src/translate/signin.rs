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
//       or the portal down). Answered here.
//   429 { error }, Retry-After: too many failed attempts from this address
//       or for this login. Answered here (gateway/attempts.rs).
//   401 { error, code: 'mfa_required' | 'mfa_invalid' | 'mfa_send_failed',
//       mfa }, 429 { code: 'mfa_send_limit' }: the CAS asks for a one-time
//       code. Node: it reads Rennes' code page and has a code sent, which
//       tonAPI doesn't. The session Node makes is one like any other.
//   200 { …, sessionMode: 'demo' }: the demo account. Node.
//   400 { error }: no login or no password. Node.
//   any of these for another university than routes.rs': Node.
//
// The page reads `error` for its wording (src/App.jsx:
// getFrenchAuthErrorMessage looks for « CAS login failed », « fetch »…): the
// sentences below are Node's own, or hold the word the page looks for.

use http::header::{RETRY_AFTER, SET_COOKIE};

use super::json_response;
use crate::session::cookie::{clear_cookie, set_cookie};

// Node's own sentences.
const REFUSED: &str = "CAS login failed. Check your username and password.";
const NO_PORTAL_SESSION: &str = "CAS login completed, but the portal session was not established.";
const TOO_MANY: &str = "Too many login attempts. Please try again later.";
// Node says « fetch failed » there, and the page words it from « fetch ».
const UNREACHABLE: &str = "The university's sign-in could not be reached (fetch failed).";
// What the desktop app forgets its kept login on (server/casLogin/refusal.ts).
const LOGIN_REFUSED: &str = "login_refused";

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
// away. Answered here for a session the gateway holds; Node's for the demo
// account, another university, a request without a session.
pub fn signed_out(cookie_name: &str) -> http::Response<Vec<u8>> {
    let mut response = json(200, &serde_json::json!({ "authenticated": false }));
    if let Ok(value) = clear_cookie(cookie_name).parse() {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

// What Node's own answer to a login says of the attempt, for the limits:
// a right password waiting for its code is not a failed attempt
// (`mfa_required`, `mfa_send_failed`), and Node's own « wait » (429) is not
// one more.
#[derive(Debug, PartialEq)]
pub enum NodeSaid {
    SignedIn,
    Failed,
    Neither,
}

pub fn node_said(status: u16, body: &[u8]) -> NodeSaid {
    let answer: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let code = answer.get("code").and_then(|code| code.as_str());
    match status {
        200 if answer.get("authenticated").and_then(|value| value.as_bool()) == Some(true) => NodeSaid::SignedIn,
        401 if !matches!(code, Some("mfa_required" | "mfa_send_failed")) => NodeSaid::Failed,
        _ => NodeSaid::Neither,
    }
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
        let response = signed_in("jdoe", "univ-exemple", (PRODUCTION_COOKIE, "v1.a.b.c"));
        assert_eq!(response.status(), 200);
        assert_eq!(body(&response), serde_json::json!({ "authenticated": true, "user": "jdoe", "sessionMode": null, "university": "univ-exemple" }));
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
    fn nodes_own_answer_is_read_for_the_limits() {
        assert_eq!(node_said(200, br#"{"authenticated":true,"user":"jdoe"}"#), NodeSaid::SignedIn);
        assert_eq!(node_said(401, br#"{"error":"CAS login failed.","code":"login_refused"}"#), NodeSaid::Failed);
        assert_eq!(node_said(401, br#"{"error":"Invalid OTP.","code":"mfa_invalid"}"#), NodeSaid::Failed);
        assert_eq!(node_said(401, br#"{"error":"fetch failed"}"#), NodeSaid::Failed);
        // A right password waiting for its code; Node's own limits; its refusals.
        assert_eq!(node_said(401, br#"{"error":"MFA required.","code":"mfa_required","mfa":{"methods":null,"sent":null}}"#), NodeSaid::Neither);
        assert_eq!(node_said(401, br#"{"error":"Could not send the code.","code":"mfa_send_failed"}"#), NodeSaid::Neither);
        assert_eq!(node_said(429, br#"{"error":"Too many login attempts. Please try again later."}"#), NodeSaid::Neither);
        assert_eq!(node_said(400, br#"{"error":"Username and password are required."}"#), NodeSaid::Neither);
        assert_eq!(node_said(502, b"not json"), NodeSaid::Neither);
    }
}
