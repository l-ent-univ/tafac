// The desktop app's update manifest (latest.json, docs/DESKTOP.md;
// server/desktopUpdate/manifest.ts): Tauri's static format, with two fields
// of ours.
//
//   {
//     "version": "0.26.0",
//     "minimum": "0.24.0",           ours: below it, the app can't sign in
//                                     any more and asks to be updated
//     "pub_date": "2026-11-20T09:00:00Z",
//     "notes": "",
//     "platforms": {
//       "darwin-aarch64": {
//         "url": "https://…/Tafac_0.26.0_aarch64.app.tar.gz",
//         "signature": "…",          the .sig file's content
//         "installer": "https://…/Tafac_0.26.0_aarch64.dmg"   ours
//       }
//     }
//   }
//
// What is published is checked first: a manifest the apps couldn't read, or
// one that would lock every install out, is not served at all, and an app
// that gets no answer goes on as it is. The reasons are Node's words.
//
// Read as Node reads it, with two differences that only ever refuse more:
// serde_json doesn't read a number too large for a double, a lone surrogate
// or more than 128 levels of nesting, which JSON.parse does; and the date is
// read by the grammar of the dates V8's Date.parse takes that start
// « YYYY-MM-DDT » (the time to the minute at least, a zone or none), not by
// V8 itself. Within that grammar both agree, out-of-range values included
// (a test holds them to V8's answers).

use std::collections::BTreeMap;

use serde_json::Value;

pub(crate) struct DesktopManifest {
    // The file as published, served as it is.
    pub(crate) text: String,
    pub(crate) version: String,
    // Each platform's installer, by its name (darwin-aarch64…).
    pub(crate) installers: BTreeMap<String, String>,
}

// /^\d+\.\d+\.\d+$/
pub(crate) fn is_version(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

// -1, 0 or 1, for two x.y.z versions, each number read as JavaScript's
// Number reads it.
pub(crate) fn compare_versions(left: &str, right: &str) -> i32 {
    let numbers = |version: &str| -> Vec<f64> { version.split('.').map(|part| part.parse().unwrap_or(f64::NAN)).collect() };
    let (a, b) = (numbers(left), numbers(right));
    for index in 0..3 {
        let difference = a.get(index).copied().unwrap_or(0.0) - b.get(index).copied().unwrap_or(0.0);
        if difference != 0.0 && !difference.is_nan() {
            return if difference > 0.0 { 1 } else { -1 };
        }
    }
    0
}

// /^[a-z0-9]+(-[a-z0-9_]+){1,2}$/
fn is_platform(name: &str) -> bool {
    let parts: Vec<&str> = name.split('-').collect();
    let word = |part: &str, underscore: bool| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || (underscore && byte == b'_'));
    (2..=3).contains(&parts.len()) && word(parts[0], false) && parts[1..].iter().all(|part| word(part, true))
}

// new URL(value).protocol === 'https:'
fn is_https_url(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).and_then(|text| url::Url::parse(text).ok()).is_some_and(|address| address.scheme() == "https")
}

