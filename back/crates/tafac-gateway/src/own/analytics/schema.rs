// What the statistics may say: the events the page may post, and for each
// the properties kept, as Node's allowlist has them
// (server/analyticsSchema.js). This is the privacy boundary of the
// statistics: nothing reaches PostHog that isn't named here, and every value
// kept is one of a list, a short slug, a version, a language or a boolean.
// There is no free text, on purpose: no title, name, subject, address,
// grade or search typed can get through.
//
// It is Node's, rule for rule, and no more permissive: an event or a
// property added there is added here too, the same day. The tests below
// hold the two together (every word of Node's file is one of these, and
// the other way round) and repeat Node's own cases (tests/analytics.test.js,
// tests/planningAnalytics.test.js, tests/mailAnalytics.test.js).
//
// A batch is read as Node reads it: its first 20 events, each kept or
// dropped on its own. `university` and `demo` are never taken from the
// page: the gateway sets them (analytics.rs).

use serde_json::{Map, Value};

// The most events of one batch looked at; the rest are dropped.
pub(crate) const MAX_EVENTS_PER_BATCH: usize = 20;

const WIDGET_IDS: &[&str] = &["greeting", "nextClass", "latestGrade", "mail", "deadlines", "assiduity"];
const DURATION_BUCKETS: &[&str] = &["<500ms", "<1s", "<3s", "<10s", "10s+"];
const ERROR_KINDS: &[&str] = &["http_4xx", "http_5xx", "network", "timeout", "other"];
// How the student arrived on « Mes notes », the Planning, the Messagerie,
// « Assiduité »: each page has its own.
const GRADES_PAGE_SOURCES: &[&str] = &["nav", "tabbar", "tile", "dashboard_card", "sidebar_card", "launch_card", "home_icon", "history", "other"];
const PLANNING_PAGE_SOURCES: &[&str] = &["nav", "tabbar", "tile", "dashboard_card", "launch_card", "home_icon", "history", "other"];
const MAIL_PAGE_SOURCES: &[&str] = &["nav", "tabbar", "tile", "dashboard_card", "launch_card", "home_icon", "grades", "planning", "assiduity", "history", "other"];
const ASSIDUITY_PAGE_SOURCES: &[&str] = &["nav", "tabbar", "dashboard_card", "history", "other"];
const PAGE_SOURCES: &[(&str, &[&str])] =
    &[("grades", GRADES_PAGE_SOURCES), ("planning", PLANNING_PAGE_SOURCES), ("mail", MAIL_PAGE_SOURCES), ("assiduity", ASSIDUITY_PAGE_SOURCES)];
const GRADES_ACTIONS: &[&str] = &["semester_changed", "ue_view_opened", "grade_detail_opened", "pdf_downloaded", "explainer_opened", "department_message_expanded"];
const ASSIDUITY_ACTIONS: &[&str] = &["semester_changed", "mark_picked", "subject_filtered", "status_filtered", "justify_opened"];
// « Justifier »'s steps: never the reason given.
const JUSTIFY_STEPS: &[&str] = &["opened", "reason_picked", "proof_chosen", "review_shown", "composed", "closed"];
const JUSTIFY_REACHED: &[&str] = &["reason", "proof", "review", "composed"];
const PLANNING_VIEWS: &[&str] = &["day", "two_days", "week", "list"];
const PLANNING_ACTIONS: &[&str] = &[
    "view_changed", "day_changed", "week_changed", "today", "calendar_picked", "day_opened", "course_opened", "occurrence_opened", "retry", "open_account", "ics_exported",
    "share_opened", "directory_opened", "directory_picked",
];
// planning_action's own properties, by action (any other is dropped), and
// those an action can't go without.
const PLANNING_ACTION_PROPERTIES: &[(&str, &[&str])] = &[
    ("view_changed", &["view"]),
    ("course_opened", &["view"]),
    ("share_opened", &["view"]),
    ("directory_picked", &["kind"]),
    ("day_changed", &["via", "steps"]),
    ("week_changed", &["via", "steps"]),
    ("ics_exported", &["from", "result"]),
];
const PLANNING_ACTION_REQUIRED: &[(&str, &[&str])] =
    &[("view_changed", &["view"]), ("day_changed", &["via"]), ("week_changed", &["via"]), ("ics_exported", &["from", "result"]), ("directory_picked", &["kind"])];
const MAIL_ACTIONS: &[&str] = &[
    "mail_opened", "thread_expanded", "folder_changed", "search", "refresh", "compose_opened", "sent", "draft_saved", "draft_discarded", "grade_attached", "course_attached", "trash",
    "spam", "move", "restore", "delete_forever", "flag", "read_toggle", "empty_folder", "mark_folder_read", "print", "pdf", "attachment_downloaded",
];
const MAIL_FOLDER_KINDS: &[&str] = &["inbox", "sent", "drafts", "junk", "trash", "folder"];
// mail_action's own properties, by action, and those it can't go without.
const MAIL_ACTION_PROPERTIES: &[(&str, &[&str])] = &[
    ("mail_opened", &["from"]),
    ("folder_changed", &["folder_kind"]),
    ("search", &["scope"]),
    ("compose_opened", &["kind"]),
    ("sent", &["result", "attachments", "inline_images"]),
    ("trash", &["via"]),
    ("spam", &["via"]),
    ("move", &["via"]),
    ("restore", &["via"]),
    ("delete_forever", &["via"]),
    ("flag", &["via"]),
    ("read_toggle", &["via"]),
    ("empty_folder", &["folder_kind"]),
    ("mark_folder_read", &["folder_kind"]),
    ("pdf", &["result"]),
];
const MAIL_ACTION_REQUIRED: &[(&str, &[&str])] = &[
    ("mail_opened", &["from"]),
    ("folder_changed", &["folder_kind"]),
    ("search", &["scope"]),
    ("compose_opened", &["kind"]),
    ("sent", &["result"]),
    ("trash", &["via"]),
    ("spam", &["via"]),
    ("move", &["via"]),
    ("restore", &["via"]),
    ("delete_forever", &["via"]),
    ("flag", &["via"]),
    ("read_toggle", &["via"]),
    ("pdf", &["result"]),
];
// The settings that say which value was picked; every other is on/off.
const SETTING_VALUES: &[(&str, &[&str])] = &[
    ("theme", &["auto", "light", "dark"]),
    ("mail_signature_kind", &["auto", "partage", "custom"]),
    ("wallpaper_choice", &["university_daily", "university_photo", "tafac_daily", "tafac_photo", "custom"]),
];
const ON_OFF: &[&str] = &["on", "off"];
const SIMULATOR_STEPS: &[&str] = &["opened", "ue_picked", "reveal_shown", "back_to_edit", "closed"];
// The simulator's outcome, with reveal_shown only: never a grade, an
// average or a delta.
const SIMULATOR_REVEAL_PROPERTIES: &[&str] = &["edited_bucket", "added_grades", "ue_direction", "ue_validated", "crossed_pass_mark"];

