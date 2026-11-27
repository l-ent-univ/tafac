// The universities this server serves, and the one a request is for.
//
// Node's own (server/universitiesApp.js, universities/index.js), answered
// here where the server tells the gateway what it serves (`Served`, from
// the same environment Node reads; the apps don't: there Node keeps these
// routes, which carry the apps' remote settings):
//
//   GET /__ent_auth/universities
//       200 { mode, defaultUniversity, session, host, universities: [{ id,
//       name, shortName, slug, logoUrl, logoShape, listed }] }. `session`:
//       the university the request is signed in to; `host`: the one its
//       address was once the own address of; `listed`: false for a
//       university shown on development servers only.
//   GET /__ent_auth/universities/<id>/logo
//       the logo, kept a day by the browser; 404 for a university that
//       isn't served or has none.
//
// What is known of each university comes from universities/directory.json,
// written from the settings Node reads (scripts/universities-directory.mjs,
// held to them by tests/universitiesDirectory.test.js), and the logos from
// the files themselves (build.rs): the gateway reads no JavaScript.
//
// Which university a request is for, as Node's resolveUniversity:
//
//   signed in    the session's, and nothing else
//   signed out   the choice of the login page (`X-Tafac-University`: an
//                id, an id without its dashes, a slug), then the address
//                (the old per-university ones), then the default
//
// Differences from Node: the logo's address is versioned by the file's
// content where Node's is by its date (the same file, the same address,
// whatever the server), and the logo is answered whole (no byte range).
// Still Node's: a request whose session cookie isn't read here (sealed
// with the secret before, or from before sessions named their university),
// since only Node knows what it holds.

use std::collections::HashMap;
use std::sync::LazyLock;

use http::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use http::HeaderMap;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::shell::PageText;
use crate::node::UNIVERSITY_HEADER;
use crate::translate::{answer, json_response};

// Written by build.rs: `LOGOS`, each university's logo file.
include!(concat!(env!("OUT_DIR"), "/logos.rs"));

const DIRECTORY_FILE: &str = include_str!("../../../../../universities/directory.json");
// universities/index.js: DEFAULT_UNIVERSITY_ID.
const DEFAULT_UNIVERSITY: &str = "univ-rennes";
// How long a browser keeps a logo (Node: maxAge '1d').
const LOGO_KEPT: &str = "public, max-age=86400";

#[derive(Deserialize)]
struct DirectoryFile {
    // Tafac's own text, where every university is served.
    neutral: PageText,
    universities: Vec<Entry>,
}

// What anyone may know of a university.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    short_name: String,
    slug: String,
    dev_only: bool,
    logo_shape: String,
    hostnames: Vec<String>,
    // What its page's shell is filled with (shell.rs).
    page: PageText,
}

static DIRECTORY_READ: LazyLock<DirectoryFile> = LazyLock::new(|| serde_json::from_str(DIRECTORY_FILE).expect("universities/directory.json is the script's own"));
static DIRECTORY: LazyLock<&'static [Entry]> = LazyLock::new(|| &DIRECTORY_READ.universities);

struct Logo {
    content_type: &'static str,
    bytes: &'static [u8],
    // Its address' `?v=`, and its ETag: a few bytes of its hash.
    version: String,
}

fn logo_of(id: &str) -> Option<Logo> {
    let (_, extension, bytes) = LOGOS.iter().find(|(university, _, _)| *university == id)?;
    let version = Sha256::digest(bytes).iter().take(6).map(|byte| format!("{byte:02x}")).collect();
    Some(Logo { content_type: logo_type(extension), bytes, version })
}

