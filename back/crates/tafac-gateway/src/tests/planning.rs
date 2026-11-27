// The planning's routes on the made-up campus (its TEMPO): tonAPI's own
// answers and refusals, as its server gives them, the planning's session
// held from one question to the next, a session the CAS no longer knows,
// and a university without a planning service.

use http::header::SET_COOKIE;

use super::{asked, never, Node, GET, NO_HEADERS};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const WEEK: &str = "/__ent_auth/timetable?from=2026-11-23&to=2026-11-29";
const TREE: &str = "/__ent_auth/timetable/tree";
const SIGN_IN: &str = "/tempo/auth";
const CLASSES: &str = "/tempo/api/events";

fn get(gateway: &Gateway, target: &str, cookie: &str) -> http::Response<Vec<u8>> {
    block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), never)).expect("an answer made here")
}

// tonAPI's answer: `{ data, meta }`, made here and never kept.
fn data_of(response: &http::Response<Vec<u8>>) -> (serde_json::Value, serde_json::Value) {
    assert_eq!(response.status(), 200, "{}", String::from_utf8_lossy(response.body()));
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    assert_eq!(response.headers()["cache-control"], "no-store");
    let mut body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    (body["data"].take(), body["meta"].take())
}

// tonAPI's refusal: its status and stable code, nothing said of the session.
fn problem_of(response: &http::Response<Vec<u8>>) -> (u16, String) {
    assert_eq!(response.headers()["content-type"], "application/problem+json");
    assert!(response.headers().get("x-tafac-session").is_none() && response.headers().get(SET_COOKIE).is_none());
    let body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(body["status"], response.status().as_u16());
    (response.status().as_u16(), body["code"].as_str().unwrap().to_string())
}

#[test]
fn the_classes_are_tonapis_own() {
    let campus = campus();
    let gateway = campus.gateway();
    let (classes, meta) = data_of(&get(&gateway, WEEK, &campus.alive()));

    // tonAPI's courses, sorted, at the university's time, the link of one.
    let read: Vec<_> = classes.as_array().unwrap().iter().map(|class| (class["id"].as_str().unwrap(), class["start"].as_str().unwrap())).collect();
    assert_eq!(read, [("7001", "2026-11-24T09:00:00+01:00"), ("7002", "2026-11-26T14:00:00+01:00")]);
    let first = &classes[0];
    assert_eq!(first["title"], "Sociologie des publics");
    assert_eq!(first["rooms"], serde_json::json!(["A1 Amphi (Démo) - 133 pl. Campus DEMO"]));
    assert_eq!(first["teachers"], serde_json::json!(["Exemple D."]));
    assert_eq!(first["link"], serde_json::json!({ "url": "https://pix.exemple.test/planning", "label": "VOTRE PLANNING" }));
    assert!(classes[1]["link"].is_null());
    assert_eq!((meta["university"].as_str(), meta["provider"].as_str()), (Some(UNIVERSITY), Some("tempo")));
    assert_eq!(meta["cacheSecs"], 300);

    // tonAPI was handed the CAS ticket and opened TEMPO's session: once.
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen.iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));
    assert_eq!((campus.asked(SIGN_IN), campus.asked(CLASSES)), (2, 2));
}

#[test]
fn the_planning_session_is_held_from_one_question_to_the_next() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    data_of(&get(&gateway, WEEK, &cookie));
    let signed_in = campus.asked(SIGN_IN);

    // The next week, then the tree: TEMPO's session is the one held.
    data_of(&get(&gateway, "/__ent_auth/timetable?from=2026-11-30&to=2026-12-06", &cookie));
    data_of(&get(&gateway, TREE, &cookie));
    assert_eq!(campus.asked(SIGN_IN), signed_in);

    // TEMPO forgot it: one sign-in again, with the ticket, and the answer.
    campus.tempo_forgets();
    data_of(&get(&gateway, WEEK, &cookie));
    assert_eq!(campus.asked(SIGN_IN), signed_in + 2);
}