// What a property's value may be. Anything else drops the property.
#[derive(Clone, Copy)]
enum Check {
    // One of these words.
    OneOf(&'static [&'static str]),
    // One of the words of any of these lists.
    OneOfAny(&'static [&'static [&'static str]]),
    Boolean,
    // a-z, 0-9 and dashes, at most this long.
    Slug(usize),
    // x.y.z, each at most three digits: the desktop app's version.
    Version,
    // Two letters a-z.
    Language,
}

use Check::*;

fn checked(check: Check, value: &Value) -> Option<Value> {
    let kept = match check {
        OneOf(words) => value.as_str().is_some_and(|word| words.contains(&word)),
        OneOfAny(lists) => value.as_str().is_some_and(|word| lists.iter().any(|words| words.contains(&word))),
        Boolean => value.is_boolean(),
        Slug(longest) => value.as_str().is_some_and(|slug| (1..=longest).contains(&slug.len()) && slug.bytes().all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))),
        Version => value.as_str().is_some_and(|version| {
            let parts: Vec<&str> = version.split('.').collect();
            parts.len() == 3 && parts.iter().all(|part| (1..=3).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_digit()))
        }),
        Language => value.as_str().is_some_and(|language| language.len() == 2 && language.bytes().all(|byte| byte.is_ascii_lowercase())),
    };
    kept.then(|| value.clone())
}

// The coarse context the page sends with every event.
const CONTEXT: &[(&str, Check)] = &[
    ("device", OneOf(&["mobile", "tablet", "desktop"])),
    ("browser", OneOf(&["chromium", "firefox", "safari", "other"])),
    ("standalone", Boolean),
    // Where Tafac runs: a browser tab, the installed PWA, the desktop app.
    ("client", OneOf(&["web", "pwa", "desktop", "ios"])),
    ("app_version", Version),
    ("lang", Language),
    // The establishment's id in the university's settings (« iutlan »).
    ("establishment", Slug(16)),
    // The formation's slug (« but-mmi »): never the year, the TD or the TP.
    ("formation", Slug(32)),
];

type Properties = Map<String, Value>;

struct Event {
    name: &'static str,
    // Its own properties, besides the context.
    properties: &'static [(&'static str, Check)],
    // Those without which it is dropped.
    required: &'static [&'static str],
    // Its rules across properties: false drops it.
    refine: fn(&mut Properties) -> bool,
    // Taken from a visitor without a session (the login page).
    without_session: bool,
}

fn as_is(_: &mut Properties) -> bool {
    true
}

fn word<'a>(properties: &'a Properties, name: &str) -> Option<&'a str> {
    properties.get(name).and_then(Value::as_str)
}

fn of<'a>(table: &'a [(&str, &'a [&'a str])], key: Option<&str>) -> &'a [&'a str] {
    table.iter().find(|(found, _)| Some(*found) == key).map_or(&[], |(_, names)| *names)
}

// `name` goes unless `property` is `value`.
fn unless(properties: &mut Properties, property: &str, values: &[&str], name: &str) {
    if !word(properties, property).is_some_and(|found| values.contains(&found)) {
        properties.remove(name);
    }
}

// An action's own properties, the context's and the action itself; then
// what the action can't go without.
fn action_only(properties: &mut Properties, own: &[(&str, &[&str])], required: &[(&str, &[&str])]) -> bool {
    let action = word(properties, "action").map(str::to_string);
    let kept = of(own, action.as_deref());
    properties.retain(|name, _| name == "action" || kept.contains(&name.as_str()) || CONTEXT.iter().any(|(context, _)| context == name));
    of(required, action.as_deref()).iter().all(|name| properties.contains_key(*name))
}

