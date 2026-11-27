// GET /__ent_auth/launch and GET /__ent_auth/launch-preview: one of the
// university's services opened signed in, and whether the relay can
// (launch/ walks the sign-in; gateway/launch.rs asks it).
//
// Node's answers (server/entAuthApp.js), all given here for a session the
// gateway holds:
//
//   GET /__ent_auth/launch?url=<target>
//     302 to « / »: no target, one given twice, or one that isn't one of
//         the university's services over https. Never an open redirect.
//     302 to the target: asked from another site (Sec-Fetch-Site), which
//         is not the student asking; or no way to sign in for the browser
//         (the chain left the university's services, a federation the
//         browser must walk itself, a service down).
//     302 to the service with its CAS ticket in the address: the usual
//         case. The ticket signs the browser in once.
//     200, a page that posts a form to Moodle by itself: Moodle behind the
//         federation (Rennes), the SAML message handed to the browser.
//     302 to /login?session=expired, `X-Tafac-Session: expired`, the
//         cookie cleared: the CAS no longer knows the session (it is asked
//         when its login form shows on the way, or when the chain breaks).
//
//   GET /__ent_auth/launch-preview?url=<target>
//     400 { finalUrl, chain: [], useServerLaunch: false,
//           reason: 'invalid-target-url' }: no target, or not an address.
//     200 { finalUrl, chain: [{ status, url, location }], useServerLaunch,
//           reason, saml?, error?, canUseServerLaunch, degraded,
//           degradedReason }: where the target leads. The page reads
//         `useServerLaunch`; the rest is what the walk went through. A
//         service ticket's value is never in it (launch/tickets.rs).
//
// Node gave the chain as JSON for `?debug=1` on a development server (it
// holds the service tickets): never given here.
//
// Nobody signed in, another university: answered here too, as Node
// answered nobody (gateway/nobody.rs); a session without its CAS ticket is over.

use http::header::{CACHE_CONTROL, CONTENT_TYPE, LOCATION, SET_COOKIE};
use http::HeaderValue;

use super::{answer, json_response};
use crate::launch::moodle::Handoff;
use crate::launch::page;
use crate::launch::tickets::redacted;
use crate::launch::walk::{Previewed, Step};
use crate::node::{SESSION_EXPIRED, SESSION_HEADER};

// Where the browser goes once the session is found expired on the way to a
// service: the login form, which says why.
pub const LOGIN_EXPIRED_PATH: &str = "/login?session=expired";

// The app itself: where a target that isn't one is sent back.
pub const APP_PATH: &str = "/";

// A redirect of the relay's. Never kept: the address may carry a ticket.
pub fn redirect(location: &str) -> http::Response<Vec<u8>> {
    // An address that can't be a header's value goes back to the app.
    let location = HeaderValue::from_str(location).unwrap_or(HeaderValue::from_static(APP_PATH));
    answer(302).header(LOCATION, location).header(CACHE_CONTROL, "no-store").body(Vec::new()).unwrap()
}

// A session that ended, said to whoever opened the address: the header the
// page and the apps act on.
pub fn told_expired(mut response: http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
    response.headers_mut().insert(SESSION_HEADER, HeaderValue::from_static(SESSION_EXPIRED));
    response
}

// The session found expired on the way: to the login form, with what the
// gateway's own answer to an expired session carries (`ended`: the header,
// and the cookie taken away by the answer that ends the session).
pub fn expired(ended: &http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
    let mut response = told_expired(redirect(LOGIN_EXPIRED_PATH));
    for cookie in ended.headers().get_all(SET_COOKIE) {
        response.headers_mut().append(SET_COOKIE, cookie.clone());
    }
    response
}

// Moodle's sign-in, handed to the browser.
pub(crate) fn handoff(handoff: &Handoff) -> http::Response<Vec<u8>> {
    let page = page::posting(&page::MOODLE, handoff.action.as_str(), &handoff.fields);
    answer(200).header(CONTENT_TYPE, "text/html; charset=utf-8").header(CACHE_CONTROL, "no-store").body(page.into_bytes()).unwrap()
}

// What the session can do, as the session check says it: a session held
// here always has its CAS ticket.
fn with_ticket(body: &mut serde_json::Value) {
    body["canUseServerLaunch"] = true.into();
    body["degraded"] = false.into();
    body["degradedReason"] = serde_json::Value::Null;
}

fn preview_answer(status: u16, body: &serde_json::Value) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default())
}

// No target, or not an address. `written`: what was asked, as Node repeats
// it.
pub fn invalid_target(written: &str) -> http::Response<Vec<u8>> {
    preview_answer(400, &serde_json::json!({ "finalUrl": written, "chain": [], "useServerLaunch": false, "reason": "invalid-target-url" }))
}

// The browser opens the target by itself, without the session: not one of
// the university's services (`target-not-allowed`), or nobody the relay
// signs in for (`missing-session`: another site asked). `written`: the
// target as it was asked (a list, when it was given more than once).
pub fn by_the_browser(written: &serde_json::Value, reason: &str) -> http::Response<Vec<u8>> {
    preview_answer(200, &serde_json::json!({ "finalUrl": written, "chain": [], "useServerLaunch": false, "reason": reason }))
}

// Moodle: the relay signs in to it, by the way `reason` names.
pub fn moodle(written: &str, reason: &str) -> http::Response<Vec<u8>> {
    let mut body = serde_json::json!({ "finalUrl": written, "chain": [], "useServerLaunch": true, "reason": reason });
    with_ticket(&mut body);
    preview_answer(200, &body)
}

