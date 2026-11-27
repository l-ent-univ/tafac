// What Express does around a route of Node's, which the server's own
// answers do the same way (server.js mounts their routers on its app, after
// the security headers):
//
//   the path      matched as Express 5's router matches it: the table's
//                 path in any case, with one slash after it or none; under
//                 a folder (« :platform »), one segment, decoded as Express
//                 decodes it. One that doesn't decode is left to Node, which
//                 answers it 400 with its own error page
//   the method    GET, and HEAD answered as GET without the body. Any other
//                 is left to Node (OPTIONS, which it answers itself; a POST,
//                 which it doesn't have)
//   the headers   every answer of Node's production server's
//                 (translate/mod.rs, BASELINE_HEADERS), the route's own, and
//                 x-tafac-answered-by: gateway, as every answer made here
//                 says who made it. Not Express's own two: X-Powered-By, and
//                 the weak ETag res.send computes (no answer of this crate
//                 has them); a request with If-None-Match gets the whole
//                 answer, never a 304
//   a redirect    res.redirect's: the address encoded as encodeurl does,
//                 Vary: Accept, and a body in what the request accepts
//                 (negotiator's choice between text and HTML), or none
//
// Held to what Node's own modules answered, recorded as fixtures.

use http::header::{ACCEPT, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, LOCATION, VARY};
use http::{HeaderMap, Method, Response};

use crate::routes::Servers;
#[cfg(feature = "server")]
use crate::routes::{Backend, ROUTES};
use crate::translate::{ANSWERED_BY, BASELINE_HEADERS};

// What an answer made by the server's own routes says it is.
const ANSWERED_BY_GATEWAY: &str = "gateway";

// A request for one of the server's own routes.
pub struct Asked<'a> {
    pub route: Servers,
    // Under a folder's line (« /desktop/download/* »): the segment, decoded.
    pub under: Option<String>,
    // HEAD: the answer's headers, without its body.
    pub head: bool,
    pub headers: &'a HeaderMap,
}

// The request, when it is one of the table's Backend::Server lines as
// Express matches it.
#[cfg(feature = "server")]
pub(crate) fn asked<'a>(method: &Method, path: &str, headers: &'a HeaderMap) -> Option<Asked<'a>> {
    let head = method == Method::HEAD;
    if method != Method::GET && !head {
        return None;
    }
    for route in ROUTES {
        let Backend::Server(served) = route.backend else { continue };
        if route.method != "GET" {
            continue;
        }
        match matched(route.path, path) {
            Matched::No => continue,
            Matched::Path => return Some(Asked { route: served, under: None, head, headers }),
            Matched::Under(segment) => return Some(Asked { route: served, under: Some(segment), head, headers }),
            // Node's to answer: a 400 of its error handler's.
            Matched::Undecodable => return None,
        }
    }
    None
}

#[cfg(feature = "server")]
enum Matched {
    No,
    Path,
    Under(String),
    Undecodable,
}

// path-to-regexp's match, as Express 5 asks it (not case-sensitive, not
// strict): « ^<path>(?:/$)?$ », a folder's segment « [^/]+ ».
#[cfg(feature = "server")]
fn matched(route: &str, path: &str) -> Matched {
    let path = path.strip_suffix('/').unwrap_or(path);
    match route.strip_suffix("/*") {
        None if path.eq_ignore_ascii_case(route) => Matched::Path,
        None => Matched::No,
        Some(folder) => {
            let prefix = folder.len() + 1;
            let starts = path.len() > prefix && path.as_bytes()[..folder.len()].eq_ignore_ascii_case(folder.as_bytes()) && path.as_bytes()[folder.len()] == b'/';
            match starts.then(|| &path[prefix..]).filter(|segment| !segment.contains('/')) {
                None => Matched::No,
                Some(segment) => decode_component(segment).map_or(Matched::Undecodable, Matched::Under),
            }
        }
    }
}

// decodeURIComponent: every « %XX » decoded, the whole read as UTF-8, and
// nothing for a « % » without two hex digits or bytes that aren't UTF-8.
#[cfg(feature = "server")]
fn decode_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = bytes.get(at + 1..at + 3).and_then(|pair| std::str::from_utf8(pair).ok()).filter(|pair| pair.bytes().all(|byte| byte.is_ascii_hexdigit()))?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            decoded.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