// A logo's Content-Type, from its file's extension (one of universities/index.js: LOGO_EXTENSIONS).
fn logo_type(extension: &str) -> &'static str {
    match extension {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

// The universities one server serves, as Node is set up.
#[derive(Clone)]
pub struct Served {
    multi: bool,
    default: String,
    // The default one first, then the others in the order they were given.
    entries: Vec<Entry>,
    // Whether the ones for development servers are listed.
    list_dev_only: bool,
    // An id, an id without its dashes, a slug → the id.
    by_name: HashMap<String, String>,
    by_host: HashMap<String, String>,
    // An id without its dashes (the first label of an old address) → the id.
    by_label: HashMap<String, String>,
}

const TRUE_VALUES: [&str; 4] = ["1", "true", "yes", "on"];
const FALSE_VALUES: [&str; 4] = ["0", "false", "no", "off"];

impl Served {
    // From the environment, as Node reads it (universities/index.js):
    //
    //   UNIVERSITY        the default university, `univ-rennes` without it
    //   MULTI_UNIVERSITY  whether every university is served (MULTI_TENANT:
    //                     its former name); without it, a set UNIVERSITY
    //                     means that university alone
    //   UNIVERSITIES      the ones served together (TENANTS: its former
    //                     name); without it, every one
    //
    // `variable`: a variable's value, None when it isn't set (set and
    // empty is set, as for Node's `??`). `list_dev_only`: on a development
    // server. An error where Node refuses to start: an unknown university.
    pub fn from_environment(variable: impl Fn(&str) -> Option<String>, list_dev_only: bool) -> Result<Self, String> {
        let university = variable("UNIVERSITY").unwrap_or_default();
        let default = known(&university)?;
        let flag = variable("MULTI_UNIVERSITY").or_else(|| variable("MULTI_TENANT")).unwrap_or_default().trim().to_lowercase();
        let multi = if TRUE_VALUES.contains(&flag.as_str()) {
            true
        } else if FALSE_VALUES.contains(&flag.as_str()) {
            false
        } else {
            university.trim().is_empty()
        };
        let listed = variable("UNIVERSITIES").or_else(|| variable("TENANTS")).unwrap_or_default();
        let named: Vec<&str> = listed.split(',').map(str::trim).filter(|id| !id.is_empty()).collect();
        let others = if named.is_empty() {
            DIRECTORY.iter().map(|entry| entry.id.clone()).collect()
        } else {
            named.into_iter().map(known).collect::<Result<Vec<_>, _>>()?
        };
        Ok(Self::new(multi, &default, &others, list_dev_only))
    }

    // `default`, `others`: ids of the directory (any other is left out).
    fn new(multi: bool, default: &str, others: &[String], list_dev_only: bool) -> Self {
        let mut ids = vec![default.to_string()];
        if multi {
            for id in others {
                if !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
        }
        let entries: Vec<Entry> = ids.iter().filter_map(|id| DIRECTORY.iter().find(|entry| &entry.id == id).cloned()).collect();
        let (mut by_name, mut by_host, mut by_label) = (HashMap::new(), HashMap::new(), HashMap::new());
        for entry in &entries {
            let without_dashes = entry.id.replace('-', "");
            by_label.insert(without_dashes.clone(), entry.id.clone());
            for hostname in &entry.hostnames {
                by_host.insert(hostname.to_lowercase(), entry.id.clone());
            }
            // The first university to bear a name keeps it.
            for name in [entry.id.clone(), without_dashes, entry.slug.clone()] {
                by_name.entry(name).or_insert_with(|| entry.id.clone());
            }
        }
        Self { multi, default: default.to_string(), entries, list_dev_only, by_name, by_host, by_label }
    }

    pub fn ids(&self) -> Vec<&str> {
        self.entries.iter().map(|entry| entry.id.as_str()).collect()
    }

    pub(crate) fn is_multi(&self) -> bool {
        self.multi
    }

    // The page's text: Tafac's own where every university is served, the
    // university's where it is the only one (server.js: pageBranding).
    pub(crate) fn page_text(&self) -> &PageText {
        match self.entries.first().filter(|_| !self.multi) {
            Some(only) => &only.page,
            None => &DIRECTORY_READ.neutral,
        }
    }

    // The universities with a page of their own, /<slug>, where every one
    // is served: each one's id, slug and text. Not the ones for development
    // servers.
    pub(crate) fn listed_pages(&self) -> Vec<(&str, &str, &PageText)> {
        self.entries.iter().filter(|entry| self.multi && !entry.dev_only).map(|entry| (entry.id.as_str(), entry.slug.as_str(), &entry.page)).collect()
    }

    // Whether a name is a served university's (findUniversityId).
    pub(crate) fn names(&self, name: &str) -> bool {
        self.named(name).is_some()
    }

    pub(crate) fn serves(&self, id: &str) -> bool {
        self.entries.iter().any(|entry| entry.id == id)
    }

    // An id or a slug of a served university (findUniversityId).
    fn named(&self, name: &str) -> Option<&str> {
        self.by_name.get(&name.trim().to_lowercase()).map(String::as_str)
    }

    // The university an address was once the own address of
    // (hostUniversityId): none where one university is served.
    fn of_host(&self, headers: &HeaderMap) -> Option<&str> {
        if !self.multi {
            return None;
        }
        let host = host_of(headers);
        self.by_host.get(&host).or_else(|| self.by_label.get(host.split('.').next().unwrap_or_default())).map(String::as_str)
    }

    // The university a request is for when nobody is signed in.
    pub(crate) fn for_nobody(&self, headers: &HeaderMap) -> &str {
        if !self.multi {
            return &self.default;
        }
        let chosen = headers.get(UNIVERSITY_HEADER).and_then(|value| value.to_str().ok()).and_then(|name| self.named(name));
        chosen.or_else(|| self.of_host(headers)).unwrap_or(&self.default)
    }

    // GET /__ent_auth/universities. `session`: the university the request
    // is signed in to, when it is one served here.
    pub(crate) fn list(&self, headers: &HeaderMap, session: Option<&str>) -> http::Response<Vec<u8>> {
        let universities: Vec<serde_json::Value> = self
            .entries
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "id": entry.id,
                    "name": entry.name,
                    "shortName": entry.short_name,
                    "slug": entry.slug,
                    "logoUrl": logo_of(&entry.id).map(|logo| format!("/__ent_auth/universities/{}/logo?v={}", entry.id, logo.version)),
                    "logoShape": entry.logo_shape,
                    "listed": self.list_dev_only || !entry.dev_only,
                })
            })
            .collect();
        let body = serde_json::json!({
            "mode": if self.multi { "multi" } else { "single" },
            "defaultUniversity": self.default,
            "session": session.filter(|id| self.serves(id)),
            "host": self.of_host(headers),
            "universities": universities,
        });
        json_response(200, serde_json::to_vec(&body).unwrap_or_default())
    }

    // GET /__ent_auth/universities/<id>/logo, for what follows the folder
    // in the path. None: no route of these (Node's to refuse).
    pub(crate) fn logo(&self, under: &str, headers: &HeaderMap) -> Option<http::Response<Vec<u8>>> {
        let id = under.strip_suffix("/logo").filter(|id| !id.is_empty() && !id.contains('/'))?;
        let Some(logo) = Some(id).filter(|id| self.serves(id)).and_then(logo_of) else {
            return Some(answer(404).body(Vec::new()).unwrap());
        };
        let tag = format!("\"{}\"", logo.version);
        let found = answer(200).header(CACHE_CONTROL, LOGO_KEPT).header(ETAG, &tag);
        // The browser has this very file: told so, nothing sent again.
        if headers.get(IF_NONE_MATCH).and_then(|value| value.to_str().ok()).is_some_and(|sent| sent.split(',').any(|one| one.trim().trim_start_matches("W/") == tag)) {
            return Some(found.status(304).body(Vec::new()).unwrap());
        }
        Some(found.header(CONTENT_TYPE, logo.content_type).body(logo.bytes.to_vec()).unwrap())
    }
}

