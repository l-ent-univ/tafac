// The gateway with no Node at all: every route of the page's API answered
// here, whoever asks, and Node never asked or told anything (`never`
// panics). And /__ent_proxy/*, what is left of Node's portal proxy.

use http::header::LOCATION;
use http::{HeaderMap, Method};

use super::{asked, body_of, cookie_set, never, GET, LOGOUT, NO_HEADERS, POST};
use crate::routes::{Backend, ROUTES};
use crate::testing::*;
use crate::Gateway;

// A path of each line of the table, as the page asks it.
fn each_route() -> Vec<(Method, String)> {
    let mut asked = Vec::new();
    for route in ROUTES {
        let Backend::TonApi(_) = route.backend else { continue };
        let path = match route.path.strip_suffix("/*") {
            Some(folder) if folder.ends_with("/universities") => format!("{folder}/univ-rennes/logo"),
            Some(folder) if folder.ends_with("/semester") => format!("{folder}/1234"),
            Some(folder) => format!("{folder}/recent"),
            None => route.path.to_string(),
        };
        let method = if route.method == "POST" { Method::POST } else { Method::GET };
        asked.push((method, path));
    }
    asked.push((Method::GET, "/__ent_auth/ade/tree".to_string()));
    asked.push((Method::POST, "/__ent_auth/something-new".to_string()));
    asked
}

#[test]
fn every_route_is_answered_for_nobody_and_node_is_never_asked() {
    let campus = campus();
    let gateway = campus.gateway().without_node();
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[("JSESSIONID", "alive")]);
    let mut json = HeaderMap::new();
    json.insert("content-type", "application/json".parse().unwrap());
    for cookie in [None, Some(demo), Some(elsewhere), Some("v1.not.one".to_string())] {
        for (method, path) in each_route() {
            let response = block_on(gateway.answer(&asked(&method, &path, &json, b"{}"), || cookie.clone(), never));
            // Only the list of universities and the statistics wait for a
            // server to say what is served and where they go (the apps'
            // Node keeps those).
            if path.starts_with("/__ent_auth/universities") || path == "/__ent_auth/analytics" {
                assert!(response.is_none(), "{method} {path}");
                continue;
            }
            let response = response.unwrap_or_else(|| panic!("{method} {path} left unanswered"));
            assert_eq!(response.headers()[crate::ANSWERED_BY], "tonapi", "{method} {path}");
        }
    }
    assert!(campus.paths().is_empty());
}

#[test]
fn a_session_ends_without_node_being_told() {
    let campus = campus();
    let gateway = campus.gateway().without_node();
    // Signed out: the CAS is told, Node isn't (`never`).
    let cookie = campus.alive();
    let response = block_on(gateway.answer(&asked(&POST, LOGOUT, &NO_HEADERS, &[]), || Some(cookie.clone()), never)).unwrap();
    assert_eq!(cookie_set(&response).as_deref(), Some("cleared"));
    assert!(!campus.cas_knows_the_ticket());
    // Found expired: the page is told, Node isn't.
    let campus = crate::testing::campus();
    let gateway = campus.gateway().without_node();
    let cookie = campus.alive();
    campus.cas_forgets();
    let response = block_on(gateway.answer(&asked(&GET, "/__ent_auth/grades", &NO_HEADERS, &[]), || Some(cookie.clone()), never)).unwrap();
    assert_eq!((response.status().as_u16(), &response.headers()["x-tafac-session"]), (401, &"expired".parse::<http::HeaderValue>().unwrap()));
}

fn proxied(gateway: &Gateway, method: &Method, target: &str, headers: &[(&'static str, &'static str)], cookie: Option<String>) -> http::Response<Vec<u8>> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        map.insert(*name, value.parse().unwrap());
    }
    let response = block_on(gateway.answer(&asked(method, target, &map, &[]), || cookie.clone(), never)).unwrap();
    // Node's hardening, on every answer.
    assert_eq!(response.headers()["content-security-policy"], "default-src 'none'; sandbox");
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
    assert_eq!(response.headers()["cross-origin-resource-policy"], "same-origin");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers().get_all("content-security-policy").iter().count(), 1);
    response
}

#[test]
fn an_old_link_to_a_portals_page_goes_to_the_launch_relay() {
    let campus = campus();
    let gateway = campus.gateway().without_node();
    let page = [("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "document")];
    for cookie in [None, Some(campus.alive())] {
        let response = proxied(&gateway, &GET, "/__ent_proxy/f/welcome?tab=2", &page, cookie);
        assert_eq!(response.status(), 302);
        let relay = format!("/__ent_auth/launch?url=http%3A%2F%2F127.0.0.1%3A{}%2Ff%2Fwelcome%3Ftab%3D2", campus.port());
        assert_eq!(response.headers()[LOCATION], relay.as_str());
    }
    // A browser without Fetch Metadata, asking for a page.
    let old = proxied(&gateway, &GET, "/__ent_proxy/", &[("accept", "text/html,application/xhtml+xml")], None);
    assert_eq!(old.headers()[LOCATION], format!("/__ent_auth/launch?url=http%3A%2F%2F127.0.0.1%3A{}%2F", campus.port()).as_str());
    assert!(campus.paths().is_empty());
}

#[test]
fn anything_else_of_the_portal_proxy_is_refused_in_nodes_words() {
    let campus = campus();
    let gateway = campus.gateway().without_node();
    let refused = |method: &Method, target: &str, headers: &[(&'static str, &'static str)], cookie: Option<String>| {
        let response = proxied(&gateway, method, target, headers, cookie);
        (response.status().as_u16(), body_of(&response)["error"].as_str().unwrap_or_default().to_string())
    };
    let said = |status: u16, words: &str| (status, words.to_string());
    assert_eq!(refused(&GET, "/__ent_proxy//elsewhere.test/x", &[], None), said(400, "Invalid portal path."));
    assert_eq!(refused(&GET, "/__ent_proxy/a/../b", &[], None), said(400, "Invalid portal path."));
    assert_eq!(refused(&GET, "/__ent_proxy/f/welcome", &[("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "iframe")], None), said(403, "Portal pages are not served here."));
    assert_eq!(refused(&POST, "/__ent_proxy/f/welcome", &[("sec-fetch-mode", "navigate")], None), said(403, "Portal pages are not served here."));
    assert_eq!(refused(&GET, "/__ent_proxy/api/layoutDoc", &[("sec-fetch-site", "cross-site")], None), said(403, "Cross-site request."));
    // The page's own calls and its photo: Node's relay is gone. Nobody:
    // as Node said it, and that there is no session.
    let photo = proxied(&gateway, &GET, "/__ent_proxy/images/me.jpg", &[("sec-fetch-dest", "image")], None);
    assert_eq!((photo.status().as_u16(), &photo.headers()["x-tafac-session"]), (401, &"expired".parse::<http::HeaderValue>().unwrap()));
    for (method, target) in [(&GET, "/__ent_proxy/api/v4-3/dlm/layout.json"), (&POST, "/__ent_proxy/api/layout?action=moveElement"), (&GET, "/__ent_proxy/images/me.jpg")] {
        assert_eq!(refused(method, target, &[], Some(campus.alive())), said(403, "Not a portal request of this app."), "{method} {target}");
    }
    assert!(campus.paths().is_empty());
}
