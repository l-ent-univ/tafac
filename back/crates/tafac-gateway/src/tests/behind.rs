// The home page's answers past their freshness, and at a sign-in
// (gateway/behind.rs): an old answer given at once while the university is
// asked again, whose answers they are, and what a sign-in asks ahead.

use std::time::{Duration, Instant};

use http::{HeaderMap, Method};

use super::{ask, asked, body_of, cookie_set, error_of, never, unavailable, GET, LOGIN, NO_HEADERS, POST};
use crate::session::memory::Kept;
use crate::testing::*;
use crate::{Gateway, REFRESHING};

const APPS: &str = "/__ent_auth/apps";
const GRADES: &str = "/__ent_auth/grades";
const DEADLINES: &str = "/__ent_auth/moodle/deadlines";
// As the page asks once it holds an old answer.
const DEADLINES_NOW: &str = "/__ent_auth/moodle/deadlines?fresh=1";
const MOODLE_SIGN_IN: &str = "/moodle/login/index.php";
const CALENDAR: &str = "/moodle/lib/ajax/service.php";

fn get(gateway: &Gateway, target: &str, cookie: &str) -> http::Response<Vec<u8>> {
    block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), never)).expect("an answer made here")
}

fn is_old(response: &http::Response<Vec<u8>>) -> bool {
    response.headers().get(REFRESHING).is_some_and(|value| value == "1")
}

// Every answer kept is past its freshness: the student is back after
// more than an hour.
fn later(gateway: &Gateway, cookie: &str) {
    gateway.signed_in(Some(cookie)).unwrap().memory.age_answers(Duration::from_secs(3601));
}

// What is asked behind an answer takes a moment.
fn eventually(what: &str, done: impl Fn() -> bool) {
    let until = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < until, "{what}: not after ten seconds");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn an_old_answer_is_given_at_once_and_moodle_is_asked_behind_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let first = get(&gateway, DEADLINES, &cookie);
    assert!(!is_old(&first));
    assert_eq!(campus.asked(CALENDAR), 1);

    later(&gateway, &cookie);
    let old = get(&gateway, DEADLINES, &cookie);
    assert_eq!((old.status(), old.body()), (http::StatusCode::OK, first.body()));
    assert!(is_old(&old));
    // Behind it, Moodle is asked, with the session it gave: once, whoever
    // asks meanwhile.
    assert!(is_old(&get(&gateway, DEADLINES, &cookie)) || campus.asked(CALENDAR) == 2);
    eventually("Moodle asked again", || campus.asked(CALENDAR) == 2);

    // The page asks for the answer that came: it waits for it, and Moodle
    // isn't asked a third time.
    let now = get(&gateway, DEADLINES_NOW, &cookie);
    assert_eq!(now.status(), 200);
    assert!(!is_old(&now));
    assert!(!is_old(&get(&gateway, DEADLINES, &cookie)));
    assert_eq!((campus.asked(MOODLE_SIGN_IN), campus.asked(CALENDAR)), (2, 2));
}

#[test]
fn the_applications_and_the_grades_are_given_old_too_and_no_other_route() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    for target in [APPS, GRADES] {
        let first = get(&gateway, target, &cookie);
        assert_eq!(first.status(), 200, "{target}");
        later(&gateway, &cookie);
        let old = get(&gateway, target, &cookie);
        assert!(is_old(&old), "{target}");
        assert_eq!(old.body(), first.body(), "{target}");
        // The one that comes, for the page that waits for it.
        let now = get(&gateway, &format!("{target}?fresh=1"), &cookie);
        assert_eq!((now.status(), is_old(&now)), (http::StatusCode::OK, false), "{target}");
    }
    // A route with an answer of the moment isn't given an old one: the
    // session check asks the portal each time.
    later(&gateway, &cookie);
    assert!(!is_old(&get(&gateway, super::SESSION, &cookie)));
}

#[test]
fn behind_a_moodle_that_is_down_the_old_answer_stays() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let first = get(&gateway, DEADLINES, &cookie);
    later(&gateway, &cookie);

    campus.moodle_is_down(true);
    let old = get(&gateway, DEADLINES, &cookie);
    assert!(is_old(&old));
    assert_eq!(old.body(), first.body());
    // The page's second request is the one told: the route's own error,
    // which the widget leaves the list it has for.
    assert_eq!(error_of(&gateway, DEADLINES_NOW, &cookie), unavailable());
    // And the list is still there for whoever opens the page meanwhile.
    let still = get(&gateway, DEADLINES, &cookie);
    assert!(is_old(&still));
    assert_eq!(still.body(), first.body());

    campus.moodle_is_down(false);
    assert!(ask(&gateway, DEADLINES_NOW, &cookie).is_some());
    assert!(!is_old(&get(&gateway, DEADLINES, &cookie)));
}

