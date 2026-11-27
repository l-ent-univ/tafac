// /__ent_proxy/*: what is left of Node's portal proxy (server/entProxy/).
//
// Node relayed the page's requests to the portal there: its API calls, the
// account's photo, and an address of the portal opened as a page. The page
// asks none of them any more: the applications are /__ent_auth/apps, the
// photo /__ent_auth/student-pic (src/profilePhoto.js). What still comes is
// an old link to a page of the portal's (a bookmark, a mail), which is sent
// on to the launch relay as Node sent it: opened under the portal's own
// address, signed in there with the CAS session. Everything else is
// refused, in Node's words.
//
// The request is read as Node's requestPolicy.ts read it, from the request
// alone:
//
//   the path       what follows /__ent_proxy, read strictly
//                  (portalPath.ts): 400 { error: 'Invalid portal path.' }
//   opened as a page   (Sec-Fetch-Mode: navigate, a page's destination, or
//                  without Fetch Metadata an Accept of text/html): a GET of
//                  the whole tab is sent to /__ent_auth/launch?url=<the
//                  portal's address>, whoever asks (the relay decides); a
//                  frame, or another method, 403 { error: 'Portal pages are
//                  not served here.' }
//   another site   403 { error: 'Cross-site request.' }
//   anything else  Node's relay, which is gone: without a session 401 {
//                  error: 'Authentication required.' }, as Node said, with
//                  one 403 { error: 'Not a portal request of this app.' }
//
// Every answer carries Node's hardening (no type guessed, nothing run,
// nothing kept, read by no other site), and, without a session, the word
// that there is none (nobody.rs).

use http::header::{HeaderValue, ACCEPT, CACHE_CONTROL, CONTENT_SECURITY_POLICY, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS};
use http::{HeaderMap, Method};
use serde_json::json;
use url::Url;

use super::{Asked, Gateway};
use crate::portals::Portal;
use crate::session::Held;
use crate::translate::{self, json_response};

const PREFIX: &str = "/__ent_proxy";
// portalPath.ts: MAX_LENGTH.
const MAX_LENGTH: usize = 2048;
// A page load, top-level or framed (Sec-Fetch-Dest).
const PAGE_DESTINATIONS: &[&str] = &["document", "iframe", "frame", "embed", "object", "fencedframe"];

// What follows /__ent_proxy, as Express gave it to the proxy (req.url): the
// path, then the query.
fn requested(asked: &Asked<'_>) -> String {
    let path = asked.path.strip_prefix(PREFIX).filter(|rest| !rest.is_empty()).unwrap_or("/");
    match asked.query {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    }
}

// portalPath.ts: readPortalPath. The path and its query, or None.
fn portal_path(requested: &str) -> Option<(&str, &str)> {
    if requested.len() > MAX_LENGTH || !requested.starts_with('/') || requested.starts_with("//") {
        return None;
    }
    if requested.chars().any(|character| character.is_whitespace() || character == '\\' || character == '#' || (character as u32) < 0x20 || character == '\u{7f}') {
        return None;
    }
    let (path, search) = match requested.find('?') {
        Some(at) => requested.split_at(at),
        None => (requested, ""),
    };
    let lower = path.to_ascii_lowercase();
    if path.contains("//") || ["%2e", "%2f", "%5c"].iter().any(|encoded| lower.contains(encoded)) {
        return None;
    }
    if path.split('/').any(|segment| segment == "." || segment == "..") {
        return None;
    }
    Some((path, search))
}

// A header as requestPolicy.ts reads it: its first value, trimmed, in lower case.
fn header(headers: &HeaderMap, name: &str) -> String {
    headers.get(name).and_then(|value| value.to_str().ok()).unwrap_or_default().trim().to_ascii_lowercase()
}

// encodeURIComponent.
fn encode_component(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn refused(status: u16, error: &str) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(&json!({ "error": error })).unwrap_or_default())
}

// Node's hardenAnswer, over the headers every answer has.
fn hardened(mut response: http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
    let headers = response.headers_mut();
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; sandbox"));
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert("cross-origin-resource-policy", HeaderValue::from_static("same-origin"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

impl Gateway {
    // A request of /__ent_proxy/*. `held`: the session it holds, None for
    // nobody (nobody.rs says so on the answer).
    pub(super) fn portal_proxy(&self, asked: &Asked<'_>, held: Option<&Held<'_>>) -> http::Response<Vec<u8>> {
        hardened(self.portal_proxied(asked, held))
    }

    fn portal_proxied(&self, asked: &Asked<'_>, held: Option<&Held<'_>>) -> http::Response<Vec<u8>> {
        let requested = requested(asked);
        let Some((path, search)) = portal_path(&requested) else { return refused(400, "Invalid portal path.") };
        let headers = asked.headers;
        let (site, mode, destination) = (header(headers, "sec-fetch-site"), header(headers, "sec-fetch-mode"), header(headers, "sec-fetch-dest"));
        let has_fetch_metadata = !mode.is_empty() || !destination.is_empty();
        let opens_page = mode == "navigate" || PAGE_DESTINATIONS.contains(&destination.as_str()) || (!has_fetch_metadata && header(headers, ACCEPT.as_str()).contains("text/html"));
        if opens_page {
            if asked.method != Method::GET || !(destination.is_empty() || destination == "document") {
                return refused(403, "Portal pages are not served here.");
            }
            let university = match held {
                Some(held) => held.session.university.clone(),
                None => self.university_for_nobody(headers),
            };
            let portal = self.universities.get(&university).and_then(|university| Some(Portal::of(&university.settings.university.portal)?.1.clone()));
            // The portal's address for that path: on the portal's own
            // origin, whatever the path holds (buildPortalUrl).
            let address = portal.and_then(|portal| {
                let origin = portal.origin().ascii_serialization();
                Url::parse(&format!("{origin}{path}{search}")).ok().filter(|url| url.origin().ascii_serialization() == origin)
            });
            return match address {
                Some(address) => translate::launch::redirect(&format!("/__ent_auth/launch?url={}", encode_component(address.as_str()))),
                None => translate::launch::redirect(translate::launch::APP_PATH),
            };
        }
        if !site.is_empty() && site != "same-origin" {
            return refused(403, "Cross-site request.");
        }
        match held {
            None => refused(401, "Authentication required."),
            Some(_) => refused(403, "Not a portal request of this app."),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_read_as_node_read_it() {
        assert_eq!(portal_path("/api/v4-3/dlm/layout.json?tab=1"), Some(("/api/v4-3/dlm/layout.json", "?tab=1")));
        assert_eq!(portal_path("/"), Some(("/", "")));
        for refused in ["", "api", "//elsewhere.test/x", "/a b", "/a\\b", "/a#b", "/a//b", "/a/%2e%2e/b", "/a/%2F", "/a/../b", "/./a", "/a\u{7f}"] {
            assert_eq!(portal_path(refused), None, "{refused:?}");
        }
        assert_eq!(portal_path(&format!("/{}", "a".repeat(MAX_LENGTH))), None);
    }

    #[test]
    fn an_address_is_encoded_as_encode_uri_component_does() {
        assert_eq!(encode_component("https://ent.exemple.test/f/welcome?a=1&b=é"), "https%3A%2F%2Fent.exemple.test%2Ff%2Fwelcome%3Fa%3D1%26b%3D%C3%A9");
        assert_eq!(encode_component("-_.!~*'()"), "-_.!~*'()");
    }
}
