// POST /__ent_auth/app-icons: the icons of the applications' tiles, Tafac's
// own (server/appIcons.js, src/appIconPicks.js). No question to tonAPI.
//
// Node's answers (server/entAuthApp.js), given here for a session the
// gateway holds, when the gateway has the data directory (DATA_DIR, as Node
// is given it):
//
//   200 { ok: true, palette, icons: { [id]: { icon, color } } }
//       `palette`: the university's colour mode, each hue's tile and glyph
//       in light and dark. `icon`: an Iconify name in the university's
//       style; `color`: a hue of the palette. A service seen for the first
//       time gets a concept from its title's keywords (else its
//       description's, its category's) and a hue from its id, the one used
//       least first; the pick is written down for the whole university in
//       <DATA_DIR>/app-icons/<id>.json and never changes after (a brand's
//       logo aside, which replaces a concept written before it had one).
//       The file is Node's, in Node's format: one written by either is read
//       by the other, again when it changes on disk, and written whole
//       under another name first, then renamed over. Past 500 services, a
//       new one is answered and not written down. A file that can't be read,
//       parsed or written: the picks are kept in this process only, said
//       once in the log, and a broken file is left as it is.
//   400 { ok: false, error: 'Expected { services: [...] }.' }: JSON, but
//       not that.
//   401 { ok: false, error: 'Authentication required.' }: nobody signed
//       in, a session the gateway doesn't hold (gateway/nobody.rs).
//   A body Node read its own way, which the page never sends: not said to
//       be JSON, empty (Node: no services, 400 as above), another charset
//       (415), compressed (Node inflated it: refused here, 415), past 100
//       kB (413), not JSON serde_json reads (400), in the words the mail's
//       routes give the same refusals.
//   Still Node's, where tafac.fr's server has one behind: every request
//       when the gateway isn't given the data directory (Node keeps its
//       own file then), and a university whose look icons.json doesn't
//       have (none the gateway serves). The apps give it theirs: the
//       folder their own Node kept the file in.
//
// The picking is the page's too (src/appIconPicks.js, for the demo
// account): its lists aren't typed again here. scripts/gateway-data.mjs
// writes them in icons.json, beside this file, and both sides hold to
// tests/fixtures/app-icon-picks.json, which the same script writes from
// what the JS picks.
//
// Node answers a session's request with its cookie written again (its
// lifetime counted from then); an answer made here leaves the cookie as it
// is, as the other moved routes do.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as Atomic};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use http::header::{CONTENT_ENCODING, CONTENT_TYPE};
use serde::Deserialize;

use super::js::{self, Utf16};
use crate::gateway::Asked;
use crate::translate::json_response;

// express.json()'s limit: past it, Node refuses the body (413).
const MAX_BODY_BYTES: usize = 100 * 1024;
const WRONG_SHAPE: &str = r#"{"ok":false,"error":"Expected { services: [...] }."}"#;

// --- What the JS has ------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    file_version: u64,
    max_stored_services: usize,
    max_request_services: usize,
    max_title_length: usize,
    max_description_length: usize,
    max_category_length: usize,
    // The patterns' sources: a test holds the two matchers below to them.
    #[cfg(test)]
    service_pattern: String,
    #[cfg(test)]
    icon_name_pattern: String,
    generic: String,
    brands: Vec<String>,
    // In their order: a colour's start, and the palette's order.
    hues: Vec<String>,
    concepts: HashSet<String>,
    // One of our own icons stored by name, in any style → its concept.
    built_in_icons: HashMap<String, String>,
    color_modes: HashMap<String, HashMap<String, Pair>>,
    themes: HashMap<String, Theme>,
    rules: Vec<Rule>,
    // normalizeText, one character outside ASCII at a time: [first, last,
    // what each folds to]. A character not listed is a separator.
    fold: Vec<(u32, u32, String)>,
}

#[derive(Deserialize)]
struct Pair {
    light: Shades,
    dark: Shades,
}

#[derive(Deserialize)]
struct Shades {
    bg: String,
    fg: String,
}

// A university's look (universities/<id>/shared.js, appIcons): its icon for
// each concept, its colour mode.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Theme {
    color_mode: String,
    icons: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Rule {
    concept: String,
    keywords: Vec<String>,
}

struct Picking {
    data: Data,
    // Each rule's keywords as normalizeText leaves them, a space before
    // (the start of a word), and after when the keyword ends with one.
    needles: Vec<(String, Vec<String>)>,
}

static PICKING: LazyLock<Picking> = LazyLock::new(|| {
    let data: Data = serde_json::from_str(include_str!("icons.json")).expect("icons.json is scripts/gateway-data.mjs's");
    let needles = data
        .rules
        .iter()
        .map(|rule| {
            let needles = rule.keywords.iter().map(|keyword| format!(" {}{}", normalize_with(&data, keyword), if keyword.ends_with(' ') { " " } else { "" })).collect();
            (rule.concept.clone(), needles)
        })
        .collect();
    Picking { data, needles }
});

fn data() -> &'static Data {
    &PICKING.data
}

// normalizeText: lower case, no accents, words between single spaces.
fn normalize(text: &str) -> String {
    normalize_with(data(), text)
}