// Where the target led.
pub(crate) fn preview(previewed: &Previewed) -> http::Response<Vec<u8>> {
    let chain: Vec<Step> = previewed
        .chain
        .iter()
        .map(|step| Step { status: step.status, url: redacted(&step.url), location: step.location.as_deref().map(redacted) })
        .collect();
    let mut body = serde_json::json!({
        "finalUrl": redacted(&previewed.final_url),
        "chain": chain,
        "useServerLaunch": previewed.use_server_launch,
        "reason": previewed.reason,
    });
    if previewed.saml {
        body["saml"] = true.into();
    }
    if let Some(error) = previewed.error {
        body["error"] = error.into();
    }
    with_ticket(&mut body);
    preview_answer(200, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::cookie::{clear_cookie, clears_cookie, PRODUCTION_COOKIE};
    use crate::translate::expired;
    use crate::ANSWERED_BY;

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn a_redirect_goes_where_it_is_told_and_is_never_kept() {
        let response = redirect("https://moodle.exemple.test/login/index.php?ticket=ST-1");
        assert_eq!(response.status(), 302);
        assert_eq!(response.headers()[LOCATION], "https://moodle.exemple.test/login/index.php?ticket=ST-1");
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert!(response.body().is_empty() && response.headers().get(SESSION_HEADER).is_none());
        // What can't be written in a header is no address to send to.
        assert_eq!(redirect("https://a.test/\r\nset-cookie: x=1").headers()[LOCATION], "/");
    }

    #[test]
    fn an_expired_session_goes_to_the_login_form_with_the_header_and_the_cookie_taken() {
        let response = expired(&expired::answer(None, Some(PRODUCTION_COOKIE)));
        assert_eq!(response.status(), 302);
        assert_eq!(response.headers()[LOCATION], "/login?session=expired");
        assert_eq!(response.headers()["x-tafac-session"], "expired");
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        assert!(clears_cookie(response.headers()[SET_COOKIE].to_str().unwrap(), PRODUCTION_COOKIE));
        assert_eq!(response.headers()[SET_COOKIE], clear_cookie(PRODUCTION_COOKIE).as_str());
        // Found expired by another request at the same moment: the cookie
        // isn't this answer's to take.
        let later = expired(&expired::answer(None, None));
        assert_eq!(later.headers()["x-tafac-session"], "expired");
        assert!(later.headers().get(SET_COOKIE).is_none());
    }

    #[test]
    fn the_previews_answers_are_nodes_field_for_field() {
        let invalid = invalid_target("javascript:alert(1)");
        assert_eq!(invalid.status(), 400);
        assert_eq!(body(&invalid), serde_json::json!({ "finalUrl": "javascript:alert(1)", "chain": [], "useServerLaunch": false, "reason": "invalid-target-url" }));

        let elsewhere = by_the_browser(&"https://evil.example/".into(), "target-not-allowed");
        assert_eq!(elsewhere.status(), 200);
        assert_eq!(body(&elsewhere), serde_json::json!({ "finalUrl": "https://evil.example/", "chain": [], "useServerLaunch": false, "reason": "target-not-allowed" }));

        assert_eq!(
            body(&moodle("https://foad.exemple.test/my/", "server-saml-relay")),
            serde_json::json!({
                "finalUrl": "https://foad.exemple.test/my/", "chain": [], "useServerLaunch": true, "reason": "server-saml-relay",
                "canUseServerLaunch": true, "degraded": false, "degradedReason": null,
            })
        );
    }

    // Node's own case (tests/routeErrors.test.ts).
    #[test]
    fn a_service_tickets_value_never_leaves_with_the_preview() {
        let previewed = Previewed {
            final_url: "https://moodle.example.fr/?ticket=ST-1-secret".to_string(),
            chain: vec![Step { status: 302, url: "https://cas.example.fr/login?service=x".to_string(), location: Some("https://moodle.example.fr/?ticket=ST-1-secret".to_string()) }],
            use_server_launch: true,
            saml: false,
            reason: "cas-ticket",
            error: None,
        };
        let response = preview(&previewed);
        assert!(!String::from_utf8_lossy(response.body()).contains("secret"));
        assert_eq!(
            body(&response),
            serde_json::json!({
                "finalUrl": "https://moodle.example.fr/?ticket=ST-redacted",
                "chain": [{ "status": 302, "url": "https://cas.example.fr/login?service=x", "location": "https://moodle.example.fr/?ticket=ST-redacted" }],
                "useServerLaunch": true, "reason": "cas-ticket",
                "canUseServerLaunch": true, "degraded": false, "degradedReason": null,
            })
        );

        // A federation, and a chain that broke: said as Node said them.
        let saml = Previewed { final_url: "https://a.test/".to_string(), chain: Vec::new(), use_server_launch: false, saml: true, reason: "saml-browser-handoff", error: None };
        assert_eq!(body(&preview(&saml))["saml"], true);
        let broken = Previewed { final_url: "https://a.test/".to_string(), chain: Vec::new(), use_server_launch: false, saml: false, reason: "preview-error", error: Some("preview-error") };
        assert_eq!((&body(&preview(&broken))["error"], body(&preview(&broken)).get("saml")), (&"preview-error".into(), None));
    }

    #[test]
    fn moodles_sign_in_is_a_page_that_posts_the_form() {
        let handed = Handoff { action: url::Url::parse("https://foad.exemple.test/Shibboleth.sso/SAML2/POST").unwrap(), fields: vec![("SAMLResponse".to_string(), "PHNhbWw+".to_string())] };
        let response = handoff(&handed);
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()[CONTENT_TYPE], "text/html; charset=utf-8");
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        let page = String::from_utf8_lossy(response.body()).to_string();
        assert!(page.contains(r#"action="https://foad.exemple.test/Shibboleth.sso/SAML2/POST""#) && page.contains(r#"name="SAMLResponse" value="PHNhbWw+""#));
    }
}
