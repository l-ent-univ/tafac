// Any moved route, once the CAS says the session is over.
//
// Node's answers when it finds a session expired (server/sessionExpiry,
// server/entAuthApp.js: endSession, answerIfSessionExpired), given here now
// for the routes that moved:
//
//   GET /__ent_auth/session
//       200 { authenticated: false, expired: true, user: null, … }: the
//       page says why on its login form.
//   any other route
//       401 { error: 'session_expired' }, `X-Tafac-Session: expired`: the
//       page signs out on the header (src/sessionSignal.js), the desktop
//       app signs in again on it (src-tauri/src/signin.rs).
//
// The answer that ends the session carries the header whatever the route,
// and takes the session's cookie away. A later request that still shows the
// cookie is told the same, and its cookie isn't touched: the student may
// have signed in again since.

use http::header::SET_COOKIE;
use http::HeaderValue;

use super::json_response;
use crate::node::{SESSION_EXPIRED, SESSION_HEADER};
use crate::session::cookie::clear_cookie;

const SESSION_EXPIRED_CODE: &str = "session_expired";

// `session_check`: for GET /__ent_auth/session, the session's university
// and whether the statistics are on (`analyticsEnabled`); None for any
// other route. `ends_it`: the session cookie's name, on the answer that
// ends the session.
pub fn answer(session_check: Option<(&str, bool)>, ends_it: Option<&str>) -> http::Response<Vec<u8>> {
    let (status, body) = match session_check {
        Some((university, analytics_enabled)) => (
            200,
            serde_json::json!({
                "authenticated": false,
                "expired": true,
                "user": null,
                "sessionMode": null,
                "sessionSource": null,
                "degraded": false,
                "degradedReason": null,
                "canUseServerLaunch": false,
                "analyticsEnabled": analytics_enabled,
                "university": university,
            }),
        ),
        None => (401, serde_json::json!({ "error": SESSION_EXPIRED_CODE })),
    };
    let mut response = json_response(status, serde_json::to_vec(&body).unwrap_or_default());
    // Node's session check says the header only as it ends the session.
    if session_check.is_none() || ends_it.is_some() {
        response.headers_mut().insert(SESSION_HEADER, HeaderValue::from_static(SESSION_EXPIRED));
    }
    if let Some(value) = ends_it.and_then(|cookie_name| clear_cookie(cookie_name).parse().ok()) {
        response.headers_mut().append(SET_COOKIE, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::cookie::{clears_cookie, PRODUCTION_COOKIE};

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_answer_that_ends_the_session_says_so_and_takes_the_cookie() {
        let check = answer(Some(("univ-exemple", true)), Some(PRODUCTION_COOKIE));
        assert_eq!(check.status(), 200);
        assert_eq!(
            body(&check),
            serde_json::json!({
                "authenticated": false, "expired": true, "user": null, "sessionMode": null, "sessionSource": null,
                "degraded": false, "degradedReason": null, "canUseServerLaunch": false, "analyticsEnabled": true, "university": "univ-exemple",
            })
        );
        let other = answer(None, Some(PRODUCTION_COOKIE));
        assert_eq!((other.status(), body(&other)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "session_expired" })));
        for response in [check, other] {
            assert_eq!(response.headers()["x-tafac-session"], "expired");
            assert!(clears_cookie(response.headers()[SET_COOKIE].to_str().unwrap(), PRODUCTION_COOKIE));
        }
    }

    #[test]
    fn a_later_request_is_told_the_same_and_keeps_its_cookie() {
        let other = answer(None, None);
        assert_eq!(other.status(), 401);
        assert_eq!(other.headers()["x-tafac-session"], "expired");
        assert!(other.headers().get(SET_COOKIE).is_none());
        // The session check says it in its body, as Node's does.
        let check = answer(Some(("univ-exemple", false)), None);
        assert_eq!((&body(&check)["expired"], &body(&check)["analyticsEnabled"]), (&true.into(), &false.into()));
        assert!(check.headers().get("x-tafac-session").is_none() && check.headers().get(SET_COOKIE).is_none());
    }
}
