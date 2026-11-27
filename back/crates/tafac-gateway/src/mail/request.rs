// A mail request as Node's middleware reads it before the route's own code:
// where it came from (Sec-Fetch-Site), its query's values, its JSON body,
// an upload's declared length. Each refusal is typed here; the status is
// the route's to choose.

use http::header::{CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, TRANSFER_ENCODING};
use http::HeaderMap;
use serde_json::Value;
use tonapi_providers::mail::text::trim_js;

// ── Where the request came from ─────────────────────────────────────────────

// Sec-Fetch-Site, as Node reads it on the mail routes that write
// (`fetchSite && fetchSite !== 'same-origin'`): its values joined with
// « , » when there are several, compared as they are written. None said, or
// an empty one, is a browser that doesn't say (an old one, the desktop
// bridge). « none », « Same-Origin » and a repeated header are another
// site's. Not launch/site.rs's rule, which allows « none » and ignores case.
pub(crate) fn from_another_site(headers: &HeaderMap) -> bool {
    let said: Vec<&[u8]> = headers.get_all("sec-fetch-site").iter().map(|value| value.as_bytes()).collect();
    let said = said.join(&b", "[..]);
    !said.is_empty() && said != b"same-origin"
}

// ── The query ───────────────────────────────────────────────────────────────

// One parameter of the query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum QueryValue {
    Absent,
    One(String),
    // Given twice (Express makes it a list), or with brackets (`id[]=1`,
    // `id[x]=1`, `[id]=1`: qs makes it a list or an object): never one of
    // the values a route accepts.
    Invalid,
}

impl QueryValue {
    // The value, when there is exactly one.
    pub(crate) fn one(&self) -> Option<&str> {
        match self {
            Self::One(value) => Some(value),
            _ => None,
        }
    }
}

// The parameter `name` of the query (what follows the path's « ? »), its
// key and value decoded as qs decodes them: « + » is a space, then
// percent-decoding as decodeURIComponent, or the text as written when that
// fails (a lone « % », bytes that aren't UTF-8).
pub(crate) fn query_value(query: Option<&str>, name: &str) -> QueryValue {
    let mut found = QueryValue::Absent;
    for part in query.unwrap_or_default().split('&').filter(|part| !part.is_empty()) {
        // qs splits at « ]= » when there is one, else at the first « = ».
        let at = part.find("]=").map(|at| at + 1).or_else(|| part.find('='));
        let (key, value) = match at {
            Some(at) => (&part[..at], &part[at + 1..]),
            None => (part, ""),
        };
        let key = qs_decode(key);
        if key == name {
            found = match found {
                QueryValue::Absent => QueryValue::One(qs_decode(value)),
                _ => QueryValue::Invalid,
            };
        } else if key.strip_prefix(name).is_some_and(|rest| rest.starts_with('[')) || key.strip_prefix('[').and_then(|rest| rest.strip_prefix(name)).is_some_and(|rest| rest.starts_with(']')) {
            found = QueryValue::Invalid;
        }
    }
    found
}

// qs's decoder: `+` as a space, then decodeURIComponent, or the text with
// its spaces only when that throws.
fn qs_decode(text: &str) -> String {
    let spaced = text.replace('+', " ");
    percent_decode(&spaced).unwrap_or(spaced)
}

