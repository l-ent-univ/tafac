// POST /__ent_auth/login and /logout on the made-up campus: the session
// made by tonAPI's sign-in and written here, what the CAS refuses, what
// waits, the one-time code the CAS asks some students for, what is Node's,
// and the session ended.

use http::header::{CONTENT_TYPE, RETRY_AFTER};
use http::HeaderMap;

use super::{ask, asked, body_of, cookie_set, never, Node, ACCOUNT, LOGIN, LOGOUT, POST, SESSION};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY, UNIVERSITY_HEADER};

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    headers
}

// The page's sign-in, as src/entApi.js sends it.
fn login(username: &str, password: &str) -> String {
    serde_json::json!({ "username": username, "password": password, "university": UNIVERSITY }).to_string()
}

// The same with the second factor's own fields: `otp`, `sendCode`, `quiet`.
fn login_with(username: &str, more: serde_json::Value) -> String {
    let mut body = serde_json::json!({ "username": username, "password": PASSWORD, "university": UNIVERSITY });
    for (name, value) in more.as_object().unwrap() {
        body[name] = value.clone();
    }
    body.to_string()
}

// What a second factor's answer says: its status, its code, its `mfa`.
fn second_factor(response: &http::Response<Vec<u8>>) -> (u16, String, serde_json::Value) {
    let body = body_of(response);
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    (response.status().as_u16(), body["code"].as_str().unwrap_or_default().to_string(), body["mfa"].clone())
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
    assert_eq!((held.session.user.as_str(), held.session.university.as_str()), ("jdoe", UNIVERSITY));
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

// The page signs in to the demo account by itself and never posts its
// login (src/demoSession.js). Posted all the same (a page from before), it
// is a login like any other: the CAS refuses it, Node is asked nothing.
#[test]
fn the_demo_accounts_login_is_a_login_like_any_other() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let response = sign_in(&gateway, &node, &login("demo@tafac.fr", "tafac-demo")).unwrap();
    assert_eq!(response.status(), 401);
    assert_eq!(body_of(&response)["code"], "login_refused");
    assert!(cookie_set(&response).is_none());
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
    campus.cas_is_down(true);
    // The CAS answers an error to the request for its form: a page tonAPI
    // doesn't know, which says nothing of the login.
    let response = block_on(gateway.answer(&asked(&POST, LOGIN, &json_headers(), login(STUDENT, PASSWORD).as_bytes()), || None, never)).unwrap();
    assert_eq!(response.status(), 401);
    // No code: the desktop app keeps the login it has.
    assert!(body_of(&response).get("code").is_none());
    assert_eq!(campus.posted_to("/cas/login"), 0);
}

#[test]
fn a_second_factor_sends_the_only_way_to_a_code_and_takes_the_code() {
    let campus = campus();
    let gateway = campus.gateway();
    let ways = serde_json::json!({ "app": false, "sms": null, "mail": MAIL_OF_STUDENT_WITH_CODE });

    // The CAS answers the password with its code page: a code is wanted,
    // and the student's only way to one left unasked, as the university's
    // own page sends it. Node is asked nothing.
    let response = block_on(gateway.answer(&asked(&POST, LOGIN, &json_headers(), login(STUDENT_WITH_CODE, PASSWORD).as_bytes()), || None, never)).unwrap();
    assert_eq!(body_of(&response)["error"], "MFA required.");
    assert_eq!(second_factor(&response), (401, "mfa_required".to_string(), serde_json::json!({ "methods": ways, "sent": "mail" })));
    assert!(cookie_set(&response).is_none());
    assert_eq!(campus.codes_sent(), ["otp-user random_code_mail mail auto"]);
    assert_eq!(campus.posted_to("/cas/login"), 1);

    // The code, with the login and the password again: the password posted
    // once more, then the code, and the session is one like any other.
    let with_code = login_with(STUDENT_WITH_CODE, serde_json::json!({ "otp": "246 810" }));
    let response = block_on(gateway.answer(&asked(&POST, LOGIN, &json_headers(), with_code.as_bytes()), || None, never)).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body_of(&response), serde_json::json!({ "authenticated": true, "user": "jdoe", "sessionMode": null, "university": UNIVERSITY }));
    assert_eq!(campus.posted_to("/cas/login"), 3);
    // No other code left for it.
    assert_eq!(campus.codes_sent().len(), 1);
    let cookie = cookie_set(&response).unwrap();
    let held = gateway.signed_in(Some(&cookie)).unwrap();
    assert_eq!(format!("{:?}", held.session.cookies), "[TGC@localhost/cas, JSESSIONID@127.0.0.1/]");
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
}

#[test]
fn a_sign_in_the_student_doesnt_see_sends_no_code() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    // The desktop app signing in again by itself (`quiet`).
    let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "quiet": true }))).unwrap();
    let (status, code, mfa) = second_factor(&response);
    assert_eq!((status, code.as_str(), &mfa["sent"]), (401, "mfa_required", &serde_json::Value::Null));
    assert_eq!(mfa["methods"]["mail"], MAIL_OF_STUDENT_WITH_CODE);
    assert!(campus.codes_sent().is_empty());
    assert!(node.got().is_empty());
}