const EVENTS: &[Event] = &[
    Event { name: "dashboard_viewed", properties: &[], required: &[], refine: as_is, without_session: false },
    Event {
        name: "widget_loaded",
        properties: &[("widget", OneOf(WIDGET_IDS)), ("status", OneOf(&["ok", "empty", "error"])), ("duration_bucket", OneOf(DURATION_BUCKETS)), ("error_kind", OneOf(ERROR_KINDS))],
        required: &["widget", "status"],
        refine: |properties| {
            unless(properties, "status", &["error"], "error_kind");
            true
        },
        without_session: false,
    },
    Event {
        name: "app_opened",
        properties: &[
            ("app", Slug(64)),
            ("source", OneOf(&["grid", "favorites", "sidebar", "tabbar", "home_icon"])),
            // « Mes notes » opened in place of ScoDoc, the Planning page in
            // place of the planning's service.
            ("in_app", Boolean),
        ],
        required: &["app", "source"],
        refine: as_is,
        without_session: false,
    },
    Event {
        name: "setting_changed",
        properties: &[
            (
                "setting",
                OneOf(&[
                    "widget_visibility", "app_descriptions", "custom_background", "profile_photo", "wallpaper", "wallpaper_choice", "university_logo", "theme", "analytics", "mail_signature",
                    "mail_signature_kind", "assiduity_tab",
                ]),
            ),
            ("value", OneOf(&["on", "off", "auto", "light", "dark", "partage", "custom", "university_daily", "university_photo", "tafac_daily", "tafac_photo"])),
            ("widget", OneOf(WIDGET_IDS)),
        ],
        required: &["setting", "value"],
        refine: |properties| {
            let (setting, value) = (word(properties, "setting"), word(properties, "value"));
            // The statistics turned off are not reported at all.
            if setting == Some("analytics") && value == Some("off") {
                return false;
            }
            let allowed = SETTING_VALUES.iter().find(|(found, _)| Some(*found) == setting).map_or(ON_OFF, |(_, values)| *values);
            if !value.is_some_and(|value| allowed.contains(&value)) {
                return false;
            }
            if setting == Some("widget_visibility") {
                return properties.contains_key("widget");
            }
            properties.remove("widget");
            true
        },
        without_session: false,
    },
    Event { name: "login_result", properties: &[("result", OneOf(&["success", "failure"])), ("demo", Boolean)], required: &["result"], refine: as_is, without_session: true },
    Event { name: "pwa_update_applied", properties: &[], required: &[], refine: as_is, without_session: true },
    // Arrival from the old l'ent address, usually before signing in.
    Event { name: "settings_imported", properties: &[("has_settings", Boolean)], required: &["has_settings"], refine: as_is, without_session: true },
    // One per arrival on a page, each page with its own sources; the
    // planning's says the view it opens in.
    Event {
        name: "page_viewed",
        properties: &[
            ("page", OneOf(&["grades", "planning", "mail", "assiduity"])),
            ("source", OneOfAny(&[GRADES_PAGE_SOURCES, PLANNING_PAGE_SOURCES, MAIL_PAGE_SOURCES, ASSIDUITY_PAGE_SOURCES])),
            ("view", OneOf(PLANNING_VIEWS)),
        ],
        required: &["page", "source"],
        refine: |properties| {
            let sources = of(PAGE_SOURCES, word(properties, "page"));
            if !word(properties, "source").is_some_and(|source| sources.contains(&source)) {
                return false;
            }
            unless(properties, "page", &["planning"], "view");
            true
        },
        without_session: false,
    },
    Event {
        name: "grades_loaded",
        properties: &[("status", OneOf(&["ok", "empty", "unpublished", "unsupported", "error"])), ("duration_bucket", OneOf(DURATION_BUCKETS)), ("error_kind", OneOf(ERROR_KINDS))],
        required: &["status"],
        refine: |properties| {
            unless(properties, "status", &["error"], "error_kind");
            true
        },
        without_session: false,
    },
    Event {
        name: "grades_action",
        properties: &[("action", OneOf(GRADES_ACTIONS)), ("from", OneOf(&["latest", "ue_view", "subjects", "dashboard"]))],
        required: &["action"],
        refine: |properties| {
            unless(properties, "action", &["grade_detail_opened"], "from");
            true
        },
        without_session: false,
    },
    Event {
        name: "simulator_step",
        properties: &[
            ("step", OneOf(SIMULATOR_STEPS)),
            ("edited_bucket", OneOf(&["1", "2-3", "4+"])),
            ("added_grades", Boolean),
            ("ue_direction", OneOf(&["up", "down", "same", "new"])),
            ("ue_validated", Boolean),
            ("crossed_pass_mark", Boolean),
            // With `closed`: the furthest step reached.
            ("reached", OneOf(&["dial", "edit", "reveal"])),
        ],
        required: &["step"],
        refine: |properties| {
            for name in SIMULATOR_REVEAL_PROPERTIES {
                unless(properties, "step", &["reveal_shown"], name);
            }
            unless(properties, "step", &["closed"], "reached");
            true
        },
        without_session: false,
    },
    // The week the Planning opens on: never the week itself, nor how many
    // classes.
    Event {
        name: "planning_loaded",
        properties: &[("status", OneOf(&["ok", "empty", "unavailable", "unconfigured"])), ("duration_bucket", OneOf(DURATION_BUCKETS)), ("error_kind", OneOf(ERROR_KINDS))],
        required: &["status"],
        refine: |properties| {
            unless(properties, "status", &["unavailable"], "error_kind");
            true
        },
        without_session: false,
    },
    // One thing done on the Planning, or its .ics export from Réglages:
    // never a day or a class.
    Event {
        name: "planning_action",
        properties: &[
            ("action", OneOf(PLANNING_ACTIONS)),
            ("view", OneOf(PLANNING_VIEWS)),
            ("via", OneOf(&["arrow", "keyboard", "swipe", "strip", "pill"])),
            ("steps", OneOf(&["1", "2-3", "4+"])),
            ("from", OneOf(&["header", "settings"])),
            ("result", OneOf(&["ok", "empty", "error"])),
            ("kind", OneOf(&["room", "person", "group"])),
        ],
        required: &["action"],
        refine: |properties| action_only(properties, PLANNING_ACTION_PROPERTIES, PLANNING_ACTION_REQUIRED),
        without_session: false,
    },
    // The folder the Messagerie opens on: never how many mails, nor the
    // folder.
    Event {
        name: "mail_loaded",
        properties: &[("status", OneOf(&["ok", "empty", "error", "session_expired"])), ("duration_bucket", OneOf(DURATION_BUCKETS)), ("error_kind", OneOf(ERROR_KINDS))],
        required: &["status"],
        refine: |properties| {
            unless(properties, "status", &["error"], "error_kind");
            true
        },
        without_session: false,
    },
    // One thing done in the Messagerie: never a subject, an address, a
    // folder's name, a search, a file's name or a message's id.
    Event {
        name: "mail_action",
        properties: &[
            ("action", OneOf(MAIL_ACTIONS)),
            ("from", OneOf(&["list", "widget", "history"])),
            ("folder_kind", OneOf(MAIL_FOLDER_KINDS)),
            ("scope", OneOf(&["local", "server"])),
            ("kind", OneOf(&["new", "reply", "reply_all", "forward", "draft", "grade", "course", "absence"])),
            ("result", OneOf(&["ok", "partial", "error", "undone"])),
            ("attachments", OneOf(&["0", "1", "2-3", "4+"])),
            ("inline_images", Boolean),
            ("via", OneOf(&["toolbar", "context_menu", "swipe", "keyboard"])),
        ],
        required: &["action"],
        refine: |properties| {
            if !action_only(properties, MAIL_ACTION_PROPERTIES, MAIL_ACTION_REQUIRED) {
                return false;
            }
            // A PDF is saved or fails: nothing partial or undone.
            word(properties, "action") != Some("pdf") || matches!(word(properties, "result"), Some("ok" | "error"))
        },
        without_session: false,
    },
    // The semester « Assiduité » opens on: never how many absences, nor
    // what they are.
    Event {
        name: "assiduity_loaded",
        properties: &[("status", OneOf(&["ok", "empty", "hidden", "missing", "error"])), ("duration_bucket", OneOf(DURATION_BUCKETS)), ("error_kind", OneOf(ERROR_KINDS))],
        required: &["status"],
        refine: |properties| {
            unless(properties, "status", &["error"], "error_kind");
            true
        },
        without_session: false,
    },
    Event {
        name: "assiduity_action",
        properties: &[("action", OneOf(ASSIDUITY_ACTIONS)), ("from", OneOf(&["row", "countdown", "menu", "home"]))],
        required: &["action"],
        refine: |properties| {
            unless(properties, "action", &["justify_opened"], "from");
            true
        },
        without_session: false,
    },
    // « Justifier »'s steps, never the reason given.
    Event {
        name: "justify_step",
        properties: &[("step", OneOf(JUSTIFY_STEPS)), ("proof", OneOf(&["attached", "later", "none"])), ("reached", OneOf(JUSTIFY_REACHED))],
        required: &["step"],
        refine: |properties| {
            unless(properties, "step", &["proof_chosen", "composed"], "proof");
            unless(properties, "step", &["closed"], "reached");
            true
        },
        without_session: false,
    },
    // A page's launch announcement. Versions from before the Planning's only
    // announced « Mes notes », and don't say which.
    Event {
        name: "launch_card",
        properties: &[("action", OneOf(&["shown", "cta", "dismissed", "tab_marker"])), ("launch", OneOf(&["grades", "planning", "mail"]))],
        required: &["action"],
        refine: |properties| {
            properties.entry("launch").or_insert_with(|| Value::from("grades"));
            true
        },
        without_session: false,
    },
];