// A university of the repository by its id (resolveUniversityId): the
// default one for an empty name, an error for one that isn't there.
fn known(id: &str) -> Result<String, String> {
    let id = Some(id.trim()).filter(|id| !id.is_empty()).unwrap_or(DEFAULT_UNIVERSITY);
    if DIRECTORY.iter().any(|entry| entry.id == id) {
        return Ok(id.to_string());
    }
    let available: Vec<&str> = DIRECTORY.iter().map(|entry| entry.id.as_str()).collect();
    Err(format!("unknown university \"{id}\" (available: {})", available.join(", ")))
}

// The request's host name as Node reads it (getRequestHost): the proxy's
// word first, without its port, in lower case.
fn host_of(headers: &HeaderMap) -> String {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok()).unwrap_or_default();
    let forwarded = header("x-forwarded-host").split(',').next().unwrap_or_default().trim();
    let host = if forwarded.is_empty() { header("host") } else { forwarded };
    host.split(':').next().unwrap_or_default().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variables(set: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let set: HashMap<String, String> = set.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect();
        move |name| set.get(name).cloned()
    }

    fn served(set: &[(&str, &str)]) -> Served {
        Served::from_environment(variables(set), false).unwrap()
    }

    fn headers(set: &[(&str, &str)]) -> HeaderMap {
        set.iter().map(|(name, value)| (http::HeaderName::from_bytes(name.as_bytes()).unwrap(), value.parse().unwrap())).collect()
    }

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_environment_says_what_is_served_as_it_says_to_node() {
        // Nothing set: every university, Rennes first.
        let all = served(&[]);
        assert!(all.multi);
        assert_eq!(all.ids(), ["univ-rennes", "univ-rennes-2", "univ-sorbonne-nouvelle"]);
        // UNIVERSITY alone: that one, and no other.
        let one = served(&[("UNIVERSITY", " univ-rennes-2 ")]);
        assert_eq!((one.multi, one.ids()), (false, vec!["univ-rennes-2"]));
        // MULTI_UNIVERSITY decides, whatever UNIVERSITY; MULTI_TENANT is its former name.
        let both = served(&[("UNIVERSITY", "univ-rennes-2"), ("MULTI_UNIVERSITY", "Yes"), ("UNIVERSITIES", "univ-rennes, univ-rennes-2,univ-rennes")]);
        assert_eq!((both.multi, both.ids()), (true, vec!["univ-rennes-2", "univ-rennes"]));
        assert!(!served(&[("MULTI_TENANT", "off")]).multi);
        assert_eq!(served(&[("MULTI_TENANT", "off")]).ids(), ["univ-rennes"]);
        // Set and empty is set: MULTI_TENANT isn't read behind it.
        assert!(served(&[("MULTI_UNIVERSITY", ""), ("MULTI_TENANT", "0")]).multi);
        assert_eq!(served(&[("TENANTS", "univ-sorbonne-nouvelle")]).ids(), ["univ-rennes", "univ-sorbonne-nouvelle"]);
        // An unknown university: Node doesn't start.
        assert!(Served::from_environment(variables(&[("UNIVERSITY", "univ-nowhere")]), false).is_err());
        assert!(Served::from_environment(variables(&[("UNIVERSITIES", "univ-rennes,../etc")]), false).is_err());
    }

    #[test]
    fn the_list_is_nodes_with_what_the_request_says_of_itself() {
        let all = served(&[]);
        let list = body(&all.list(&headers(&[("host", "UnivRennes2.tafac.fr:443")]), Some("univ-rennes")));
        assert_eq!((&list["mode"], &list["defaultUniversity"], &list["session"], &list["host"]), (&"multi".into(), &"univ-rennes".into(), &"univ-rennes".into(), &"univ-rennes-2".into()));
        let rennes2 = &list["universities"][1];
        // Every field of Node's publicEntry, and no other.
        assert_eq!(rennes2.as_object().unwrap().keys().collect::<Vec<_>>(), ["id", "listed", "logoShape", "logoUrl", "name", "shortName", "slug"]);
        assert_eq!((&rennes2["id"], &rennes2["shortName"], &rennes2["slug"], &rennes2["logoShape"], &rennes2["listed"]), (&"univ-rennes-2".into(), &"Rennes 2".into(), &"rennes2".into(), &"square".into(), &true.into()));
        assert!(rennes2["logoUrl"].as_str().unwrap().starts_with("/__ent_auth/universities/univ-rennes-2/logo?v="));
        // One for development servers is served, and not listed.
        assert_eq!((&list["universities"][2]["id"], &list["universities"][2]["listed"]), (&"univ-sorbonne-nouvelle".into(), &false.into()));
        assert_eq!(body(&Served::from_environment(variables(&[]), true).unwrap().list(&HeaderMap::new(), None))["universities"][2]["listed"], true);

        // A session at a university that isn't served is nobody's here; one
        // university alone has no address of its own to tell apart.
        let one = served(&[("UNIVERSITY", "univ-rennes")]);
        let list = body(&one.list(&headers(&[("host", "univrennes2.tafac.fr")]), Some("univ-rennes-2")));
        assert_eq!((&list["mode"], &list["session"], &list["host"]), (&"single".into(), &serde_json::Value::Null, &serde_json::Value::Null));
        assert_eq!(list["universities"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn nobody_signed_in_is_at_the_university_chosen_then_the_address_then_the_default() {
        let all = served(&[]);
        assert_eq!(all.for_nobody(&HeaderMap::new()), "univ-rennes");
        // The proxy's word for the address comes first; the port goes.
        assert_eq!(all.for_nobody(&headers(&[("host", "univrennes2.tafac.fr:8443")])), "univ-rennes-2");
        assert_eq!(all.for_nobody(&headers(&[("host", "tafac.fr"), ("x-forwarded-host", "univsorbonnenouvelle.tafac.fr, proxy")])), "univ-sorbonne-nouvelle");
        // The login page's choice: an id, an id without its dashes, a slug.
        for chosen in ["univ-rennes-2", " UnivRennes2 ", "rennes2"] {
            assert_eq!(all.for_nobody(&headers(&[("host", "univsorbonnenouvelle.tafac.fr"), ("x-tafac-university", chosen)])), "univ-rennes-2", "{chosen}");
        }
        // One that isn't served is no choice.
        let some = served(&[("UNIVERSITIES", "univ-rennes-2")]);
        assert_eq!(some.for_nobody(&headers(&[("x-tafac-university", "univ-sorbonne-nouvelle")])), "univ-rennes");
        // One university alone: that one, whatever is said.
        assert_eq!(served(&[("UNIVERSITY", "univ-rennes")]).for_nobody(&headers(&[("x-tafac-university", "rennes2")])), "univ-rennes");
    }

    #[test]
    fn a_logo_is_kept_a_day_and_not_sent_twice() {
        let all = served(&[]);
        let logo = all.logo("univ-rennes/logo", &HeaderMap::new()).unwrap();
        assert_eq!((logo.status(), &logo.headers()["content-type"], &logo.headers()["cache-control"]), (http::StatusCode::OK, &"image/svg+xml".parse().unwrap(), &"public, max-age=86400".parse().unwrap()));
        assert!(logo.body().starts_with(b"<") && logo.headers()["x-content-type-options"] == "nosniff");
        assert_eq!(["svg", "png", "webp", "jpg"].map(logo_type), ["image/svg+xml", "image/png", "image/webp", "image/jpeg"]);
        // The address the list gives is this file's.
        let tag = logo.headers()["etag"].to_str().unwrap().to_string();
        let listed = body(&all.list(&HeaderMap::new(), None))["universities"][0]["logoUrl"].as_str().unwrap().to_string();
        assert_eq!(listed, format!("/__ent_auth/universities/univ-rennes/logo?v={}", tag.trim_matches('"')));
        let again = all.logo("univ-rennes/logo", &headers(&[("if-none-match", &format!("W/{tag}"))])).unwrap();
        assert_eq!((again.status(), again.body().len()), (http::StatusCode::NOT_MODIFIED, 0));

        // One that isn't served, or has no logo: nothing. Any other path
        // under the folder is no route of these.
        assert_eq!(served(&[("UNIVERSITIES", "univ-rennes-2")]).logo("univ-sorbonne-nouvelle/logo", &HeaderMap::new()).unwrap().status(), 404);
        assert_eq!(all.logo("univ-nowhere/logo", &HeaderMap::new()).unwrap().status(), 404);
        for other in ["univ-rennes", "univ-rennes/logo/x", "/logo", "univ-rennes/photo"] {
            assert!(all.logo(other, &HeaderMap::new()).is_none(), "{other}");
        }
    }

    #[test]
    fn every_university_of_the_directory_has_the_logo_its_folder_holds() {
        let directory: serde_json::Value = serde_json::from_str(DIRECTORY_FILE).unwrap();
        for university in directory["universities"].as_array().unwrap() {
            let id = university["id"].as_str().unwrap();
            let extension = LOGOS.iter().find(|(logo, _, _)| *logo == id).map(|(_, extension, _)| *extension);
            assert_eq!(extension, university["logo"].as_str(), "{id}");
        }
    }
}
