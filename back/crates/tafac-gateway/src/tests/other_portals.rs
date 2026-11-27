// The gateway at a university whose portal is not uPortal, on the two other
// made-up campuses (testing/other_portals.rs): a Drupal portal, as Rennes
// 2's, and iSorbonne, the Sorbonne Nouvelle's. Their settings are tonAPI's
// own files for the two universities, the addresses aside.
//
// Both universities are among routes.rs': these tests go through a gateway
// made for their campus, and the last one through the gateway that runs.
// What a real account confirmed is in back/README.md.

use http::header::CONTENT_TYPE;
use http::{HeaderMap, Method};

use super::{asked, body_of, cookie_set, json, never, ACCOUNT, GET, LOGIN, LOGOUT, NO_HEADERS, POST, SESSION};
use crate::testing::*;
use crate::{routes, Gateway, NodeAnswer, NodeRequest, ANSWERED_BY};

const APPS: &str = "/__ent_auth/apps";
const DEADLINES: &str = "/__ent_auth/moodle/deadlines";
const CAS: &str = "/cas/login";

fn campuses() -> [OtherCampus; 2] {
    [drupal_campus(), isorbonne_campus()]
}

// Node, as much of it as these tests ask: « fine » to what it is told (a
// session that ended), and nothing else is asked of it.
fn node_told(request: NodeRequest) -> std::future::Ready<NodeAnswer> {
    assert_eq!((request.method(), request.uri().path()), (&Method::POST, LOGOUT));
    std::future::ready(Some(json(200, "{}")))
}

fn get(gateway: &Gateway, target: &str, cookie: &str) -> Option<http::Response<Vec<u8>>> {
    block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), node_told))
}

// A route's answer made here; None when it was left to Node.
fn ask(gateway: &Gateway, campus: &OtherCampus, target: &str, cookie: &str) -> Option<serde_json::Value> {
    let response = get(gateway, target, cookie)?;
    assert_eq!(response.status(), 200, "{target} at {}", campus.id());
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert!(cookie_set(&response).is_none());
    Some(body_of(&response))
}

fn login(campus: &OtherCampus, username: &str) -> (HeaderMap, String) {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    (headers, serde_json::json!({ "username": username, "password": PASSWORD, "university": campus.id() }).to_string())
}

// How many requests went to the CAS's login page.
fn asked_the_cas(campus: &OtherCampus) -> usize {
    campus.asked(CAS)
}

#[test]
fn a_sign_in_makes_the_session_and_node_is_asked_nothing() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let (headers, body) = login(&campus, " jdoe ");
        let response = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, body.as_bytes()), || None, never)).unwrap();

        // Node's own answer to a login, field for field.
        assert_eq!(response.status(), 200, "{}", campus.id());
        assert_eq!(body_of(&response), serde_json::json!({ "authenticated": true, "user": "jdoe", "sessionMode": null, "university": campus.id() }));
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        // The password was posted once, to the CAS, and nowhere else.
        assert_eq!(*campus.posted.lock().unwrap(), [CAS]);

        // The cookie is a session like any other: the CAS ticket and the
        // portal's session, which the portal knows.
        let cookie = cookie_set(&response).unwrap();
        let held = gateway.signed_in(Some(&cookie)).unwrap();
        assert_eq!((held.session.user.as_str(), held.session.university.as_str()), ("jdoe", campus.id()));
        let names: Vec<_> = held.session.cookies.iter().map(|cookie| cookie.name.as_str()).collect();
        assert_eq!(names, ["TGC", campus.portal_cookie()]);
        assert_eq!(ask(&gateway, &campus, SESSION, &cookie).unwrap()["user"], "jdoe");
        // The account that follows a sign-in is the profile the sign-in read.
        let asked_before = campus.paths().len();
        assert_eq!(ask(&gateway, &campus, ACCOUNT, &cookie).unwrap()["account"]["name"], "Jeanne Doe");
        assert_eq!(campus.paths().len(), asked_before);
    }
}