fn normalize_with(data: &Data, text: &str) -> String {
    let mut folded = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            folded.push(c.to_ascii_lowercase());
            continue;
        }
        let code = c as u32;
        let run = data.fold.binary_search_by(|(first, last, _)| if code < *first { Ordering::Greater } else if code > *last { Ordering::Less } else { Ordering::Equal });
        match run {
            Ok(index) => folded.push_str(&data.fold[index].2),
            Err(_) => folded.push(' '),
        }
    }
    let mut normalized = String::with_capacity(folded.len());
    let mut gap = false;
    for c in folded.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '+' {
            if gap && !normalized.is_empty() {
                normalized.push(' ');
            }
            gap = false;
            normalized.push(c);
        } else {
            gap = true;
        }
    }
    normalized
}

// The first rule a keyword of which starts a word of the text.
fn match_text(text: &str) -> Option<&'static str> {
    let normalized = normalize(text);
    if normalized.is_empty() {
        return None;
    }
    let haystack = format!(" {normalized} ");
    PICKING.needles.iter().find(|(_, needles)| needles.iter().any(|needle| haystack.contains(needle.as_str()))).map(|(concept, _)| concept.as_str())
}

// matchAppIcon: the title decides; the description and the category only
// when it says nothing.
fn match_service(service: &Service) -> Option<&'static str> {
    [&service.title, &service.description, &service.category].into_iter().find_map(|text| match_text(&js::lossy(text)))
}

// matchAppIconBrand: the logo a title calls for.
fn brand(title: &[u16]) -> Option<&'static str> {
    match_text(&js::lossy(title)).filter(|concept| data().brands.iter().any(|brand| brand == concept))
}

// hashString: FNV-1a, over the code points.
fn hash(text: &str) -> u32 {
    text.chars().fold(0x811c_9dc5_u32, |hash, c| (hash ^ c as u32).wrapping_mul(0x0100_0193))
}

// pickAppColor: from the id's own hue, the next of the ones used least.
fn pick_color(id: &str, usage: Option<&HashMap<String, usize>>) -> &'static str {
    let hues = &data().hues;
    let start = hash(id) as usize % hues.len();
    let Some(usage) = usage else { return &hues[start] };
    let used = |hue: &String| usage.get(hue).copied().unwrap_or(0);
    let least = hues.iter().map(used).min().unwrap_or(0);
    (0..hues.len()).map(|offset| &hues[(start + offset) % hues.len()]).find(|hue| used(hue) == least).unwrap_or(&hues[start])
}

// assignAppIcon: a concept and a hue.
fn assign(service: &Service, usage: Option<&HashMap<String, usize>>) -> (String, String) {
    let concept = match_service(service).unwrap_or(&data().generic);
    (concept.to_string(), pick_color(&service.id, usage).to_string())
}

// SERVICE_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
fn is_service_id(id: &str) -> bool {
    let mut bytes = id.bytes();
    bytes.next().is_some_and(|first| first.is_ascii_alphanumeric()) && id.len() <= 64 && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

// ICON_NAME_PATTERN: « prefix:name », words of a-z 0-9 between dashes.
fn is_icon_name(icon: &str) -> bool {
    let words = |part: &str| part.split('-').all(|word| !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit()));
    matches!(icon.split_once(':'), Some((prefix, name)) if words(prefix) && words(name))
}

// isPinnedAppIcon: neither a concept nor one of our own icons by name.
fn is_pinned(icon: &str) -> bool {
    !data().concepts.contains(icon) && !data().built_in_icons.contains_key(icon)
}

// isValidAppIconEntry.
fn is_valid_entry(icon: &str, color: &str) -> bool {
    (data().concepts.contains(icon) || is_icon_name(icon)) && data().hues.iter().any(|hue| hue == color)
}

// toIconifyName: a stored icon in the university's style.
fn iconify<'a>(stored: &'a str, theme: &'a Theme) -> &'a str {
    let concept = if data().concepts.contains(stored) { Some(stored) } else { data().built_in_icons.get(stored).map(String::as_str) };
    match concept {
        Some(concept) => theme.icons.get(concept).map_or(stored, String::as_str),
        None if is_icon_name(stored) => stored,
        None => theme.icons.get(&data().generic).map_or(stored, String::as_str),
    }
}

// String.prototype.localeCompare, for the ids SERVICE_ID_PATTERN lets
// through: Unicode's order (ICU's, as Node has it), punctuation (_ - .)
// before digits before letters, a letter's case only when nothing else
// differs, lower first.
fn compare_ids(a: &str, b: &str) -> Ordering {
    let primary = |c: char| -> u32 {
        match c {
            '_' => 1,
            '-' => 2,
            '.' => 3,
            '0'..='9' => 10 + (c as u32 - '0' as u32),
            'a'..='z' => 20 + (c as u32 - 'a' as u32),
            'A'..='Z' => 20 + (c as u32 - 'A' as u32),
            // Never in an id: after all of them, by code point.
            _ => 100 + c as u32,
        }
    };
    let primaries = |text: &str| text.chars().map(primary).collect::<Vec<_>>();
    let cases = |text: &str| text.chars().map(|c| c.is_ascii_uppercase()).collect::<Vec<_>>();
    primaries(a).cmp(&primaries(b)).then_with(|| cases(a).cmp(&cases(b)))
}

// --- The request -----------------------------------------------------------------

// A service as sanitizeAppIconRequest leaves it.
struct Service {
    id: String,
    title: Utf16,
    description: Utf16,
    category: Utf16,
}

// cleanText: control characters and runs of white space as one space,
// trimmed, cut at a length in UTF-16 units. Anything but a string: empty.
fn clean(value: Option<&serde_json::Value>, length: usize) -> Utf16 {
    let Some(text) = value.and_then(serde_json::Value::as_str) else { return Vec::new() };
    let mut spaced = String::with_capacity(text.len());
    let mut gap = false;
    for c in text.chars().map(|c| if c.is_control() { ' ' } else { c }) {
        if js::is_space(c) {
            gap = true;
            continue;
        }
        if gap {
            spaced.push(' ');
            gap = false;
        }
        spaced.push(c);
    }
    if gap {
        spaced.push(' ');
    }
    js::utf16_prefix(js::trim(&spaced), length)
}