// What /^\d{4}-\d{2}-\d{2}T/ and Date.parse both take: « YYYY-MM-DDTHH:mm »,
// then « :ss » and « .fraction » if there are, then « Z » (or « z »),
// « ±HH:mm » or « ±HHmm » if there is. A month 1 to 12, a day 1 to 31
// (whatever the month, as V8), an hour to 23 or 24:00 exactly, minutes and
// seconds to 59, a zone to 23:59.
fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    let number = |at: usize, length: usize| -> Option<u32> {
        let digits = bytes.get(at..at + length)?;
        digits.iter().all(u8::is_ascii_digit).then(|| digits.iter().fold(0, |sum, digit| sum * 10 + u32::from(digit - b'0')))
    };
    let at = |at: usize, byte: u8| bytes.get(at) == Some(&byte);
    let (Some(_), Some(month), Some(day)) = (number(0, 4), number(5, 2), number(8, 2)) else { return false };
    if !(at(4, b'-') && at(7, b'-') && at(10, b'T') && (1..=12).contains(&month) && (1..=31).contains(&day)) {
        return false;
    }
    let (Some(hour), Some(minute)) = (number(11, 2), number(14, 2)) else { return false };
    if !at(13, b':') || minute > 59 {
        return false;
    }
    let mut end = 16;
    let mut second = 0;
    let mut fraction_is_zero = true;
    if at(end, b':') {
        let Some(read) = number(end + 1, 2).filter(|second| *second <= 59) else { return false };
        second = read;
        end += 3;
        if at(end, b'.') {
            let digits = bytes[end + 1..].iter().take_while(|byte| byte.is_ascii_digit()).count();
            if digits == 0 {
                return false;
            }
            fraction_is_zero = bytes[end + 1..end + 1 + digits].iter().all(|digit| *digit == b'0');
            end += 1 + digits;
        }
    }
    if hour > 24 || (hour == 24 && (minute != 0 || second != 0 || !fraction_is_zero)) {
        return false;
    }
    match &bytes[end..] {
        [] | [b'Z' | b'z'] => true,
        [b'+' | b'-', zone @ ..] => {
            let (hours, minutes) = match zone {
                [h1, h2, b':', m1, m2] | [h1, h2, m1, m2] => ([*h1, *h2], [*m1, *m2]),
                _ => return false,
            };
            let two = |pair: [u8; 2]| pair.iter().all(u8::is_ascii_digit).then(|| u32::from(pair[0] - b'0') * 10 + u32::from(pair[1] - b'0'));
            matches!((two(hours), two(minutes)), (Some(hours), Some(minutes)) if hours <= 23 && minutes <= 59)
        }
        _ => false,
    }
}