// An answer of the server's own, before the route's headers.
fn builder(status: u16) -> http::response::Builder {
    let mut builder = Response::builder().status(status);
    for (name, value) in BASELINE_HEADERS {
        builder = builder.header(*name, *value);
    }
    builder.header(ANSWERED_BY, ANSWERED_BY_GATEWAY)
}

// The body, or for HEAD its length alone, as Express's res.send and res.end
// do.
fn finished(asked: &Asked<'_>, builder: http::response::Builder, body: Vec<u8>) -> Response<Vec<u8>> {
    let builder = builder.header(CONTENT_LENGTH, body.len());
    builder.body(if asked.head { Vec::new() } else { body }).unwrap()
}

// res.status(404).end(): nothing.
pub(crate) fn nothing(asked: &Asked<'_>) -> Response<Vec<u8>> {
    finished(asked, builder(404), Vec::new())
}

// What Express answers a request no route took (finalhandler's 404): its
// page, « Cannot <method> <path> », with finalhandler's own headers. The
// server without Node gives it where Node's server would have (proxy.rs).
pub(crate) fn not_found(method: &Method, path: &str) -> Response<Vec<u8>> {
    let message = escape_html(&format!("Cannot {method} {}", encode_url(path))).replace("  ", " &nbsp;");
    let body = format!("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>{message}</pre>\n</body>\n</html>\n");
    let builder = builder(404).header(CONTENT_TYPE, "text/html; charset=utf-8");
    let mut response = finished(&Asked { route: Servers::Page, under: None, head: method == Method::HEAD, headers: &HeaderMap::new() }, builder, body.into_bytes());
    // finalhandler's own policy, over the baseline's.
    response.headers_mut().insert("content-security-policy", http::HeaderValue::from_static("default-src 'none'"));
    response
}

// res.setHeader('Cache-Control', …), then res.type(…).send(text): `kind` is
// a type Express gives its charset, as it does to a text.
pub(crate) fn text(asked: &Asked<'_>, cache: &'static str, kind: &str, body: String) -> Response<Vec<u8>> {
    let builder = builder(200).header(CACHE_CONTROL, cache).header(CONTENT_TYPE, format!("{kind}; charset=utf-8"));
    finished(asked, builder, body.into_bytes())
}

// res.setHeader('Cache-Control', …), then res.redirect(302, address).
pub(crate) fn found(asked: &Asked<'_>, cache: &'static str, address: &str) -> Response<Vec<u8>> {
    let location = encode_url(address);
    let mut builder = builder(302).header(CACHE_CONTROL, cache).header(LOCATION, &location).header(VARY, "Accept");
    let body = match accepted(asked.headers, &["text/plain", "text/html"]) {
        Some(0) => {
            builder = builder.header(CONTENT_TYPE, "text/plain; charset=utf-8");
            format!("Found. Redirecting to {location}")
        }
        Some(_) => {
            builder = builder.header(CONTENT_TYPE, "text/html; charset=utf-8");
            format!("<p>Found. Redirecting to {}</p>", escape_html(&location))
        }
        None => String::new(),
    };
    finished(asked, builder, body.into_bytes())
}

// encodeurl: what may not be in an address percent-encoded as encodeURI
// does (UTF-8, capitals), what already is left as it is, and a « % » that
// starts no escape written « %25 », with the one or two characters
// encodeurl's pattern takes with it.
pub(crate) fn encode_url(address: &str) -> String {
    let chars: Vec<char> = address.chars().collect();
    let allowed = |c: char| matches!(c, '!' | '#'..=';' | '=' | '?'..='_' | 'a'..='z' | '|' | '~');
    let hex = |at: usize| chars.get(at).is_some_and(char::is_ascii_hexdigit);
    let mut encoded = String::with_capacity(address.len());
    let mut at = 0;
    while at < chars.len() {
        let taken = if chars[at] != '%' {
            usize::from(!allowed(chars[at]))
        } else if at + 1 == chars.len() || !hex(at + 1) {
            // « %$ », « %[^hex] »
            (chars.len() - at).min(2)
        } else if at + 2 < chars.len() && !hex(at + 2) {
            // « %<hex>[^hex] »
            3
        } else {
            0
        };
        if taken == 0 {
            encoded.push(chars[at]);
            at += 1;
            continue;
        }
        for &c in &chars[at..at + taken] {
            encode_uri_char(c, &mut encoded);
        }
        at += taken;
    }
    encoded
}