// The properties of `source` these checks keep.
fn picked(source: &Properties, checks: &[(&str, Check)], into: &mut Properties) {
    for (name, check) in checks {
        if let Some(value) = source.get(*name).and_then(|value| checked(*check, value)) {
            into.insert(name.to_string(), value);
        }
    }
}

// One event the page sent, with only what the allowlist keeps: its name and
// its properties. None: dropped.
pub(crate) fn event(raw: &Value, has_session: bool) -> Option<(&'static str, Properties)> {
    let name = raw.get("event")?.as_str()?;
    let definition = EVENTS.iter().find(|event| event.name == name)?;
    if !has_session && !definition.without_session {
        return None;
    }
    let empty = Properties::new();
    let source = raw.get("properties").and_then(Value::as_object).unwrap_or(&empty);
    let mut properties = Properties::new();
    picked(source, CONTEXT, &mut properties);
    picked(source, definition.properties, &mut properties);
    if !definition.required.iter().all(|name| properties.contains_key(*name)) {
        return None;
    }
    (definition.refine)(&mut properties).then_some((definition.name, properties))
}

// A batch as the page posts it (`{ events: [...] }`), read: the events
// kept, of its first twenty.
pub(crate) fn batch(payload: &Value, has_session: bool) -> Vec<(&'static str, Properties)> {
    let Some(events) = payload.get("events").and_then(Value::as_array) else { return Vec::new() };
    events.iter().take(MAX_EVENTS_PER_BATCH).filter_map(|raw| event(raw, has_session)).collect()
}

#[cfg(test)]
mod tests {

    use serde_json::json;

    use super::*;

    fn keep(event_name: &str, properties: Value, has_session: bool) -> Option<Value> {
        event(&json!({ "event": event_name, "properties": properties }), has_session).map(|(_, properties)| Value::Object(properties))
    }

    fn kept(event_name: &str, properties: Value) -> Option<Value> {
        keep(event_name, properties, true)
    }

    #[test]
    fn a_value_is_kept_only_when_it_is_what_its_property_takes() {
        for (value, slug) in [("moodle-ur", true), ("a", true), ("", false), ("Moodle", false), ("moodle_ur", false), ("moodle ur", false), ("é", false)] {
            assert_eq!(checked(Slug(64), &json!(value)).is_some(), slug, "{value:?}");
        }
        assert!(checked(Slug(3), &json!("abcd")).is_none());
        assert!(checked(Slug(3), &json!(123)).is_none());
        for (value, version) in [("0.26.0", true), ("123.4.56", true), ("1.2", false), ("1.2.3.4", false), ("1234.0.0", false), ("1.2.3-beta", false), ("1..3", false), ("1.2.3\n", false), ("١.٢.٣", false)] {
            assert_eq!(checked(Version, &json!(value)).is_some(), version, "{value:?}");
        }
        for (value, language) in [("fr", true), ("fr-FR", false), ("FR", false), ("f", false), ("fr\n", false)] {
            assert_eq!(checked(Language, &json!(value)).is_some(), language, "{value:?}");
        }
        assert_eq!(checked(Boolean, &json!(false)), Some(json!(false)));
        assert!(checked(Boolean, &json!("true")).is_none());
        assert!(checked(OneOf(&["1"]), &json!(1)).is_none());
    }

    // tests/analytics.test.js, case for case.

    #[test]
    fn unknown_events_unknown_properties_and_free_text_are_dropped() {
        assert_eq!(kept("$pageview", json!({})), None);
        assert_eq!(kept("constructor", json!({})), None);
        assert!(event(&json!({ "event": "constructor" }), true).is_none());
        let leaky = json!({
            "widget": "mail", "status": "ok", "duration_bucket": "<1s", "error_kind": "network", "subject": "Convocation examen", "email": "demo@tafac.fr",
            "device": "desktop", "client": "desktop", "app_version": "0.26.0", "browser": "Mozilla/5.0", "lang": "fr-FR", "establishment": "Camille Martin",
            "formation": "BUT MMI / TP 3", "university": "evil", "demo": true, "$ip": "1.2.3.4",
        });
        assert_eq!(
            event(&json!({ "event": "widget_loaded", "properties": leaky }), true).map(|(name, properties)| (name, Value::Object(properties))),
            Some(("widget_loaded", json!({ "device": "desktop", "client": "desktop", "app_version": "0.26.0", "widget": "mail", "status": "ok", "duration_bucket": "<1s" }))),
        );
        let odd = kept("widget_loaded", json!({ "widget": "mail", "status": "ok", "duration_bucket": "<1s", "client": "electron", "app_version": "0.26.0-beta" })).unwrap();
        assert_eq!(odd, json!({ "widget": "mail", "status": "ok", "duration_bucket": "<1s" }));
    }

