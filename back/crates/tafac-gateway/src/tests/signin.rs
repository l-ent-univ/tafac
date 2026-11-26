// POST /__ent_auth/login and /logout on the made-up campus: the session
// made by tonAPI's sign-in and written here, what the CAS refuses, what
// waits, what is Node's, and the session ended.

use http::header::{CONTENT_TYPE, RETRY_AFTER};
use http::HeaderMap;

use super::{ask, asked, body_of, cookie_set, never, Node, ACCOUNT, LOGIN, LOGOUT, NODES_SESSION, POST, SESSION};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY, UNIVERSITY_HEADER};

const MFA_REQUIRED: &str = r#"{"error":"MFA required.","code":"mfa_required","mfa":{"methods":{"app":true,"sms":null,"mail":null},"sent":null}}"#;

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    headers
}

// The page's sign-in, as src/entApi.js sends it.
fn login(username: &str, password: &str) -> String {
    serde_json::json!({ "username": username, "password": password, "university": UNIVERSITY }).to_string()
}

fn sign_in(gateway: &Gateway, node: &Node, body: &str) -> Option<http::Response<Vec<u8>>> {
    let headers = json_headers();
    block_on(gateway.answer(&asked(&POST, LOGIN, &headers, body.as_bytes()), || None, |request| node.ask(request)))
}

fn sign_out(gateway: &Gateway, node: &Node, cookie: &str) -> Option<http::Response<Vec<u8>>> {
    let headers = HeaderMap::new();
    block_on(gateway.answer(&asked(&POST, LOGOUT, &headers, &[]), || Some(cookie.to_string()), |request| node.ask(request)))
}

#[test]
fn a_sign_in_makes_the_session_and_node_is_asked_nothing() {
    let campus = campus();
    let gateway = campus.gateway();
    let response = block_on(gateway.answer(&asked(&POST, LOGIN, &json_headers(), login(" jdoe ", PASSWORD).as_bytes()), || None, never)).unwrap();

    // Node's own answer to a login, field for field.
    assert_eq!(response.status(), 200);
    assert_eq!(body_of(&response), serde_json::json!({ "authenticated": true, "user": "jdoe", "sessionMode": null, "university": UNIVERSITY }));
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    let set = response.headers()["set-cookie"].to_str().unwrap();
    assert!(set.ends_with("; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax"), "{set}");

    // The password was posted once, to the CAS, and nowhere else.
    assert_eq!(*campus.posted.lock().unwrap(), ["/cas/login"]);

    // The cookie is a session like any other: the CAS ticket and the
    // portal's session, which the portal knows.
    let cookie = cookie_set(&response).unwrap();
    let held = gateway.signed_in(Some(&cookie)).unwrap();
    assert_eq!((held.session.user.as_str(), held.session.university.as_str(), held.session.demo), ("jdoe", UNIVERSITY, false));
    assert_eq!(format!("{:?}", held.session.cookies), "[TGC@localhost/cas, JSESSIONID@127.0.0.1/]");
    let asked_before = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
    // The account that follows a sign-in is the profile the sign-in read.
    assert_eq!(ask(&gateway, ACCOUNT, &cookie).unwrap()["account"]["email"], "jeanne.doe@exemple.test");
    assert_eq!(campus.paths().len(), asked_before + 1);
}

#[test]
fn every_sign_in_is_a_session_of_its_own() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let first = cookie_set(&sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap()).unwrap();
    let second = cookie_set(&sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap()).unwrap();
    assert_ne!(first, second);
    assert_ne!(gateway.signed_in(Some(&first)).unwrap().session.id, gateway.signed_in(Some(&second)).unwrap().session.id);
    assert!(node.got().is_empty());
}

#[test]
fn a_password_the_cas_refuses_is_said_as_node_says_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let response = sign_in(&gateway, &node, &login(STUDENT, "not-the-password")).unwrap();
    assert_eq!(response.status(), 401);
    // The CAS's own words, and the code the desktop app forgets its kept
    // login on.
    assert_eq!(body_of(&response), serde_json::json!({ "error": "Invalid credentials.", "code": "login_refused" }));
    assert!(cookie_set(&response).is_none());
    // Posted once: a refused password isn't tried again, by Node either.
    assert_eq!(campus.posted_to("/cas/login"), 1);
    assert!(node.got().is_empty());
}

