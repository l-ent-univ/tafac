// The page's security headers, as server.js sets them on the HTML it sends
// (sendPage: /, /index.html, a university's /<slug>, any other address):
// the ones every answer carries (server/securityHeaders/baseline.ts), with
// the page's own Content-Security-Policy (pagePolicy.ts) in place of the
// baseline's « frame-ancestors 'self' ».
//
// The policy says what the page may load and run, so that an injected
// script, should one ever get in, neither runs nor sends anything out:
// scripts of the page's own and its inline ones by their hash, styles of
// its own and inline, images from anywhere over HTTP(S), requests to the
// page's API and the few public APIs it asks itself (CONNECT_SOURCES), its
// own frames, never framed by another site. Nothing here is looser than
// Node's, and a test holds each directive and each source to Node's file.
//
// For whoever serves the page here: page_headers(html) with the HTML as it
// is sent (an inline script's hash is of the page as it goes out). The
// rest of what Node sets on the page (its type, Content-Language, Vary,
// Link, X-Robots-Tag for /index.html) is the page's route's.

use base64::Engine;
use http::{HeaderMap, HeaderName, HeaderValue};
use sha2::{Digest, Sha256};

use crate::translate::BASELINE_HEADERS;

// Asked by the browser itself, without the server in between
// (CONNECT_SOURCES): the weather, the contributors in « À propos », and
// Iconify's API for an icon missing from the bundle, with its two
// fallbacks.
const CONNECT_SOURCES: &[&str] = &[
    "https://api.open-meteo.com",
    "https://geocoding-api.open-meteo.com",
    "https://nominatim.openstreetmap.org",
    "https://api.github.com",
    "https://api.iconify.design",
    "https://api.simplesvg.com",
    "https://api.unisvg.com",
];

// buildPagePolicy's directives, in its order. script-src and connect-src
// get their sources after them.
const DIRECTIVES: &[&str] = &[
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
];

// The headers Node sets on the page: every one of the baseline's, the
// policy the page's own.
pub fn page_headers(html: &str) -> HeaderMap {
    let mut headers = HeaderMap::with_capacity(BASELINE_HEADERS.len());
    for (name, value) in BASELINE_HEADERS {
        let value = if *name == "content-security-policy" { page_policy(html) } else { value.to_string() };
        headers.insert(HeaderName::from_static(name), HeaderValue::from_str(&value).expect("a policy is visible ASCII"));
    }
    headers
}

// buildPagePolicy.
pub(crate) fn page_policy(html: &str) -> String {
    let hashes = inline_script_hashes(html);
    let directives: Vec<String> = DIRECTIVES
        .iter()
        .map(|directive| match *directive {
            "script-src 'self'" => [*directive].into_iter().chain(hashes.iter().map(String::as_str)).collect::<Vec<_>>().join(" "),
            "connect-src 'self'" => [*directive].into_iter().chain(CONNECT_SOURCES.iter().copied()).collect::<Vec<_>>().join(" "),
            _ => directive.to_string(),
        })
        .collect();
    directives.join("; ")
}

// hashInlineScripts: the hash sources (« 'sha256-…' ») of the page's
// inline scripts, once each, in their order. A script the browser runs:
// one without `src`, with something in it, of no type or a JavaScript one
// (a data block, JSON-LD, needs none). What Node's regular expressions
// find, written out: « <script » as a word, case aside, up to the first
// « > », then up to the first « </script> ».
pub(crate) fn inline_script_hashes(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut hashes: Vec<String> = Vec::new();
    let mut from = 0;
    while let Some(found) = lower[from..].find("<script") {
        let start = from + found;
        let after = start + "<script".len();
        // \b: what follows isn't a word's (ASCII letters, digits, « _ »).
        let word_ends = lower.as_bytes().get(after).is_none_or(|next| !(next.is_ascii_alphanumeric() || *next == b'_'));
        let element = lower[after..].find('>').filter(|_| word_ends).and_then(|close| {
            let content = after + close + 1;
            lower[content..].find("</script>").map(|end| (&html[after..after + close], &html[content..content + end], content + end + "</script>".len()))
        });
        let Some((attributes, content, end)) = element else {
            from = start + 1;
            continue;
        };
        from = end;
        if attribute(attributes, "src").is_some() || content.is_empty() {
            continue;
        }
        if let Some(kind) = attribute(attributes, "type").filter(|kind| !kind.is_empty()) {
            let kind = super::js::trim(kind).to_ascii_lowercase();
            if !["module", "text/javascript", "text/ecmascript", "application/javascript", "application/ecmascript"].contains(&kind.as_str()) {
                continue;
            }
        }
        let hash = format!("'sha256-{}'", base64::engine::general_purpose::STANDARD.encode(Sha256::digest(content.as_bytes())));
        if !hashes.contains(&hash) {
            hashes.push(hash);
        }
    }
    hashes
}

