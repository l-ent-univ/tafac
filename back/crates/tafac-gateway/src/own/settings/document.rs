// The remote settings' file (server/remoteSettings/document.ts): a serial
// number and a list of patches, each for one university, and how a patch is
// laid over that university's settings (src/remoteSettings.js, and
// applyPatch in server/remoteSettings/index.ts).
//
//   {
//     "serial": 3,
//     "patches": [{
//       "id": "rennes-cas-moved",        its name, for the log
//       "university": "univ-rennes",
//       "apps": ["ios"],                 optional: the apps it is for
//                                        (ios, desktop); all without it
//       "minVersion": "0.27.0",          optional: the app's versions it is
//       "maxVersion": "0.27.2",          for, both ends included
//       "features": { "mail": false },   switches, for the server and the page
//       "server": { … },                 over universities/<id>/server.js
//       "client": { … }                  over universities/<id>/client.js
//     }]
//   }
//
// Anything this doesn't read makes the whole file refused: a typo never
// half-applies. The words of a refusal are Node's. JSON is read by
// serde_json, which refuses a little more than JavaScript's JSON.parse: a
// number too large for a double (1e400, Infinity there), a lone surrogate
// (« \ud800 »), more than 128 levels of nesting. A file Node takes with
// those is refused here as « not JSON »; none Node refuses is taken.

use serde_json::{Map, Value};

use super::guard::{refusal, trusted_domains};
use crate::own::desktop_update::manifest::{compare_versions, is_version};

pub(super) struct SettingsDocument {
    pub(super) serial: i64,
    pub(super) patches: Vec<Patch>,
}

#[derive(Debug, PartialEq)]
pub(super) struct Patch {
    pub(super) id: String,
    pub(super) university: String,
    pub(super) apps: Option<Vec<String>>,
    pub(super) min_version: Option<String>,
    pub(super) max_version: Option<String>,
    pub(super) features: Option<Map<String, Value>>,
    pub(super) server: Option<Map<String, Value>>,
    pub(super) client: Option<Map<String, Value>>,
}

// Never taken as a key: in JavaScript they reach an object's own machinery.
const FORBIDDEN_KEYS: &[&str] = &["__proto__", "constructor", "prototype"];
const PATCH_KEYS: &[&str] = &["id", "university", "apps", "minVersion", "maxVersion", "features", "server", "client"];
const MAX_PATCHES: usize = 100;
// Number.MAX_SAFE_INTEGER
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

// /^[a-z0-9-]+$/
fn is_university(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub(super) fn has_forbidden_key(value: &Value) -> bool {
    match value {
        Value::Array(entries) => entries.iter().any(has_forbidden_key),
        Value::Object(object) => object.iter().any(|(key, child)| FORBIDDEN_KEYS.contains(&key.as_str()) || has_forbidden_key(child)),
        _ => false,
    }
}

// Number.isSafeInteger, for a JSON number: 2.0 and 1e2 are, 2.5 isn't.
fn safe_integer(value: &Value) -> Option<i64> {
    let number = value.as_f64()?;
    (number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER).then_some(number as i64)
}

fn strings_of(value: &Value) -> Option<Vec<String>> {
    value.as_array()?.iter().map(|entry| entry.as_str().filter(|name| !name.is_empty()).map(str::to_string)).collect()
}

fn patch_error(patch: &Value) -> Option<String> {
    let Some(object) = patch.as_object() else { return Some("a patch is not an object".to_string()) };
    if let Some(unknown) = object.keys().find(|key| !PATCH_KEYS.contains(&key.as_str())) {
        return Some(format!("unknown key \"{unknown}\""));
    }
    if !object.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty()) {
        return Some("no id".to_string());
    }
    if !object.get("university").and_then(Value::as_str).is_some_and(is_university) {
        return Some("no university".to_string());
    }
    if object.get("apps").is_some_and(|apps| strings_of(apps).is_none()) {
        return Some("\"apps\" is not a list of names".to_string());
    }
    for key in ["minVersion", "maxVersion"] {
        if object.get(key).is_some_and(|value| !value.as_str().is_some_and(is_version)) {
            return Some(format!("\"{key}\" is not a version"));
        }
    }
    if object.get("features").is_some_and(|features| !features.as_object().is_some_and(|switches| switches.values().all(Value::is_boolean))) {
        return Some("\"features\" is not a set of switches".to_string());
    }
    for key in ["server", "client"] {
        if object.get(key).is_some_and(|value| !value.is_object()) {
            return Some(format!("\"{key}\" is not an object"));
        }
    }
    if has_forbidden_key(patch) {
        return Some("a key that is never taken".to_string());
    }
    None
}