    #[test]
    fn required_properties_and_the_rules_across_them() {
        assert_eq!(kept("widget_loaded", json!({ "widget": "mail" })), None);
        assert_eq!(kept("app_opened", json!({ "app": "Moodle UR", "source": "grid" })), None);
        assert_eq!(kept("app_opened", json!({ "app": "moodle-ur", "source": "grid" })), Some(json!({ "app": "moodle-ur", "source": "grid" })));
        assert_eq!(
            kept("app_opened", json!({ "app": "lent-iutlan-notes9", "source": "favorites", "in_app": true })),
            Some(json!({ "app": "lent-iutlan-notes9", "source": "favorites", "in_app": true })),
        );
        assert_eq!(kept("app_opened", json!({ "app": "moodle-ur", "source": "grid", "in_app": "yes" })), Some(json!({ "app": "moodle-ur", "source": "grid" })));
        assert_eq!(kept("setting_changed", json!({ "setting": "analytics", "value": "off" })), None);
        assert_eq!(kept("setting_changed", json!({ "setting": "widget_visibility", "value": "off" })), None);
        assert_eq!(kept("setting_changed", json!({ "setting": "app_descriptions", "value": "on", "widget": "mail" })), Some(json!({ "setting": "app_descriptions", "value": "on" })));
        assert_eq!(kept("setting_changed", json!({ "setting": "theme", "value": "dark" })), Some(json!({ "setting": "theme", "value": "dark" })));
        assert_eq!(kept("setting_changed", json!({ "setting": "theme", "value": "on" })), None);
        assert_eq!(kept("setting_changed", json!({ "setting": "wallpaper", "value": "dark" })), None);
        assert_eq!(
            kept("widget_loaded", json!({ "widget": "mail", "status": "error", "error_kind": "http_5xx" })),
            Some(json!({ "widget": "mail", "status": "error", "error_kind": "http_5xx" })),
        );
    }

    #[test]
    fn without_a_session_only_the_events_safe_for_anybody_are_taken() {
        assert_eq!(keep("dashboard_viewed", json!({}), false), None);
        assert!(event(&json!({ "event": "dashboard_viewed" }), false).is_none());
        assert!(keep("login_result", json!({ "result": "failure" }), false).is_some());
    }

    #[test]
    fn settings_imported_carries_a_boolean_only() {
        assert_eq!(keep("settings_imported", json!({ "has_settings": true, "keys": ["l-ent:weather-city"] }), false), Some(json!({ "has_settings": true })));
        assert_eq!(keep("settings_imported", json!({ "has_settings": "yes" }), false), None);
    }

    #[test]
    fn a_batch_is_its_first_twenty_events_and_nothing_else_is_one() {
        let events: Vec<Value> = (0..50).map(|_| json!({ "event": "dashboard_viewed" })).collect();
        assert_eq!(batch(&json!({ "events": events }), true).len(), MAX_EVENTS_PER_BATCH);
        // The first twenty are looked at, not the first twenty kept.
        let mut events: Vec<Value> = (0..19).map(|_| json!({ "event": "nothing" })).collect();
        events.extend((0..5).map(|_| json!({ "event": "dashboard_viewed" })));
        assert_eq!(batch(&json!({ "events": events }), true).len(), 1);
        for nothing in [json!({ "events": "nope" }), json!("not an object"), json!([{ "event": "dashboard_viewed" }]), json!(null), json!({})] {
            assert!(batch(&nothing, true).is_empty(), "{nothing}");
        }
        // An event that isn't an object, or whose properties aren't one.
        assert!(event(&json!(["dashboard_viewed"]), true).is_none());
        assert!(event(&json!({ "event": 12 }), true).is_none());
        assert_eq!(keep("dashboard_viewed", json!(["device", "mobile"]), true), Some(json!({})));
        assert_eq!(keep("dashboard_viewed", json!("device=mobile"), true), Some(json!({})));
    }

    #[test]
    fn the_formation_is_a_short_slug_or_nothing() {
        assert_eq!(kept("dashboard_viewed", json!({ "formation": "but-mmi" })), Some(json!({ "formation": "but-mmi" })));
        assert_eq!(kept("dashboard_viewed", json!({ "formation": "BUT MMI 2 — TP3" })), Some(json!({})));
        assert_eq!(kept("dashboard_viewed", json!({ "formation": "x".repeat(33) })), Some(json!({})));
    }

    #[test]
    fn page_viewed_names_a_page_and_one_of_its_own_sources() {
        assert_eq!(kept("page_viewed", json!({ "page": "grades", "source": "launch_card", "semester": "2026-S3" })), Some(json!({ "page": "grades", "source": "launch_card" })));
        assert_eq!(kept("page_viewed", json!({ "page": "grades", "source": "https://tafac.fr/" })), None);
        assert_eq!(kept("page_viewed", json!({ "page": "/grades?ue=UE3.1", "source": "nav" })), None);
        assert_eq!(keep("page_viewed", json!({ "page": "grades", "source": "nav" }), false), None);
        assert_eq!(
            kept("page_viewed", json!({ "page": "planning", "source": "dashboard_card", "view": "two_days", "week": "2026-10-19", "day": "2026-10-21" })),
            Some(json!({ "page": "planning", "source": "dashboard_card", "view": "two_days" })),
        );
        assert_eq!(kept("page_viewed", json!({ "page": "planning", "source": "tile", "view": "twoDays" })), Some(json!({ "page": "planning", "source": "tile" })));
        assert_eq!(kept("page_viewed", json!({ "page": "grades", "source": "nav", "view": "week" })), Some(json!({ "page": "grades", "source": "nav" })));
        assert_eq!(kept("page_viewed", json!({ "page": "planning", "source": "launch_card", "view": "week" })), Some(json!({ "page": "planning", "source": "launch_card", "view": "week" })));
        assert_eq!(kept("page_viewed", json!({ "page": "planning", "source": "launch-card" })), None);
        assert_eq!(keep("page_viewed", json!({ "page": "planning", "source": "nav" }), false), None);
        for source in ["nav", "tabbar", "tile", "dashboard_card", "launch_card", "grades", "planning", "history", "other"] {
            assert_eq!(kept("page_viewed", json!({ "page": "mail", "source": source, "view": "week" })), Some(json!({ "page": "mail", "source": source })));
        }
        // `sidebar_card` is « Mes notes »'s alone.
        assert_eq!(kept("page_viewed", json!({ "page": "mail", "source": "sidebar_card" })), None);
        assert_eq!(kept("page_viewed", json!({ "page": "grades", "source": "grades" })), None);
        assert_eq!(kept("page_viewed", json!({ "page": "planning", "source": "planning" })), None);
        // tests/mailAnalytics.test.js: every source of the Messagerie's.
        for source in MAIL_PAGE_SOURCES {
            assert!(kept("page_viewed", json!({ "page": "mail", "source": source })).is_some(), "{source}");
        }
        // tests/planningAnalytics.test.js: every source and view of the
        // Planning's.
        for source in PLANNING_PAGE_SOURCES {
            for view in PLANNING_VIEWS {
                assert_eq!(kept("page_viewed", json!({ "page": "planning", "source": source, "view": view })), Some(json!({ "page": "planning", "source": source, "view": view })));
            }
        }
    }

