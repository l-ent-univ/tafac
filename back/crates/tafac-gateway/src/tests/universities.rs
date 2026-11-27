// Tafac's own routes about the universities (own/universities.rs), through
// the gateway: on tafac.fr, what the server says it serves; in the apps,
// every university, with what their remote settings lay over the page's
// settings; and the routes nobody is signed in for, at the university the
// request is for.

use http::HeaderMap;

use super::{asked, body_of, cookie_set, never, GET, NO_HEADERS, SESSION};
use crate::own::universities::Served;
use crate::testing::*;
use crate::{Gateway, ANSWERED_BY};

const UNIVERSITIES: &str = "/__ent_auth/universities";
const LOGO: &str = "/__ent_auth/universities/univ-rennes/logo";

// Every university, as tafac.fr: nothing set in the environment.
fn serving(gateway: Gateway) -> Gateway {
    gateway.serving(Served::from_environment(|_| None, false).unwrap())
}

fn get(gateway: &Gateway, target: &str, headers: &HeaderMap, cookie: Option<&str>) -> Option<http::Response<Vec<u8>>> {
    block_on(gateway.answer(&asked(&GET, target, headers, &[]), || cookie.map(str::to_string), never))
}

#[test]
fn the_list_and_the_logos_are_answered_where_the_server_says_what_it_serves() {
    let campus = campus();
    let gateway = serving(campus.gateway());
    // Nobody signed in: answered all the same, and nothing is asked of the
    // university or of Node.
    let list = get(&gateway, UNIVERSITIES, &NO_HEADERS, None).unwrap();
    assert_eq!((list.status(), &list.headers()[ANSWERED_BY], &list.headers()["cache-control"]), (http::StatusCode::OK, &"tonapi".parse().unwrap(), &"no-store".parse().unwrap()));
    let said = body_of(&list);
    assert_eq!((&said["mode"], &said["defaultUniversity"], &said["session"], &said["host"]), (&"multi".into(), &UNIVERSITY.into(), &serde_json::Value::Null, &serde_json::Value::Null));
    assert_eq!(said["universities"].as_array().unwrap().len(), 3);
    assert!(said.get("settings").is_none());

    // Signed in: the session's university, read from its cookie alone.
    let signed_in = body_of(&get(&gateway, UNIVERSITIES, &NO_HEADERS, Some(&campus.alive())).unwrap());
    assert_eq!(signed_in["session"], UNIVERSITY);
    // At a university served that the gateway holds no session for: Node
    // names it too.
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-rennes-2" }), &[]);
    assert_eq!(body_of(&get(&gateway, UNIVERSITIES, &NO_HEADERS, Some(&elsewhere)).unwrap())["session"], "univ-rennes-2");

    let logo = get(&gateway, LOGO, &NO_HEADERS, None).unwrap();
    assert_eq!((logo.status(), &logo.headers()["content-type"]), (http::StatusCode::OK, &"image/svg+xml".parse().unwrap()));
    assert_eq!(get(&gateway, "/__ent_auth/universities/univ-nowhere/logo", &NO_HEADERS, None).unwrap().status(), 404);
    assert!(campus.paths().is_empty());
}

#[test]
fn a_cookie_not_read_here_is_no_session_and_the_apps_have_every_university() {
    let campus = campus();
    // A cookie that isn't read here (another secret, or from before
    // sessions named their university): no session.
    let gateway = serving(campus.gateway());
    for cookie in ["v1.made.by.another.secret".to_string(), campus.cookie(serde_json::json!({ "uni": null }), &[])] {
        assert_eq!(body_of(&get(&gateway, UNIVERSITIES, &NO_HEADERS, Some(&cookie)).unwrap())["session"], serde_json::Value::Null);
    }
    // A path under the folder that is no logo's: no route.
    let other = get(&gateway, "/__ent_auth/universities/univ-rennes/settings", &NO_HEADERS, None).unwrap();
    assert_eq!((other.status().as_u16(), body_of(&other)), (404, serde_json::json!({ "error": "Not found." })));
    // Where the gateway isn't told what is served (the apps): every
    // university, as their Node served them, without remote settings here.
    let apps = campus.gateway();
    let list = body_of(&get(&apps, UNIVERSITIES, &NO_HEADERS, None).unwrap());
    assert_eq!((&list["mode"], list["universities"].as_array().unwrap().len()), (&"multi".into(), 3));
    assert!(list.get("settings").is_none());
    assert_eq!(get(&apps, LOGO, &NO_HEADERS, None).unwrap().status(), 200);
    // The session check of nobody, at the university the page chose.
    let mut chosen = HeaderMap::new();
    chosen.insert("x-tafac-university", "univ-rennes-2".parse().unwrap());
    assert_eq!(body_of(&get(&apps, SESSION, &chosen, None).unwrap())["university"], "univ-rennes-2");
}