#[test]
fn the_rooms_tree_a_search_and_a_rooms_classes() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();

    let (tree, meta) = data_of(&get(&gateway, TREE, &cookie));
    assert_eq!(meta["provider"], "tempo");
    let folders: Vec<_> = tree.as_array().unwrap().iter().map(|node| (node["id"].as_str().unwrap(), node["folder"].as_bool().unwrap())).collect();
    assert_eq!(folders, [("dossier-9001", true), ("dossier-9010", true)]);
    assert_eq!(tree[0]["children"][0], serde_json::json!({ "id": "6", "name": "A1 Amphi (Démo) - 133 pl.", "kind": "room", "folder": false, "children": [] }));
    // TEMPO has no other tree than its rooms': nothing asked for another kind.
    let asked_before = campus.paths().len();
    let (teachers, _) = data_of(&get(&gateway, "/__ent_auth/timetable/tree?kind=teacher", &cookie));
    assert_eq!((teachers, campus.paths().len()), (serde_json::json!([]), asked_before));

    let (found, _) = data_of(&get(&gateway, "/__ent_auth/timetable/resources?kind=room&q=AMPHI%20demo", &cookie));
    assert_eq!(found, serde_json::json!([{ "id": "6", "name": "A1 Amphi (Démo) - 133 pl.", "kind": "room", "path": ["01 - AMPHITHEATRES (2)", "A1 Amphi (Démo) - 133 pl."] }]));

    let (classes, _) = data_of(&get(&gateway, &format!("{WEEK}&resources=6"), &cookie));
    let ids: Vec<_> = classes.as_array().unwrap().iter().map(|class| class["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["7001", "7003"]);
    assert!(campus.seen.lock().unwrap().iter().any(|(path, _)| path == "/tempo/api/room/6?start=2026-11-23&end=2026-11-29&c="));
}

#[test]
fn a_refusal_is_tonapis_problem_and_asks_the_university_nothing() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    for target in [
        "/__ent_auth/timetable?from=2026-11-29&to=2026-11-23",
        "/__ent_auth/timetable?from=23/11/2026",
        "/__ent_auth/timetable?from=2026-07-01&to=2027-09-30",
        "/__ent_auth/timetable?resources=a/b",
        "/__ent_auth/timetable/tree?kind=salle",
        "/__ent_auth/timetable/resources?limit=0",
    ] {
        assert_eq!(problem_of(&get(&gateway, target, &cookie)), (400, "invalid_request".to_string()), "{target}");
    }
    assert!(campus.paths().is_empty());

    // tonAPI's own refusal: TEMPO reads a room, not a folder of the tree.
    assert_eq!(problem_of(&get(&gateway, &format!("{WEEK}&resources=dossier-9001"), &cookie)), (400, "invalid_request".to_string()));
}

#[test]
fn a_university_without_a_planning_service_says_so_as_tonapi_does() {
    let campus = drupal_campus();
    let gateway = campus.gateway();
    let response = get(&gateway, WEEK, &campus.alive());
    assert_eq!(problem_of(&response), (404, "service_absent".to_string()));
}

#[test]
fn a_session_the_cas_no_longer_knows_is_over_here_too() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    data_of(&get(&gateway, WEEK, &cookie));

    // The CAS ended its session, and TEMPO its own: tonAPI can't sign in
    // again, and the CAS, asked with the ticket, wants the password.
    campus.cas_forgets();
    campus.tempo_forgets();
    let response = block_on(gateway.answer(&asked(&GET, WEEK, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
    assert_eq!(response.status(), 401);
    assert_eq!(response.headers()["x-tafac-session"], "expired");
    assert_eq!(super::cookie_set(&response).as_deref(), Some("cleared"));
    assert_eq!(node.got(), ["POST /__ent_auth/logout"]);
}

#[test]
fn nobody_signed_in_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    assert!(block_on(gateway.answer(&asked(&GET, WEEK, &NO_HEADERS, &[]), || None, never)).is_none());
}