#[test]
fn a_code_is_sent_by_the_way_the_student_asks_for() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let ways = serde_json::json!({ "app": true, "sms": SMS_OF_STUDENT_WITH_APP, "mail": MAIL_OF_STUDENT_WITH_APP });

    // An application, SMS and mail: nothing leaves unasked.
    let response = sign_in(&gateway, &node, &login(STUDENT_WITH_APP, PASSWORD)).unwrap();
    assert_eq!(second_factor(&response), (401, "mfa_required".to_string(), serde_json::json!({ "methods": ways, "sent": null })));
    assert!(campus.codes_sent().is_empty());

    // Asked for by SMS, then by mail: the API isn't told « unasked ».
    for (transport, sent) in [("sms", "totp-user random_code sms"), ("mail", "totp-user random_code mail")] {
        let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_APP, serde_json::json!({ "sendCode": transport }))).unwrap();
        assert_eq!(second_factor(&response), (401, "mfa_required".to_string(), serde_json::json!({ "methods": ways, "sent": transport })));
        assert_eq!(campus.codes_sent().last().unwrap(), sent);
    }

    // A way the student doesn't have: the code didn't leave, and that is
    // said, with the ways there are.
    let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "sendCode": "sms" }))).unwrap();
    assert_eq!(body_of(&response)["error"], "Could not send the code.");
    let only_mail = serde_json::json!({ "app": false, "sms": null, "mail": MAIL_OF_STUDENT_WITH_CODE });
    assert_eq!(second_factor(&response), (401, "mfa_send_failed".to_string(), serde_json::json!({ "methods": only_mail, "sent": null })));
    assert_eq!(campus.codes_sent().len(), 2);

    // The code typed from the application.
    let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_APP, serde_json::json!({ "otp": CODE }))).unwrap();
    assert_eq!(response.status(), 200);
    assert!(node.got().is_empty());
}

#[test]
fn an_api_that_doesnt_answer_leaves_the_code_to_type() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    campus.code_api_is_down(true);
    // The ways aren't known: the form still takes a code.
    let response = sign_in(&gateway, &node, &login(STUDENT_WITH_CODE, PASSWORD)).unwrap();
    assert_eq!(second_factor(&response), (401, "mfa_required".to_string(), serde_json::json!({ "methods": null, "sent": null })));
    // A code asked for can't leave.
    let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "sendCode": "mail" }))).unwrap();
    assert_eq!(second_factor(&response), (401, "mfa_send_failed".to_string(), serde_json::json!({ "methods": null, "sent": null })));
    assert!(campus.codes_sent().is_empty());
    // The CAS takes the code all the same.
    assert_eq!(sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "otp": CODE }))).unwrap().status(), 200);
    assert!(node.got().is_empty());
}

#[test]
fn a_code_the_cas_refuses_is_a_failed_attempt_and_a_code_waited_for_is_not() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    // A right password waiting for its code is no failure, however often.
    for _ in 0..10 {
        let response = sign_in(&gateway, &node, &login_with(STUDENT_WITH_APP, serde_json::json!({})));
        assert_eq!(second_factor(&response.unwrap()).1, "mfa_required");
    }

    // A code the CAS refuses is one, said as Node says it.
    let wrong = login_with(STUDENT_WITH_APP, serde_json::json!({ "otp": "000000" }));
    let response = sign_in(&gateway, &node, &wrong).unwrap();
    assert_eq!((response.status(), body_of(&response)), (http::StatusCode::UNAUTHORIZED, serde_json::json!({ "error": "Invalid OTP.", "code": "mfa_invalid" })));
    assert!(cookie_set(&response).is_none());

    // What is no code isn't posted to the CAS, and counts the same.
    let posted = campus.posted_to("/cas/login");
    let not_a_code = login_with(STUDENT_WITH_APP, serde_json::json!({ "otp": "12a456" }));
    let response = sign_in(&gateway, &node, &not_a_code).unwrap();
    assert_eq!(second_factor(&response).1, "mfa_invalid");
    assert_eq!(campus.posted_to("/cas/login"), posted);

    // The eighth failure brings the wait, and nothing goes to the CAS then.
    for _ in 0..5 {
        assert_eq!(sign_in(&gateway, &node, &wrong).unwrap().status(), 401);
    }
    let eighth = sign_in(&gateway, &node, &wrong).unwrap();
    assert_eq!((eighth.status(), eighth.headers()[RETRY_AFTER].to_str().unwrap()), (http::StatusCode::TOO_MANY_REQUESTS, "300"));
    let posted = campus.posted_to("/cas/login");
    assert_eq!(sign_in(&gateway, &node, &login_with(STUDENT_WITH_APP, serde_json::json!({ "otp": CODE }))).unwrap().status(), 429);
    assert_eq!(campus.posted_to("/cas/login"), posted);
    assert!(node.got().is_empty());
}

