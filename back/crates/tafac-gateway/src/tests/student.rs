// The student's own files on the made-up campus: the photo ScoDoc keeps
// and the school certificate of the school records, each asked with the CAS
// ticket and answered to its end here.

use http::header::SET_COOKIE;

use super::{asked, body_of, cookie_set, nobodys, Node, GET, NO_HEADERS};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const PHOTO: &str = "/__ent_auth/student-pic";
const PHOTO_META: &str = "/__ent_auth/student-pic?meta=1&ts=1795680000000";
const STATUS: &str = "/__ent_auth/documents/school-certificate/status";
const CERTIFICATE: &str = "/__ent_auth/documents/school-certificate";
const RECORDS: &str = "/mdw/";
const RECORDS_MENU: &str = "/mdw/UIDL/";

fn get(gateway: &Gateway, node: &Node, target: &str, cookie: &str) -> http::Response<Vec<u8>> {
    let response = block_on(gateway.answer(&asked(&GET, target, &NO_HEADERS, &[]), || Some(cookie.to_string()), |request| node.ask(request))).unwrap();
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    response
}

fn json(gateway: &Gateway, target: &str, cookie: &str) -> (u16, serde_json::Value) {
    let response = get(gateway, &Node::default(), target, cookie);
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    (response.status().as_u16(), body_of(&response))
}

fn says_expired(response: &http::Response<Vec<u8>>) -> bool {
    response.headers().get("x-tafac-session").is_some_and(|value| value == "expired")
}

// The answers kept are past their time.
fn later(gateway: &Gateway, cookie: &str) {
    gateway.signed_in(Some(cookie)).unwrap().memory.age_answers(std::time::Duration::from_secs(601));
}

#[test]
fn the_photo_is_scodocs_and_nothing_of_it_runs() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // The page asks whether there is one, then shows it.
    assert_eq!(
        json(&gateway, PHOTO_META, &cookie),
        (200, serde_json::json!({
            "authenticated": true, "sessionMode": null, "available": true, "source": "scodoc",
            "contentType": "image/png", "size": SCODOC_PHOTO.len(), "status": 200, "previewUrl": "/__ent_auth/student-pic",
        }))
    );
    let photo = get(&gateway, &Node::default(), PHOTO, &cookie);
    assert_eq!(photo.status(), 200);
    assert_eq!(photo.headers()["content-type"], "image/png");
    assert_eq!(photo.headers()["x-content-type-options"], "nosniff");
    assert_eq!(photo.headers()["content-security-policy"], "default-src 'none'; sandbox");
    assert_eq!(photo.body(), SCODOC_PHOTO.as_bytes());
    assert!(photo.headers().get(SET_COOKIE).is_none());

    // ScoDoc was signed in to once, with the ticket; the photo asked each
    // time, with ScoDoc's session held here.
    assert_eq!(campus.asked("/scodoc/services/doAuth.php"), 2);
    assert_eq!(campus.asked("/scodoc/services/data.php"), 2);
    // The grades after it go with the same session.
    assert!(super::ask(&gateway, "/__ent_auth/grades", &cookie).is_some());
    assert_eq!(campus.asked("/scodoc/services/doAuth.php"), 2);
}

#[test]
fn no_photo_is_said_and_is_no_error() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    campus.scodoc_has_a_photo(false);
    assert_eq!(json(&gateway, PHOTO_META, &cookie), (200, serde_json::json!({ "authenticated": true, "sessionMode": null, "available": false, "source": "scodoc", "previewUrl": null })));
    assert_eq!(json(&gateway, PHOTO, &cookie), (404, serde_json::json!({ "available": false, "source": "scodoc" })));
}

#[test]
fn a_scodoc_that_cant_be_reached_is_worded_here_and_ends_no_session() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    // The CAS down: ScoDoc can't be signed in to, and nothing says the
    // student's session is over.
    campus.cas_is_down(true);
    for target in [PHOTO, PHOTO_META] {
        let response = get(&gateway, &node, target, &cookie);
        assert_eq!((response.status().as_u16(), body_of(&response)), (500, serde_json::json!({ "error": "Service indisponible pour le moment" })), "{target}");
        assert!(!says_expired(&response));
    }
    assert!(gateway.signed_in(Some(&cookie)).is_some());
    // Node was asked nothing: the failure is the gateway's to word.
    assert!(node.got().is_empty());
}

#[test]
fn the_certificate_is_the_newest_the_school_records_list() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    assert_eq!(json(&gateway, STATUS, &cookie), (200, serde_json::json!({ "available": true, "schoolYear": "2026-2027" })));
    // The records were opened with the ticket, and their menu clicked.
    assert!(campus.seen.lock().unwrap().iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));
    assert_eq!((campus.posted_to(RECORDS), campus.posted_to(RECORDS_MENU)), (1, 1));

    // Kept: the page asking again asks the records nothing.
    let asked_before = campus.paths().len();
    assert_eq!(json(&gateway, STATUS, &cookie).1["available"], true);
    assert_eq!(campus.paths().len(), asked_before);

    // The file: the records opened anew (their session held here: no CAS),
    // for the certificate the status found.
    let file = get(&gateway, &Node::default(), CERTIFICATE, &cookie);
    assert_eq!(file.status(), 200);
    assert_eq!(file.headers()["content-type"], "application/pdf");
    assert_eq!(
        file.headers()["content-disposition"],
        "attachment; filename=\"Certificat_de_Scolarite_X0001_2026-2027_JEANNE_DOE.pdf\"; filename*=UTF-8''Certificat_de_Scolarit%C3%A9_X0001_2026-2027_JEANNE_DOE.pdf"
    );
    assert_eq!(file.body(), CERTIFICATE_PDF.as_bytes());
    assert!(file.headers().get(SET_COOKIE).is_none());
    let since: Vec<String> = campus.paths()[asked_before..].to_vec();
    assert_eq!(since, ["/mdw/", "/mdw/", "/mdw/UIDL/", "/mdw/APP/connector/3/646/dl/Certificat_de_Scolarit%C3%A9_X0001_2026-2027_JEANNE_DOE.pdf"]);

    // Asked without the status before it: the list first, then the file.
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[]);
    assert_eq!(get(&gateway, &Node::default(), CERTIFICATE, &other).body(), CERTIFICATE_PDF.as_bytes());
}

