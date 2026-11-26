// GET /__ent_auth/apps on the made-up campus: tonAPI's list of the portal's
// applications, asked with the CAS ticket and a portal session of the
// gateway's own.

use std::time::Duration;

use super::{ask, asked, body_of, cookie_set, error_of, never, Node, GET, NO_HEADERS};
use crate::testing::*;
use crate::Gateway;

const APPS: &str = "/__ent_auth/apps";
const LAYOUT: &str = "/api/v4-3/dlm/layout.json";

fn get(gateway: &Gateway, node: &Node, cookie: &str) -> Option<http::Response<Vec<u8>>> {
    block_on(gateway.answer(&asked(&GET, APPS, &NO_HEADERS, &[]), || Some(cookie.to_string()), |request| node.ask(request)))
}

// The answer kept is past its hour.
fn an_hour_later(gateway: &Gateway, cookie: &str) {
    gateway.signed_in(Some(cookie)).unwrap().memory.age_answers(Duration::from_secs(3601));
}

#[test]
fn the_applications_are_tonapis_list() {
    let campus = campus();
    let gateway = campus.gateway();
    let answer = ask(&gateway, APPS, &campus.alive()).unwrap();
    assert_eq!((&answer["authenticated"], &answer["sessionMode"]), (&true.into(), &serde_json::Value::Null));
    // In the portal's order, each once, the favourites' folder read last.
    assert_eq!(
        answer["apps"],
        serde_json::json!([
            { "id": "webapp-planning", "title": "Mon emploi du temps", "description": null, "url": "https://planning.exemple.test/portal/", "iconUrl": null, "category": "Scolarité", "favorite": false },
            // Its address is the one its tile opens (the portal says it in
            // the tile's own fragment), and it is starred on the portal.
            { "id": "webapp-mail", "title": "Messagerie", "description": "Le webmail", "url": "https://mail.exemple.test/", "iconUrl": null, "category": "Scolarité", "favorite": true },
            // No address of its own: the portal's page for it.
            { "id": "webapp-aide", "title": "Assistance", "description": null, "url": format!("http://127.0.0.1:{}/p/webapp-aide", campus.port()), "iconUrl": null, "category": "Scolarité", "favorite": false },
        ])
    );
}

#[test]
fn the_portal_session_is_the_gateways_own_and_the_list_is_kept() {
    let campus = campus();
    let gateway = campus.gateway();
    // Whatever the portal's session in the cookie (Node's, for its own
    // portal requests): the question goes with the CAS ticket.
    let cookie = campus.lapsed();
    assert!(ask(&gateway, APPS, &cookie).is_some());
    let at_the_portal: Vec<_> = campus.seen.lock().unwrap().iter().filter(|(path, _)| path.starts_with(LAYOUT)).map(|(_, cookies)| cookies.clone()).collect();
    // Asked once as nobody, then with the session tonAPI opened by the CAS.
    assert_eq!(at_the_portal.len(), 2);
    assert!(!at_the_portal[0].contains("JSESSIONID"), "{}", at_the_portal[0]);
    assert!(at_the_portal[1].contains("JSESSIONID=alive"));
    assert!(campus.seen.lock().unwrap().iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));

    // Kept an hour: the page asking again asks the portal nothing.
    let asked_before = campus.paths().len();
    assert_eq!(ask(&gateway, APPS, &cookie).unwrap()["apps"].as_array().unwrap().len(), 3);
    assert_eq!(campus.paths().len(), asked_before);

    // Then asked again, with the portal session held from the first time:
    // no CAS, and each tile's address isn't asked for twice.
    an_hour_later(&gateway, &cookie);
    assert!(ask(&gateway, APPS, &cookie).is_some());
    let since: Vec<String> = campus.paths()[asked_before..].to_vec();
    assert_eq!(since, [LAYOUT]);
}

#[test]
fn a_portal_that_forgot_its_session_is_signed_in_to_again_here() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    assert!(get(&gateway, &node, &cookie).is_some());
    an_hour_later(&gateway, &cookie);

    campus.portal_forgets();
    let response = get(&gateway, &node, &cookie).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body_of(&response)["apps"].as_array().unwrap().len(), 3);
    // The session's cookie isn't written: the portal session is held here.
    assert!(cookie_set(&response).is_none());
    assert!(campus.seen.lock().unwrap().iter().any(|(path, cookies)| path.starts_with(LAYOUT) && cookies.contains("JSESSIONID=alive-1")));
    // Node is asked nothing.
    assert!(node.got().is_empty());
}

#[test]
fn a_session_the_cas_no_longer_knows_ends_here() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    campus.cas_forgets();
    let response = get(&gateway, &node, &cookie).unwrap();
    assert_eq!((response.status(), body_of(&response)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "session_expired" })));
    assert_eq!(response.headers()["x-tafac-session"], "expired");
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
}

#[test]
fn a_portal_that_cant_be_reached_is_said_in_the_sentence_the_page_shows() {
    let campus = campus();
    let gateway = campus.gateway();
    // The CAS is down: no portal session can be opened, and nothing says
    // the student's session is over. Node's own status and sentence for
    // the applications, and Node is asked nothing (`error_of`).
    campus.cas_is_down(true);
    let cookie = campus.alive();
    assert_eq!(error_of(&gateway, APPS, &cookie), (502, serde_json::json!({ "error": "Portail indisponible pour le moment" })));
    assert!(gateway.signed_in(Some(&cookie)).is_some());
    // The error isn't kept: the list is given once the CAS is back.
    campus.cas_is_down(false);
    assert_eq!(ask(&gateway, APPS, &cookie).unwrap()["apps"].as_array().unwrap().len(), 3);

    // Nobody signed in, a demo cookie from before, another university: Node's.
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    for cookie in [Some(demo), Some(elsewhere), None] {
        assert!(block_on(gateway.answer(&asked(&GET, APPS, &NO_HEADERS, &[]), || cookie.clone(), never)).is_none());
    }
}
