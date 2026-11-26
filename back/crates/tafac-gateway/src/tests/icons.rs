// The applications' icons, answered here: for a session the gateway holds,
// from Node's own file, when the gateway has the data directory; Node's
// otherwise. What the icons are is own/icons.rs's, held there to the JS.

use super::*;

const ICONS: &str = "/__ent_auth/app-icons";
const BODY: &[u8] = br#"{"services":[{"id":"webapp-mail","title":"Messagerie"},{"id":"moodle","title":"Moodle"}]}"#;

// A data directory of the test's own, gone after it.
struct DataDir(std::path::PathBuf);

impl DataDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("tafac-gateway-data-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        Self(path)
    }
}

impl Drop for DataDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    headers
}

#[test]
fn the_icons_of_a_session_held_here_are_answered_from_nodes_file() {
    let (campus, data) = (campus(), DataDir::new("held"));
    let gateway = campus.gateway().with_icons_in(&data.0);
    let headers = json_headers();
    let response = block_on(gateway.answer(&asked(&POST, ICONS, &headers, BODY), || Some(campus.alive()), never)).expect("answered here");
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(response.headers().get(SET_COOKIE).is_none());
    let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(answer["ok"], true);
    // Rennes draws Phosphor's duotone icons on soft tiles.
    assert_eq!(answer["icons"]["webapp-mail"]["icon"], "ph:envelope-simple-duotone");
    assert_eq!(answer["icons"]["moodle"]["icon"], "devicon-plain:moodle");
    assert_eq!(answer["palette"]["blue"]["light"]["bg"], "#dbeafe");

    // Written down for the whole university, in Node's place and format.
    let file: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(data.0.join("app-icons/univ-rennes.json")).unwrap()).unwrap();
    assert_eq!((&file["version"], &file["university"]), (&1.into(), &UNIVERSITY.into()));
    assert_eq!(file["services"]["webapp-mail"]["icon"], "mail");
    assert_eq!(file["services"]["webapp-mail"]["color"], answer["icons"]["webapp-mail"]["color"]);
    // The university was asked nothing.
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn the_icons_are_nodes_for_the_sessions_the_gateway_doesnt_hold_and_without_the_data_directory() {
    let (campus, data) = (campus(), DataDir::new("node"));
    let headers = json_headers();
    let gateway = campus.gateway().with_icons_in(&data.0);
    let without_ticket = campus.cookie(serde_json::json!({ "jar": [] }), &[]);
    let elsewhere = campus.cookie(serde_json::json!({ "uni": "univ-exemple" }), &[]);
    let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
    for cookie in [None, Some(without_ticket), Some(elsewhere), Some(demo), Some("not-a-cookie".to_string())] {
        assert!(block_on(gateway.answer(&asked(&POST, ICONS, &headers, BODY), || cookie.clone(), never)).is_none(), "{cookie:?}");
    }
    // Not JSON: Node reads it its own way.
    assert!(block_on(gateway.answer(&asked(&POST, ICONS, &NO_HEADERS, BODY), || Some(campus.alive()), never)).is_none());
    // A gateway without Node's data directory (the apps): Node's.
    assert!(block_on(campus.gateway().answer(&asked(&POST, ICONS, &headers, BODY), || Some(campus.alive()), never)).is_none());
    assert!(!data.0.exists());
}

#[test]
fn the_icons_body_is_read_here_and_only_a_posts() {
    assert!(Gateway::reads_body(&POST, ICONS));
    assert!(!Gateway::reads_body(&GET, ICONS));
    assert!(!Gateway::reads_body(&POST, "/__ent_auth/apps"));
    assert_eq!(crate::routes::moved_route(&POST, ICONS), Some(crate::routes::Moved::AppIcons));
}
