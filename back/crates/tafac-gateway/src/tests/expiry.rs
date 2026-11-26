// A session the CAS no longer knows, on the made-up campus: found on any
// moved route, ended here, said to the page as Node says it, and told to
// Node. And a service that fails while the CAS still knows the session:
// the route's error, and the session lives.

use http::header::SET_COOKIE;
use http::HeaderMap;

use super::{ask, asked, body_of, cookie_set, error_of, never, unavailable, Node, ACCOUNT, GET, NO_HEADERS, SESSION};
use crate::testing::*;
use crate::Gateway;

const DEADLINES: &str = "/__ent_auth/moodle/deadlines";
const GRADES: &str = "/__ent_auth/grades";
const CALENDAR: &str = "/moodle/lib/ajax/service.php";

fn get(gateway: &Gateway, node: &Node, target: &str, cookie: &str) -> Option<http::Response<Vec<u8>>> {
    block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), |request| node.ask(request)))
}

fn says_expired(response: &http::Response<Vec<u8>>) -> bool {
    response.headers().get("x-tafac-session").is_some_and(|value| value == "expired")
}

#[test]
fn a_service_route_finds_the_session_over_and_ends_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    assert!(ask(&gateway, DEADLINES, &cookie).is_some());
    // Nothing kept to give meanwhile (tests/behind.rs has an old answer's case).
    gateway.signed_in(Some(&cookie)).unwrap().memory.forget_answers();

    // The CAS ended its session (Rennes' does, half an hour in), and Moodle
    // its own: tonAPI can't sign in again, and the CAS, asked with the
    // ticket, wants the password.
    campus.cas_forgets();
    campus.moodle_forgets();
    let response = get(&gateway, &node, DEADLINES, &cookie).unwrap();
    // Node's own answer to a route that finds the session expired.
    assert_eq!((response.status(), body_of(&response)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "session_expired" })));
    assert!(says_expired(&response));
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));

    // Node was told once, with the session's cookie.
    let told: Vec<_> = node.got.lock().unwrap().iter().filter(|(asked, _, _)| asked == "POST /__ent_auth/logout").cloned().collect();
    assert_eq!(told.len(), 1);
    assert_eq!(told[0].1, format!("{COOKIE_NAME}={cookie}"));
    // Nothing of the session stays.
    assert!(gateway.signed_in(Some(&cookie)).is_none());
    assert!(!gateway.memory.remembers("one-session"));
}

#[test]
fn whoever_still_shows_the_cookie_is_told_and_the_cookie_isnt_touched_again() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    campus.cas_forgets();
    assert!(says_expired(&get(&gateway, &node, GRADES, &cookie).unwrap()));
    let (asked_of_campus, asked_of_node) = (campus.paths().len(), node.got().len());

    // Requests that were on their way, or a copy of the cookie: the same
    // word, nothing asked of the university, and no cookie taken away (the
    // student may have signed in again since).
    for target in [GRADES, DEADLINES, ACCOUNT, "/__ent_auth/grades/report.pdf?semestre=901"] {
        let again = get(&gateway, &node, target, &cookie).unwrap();
        assert_eq!((again.status(), says_expired(&again)), (http::StatusCode::UNAUTHORIZED, true), "{target}");
        assert!(again.headers().get(SET_COOKIE).is_none(), "{target}");
    }
    // The session check says it in its body, as Node's does.
    let check = get(&gateway, &node, SESSION, &cookie).unwrap();
    assert_eq!((check.status(), &body_of(&check)["authenticated"], &body_of(&check)["expired"]), (http::StatusCode::OK, &false.into(), &true.into()));
    assert!(check.headers().get(SET_COOKIE).is_none());
    assert_eq!(campus.paths().len(), asked_of_campus);
    // Node: told once that the session ended, and asked nothing since.
    assert_eq!(node.got().len(), asked_of_node);

    // Another student's session is another's.
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive")]);
    assert!(gateway.signed_in(Some(&other)).is_some());
}

#[test]
fn the_session_check_finds_it_over_and_says_so_as_node_does() {
    let campus = campus();
    let gateway = campus.gateway().with_statistics(Some("phc_made_up"));
    let node = Node::default();
    // The portal's session lapsed, and the CAS's with it.
    let cookie = campus.lapsed();
    campus.cas_forgets();
    let response = get(&gateway, &node, SESSION, &cookie).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        body_of(&response),
        serde_json::json!({
            "authenticated": false, "expired": true, "user": null, "sessionMode": null, "sessionSource": null,
            "degraded": false, "degradedReason": null, "canUseServerLaunch": false, "analyticsEnabled": true, "university": UNIVERSITY,
        })
    );
    assert!(says_expired(&response));
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    // Node: told that the session ended, and nothing else.
    assert_eq!(node.got(), ["POST /__ent_auth/logout"]);
}

