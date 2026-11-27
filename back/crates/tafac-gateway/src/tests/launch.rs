// The launch relay on the made-up campus: a service's sign-in walked with
// the CAS ticket, and the browser sent to where the CAS sends it. And what
// Moodle's view in the apps is told it may show.

use http::header::{LOCATION, SET_COOKIE};
use http::HeaderMap;

use super::{asked, body_of, cookie_set, never, Node, GET, NO_HEADERS};
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const LAUNCH: &str = "/__ent_auth/launch";
const PREVIEW: &str = "/__ent_auth/launch-preview";
const VIEW: &str = "/__ent_auth/moodle/view";

fn encoded(text: &str) -> String {
    url::form_urlencoded::byte_serialize(text.as_bytes()).collect()
}

// An address inside another, as the campus's own services write it.
fn as_the_campus_writes(text: &str) -> String {
    text.bytes().map(|byte| if byte.is_ascii_alphanumeric() { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

// A route asked for a target, with the headers a browser adds.
fn get(gateway: &Gateway, node: &Node, route: &str, target: &str, cookie: &str, headers: &HeaderMap) -> Option<http::Response<Vec<u8>>> {
    let path = format!("{route}?url={}", encoded(target));
    block_on(gateway.answer(&asked(&GET, &path, headers, &[]), || Some(cookie.to_string()), |request| node.ask(request)))
}

fn launch(gateway: &Gateway, target: &str, cookie: &str) -> http::Response<Vec<u8>> {
    let response = get(gateway, &Node::default(), LAUNCH, target, cookie, &NO_HEADERS).unwrap();
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    response
}

fn preview(gateway: &Gateway, target: &str, cookie: &str) -> serde_json::Value {
    let response = get(gateway, &Node::default(), PREVIEW, target, cookie, &NO_HEADERS).unwrap();
    assert_eq!((response.status(), &response.headers()["cache-control"]), (http::StatusCode::OK, &"no-store".parse().unwrap()));
    body_of(&response)
}

// Where a redirect of the relay's goes.
fn sent_to(response: &http::Response<Vec<u8>>) -> &str {
    assert_eq!(response.status(), 302, "{:?}", String::from_utf8_lossy(response.body()));
    assert_eq!(response.headers()["cache-control"], "no-store");
    response.headers()[LOCATION].to_str().unwrap()
}

fn from(site: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("sec-fetch-site", site.parse().unwrap());
    headers
}

fn says_expired(response: &http::Response<Vec<u8>>) -> bool {
    response.headers().get("x-tafac-session").is_some_and(|value| value == "expired")
}

#[test]
fn a_service_behind_the_cas_opens_with_its_ticket() {
    let campus = campus();
    let gateway = campus.gateway();
    let port = campus.port();
    let catalogue = format!("http://127.0.0.1:{port}/library/catalogue");
    let response = launch(&gateway, &catalogue, &campus.alive());
    // The address the CAS sends back to: the service, with a ticket that
    // signs the browser in once.
    assert_eq!(sent_to(&response), format!("{catalogue}?ticket=ST-campus"));
    assert!(response.headers().get(SET_COOKIE).is_none() && !says_expired(&response));

    // The service was asked as a visitor it never saw, and the ticket shown
    // to the CAS only. The service's own page, with the ticket, is the
    // browser's to ask.
    let seen = campus.seen.lock().unwrap().clone();
    let asked: Vec<&str> = seen.iter().map(|(path, _)| path.split('?').next().unwrap()).collect();
    assert_eq!(asked, ["/library/catalogue", "/cas/login"]);
    assert_eq!(seen[0].1, "");
    assert_eq!(seen[1].1, "TGC=the-ticket");

    // ScoDoc's own way in, as the page's « Mes notes » opens it.
    let notes = format!("http://127.0.0.1:{port}/scodoc/services/doAuth.php?href={}", as_the_campus_writes(&format!("http://127.0.0.1:{port}/scodoc/")));
    assert_eq!(sent_to(&launch(&gateway, &notes, &campus.alive())), format!("{notes}&ticket=ST-campus"));
}

#[test]
fn the_relay_holds_nothing_and_takes_nothing_of_the_services_sessions() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // ScoDoc's session, opened for the grades and held here.
    assert!(super::ask(&gateway, "/__ent_auth/grades", &cookie).is_some());
    let before = campus.seen.lock().unwrap().len();
    let notes = format!("http://127.0.0.1:{}/scodoc/services/doAuth.php?href=x", campus.port());
    // The relay asks without it: the browser gets a ticket of its own.
    assert!(sent_to(&launch(&gateway, &notes, &cookie)).ends_with("&ticket=ST-campus"));
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen[before..].iter().all(|(path, cookies)| path.starts_with("/cas/") || cookies.is_empty()), "{:?}", &seen[before..]);
    // And the grades after it still go with ScoDoc's session: no sign-in.
    let sign_ins = campus.asked("/scodoc/services/doAuth.php");
    gateway.signed_in(Some(&cookie)).unwrap().memory.age_answers(std::time::Duration::from_secs(601));
    assert!(super::ask(&gateway, "/__ent_auth/grades", &cookie).is_some());
    assert_eq!(campus.asked("/scodoc/services/doAuth.php"), sign_ins);
}

#[test]
fn a_target_that_isnt_the_universitys_goes_back_to_the_app() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let port = campus.port();
    // Node's own cases (tests/launchTargets.test.js), and the campus's own
    // hosts over https, where they aren't.
    for target in [
        "https://evil.example/".to_string(),
        format!("http://127.0.0.1:{port}@evil.example/"),
        "http://127.0.0.1.evil.example/".to_string(),
        "http://192.168.1.1/".to_string(),
        "javascript:alert(1)".to_string(),
        "//evil.example/".to_string(),
        "/relative".to_string(),
        format!("ftp://127.0.0.1:{port}/library/catalogue"),
        format!("http://user:pass@127.0.0.1:{port}/library/catalogue"),
        String::new(),
    ] {
        assert_eq!(sent_to(&launch(&gateway, &target, &cookie)), "/", "{target}");
    }
    // No target, and one given twice (a list, which is no address).
    let node = Node::default();
    let twice = format!("{LAUNCH}?url={0}&url={0}", encoded(&format!("http://127.0.0.1:{port}/library/catalogue")));
    for path in [LAUNCH.to_string(), format!("{LAUNCH}?next=x"), twice] {
        let response = block_on(gateway.answer(&asked(&GET, &path, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
        assert_eq!(sent_to(&response), "/", "{path}");
    }
    // Nothing was asked of the campus, nor of Node.
    assert!(campus.paths().is_empty() && node.got().is_empty());
}

#[test]
fn a_link_on_another_site_makes_no_request_with_the_session() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let node = Node::default();
    let catalogue = format!("http://127.0.0.1:{}/library/catalogue", campus.port());
    // From another site: straight to the service, nothing asked for them.
    for site in ["cross-site", "same-site"] {
        let response = get(&gateway, &node, LAUNCH, &catalogue, &cookie, &from(site)).unwrap();
        assert_eq!(sent_to(&response), catalogue, "{site}");
        // And never to an address that isn't the university's.
        let elsewhere = get(&gateway, &node, LAUNCH, "https://evil.example/", &cookie, &from(site)).unwrap();
        assert_eq!(sent_to(&elsewhere), "/", "{site}");
        // The preview says the browser opens it by itself.
        let previewed = get(&gateway, &node, PREVIEW, &catalogue, &cookie, &from(site)).unwrap();
        assert_eq!(body_of(&previewed), serde_json::json!({ "finalUrl": catalogue, "chain": [], "useServerLaunch": false, "reason": "missing-session" }), "{site}");
    }
    assert!(campus.paths().is_empty());

    // From the app itself, an address typed, an old browser: the relay
    // signs in on the student's behalf.
    for headers in [from("same-origin"), from("none"), HeaderMap::new()] {
        let response = get(&gateway, &node, LAUNCH, &catalogue, &cookie, &headers).unwrap();
        assert_eq!(sent_to(&response), format!("{catalogue}?ticket=ST-campus"));
    }
    assert!(node.got().is_empty());
}

#[test]
fn where_the_relay_cant_sign_in_the_browser_goes_to_the_target() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let at = |page: &str| format!("http://127.0.0.1:{}/library/{page}", campus.port());
    // Open to anyone: as it is.
    assert_eq!(sent_to(&launch(&gateway, &at("hours"), &cookie)), at("hours"));
    // A federation (the CAS answers an IdP): the browser walks it itself.
    assert_eq!(sent_to(&launch(&gateway, &at("federated"), &cookie)), at("federated"));
    // The chain leaves the university's services: never followed there.
    assert_eq!(sent_to(&launch(&gateway, &at("partner"), &cookie)), at("partner"));
    // Round in circles, a page that isn't there.
    assert_eq!(sent_to(&launch(&gateway, &at("loop"), &cookie)), at("loop"));
    assert_eq!(sent_to(&launch(&gateway, &at("nowhere"), &cookie)), at("nowhere"));
    // A page that sends to the CAS by itself is followed there.
    assert_eq!(sent_to(&launch(&gateway, &at("reader"), &cookie)), format!("{}?ticket=ST-campus", at("reader")));
    // No host but the campus's was asked.
    assert!(campus.paths().iter().all(|path| path.starts_with("/library/") || path == "/cas/login"));
}

#[test]
fn a_session_the_cas_no_longer_knows_ends_at_the_login_form() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    let catalogue = format!("http://127.0.0.1:{}/library/catalogue", campus.port());
    campus.cas_forgets();
    // The CAS shows its login form on the way: asked, it wants the
    // password. The session ends here, and the browser goes to the app's
    // login form, which says why.
    let response = get(&gateway, &node, LAUNCH, &catalogue, &cookie, &NO_HEADERS).unwrap();
    assert_eq!(sent_to(&response), "/login?session=expired");
    assert!(says_expired(&response));
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    assert!(gateway.signed_in(Some(&cookie)).is_none());
    assert_eq!(node.got(), ["POST /__ent_auth/logout"]);

    // Whoever still shows the cookie is answered as nobody, as Node does,
    // with the word that the session expired: nothing asked of the campus.
    let asked_of_campus = campus.paths().len();
    let again = get(&gateway, &node, LAUNCH, &catalogue, &cookie, &NO_HEADERS).unwrap();
    assert_eq!((sent_to(&again), says_expired(&again)), (catalogue.as_str(), true));
    assert!(again.headers().get(SET_COOKIE).is_none());
    let elsewhere = get(&gateway, &node, LAUNCH, "https://evil.example/", &cookie, &NO_HEADERS).unwrap();
    assert_eq!((sent_to(&elsewhere), says_expired(&elsewhere)), ("/", true));
    let previewed = get(&gateway, &node, PREVIEW, &catalogue, &cookie, &NO_HEADERS).unwrap();
    assert_eq!(body_of(&previewed), serde_json::json!({ "finalUrl": catalogue, "chain": [], "useServerLaunch": false, "reason": "missing-session" }));
    assert!(says_expired(&previewed));
    assert_eq!(campus.paths().len(), asked_of_campus);
}

