// GET /__ent_auth/moodle/deadlines on the made-up campus: a route another
// service answers. tonAPI is handed the CAS ticket, signs in to Moodle
// itself, and the session holds Moodle's session and the answer.

use std::sync::Arc;
use std::time::Duration;

use http::Method;

use super::{ask, asked, error_of, never, unavailable, GET, NO_HEADERS, SESSION};
use crate::session::memory::Remembered;
use crate::testing::*;
use crate::Gateway;

const DEADLINES: &str = "/__ent_auth/moodle/deadlines";
// As the page asks once it holds an old answer: for the one the university
// gives now (tests/behind.rs has the old answer itself).
const DEADLINES_NOW: &str = "/__ent_auth/moodle/deadlines?fresh=1";
const SIGN_IN: &str = "/moodle/login/index.php";
const CALENDAR: &str = "/moodle/lib/ajax/service.php";

fn remembered(gateway: &Gateway, cookie: &str) -> Arc<Remembered> {
    gateway.signed_in(Some(cookie)).unwrap().memory
}

// The answer kept is past its five minutes.
fn five_minutes_later(gateway: &Gateway, cookie: &str) {
    remembered(gateway, cookie).age_answers(Duration::from_secs(301));
}

#[test]
fn the_deadlines_are_answered_as_node_answers_them() {
    let campus = campus();
    let gateway = campus.gateway();
    let answer = ask(&gateway, DEADLINES, &campus.alive()).unwrap();
    assert_eq!(answer["authenticated"], true);
    assert!(answer["sessionMode"].is_null());
    let dashboard = answer["deadlines"]["moodleHref"].as_str().unwrap();
    assert!(dashboard.starts_with("/__ent_auth/launch?url=http%3A%2F%2F127.0.0.1%3A") && dashboard.ends_with("%2Fmoodle%2Fmy%2F"), "{dashboard}");

    // The three latest overdue, then what is coming, six in all; what was
    // handed in comes from Moodle's upcoming events.
    let items = answer["deadlines"]["items"].as_array().unwrap();
    let read: Vec<_> = items
        .iter()
        .map(|item| (item["id"].as_str().unwrap(), item["type"].as_str().unwrap(), item["overdue"].as_bool().unwrap(), item["submitted"].as_bool()))
        .collect();
    assert_eq!(
        read,
        [
            ("103", "quiz", true, Some(false)),
            ("104", "assign", true, Some(false)),
            ("105", "assign", true, Some(false)),
            ("106", "assign", false, Some(false)),
            ("107", "forum", false, None),
            ("201", "assign", false, Some(true)),
        ]
    );
    let first = &items[3];
    assert_eq!((&first["title"], &first["courseName"]), (&"Maquette".into(), &"Développement web".into()));
    assert!(first["dueAt"].as_str().unwrap().ends_with(".000Z"));
    assert!(first["href"].as_str().unwrap().contains("%2Fmoodle%2Fmod%2Fassign%2Fview.php%3Fid%3D106"));

    // tonAPI was handed the CAS ticket, and nothing of the portal's session.
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen.iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));
    assert!(seen.iter().all(|(_, cookies)| !cookies.contains("JSESSIONID")));
    // One sign-in (there and back from the CAS), one request for both lists.
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (2, 1));
}

#[test]
fn the_answer_is_kept_five_minutes_and_moodles_session_longer() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let first = ask(&gateway, DEADLINES, &cookie).unwrap();
    let asked = campus.paths().len();

    // Again at once: the answer kept, as Node gives its cached one.
    assert_eq!(ask(&gateway, DEADLINES, &cookie).unwrap(), first);
    assert_eq!(campus.paths().len(), asked);

    // Five minutes later Moodle is asked again, with the session it gave:
    // no sign-in.
    five_minutes_later(&gateway, &cookie);
    assert!(ask(&gateway, DEADLINES_NOW, &cookie).is_some());
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (2, 2));
    let calendar = campus.seen.lock().unwrap().iter().rev().find(|(path, _)| path.starts_with(CALENDAR)).cloned().unwrap();
    assert!(calendar.0.contains("sesskey=CAMPUSKEY0") && calendar.1.contains("MoodleSession=open0"));
}

#[test]
fn a_session_moodle_forgot_is_opened_again_once() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    ask(&gateway, DEADLINES, &cookie).unwrap();

    campus.moodle_forgets();
    five_minutes_later(&gateway, &cookie);
    assert!(ask(&gateway, DEADLINES_NOW, &cookie).is_some());
    // The old session refused, one sign-in, the new one answered.
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (4, 3));
    // The CAS wrote its ticket anew at the first sign-in: the second was
    // handed the ticket of the session's cookie all the same.
    let seen = campus.seen.lock().unwrap().clone();
    let at_the_cas: Vec<_> = seen.iter().filter(|(path, _)| path.starts_with("/cas/login")).collect();
    assert_eq!(at_the_cas.len(), 2);
    assert!(at_the_cas.iter().all(|(_, cookies)| cookies.contains("TGC=the-ticket") && !cookies.contains("written-anew")));

    // And the new session is the one remembered.
    five_minutes_later(&gateway, &cookie);
    assert!(ask(&gateway, DEADLINES_NOW, &cookie).is_some());
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (4, 4));
}