// decodeURIComponent: every « % » followed by two hexadecimal digits, the
// bytes UTF-8 (no surrogate, no overlong form); else None.
fn percent_decode(text: &str) -> Option<String> {
    if !text.contains('%') {
        return Some(text.to_string());
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = (*bytes.get(index + 1)? as char).to_digit(16)?;
            let low = (*bytes.get(index + 2)? as char).to_digit(16)?;
            out.push(u8::try_from(high * 16 + low).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

// ── A JSON body ─────────────────────────────────────────────────────────────

// Why a body isn't read, as express.json would leave it (body-parser 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BodyRefusal {
    // No body said (neither Content-Length nor Transfer-Encoding), or
    // another type than application/json: Node leaves the body unread and
    // the route sees nothing. A cross-site « simple » POST (text/plain, a
    // form) is one.
    NotJson,
    // A charset other than UTF-8 (Node: 415).
    Charset,
    // Content-Encoding: Node would inflate it, and cap only what came out.
    // Never read here.
    Encoded,
    // Past the route's limit, declared or sent (Node: 413).
    TooLarge,
    // Sent too slowly: a minute without a byte, or five minutes in all
    // (Node's server: requestTimeout). 408, the connection closed.
    Slow,
    // Not JSON, or not an object or a list at its top (`strict`), or not the
    // length it declared (Node: 400).
    Malformed,
}

// Whether a body may be read at all, from its headers only: what a route
// checks before a byte of it is read. `limit` in bytes.
pub(crate) fn check_json_headers(headers: &HeaderMap, limit: usize) -> Result<(), BodyRefusal> {
    // type-is's hasBody.
    if !headers.contains_key(TRANSFER_ENCODING) && !headers.contains_key(CONTENT_LENGTH) {
        return Err(BodyRefusal::NotJson);
    }
    let Some(content_type) = headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()) else { return Err(BodyRefusal::NotJson) };
    let Some(media) = MediaType::parse(content_type) else { return Err(BodyRefusal::NotJson) };
    if media.essence != "application/json" {
        return Err(BodyRefusal::NotJson);
    }
    // UTF-8 when none is said; body-parser would also decode another
    // « utf-* », which the page never sends.
    if media.charset.is_some_and(|charset| charset != "utf-8") {
        return Err(BodyRefusal::Charset);
    }
    let mut encodings = headers.get_all(CONTENT_ENCODING).iter();
    if let Some(encoding) = encodings.next() {
        if encodings.next().is_some() || !(encoding.is_empty() || encoding.as_bytes().eq_ignore_ascii_case(b"identity")) {
            return Err(BodyRefusal::Encoded);
        }
    }
    if declared_length(headers).is_some_and(|length| length > limit as u64) {
        return Err(BodyRefusal::TooLarge);
    }
    Ok(())
}

// The body, read as express.json({ limit, strict: true }) reads it: its
// headers first (check_json_headers), its bytes UTF-8 (a byte order mark
// taken off, a byte that isn't UTF-8 a replacement character), nothing at
// all as `{}`, else an object or a list.
pub(crate) fn read_json(headers: &HeaderMap, body: &[u8], limit: usize) -> Result<Value, BodyRefusal> {
    check_json_headers(headers, limit)?;
    if body.len() > limit {
        return Err(BodyRefusal::TooLarge);
    }
    if declared_length(headers).is_some_and(|length| length != body.len() as u64) {
        return Err(BodyRefusal::Malformed);
    }
    let text = String::from_utf8_lossy(body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    if text.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let first = text.trim_start_matches([' ', '\t', '\n', '\r']).chars().next();
    if !matches!(first, Some('{' | '[')) {
        return Err(BodyRefusal::Malformed);
    }
    serde_json::from_str(text).map_err(|_| BodyRefusal::Malformed)
}

// Content-Length, when it is one number.
fn declared_length(headers: &HeaderMap) -> Option<u64> {
    let mut values = headers.get_all(CONTENT_LENGTH).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()?.trim().parse().ok()
}

// A Content-Type as the content-type package parses it: a type and a
// subtype of token characters, then `; name=value` parameters (a token, or
// a quoted string), nothing else. Lower case.
struct MediaType {
    essence: String,
    charset: Option<String>,
}

fn is_token(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&byte)
}

impl MediaType {
    fn parse(header: &str) -> Option<Self> {
        let (essence, mut rest) = match header.find(';') {
            Some(at) => (&header[..at], &header[at..]),
            None => (header, ""),
        };
        let essence = trim_js(essence);
        let (kind, subtype) = essence.split_once('/')?;
        if kind.is_empty() || subtype.is_empty() || !kind.bytes().all(is_token) || !subtype.bytes().all(is_token) {
            return None;
        }
        let mut charset = None;
        while !rest.is_empty() {
            rest = rest.strip_prefix(';')?.trim_start_matches(' ');
            let name_end = rest.bytes().position(|byte| !is_token(byte)).unwrap_or(rest.len());
            if name_end == 0 {
                return None;
            }
            let name = rest[..name_end].to_ascii_lowercase();
            rest = rest[name_end..].trim_start_matches(' ').strip_prefix('=')?.trim_start_matches(' ');
            let value = if let Some(quoted) = rest.strip_prefix('"') {
                let mut value = String::new();
                let mut chars = quoted.char_indices();
                let end = loop {
                    match chars.next()? {
                        (at, '"') => break at,
                        (_, '\\') => value.push(chars.next()?.1),
                        (_, c) if c == '\u{0b}' || (c >= ' ' && c != '\u{7f}') => value.push(c),
                        _ => return None,
                    }
                };
                rest = &quoted[end + 1..];
                value
            } else {
                let end = rest.bytes().position(|byte| !is_token(byte)).unwrap_or(rest.len());
                if end == 0 {
                    return None;
                }
                let value = rest[..end].to_string();
                rest = &rest[end..];
                value
            };
            rest = rest.trim_start_matches(' ');
            if name == "charset" {
                charset = Some(value.to_ascii_lowercase());
            }
        }
        Some(Self { essence: essence.to_ascii_lowercase(), charset })
    }
}

// ── An upload's length ──────────────────────────────────────────────────────

// The length an upload declares (readContentLength): Content-Length alone,
// 1 to 15 ASCII digits. None with a Transfer-Encoding, even beside a
// Content-Length (Node: 411), and for anything else.
pub(crate) fn upload_length(headers: &HeaderMap) -> Option<u64> {
    if headers.get_all(TRANSFER_ENCODING).iter().any(|value| !value.is_empty()) {
        return None;
    }
    let mut values = headers.get_all(CONTENT_LENGTH).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    let value = trim_js(value.to_str().ok()?);
    if value.is_empty() || value.len() > 15 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderValue;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(http::HeaderName::from_bytes(name.as_bytes()).unwrap(), HeaderValue::from_bytes(value.as_bytes()).unwrap());
        }
        headers
    }

    #[test]
    fn only_the_page_itself_or_a_browser_that_doesnt_say_writes() {
        assert!(!from_another_site(&headers(&[])));
        assert!(!from_another_site(&headers(&[("sec-fetch-site", "same-origin")])));
        // An empty one says nothing, as in Node.
        assert!(!from_another_site(&headers(&[("sec-fetch-site", "")])));
        for refused in ["cross-site", "same-site", "none", "Same-Origin", "same-origin ", " same-origin"] {
            assert!(from_another_site(&headers(&[("sec-fetch-site", refused)])), "{refused:?}");
        }
        // Said twice: joined, « same-origin, same-origin », refused.
        assert!(from_another_site(&headers(&[("sec-fetch-site", "same-origin"), ("sec-fetch-site", "same-origin")])));
    }

    #[test]
    fn a_query_value_given_twice_or_with_brackets_is_none_a_route_accepts() {
        assert_eq!(query_value(None, "id"), QueryValue::Absent);
        assert_eq!(query_value(Some("id=257&part=2"), "id"), QueryValue::One("257".into()));
        assert_eq!(query_value(Some("id=257&part=2"), "part").one(), Some("2"));
        assert_eq!(query_value(Some("ident=1"), "id"), QueryValue::Absent);
        assert_eq!(query_value(Some("id"), "id"), QueryValue::One(String::new()));
        assert_eq!(query_value(Some("&&id=&"), "id"), QueryValue::One(String::new()));
        for invalid in ["id=1&id=2", "id=1&id=1", "id[]=1", "id[0]=1", "id[x]=1", "[id]=1", "id%5B%5D=1", "id=1&id[]=2", "id[=1&id=2"] {
            assert_eq!(query_value(Some(invalid), "id"), QueryValue::Invalid, "{invalid}");
        }
        // Brackets on another name don't matter.
        assert_eq!(query_value(Some("x[id]=1&id=3"), "id"), QueryValue::One("3".into()));
    }

    #[test]
    fn a_query_is_decoded_as_qs_decodes_it() {
        assert_eq!(query_value(Some("q=l%C3%A9o+martin"), "q").one(), Some("léo martin"));
        assert_eq!(query_value(Some("q=a%2Bb"), "q").one(), Some("a+b"));
        assert_eq!(query_value(Some("%71=x"), "q").one(), Some("x"));
        // decodeURIComponent throws: the text as written, its « + » spaces.
        assert_eq!(query_value(Some("q=100%+sur"), "q").one(), Some("100% sur"));
        assert_eq!(query_value(Some("q=%E9t%C3%A9"), "q").one(), Some("%E9t%C3%A9"));
        assert_eq!(query_value(Some("q=%ED%A0%80"), "q").one(), Some("%ED%A0%80"));
        assert_eq!(query_value(Some("q=%4"), "q").one(), Some("%4"));
        // Unicode digits stay what they are: the routes' patterns refuse them.
        assert_eq!(query_value(Some("id=%D9%A1%D9%A2"), "id").one(), Some("١٢"));
    }

    fn json(content_type: Option<&str>, body: &str, limit: usize) -> Result<Value, BodyRefusal> {
        let length = body.len().to_string();
        let mut pairs = vec![("content-length", length.as_str())];
        if let Some(content_type) = content_type {
            pairs.push(("content-type", content_type));
        }
        read_json(&headers(&pairs), body.as_bytes(), limit)
    }

    #[test]
    fn a_json_body_as_express_json_reads_it() {
        let limit = 100 * 1024;
        assert_eq!(json(Some("application/json"), r#"{"a":1}"#, limit), Ok(serde_json::json!({ "a": 1 })));
        assert_eq!(json(Some("Application/JSON; charset=UTF-8"), "[1]", limit), Ok(serde_json::json!([1])));
        assert_eq!(json(Some(r#"application/json;charset="utf-8""#), " \n{}", limit), Ok(serde_json::json!({})));
        // Nothing at all is an empty object; a byte order mark goes.
        assert_eq!(json(Some("application/json"), "", limit), Ok(serde_json::json!({})));
        assert_eq!(json(Some("application/json"), "\u{feff}{\"a\":2}", limit), Ok(serde_json::json!({ "a": 2 })));
        // The last of two same keys, as JSON.parse.
        assert_eq!(json(Some("application/json"), r#"{"a":1,"a":2}"#, limit), Ok(serde_json::json!({ "a": 2 })));
        // Another type, a form, plain text, none: not read.
        for content_type in [None, Some("text/plain"), Some("application/x-www-form-urlencoded"), Some("multipart/form-data; boundary=x"), Some("application/json5"), Some("application/json; charset"), Some("application/json x")] {
            assert_eq!(json(content_type, "{}", limit), Err(BodyRefusal::NotJson), "{content_type:?}");
        }
        assert_eq!(json(Some("application/json; charset=latin1"), "{}", limit), Err(BodyRefusal::Charset));
        assert_eq!(json(Some("application/json; charset=utf-16le"), "{}", limit), Err(BodyRefusal::Charset));
        // `strict`: an object or a list only, and JSON.
        for malformed in ["{not json", "\"text\"", "12", "null", " ", "{\"a\":1} x"] {
            assert_eq!(json(Some("application/json"), malformed, limit), Err(BodyRefusal::Malformed), "{malformed:?}");
        }
        // Past the limit, declared or sent.
        assert_eq!(json(Some("application/json"), &format!("[\"{}\"]", "x".repeat(200)), 100), Err(BodyRefusal::TooLarge));
        let declared = headers(&[("content-type", "application/json"), ("content-length", "5000000")]);
        assert_eq!(check_json_headers(&declared, 2 * 1024 * 1024), Err(BodyRefusal::TooLarge));
        // Not the length it said.
        let short = headers(&[("content-type", "application/json"), ("content-length", "10")]);
        assert_eq!(read_json(&short, b"{}", limit), Err(BodyRefusal::Malformed));
        // No length said, no Transfer-Encoding: no body.
        assert_eq!(read_json(&headers(&[("content-type", "application/json")]), b"{}", limit), Err(BodyRefusal::NotJson));
        assert_eq!(read_json(&headers(&[("content-type", "application/json"), ("transfer-encoding", "chunked")]), b"{}", limit), Ok(serde_json::json!({})));
    }

    #[test]
    fn a_compressed_body_is_never_read() {
        let gzip = headers(&[("content-type", "application/json"), ("content-length", "2"), ("content-encoding", "gzip")]);
        assert_eq!(read_json(&gzip, b"{}", 100), Err(BodyRefusal::Encoded));
        let identity = headers(&[("content-type", "application/json"), ("content-length", "2"), ("content-encoding", "Identity")]);
        assert_eq!(read_json(&identity, b"{}", 100), Ok(serde_json::json!({})));
        let twice = headers(&[("content-type", "application/json"), ("content-length", "2"), ("content-encoding", "identity"), ("content-encoding", "gzip")]);
        assert_eq!(read_json(&twice, b"{}", 100), Err(BodyRefusal::Encoded));
    }

    #[test]
    fn an_uploads_length_is_digits_only() {
        let length = |value: &str| upload_length(&headers(&[("content-length", value)]));
        assert_eq!(length("1234"), Some(1234));
        assert_eq!(length(" 0 "), Some(0));
        for refused in ["", "-1", "1e6", "12, 12", "0x10", "+5", "١٢", &"9".repeat(16)] {
            assert_eq!(length(refused), None, "{refused:?}");
        }
        assert_eq!(upload_length(&headers(&[])), None);
        // Chunked, even with a length beside it.
        assert_eq!(upload_length(&headers(&[("content-length", "10"), ("transfer-encoding", "chunked")])), None);
        assert_eq!(upload_length(&headers(&[("content-length", "10"), ("content-length", "10")])), None);
    }
}