    #[test]
    fn grades_loaded_keeps_buckets_and_categories_never_numbers() {
        assert_eq!(
            kept("grades_loaded", json!({ "status": "error", "duration_bucket": "<3s", "error_kind": "timeout", "duration_ms": 2412, "error": "ScoDoc down" })),
            Some(json!({ "status": "error", "duration_bucket": "<3s", "error_kind": "timeout" })),
        );
        assert_eq!(
            kept("grades_loaded", json!({ "status": "unpublished", "duration_bucket": "<500ms", "error_kind": "network" })),
            Some(json!({ "status": "unpublished", "duration_bucket": "<500ms" })),
        );
        assert_eq!(kept("grades_loaded", json!({ "status": "ok", "duration_bucket": 1200, "average": 12.5 })), Some(json!({ "status": "ok" })));
        assert_eq!(kept("grades_loaded", json!({ "status": "loading" })), None);
    }

    #[test]
    fn grades_action_carries_an_action_and_from_only_for_a_grade_detail() {
        assert_eq!(
            kept("grades_action", json!({ "action": "grade_detail_opened", "from": "ue_view", "evaluation_id": 4512, "module": "R3.01" })),
            Some(json!({ "action": "grade_detail_opened", "from": "ue_view" })),
        );
        assert_eq!(kept("grades_action", json!({ "action": "semester_changed", "from": "latest", "semester_id": "845" })), Some(json!({ "action": "semester_changed" })));
        assert_eq!(kept("grades_action", json!({ "action": "ue_view_opened", "ue": "UE3.1" })), Some(json!({ "action": "ue_view_opened" })));
        assert_eq!(kept("grades_action", json!({ "action": "UE3.1" })), None);
    }

    #[test]
    fn simulator_step_keeps_the_outcome_on_reveal_shown_and_reached_on_closed_only() {
        let reveal = json!({ "edited_bucket": "2-3", "added_grades": true, "ue_direction": "up", "ue_validated": true, "crossed_pass_mark": true });
        let with = |base: Value, more: &Value| {
            let mut all = base.as_object().unwrap().clone();
            all.extend(more.as_object().unwrap().clone());
            Value::Object(all)
        };
        assert_eq!(
            kept("simulator_step", with(json!({ "step": "reveal_shown", "reached": "reveal", "delta": 1.5, "average": 10.4, "ue": "UE3.1" }), &reveal)),
            Some(with(json!({ "step": "reveal_shown" }), &reveal)),
        );
        // Numbers where buckets are expected are dropped, not rounded.
        assert_eq!(kept("simulator_step", json!({ "step": "reveal_shown", "edited_bucket": 2, "ue_direction": "+1.5", "ue_validated": "yes" })), Some(json!({ "step": "reveal_shown" })));
        assert_eq!(kept("simulator_step", with(json!({ "step": "closed", "reached": "edit" }), &reveal)), Some(json!({ "step": "closed", "reached": "edit" })));
        assert_eq!(kept("simulator_step", json!({ "step": "ue_picked", "reached": "dial", "ue_validated": false })), Some(json!({ "step": "ue_picked" })));
        assert_eq!(kept("simulator_step", json!({ "step": "typed" })), None);
    }

    #[test]
    fn launch_card_carries_its_action_and_which_launch_only() {
        for action in ["shown", "cta", "dismissed", "tab_marker"] {
            for launch in ["grades", "planning", "mail"] {
                assert_eq!(kept("launch_card", json!({ "action": action, "launch": launch })), Some(json!({ "action": action, "launch": launch })));
            }
        }
        // Versions from before the Planning's launch only announced « Mes notes ».
        assert_eq!(kept("launch_card", json!({ "action": "shown" })), Some(json!({ "action": "shown", "launch": "grades" })));
        assert_eq!(
            kept("launch_card", json!({ "action": "cta", "launch": "planning", "title": "Ton emploi du temps dans l’appli", "page": "/planning" })),
            Some(json!({ "action": "cta", "launch": "planning" })),
        );
        assert_eq!(kept("launch_card", json!({ "action": "clicked", "launch": "planning" })), None);
        assert_eq!(keep("launch_card", json!({ "action": "shown", "launch": "planning" }), false), None);
        // A launch that isn't one is grades, as Node's `??=` makes it.
        assert_eq!(kept("launch_card", json!({ "action": "shown", "launch": "exams" })), Some(json!({ "action": "shown", "launch": "grades" })));
    }

    #[test]
    fn planning_loaded_keeps_a_status_a_bucket_and_the_error_kind_of_unavailable_only() {
        assert_eq!(
            kept("planning_loaded", json!({ "status": "unavailable", "duration_bucket": "<10s", "error_kind": "http_5xx", "error": "ADE down", "week": "2026-10-19" })),
            Some(json!({ "status": "unavailable", "duration_bucket": "<10s", "error_kind": "http_5xx" })),
        );
        assert_eq!(
            kept("planning_loaded", json!({ "status": "empty", "duration_bucket": "<1s", "error_kind": "network", "classes": 0 })),
            Some(json!({ "status": "empty", "duration_bucket": "<1s" })),
        );
        assert_eq!(kept("planning_loaded", json!({ "status": "ok", "duration_bucket": 840, "group": "TP3" })), Some(json!({ "status": "ok" })));
        assert_eq!(kept("planning_loaded", json!({ "status": "unconfigured" })), Some(json!({ "status": "unconfigured" })));
        assert_eq!(kept("planning_loaded", json!({ "status": "loading" })), None);
        assert_eq!(kept("planning_loaded", json!({ "status": "error" })), None);
    }