#[test]
fn a_wrong_password_is_the_cas_to_refuse() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
        let body = serde_json::json!({ "username": "jdoe", "password": "not-the-password", "university": campus.id() }).to_string();
        let response = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, body.as_bytes()), || None, never)).unwrap();
        assert_eq!(response.status(), 401);
        assert!(cookie_set(&response).is_none());
        assert_eq!(*campus.posted.lock().unwrap(), [CAS]);
    }
}

#[test]
fn a_living_session_is_checked_with_its_own_portal_session() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let answer = ask(&gateway, &campus, SESSION, &campus.alive()).unwrap();
        // Every field of Node's answer (server/entAuthApp.js), and no other.
        assert_eq!(
            answer,
            serde_json::json!({
                "authenticated": true,
                "user": "jdoe",
                "sessionMode": null,
                "sessionSource": "cookie",
                "cookieNames": [campus.portal_cookie()],
                "casCookieNames": ["TGC"],
                "canUseServerLaunch": true,
                "degraded": false,
                "degradedReason": null,
                "analyticsEnabled": false,
                "university": campus.id(),
            })
        );
        // The portal alone is asked, with its cookie and without the CAS
        // ticket: the page that says who the student is.
        let seen = campus.seen.lock().unwrap().clone();
        assert_eq!(seen.last().unwrap().0, campus.pages().0);
        assert!(seen.iter().all(|(path, cookies)| !path.starts_with("/cas/") && cookies.contains(&format!("{}=alive", campus.portal_cookie())) && !cookies.contains("TGC")));
    }
}

#[test]
fn a_lapsed_portal_session_is_opened_again_here_with_the_ticket() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let cookie = campus.lapsed();
        // The portal no longer knows the cookie's session: tonAPI opens one
        // with the CAS ticket, and the session's cookie isn't written.
        assert_eq!(ask(&gateway, &campus, SESSION, &cookie).unwrap()["authenticated"], true);
        assert!(campus.seen.lock().unwrap().iter().any(|(path, cookies)| path.starts_with(CAS) && cookies.contains("TGC=the-ticket")));
        // That portal session is held here: the next check asks the CAS nothing.
        let at_the_cas = asked_the_cas(&campus);
        assert_eq!(ask(&gateway, &campus, SESSION, &cookie).unwrap()["user"], "jdoe");
        assert_eq!(asked_the_cas(&campus), at_the_cas);

        // The portal forgets that one too: opened again, the same way.
        campus.portal_forgets();
        assert_eq!(ask(&gateway, &campus, SESSION, &cookie).unwrap()["authenticated"], true);
        assert!(asked_the_cas(&campus) > at_the_cas);
    }
}

#[test]
fn the_account_is_the_name_the_portal_shows() {
    for campus in campuses() {
        let gateway = campus.gateway();
        // No address: neither portal says one (Node read Rennes 2's in the
        // webmail, which hasn't moved).
        assert_eq!(
            ask(&gateway, &campus, ACCOUNT, &campus.alive()).unwrap(),
            serde_json::json!({
                "authenticated": true,
                "account": { "sub": "jdoe", "name": "Jeanne Doe", "given_name": "Jeanne", "family_name": "Doe" },
                "sessionMode": null,
            })
        );
    }
}

#[test]
fn the_applications_are_the_list_node_gave_for_the_same_page() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let cookie = campus.alive();
        let answer = ask(&gateway, &campus, APPS, &cookie).unwrap();
        assert_eq!((&answer["authenticated"], &answer["sessionMode"]), (&true.into(), &serde_json::Value::Null));
        // pages/*-apps.json: what Node's own parsers give for the page
        // (tests/portalAppsParity.test.js reads the same two files).
        assert_eq!(answer["apps"], campus.apps(), "{}", campus.id());
        assert!(answer["apps"].as_array().unwrap().iter().all(|app| app["id"].as_str().unwrap().starts_with("portal-tool-")));

        // Asked with the CAS ticket and a portal session of the gateway's
        // own, then kept: the page asking again asks the portal nothing.
        assert!(asked_the_cas(&campus) > 0);
        assert!(campus.asked(campus.pages().1) > 0);
        let asked_before = campus.paths().len();
        assert_eq!(ask(&gateway, &campus, APPS, &cookie).unwrap()["apps"], campus.apps());
        assert_eq!(campus.paths().len(), asked_before);
    }
}