fn patch_of(object: &Map<String, Value>) -> Patch {
    let text = |key: &str| object.get(key).and_then(Value::as_str).map(str::to_string);
    let map = |key: &str| object.get(key).and_then(Value::as_object).cloned();
    Patch {
        id: text("id").unwrap_or_default(),
        university: text("university").unwrap_or_default(),
        apps: object.get("apps").and_then(strings_of),
        min_version: text("minVersion"),
        max_version: text("maxVersion"),
        features: map("features"),
        server: map("server"),
        client: map("client"),
    }
}

// The file, or why it isn't one.
pub(super) fn parse_settings(text: &str) -> Result<SettingsDocument, String> {
    let Ok(document) = serde_json::from_str::<Value>(text) else { return Err("not JSON".to_string()) };
    let Some(document) = document.as_object() else { return Err("not an object".to_string()) };
    let Some(serial) = document.get("serial").and_then(safe_integer).filter(|serial| *serial >= 1) else { return Err("no serial number".to_string()) };
    let Some(patches) = document.get("patches").and_then(Value::as_array).filter(|patches| patches.len() <= MAX_PATCHES) else { return Err("no list of patches".to_string()) };
    for patch in patches {
        if let Some(error) = patch_error(patch) {
            let named = patch.get("id").and_then(Value::as_str).map_or_else(|| "?".to_string(), |id| format!("\"{id}\""));
            return Err(format!("patch {named}: {error}"));
        }
    }
    Ok(SettingsDocument { serial, patches: patches.iter().filter_map(Value::as_object).map(patch_of).collect() })
}

// Whether a patch is for this app, at this version. An app that doesn't say
// what it is (a server, not an app) takes the patches for every app.
pub(super) fn is_for(patch: &Patch, app: &str, version: &str) -> bool {
    if patch.apps.as_ref().is_some_and(|apps| !apps.iter().any(|name| name == app)) {
        return false;
    }
    if !is_version(version) {
        return patch.min_version.is_none() && patch.max_version.is_none();
    }
    if patch.min_version.as_deref().is_some_and(|min| compare_versions(version, min) < 0) {
        return false;
    }
    !patch.max_version.as_deref().is_some_and(|max| compare_versions(version, max) > 0)
}

// `base` with `overriding` over it (src/remoteSettings.js, mergeSettings).
// Objects are merged key by key; anything else (a text, a number, a list,
// null) takes the place of what was there.
pub(super) fn merge_settings(base: &Value, overriding: &Value) -> Value {
    let Some(overriding) = overriding.as_object() else { return overriding.clone() };
    let mut merged = base.as_object().cloned().unwrap_or_default();
    for (key, value) in overriding {
        if FORBIDDEN_KEYS.contains(&key.as_str()) {
            continue;
        }
        let next = if value.is_object() { merge_settings(merged.get(key).unwrap_or(&Value::Null), value) } else { value.clone() };
        merged.insert(key.clone(), next);
    }
    Value::Object(merged)
}

#[derive(Debug, PartialEq)]
pub(super) struct ResolvedSettings {
    // The university's server settings, patched.
    pub(super) server: Value,
    // What the page lays over its own settings, or None.
    pub(super) client: Option<Value>,
    // The patches taken, by id.
    pub(super) applied: Vec<String>,
}

// One patch over a university's settings. Refused whole when either side
// names something a patch may not (guard.rs).
fn apply_patch(settings: ResolvedSettings, patch: &Patch, trusted: &[String], report: &dyn Fn(&str)) -> ResolvedSettings {
    let features = patch.features.as_ref().map_or_else(|| Value::Object(Map::new()), |features| serde_json::json!({ "features": features }));
    let of = |side: &Option<Map<String, Value>>| merge_settings(&Value::Object(side.clone().unwrap_or_default()), &features);
    let (server, client) = (of(&patch.server), of(&patch.client));
    let reason = server.as_object().and_then(|server| refusal(server, trusted)).or_else(|| client.as_object().and_then(|client| refusal(client, trusted)));
    if let Some(reason) = reason {
        report(&format!("Remote settings: patch \"{}\" refused: {reason}", patch.id));
        return settings;
    }
    let has_client = client.as_object().is_some_and(|client| !client.is_empty());
    let mut applied = settings.applied;
    applied.push(patch.id.clone());
    ResolvedSettings {
        server: merge_settings(&settings.server, &server),
        client: if has_client { Some(merge_settings(settings.client.as_ref().unwrap_or(&Value::Object(Map::new())), &client)) } else { settings.client },
        applied,
    }
}