    #[test]
    fn planning_action_keeps_the_properties_of_its_action_only_never_a_class_or_a_day() {
        let keep = |properties: Value| kept("planning_action", properties);
        assert_eq!(keep(json!({ "action": "view_changed", "view": "week", "via": "arrow", "from": "header" })), Some(json!({ "action": "view_changed", "view": "week" })));
        assert_eq!(
            keep(json!({ "action": "course_opened", "view": "list", "title": "Maths", "room": "B204", "teacher": "Dupont", "day": "2026-10-21" })),
            Some(json!({ "action": "course_opened", "view": "list" })),
        );
        assert_eq!(keep(json!({ "action": "week_changed", "via": "swipe", "steps": "2-3", "view": "week" })), Some(json!({ "action": "week_changed", "via": "swipe", "steps": "2-3" })));
        assert_eq!(keep(json!({ "action": "day_changed", "via": "pill", "steps": 3 })), Some(json!({ "action": "day_changed", "via": "pill" })));
        assert_eq!(
            keep(json!({ "action": "ics_exported", "from": "settings", "result": "empty", "classes": 12 })),
            Some(json!({ "action": "ics_exported", "from": "settings", "result": "empty" })),
        );
        for action in ["today", "calendar_picked", "day_opened", "occurrence_opened", "retry", "open_account"] {
            assert_eq!(keep(json!({ "action": action, "view": "day", "via": "arrow", "steps": "1", "from": "header", "result": "ok" })), Some(json!({ "action": action })));
        }
        // The context stays.
        assert_eq!(keep(json!({ "action": "today", "device": "mobile", "formation": "but-mmi" })), Some(json!({ "device": "mobile", "formation": "but-mmi", "action": "today" })));
        // Without what makes them mean something, or with free text: dropped.
        assert_eq!(keep(json!({ "action": "view_changed" })), None);
        assert_eq!(keep(json!({ "action": "view_changed", "view": "Semaine du 19 octobre" })), None);
        assert_eq!(keep(json!({ "action": "week_changed", "steps": "1" })), None);
        assert_eq!(keep(json!({ "action": "ics_exported", "from": "header" })), None);
        assert_eq!(keep(json!({ "action": "ics_exported", "from": "dashboard", "result": "ok" })), None);
        assert_eq!(keep(json!({ "action": "Maths B204" })), None);
        // « Partager », « Salles et personnels »: never the room or the person.
        assert_eq!(keep(json!({ "action": "share_opened", "view": "week", "group": "TP 3" })), Some(json!({ "action": "share_opened", "view": "week" })));
        assert_eq!(keep(json!({ "action": "directory_opened", "kind": "room" })), Some(json!({ "action": "directory_opened" })));
        assert_eq!(keep(json!({ "action": "directory_picked", "kind": "room", "name": "B05 - 107", "id": "8101" })), Some(json!({ "action": "directory_picked", "kind": "room" })));
        assert_eq!(keep(json!({ "action": "directory_picked", "kind": "group" })), Some(json!({ "action": "directory_picked", "kind": "group" })));
        assert_eq!(keep(json!({ "action": "directory_picked" })), None);
        assert_eq!(keep(json!({ "action": "directory_picked", "kind": "DUPONT Christophe" })), None);
    }

    #[test]
    fn mail_loaded_carries_a_status_a_bucket_and_the_error_kind_of_an_error_only() {
        let keep = |properties: Value| kept("mail_loaded", properties);
        for status in ["ok", "empty", "session_expired"] {
            assert_eq!(keep(json!({ "status": status, "duration_bucket": "<1s", "error_kind": "network", "count": 42, "folder": "Perso" })), Some(json!({ "status": status, "duration_bucket": "<1s" })));
        }
        assert_eq!(keep(json!({ "status": "error", "duration_bucket": "10s+", "error_kind": "http_5xx" })), Some(json!({ "status": "error", "duration_bucket": "10s+", "error_kind": "http_5xx" })));
        assert_eq!(keep(json!({ "status": "loading" })), None);
        assert_eq!(keep(json!({})), None);
    }

    #[test]
    fn mail_action_keeps_the_properties_of_its_action_only_never_a_subject_an_address_or_a_folders_name() {
        let keep = |properties: Value| kept("mail_action", properties);
        let leaks = json!({ "subject": "Convocation", "to": "a@b.fr", "folder": "Projets", "query": "examen", "name": "cv.pdf", "id": "123", "count": 5 });
        let course = json!({ "course": "R5.12 Développement back-end", "room": "A08", "teacher": "M. Lemoine", "day": "2026-11-03", "title": "R5.12" });
        let with = |base: Value, more: &[&Value]| {
            let mut all = base.as_object().unwrap().clone();
            for more in more {
                all.extend(more.as_object().unwrap().clone());
            }
            Value::Object(all)
        };
        assert_eq!(keep(with(json!({ "action": "mail_opened", "from": "widget" }), &[&leaks])), Some(json!({ "action": "mail_opened", "from": "widget" })));
        assert_eq!(keep(with(json!({ "action": "folder_changed", "folder_kind": "folder" }), &[&leaks])), Some(json!({ "action": "folder_changed", "folder_kind": "folder" })));
        assert_eq!(keep(with(json!({ "action": "search", "scope": "server" }), &[&leaks])), Some(json!({ "action": "search", "scope": "server" })));
        assert_eq!(keep(with(json!({ "action": "compose_opened", "kind": "grade" }), &[&leaks])), Some(json!({ "action": "compose_opened", "kind": "grade" })));
        // A class's mail: never its course, room, teacher or day.
        assert_eq!(keep(with(json!({ "action": "compose_opened", "kind": "course" }), &[&leaks, &course])), Some(json!({ "action": "compose_opened", "kind": "course" })));
        assert_eq!(keep(with(json!({ "action": "course_attached" }), &[&leaks, &course])), Some(json!({ "action": "course_attached" })));
        // An absence's mail: never its day, hours, subject or teacher.
        assert_eq!(keep(with(json!({ "action": "compose_opened", "kind": "absence" }), &[&leaks, &course])), Some(json!({ "action": "compose_opened", "kind": "absence" })));
        assert_eq!(
            keep(with(json!({ "action": "sent", "result": "partial", "attachments": "2-3", "inline_images": true }), &[&leaks])),
            Some(json!({ "action": "sent", "result": "partial", "attachments": "2-3", "inline_images": true })),
        );
        for action in ["trash", "spam", "move", "restore", "delete_forever", "flag", "read_toggle"] {
            for via in ["toolbar", "context_menu", "swipe", "keyboard"] {
                assert_eq!(keep(with(json!({ "action": action, "via": via }), &[&leaks])), Some(json!({ "action": action, "via": via })));
            }
        }
        assert_eq!(keep(json!({ "action": "pdf", "result": "error" })), Some(json!({ "action": "pdf", "result": "error" })));
        assert_eq!(keep(with(json!({ "action": "empty_folder", "folder_kind": "trash" }), &[&leaks])), Some(json!({ "action": "empty_folder", "folder_kind": "trash" })));
        for action in ["thread_expanded", "refresh", "draft_saved", "draft_discarded", "grade_attached", "course_attached", "print", "attachment_downloaded"] {
            assert_eq!(keep(with(json!({ "action": action, "via": "toolbar", "from": "list", "result": "ok" }), &[&leaks])), Some(json!({ "action": action })));
        }
        // The context stays.
        assert_eq!(keep(json!({ "action": "refresh", "device": "mobile" })), Some(json!({ "device": "mobile", "action": "refresh" })));
        // Without what makes them mean something, or with anything else: dropped.
        for dropped in [
            json!({ "action": "mail_opened" }),
            json!({ "action": "mail_opened", "from": "Projets" }),
            json!({ "action": "folder_changed", "folder_kind": "Projets" }),
            json!({ "action": "search", "scope": "examen" }),
            json!({ "action": "trash" }),
            json!({ "action": "trash", "via": "voice" }),
            json!({ "action": "sent" }),
            json!({ "action": "pdf", "result": "undone" }),
            json!({ "action": "compose_opened", "kind": "spam" }),
            json!({ "action": "delete_everything" }),
            json!({ "action": "Convocation examen" }),
        ] {
            assert_eq!(keep(dropped.clone()), None, "{dropped}");
        }
        assert_eq!(keep(json!({ "action": "sent", "result": "ok", "attachments": 7 })), Some(json!({ "action": "sent", "result": "ok" })));
        // tests/mailAnalytics.test.js: a mail sent, as the page describes it.
        assert_eq!(
            keep(json!({ "action": "sent", "result": "ok", "attachments": "2-3", "inline_images": true })),
            Some(json!({ "action": "sent", "result": "ok", "attachments": "2-3", "inline_images": true })),
        );
    }