#[test]
fn moodles_deadlines_are_read_through_its_cas_login() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let answer = ask(&gateway, &campus, DEADLINES, &campus.alive()).unwrap();
        assert_eq!(answer["authenticated"], true);
        assert_eq!(answer["deadlines"]["items"].as_array().unwrap().len(), 6);
        // Moodle's own CAS login, as both universities' settings say.
        assert!(campus.seen.lock().unwrap().iter().any(|(path, _)| path == "/moodle/login/index.php?authCAS=CAS"));
    }
}

#[test]
fn a_sign_out_ends_the_session_at_the_cas() {
    for campus in campuses() {
        let gateway = campus.gateway();
        let cookie = campus.alive();
        let response = block_on(gateway.answer(&asked(&POST, LOGOUT, &NO_HEADERS, &[]), || Some(cookie.clone()), node_told)).unwrap();
        assert_eq!((response.status(), body_of(&response)), (http::StatusCode::OK, serde_json::json!({ "authenticated": false })));
        assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
        assert!(!campus.cas_knows_the_ticket());
        assert!(gateway.signed_in(Some(&cookie)).is_none());
    }
}

#[test]
fn a_session_the_cas_no_longer_knows_ends_here() {
    for campus in campuses() {
        let gateway = campus.gateway();
        // The portal's session lapsed and the CAS wants the password again.
        let cookie = campus.lapsed();
        campus.cas_forgets();
        let response = get(&gateway, APPS, &cookie).unwrap();
        assert_eq!((response.status(), body_of(&response)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "session_expired" })));
        assert_eq!(response.headers()["x-tafac-session"], "expired");
        assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));

        // The session check that still shows the cookie is told so too.
        let check = get(&gateway, SESSION, &cookie).unwrap();
        let said = body_of(&check);
        assert_eq!((&said["authenticated"], &said["expired"], &said["university"]), (&false.into(), &true.into(), &campus.id().into()));
    }
}

#[test]
fn a_portal_that_is_down_is_said_here() {
    for campus in campuses() {
        let gateway = campus.gateway();
        // The CAS is down: no portal session can be opened, and nothing
        // says the student's session is over. The route has failed, in
        // Node's status for it, and the session lives.
        campus.cas_is_down(true);
        let cookie = campus.lapsed();
        assert_eq!(get(&gateway, APPS, &cookie).unwrap().status(), 502);
        assert_eq!(get(&gateway, SESSION, &cookie).unwrap().status(), 500);
        assert!(gateway.signed_in(Some(&cookie)).is_some());
    }
}

// The gateway that runs (every university of routes.rs') answers for both.
// A sign-in for a university that isn't there is refused, in Node's words
// for an unknown university, without a request to anything.
#[test]
fn both_universities_are_switched_on() {
    let gateway = Gateway::new(SECRET, COOKIE_NAME);
    for campus in campuses() {
        assert!(routes::UNIVERSITIES.contains(&campus.id()));
        assert!(gateway.universities().contains(&campus.id()));
    }
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    let body = serde_json::json!({ "username": "jdoe", "password": "a-password", "university": "univ-nowhere" }).to_string();
    let refused = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, body.as_bytes()), || None, never)).unwrap();
    assert_eq!(refused.status(), 400);
    assert_eq!(serde_json::from_slice::<serde_json::Value>(refused.body()).unwrap(), serde_json::json!({ "error": "Unknown university \"univ-nowhere\"." }));
}
