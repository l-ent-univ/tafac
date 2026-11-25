// The session check and the account, on the made-up campus: what the
// gateway answers as Node would, and what it leaves to Node.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use http::header::{HeaderValue, SET_COOKIE};
use http::{HeaderMap, Method};
use tonapi_core::Profile;

use super::{ask, node_says, ACCOUNT, SESSION};
use crate::gateway::portal::EARLY_KEPT;
use crate::node::{read_facts, NodeFacts, FACTS_KEPT};
use crate::session::cookie::NodeSession;
use crate::testing::*;
use crate::translate::{account, session, Translated, Unanswered};
use crate::Gateway;

fn profile() -> Profile {
    Profile {
        username: "jdoe".into(),
        display_name: None,
        first_name: Some("Jeanne".into()),
        last_name: None,
        email: None,
        student_number: Some("21901234".into()),
        program: None,
    }
}

#[test]
fn a_living_session_is_answered_as_node_answers_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let answer = ask(&gateway, SESSION, &campus.alive()).unwrap();
    // Every field of Node's answer (server/entAuthApp.js), and no other.
    assert_eq!(
        answer,
        serde_json::json!({
            "authenticated": true,
            "user": "jdoe",
            "sessionMode": null,
            "sessionSource": "cookie",
            "cookieNames": ["JSESSIONID", "lb"],
            "casCookieNames": ["TGC"],
            "canUseServerLaunch": true,
            "degraded": false,
            "degradedReason": null,
            "analyticsEnabled": true,
            "university": UNIVERSITY,
        })
    );
    // One request to the portal, with its cookies and without the CAS ticket.
    let seen = campus.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].0, "/api/v5-1/userinfo");
    assert!(seen[0].1.contains("JSESSIONID=alive") && seen[0].1.contains("lb=node2"));
    assert!(!seen[0].1.contains("TGC"));
}

#[test]
fn the_account_asked_next_is_the_profile_just_read() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    ask(&gateway, SESSION, &cookie).unwrap();
    let answer = ask(&gateway, ACCOUNT, &cookie).unwrap();
    assert_eq!(
        answer,
        serde_json::json!({
            "authenticated": true,
            "account": {
                "sub": "jdoe", "name": "Jeanne Doe", "given_name": "Jeanne", "family_name": "Doe",
                "email": "jeanne.doe@exemple.test",
            },
            "sessionMode": null,
        })
    );
    assert_eq!(campus.paths(), ["/api/v5-1/userinfo"]);
}

#[test]
fn each_students_profile_is_kept_apart() {
    let campus = campus();
    let gateway = campus.gateway();
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive")]);
    // Two students check their sessions, then ask for their accounts: as on
    // tafac.fr, where the checks of many cross.
    ask(&gateway, SESSION, &campus.alive()).unwrap();
    ask(&gateway, SESSION, &other).unwrap();
    ask(&gateway, ACCOUNT, &campus.alive()).unwrap();
    ask(&gateway, ACCOUNT, &other).unwrap();
    assert_eq!(campus.paths().len(), 2);
}

#[test]
fn the_account_alone_asks_the_portal_itself() {
    let campus = campus();
    let gateway = campus.gateway();
    let answer = ask(&gateway, ACCOUNT, &campus.alive()).unwrap();
    assert_eq!(answer["account"]["given_name"], "Jeanne");
    assert_eq!(campus.paths().len(), 1);
    // Another session's profile is not this one's.
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive")]);
    ask(&gateway, SESSION, &campus.alive()).unwrap();
    ask(&gateway, ACCOUNT, &other).unwrap();
    assert_eq!(campus.paths().len(), 3);
}

#[test]
fn only_the_moved_routes_are_answered() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    for (method, path) in [(Method::GET, "/__ent_auth/grades"), (Method::POST, SESSION), (Method::POST, "/__ent_auth/login"), (Method::GET, "/")] {
        let never = |_university: String| async { panic!("Node is not asked") };
        assert!(block_on(gateway.answer(&method, path, || Some(cookie.clone()), never)).is_none(), "{method} {path}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn the_check_made_at_the_start_answers_the_pages_first_one() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    block_on(gateway.check_early(Some(&cookie), node_says));
    assert_eq!(campus.paths(), ["/api/v5-1/userinfo"]);
    // The page's first check and its account: nothing more is asked.
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
    assert_eq!(ask(&gateway, ACCOUNT, &cookie).unwrap()["account"]["sub"], "jdoe");
    assert_eq!(campus.paths().len(), 1);
    // Taken once: the next check asks the portal.
    ask(&gateway, SESSION, &cookie).unwrap();
    assert_eq!(campus.paths().len(), 2);
}

#[test]
fn a_session_found_lapsed_at_the_start_goes_to_node_at_once() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.lapsed();
    block_on(gateway.check_early(Some(&cookie), node_says));
    let asked = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie), None);
    assert_eq!(campus.paths().len(), asked);
}