// One character as encodeURI writes it.
fn encode_uri_char(c: char, into: &mut String) {
    if c.is_ascii_alphanumeric() || ";,/?:@&=+$-_.!~*'()#".contains(c) {
        into.push(c);
        return;
    }
    let mut buffer = [0_u8; 4];
    for byte in c.encode_utf8(&mut buffer).bytes() {
        into.push_str(&format!("%{byte:02X}"));
    }
}

// escape-html.
pub(crate) fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '"' => escaped.push_str("&quot;"),
            '&' => escaped.push_str("&amp;"),
            '\'' => escaped.push_str("&#39;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            c => escaped.push(c),
        }
    }
    escaped
}

// What req.accepts(types) chooses (accepts, negotiator's preferredMediaTypes):
// the index of the type the request prefers, None when it accepts none of
// them. No Accept, or an empty one, is the first type.
pub(crate) fn accepted(headers: &HeaderMap, types: &[&str]) -> Option<usize> {
    // Node reads a header as Latin-1, several of them joined.
    let accept: Vec<String> = headers.get_all(ACCEPT).iter().map(|value| value.as_bytes().iter().map(|&byte| char::from(byte)).collect()).collect();
    let accept = accept.join(", ");
    if accept.is_empty() {
        return Some(0);
    }
    let ranges: Vec<Range> = split_quoted(&accept, ',').iter().enumerate().filter_map(|(at, entry)| media_range(js_trim(entry), at)).collect();
    let priorities: Vec<Priority> = types
        .iter()
        .enumerate()
        .map(|(index, provided)| {
            let (kind, subtype) = provided.split_once('/').unwrap_or((provided, ""));
            let mut priority = Priority { o: -1.0, q: 0.0, s: 0.0, i: index as f64 };
            for range in &ranges {
                if let Some(spec) = specify(kind, subtype, range, index) {
                    if js_or(&[priority.s - spec.s, priority.q - spec.q, priority.o - spec.o]) < 0.0 {
                        priority = spec;
                    }
                }
            }
            priority
        })
        .collect();
    let mut accepted: Vec<&Priority> = priorities.iter().filter(|priority| priority.q > 0.0).collect();
    // Array.prototype.sort, stable, a comparison that is NaN counting as 0.
    accepted.sort_by(|a, b| {
        let order = js_or(&[b.q - a.q, b.s - a.s, a.o - b.o, a.i - b.i, 0.0]);
        order.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    accepted.first().map(|priority| priority.i as usize)
}

// One entry of an Accept header: « type/subtype;key=value;q=… ».
struct Range {
    kind: String,
    subtype: String,
    params: Vec<(String, String)>,
    q: f64,
    at: usize,
}

struct Priority {
    o: f64,
    q: f64,
    s: f64,
    i: f64,
}

// « ^\s*([^\s\/;]+)\/([^;\s]+)\s*(?:;(.*))?$ », and its parameters up to q.
fn media_range(entry: &str, at: usize) -> Option<Range> {
    let kind_end = entry.find(|c: char| is_js_space(c) || c == '/' || c == ';').unwrap_or(entry.len());
    let (kind, rest) = entry.split_at(kind_end);
    let rest = rest.strip_prefix('/').filter(|_| !kind.is_empty())?;
    let subtype_end = rest.find(|c: char| is_js_space(c) || c == ';').unwrap_or(rest.len());
    let (subtype, rest) = rest.split_at(subtype_end);
    let rest = rest.trim_start_matches(is_js_space);
    if subtype.is_empty() || !(rest.is_empty() || rest.starts_with(';')) {
        return None;
    }
    let mut range = Range { kind: kind.to_string(), subtype: subtype.to_string(), params: Vec::new(), q: 1.0, at };
    if let Some(parameters) = rest.strip_prefix(';').filter(|parameters| !parameters.is_empty()) {
        for parameter in split_quoted(parameters, ';') {
            let parameter = js_trim(&parameter);
            let (key, value) = match parameter.split_once('=') {
                Some((key, value)) => (key.to_lowercase(), Some(value)),
                None => (parameter.to_lowercase(), None),
            };
            let value = value.map(|value| if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') { &value[1..value.len() - 1] } else if value == "\"" { "" } else { value });
            if key == "q" {
                range.q = value.map_or(f64::NAN, parse_float);
                break;
            }
            let value = value.unwrap_or_default().to_string();
            match range.params.iter_mut().find(|(found, _)| *found == key) {
                Some(found) => found.1 = value,
                None => range.params.push((key, value)),
            }
        }
    }
    Some(range)
}

// How well a provided type fits an entry, when it does: 4 its type, 2 its
// subtype, 1 its parameters.
fn specify(kind: &str, subtype: &str, range: &Range, index: usize) -> Option<Priority> {
    let mut s = 0;
    if range.kind.eq_ignore_ascii_case(kind) {
        s |= 4;
    } else if range.kind != "*" {
        return None;
    }
    if range.subtype.eq_ignore_ascii_case(subtype) {
        s |= 2;
    } else if range.subtype != "*" {
        return None;
    }
    if !range.params.is_empty() {
        // The types provided have no parameters: only an empty value, or
        // « * », fits them.
        if range.params.iter().all(|(_, value)| value == "*" || value.is_empty()) {
            s |= 1;
        } else {
            return None;
        }
    }
    Some(Priority { o: range.at as f64, q: range.q, s: f64::from(s), i: index as f64 })
}

// JavaScript's « a || b || … » over numbers: the first that is neither 0
// nor NaN, else the last.
fn js_or(values: &[f64]) -> f64 {
    let (last, first) = values.split_last().unwrap_or((&0.0, &[]));
    first.iter().copied().find(|value| *value != 0.0 && !value.is_nan()).unwrap_or(*last)
}

// split(separator), the pieces joined back while a quote is open.
fn split_quoted(text: &str, separator: char) -> Vec<String> {
    let mut pieces: Vec<String> = Vec::new();
    for piece in text.split(separator) {
        match pieces.last_mut() {
            Some(last) if last.matches('"').count() % 2 == 1 => {
                last.push(separator);
                last.push_str(piece);
            }
            _ => pieces.push(piece.to_string()),
        }
    }
    pieces
}

// JavaScript's white space, as far as Latin-1 goes (a header's characters).
fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}')
}

fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

// parseFloat: the longest number at the start, NaN without one.
fn parse_float(text: &str) -> f64 {
    let text = text.trim_start_matches(is_js_space);
    let bytes = text.as_bytes();
    let mut end = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    if text[end..].starts_with("Infinity") {
        return if text.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let digits = |from: usize| bytes[from..].iter().take_while(|byte| byte.is_ascii_digit()).count();
    let whole = digits(end);
    end += whole;
    let mut fraction = 0;
    if bytes.get(end) == Some(&b'.') {
        fraction = digits(end + 1);
        if whole > 0 || fraction > 0 {
            end += 1 + fraction;
        }
    }
    if whole == 0 && fraction == 0 {
        return f64::NAN;
    }
    if matches!(bytes.get(end), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(bytes.get(end + 1), Some(b'+' | b'-')));
        let exponent = digits(end + 1 + sign);
        if exponent > 0 {
            end += 1 + sign + exponent;
        }
    }
    text[..end].parse().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use http::HeaderValue;

    use super::*;

    fn with_accept(accept: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(accept) = accept {
            headers.insert(ACCEPT, HeaderValue::from_str(accept).unwrap());
        }
        headers
    }

    #[test]
    fn a_path_is_matched_as_expresss_router_matches_it() {
        let headers = HeaderMap::new();
        let route = |method: Method, path: &str| asked(&method, path, &headers).map(|asked| (asked.route, asked.under, asked.head));
        assert_eq!(route(Method::GET, "/desktop/latest.json"), Some((Servers::DesktopManifest, None, false)));
        assert_eq!(route(Method::HEAD, "/desktop/latest.json"), Some((Servers::DesktopManifest, None, true)));
        // Any case, one slash after it.
        assert_eq!(route(Method::GET, "/Desktop/Latest.JSON/"), Some((Servers::DesktopManifest, None, false)));
        assert_eq!(route(Method::GET, "/APP/settings.json"), Some((Servers::AppSettings, None, false)));
        assert_eq!(route(Method::GET, "/app/settings.json.sig"), Some((Servers::AppSettingsSignature, None, false)));
        for path in ["/desktop/latest.json//", "/desktop//latest.json", "/desktop/latest%2Ejson", "/desktop/latest.jso", "/desktop/latest.json.sig", "/app/settings.json.sig.sig"] {
            assert_eq!(route(Method::GET, path), None, "{path}");
        }
        // Another method is Node's: OPTIONS it answers itself, POST it hasn't.
        assert_eq!(route(Method::POST, "/desktop/latest.json"), None);
        assert_eq!(route(Method::OPTIONS, "/desktop/latest.json"), None);

        // A folder's segment, decoded; one only, never empty.
        let under = |path: &str| route(Method::GET, path).map(|(_, under, _)| under);
        assert_eq!(under("/desktop/download/darwin-aarch64"), Some(Some("darwin-aarch64".to_string())));
        assert_eq!(under("/DESKTOP/download/darwin-aarch64/"), Some(Some("darwin-aarch64".to_string())));
        assert_eq!(under("/desktop/download/darwin%2Daarch64"), Some(Some("darwin-aarch64".to_string())));
        assert_eq!(under("/desktop/download/darwin-aarch64%2F"), Some(Some("darwin-aarch64/".to_string())));
        assert_eq!(under("/desktop/download/%C3%A9"), Some(Some("é".to_string())));
        for path in ["/desktop/download", "/desktop/download/", "/desktop/download//", "/desktop/download/a/b", "/desktop/downloads/a"] {
            assert_eq!(under(path), None, "{path}");
        }
        // One that doesn't decode: Node's 400.
        for path in ["/desktop/download/%E0", "/desktop/download/%zz", "/desktop/download/a%", "/desktop/download/%ED%A0%80"] {
            assert_eq!(under(path), None, "{path}");
        }
    }

    // Node's answers (accepts 2.0.0, negotiator 1.0.0, encodeurl,
    // escape-html, from this repository's node_modules) to the same.
    #[test]
    fn a_redirects_body_is_the_one_the_request_accepts_as_node_chooses_it() {
        let cases: &[(Option<&str>, Option<usize>)] = &[
            (None, Some(0)),
            (Some(""), Some(0)),
            (Some("*/*"), Some(0)),
            (Some("text/html"), Some(1)),
            (Some("text/plain"), Some(0)),
            (Some("application/json"), None),
            (Some("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), Some(1)),
            (Some("text/*"), Some(0)),
            (Some("text/*;q=0.5, text/html"), Some(1)),
            (Some("text/html;q=0.4, text/plain;q=0.5"), Some(0)),
            (Some("text/html;level=1"), None),
            (Some("text/html;level="), Some(1)),
            (Some("text/html;q=0"), None),
            (Some("*/*;q=0"), None),
            (Some("TEXT/HTML"), Some(1)),
            (Some("text/html;q=abc"), None),
            (Some("text/html;q=0.5abc, text/plain;q=0.4"), Some(1)),
            (Some("text/plain;q=1, text/html;q=1"), Some(0)),
            (Some("text/html, text/plain"), Some(1)),
            (Some("text/plain;format=flowed;q=0.9, text/html;q=0.8"), Some(1)),
            (Some("text/html;q=Infinity, text/plain;q=Infinity"), Some(1)),
            (Some("text/html;Q=0.1, text/plain"), Some(0)),
            (Some("bogus, text/html"), Some(1)),
            (Some("text/html ;q=0.3, */*;q=0.5"), Some(0)),
            (Some("text/html q=0.3"), None),
            (Some("\"a,b\"/c, text/html"), Some(1)),
            (Some("text/html;x=\"a;b\";q=0.2, text/plain;q=0.1"), Some(0)),
            (Some("*/html"), Some(1)),
            (Some("text/html, text/plain;q=0.9, */*"), Some(1)),
            (Some("text/plain;charset=*"), Some(0)),
            (Some("text/plain;q=-1, text/html;q=0.001"), Some(1)),
            (Some("image/*, text/html;q=0.01"), Some(1)),
            (Some(" text/html ,text/plain "), Some(1)),
        ];
        for (accept, chosen) in cases {
            assert_eq!(accepted(&with_accept(*accept), &["text/plain", "text/html"]), *chosen, "{accept:?}");
        }
    }

    #[test]
    fn an_address_is_encoded_as_encodeurl_encodes_it() {
        for (address, encoded) in [
            ("https://example.org/Tafac a&b<\"é.dmg", "https://example.org/Tafac%20a&b%3C%22%C3%A9.dmg"),
            ("https://e.org/%41%4", "https://e.org/%41%4"),
            ("https://e.org/%4z%zz%", "https://e.org/%254z%25zz%25"),
            ("https://e.org/%%41", "https://e.org/%25%2541"),
            ("https://e.org/%4%41", "https://e.org/%254%2541"),
            ("https://e.org/a b?c=d e#f g", "https://e.org/a%20b?c=d%20e#f%20g"),
            ("https://e.org/[x]{y}|^`\\~!'()*", "https://e.org/[x]%7By%7D|^%60\\~!'()*"),
            ("https://e.org/\u{1F600}", "https://e.org/%F0%9F%98%80"),
            ("https://e.org/\t\u{7f}", "https://e.org/%09%7F"),
        ] {
            assert_eq!(encode_url(address), encoded, "{address}");
        }
        assert_eq!(escape_html("a&b<c>\"d'e"), "a&amp;b&lt;c&gt;&quot;d&#39;e");
    }

    #[test]
    fn a_redirect_and_a_text_carry_nodes_headers() {
        let headers = with_accept(Some("text/html"));
        let get = Asked { route: Servers::DesktopInstaller, under: None, head: false, headers: &headers };
        let answer = found(&get, "no-cache", "https://example.org/Tafac a&b.dmg");
        assert_eq!(answer.status(), 302);
        assert_eq!(answer.headers()["location"], "https://example.org/Tafac%20a&b.dmg");
        assert_eq!(answer.headers()["vary"], "Accept");
        assert_eq!(answer.headers()["cache-control"], "no-cache");
        assert_eq!(answer.headers()["content-type"], "text/html; charset=utf-8");
        assert_eq!(answer.body(), b"<p>Found. Redirecting to https://example.org/Tafac%20a&amp;b.dmg</p>");
        assert_eq!(answer.headers()["content-length"], answer.body().len().to_string().as_str());
        assert_eq!(answer.headers()["x-frame-options"], "SAMEORIGIN");
        assert_eq!(answer.headers()[ANSWERED_BY], "gateway");
        assert!(answer.headers().get("x-robots-tag").is_none());

        // Neither text nor HTML accepted: no body, no type.
        let headers = with_accept(Some("application/json"));
        let answer = found(&Asked { headers: &headers, ..get }, "no-cache", "https://example.org/a.dmg");
        assert!(answer.body().is_empty() && answer.headers().get("content-type").is_none());
        assert_eq!(answer.headers()["content-length"], "0");

        // HEAD: the same headers, the length of a body that isn't sent.
        let headers = HeaderMap::new();
        let head = Asked { route: Servers::DesktopManifest, under: None, head: true, headers: &headers };
        let answer = text(&head, "no-cache", "application/json", "{\"version\":\"0.26.0\"}".to_string());
        assert_eq!(answer.headers()["content-type"], "application/json; charset=utf-8");
        assert_eq!(answer.headers()["content-length"], "20");
        assert!(answer.body().is_empty());
        let answer = nothing(&head);
        assert_eq!((answer.status(), answer.headers()["content-length"].to_str().unwrap()), (http::StatusCode::NOT_FOUND, "0"));
    }

    #[test]
    fn a_number_is_read_as_parse_float_reads_it() {
        for (text, read) in [("0.5", 0.5), (" 0.5abc", 0.5), (".5", 0.5), ("1.", 1.0), ("1e3", 1000.0), ("1e", 1.0), ("-1", -1.0), ("+2.5e-1x", 0.25), ("Infinity", f64::INFINITY), ("-Infinity", f64::NEG_INFINITY)] {
            assert_eq!(parse_float(text), read, "{text}");
        }
        for text in ["", "abc", ".", "-", "e5", "+.e1"] {
            assert!(parse_float(text).is_nan(), "{text}");
        }
    }
}
