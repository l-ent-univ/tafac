// A university of components, as Rennes is (Campus::component_settings):
// the grades are the IUT's alone, and the student's component is found in
// ADE's tree (the path of the group they follow). The gateway's memory
// holds it (session/memory.rs), not the cookie: a session the process
// didn't sign in (the app or tafac.fr's server started again, a session of
// Node's) finds it again at its first question that needs it.

use http::header::CONTENT_TYPE;
use http::HeaderMap;

use super::{ask, asked, cookie_set, error_of, never, unavailable, LOGIN, POST};
use crate::testing::*;
use crate::Gateway;

const GRADES: &str = "/__ent_auth/grades";
// What ADE is asked each time the component is looked for (its tree is
// kept a while, for every student).
const TREE: &str = "/ade/RestApi/portal/projects/1/user/properties/name/PortalResourcesAllSelection";

// The page's sign-in: the session's cookie.
fn signed_in(gateway: &Gateway) -> String {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    let body = serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": UNIVERSITY }).to_string();
    let response = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, body.as_bytes()), || None, never)).unwrap();
    assert_eq!(response.status(), 200);
    cookie_set(&response).unwrap()
}

fn has_grades(answer: &serde_json::Value) -> bool {
    answer["authenticated"] == true && answer["grades"]["relevé"]["formsemestre_id"] == 901
}

#[test]
fn a_session_restored_after_a_restart_finds_its_component_again() {
    let campus = campus();
    let cookie = campus.alive();
    // The app (or the server) as it starts: nothing in memory, the cookie
    // from the jar.
    let gateway = campus.component_gateway();
    assert!(has_grades(&ask(&gateway, GRADES, &cookie).unwrap()));
    assert_eq!(campus.asked(TREE), 1);
    // Found once: asked again, ADE isn't.
    assert!(has_grades(&ask(&gateway, "/__ent_auth/grades?fresh=1", &cookie).unwrap()));
    assert_eq!(campus.asked(TREE), 1);

    // Started again, the same cookie: found again, without a sign-in.
    let restarted = campus.component_gateway();
    assert!(has_grades(&ask(&restarted, GRADES, &cookie).unwrap()));
    assert_eq!(campus.posted_to("/cas/login"), 0);
}

#[test]
fn the_component_isnt_looked_for_twice_at_once() {
    let campus = campus();
    let cookie = campus.alive();
    let gateway = std::sync::Arc::new(campus.component_gateway());
    // The home page asks the grades and the photo at once (both ScoDoc's,
    // each with its own turn): one looks for the component, the other
    // waits for what it finds.
    let asking = |path: &'static str| {
        let (gateway, cookie) = (gateway.clone(), cookie.clone());
        std::thread::spawn(move || ask(&gateway, path, &cookie))
    };
    let (grades, photo) = (asking(GRADES), asking("/__ent_auth/student-pic?meta=1"));
    assert!(has_grades(&grades.join().unwrap().unwrap()));
    assert!(photo.join().unwrap().is_some());
    assert_eq!(campus.asked(TREE), 1);
}

#[test]
fn a_component_ade_couldnt_tell_is_looked_for_again() {
    let campus = campus();
    let cookie = campus.alive();
    let gateway = campus.component_gateway();
    // ADE down as the grades are first asked: no component, the error of a
    // service down rather than « no grades here », and nothing kept.
    campus.ade_is_down(true);
    assert_eq!(error_of(&gateway, GRADES, &cookie), unavailable());
    // Failed lately: the next questions don't ask ADE again.
    let tree = campus.asked(TREE);
    assert_eq!(error_of(&gateway, "/__ent_auth/grades?fresh=1", &cookie), unavailable());
    assert_eq!(campus.asked(TREE), tree);
    // ADE back, a while later: the next question finds the IUT.
    campus.ade_is_down(false);
    gateway.memory.age_looks();
    assert!(has_grades(&ask(&gateway, "/__ent_auth/grades?fresh=1", &cookie).unwrap()));
}

#[test]
fn a_hung_ade_is_waited_for_once_not_at_every_question() {
    let campus = campus();
    let cookie = campus.alive();
    let gateway = campus.component_gateway();
    // ADE takes the request and never answers: the first question waits
    // for the look's patience, not the service's, and is answered.
    campus.ade_hangs(true);
    let started = std::time::Instant::now();
    assert_eq!(error_of(&gateway, GRADES, &cookie), unavailable());
    assert!(started.elapsed() < std::time::Duration::from_secs(5), "{:?}", started.elapsed());
    // The next ones don't wait for it at all.
    let started = std::time::Instant::now();
    assert_eq!(error_of(&gateway, "/__ent_auth/grades?fresh=1", &cookie), unavailable());
    assert!(started.elapsed() < std::time::Duration::from_secs(1), "{:?}", started.elapsed());
    // ADE back, a while later: found.
    campus.ade_hangs(false);
    gateway.memory.age_looks();
    assert!(has_grades(&ask(&gateway, "/__ent_auth/grades?fresh=1", &cookie).unwrap()));
}

#[test]
fn a_student_of_another_component_has_no_grades_as_before() {
    let campus = campus();
    campus.ade_lists_another_group(true);
    let cookie = campus.alive();
    let gateway = campus.component_gateway();
    let (status, answer) = error_of(&gateway, GRADES, &cookie);
    assert_eq!((status, answer), unavailable());
    assert_eq!(campus.asked("/scodoc/services/data.php"), 0);
    // Looked for once: ADE said where the student is.
    let asked = campus.asked(TREE);
    assert_eq!(error_of(&gateway, GRADES, &cookie), unavailable());
    assert_eq!(campus.asked(TREE), asked);
}

#[test]
fn a_sign_in_finds_the_component_and_the_grades_need_nothing_more() {
    let campus = campus();
    let gateway = campus.component_gateway();
    let cookie = signed_in(&gateway);
    let tree = campus.asked(TREE);
    assert_eq!(tree, 1);
    assert!(has_grades(&ask(&gateway, GRADES, &cookie).unwrap()));
    assert_eq!(campus.asked(TREE), tree);
    // The app started again: its cookie, the component looked for again.
    let restarted = campus.component_gateway();
    assert!(has_grades(&ask(&restarted, GRADES, &cookie).unwrap()));
}

#[test]
fn a_sign_in_while_ade_is_down_finds_the_component_at_the_first_question() {
    let campus = campus();
    let gateway = campus.component_gateway();
    campus.ade_is_down(true);
    let cookie = signed_in(&gateway);
    campus.ade_is_down(false);
    assert!(has_grades(&ask(&gateway, GRADES, &cookie).unwrap()));
}