#[test]
fn the_codes_sent_to_one_student_are_counted() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let ask_by_mail = login_with(STUDENT_WITH_APP, serde_json::json!({ "sendCode": "mail" }));
    // Five codes within the window, the one sent unasked among them.
    assert_eq!(second_factor(&sign_in(&gateway, &node, &login(STUDENT_WITH_CODE, PASSWORD)).unwrap()).2["sent"], "mail");
    for _ in 0..4 {
        let asked_for = login_with(STUDENT_WITH_CODE, serde_json::json!({ "sendCode": "mail" }));
        assert_eq!(second_factor(&sign_in(&gateway, &node, &asked_for).unwrap()).2["sent"], "mail");
    }
    assert_eq!(campus.codes_sent().len(), 5);

    // Asking for one more waits, without the CAS being asked.
    let posted = campus.posted_to("/cas/login");
    let sixth = sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "sendCode": "mail" }))).unwrap();
    assert_eq!(sixth.status(), 429);
    assert_eq!(sixth.headers()[RETRY_AFTER], "300");
    assert_eq!(body_of(&sixth), serde_json::json!({ "error": "Too many codes requested. Please try again later.", "code": "mfa_send_limit" }));
    assert_eq!(campus.posted_to("/cas/login"), posted);
    // None leaves unasked either; the sign-in itself goes on, and the code
    // already sent is taken.
    let (status, code, mfa) = second_factor(&sign_in(&gateway, &node, &login(STUDENT_WITH_CODE, PASSWORD)).unwrap());
    assert_eq!((status, code.as_str(), &mfa["sent"]), (401, "mfa_required", &serde_json::Value::Null));
    assert_eq!(campus.codes_sent().len(), 5);
    assert_eq!(sign_in(&gateway, &node, &login_with(STUDENT_WITH_CODE, serde_json::json!({ "otp": CODE }))).unwrap().status(), 200);

    // Another student's codes are their own.
    assert_eq!(second_factor(&sign_in(&gateway, &node, &ask_by_mail).unwrap()).2["sent"], "mail");
    assert!(node.got().is_empty());
}

#[test]
fn a_sign_in_is_never_nodes() {
    let campus = campus();
    let gateway = campus.server_gateway();
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
    // Refused, in Node's words, the CAS asked nothing: a university the
    // gateway doesn't serve, by the body or by the header; no login or no
    // password, or no JSON to read them from.
    let unknown = serde_json::json!({ "error": "Unknown university \"univ-rennes-2\"." });
    let no_login = serde_json::json!({ "error": "Username and password are required." });
    for (why, headers, body, said) in [
        ("another university", &json, credentials(Some("univ-rennes-2")), &unknown),
        ("another university, by the header", &elsewhere, credentials(None), &unknown),
        ("no password", &json, serde_json::json!({ "username": STUDENT, "university": UNIVERSITY }).to_string(), &no_login),
        ("not JSON", &no_type, credentials(Some(UNIVERSITY)), &no_login),
    ] {
        let answer = block_on(gateway.answer(&asked(&POST, LOGIN, headers, body.as_bytes()), || None, never)).unwrap();
        assert_eq!((answer.status().as_u16(), &body_of(&answer)), (400, said), "{why}");
        assert!(answer.headers().get(http::header::SET_COOKIE).is_none(), "{why}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());

    // Signed in, as Node chose the university: the body's when it names
    // one served, else the header's, else the one the request is for (the
    // default one here).
    for (why, headers, body) in [
        ("the header's, the body's naming none served", &by_header, credentials(Some("univ-rennes-2"))),
        ("the header alone", &by_header, credentials(None)),
        ("none said", &json, credentials(None)),
    ] {
        let answer = block_on(gateway.answer(&asked(&POST, LOGIN, headers, body.as_bytes()), || None, never)).unwrap();
        assert_eq!((answer.status().as_u16(), &body_of(&answer)["university"]), (200, &UNIVERSITY.into()), "{why}");
    }
}

#[test]
fn a_sign_out_ends_the_session_at_the_cas_here_and_at_nodes() {
    let campus = campus();
    let gateway = campus.server_gateway();
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
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["authenticated"], false);
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
fn a_sign_out_without_a_session_held_here_is_answered_as_nodes() {
    let campus = campus();
    let gateway = campus.server_gateway().without_node();
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    let without_ticket = campus.cookie(serde_json::json!({ "jar": [] }), &[]);
    for cookie in [Some(demo), Some(elsewhere), Some("v1.AAAA.AAAA.AAAA".to_string()), Some(without_ticket.clone()), None] {
        let headers = HeaderMap::new();
        let response = block_on(gateway.answer(&asked(&POST, LOGOUT, &headers, &[]), || cookie.clone(), never)).unwrap();
        assert_eq!((response.status().as_u16(), body_of(&response)), (200, serde_json::json!({ "authenticated": false })));
        assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
        assert!(response.headers().get("x-tafac-session").is_none());
    }
    // The session without its ticket ended with it.
    assert!(gateway.memory.ended(&crate::session::cookie::Codec::new(SECRET).read(&without_ticket, crate::gateway::now_ms()).unwrap().id).is_some());
    assert!(campus.seen.lock().unwrap().is_empty());
}