#[test]
fn the_check_made_at_the_start_is_for_that_session_as_it_was() {
    let campus = campus();
    let gateway = campus.gateway();
    block_on(gateway.check_early(Some(&campus.lapsed()), node_says));
    let asked = campus.paths().len();
    // Node signed in to the portal again since: other cookies.
    assert!(ask(&gateway, SESSION, &campus.alive()).is_some());
    assert_eq!(campus.paths().len(), asked + 1);

    // Another session altogether.
    block_on(gateway.check_early(Some(&campus.alive()), node_says));
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive"), ("lb", "node2")]);
    let asked = campus.paths().len();
    ask(&gateway, SESSION, &other).unwrap();
    assert_eq!(campus.paths().len(), asked + 1);

    // Too long ago.
    block_on(gateway.check_early(Some(&campus.alive()), node_says));
    if let Some(long_ago) = Instant::now().checked_sub(EARLY_KEPT + Duration::from_secs(1)) {
        block_on(gateway.portal.early.lock()).as_mut().unwrap().at = long_ago;
        let asked = campus.paths().len();
        ask(&gateway, SESSION, &campus.alive()).unwrap();
        assert_eq!(campus.paths().len(), asked + 1);
    }
}

#[test]
fn nothing_is_asked_at_the_start_when_nobody_is_signed_in() {
    let campus = campus();
    let gateway = campus.gateway();
    let never = |_university: String| async { panic!("Node is not asked") };
    block_on(gateway.check_early(None, never));
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[("JSESSIONID", "alive")]);
    block_on(gateway.check_early(Some(&demo), never));
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn a_portal_that_no_longer_knows_the_session_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.lapsed();
    assert_eq!(ask(&gateway, SESSION, &cookie), None);
    assert_eq!(ask(&gateway, ACCOUNT, &cookie), None);
    // tonAPI went to the CAS, as it does for a lost session, and couldn't
    // sign in: it was never given the ticket.
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen.iter().any(|(path, _)| path.starts_with("/cas/login")));
    assert!(seen.iter().all(|(_, cookies)| !cookies.contains("TGC")));
}