#[test]
fn a_cas_that_is_down_ends_no_session() {
    let campus = campus();
    let gateway = campus.gateway();
    let node = Node::default();
    let cookie = campus.alive();
    let catalogue = format!("http://127.0.0.1:{}/library/catalogue", campus.port());
    campus.cas_is_down(true);
    // Its error page is no login form: the browser goes there itself.
    let response = get(&gateway, &node, LAUNCH, &catalogue, &cookie, &NO_HEADERS).unwrap();
    assert!(sent_to(&response).starts_with(&format!("http://localhost:{}/cas/login?service=", campus.port())));
    assert!(!says_expired(&response) && response.headers().get(SET_COOKIE).is_none());
    assert!(gateway.signed_in(Some(&cookie)).is_some() && node.got().is_empty());
}

#[test]
fn moodle_by_the_cas_opens_at_its_own_login_with_the_ticket() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let port = campus.port();
    let activity = format!("http://127.0.0.1:{port}/moodle/mod/assign/view.php?id=106");
    // Started from Moodle's CAS login, whatever the page asked for: the
    // student lands on Moodle signed in.
    let login = format!("http://127.0.0.1:{port}/moodle/login/index.php?authCAS=CAS");
    assert_eq!(sent_to(&launch(&gateway, &activity, &cookie)), format!("{login}&ticket=ST-campus"));
    assert_eq!(campus.paths(), ["/moodle/login/index.php", "/cas/login"]);
    assert_eq!(
        preview(&gateway, &activity, &cookie),
        serde_json::json!({
            "finalUrl": activity, "chain": [], "useServerLaunch": true, "reason": "moodle-cas-relay",
            "canUseServerLaunch": true, "degraded": false, "degradedReason": null,
        })
    );
}