    #[test]
    fn setting_changed_takes_the_mail_signature_on_or_off_and_its_kind_nothing_else() {
        let keep = |properties: Value| kept("setting_changed", properties);
        assert_eq!(keep(json!({ "setting": "mail_signature", "value": "off" })), Some(json!({ "setting": "mail_signature", "value": "off" })));
        assert_eq!(keep(json!({ "setting": "mail_signature", "value": "on", "text": "Jean Dupont" })), Some(json!({ "setting": "mail_signature", "value": "on" })));
        for value in ["auto", "partage", "custom"] {
            assert_eq!(keep(json!({ "setting": "mail_signature_kind", "value": value })), Some(json!({ "setting": "mail_signature_kind", "value": value })));
        }
        assert_eq!(keep(json!({ "setting": "mail_signature_kind", "value": "on" })), None);
        assert_eq!(keep(json!({ "setting": "mail_signature", "value": "custom" })), None);
        assert_eq!(keep(json!({ "setting": "wallpaper", "value": "partage" })), None);
        assert_eq!(keep(json!({ "setting": "theme", "value": "custom" })), None);
    }

    #[test]
    fn setting_changed_takes_the_wallpaper_as_its_folder_and_kind_never_the_photo() {
        let keep = |properties: Value| kept("setting_changed", properties);
        for value in ["university_daily", "university_photo", "tafac_daily", "tafac_photo", "custom"] {
            assert_eq!(keep(json!({ "setting": "wallpaper_choice", "value": value, "image": "/hero/a.webp" })), Some(json!({ "setting": "wallpaper_choice", "value": value })));
        }
        assert_eq!(keep(json!({ "setting": "wallpaper_choice", "value": "on" })), None);
        assert_eq!(keep(json!({ "setting": "wallpaper", "value": "tafac_daily" })), None);
    }

    #[test]
    fn assiduity_its_page_its_load_its_actions_and_justifier_never_what_the_absences_are() {
        let leaks = json!({ "date": "2026-09-25", "subject": "R5.11 Relations presse", "teacher": "thomas.lemoine@univ-rennes.fr", "hours": 2, "reason": "menstrual", "count": 4 });
        let with = |base: Value| {
            let mut all = base.as_object().unwrap().clone();
            all.extend(leaks.as_object().unwrap().clone());
            Value::Object(all)
        };
        assert_eq!(kept("page_viewed", with(json!({ "page": "assiduity", "source": "dashboard_card" }))), Some(json!({ "page": "assiduity", "source": "dashboard_card" })));
        assert_eq!(kept("page_viewed", json!({ "page": "assiduity", "source": "tile" })), None);
        assert_eq!(kept("page_viewed", json!({ "page": "assiduity", "source": "grades" })), None);
        assert_eq!(kept("assiduity_loaded", with(json!({ "status": "hidden", "duration_bucket": "<1s", "error_kind": "timeout" }))), Some(json!({ "status": "hidden", "duration_bucket": "<1s" })));
        assert_eq!(
            kept("assiduity_loaded", json!({ "status": "error", "duration_bucket": "<3s", "error_kind": "http_5xx" })),
            Some(json!({ "status": "error", "duration_bucket": "<3s", "error_kind": "http_5xx" })),
        );
        assert_eq!(kept("assiduity_loaded", json!({ "status": "absent" })), None);
        assert_eq!(kept("assiduity_action", with(json!({ "action": "justify_opened", "from": "countdown" }))), Some(json!({ "action": "justify_opened", "from": "countdown" })));
        assert_eq!(kept("assiduity_action", json!({ "action": "justify_opened", "from": "home" })), Some(json!({ "action": "justify_opened", "from": "home" })));
        assert_eq!(kept("assiduity_action", json!({ "action": "mark_picked", "from": "row" })), Some(json!({ "action": "mark_picked" })));
        assert_eq!(kept("assiduity_action", json!({ "action": "absence_deleted" })), None);
        // « Justifier »: the reason never goes, the proof only where it belongs.
        assert_eq!(kept("justify_step", json!({ "step": "reason_picked", "reason": "menstrual", "proof": "attached" })), Some(json!({ "step": "reason_picked" })));
        assert_eq!(kept("justify_step", with(json!({ "step": "composed", "proof": "later", "reached": "review" }))), Some(json!({ "step": "composed", "proof": "later" })));
        assert_eq!(kept("justify_step", json!({ "step": "closed", "reached": "proof", "proof": "none" })), Some(json!({ "step": "closed", "reached": "proof" })));
        assert_eq!(kept("justify_step", json!({ "step": "proof_chosen", "proof": "certificat.jpg" })), Some(json!({ "step": "proof_chosen" })));
        // The phone's tab and the Accueil card: on or off, the card by its id.
        assert_eq!(kept("setting_changed", json!({ "setting": "assiduity_tab", "value": "on" })), Some(json!({ "setting": "assiduity_tab", "value": "on" })));
        assert_eq!(
            kept("setting_changed", json!({ "setting": "widget_visibility", "value": "off", "widget": "assiduity" })),
            Some(json!({ "setting": "widget_visibility", "value": "off", "widget": "assiduity" })),
        );
    }
}