// readAttribute: an attribute's value (quoted either way, or bare), "" for
// one without, None when the attribute isn't there. As Node's regular
// expression reads one: the name after the start or a space, case aside,
// then « = value » if it is followed by a space or the end, and the name
// alone if it is.
fn attribute<'a>(attributes: &'a str, name: &str) -> Option<&'a str> {
    let is_space = super::js::is_space;
    let ends_here = |at: usize| attributes[at..].chars().next().is_none_or(is_space);
    let starts: Vec<usize> = std::iter::once(0).chain(attributes.char_indices().filter(|(_, c)| is_space(*c)).map(|(at, c)| at + c.len_utf8())).collect();
    for start in starts {
        if !attributes.get(start..start + name.len()).is_some_and(|candidate| candidate.eq_ignore_ascii_case(name)) {
            continue;
        }
        let after_name = start + name.len();
        // « \s*=\s* » then the value, which a space or the end must follow.
        let rest = &attributes[after_name..];
        let before_equals = rest.len() - rest.trim_start_matches(is_space).len();
        if let Some(value_part) = rest[before_equals..].strip_prefix('=') {
            let value_at = after_name + before_equals + 1 + (value_part.len() - value_part.trim_start_matches(is_space).len());
            let value_text = &attributes[value_at..];
            let found = match value_text.chars().next() {
                Some(quote @ ('"' | '\'')) => value_text[1..].find(quote).map(|close| (&value_text[1..1 + close], value_at + 1 + close + 1)),
                Some(_) => {
                    let length = value_text.find(|c: char| is_space(c) || matches!(c, '"' | '\'' | '>')).unwrap_or(value_text.len());
                    (length > 0).then(|| (&value_text[..length], value_at + length))
                }
                None => None,
            };
            if let Some((value, _)) = found.filter(|(_, end)| ends_here(*end)) {
                return Some(value);
            }
        }
        if ends_here(after_name) {
            return Some("");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/static-files.json");

    #[test]
    fn the_policy_of_a_page_is_the_one_node_writes() {
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let pages = fixture["pagePolicies"].as_array().unwrap();
        assert!(pages.len() > 5);
        for page in pages {
            assert_eq!(page_policy(page[0].as_str().unwrap()), page[1].as_str().unwrap(), "{}", page[0]);
        }
    }

    #[test]
    fn the_page_carries_every_header_of_nodes_and_its_own_policy() {
        let html = "<script>theme()</script>";
        let headers = page_headers(html);
        assert_eq!(headers.len(), BASELINE_HEADERS.len());
        for (name, value) in BASELINE_HEADERS {
            let expected = if *name == "content-security-policy" { page_policy(html) } else { value.to_string() };
            assert_eq!(headers[*name], expected.as_str(), "{name}");
        }
        let policy = headers["content-security-policy"].to_str().unwrap();
        assert!(policy.starts_with("default-src 'self'; script-src 'self' 'sha256-"), "{policy}");
        assert!(policy.ends_with("; frame-ancestors 'self'"), "{policy}");
        for loose in ["'unsafe-eval'", " * ", "'unsafe-hashes'", "'strict-dynamic'"] {
            assert!(!policy.contains(loose), "{loose}");
        }
    }

    #[test]
    fn the_built_pages_one_inline_script_is_hashed() {
        // index.html, the page's template: its theme script, before first
        // paint (tests/securityHeaders.test.ts says the same of it).
        let page = include_str!("../../../../../index.html");
        assert_eq!(inline_script_hashes(page).len(), 1);
    }
}
