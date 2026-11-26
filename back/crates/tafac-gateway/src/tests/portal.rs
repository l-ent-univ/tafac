// The session check and the account, on the made-up campus: what the
// gateway answers, its errors too, and what it leaves to Node.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use http::header::{HeaderValue, SET_COOKIE};
use http::{HeaderMap, Method};
use tonapi_core::Profile;

use super::{ask, asked, error_of, never, unavailable, ACCOUNT, GET, NO_HEADERS, POST, SESSION};
use crate::gateway::portal::EARLY_KEPT;
use crate::session::cookie::{Session, DEVELOPMENT_COOKIE};
use crate::testing::*;
use crate::translate::{account, session, Failure, Translated, Unanswered};
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
            "analyticsEnabled": false,
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
    for (method, path) in [(&GET, "/__ent_auth/planning"), (&POST, SESSION), (&GET, "/__ent_auth/login"), (&GET, "/")] {
        assert!(block_on(gateway.answer(&asked(method, path, &NO_HEADERS, &[]), || Some(cookie.clone()), never)).is_none(), "{method} {path}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn the_check_made_at_the_start_answers_the_pages_first_one() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    block_on(gateway.check_early(Some(&cookie)));
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
fn a_portal_session_found_lapsed_at_the_start_is_opened_again_ahead() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.lapsed();
    block_on(gateway.check_early(Some(&cookie)));
    // The portal was signed in to again while the page started: its first
    // check waits for nothing.
    let asked = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
    assert_eq!(campus.paths().len(), asked);
}

#[test]
fn the_check_made_at_the_start_is_for_that_session_as_it_was() {
    let campus = campus();
    let gateway = campus.gateway();
    block_on(gateway.check_early(Some(&campus.lapsed())));
    let asked = campus.paths().len();
    // Node signed in to the portal again since: other cookies.
    assert!(ask(&gateway, SESSION, &campus.alive()).is_some());
    assert_eq!(campus.paths().len(), asked + 1);

    // Another session altogether.
    block_on(gateway.check_early(Some(&campus.alive())));
    let other = campus.cookie(serde_json::json!({ "id": "another-session" }), &[("JSESSIONID", "alive"), ("lb", "node2")]);
    let asked = campus.paths().len();
    ask(&gateway, SESSION, &other).unwrap();
    assert_eq!(campus.paths().len(), asked + 1);

    // Too long ago.
    block_on(gateway.check_early(Some(&campus.alive())));
    if let Some(long_ago) = Instant::now().checked_sub(EARLY_KEPT + Duration::from_secs(1)) {
        block_on(gateway.early.check.lock()).as_mut().unwrap().at = long_ago;
        let asked = campus.paths().len();
        ask(&gateway, SESSION, &campus.alive()).unwrap();
        assert_eq!(campus.paths().len(), asked + 1);
    }
}

#[test]
fn nothing_is_asked_at_the_start_when_nobody_is_signed_in() {
    let campus = campus();
    let gateway = campus.gateway();
    block_on(gateway.check_early(None));
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[("JSESSIONID", "alive")]);
    block_on(gateway.check_early(Some(&demo)));
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn a_check_that_failed_at_the_start_is_the_first_ones_error() {
    let campus = campus();
    let gateway = campus.gateway();
    // No portal session left, and no CAS to open one with: the app starts
    // without the university.
    let cookie = campus.lapsed();
    campus.cas_is_down(true);
    block_on(gateway.check_early(Some(&cookie)));
    let asked = campus.paths().len();
    assert_eq!(error_of(&gateway, SESSION, &cookie), unavailable());
    assert_eq!(campus.paths().len(), asked);
    // The session lives: once the CAS is back, so is the answer.
    campus.cas_is_down(false);
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
}

#[test]
fn a_portal_that_no_longer_knows_the_session_is_signed_in_to_again_here() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.lapsed();
    // Node is asked nothing (`ask`): the check is answered here, the
    // session's cookie as it was.
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["authenticated"], true);
    let seen = campus.seen.lock().unwrap().clone();
    // Asked first with the cookie's own portal session, which the portal no
    // longer knows; then with one tonAPI opened with the CAS ticket.
    let at_the_portal: Vec<_> = seen.iter().filter(|(path, _)| path.starts_with("/api/v5-1/userinfo")).map(|(_, cookies)| cookies.as_str()).collect();
    assert!(at_the_portal.first().unwrap().contains("JSESSIONID=lapsed"));
    assert!(at_the_portal.last().unwrap().contains("JSESSIONID=alive"));
    assert!(seen.iter().any(|(path, cookies)| path.starts_with("/cas/login?service=") && cookies.contains("TGC=the-ticket")));
    // The portal is never shown the ticket.
    assert!(seen.iter().filter(|(path, _)| path.starts_with("/api/")).all(|(_, cookies)| !cookies.contains("TGC")));

    // The portal session opened is held here: the next check is one
    // request with it, and the CAS isn't asked again.
    let asked_before = campus.paths().len();
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
    assert_eq!(campus.paths()[asked_before..], ["/api/v5-1/userinfo"]);
    let last = campus.seen.lock().unwrap().last().cloned().unwrap();
    assert!(last.1.contains("JSESSIONID=alive") && !last.1.contains("lapsed"));

    // And when the portal forgets that one too: opened again, by itself.
    campus.portal_forgets();
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
    assert!(campus.seen.lock().unwrap().last().unwrap().1.contains("JSESSIONID=alive-1"));
}