#[test]
fn too_many_failures_wait_and_a_good_sign_in_clears_them() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    for _ in 0..7 {
        assert_eq!(sign_in(&gateway, &node, &login(STUDENT, "wrong")).unwrap().status(), 401);
    }
    // Seven mistakes then the right password: the count starts over.
    assert_eq!(sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap().status(), 200);
    for _ in 0..7 {
        assert_eq!(sign_in(&gateway, &node, &login(STUDENT, "wrong")).unwrap().status(), 401);
    }
    // The eighth failure brings the wait, as Node's own does.
    let eighth = sign_in(&gateway, &node, &login(STUDENT, "wrong")).unwrap();
    assert_eq!(eighth.status(), 429);
    assert_eq!(eighth.headers()[RETRY_AFTER], "300");
    assert_eq!(body_of(&eighth), serde_json::json!({ "error": "Too many login attempts. Please try again later." }));

    // While it waits nothing goes to the CAS, the right password neither.
    let posted = campus.posted_to("/cas/login");
    let waiting = sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap();
    assert_eq!(waiting.status(), 429);
    assert!(waiting.headers()[RETRY_AFTER].to_str().unwrap().parse::<u64>().unwrap() <= 300);
    assert_eq!(campus.posted_to("/cas/login"), posted);
    assert!(node.got().is_empty());
}

#[test]
fn a_cas_that_doesnt_answer_is_no_refusal() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    campus.cas_is_down(true);
    // The CAS answers an error to the request for its form: tonAPI calls
    // it a page it doesn't know, and Node's own login tries (and fails the
    // same way).
    *node.login.lock().unwrap() = Some((401, r#"{"error":"Could not extract the CAS login form."}"#));
    let response = sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap();
    assert_eq!(response.status(), 401);
    // No code: the desktop app keeps the login it has.
    assert!(body_of(&response).get("code").is_none());
    assert_eq!(campus.posted_to("/cas/login"), 0);
}

#[test]
fn a_second_factor_is_nodes_own_login() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    *node.login.lock().unwrap() = Some((401, MFA_REQUIRED));

    // The CAS answers the password with its code page: the page's request
    // goes to Node as it came, and Node's answer to the page as it is.
    let request = login(STUDENT_WITH_CODE, PASSWORD);
    let headers = {
        let mut headers = json_headers();
        // A length said by the page for a body it sent another way: the
        // request Node gets says the length of the body Node gets.
        headers.insert("content-length", "7".parse().unwrap());
        headers.insert("transfer-encoding", "chunked".parse().unwrap());
        headers
    };
    let seen = std::sync::Mutex::new(None);
    let recorded = block_on(gateway.answer(&asked(&POST, LOGIN, &headers, request.as_bytes()), || None, |to_node| {
        *seen.lock().unwrap() = Some((to_node.headers().get("content-length").cloned(), to_node.headers().contains_key("transfer-encoding")));
        node.ask(to_node)
    }));
    assert_eq!(recorded.unwrap().status(), 401);
    assert_eq!(*seen.lock().unwrap(), Some((Some(http::HeaderValue::from(request.len())), false)));
    node.got.lock().unwrap().clear();
    let response = sign_in(&gateway, &node, &request).unwrap();
    assert_eq!(response.status(), 401);
    assert_eq!(response.body(), MFA_REQUIRED.as_bytes());
    assert!(response.headers().get(ANSWERED_BY).is_none());
    assert_eq!(node.got(), ["POST /__ent_auth/login"]);
    assert_eq!(node.got.lock().unwrap()[0].2, request.as_bytes());

    // The code, or a code to send: Node's at once, the CAS isn't asked here.
    let asked_before = campus.paths().len();
    *node.login.lock().unwrap() = None;
    let with_code = serde_json::json!({ "username": STUDENT_WITH_CODE, "password": PASSWORD, "otp": "123456", "university": UNIVERSITY }).to_string();
    let response = sign_in(&gateway, &node, &with_code).unwrap();
    assert_eq!(response.status(), 200);
    // The session Node made: its cookie goes to the page as Node set it.
    assert_eq!(cookie_set(&response).as_deref(), Some(NODES_SESSION));
    let send = serde_json::json!({ "username": STUDENT_WITH_CODE, "password": PASSWORD, "sendCode": "sms", "university": UNIVERSITY }).to_string();
    *node.login.lock().unwrap() = Some((401, MFA_REQUIRED));
    assert_eq!(sign_in(&gateway, &node, &send).unwrap().body(), MFA_REQUIRED.as_bytes());
    assert_eq!(campus.paths().len(), asked_before);
    assert_eq!(node.got().len(), 3);
}