#[test]
fn moodle_behind_the_federation_is_handed_to_the_browser_as_a_form() {
    let campus = campus();
    let gateway = campus.federated_gateway();
    let cookie = campus.alive();
    let port = campus.port();
    let activity = format!("http://127.0.0.1:{port}/moodle/mod/assign/view.php?id=106&x=a%20b");
    let response = launch(&gateway, &activity, &cookie);
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "text/html; charset=utf-8");
    assert_eq!(response.headers()["cache-control"], "no-store");
    let page = String::from_utf8_lossy(response.body()).to_string();
    // The IdP's message, for Moodle's own Shibboleth, posted by the page
    // itself; the page to land on travels with it.
    assert!(page.contains(&format!(r#"<form id="handoff" method="post" action="http://127.0.0.1:{port}/moodle/Shibboleth.sso/SAML2/POST">"#)), "{page}");
    assert!(page.contains(&format!(r#"<input type="hidden" name="SAMLResponse" value="{SAML_RESPONSE}" />"#)));
    assert!(page.contains(&format!(r#"<input type="hidden" name="RelayState" value="{}" />"#, activity.replace('&', "&amp;"))));
    assert!(page.contains("form.submit()"));

    // The chain: Moodle, the discovery page (the campus chosen there), the
    // IdP, the CAS with the ticket, the IdP again. The form itself is the
    // browser's to post.
    assert_eq!(campus.paths(), ["/moodle/auth/shibboleth/index.php", "/wayf/", "/wayf/select", "/idp/sso", "/cas/login", "/idp/sso"]);
    assert_eq!(campus.posted_to("/wayf/select"), 1);
    assert!(campus.seen.lock().unwrap().iter().all(|(path, cookies)| path.starts_with("/cas/") == cookies.contains("TGC=the-ticket")));

    assert_eq!(
        preview(&gateway, &activity, &cookie),
        serde_json::json!({
            "finalUrl": activity, "chain": [], "useServerLaunch": true, "reason": "server-saml-relay",
            "canUseServerLaunch": true, "degraded": false, "degradedReason": null,
        })
    );
}

#[test]
fn a_federation_the_relay_cant_walk_leaves_moodle_to_the_browser() {
    let campus = campus();
    let gateway = campus.federated_gateway();
    let node = Node::default();
    let cookie = campus.alive();
    let dashboard = format!("http://127.0.0.1:{}/moodle/my/", campus.port());
    // The CAS down: no way through, and nothing says the session is over.
    campus.cas_is_down(true);
    let response = get(&gateway, &node, LAUNCH, &dashboard, &cookie, &NO_HEADERS).unwrap();
    assert_eq!(sent_to(&response), dashboard);
    assert!(!says_expired(&response) && gateway.signed_in(Some(&cookie)).is_some());

    // The CAS no longer knowing the ticket: its form on the way, and the
    // session over.
    campus.cas_is_down(false);
    campus.cas_forgets();
    let response = get(&gateway, &node, LAUNCH, &dashboard, &cookie, &NO_HEADERS).unwrap();
    assert_eq!(sent_to(&response), "/login?session=expired");
    assert!(says_expired(&response));
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    // The password was asked for, and nothing posted to the CAS.
    assert_eq!(campus.posted_to("/cas/login"), 0);
}

#[test]
fn the_preview_says_where_a_target_leads_and_never_a_tickets_value() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let port = campus.port();
    let at = |page: &str| format!("http://127.0.0.1:{port}/library/{page}");
    let cas = |service: &str| format!("http://localhost:{port}/cas/login?service={}", as_the_campus_writes(service));
    let with_ticket = serde_json::json!({ "canUseServerLaunch": true, "degraded": false, "degradedReason": null });
    let expected = |mut body: serde_json::Value| {
        for (name, value) in with_ticket.as_object().unwrap() {
            body[name] = value.clone();
        }
        body
    };

    // Behind the CAS: the relay signs in. One request, to the service.
    assert_eq!(
        preview(&gateway, &at("catalogue"), &cookie),
        expected(serde_json::json!({
            "finalUrl": cas(&at("catalogue")), "useServerLaunch": true, "reason": "cas-login",
            "chain": [{ "status": 302, "url": at("catalogue"), "location": cas(&at("catalogue")) }],
        }))
    );
    assert_eq!(campus.paths(), ["/library/catalogue"]);
    assert_eq!(preview(&gateway, &at("reader"), &cookie)["reason"], "cas-html-redirect");
    assert_eq!(preview(&gateway, &at("reader"), &cookie)["useServerLaunch"], true);

    // Open to anyone, another site's, round in circles: the browser's.
    assert_eq!(
        preview(&gateway, &at("hours"), &cookie),
        expected(serde_json::json!({ "finalUrl": at("hours"), "useServerLaunch": false, "reason": "direct-browser-launch", "chain": [{ "status": 200, "url": at("hours"), "location": null }] }))
    );
    let partner = preview(&gateway, &at("partner"), &cookie);
    assert_eq!((&partner["finalUrl"], &partner["useServerLaunch"], &partner["reason"]), (&at("partner").into(), &false.into(), &"direct-browser-launch".into()));
    let round = preview(&gateway, &at("loop"), &cookie);
    assert_eq!((&round["reason"], &round["error"], round["chain"].as_array().unwrap().len()), (&"too-many-redirects".into(), &"too-many-redirects".into(), 8));

    // The CAS itself as a target: it answers with a service ticket, whose
    // value stays here.
    let through_the_cas = format!("http://localhost:{port}/cas/login?service={}", encoded(&format!("http://localhost:{port}/cas/after")));
    let ticketed = preview(&gateway, &through_the_cas, &cookie);
    assert_eq!((&ticketed["reason"], &ticketed["useServerLaunch"]), (&"direct-browser-launch".into(), &false.into()));
    assert_eq!(ticketed["finalUrl"], format!("http://localhost:{port}/cas/after?ticket=ST-redacted"));
    assert!(!ticketed.to_string().contains("ST-campus"));
    let through_to_a_service = cas(&at("catalogue"));
    let ticketed = preview(&gateway, &through_to_a_service, &cookie);
    assert_eq!(ticketed["reason"], "saml-browser-handoff");
    assert_eq!(ticketed["saml"], true);
    assert_eq!(ticketed["chain"][0]["location"], format!("{}?ticket=ST-redacted", at("catalogue")));
    assert!(!ticketed.to_string().contains("ST-campus"));

    // A federation: said so.
    let federated = preview(&gateway, &at("federated"), &cookie);
    assert_eq!((&federated["reason"], &federated["useServerLaunch"]), (&"cas-login".into(), &true.into()));
}

#[test]
fn the_preview_refuses_what_isnt_a_target_as_node_does() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let node = Node::default();
    let ask = |query: &str| {
        let path = format!("{PREVIEW}{query}");
        let response = block_on(gateway.answer(&asked(&GET, &path, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
        (response.status().as_u16(), body_of(&response))
    };
    let invalid = |written: &str| serde_json::json!({ "finalUrl": written, "chain": [], "useServerLaunch": false, "reason": "invalid-target-url" });
    assert_eq!(ask(""), (400, invalid("")));
    assert_eq!(ask("?url="), (400, invalid("")));
    assert_eq!(ask("?url=%2Frelative"), (400, invalid("/relative")));
    assert_eq!(ask("?url=javascript%3Aalert(1)"), (400, invalid("javascript:alert(1)")));
    assert_eq!(ask("?url=x&url=https%3A%2F%2Fa.test%2F"), (400, invalid("x,https://a.test/")));

    let refused = |written: serde_json::Value| serde_json::json!({ "finalUrl": written, "chain": [], "useServerLaunch": false, "reason": "target-not-allowed" });
    assert_eq!(ask("?url=https%3A%2F%2Fevil.example%2F"), (200, refused("https://evil.example/".into())));
    assert_eq!(ask("?url=https%3A%2F%2Fa.test%2F&url=https%3A%2F%2Fb.test%2F"), (200, refused(serde_json::json!(["https://a.test/", "https://b.test/"]))));
    assert!(campus.paths().is_empty() && node.got().is_empty());
}

#[test]
fn who_isnt_held_here_is_answered_as_node_answered_nobody() {
    let campus = campus();
    let gateway = campus.server_gateway().without_node();
    let catalogue = format!("http://127.0.0.1:{}/library/catalogue", campus.port());
    // Nobody signed in, the demo account, another university: as Node
    // answered nobody, the university asked nothing.
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    for cookie in [Some(demo), Some(elsewhere), None] {
        let answer = |route: &str| {
            let path = format!("{route}?url={}", encoded(&catalogue));
            let response = block_on(gateway.answer(&asked(&GET, &path, &NO_HEADERS, &[]), || cookie.clone(), never)).unwrap();
            assert_eq!(response.headers()["x-tafac-session"], "expired", "{route}");
            response
        };
        let launched = answer(LAUNCH);
        assert_eq!((launched.status().as_u16(), &launched.headers()["location"]), (302, &catalogue.parse::<http::HeaderValue>().unwrap()));
        let previewed = answer(PREVIEW);
        assert_eq!((previewed.status().as_u16(), &body_of(&previewed)["reason"]), (200, &"missing-session".into()));
        let view = answer(VIEW);
        assert_eq!((view.status().as_u16(), body_of(&view)), (404, serde_json::json!({ "ok": false })));
    }
    // A session without its CAS ticket: nothing to sign in with, over.
    let without_ticket = campus.cookie(serde_json::json!({ "jar": [["JSESSIONID", "alive", "127.0.0.1", "/", 1, 1, null]] }), &[]);
    let path = format!("{LAUNCH}?url={}", encoded(&catalogue));
    let response = block_on(gateway.answer(&asked(&GET, &path, &NO_HEADERS, &[]), || Some(without_ticket.clone()), never)).unwrap();
    assert_eq!((response.status().as_u16(), &response.headers()["location"]), (302, &"/login?session=expired".parse::<http::HeaderValue>().unwrap()));
    assert!(campus.paths().is_empty());
}

#[test]
fn moodles_view_is_told_what_it_may_show() {
    // The campus's Moodle is asked over plain http: no view of it, ever.
    let campus = campus();
    let node = Node::default();
    let response = block_on(campus.gateway().answer(&asked(&GET, VIEW, &NO_HEADERS, &[]), || Some(campus.alive()), |request| node.ask(request))).unwrap();
    assert_eq!((response.status(), body_of(&response)), (http::StatusCode::NOT_FOUND, serde_json::json!({ "ok": false })));
    assert_eq!(response.headers()["cache-control"], "no-store");

    // Rennes' own settings, as tonAPI has them: nothing is asked of the
    // university for this route.
    let rennes = crate::universities::read(crate::universities::EMBEDDED.iter().find(|embedded| embedded.id == UNIVERSITY).unwrap()).unwrap();
    let gateway = Gateway::for_tests(vec![rennes], SECRET, COOKIE_NAME);
    let cookie = campus.cookie(serde_json::json!({ "jar": [["TGC", "the-ticket", "sso-cas.univ-rennes.fr", "/", 1, 1, null]] }), &[]);
    let response = block_on(gateway.answer(&asked(&GET, VIEW, &NO_HEADERS, &[]), || Some(cookie.clone()), |request| node.ask(request))).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!((&response.headers()["cache-control"], &response.headers()[ANSWERED_BY]), (&"no-store".parse().unwrap(), &"tonapi".parse().unwrap()));
    let policy = body_of(&response);
    assert_eq!(policy["home"], "https://foad.univ-rennes.fr/my/");
    assert_eq!(policy["signIn"], serde_json::json!(["ident-shib.univ-rennes1.fr", "sso-cas.univ-rennes.fr", "wayf.univ-rennes.fr"]));
    assert!(node.got().is_empty());
}