#[test]
fn what_is_not_a_plain_signed_in_session_is_nodes_without_a_request() {
    let campus = campus();
    let gateway = campus.gateway();
    let alive = [("JSESSIONID", "alive")];
    for (why, cookie) in [
        ("the demo account", campus.cookie(serde_json::json!({ "mode": "demo" }), &alive)),
        ("another university", campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &alive)),
        ("no portal cookie", campus.cookie(serde_json::json!({}), &[])),
        ("no CAS ticket", campus.cookie(serde_json::json!({ "jar": [["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }), &[])),
        ("past its lifetime", campus.cookie(serde_json::json!({ "createdAt": crate::gateway::now_ms() - 31 * 24 * 60 * 60 * 1000 }), &alive)),
        ("not Node's cookie", "v1.AAAA.AAAA.AAAA".to_string()),
    ] {
        assert_eq!(ask(&gateway, SESSION, &cookie), None, "{why}");
        assert_eq!(ask(&gateway, ACCOUNT, &cookie), None, "{why}");
    }
    assert!(block_on(gateway.answer(&Method::GET, SESSION, || None, node_says)).is_none());
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn a_cookie_sealed_with_another_secret_is_nodes() {
    let campus = campus();
    let other = Gateway::for_tests(vec![campus.settings()], "another secret, as long as the first one is", COOKIE_NAME);
    assert_eq!(ask(&other, SESSION, &campus.alive()), None);
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn a_portal_answering_for_someone_else_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.cookie(serde_json::json!({}), &[("JSESSIONID", "someone-else")]);
    assert_eq!(ask(&gateway, SESSION, &cookie), None);
    assert_eq!(ask(&gateway, ACCOUNT, &cookie), None);
}

#[test]
fn a_session_gone_while_the_portal_was_asked_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // The jar holds the cookie when the request comes, no longer when the
    // portal has answered (a sign-out went through meanwhile).
    let asked = AtomicU32::new(0);
    let jar = || (asked.fetch_add(1, Ordering::SeqCst) == 0).then(|| cookie.clone());
    assert!(block_on(gateway.answer(&Method::GET, SESSION, jar, node_says)).is_none());
    assert_eq!(campus.paths().len(), 1);
}

#[test]
fn a_session_signed_out_is_no_longer_answered_for() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive")]);
    assert!(ask(&gateway, SESSION, &cookie).is_some());

    // Anything but the sign-out itself changes nothing.
    gateway.saw_request(&Method::GET, "/__ent_auth/logout", Some(&cookie));
    gateway.saw_request(&Method::POST, "/__ent_auth/login", Some(&cookie));
    assert!(ask(&gateway, SESSION, &cookie).is_some());

    // The sign-out on its way to Node: a copy of the cookie is worth
    // nothing here from then on, as at Node's.
    gateway.saw_request(&Method::POST, "/__ent_auth/logout", Some(&cookie));
    let asked = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie), None);
    assert_eq!(ask(&gateway, ACCOUNT, &cookie), None);
    assert_eq!(campus.paths().len(), asked);
    assert!(ask(&gateway, SESSION, &other).is_some());
}

#[test]
fn a_session_node_says_is_gone_is_no_longer_answered_for() {
    let campus = campus();
    for gone in [
        ("x-tafac-session", "expired"),
        ("set-cookie", "__Host-lent_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"),
    ] {
        let gateway = campus.gateway();
        let cookie = campus.alive();
        let mut headers = HeaderMap::new();
        // Node's ordinary answer: the cookie set again.
        headers.append(SET_COOKIE, HeaderValue::from_static("__Host-lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly"));
        gateway.saw_response(Some(&cookie), &headers);
        assert!(ask(&gateway, SESSION, &cookie).is_some());

        headers.append(gone.0, HeaderValue::from_static(gone.1));
        gateway.saw_response(Some(&cookie), &headers);
        assert_eq!(ask(&gateway, SESSION, &cookie), None, "{}", gone.0);
    }
}

#[test]
fn node_is_asked_now_and_then_what_it_is_set_up_for() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let asked = AtomicU32::new(0);
    let counted = |_university: String| {
        asked.fetch_add(1, Ordering::SeqCst);
        async { Some(br#"{"analyticsEnabled":false,"university":"univ-rennes"}"#.to_vec()) }
    };
    for _ in 0..2 {
        let response = block_on(gateway.answer(&Method::GET, SESSION, || Some(cookie.clone()), counted)).unwrap();
        let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(answer["analyticsEnabled"], false);
    }
    assert_eq!(asked.load(Ordering::SeqCst), 1);

    // Long after: asked again (Node may have started again since).
    if let Some(long_ago) = Instant::now().checked_sub(FACTS_KEPT + Duration::from_secs(1)) {
        gateway.node.facts.lock().unwrap().get_mut(UNIVERSITY).unwrap().1 = long_ago;
        assert!(block_on(gateway.answer(&Method::GET, SESSION, || Some(cookie.clone()), counted)).is_some());
        assert_eq!(asked.load(Ordering::SeqCst), 2);
    }
}

#[test]
fn a_node_that_doesnt_say_leaves_the_answer_to_itself() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    for said in [None, Some(b"not json".to_vec()), Some(br#"{"analyticsEnabled":true,"university":"univ-rennes-2"}"#.to_vec())] {
        let silent = move |_university: String| async move { said };
        assert!(block_on(gateway.answer(&Method::GET, SESSION, || Some(cookie.clone()), silent)).is_none());
    }
    assert_eq!(read_facts(UNIVERSITY, NODE_SAYS), Some(NodeFacts { analytics_enabled: true }));
    assert_eq!(read_facts(UNIVERSITY, br#"{"university":"univ-rennes"}"#), None);
}

fn node_session(user: &str) -> NodeSession {
    NodeSession { id: "one-session".into(), university: UNIVERSITY.into(), user: user.into(), demo: false, cookies: Vec::new() }
}

#[test]
fn an_account_holds_what_the_portal_said_and_no_more() {
    let Translated::Answer(response) = account::translate(Ok(&profile()), &node_session("JDoe")) else { panic!("an answer") };
    let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(answer, serde_json::json!({ "authenticated": true, "account": { "sub": "jdoe", "given_name": "Jeanne" }, "sessionMode": null }));
}

#[test]
fn whatever_tonapi_cant_answer_is_translated_to_node() {
    let campus = campus();
    let settings = crate::universities::University::of(campus.settings()).unwrap();
    let session_of = node_session("jdoe");
    for why in [
        Unanswered::Problem(tonapi_core::ErrorCode::SessionExpired),
        Unanswered::Problem(tonapi_core::ErrorCode::ServiceUnavailable),
        Unanswered::Problem(tonapi_core::ErrorCode::UpstreamChanged),
        Unanswered::Problem(tonapi_core::ErrorCode::Internal),
        Unanswered::Slow,
        Unanswered::CookiesChanged,
        Unanswered::NoPortalSession,
        Unanswered::Failed,
    ] {
        assert!(matches!(session::translate(Err(why), &session_of, &settings, true), Translated::Node(_)), "{why}");
        assert!(matches!(account::translate(Err(why), &session_of), Translated::Node(_)), "{why}");
    }
    // The portal answering for another student is nobody's answer.
    let other = node_session("asmith");
    assert!(matches!(session::translate(Ok(&profile()), &other, &settings, true), Translated::Node(_)));
    assert!(matches!(account::translate(Ok(&profile()), &other), Translated::Node(_)));
}