#[test]
fn a_session_check_without_a_cookie_is_nobody_at_the_university_asked_for() {
    let campus = campus();
    let gateway = serving(campus.gateway());
    let check = get(&gateway, SESSION, &NO_HEADERS, None).unwrap();
    assert_eq!((check.status(), &check.headers()["cache-control"]), (http::StatusCode::OK, &"no-store".parse().unwrap()));
    assert!(cookie_set(&check).is_none() && check.headers().get("x-tafac-session").is_none());
    // Every field of Node's answer (server/entAuthApp.js), and no other.
    assert_eq!(
        body_of(&check),
        serde_json::json!({
            "authenticated": false,
            "user": null,
            "sessionMode": null,
            "sessionSource": null,
            "degraded": false,
            "degradedReason": null,
            "canUseServerLaunch": false,
            "analyticsEnabled": false,
            "university": UNIVERSITY,
        })
    );

    // The login page's choice, then the address.
    let mut chosen = HeaderMap::new();
    chosen.insert("x-tafac-university", "rennes2".parse().unwrap());
    chosen.insert("host", "univsorbonnenouvelle.tafac.fr".parse().unwrap());
    assert_eq!(body_of(&get(&gateway, SESSION, &chosen, None).unwrap())["university"], "univ-rennes-2");
    chosen.remove("x-tafac-university");
    assert_eq!(body_of(&get(&gateway, SESSION, &chosen, None).unwrap())["university"], "univ-sorbonne-nouvelle");
    // Whether the statistics are on is the gateway's own setting.
    let counted = serving(campus.gateway()).with_statistics(Some("phc_key"));
    assert_eq!(body_of(&get(&counted, SESSION, &NO_HEADERS, None).unwrap())["analyticsEnabled"], true);

    // A cookie that is nobody's session (signed out, unread): the same.
    assert_eq!(body_of(&get(&gateway, SESSION, &NO_HEADERS, Some("v1.made.by.another.secret")).unwrap())["authenticated"], false);
    // The other routes have each their own answer for nobody, Node's, and
    // say there is no session.
    for (target, field) in [("/__ent_auth/apps", "apps"), ("/__ent_auth/grades", "grades"), ("/__ent_auth/moodle/deadlines", "deadlines")] {
        let response = get(&gateway, target, &NO_HEADERS, None).unwrap();
        assert_eq!(response.headers()["x-tafac-session"], "expired", "{target}");
        assert_eq!(body_of(&response), serde_json::json!({ "authenticated": false, field: null }), "{target}");
    }
    assert!(campus.paths().is_empty());
}

// Node's feature gate, before a route's own answer for nobody: a university
// without the service (Node's settings) says it is disabled.
#[test]
fn a_service_the_university_hasnt_is_disabled_for_nobody() {
    let campus = campus();
    let gateway = serving(campus.gateway());
    let mut rennes_2 = HeaderMap::new();
    rennes_2.insert("x-tafac-university", "univ-rennes-2".parse().unwrap());
    for (target, feature) in [("/__ent_auth/grades", "grades"), ("/__ent_auth/grades/report.pdf", "grades")] {
        let response = get(&gateway, target, &rennes_2, None).unwrap();
        assert_eq!((response.status().as_u16(), body_of(&response)), (404, serde_json::json!({ "ok": false, "disabled": true, "feature": feature })), "{target}");
        assert_eq!(response.headers()["x-tafac-session"], "expired");
    }
    // Moodle's deadlines are Rennes 2's: its own answer for nobody.
    assert_eq!(body_of(&get(&gateway, "/__ent_auth/moodle/deadlines", &rennes_2, None).unwrap())["deadlines"], serde_json::Value::Null);
    // At Rennes, the grades' own.
    assert_eq!(get(&gateway, "/__ent_auth/grades", &NO_HEADERS, None).unwrap().status(), 200);
}