// A university's settings with the file's patches for it, this app and this
// version laid over (RemoteSettings.resolve). Its own domains are read from
// its settings as shipped: a patch can't widen what the next is checked
// against.
pub(super) fn resolve(document: Option<&SettingsDocument>, id: &str, server_config: &Value, app: &str, version: &str, report: &dyn Fn(&str)) -> ResolvedSettings {
    let settings = ResolvedSettings { server: server_config.clone(), client: None, applied: Vec::new() };
    let Some(document) = document else { return settings };
    let trusted = trusted_domains(server_config);
    let resolved = document.patches.iter().filter(|patch| patch.university == id && is_for(patch, app, version)).fold(settings, |current, patch| apply_patch(current, patch, &trusted, report));
    if !resolved.applied.is_empty() {
        report(&format!("Remote settings: {id}: {} (serial {})", resolved.applied.join(", "), document.serial));
    }
    resolved
}

#[cfg(test)]
pub(super) mod tests {
    use std::cell::RefCell;

    use serde_json::json;

    use super::super::minisign::verify_signature;
    use super::super::tests::{fixture, public_key};
    use super::*;

    // A university's server settings, as an app ships them (Node's tests' own).
    pub(in super::super) fn shipped() -> Value {
        json!({
            "id": "univ-rennes",
            "features": { "planning": true, "mail": true },
            "origins": { "cas": "https://sso-cas.univ-rennes.fr", "ent": "https://ent.univ-rennes.fr" },
            "mail": { "origin": "https://partage.univ-rennes.fr", "signInDomains": ["partage.renater.fr"], "signature": { "logo": { "file": "/app/logo.png" } } },
            "launch": { "allowedDomains": ["univ-rennes.fr"] },
        })
    }

    fn error_of(text: &str) -> String {
        parse_settings(text).err().unwrap_or_else(|| panic!("{text} was taken"))
    }

    fn one(patch: Value) -> Result<SettingsDocument, String> {
        parse_settings(&json!({ "serial": 1, "patches": [patch] }).to_string())
    }