#[test]
fn the_ticket_written_anew_in_the_cookie_changes_nothing() {
    let campus = campus();
    let gateway = campus.gateway();
    let first = ask(&gateway, DEADLINES, &campus.alive()).unwrap();
    let asked = campus.paths().len();

    // Node signed in to another service since (the planning, the mail): the
    // CAS wrote its ticket anew, and Node wrote it in the cookie. The same
    // session, the same student: the answer kept is still theirs, and
    // Moodle's session too.
    let rewritten = campus.cookie(
        serde_json::json!({ "jar": [["TGC", "the-ticket-written-anew", "localhost", "/cas", 1, 1, null], ["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }),
        &[],
    );
    assert_eq!(ask(&gateway, DEADLINES, &rewritten).unwrap(), first);
    assert_eq!(campus.paths().len(), asked);
    five_minutes_later(&gateway, &rewritten);
    assert!(ask(&gateway, DEADLINES_NOW, &rewritten).is_some());
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (2, 2));
}

#[test]
fn a_moodle_that_doesnt_answer_is_the_routes_error_and_isnt_kept() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    campus.moodle_is_down(true);
    // Node's own answer to a Moodle that is down, which the widget shows
    // as an error. Asked again each time: an error isn't kept.
    assert_eq!(error_of(&gateway, DEADLINES, &cookie), unavailable());
    assert_eq!(error_of(&gateway, DEADLINES, &cookie), unavailable());
    assert_eq!(campus.asked(CALENDAR), 2);

    // Moodle is back: asked, with the session opened the first time.
    campus.moodle_is_down(false);
    assert!(ask(&gateway, DEADLINES, &cookie).is_some());
    assert_eq!(campus.asked(SIGN_IN), 2);
}

#[test]
fn two_questions_at_once_sign_in_once() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let request = asked(&GET, DEADLINES, &NO_HEADERS, &[]);
    let one = || gateway.answer(&request, || Some(cookie.clone()), never);
    let (first, second) = block_on(async { tokio::join!(one(), one()) });
    assert_eq!(first.unwrap().body(), second.unwrap().body());
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (2, 1));
}

#[test]
fn each_students_moodle_is_their_own() {
    let campus = campus();
    let gateway = campus.gateway();
    let other = campus.cookie(serde_json::json!({ "id": "another-session", "user": "asmith" }), &[("JSESSIONID", "alive")]);
    ask(&gateway, DEADLINES, &campus.alive()).unwrap();
    ask(&gateway, DEADLINES, &other).unwrap();
    // Neither the answer nor Moodle's session of one serves the other.
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (4, 2));

    // The same student's other session (another browser) has the answer,
    // which is the student's, and its own session at Moodle when it asks.
    let elsewhere = campus.cookie(serde_json::json!({ "id": "a-third-session" }), &[("JSESSIONID", "alive")]);
    ask(&gateway, DEADLINES, &elsewhere).unwrap();
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CALENDAR)), (4, 2));
}

#[test]
fn a_session_signed_out_leaves_nothing_behind() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    ask(&gateway, DEADLINES, &cookie).unwrap();
    assert!(gateway.memory.remembers("one-session"));

    gateway.saw_request(&Method::POST, "/__ent_auth/logout", Some(&cookie));
    assert!(!gateway.memory.remembers("one-session"));
    let asked = campus.paths().len();
    assert_eq!(ask(&gateway, DEADLINES, &cookie), None);
    assert_eq!(campus.paths().len(), asked);
}

#[test]
fn what_is_not_a_plain_signed_in_session_is_nodes_without_a_request() {
    let campus = campus();
    let gateway = campus.gateway();
    let alive = [("JSESSIONID", "alive")];
    for (why, cookie) in [
        ("a demo cookie from before", campus.cookie(serde_json::json!({ "mode": "demo" }), &alive)),
        ("another university", campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &alive)),
        ("no CAS ticket", campus.cookie(serde_json::json!({ "jar": [["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }), &[])),
    ] {
        assert_eq!(ask(&gateway, DEADLINES, &cookie), None, "{why}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn the_portals_routes_are_still_asked_without_the_ticket() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    ask(&gateway, DEADLINES, &cookie).unwrap();
    ask(&gateway, SESSION, &cookie).unwrap();
    let seen = campus.seen.lock().unwrap().clone();
    let portal: Vec<_> = seen.iter().filter(|(path, _)| path.starts_with("/api/")).collect();
    // The portal got its own cookies: not the ticket, not Moodle's session.
    assert_eq!(portal.len(), 1);
    assert!(portal[0].1.contains("JSESSIONID=alive") && !portal[0].1.contains("TGC") && !portal[0].1.contains("MoodleSession"));
}