#[test]
fn a_ticket_the_cas_never_knew_is_a_session_over() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.cookie(serde_json::json!({ "jar": [["TGC", "an-old-ticket", "localhost", "/cas", 1, 1, null], ["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }), &[]);
    let response = get(&gateway, &node, DEADLINES, &cookie).unwrap();
    assert_eq!((response.status(), says_expired(&response)), (http::StatusCode::UNAUTHORIZED, true));
    assert_eq!(campus.asked("/moodle/lib/ajax/service.php"), 0);
}

#[test]
fn only_the_cas_ends_a_session() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.lapsed();

    // The portal's session lapsed and the CAS knows the ticket: the portal
    // is signed in to again, here. The session lives.
    assert_eq!(body_of(&get(&gateway, &node, SESSION, &cookie).unwrap())["authenticated"], true);
    assert!(gateway.signed_in(Some(&cookie)).is_some());

    // The portal forgot again and the CAS doesn't say (down): nothing ends
    // either, and the check is the route's own error.
    campus.portal_forgets();
    campus.cas_is_down(true);
    let response = get(&gateway, &node, SESSION, &cookie).unwrap();
    assert_eq!((response.status().as_u16(), body_of(&response)), unavailable());
    assert!(!says_expired(&response) && cookie_set(&response).is_none());
    assert!(gateway.signed_in(Some(&cookie)).is_some());
    // The account asked within the half minute is the profile just read.
    assert_eq!(get(&gateway, &node, ACCOUNT, &cookie).unwrap().status(), 200);
    // Node is told nothing: no session ended.
    assert!(node.got().is_empty());
}

#[test]
fn a_service_that_refuses_while_the_cas_knows_the_session_is_the_routes_error() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // Moodle refuses the session it has just given: tonAPI says the
    // university no longer knows the student (`session_expired`). The CAS,
    // asked with the ticket, still does: Moodle's own trouble, said as Node
    // says a service's error, and the session lives. Node is asked nothing
    // (`error_of`).
    campus.moodle_refuses(true);
    assert_eq!(error_of(&gateway, DEADLINES, &cookie), unavailable());
    assert!(gateway.signed_in(Some(&cookie)).is_some());
    assert!(campus.cas_knows_the_ticket());
    // The other services answer as before, with the same session.
    assert!(ask(&gateway, GRADES, &cookie).is_some());

    // The error isn't kept: Moodle is asked again the next time, and
    // answers once it takes its sessions again.
    let at_moodle = campus.asked(CALENDAR);
    assert_eq!(error_of(&gateway, DEADLINES, &cookie), unavailable());
    assert!(campus.asked(CALENDAR) > at_moodle);
    // A development server says why, in words that aren't a session over.
    let development = Gateway::for_tests(vec![campus.settings()], SECRET, crate::DEVELOPMENT_COOKIE);
    let (status, said) = error_of(&development, DEADLINES, &cookie);
    assert_eq!((status, said["error"].as_str()), (500, Some("session_expired, and the CAS doesn't say the session is over")));
    campus.moodle_refuses(false);
    assert!(ask(&gateway, DEADLINES, &cookie).is_some());
}

#[test]
fn two_requests_that_find_it_over_together_end_it_once() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    campus.cas_forgets();
    let one = |target: &'static str| async {
        let headers = HeaderMap::new();
        let request = asked(&GET, target, &headers, &[]);
        gateway.answer(&request, || Some(cookie.clone()), |request| node.ask(request)).await
    };
    let (grades, deadlines) = block_on(async { tokio::join!(one(GRADES), one(DEADLINES)) });
    let (grades, deadlines) = (grades.unwrap(), deadlines.unwrap());
    assert!(says_expired(&grades) && says_expired(&deadlines));
    // One of the two took the cookie away, and Node was told once.
    assert_eq!([&grades, &deadlines].iter().filter(|response| response.headers().get(SET_COOKIE).is_some()).count(), 1);
    assert_eq!(node.got().iter().filter(|asked| asked.as_str() == "POST /__ent_auth/logout").count(), 1);
}

#[test]
fn a_session_signed_in_here_expires_the_same_way() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let mut headers = HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    let login = serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": UNIVERSITY }).to_string();
    let signed_in = block_on(gateway.answer(&asked(&super::POST, super::LOGIN, &headers, login.as_bytes()), || None, never)).unwrap();
    let cookie = cookie_set(&signed_in).unwrap();
    assert!(ask(&gateway, GRADES, &cookie).is_some());

    campus.cas_forgets();
    // What is kept is still given (the report, ten minutes); what must be
    // asked finds the session over, a moment after the sign-in too.
    assert!(ask(&gateway, GRADES, &cookie).is_some());
    let response = get(&gateway, &node, DEADLINES, &cookie).unwrap();
    assert_eq!((response.status(), says_expired(&response)), (http::StatusCode::UNAUTHORIZED, true));
}