// The manifest, or why it can't be served.
pub(crate) fn parse_desktop_manifest(text: &str) -> Result<DesktopManifest, String> {
    let Ok(manifest) = serde_json::from_str::<Value>(text) else { return Err("not JSON".to_string()) };
    let Some(manifest) = manifest.as_object() else { return Err("not an object".to_string()) };

    let Some(version) = manifest.get("version").and_then(Value::as_str).filter(|version| is_version(version)) else { return Err("\"version\" is not x.y.z".to_string()) };
    if let Some(minimum) = manifest.get("minimum") {
        let Some(minimum) = minimum.as_str().filter(|minimum| is_version(minimum)) else { return Err("\"minimum\" is not x.y.z".to_string()) };
        // Above the version on offer, no update would ever satisfy it.
        if compare_versions(minimum, version) > 0 {
            return Err("\"minimum\" is above \"version\"".to_string());
        }
    }
    // The updater refuses the whole manifest for a date it can't read.
    if manifest.get("pub_date").is_some_and(|date| !date.as_str().is_some_and(is_date)) {
        return Err("\"pub_date\" is not an RFC 3339 date".to_string());
    }
    let Some(platforms) = manifest.get("platforms").and_then(Value::as_object).filter(|platforms| !platforms.is_empty()) else { return Err("no \"platforms\"".to_string()) };

    let mut installers = BTreeMap::new();
    for (name, platform) in platforms {
        if !is_platform(name) {
            return Err(format!("platform \"{name}\" is not a platform name"));
        }
        let Some(platform) = platform.as_object() else { return Err(format!("platform \"{name}\" is not an object")) };
        if !is_https_url(platform.get("url")) {
            return Err(format!("platform \"{name}\" has no https \"url\""));
        }
        if !platform.get("signature").and_then(Value::as_str).is_some_and(|signature| !signature.is_empty()) {
            return Err(format!("platform \"{name}\" has no \"signature\""));
        }
        if let Some(installer) = platform.get("installer") {
            if !is_https_url(Some(installer)) {
                return Err(format!("platform \"{name}\" has an \"installer\" that is not https"));
            }
            installers.insert(name.clone(), installer.as_str().unwrap_or_default().to_string());
        }
    }
    Ok(DesktopManifest { text: text.to_string(), version: version.to_string(), installers })
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::json;

    use super::*;

    // Node's tests' manifest.
    pub(crate) fn manifest() -> Value {
        json!({
            "version": "0.26.0",
            "minimum": "0.24.0",
            "pub_date": "2026-11-20T09:00:00Z",
            "notes": "",
            "platforms": {
                "darwin-aarch64": {
                    "url": "https://example.org/Tafac_0.26.0_aarch64.app.tar.gz",
                    "signature": "c2lnbmF0dXJl",
                    "installer": "https://example.org/Tafac_0.26.0_aarch64.dmg",
                },
                "darwin-x86_64": {
                    "url": "https://example.org/Tafac_0.26.0_x64.app.tar.gz",
                    "signature": "c2lnbmF0dXJl",
                },
            },
        })
    }

    fn reason(manifest: Value) -> Option<String> {
        parse_desktop_manifest(&manifest.to_string()).err()
    }

    fn platform_named(name: &str) -> Value {
        let mut platforms = serde_json::Map::new();
        platforms.insert(name.to_string(), json!({ "url": "https://example.org/a", "signature": "s" }));
        with(json!({ "platforms": platforms }))
    }

    fn with(changes: Value) -> Value {
        let mut changed = manifest();
        for (key, value) in changes.as_object().unwrap() {
            changed[key] = value.clone();
        }
        changed
    }

    #[test]
    fn versions_compare_by_their_numbers() {
        assert_eq!(compare_versions("0.26.0", "0.26.0"), 0);
        assert_eq!(compare_versions("0.9.0", "0.10.0"), -1);
        assert_eq!(compare_versions("1.0.0", "0.99.99"), 1);
    }

    #[test]
    fn a_manifest_the_apps_can_read_is_served_as_published() {
        let text = serde_json::to_string_pretty(&manifest()).unwrap();
        let parsed = parse_desktop_manifest(&text).unwrap();
        assert_eq!(parsed.text, text);
        assert_eq!(parsed.version, "0.26.0");
        assert_eq!(parsed.installers.into_iter().collect::<Vec<_>>(), [("darwin-aarch64".to_string(), "https://example.org/Tafac_0.26.0_aarch64.dmg".to_string())]);
        // `minimum`, the date, the notes and the installers are optional.
        assert_eq!(reason(json!({ "version": "0.26.0", "platforms": { "darwin-aarch64": { "url": "https://example.org/a", "signature": "s" } } })), None);
    }

    #[test]
    fn a_manifest_that_would_break_the_apps_is_not_served() {
        assert_eq!(parse_desktop_manifest("{").err().as_deref(), Some("not JSON"));
        assert_eq!(parse_desktop_manifest("[]").err().as_deref(), Some("not an object"));
        assert_eq!(reason(with(json!({ "version": "v0.26.0" }))).as_deref(), Some("\"version\" is not x.y.z"));
        assert_eq!(reason(with(json!({ "minimum": "0.24" }))).as_deref(), Some("\"minimum\" is not x.y.z"));
        assert_eq!(reason(with(json!({ "minimum": null }))).as_deref(), Some("\"minimum\" is not x.y.z"));
        // Nothing on offer would get an install past it.
        assert_eq!(reason(with(json!({ "minimum": "0.27.0" }))).as_deref(), Some("\"minimum\" is above \"version\""));
        assert_eq!(reason(with(json!({ "pub_date": "20 novembre 2026" }))).as_deref(), Some("\"pub_date\" is not an RFC 3339 date"));
        assert_eq!(reason(with(json!({ "pub_date": null }))).as_deref(), Some("\"pub_date\" is not an RFC 3339 date"));
        assert_eq!(reason(with(json!({ "platforms": {} }))).as_deref(), Some("no \"platforms\""));
        assert_eq!(reason(with(json!({ "platforms": { "darwin-aarch64": { "url": "http://example.org/a", "signature": "s" } } }))).as_deref(), Some("platform \"darwin-aarch64\" has no https \"url\""));
        assert_eq!(reason(with(json!({ "platforms": { "darwin-aarch64": { "url": "https://example.org/a" } } }))).as_deref(), Some("platform \"darwin-aarch64\" has no \"signature\""));
        assert_eq!(reason(with(json!({ "platforms": { "darwin-aarch64": { "url": "https://example.org/a", "signature": "s", "installer": "javascript:alert(1)" } } }))).as_deref(), Some("platform \"darwin-aarch64\" has an \"installer\" that is not https"));
        assert_eq!(reason(with(json!({ "platforms": { "darwin-aarch64": { "url": "https://example.org/a", "signature": "s", "installer": null } } }))).as_deref(), Some("platform \"darwin-aarch64\" has an \"installer\" that is not https"));
        for name in ["Darwin-aarch64", "darwin", "darwin-aarch64-x-y", "darwin--x", "darwin_x-y", "darwin-x86 64"] {
            assert_eq!(reason(platform_named(name)), Some(format!("platform \"{name}\" is not a platform name")), "{name}");
        }
        for name in ["darwin-aarch64", "darwin-x86_64", "windows-x86_64-msi", "linux-i686"] {
            assert_eq!(reason(platform_named(name)), None, "{name}");
        }
        assert_eq!(reason(with(json!({ "platforms": { "darwin-aarch64": [] } }))).as_deref(), Some("platform \"darwin-aarch64\" is not an object"));
    }

    // V8's Date.parse (Node 26), for each: a number, or NaN.
    #[test]
    fn a_date_is_one_node_reads() {
        let read = [
            "2026-11-20T09:00:00Z", "2026-11-20T09:00:00", "2026-11-20T09:00", "2026-02-30T09:00:00Z", "2026-02-31T09:00:00Z", "2026-11-20T24:00:00Z",
            "2026-11-20T09:00:00.1Z", "2026-11-20T09:00:00.12345Z", "2026-11-20T09:00:00+01:00", "2026-11-20T09:00:00+0100", "2026-11-20T09:00:00+23:59",
            "2026-11-20T09:00:00z", "2026-11-20T09:00:00.000+01:00", "2026-11-20T09:00Z", "2026-11-20T09:00:00-00:00", "9999-12-31T23:59:59Z", "0000-01-01T00:00:00Z",
            "2026-11-20T09:00:00.1234567890123Z", "2026-11-20T09:00:00.5", "2026-11-20T09:00:00.000000Z", "2026-11-20T09:00:00-0000", "2026-11-20T24:00Z",
            "2026-11-20T24:00", "2026-11-20T24:00:00.000Z", "2026-11-20T09:00:00.5+0100", "2026-11-20T09:00+0100", "2026-11-20T09:00:00+2359",
        ];
        let not_read = [
            "2026-11-20T09", "2026-11-20T", "2026-00-20T09:00:00Z", "2026-13-20T09:00:00Z", "2026-11-00T09:00:00Z", "2026-11-32T09:00:00Z", "2026-11-20T24:00:01Z",
            "2026-11-20T25:00:00Z", "2026-11-20T23:60:00Z", "2026-11-20T23:59:60Z", "2026-11-20T09:00:00.Z", "2026-11-20T09:00:00+24:00", "2026-11-20T09:00:00+23:60",
            "2026-11-20T09:00:00 GMT", "2026-11-20T09:00:00Z garbage", "2026-11-20T09:00:00ZZ", "2026-11-20T09:00:00,5Z", "2026-11-20T9:00:00Z", "2026-11-20T09:0:00Z",
            "2026-11-20Tfoo", "2026-11-20T09:00:00+01", "2026-11-20T09:00:00 Z", "2026-11-20T09:00:00UTC", "2026-11-20T09:00:00 +0100", "2026-11-20T09:00:00Z\n",
            " 2026-11-20T09:00:00Z", "2026-11-20T00:00:00 PM", "2026-11-20T09:00:00Z (x)", "2026-11-20T09:00:00 (x)", "2026-11-20T24:00:00.5Z",
            "2026-11-20T09:00:00+1:00", "2026-11-20T09:00:00+01:0", "2026-11-20T09:00:00+001:00", "2026-11-20T09:00:00+23:59:00", "2026-11-20T09:00:00+2400",
            "2026-11-20T09:00:00+0060", "2026-11-20T09:00:00Z+01:00", "2026-11-20T09:00:00.5 Z", "2026-11-20T09:60", "2026-11-20T09:00:00.-1Z",
            "2026-11-20T00:00:00+00:00x", "2026-11-20T09:00:00\t", "2026-11-20T09:00:00.1e3Z",
            // Read by V8, not by Node's pattern, which wants a capital T.
            "2026-11-20t09:00:00Z",
        ];
        for date in read {
            assert!(is_date(date), "{date}");
        }
        for date in not_read {
            assert!(!is_date(date), "{date:?}");
        }
    }

}