#[test]
fn what_node_says_of_its_own_sign_ins_counts_here_too() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let with_code = serde_json::json!({ "username": STUDENT_WITH_CODE, "password": PASSWORD, "otp": "000000", "university": UNIVERSITY }).to_string();
    // A right password waiting for its code is no failure, however often.
    *node.login.lock().unwrap() = Some((401, MFA_REQUIRED));
    for _ in 0..10 {
        assert_eq!(sign_in(&gateway, &node, &with_code).unwrap().status(), 401);
    }
    // A code the CAS refuses is one: the eighth waits, here as at Node's.
    *node.login.lock().unwrap() = Some((401, r#"{"error":"Invalid OTP.","code":"mfa_invalid"}"#));
    for _ in 0..7 {
        assert_eq!(sign_in(&gateway, &node, &with_code).unwrap().status(), 401);
    }
    assert_eq!(sign_in(&gateway, &node, &with_code).unwrap().status(), 429);
    let asked_of_node = node.got().len();
    assert_eq!(sign_in(&gateway, &node, &with_code).unwrap().status(), 429);
    assert_eq!(node.got().len(), asked_of_node);
}

#[test]
fn what_is_not_a_sign_in_at_a_university_answered_here_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let json = json_headers();
    let mut by_header = json_headers();
    by_header.insert(UNIVERSITY_HEADER, UNIVERSITY.parse().unwrap());
    let mut elsewhere = json_headers();
    elsewhere.insert(UNIVERSITY_HEADER, "univ-rennes-2".parse().unwrap());
    let no_type = HeaderMap::new();
    let credentials = |university: Option<&str>| match university {
        Some(id) => serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": id }).to_string(),
        None => serde_json::json!({ "username": STUDENT, "password": PASSWORD }).to_string(),
    };
    for (why, headers, body) in [
        ("the demo account", &json, serde_json::json!({ "username": "demo@tafac.fr", "password": "tafac-demo", "university": UNIVERSITY }).to_string()),
        ("another university", &json, credentials(Some("univ-rennes-2"))),
        ("another university, by the header", &elsewhere, credentials(None)),
        ("the body's choice before the header's", &by_header, credentials(Some("univ-rennes-2"))),
        ("no university said", &json, credentials(None)),
        ("no password", &json, serde_json::json!({ "username": STUDENT, "university": UNIVERSITY }).to_string()),
        ("not JSON", &no_type, credentials(Some(UNIVERSITY))),
    ] {
        let answer = block_on(gateway.answer(&asked(&POST, LOGIN, headers, body.as_bytes()), || None, never));
        assert!(answer.is_none(), "{why}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());

    // The university by the header alone, as a page without the body's
    // choice sends it.
    let answer = block_on(gateway.answer(&asked(&POST, LOGIN, &by_header, credentials(None).as_bytes()), || None, never)).unwrap();
    assert_eq!(answer.status(), 200);
}

#[test]
fn a_sign_out_ends_the_session_at_the_cas_here_and_at_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = cookie_set(&sign_in(&gateway, &node, &login(STUDENT, PASSWORD)).unwrap()).unwrap();
    assert!(ask(&gateway, SESSION, &cookie).is_some());

    let response = sign_out(&gateway, &node, &cookie).unwrap();
    assert_eq!((response.status(), body_of(&response)), (http::StatusCode::OK, serde_json::json!({ "authenticated": false })));
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    // The CAS was told with the ticket, under the name that signed in.
    assert!(!campus.cas_knows_the_ticket());
    let at_the_cas = campus.seen.lock().unwrap().iter().find(|(path, _)| path == "/cas/logout").cloned().unwrap();
    assert!(at_the_cas.1.contains("TGC=the-ticket"));
    // Node was told with the session's cookie, for what it kept of it.
    let told = node.got.lock().unwrap().last().cloned().unwrap();
    assert_eq!(told.0, "POST /__ent_auth/logout");
    assert_eq!(told.1, format!("{COOKIE_NAME}={cookie}"));

    // A copy of the cookie is worth nothing from then on, and nothing of
    // the session stays.
    assert!(gateway.signed_in(Some(&cookie)).is_none());
    let asked_before = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie), None);
    assert_eq!(campus.paths().len(), asked_before);
}

#[test]
fn a_sign_out_goes_through_whatever_the_cas_and_node_say() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    campus.cas_is_down(true);
    node.unreachable.store(true, std::sync::atomic::Ordering::SeqCst);
    let response = sign_out(&gateway, &node, &cookie).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    assert!(gateway.signed_in(Some(&cookie)).is_none());
}

#[test]
fn a_sign_out_without_a_session_held_here_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    for cookie in [Some(demo), Some(elsewhere), Some("v1.AAAA.AAAA.AAAA".to_string()), None] {
        let headers = HeaderMap::new();
        assert!(block_on(gateway.answer(&asked(&POST, LOGOUT, &headers, &[]), || cookie.clone(), never)).is_none());
    }
    assert!(campus.seen.lock().unwrap().is_empty());
}