// sanitizeAppIconRequest: the valid services, once each, so many at most;
// None for a body that isn't { services: [...] }.
fn sanitize(body: &serde_json::Value) -> Option<Vec<Service>> {
    let data = data();
    let listed = body.as_object()?.get("services")?.as_array()?;
    let mut seen = HashSet::new();
    let mut services = Vec::new();
    for item in listed.iter().take(data.max_request_services) {
        let field = |name: &str| item.as_object().and_then(|item| item.get(name));
        let id = field("id").and_then(serde_json::Value::as_str).map(js::trim).unwrap_or_default();
        let title = clean(field("title"), data.max_title_length);
        if !is_service_id(id) || title.is_empty() || seen.contains(id) {
            continue;
        }
        seen.insert(id.to_string());
        services.push(Service {
            id: id.to_string(),
            title,
            description: clean(field("description"), data.max_description_length),
            category: clean(field("category"), data.max_category_length),
        });
    }
    Some(services)
}

// Whether express.json() reads a body of this type as it is read here:
// application/json, in UTF-8 (said, or nothing said). The type and its
// charset as the content-type package (2.x) reads them: spaces and tabs
// around, a parameter without « = » passed over, a quoted value with its
// escapes, the first charset counting.
fn is_json_in_utf8(content_type: &str) -> bool {
    let ows = |c: char| c == ' ' || c == '\t';
    let (kind, mut rest) = content_type.split_at(content_type.find(';').unwrap_or(content_type.len()));
    if !kind.trim_matches(ows).eq_ignore_ascii_case("application/json") {
        return false;
    }
    let mut charset = None;
    while let Some(after) = rest.strip_prefix(';') {
        let parameter = after.trim_start_matches(ows);
        let (key, value) = match parameter.find([';', '=']) {
            Some(at) if parameter[at..].starts_with('=') => (&parameter[..at], parameter[at + 1..].trim_start_matches(ows)),
            // No « = » before the next « ; », or none at all: passed over.
            Some(at) => {
                rest = &parameter[at..];
                continue;
            }
            None => break,
        };
        let value = match value.strip_prefix('"') {
            Some(quoted) => {
                let mut unquoted = String::new();
                let mut chars = quoted.char_indices();
                let mut closed = None;
                while let Some((at, c)) = chars.next() {
                    match c {
                        '"' => {
                            closed = Some(at + 1);
                            break;
                        }
                        '\\' => unquoted.extend(chars.next().map(|(_, escaped)| escaped)),
                        c => unquoted.push(c),
                    }
                }
                // Unclosed: no value, and nothing after it.
                let Some(closed) = closed else { break };
                rest = &quoted[closed..];
                rest = &rest[rest.find(';').unwrap_or(rest.len())..];
                unquoted
            }
            None => {
                let end = value.find(';').unwrap_or(value.len());
                rest = &value[end..];
                value[..end].trim_end_matches(ows).to_string()
            }
        };
        if charset.is_none() && key.trim_end_matches(ows).eq_ignore_ascii_case("charset") {
            charset = Some(value);
        }
    }
    charset.is_none_or(|charset| charset.eq_ignore_ascii_case("utf-8"))
}

// The body as express.json() reads it: said to be JSON in UTF-8, not
// compressed, within the limit, an object or a list. Err: the answer to a
// body read another way (what express.json's errors come to, worded as the
// mail's routes word them); a body not said to be JSON, or empty, is no
// services.
fn read_body(asked: &Asked<'_>) -> Result<serde_json::Value, http::Response<Vec<u8>>> {
    let refused = |status: u16, error: &str| json_response(status, serde_json::to_vec(&serde_json::json!({ "error": error })).unwrap_or_default());
    let Some(content_type) = asked.headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()) else { return Ok(serde_json::Value::Null) };
    if !content_type.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("application/json") {
        return Ok(serde_json::Value::Null);
    }
    let mut encodings = asked.headers.get_all(CONTENT_ENCODING).iter();
    let encoded = encodings.next().is_some_and(|encoding| !encoding.as_bytes().eq_ignore_ascii_case(b"identity")) || encodings.next().is_some();
    if !is_json_in_utf8(content_type) || encoded {
        return Err(refused(415, "Unsupported charset."));
    }
    if asked.body.len() > MAX_BODY_BYTES {
        return Err(refused(413, "Request body too large."));
    }
    let body = asked.body.strip_prefix(b"\xef\xbb\xbf").unwrap_or(asked.body);
    if body.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(body) if body.is_object() || body.is_array() => Ok(body),
        _ => Err(refused(400, "Invalid JSON.")),
    }
}

// --- The file ----------------------------------------------------------------------

// A service written down: its concept (or an icon an admin pinned), its
// hue, its title and the day it was first seen (to make the file readable).
struct Entry {
    icon: String,
    color: String,
    title: Utf16,
    assigned_at: Utf16,
}

// One university's picks: createAppIconStore.
struct Store {
    file: PathBuf,
    university: String,
    entries: HashMap<String, Entry>,
    loaded: bool,
    // When the file was last read or written here; None: there was none.
    modified: Option<SystemTime>,
    // Off once the file couldn't be read, parsed or written: in memory from
    // then on, as Node.
    persistent: bool,
}