    #[test]
    fn a_file_that_doesnt_read_is_refused_whole() {
        assert_eq!(error_of("{"), "not JSON");
        assert_eq!(error_of("[]"), "not an object");
        assert_eq!(error_of(r#"{"patches":[]}"#), "no serial number");
        assert_eq!(error_of(r#"{"serial":1}"#), "no list of patches");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "feature": { "mail": false } })).err().unwrap(), "patch \"a\": unknown key \"feature\"");
        assert_eq!(one(json!({ "id": "a", "university": "Univ Rennes" })).err().unwrap(), "patch \"a\": no university");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "features": { "mail": "off" } })).err().unwrap(), "patch \"a\": \"features\" is not a set of switches");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "maxVersion": "1.2" })).err().unwrap(), "patch \"a\": \"maxVersion\" is not a version");
        assert_eq!(error_of(r#"{"serial":1,"patches":[{"id":"a","university":"univ-rennes","server":{"__proto__":{"x":1}}}]}"#), "patch \"a\": a key that is never taken");
        let taken = one(json!({ "id": "a", "university": "univ-rennes", "features": { "mail": false } })).unwrap();
        assert_eq!(taken.serial, 1);
        assert_eq!(taken.patches, [Patch { id: "a".into(), university: "univ-rennes".into(), apps: None, min_version: None, max_version: None, features: json!({ "mail": false }).as_object().cloned(), server: None, client: None }]);
    }

    #[test]
    fn a_serial_number_and_a_patch_are_read_as_javascript_reads_them() {
        // Number.isSafeInteger: 2.0 and 1e2 are integers, 2.5 and 2^53 aren't.
        assert_eq!(parse_settings(r#"{"serial":2.0,"patches":[]}"#).unwrap().serial, 2);
        assert_eq!(parse_settings(r#"{"serial":1e2,"patches":[]}"#).unwrap().serial, 100);
        for serial in ["2.5", "0", "-1", "9007199254740992", "\"3\"", "null", "true"] {
            assert_eq!(error_of(&format!(r#"{{"serial":{serial},"patches":[]}}"#)), "no serial number", "{serial}");
        }
        assert_eq!(parse_settings(r#"{"serial":9007199254740991,"patches":[]}"#).unwrap().serial, 9_007_199_254_740_991);
        let hundred: Vec<Value> = (0..100).map(|index| json!({ "id": format!("p{index}"), "university": "univ-rennes" })).collect();
        assert_eq!(parse_settings(&json!({ "serial": 1, "patches": hundred }).to_string()).unwrap().patches.len(), 100);
        let more: Vec<Value> = (0..101).map(|index| json!({ "id": format!("p{index}"), "university": "univ-rennes" })).collect();
        assert_eq!(error_of(&json!({ "serial": 1, "patches": more }).to_string()), "no list of patches");
        // A key present is read, even null; a patch without a name is « ? ».
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "apps": null })).err().unwrap(), "patch \"a\": \"apps\" is not a list of names");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "apps": ["ios", ""] })).err().unwrap(), "patch \"a\": \"apps\" is not a list of names");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "minVersion": null })).err().unwrap(), "patch \"a\": \"minVersion\" is not a version");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "client": [] })).err().unwrap(), "patch \"a\": \"client\" is not an object");
        assert_eq!(one(json!({ "id": "", "university": "univ-rennes" })).err().unwrap(), "patch \"\": no id");
        assert_eq!(one(json!({ "id": 7, "university": "univ-rennes" })).err().unwrap(), "patch ?: no id");
        assert_eq!(one(json!("a")).err().unwrap(), "patch ?: a patch is not an object");
        assert_eq!(one(json!({ "id": "a", "university": "univ-rennes", "server": { "x": [{ "constructor": 1 }] } })).err().unwrap(), "patch \"a\": a key that is never taken");
        // What serde_json doesn't read, JSON.parse would: refused all the same.
        assert_eq!(error_of(r#"{"serial":1,"patches":[{"id":"a","university":"univ-rennes","server":{"x":1e400}}]}"#), "not JSON");
        assert_eq!(error_of("\u{feff}{\"serial\":1,\"patches\":[]}"), "not JSON");
    }

    #[test]
    fn a_patch_is_for_the_apps_and_the_versions_it_names() {
        let patch = || Patch { id: "a".into(), university: "univ-rennes".into(), apps: None, min_version: None, max_version: None, features: None, server: None, client: None };
        let apps = |names: &[&str]| Patch { apps: Some(names.iter().map(|name| name.to_string()).collect()), ..patch() };
        let versions = |min: Option<&str>, max: Option<&str>| Patch { min_version: min.map(str::to_string), max_version: max.map(str::to_string), ..patch() };
        assert!(is_for(&patch(), "ios", "0.27.0"));
        assert!(!is_for(&apps(&["desktop"]), "ios", "0.27.0"));
        assert!(is_for(&apps(&["ios", "desktop"]), "ios", "0.27.0"));
        assert!(!is_for(&apps(&[]), "ios", "0.27.0"));
        assert!(is_for(&versions(Some("0.27.0"), Some("0.27.2")), "ios", "0.27.0"));
        assert!(is_for(&versions(Some("0.27.0"), Some("0.27.2")), "ios", "0.27.2"));
        assert!(!is_for(&versions(None, Some("0.27.2")), "ios", "0.28.0"));
        assert!(!is_for(&versions(Some("0.27.0"), None), "ios", "0.26.9"));
        // An app that doesn't say its version takes no patch made for some.
        assert!(!is_for(&versions(None, Some("0.27.2")), "ios", ""));
        assert!(is_for(&patch(), "", ""));
        // By their numbers, not their letters.
        assert_eq!(compare_versions("0.9.0", "0.10.0"), -1);
        assert_eq!(compare_versions("1.0.0", "0.99.99"), 1);
        assert_eq!(compare_versions("0.026.0", "0.26.0"), 0);
    }

    #[test]
    fn settings_are_merged_key_by_key_lists_and_values_replaced() {
        let merged = merge_settings(&shipped(), &json!({ "features": { "mail": false }, "mail": { "signInDomains": ["univ-rennes.fr"] }, "origins": { "cas": null }, "__proto__": { "x": 1 } }));
        assert_eq!(merged["features"], json!({ "planning": true, "mail": false }));
        assert_eq!(merged["mail"]["signInDomains"], json!(["univ-rennes.fr"]));
        assert_eq!(merged["mail"]["origin"], "https://partage.univ-rennes.fr");
        assert_eq!(merged["origins"]["cas"], Value::Null);
        assert!(merged.get("__proto__").is_none());
        // A value over an object, an object over a value.
        assert_eq!(merge_settings(&json!({ "a": { "b": 1 } }), &json!({ "a": 2 })), json!({ "a": 2 }));
        assert_eq!(merge_settings(&json!({ "a": 2 }), &json!({ "a": { "b": 1 } })), json!({ "a": { "b": 1 } }));
        assert_eq!(merge_settings(&json!({ "a": 1 }), &json!([1])), json!([1]));
    }

    fn resolved(document: &SettingsDocument, id: &str, app: &str, version: &str) -> (ResolvedSettings, Vec<String>) {
        let reports = RefCell::new(Vec::new());
        let resolved = resolve(Some(document), id, &shipped(), app, version, &|message: &str| reports.borrow_mut().push(message.to_string()));
        (resolved, reports.into_inner())
    }

    #[test]
    fn the_signed_file_patches_the_universitys_settings() {
        let (text, signature) = fixture("TAKEN");
        assert!(verify_signature(text.as_bytes(), &signature, &public_key()));
        let document = parse_settings(&text).unwrap();
        assert_eq!(document.serial, 2);
        let (settings, reports) = resolved(&document, "univ-rennes", "ios", "0.27.0");
        // The switch reaches the server and the page; the address moved
        // within the university's domains; the one to another domain is
        // refused.
        assert_eq!(settings.applied, ["planning-off", "cas-moved"]);
        assert_eq!(settings.server["features"], json!({ "planning": false, "mail": true }));
        assert_eq!(settings.server["origins"], json!({ "cas": "https://sso2.univ-rennes.fr", "ent": "https://ent.univ-rennes.fr" }));
        assert_eq!(settings.client, Some(json!({ "features": { "planning": false }, "note": "moved" })));
        assert!(reports.iter().any(|message| message.contains("patch \"cas-stolen\" refused")), "{reports:?}");
        assert_eq!(reports.last().unwrap(), "Remote settings: univ-rennes: planning-off, cas-moved (serial 2)");
        // Another university's patch is not this one's.
        assert!(resolved(&document, "univ-exemple", "ios", "0.27.0").0.applied.is_empty());
        // Nothing taken: the settings as shipped.
        assert_eq!(resolve(None, "univ-rennes", &shipped(), "ios", "0.27.0", &|_: &str| {}), ResolvedSettings { server: shipped(), client: None, applied: Vec::new() });
    }

    #[test]
    fn a_patch_for_other_versions_of_the_app_is_left_out() {
        let document = parse_settings(&fixture("TAKEN").0).unwrap();
        assert_eq!(resolved(&document, "univ-rennes", "ios", "0.28.0").0.applied, ["planning-off"]);
        assert_eq!(resolved(&document, "univ-rennes", "desktop", "0.27.0").0.applied, ["planning-off"]);
        // An empty newer file takes every patch away.
        let newer = parse_settings(&fixture("NEWER").0).unwrap();
        assert_eq!((newer.serial, resolved(&newer, "univ-rennes", "ios", "0.27.0").0.applied.len()), (3, 0));
    }

    #[test]
    fn what_is_read_is_what_nodes_document_reads() {
        let document = include_str!("../../../../../../server/remoteSettings/document.ts");
        let keys = PATCH_KEYS.iter().map(|key| format!("'{key}'")).collect::<Vec<_>>().join(", ");
        assert!(document.contains(&format!("const PATCH_KEYS = new Set([{keys}])")), "PATCH_KEYS");
        assert!(document.contains(&format!("const MAX_PATCHES = {MAX_PATCHES}\n")));
        assert!(document.contains("const VERSION = /^\\d+\\.\\d+\\.\\d+$/"));
        assert!(document.contains("const UNIVERSITY = /^[a-z0-9-]+$/"));
        let shared = include_str!("../../../../../../src/remoteSettings.js");
        let forbidden = FORBIDDEN_KEYS.iter().map(|key| format!("'{key}'")).collect::<Vec<_>>().join(", ");
        assert!(shared.contains(&format!("const FORBIDDEN_KEYS = new Set([{forbidden}])")), "FORBIDDEN_KEYS");
        let guard = include_str!("../../../../../../server/remoteSettings/guard.ts");
        assert!(guard.contains("const ADDRESS = /https?:\\/\\/[^\\s\"'<>\\\\]+/gi"));
        assert!(guard.contains("const BARE_HOST = /^(?:[a-z0-9-]+\\.)+[a-z]{2,}$/i"));
        assert!(guard.contains("const DOMAIN_LIST = /domains$/i"));
    }
}