#[test]
fn no_certificate_is_said_and_kept() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    campus.records_have_a_certificate(false);
    assert_eq!(json(&gateway, STATUS, &cookie), (200, serde_json::json!({ "available": false })));
    assert_eq!(json(&gateway, CERTIFICATE, &cookie), (404, serde_json::json!({ "ok": false, "error": "Aucun certificat de scolarité disponible." })));
    // Remembered, as Node remembers it: a certificate that comes later
    // shows once the answer is past its time.
    campus.records_have_a_certificate(true);
    assert_eq!(json(&gateway, STATUS, &cookie).1, serde_json::json!({ "available": false }));
    later(&gateway, &cookie);
    assert_eq!(json(&gateway, STATUS, &cookie).1, serde_json::json!({ "available": true, "schoolYear": "2026-2027" }));
}

#[test]
fn school_records_that_fail_are_worded_here_and_asked_again() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    campus.records_are_down(true);
    let status = get(&gateway, &node, STATUS, &cookie);
    assert_eq!((status.status().as_u16(), body_of(&status)), (200, serde_json::json!({ "available": false })));
    let file = get(&gateway, &node, CERTIFICATE, &cookie);
    assert_eq!((file.status().as_u16(), body_of(&file)), (502, serde_json::json!({ "ok": false, "error": "Certificat indisponible pour le moment." })));
    assert!(!says_expired(&status) && !says_expired(&file) && node.got().is_empty());
    // A failure isn't kept: the records back, the next question finds the
    // certificate.
    campus.records_are_down(false);
    assert_eq!(json(&gateway, STATUS, &cookie).1, serde_json::json!({ "available": true, "schoolYear": "2026-2027" }));
}

#[test]
fn a_university_without_these_services_says_so() {
    // The campus without ScoDoc nor school records.
    let campus = campus();
    let mut settings = campus.settings();
    settings.university.services.grades = None;
    settings.university.services.absences = None;
    settings.university.services.documents = None;
    let gateway = Gateway::for_tests(vec![settings], SECRET, COOKIE_NAME);
    let cookie = campus.alive();
    assert_eq!(json(&gateway, PHOTO_META, &cookie), (200, serde_json::json!({ "authenticated": true, "sessionMode": null, "available": false, "source": "none", "previewUrl": null })));
    assert_eq!(json(&gateway, PHOTO, &cookie), (404, serde_json::json!({ "available": false, "source": "none" })));
    assert_eq!(json(&gateway, STATUS, &cookie), (404, serde_json::json!({ "available": false })));
    assert_eq!(json(&gateway, CERTIFICATE, &cookie), (404, serde_json::json!({ "ok": false, "error": "No certificate service for this university." })));
    assert!(campus.paths().is_empty());
}

#[test]
fn a_session_the_cas_no_longer_knows_ends_here() {
    for target in [PHOTO, PHOTO_META, STATUS, CERTIFICATE] {
        let campus = campus();
        let gateway = campus.gateway();
        let node = Node::default();
        let cookie = campus.alive();
        campus.cas_forgets();
        let response = get(&gateway, &node, target, &cookie);
        assert_eq!((response.status().as_u16(), body_of(&response)), (401, serde_json::json!({ "error": "session_expired" })), "{target}");
        assert!(says_expired(&response), "{target}");
        assert_eq!(cookie_set(&response).as_deref(), Some("cleared"), "{target}");
        assert_eq!(node.got(), ["POST /__ent_auth/logout"], "{target}");
        // Whoever still shows the cookie is told the same, and it isn't
        // taken away again.
        let again = get(&gateway, &node, target, &cookie);
        assert_eq!((again.status().as_u16(), says_expired(&again)), (401, true), "{target}");
        assert!(again.headers().get(SET_COOKIE).is_none(), "{target}");
    }
}

#[test]
fn who_isnt_held_here_is_answered_as_node_answered_nobody() {
    let campus = campus();
    let gateway = campus.server_gateway();
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    for cookie in [Some(demo), Some(elsewhere), None] {
        for (target, status, said) in [
            (PHOTO, 401, serde_json::json!({ "error": "Authentication required." })),
            (PHOTO_META, 200, serde_json::json!({ "authenticated": false, "available": false, "source": "scodoc", "previewUrl": null })),
            (STATUS, 401, serde_json::json!({ "available": false, "error": "Authentication required." })),
            (CERTIFICATE, 401, serde_json::json!({ "ok": false, "error": "Authentication required." })),
        ] {
            assert_eq!(nobodys(&gateway, &GET, target, &NO_HEADERS, &[], cookie.clone()), (status, said), "{target}");
        }
    }
    assert!(campus.paths().is_empty());
}