#[test]
fn a_session_without_a_portal_cookie_opens_the_portal_with_its_ticket() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.cookie(serde_json::json!({}), &[]);
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["cookieNames"], serde_json::json!([]));
    assert_eq!(ask(&gateway, ACCOUNT, &cookie).unwrap()["account"]["sub"], "jdoe");
}

#[test]
fn what_is_not_a_plain_signed_in_session_is_nodes_without_a_request() {
    let campus = campus();
    let gateway = campus.gateway();
    let alive = [("JSESSIONID", "alive")];
    for (why, cookie) in [
        ("the demo account", campus.cookie(serde_json::json!({ "mode": "demo" }), &alive)),
        ("another university", campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &alive)),
        ("no CAS ticket", campus.cookie(serde_json::json!({ "jar": [["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }), &[])),
        ("past its lifetime", campus.cookie(serde_json::json!({ "createdAt": crate::gateway::now_ms() - 31 * 24 * 60 * 60 * 1000 }), &alive)),
        ("not Node's cookie", "v1.AAAA.AAAA.AAAA".to_string()),
    ] {
        assert_eq!(ask(&gateway, SESSION, &cookie), None, "{why}");
        assert_eq!(ask(&gateway, ACCOUNT, &cookie), None, "{why}");
    }
    assert!(block_on(gateway.answer(&asked(&GET, SESSION, &NO_HEADERS, &[]), || None, never)).is_none());
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
fn a_portal_answering_for_someone_else_is_nobodys_answer() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.cookie(serde_json::json!({}), &[("JSESSIONID", "someone-else")]);
    // The route's error, and nothing of what the portal said of the other.
    assert_eq!(error_of(&gateway, SESSION, &cookie), unavailable());
    assert_eq!(error_of(&gateway, ACCOUNT, &cookie), unavailable());
}

#[test]
fn a_portal_that_cant_be_asked_is_the_routes_error_and_the_session_lives() {
    let campus = campus();
    let gateway = campus.gateway();
    // The portal's own session lapsed, and the CAS, which would open
    // another, is down: nothing says the student's session is over.
    let cookie = campus.lapsed();
    campus.cas_is_down(true);
    // Node's own answer to a portal it can't ask, on a production server.
    assert_eq!(error_of(&gateway, SESSION, &cookie), unavailable());
    assert_eq!(error_of(&gateway, ACCOUNT, &cookie), unavailable());
    assert!(gateway.signed_in(Some(&cookie)).is_some());

    // A development server says why, as Node's does: tonAPI's own code, or
    // words of this crate.
    let development = Gateway::for_tests(vec![campus.settings()], SECRET, DEVELOPMENT_COOKIE);
    let (status, said) = error_of(&development, SESSION, &cookie);
    let why = said["error"].as_str().unwrap();
    assert_eq!(status, 500);
    assert!(why != "Service indisponible pour le moment" && !why.is_empty() && !why.contains("jdoe"), "{why}");

    // The CAS is back: the same session is answered for again.
    campus.cas_is_down(false);
    assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["user"], "jdoe");
}

#[test]
fn a_session_gone_while_the_portal_was_asked_is_nodes() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // The jar holds the cookie when the request comes, no longer when the
    // portal has answered (a sign-out went through meanwhile).
    let shown = AtomicU32::new(0);
    let jar = || (shown.fetch_add(1, Ordering::SeqCst) == 0).then(|| cookie.clone());
    assert!(block_on(gateway.answer(&asked(&GET, SESSION, &NO_HEADERS, &[]), jar, never)).is_none());
    assert_eq!(campus.paths().len(), 1);

    // The same for an error: it is about a session that is no longer there.
    let someone_else = campus.cookie(serde_json::json!({}), &[("JSESSIONID", "someone-else")]);
    let shown = AtomicU32::new(0);
    let jar = || (shown.fetch_add(1, Ordering::SeqCst) == 0).then(|| someone_else.clone());
    assert!(block_on(gateway.answer(&asked(&GET, SESSION, &NO_HEADERS, &[]), jar, never)).is_none());
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
fn a_session_node_says_is_gone_is_gone_here_too() {
    let campus = campus();
    let said = |gone: (&'static str, &'static str)| {
        let gateway = campus.gateway();
        let cookie = campus.alive();
        let mut headers = HeaderMap::new();
        // Node's ordinary answer: the cookie set again.
        headers.append(SET_COOKIE, HeaderValue::from_static("__Host-lent_session=v1.a.b.c; Max-Age=2592000; Path=/; HttpOnly"));
        gateway.saw_response(Some(&cookie), &headers);
        assert!(ask(&gateway, SESSION, &cookie).is_some());

        headers.append(gone.0, HeaderValue::from_static(gone.1));
        gateway.saw_response(Some(&cookie), &headers);
        (ask(&gateway, SESSION, &cookie), block_on(gateway.answer(&asked(&GET, ACCOUNT, &NO_HEADERS, &[]), || Some(cookie.clone()), never)))
    };

    // Node found it expired: whoever still shows the cookie is told so
    // here, as Node tells it, and the cookie isn't touched again.
    let (check, account) = said(("x-tafac-session", "expired"));
    let check = check.unwrap();
    assert_eq!((&check["authenticated"], &check["expired"], &check["university"]), (&false.into(), &true.into(), &UNIVERSITY.into()));
    let account = account.unwrap();
    assert_eq!(account.status(), 401);
    assert_eq!(account.headers()["x-tafac-session"], "expired");
    assert!(account.headers().get(SET_COOKIE).is_none());

    // Node took the cookie away (a sign-out it answered): Node's to refuse.
    let (check, account) = said(("set-cookie", "__Host-lent_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"));
    assert!(check.is_none() && account.is_none());
}

#[test]
fn the_statistics_are_said_on_as_node_is_set_up_without_asking_it() {
    let campus = campus();
    let cookie = campus.alive();
    // Node's own setting, read where Node reads it (POSTHOG_PROJECT_KEY):
    // on with a key, off without one. Node is asked nothing (`ask`).
    for (key, on) in [(Some("phc_made_up"), true), (Some("  "), false), (None, false)] {
        let gateway = campus.gateway().with_statistics(key);
        assert_eq!(ask(&gateway, SESSION, &cookie).unwrap()["analyticsEnabled"], on, "{key:?}");
        // A session found expired says the same.
        gateway.saw_response(Some(&cookie), &HeaderMap::from_iter([(http::HeaderName::from_static("x-tafac-session"), HeaderValue::from_static("expired"))]));
        let expired = ask(&gateway, SESSION, &cookie).unwrap();
        assert_eq!((&expired["expired"], &expired["analyticsEnabled"]), (&true.into(), &on.into()), "{key:?}");
    }
}

fn node_session(user: &str) -> Session {
    Session { id: "one-session".into(), university: UNIVERSITY.into(), user: user.into(), demo: false, cookies: Vec::new() }
}

#[test]
fn an_account_holds_what_the_portal_said_and_no_more() {
    let Translated::Answer(response) = account::translate(Ok(&profile()), &node_session("JDoe")) else { panic!("an answer") };
    let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(answer, serde_json::json!({ "authenticated": true, "account": { "sub": "jdoe", "given_name": "Jeanne" }, "sessionMode": null }));
}

#[test]
fn whatever_tonapi_cant_answer_is_the_routes_error_or_a_session_to_ask_the_cas_about() {
    let campus = campus();
    let settings = crate::universities::University::of(campus.settings()).unwrap();
    let session_of = node_session("jdoe");
    for why in [
        Unanswered::Problem(tonapi_core::ErrorCode::ServiceUnavailable),
        Unanswered::Problem(tonapi_core::ErrorCode::UpstreamChanged),
        Unanswered::Problem(tonapi_core::ErrorCode::Internal),
        Unanswered::Slow,
        Unanswered::CookiesChanged,
        Unanswered::NoPortalSession,
        Unanswered::Failed,
    ] {
        // Why, for the log: tonAPI's code or words of this crate.
        let failed = Failure::Unavailable(why.to_string());
        assert!(matches!(session::translate(Err(why), &session_of, &settings, true), Translated::Failed(failure) if failure == failed), "{why}");
        assert!(matches!(account::translate(Err(why), &session_of), Translated::Failed(failure) if failure == failed), "{why}");
    }
    // The university no longer knows the session: the CAS says whether it
    // is over.
    let lost = Unanswered::Problem(tonapi_core::ErrorCode::SessionExpired);
    assert!(matches!(session::translate(Err(lost), &session_of, &settings, true), Translated::Lost));
    assert!(matches!(account::translate(Err(lost), &session_of), Translated::Lost));
    // The portal answering for another student is nobody's answer.
    let other = node_session("asmith");
    assert!(matches!(session::translate(Ok(&profile()), &other, &settings, true), Translated::Failed(Failure::Unavailable(_))));
    assert!(matches!(account::translate(Ok(&profile()), &other), Translated::Failed(Failure::Unavailable(_))));
}