#[test]
fn behind_a_session_the_cas_no_longer_knows_the_old_answer_goes_and_the_next_request_ends_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    assert!(ask(&gateway, DEADLINES, &cookie).is_some());
    later(&gateway, &cookie);

    campus.cas_forgets();
    campus.moodle_forgets();
    // Given all the same: nobody was asked yet. What is asked behind it
    // ends no session, and tells nobody.
    let old = get(&gateway, DEADLINES, &cookie);
    assert!(is_old(&old));
    assert!(old.headers().get("x-tafac-session").is_none() && cookie_set(&old).is_none());
    let memory = gateway.signed_in(Some(&cookie)).unwrap().memory;
    eventually("the old answer taken away", || memory.kept("moodle/deadlines").is_none());
    assert!(gateway.signed_in(Some(&cookie)).is_some());

    // The next request asks itself, and finds the session over as any
    // route does: Node is told, as for any session that ends here.
    let node = super::Node::default();
    let over = block_on(gateway.answer(&asked(&GET, DEADLINES, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
    assert_eq!(node.got(), ["POST /__ent_auth/logout"]);
    assert_eq!((over.status(), body_of(&over)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "session_expired" })));
    assert_eq!(over.headers()["x-tafac-session"], "expired");
    assert_eq!(cookie_set(&over).as_deref(), Some("cleared"));
}

#[test]
fn a_student_who_signs_in_again_finds_the_answers_of_before_and_none_after_signing_out() {
    let campus = campus();
    let gateway = campus.gateway();
    let session = |id: &str| campus.cookie(serde_json::json!({ "id": id }), &[("JSESSIONID", "alive")]);
    let morning = session("the-morning");
    let first = get(&gateway, DEADLINES, &morning);
    later(&gateway, &morning);

    // That session is over (the CAS's own half hour); the student signs in
    // again: another session, the same student.
    assert!(gateway.memory.end("the-morning", crate::session::memory::Ended::Expired));
    let afternoon = session("the-afternoon");
    let old = get(&gateway, DEADLINES, &afternoon);
    assert!(is_old(&old));
    assert_eq!(old.body(), first.body());
    assert!(ask(&gateway, DEADLINES_NOW, &afternoon).is_some());

    // Another student has none of it.
    let other = campus.cookie(serde_json::json!({ "id": "someone-else", "user": "asmith" }), &[("JSESSIONID", "alive")]);
    assert!(gateway.signed_in(Some(&other)).unwrap().memory.kept("moodle/deadlines").is_none());

    // Signed out: nothing of the student's stays, for any session after.
    gateway.saw_request(&Method::POST, "/__ent_auth/logout", Some(&afternoon));
    let evening = session("the-evening");
    assert!(gateway.signed_in(Some(&evening)).unwrap().memory.kept("moodle/deadlines").is_none());
    let asked_before = campus.asked(CALENDAR);
    assert!(!is_old(&get(&gateway, DEADLINES, &evening)));
    assert_eq!(campus.asked(CALENDAR), asked_before + 1);
}

#[test]
fn a_sign_in_asks_the_three_before_the_page_does() {
    let campus = campus();
    let gateway = campus.gateway().asking_ahead();
    let mut headers = HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    let login = serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": UNIVERSITY }).to_string();
    let signed_in = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, login.as_bytes()), || None, never)).unwrap();
    let cookie = cookie_set(&signed_in).unwrap();

    // Nobody asked for them yet.
    let memory = gateway.signed_in(Some(&cookie)).unwrap().memory;
    for key in ["apps", "moodle/deadlines", "grades"] {
        eventually(key, || matches!(memory.kept(key), Some(Kept::Fresh(_))));
    }
    assert_eq!((campus.asked(MOODLE_SIGN_IN), campus.asked(CALENDAR)), (2, 1));

    // The page's own requests find them there: the university is asked
    // nothing more.
    let asked_before = campus.paths().len();
    for target in [APPS, DEADLINES, GRADES] {
        assert!(!is_old(&get(&gateway, target, &cookie)), "{target}");
    }
    assert_eq!(campus.paths().len(), asked_before);
}

#[test]
fn a_request_that_comes_while_the_sign_in_asks_waits_for_that_answer() {
    let campus = campus();
    let gateway = campus.gateway().asking_ahead();
    let mut headers = HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    let login = serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": UNIVERSITY }).to_string();
    let signed_in = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, login.as_bytes()), || None, never)).unwrap();
    let cookie = cookie_set(&signed_in).unwrap();

    // At once, as the page does: one question to Moodle all the same.
    assert!(ask(&gateway, DEADLINES, &cookie).is_some());
    assert_eq!((campus.asked(MOODLE_SIGN_IN), campus.asked(CALENDAR)), (2, 1));
}