// The file's time; None when there is none.
fn modified(file: &Path) -> std::io::Result<Option<SystemTime>> {
    match std::fs::metadata(file) {
        Ok(metadata) => metadata.modified().map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

// An id as JavaScript orders an object's keys: an array index (« 0 », « 12 »,
// below 2³² − 1) comes first, by its value.
fn index_of(key: &str) -> Option<u64> {
    let canonical = key == "0" || (!key.starts_with('0') && !key.is_empty() && key.len() <= 10 && key.bytes().all(|byte| byte.is_ascii_digit()));
    key.parse::<u64>().ok().filter(|index| canonical && *index < u64::from(u32::MAX))
}

// Ids in the order an object built in their order gives them back.
fn in_object_order<'a>(ids: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
    let (mut indexes, others): (Vec<&str>, Vec<&str>) = ids.into_iter().partition(|id| index_of(id).is_some());
    indexes.sort_by_key(|id| index_of(id));
    indexes.extend(others);
    indexes
}

static WRITES: AtomicU64 = AtomicU64::new(0);

impl Store {
    fn new(data_dir: &Path, university: &str) -> Self {
        Self { file: data_dir.join("app-icons").join(format!("{university}.json")), university: university.to_string(), entries: HashMap::new(), loaded: false, modified: None, persistent: true }
    }

    fn stop_persisting(&mut self, why: &str, error: &dyn std::fmt::Display) {
        if self.persistent {
            eprintln!("[tafac] icons: {why} ({}): {error}. Icons are kept in memory only.", self.file.display());
        }
        self.persistent = false;
    }

    // Read on first use, and again whenever the file's time changes: an
    // admin may edit it, or delete it to start again, and Node writes it too.
    fn load_if_changed(&mut self) {
        if !self.persistent && self.loaded {
            return;
        }
        let modified = match modified(&self.file) {
            Ok(modified) => modified,
            Err(error) => {
                self.stop_persisting("cannot read the icon file", &error);
                self.loaded = true;
                return;
            }
        };
        if self.loaded && modified == self.modified {
            return;
        }
        self.entries.clear();
        self.modified = modified;
        self.loaded = true;
        if modified.is_none() {
            return;
        }
        let read = std::fs::read(&self.file).map_err(|error| error.to_string()).and_then(|bytes| {
            let text = js::json_with_lone_halves_stood_in(&String::from_utf8_lossy(&bytes));
            serde_json::from_str::<serde_json::Value>(&text).map_err(|error| error.to_string())
        });
        let file = match read {
            Ok(file) => file,
            Err(error) => return self.stop_persisting("cannot parse the icon file", &error),
        };
        // `services`, as Object.entries reads it: a list's items by index.
        let services: Vec<(String, &serde_json::Value)> = match file.get("services") {
            Some(serde_json::Value::Object(services)) => services.iter().map(|(id, entry)| (id.clone(), entry)).collect(),
            Some(serde_json::Value::Array(services)) => services.iter().enumerate().map(|(index, entry)| (index.to_string(), entry)).collect(),
            _ => Vec::new(),
        };
        let data = data();
        for (id, entry) in services {
            let text = |name: &str| entry.get(name).and_then(serde_json::Value::as_str);
            let (Some(icon), Some(color)) = (text("icon"), text("color")) else { continue };
            if !is_service_id(&id) || !is_valid_entry(icon, color) {
                continue;
            }
            let units = |name: &str, length: usize| text(name).map(|text| js::units_prefix(&js::units_with_lone_halves(text), length)).unwrap_or_default();
            let entry = Entry { icon: icon.to_string(), color: color.to_string(), title: units("title", data.max_title_length), assigned_at: units("assignedAt", 10) };
            self.entries.insert(id, entry);
        }
    }

    // The file as JSON.stringify(…, null, 2) writes it, the services in
    // the ids' order.
    fn text(&self) -> String {
        let mut ids: Vec<&str> = self.entries.keys().map(String::as_str).collect();
        ids.sort_by(|a, b| compare_ids(a, b));
        let mut text = format!("{{\n  \"version\": {},\n  \"university\": ", data().file_version);
        js::write_json_str(&mut text, &self.university);
        text.push_str(",\n  \"services\": {");
        for (index, id) in in_object_order(ids).into_iter().enumerate() {
            let entry = &self.entries[id];
            text.push_str(if index == 0 { "\n    " } else { ",\n    " });
            js::write_json_str(&mut text, id);
            text.push_str(": {\n      \"icon\": ");
            js::write_json_str(&mut text, &entry.icon);
            text.push_str(",\n      \"color\": ");
            js::write_json_str(&mut text, &entry.color);
            text.push_str(",\n      \"title\": ");
            js::write_json_units(&mut text, &entry.title);
            text.push_str(",\n      \"assignedAt\": ");
            js::write_json_units(&mut text, &entry.assigned_at);
            text.push_str("\n    }");
        }
        text.push_str(if self.entries.is_empty() { "}\n}\n" } else { "\n  }\n}\n" });
        text
    }

    // Written whole beside the file, then renamed over it: a reader sees
    // the old one or the new one, never half of it.
    fn save(&mut self) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
        let temporary = PathBuf::from(format!("{}.{}-{nanos}-{}.tmp", self.file.display(), std::process::id(), WRITES.fetch_add(1, Atomic::Relaxed)));
        let written = (|| {
            if let Some(folder) = self.file.parent() {
                std::fs::create_dir_all(folder)?;
            }
            std::fs::write(&temporary, self.text())?;
            std::fs::rename(&temporary, &self.file)?;
            modified(&self.file)
        })();
        match written {
            Ok(modified) => self.modified = modified,
            Err(error) => {
                let _ = std::fs::remove_file(&temporary);
                self.stop_persisting("cannot write the icon file", &error);
            }
        }
    }

    // resolve: each service's icon and hue, in the ids' order. A service
    // already written down keeps its own; a new one is picked, written
    // down while there is room, and its hue counted for the next.
    // `today`: the day a new one is first seen (YYYY-MM-DD).
    fn resolve(&mut self, services: &[Service], today: &str) -> Vec<(String, String, String)> {
        self.load_if_changed();
        let data = data();
        let mut usage: HashMap<String, usize> = HashMap::new();
        for entry in self.entries.values() {
            *usage.entry(entry.color.clone()).or_default() += 1;
        }
        let mut sorted: Vec<&Service> = services.iter().collect();
        sorted.sort_by(|a, b| compare_ids(&a.id, &b.id));

        let mut picks = Vec::with_capacity(sorted.len());
        let mut changed = false;
        for service in sorted {
            if let Some(existing) = self.entries.get(&service.id) {
                let icon = brand(&service.title).filter(|_| !is_pinned(&existing.icon)).unwrap_or(existing.icon.as_str());
                picks.push((service.id.clone(), icon.to_string(), existing.color.clone()));
                continue;
            }
            let remembered = self.entries.len() < data.max_stored_services;
            let (icon, color) = assign(service, remembered.then_some(&usage));
            if remembered {
                let entry = Entry { icon: icon.clone(), color: color.clone(), title: service.title.clone(), assigned_at: today.encode_utf16().collect() };
                self.entries.insert(service.id.clone(), entry);
                *usage.entry(color.clone()).or_default() += 1;
                changed = true;
            }
            picks.push((service.id.clone(), icon, color));
        }
        if changed && self.persistent {
            self.save();
        }
        picks
    }
}

// --- The route ---------------------------------------------------------------------

// Every university's picks, each one's file read and written one request
// at a time: two first visits at once agree on the same tiles.
pub(crate) struct Icons {
    data_dir: PathBuf,
    stores: Mutex<BTreeMap<String, Arc<Mutex<Store>>>>,
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

impl Icons {
    // `data_dir`: DATA_DIR, as Node is given it.
    pub(crate) fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self { data_dir: data_dir.into(), stores: Mutex::new(BTreeMap::new()) }
    }

    // The answer for a session of `university`; None: Node's to give.
    pub(crate) fn answer(&self, university: &str, asked: &Asked<'_>) -> Option<http::Response<Vec<u8>>> {
        self.answer_on(university, asked, &today())
    }

    fn answer_on(&self, university: &str, asked: &Asked<'_>, today: &str) -> Option<http::Response<Vec<u8>>> {
        let data = data();
        let theme = data.themes.get(university)?;
        let palette = data.color_modes.get(&theme.color_mode).filter(|palette| data.hues.iter().all(|hue| palette.contains_key(hue)))?;
        let body = match read_body(asked) {
            Ok(body) => body,
            Err(refused) => return Some(refused),
        };
        let Some(services) = sanitize(&body) else { return Some(json_response(400, WRONG_SHAPE.as_bytes().to_vec())) };

        let store = {
            let mut stores = self.stores.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            stores.entry(university.to_string()).or_insert_with(|| Arc::new(Mutex::new(Store::new(&self.data_dir, university)))).clone()
        };
        let picks = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).resolve(&services, today);

        // { ok, palette, icons }, as res.json writes it: the palette in the
        // hues' order, the icons in the ids'.
        let mut text = String::from(r#"{"ok":true,"palette":{"#);
        for (index, hue) in data.hues.iter().enumerate() {
            let pair = &palette[hue];
            text.push_str(if index == 0 { "" } else { "," });
            js::write_json_str(&mut text, hue);
            for (index, (mode, shades)) in [("light", &pair.light), ("dark", &pair.dark)].into_iter().enumerate() {
                text.push_str(if index == 0 { ":{" } else { "," });
                text.push_str(&format!(r#""{mode}":{{"bg":"#));
                js::write_json_str(&mut text, &shades.bg);
                text.push_str(r#","fg":"#);
                js::write_json_str(&mut text, &shades.fg);
                text.push('}');
            }
            text.push('}');
        }
        text.push_str(r#"},"icons":{"#);
        let by_id: HashMap<&str, (&str, &str)> = picks.iter().map(|(id, icon, color)| (id.as_str(), (icon.as_str(), color.as_str()))).collect();
        for (index, id) in in_object_order(picks.iter().map(|(id, _, _)| id.as_str())).into_iter().enumerate() {
            let (icon, color) = by_id[id];
            if index > 0 {
                text.push(',');
            }
            js::write_json_str(&mut text, id);
            text.push_str(r#":{"icon":"#);
            js::write_json_str(&mut text, iconify(icon, theme));
            text.push_str(r#","color":"#);
            js::write_json_str(&mut text, color);
            text.push('}');
        }
        text.push_str("}}");
        Some(json_response(200, text.into_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use http::{HeaderMap, HeaderValue, Method};

    use super::*;

    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/app-icon-picks.json");

    // Half of a pair is in it (a title cut inside an emoji), which
    // serde_json reads as the files are read.
    fn fixture() -> serde_json::Value {
        serde_json::from_str(&js::json_with_lone_halves_stood_in(FIXTURE)).unwrap()
    }

    fn service(picked: &serde_json::Value) -> Service {
        let units = |name: &str| picked[name].as_str().unwrap_or_default().encode_utf16().collect();
        Service { id: picked["id"].as_str().unwrap().to_string(), title: units("title"), description: units("description"), category: units("category") }
    }

    fn json_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers
    }

    fn post<'a>(headers: &'a HeaderMap, body: &'a [u8]) -> Asked<'a> {
        static POST: Method = Method::POST;
        Asked { method: &POST, path: "/__ent_auth/app-icons", query: None, headers, body, peer: None }
    }

    // A folder of its own for each test, gone after it.
    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("tafac-gateway-icons-{name}-{}-{}", std::process::id(), WRITES.fetch_add(1, Atomic::Relaxed)));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn file(&self, university: &str) -> PathBuf {
            self.0.join("app-icons").join(format!("{university}.json"))
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o700));
            }
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_patterns_are_the_ones_the_js_has() {
        // The two matchers above are these, written out: a change to either
        // in src/appIconPicks.js shows here once icons.json is written again.
        assert_eq!(data().service_pattern, "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$");
        assert_eq!(data().icon_name_pattern, "^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$");
        for id in ["a", "A0", "moodle-foad", "lent-iutlan-notes9", "x_y.z-1", &"x".repeat(64)] {
            assert!(is_service_id(id), "{id}");
        }
        for id in ["", "-a", "_a", ".a", "a b", "a/b", "é", &"x".repeat(65), "../etc"] {
            assert!(!is_service_id(id), "{id}");
        }
        for icon in ["mdi:school", "carbon:email", "devicon-plain:moodle", "a1:b-2-c"] {
            assert!(is_icon_name(icon), "{icon}");
        }
        for icon in ["mdi", "mdi:", ":x", "Mdi:x", "mdi:x:y", "mdi:-x", "mdi:x-", "mdi:x--y", "mdi x:y"] {
            assert!(!is_icon_name(icon), "{icon}");
        }
    }

    #[test]
    fn every_university_answered_here_has_its_look() {
        for university in crate::routes::UNIVERSITIES {
            let theme = &data().themes[*university];
            assert!(data().color_modes.contains_key(&theme.color_mode), "{university}");
            for concept in &data().concepts {
                assert!(theme.icons.contains_key(concept), "{university}: {concept}");
            }
        }
    }

    #[test]
    fn titles_fold_as_the_js_folds_them() {
        for case in fixture()["normalized"].as_array().unwrap() {
            assert_eq!(normalize(case[0].as_str().unwrap()), case[1].as_str().unwrap(), "{}", case[0]);
        }
    }

    #[test]
    fn a_service_gets_the_concept_and_the_hue_the_js_gives_it() {
        for picked in fixture()["picks"].as_array().unwrap() {
            let service = service(picked);
            assert_eq!(match_service(&service), picked["concept"].as_str(), "{picked}");
            assert_eq!(brand(&service.title), picked["brand"].as_str(), "{picked}");
            assert_eq!(u64::from(hash(&service.id)), picked["hash"].as_u64().unwrap(), "{picked}");
            let (icon, color) = assign(&service, None);
            assert_eq!((icon.as_str(), color.as_str()), (picked["assigned"]["icon"].as_str().unwrap(), picked["assigned"]["color"].as_str().unwrap()), "{picked}");
        }
        for case in fixture()["colors"].as_array().unwrap() {
            let usage: HashMap<String, usize> = case["usage"].as_object().unwrap().iter().map(|(hue, count)| (hue.clone(), count.as_u64().unwrap() as usize)).collect();
            assert_eq!(pick_color(case["id"].as_str().unwrap(), Some(&usage)), case["color"].as_str().unwrap(), "{case}");
        }
    }

    #[test]
    fn a_request_is_read_as_the_js_reads_it() {
        let units = |value: &serde_json::Value| js::units_with_lone_halves(value.as_str().unwrap());
        for case in fixture()["sanitized"].as_array().unwrap() {
            let read = sanitize(&case["body"]).map(|services| services.into_iter().map(|service| (service.id.encode_utf16().collect(), service.title, service.description, service.category)).collect::<Vec<_>>());
            let expected = case["services"].as_array().map(|services| services.iter().map(|service| (units(&service["id"]), units(&service["title"]), units(&service["description"]), units(&service["category"]))).collect::<Vec<_>>());
            assert_eq!(read, expected, "{}", case["body"]);
        }
    }

    #[test]
    fn ids_are_in_the_order_the_js_sorts_them() {
        let fixture = fixture();
        let sorted: Vec<&str> = fixture["sorted"].as_array().unwrap().iter().map(|id| id.as_str().unwrap()).collect();
        let mut mine = sorted.clone();
        mine.reverse();
        mine.sort_by(|a, b| compare_ids(a, b));
        assert_eq!(mine, sorted);
        assert_eq!(in_object_order(["b", "12", "a", "3", "007", "4294967295", "4294967294", "0"]), ["0", "3", "12", "4294967294", "b", "a", "007", "4294967295"]);
    }

    #[test]
    fn a_stored_icon_is_drawn_in_the_universitys_style() {
        for case in fixture()["iconify"].as_array().unwrap() {
            let theme = &data().themes[case["university"].as_str().unwrap()];
            let stored = case["stored"].as_str().unwrap();
            assert_eq!(iconify(stored, theme), case["name"].as_str().unwrap(), "{case}");
            assert_eq!(is_pinned(stored), case["pinned"].as_bool().unwrap(), "{case}");
        }
    }

    // Node's own route, on the files of the fixture: the same status, the
    // same body to the byte, and the same file after each request.
    #[test]
    fn the_route_answers_and_writes_as_nodes_does() {
        let fixture = fixture();
        let today = fixture["today"].as_str().unwrap();
        for (index, case) in fixture["routes"].as_array().unwrap().iter().enumerate() {
            let university = case["university"].as_str().unwrap();
            let folder = Folder::new(&format!("route-{index}"));
            if let Some(file) = case["file"].as_str() {
                std::fs::create_dir_all(folder.file(university).parent().unwrap()).unwrap();
                std::fs::write(folder.file(university), file).unwrap();
            }
            let icons = Icons::new(&folder.0);
            let headers = json_headers();
            for request in case["requests"].as_array().unwrap() {
                let body = request["body"].as_str().unwrap();
                let response = icons.answer_on(university, &post(&headers, body.as_bytes()), today).expect("answered here");
                assert_eq!(response.status(), request["status"].as_u64().unwrap() as u16, "{university} {body}");
                assert_eq!(String::from_utf8(response.body().clone()).unwrap(), request["answer"].as_str().unwrap(), "{university} {body}");
                assert_eq!(response.headers()["cache-control"], "no-store");
                assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
                assert_eq!(std::fs::read_to_string(folder.file(university)).ok().as_deref(), request["file"].as_str(), "{university} {body}");
            }
        }
    }

    #[test]
    fn a_body_node_reads_its_own_way_is_refused_here_and_nothing_written() {
        let folder = Folder::new("bodies");
        let icons = Icons::new(&folder.0);
        let with = |pairs: &[(&'static str, &'static str)]| {
            let mut headers = HeaderMap::new();
            for (name, value) in pairs {
                headers.append(*name, HeaderValue::from_static(value));
            }
            headers
        };
        let services = br#"{"services":[{"id":"mail","title":"Messagerie"}]}"#;
        for (headers, body) in [
            (with(&[]), &services[..]),
            (with(&[("content-type", "text/plain")]), &services[..]),
            (with(&[("content-type", "application/json; charset=latin1")]), &services[..]),
            (with(&[("content-type", "application/json; charset=utf-8 x")]), &services[..]),
            (with(&[("content-type", "application/json; charset=latin1; charset=utf-8")]), &services[..]),
            (with(&[("content-type", "application/json; charset=\"utf-16\"; charset=utf-8")]), &services[..]),
            (with(&[("content-type", "application/json; charset=utf8")]), &services[..]),
            (with(&[("content-type", "application/json-patch+json")]), &services[..]),
            (with(&[("content-type", "application/json"), ("content-encoding", "gzip")]), &services[..]),
            (json_headers(), &b""[..]),
            (json_headers(), &b"  "[..]),
            (json_headers(), &b"\"services\""[..]),
            (json_headers(), &b"7"[..]),
            (json_headers(), &b"{ broken"[..]),
            (json_headers(), &br#"{"services":[{"id":"a","title":"\ud83d"}]}"#[..]),
        ] {
            let answer = icons.answer_on("univ-rennes", &post(&headers, body), "2026-11-26").unwrap();
            assert!([400, 415].contains(&answer.status().as_u16()), "{headers:?} {}: {}", String::from_utf8_lossy(body), answer.status());
        }
        // Not said to be JSON, or empty: no services, in Node's words.
        for (headers, body) in [(with(&[]), &services[..]), (with(&[("content-type", "text/plain")]), &services[..]), (json_headers(), &b""[..])] {
            let answer = icons.answer_on("univ-rennes", &post(&headers, body), "2026-11-26").unwrap();
            assert_eq!((answer.status().as_u16(), answer.body().as_slice()), (400, WRONG_SHAPE.as_bytes()));
        }
        let charset = icons.answer_on("univ-rennes", &post(&with(&[("content-type", "application/json; charset=latin1")]), services), "2026-11-26").unwrap();
        assert_eq!((charset.status().as_u16(), charset.body().as_slice()), (415, &br#"{"error":"Unsupported charset."}"#[..]));
        let large = format!(r#"{{"services":[],"padding":"{}"}}"#, "x".repeat(MAX_BODY_BYTES));
        assert_eq!(icons.answer_on("univ-rennes", &post(&json_headers(), large.as_bytes()), "2026-11-26").unwrap().status(), 413);
        assert!(!folder.0.join("app-icons").join("univ-rennes.json").exists());
        // A byte order mark is taken off, as express.json does.
        let marked = icons.answer_on("univ-rennes", &post(&json_headers(), b"\xef\xbb\xbf{\"services\":[]}"), "2026-11-26").unwrap();
        assert_eq!(marked.status(), 200);
        // A university whose look isn't known here.
        assert!(icons.answer_on("univ-nowhere", &post(&json_headers(), services), "2026-11-26").is_none());

        // Read, in these ways: UTF-8 said, or nothing said; a list is JSON
        // too, but not the shape (400).
        for content_type in [
            "application/json; charset=utf-8",
            "Application/JSON;Charset=\"UTF-8\"",
            "application/json ; charset=UTF-8 ",
            "application/json; foo=bar",
            "\tapplication/json\t",
            "application/json; charset",
            "application/json;",
            "application/json;\tcharset=utf-8",
            "application/json; charset=utf-8; charset=utf-16",
            "application/json; charset=\"utf\\-8\"",
            "application/json; charset=\"utf-8\" anything; charset=latin1",
            "application/json; charset=\"latin1",
        ] {
            let headers = with(&[("content-type", content_type)]);
            let answered = icons.answer_on("univ-rennes", &post(&headers, services), "2026-11-26");
            assert_eq!(answered.map(|response| response.status()), Some(http::StatusCode::OK), "{content_type}");
        }
        let response = icons.answer_on("univ-rennes", &post(&json_headers(), b"[]"), "2026-11-26").unwrap();
        assert_eq!((response.status().as_u16(), response.body().as_slice()), (400, WRONG_SHAPE.as_bytes()));
    }

    #[test]
    fn past_the_limit_a_new_service_is_answered_and_not_written_down() {
        let folder = Folder::new("limit");
        let icons = Icons::new(&folder.0);
        let limit = data().max_stored_services;
        for start in (0..limit).step_by(data().max_request_services) {
            let services: Vec<serde_json::Value> = (start..limit.min(start + data().max_request_services)).map(|index| serde_json::json!({ "id": format!("s{index}"), "title": "Service" })).collect();
            let body = serde_json::json!({ "services": services }).to_string();
            icons.answer_on("univ-rennes", &post(&json_headers(), body.as_bytes()), "2026-11-26").unwrap();
        }
        let response = icons.answer_on("univ-rennes", &post(&json_headers(), br#"{"services":[{"id":"one-too-many","title":"Wifi"}]}"#), "2026-11-26").unwrap();
        let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(answer["icons"]["one-too-many"]["icon"], "ph:wifi-high-duotone");
        // Its hue is its id's own: nothing counted.
        assert_eq!(answer["icons"]["one-too-many"]["color"], pick_color("one-too-many", None));
        let file: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(folder.file("univ-rennes")).unwrap()).unwrap();
        assert_eq!(file["services"].as_object().unwrap().len(), limit);
        assert!(file["services"].get("one-too-many").is_none());
    }

    #[test]
    fn a_file_changed_on_disk_is_read_again_and_one_deleted_starts_over() {
        let folder = Folder::new("changed");
        let icons = Icons::new(&folder.0);
        let ask = |body: &[u8]| -> serde_json::Value { serde_json::from_slice(icons.answer_on("univ-rennes", &post(&json_headers(), body), "2026-11-26").unwrap().body()).unwrap() };
        ask(br#"{"services":[{"id":"annuaire","title":"Annuaire"}]}"#);
        // An admin pins another icon, Node or another process writes one more.
        let edited = r#"{"version":1,"university":"univ-rennes","services":{"annuaire":{"icon":"mdi:book","color":"teal","title":"Annuaire"},"wifi":{"icon":"wifi","color":"red"}}}"#;
        std::fs::write(folder.file("univ-rennes"), edited).unwrap();
        let file = std::fs::File::options().write(true).open(folder.file("univ-rennes")).unwrap();
        file.set_modified(SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
        let answer = ask(br#"{"services":[{"id":"annuaire","title":"Annuaire"},{"id":"wifi","title":"Wifi"}]}"#);
        assert_eq!(answer["icons"]["annuaire"], serde_json::json!({ "icon": "mdi:book", "color": "teal" }));
        assert_eq!(answer["icons"]["wifi"], serde_json::json!({ "icon": "ph:wifi-high-duotone", "color": "red" }));

        std::fs::remove_file(folder.file("univ-rennes")).unwrap();
        let answer = ask(br#"{"services":[{"id":"annuaire","title":"Annuaire"}]}"#);
        assert_eq!(answer["icons"]["annuaire"]["icon"], "ph:address-book-duotone");
        assert!(folder.file("univ-rennes").exists());
    }

    #[test]
    fn two_first_visits_at_once_agree_on_the_same_tiles() {
        let folder = Folder::new("together");
        let icons = Arc::new(Icons::new(&folder.0));
        let services: Vec<serde_json::Value> = (0..10).map(|index| serde_json::json!({ "id": format!("svc-{index}"), "title": format!("Service {index}") })).collect();
        let forwards = serde_json::json!({ "services": services }).to_string();
        let backwards = serde_json::json!({ "services": services.iter().rev().collect::<Vec<_>>() }).to_string();
        let answers: Vec<Vec<u8>> = [forwards, backwards]
            .into_iter()
            .map(|body| {
                let icons = icons.clone();
                std::thread::spawn(move || icons.answer_on("univ-rennes", &post(&json_headers(), body.as_bytes()), "2026-11-26").unwrap().into_body())
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(answers[0], answers[1]);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cant_be_written_keeps_the_picks_in_memory() {
        use std::os::unix::fs::PermissionsExt;
        let folder = Folder::new("read-only");
        std::fs::set_permissions(&folder.0, std::fs::Permissions::from_mode(0o500)).unwrap();
        // Root writes anywhere: nothing to see.
        if std::fs::write(folder.0.join("probe"), "").is_ok() {
            return;
        }
        let body = br#"{"services":[{"id":"demo-moodle","title":"Moodle"},{"id":"demo-messagerie","title":"Messagerie"}]}"#;
        let icons = Icons::new(&folder.0);
        let first = icons.answer_on("univ-rennes", &post(&json_headers(), body), "2026-11-26").unwrap().into_body();
        assert_eq!(icons.answer_on("univ-rennes", &post(&json_headers(), body), "2026-11-26").unwrap().into_body(), first);
        // Another process in the same place picks the same.
        assert_eq!(Icons::new(&folder.0).answer_on("univ-rennes", &post(&json_headers(), body), "2026-11-26").unwrap().into_body(), first);
        assert!(!folder.file("univ-rennes").exists());
    }
}
