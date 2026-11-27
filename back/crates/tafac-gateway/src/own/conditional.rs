// What Express and its static handler (serve-static, send, fresh, etag)
// make of a request and put in an answer, for the answers tafac.fr's server
// makes of its own (statics.rs): the request's headers as Node reads them,
// the ETags, the dates, whether a copy the browser holds is still good.
//
// Where Node would read what isn't read here (a date in another format
// than HTTP's own, which Date.parse may take), these say they don't know,
// and the request is Node's.

use base64::Engine;
use http::HeaderMap;

// A header as Node gives it to Express (req.headers): its bytes as
// Latin-1, and several of the same name as one, joined with « , », or the
// first only for the ones Node keeps one of. None: not there.
pub(crate) fn node_header(headers: &HeaderMap, name: &str) -> Option<String> {
    const FIRST_ONLY: &[&str] = &["if-modified-since", "if-unmodified-since", "content-type", "content-length", "user-agent", "referer", "host", "authorization", "from", "location", "max-forwards", "retry-after", "etag", "last-modified", "server", "age", "expires", "proxy-authorization"];
    let mut values = headers.get_all(name).iter().map(|value| value.as_bytes().iter().map(|&byte| byte as char).collect::<String>());
    let first = values.next()?;
    if FIRST_ONLY.contains(&name) {
        return Some(first);
    }
    Some(values.fold(first, |joined, value| format!("{joined}, {value}")))
}

// A header JavaScript would find « truthy »: there, and not empty.
pub(crate) fn said(headers: &HeaderMap, name: &str) -> Option<String> {
    node_header(headers, name).filter(|value| !value.is_empty())
}

// parseTokenList (fresh, send): the tokens between commas, spaces around
// them dropped.
pub(crate) fn token_list(text: &str) -> Vec<&str> {
    let (mut list, mut start, mut end) = (Vec::new(), 0, 0);
    for (index, byte) in text.bytes().enumerate() {
        match byte {
            b' ' if start == end => {
                start = index + 1;
                end = index + 1;
            }
            b' ' => {}
            b',' => {
                if start != end {
                    list.push(&text[start..end]);
                }
                start = index + 1;
                end = index + 1;
            }
            _ => end = index + 1,
        }
    }
    if start != end {
        list.push(&text[start..end]);
    }
    list
}

// Whether one of the tags matches the answer's, a weak one as a strong.
fn matches_etag(list: &str, etag: &str) -> bool {
    token_list(list).into_iter().any(|tag| tag == etag || format!("W/{etag}") == tag || format!("W/{tag}") == etag)
}

const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Date.prototype.toUTCString, of a time in milliseconds since the epoch:
// HTTP's own date (« Fri, 02 Jan 2026 03:04:06 GMT »).
pub(crate) fn http_date(ms: i64) -> String {
    use chrono::{Datelike, Timelike};
    let at = chrono::DateTime::from_timestamp_millis(ms).unwrap_or_default();
    format!("{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT", DAYS[at.weekday().num_days_from_sunday() as usize], at.day(), MONTHS[at.month0() as usize], at.year(), at.hour(), at.minute(), at.second())
}

// Date.parse, of HTTP's own date only, its weekday right: milliseconds
// since the epoch. None for anything else, which Date.parse may still read
// its own way.
pub(crate) fn parse_http_date(text: &str) -> Option<i64> {
    use chrono::Datelike;
    let bytes = text.as_bytes();
    if !text.is_ascii() || bytes.len() != 29 || &text[3..5] != ", " || text.as_bytes()[7] != b' ' || bytes[11] != b' ' || bytes[16] != b' ' || bytes[19] != b':' || bytes[22] != b':' || &text[25..] != " GMT" {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> { text.get(range).filter(|digits| digits.bytes().all(|byte| byte.is_ascii_digit()))?.parse().ok() };
    let month = MONTHS.iter().position(|month| *month == &text[8..11])? as u32 + 1;
    let date = chrono::NaiveDate::from_ymd_opt(number(12..16)? as i32, month, number(5..7)?)?;
    if DAYS[date.weekday().num_days_from_sunday() as usize] != &text[0..3] {
        return None;
    }
    let time = chrono::NaiveTime::from_hms_opt(number(17..19)?, number(20..22)?, number(23..25)?)?;
    Some(date.and_time(time).and_utc().timestamp_millis())
}

// fresh: whether the copy the request says it holds is still good, for an
// answer of this ETag and this date. None: a date Node reads that isn't
// read here.
pub(crate) fn fresh(request: &HeaderMap, etag: &str, last_modified: Option<&str>) -> Option<bool> {
    let modified_since = said(request, "if-modified-since");
    let none_match = said(request, "if-none-match");
    if modified_since.is_none() && none_match.is_none() {
        return Some(false);
    }
    // A reload asks for the file itself.
    if said(request, "cache-control").is_some_and(|control| control.split(',').any(|directive| super::js::trim(directive) == "no-cache")) {
        return Some(false);
    }
    if let Some(none_match) = none_match {
        return Some(none_match == "*" || matches_etag(&none_match, etag));
    }
    let Some(last_modified) = last_modified else { return Some(false) };
    Some(parse_http_date(last_modified)? <= parse_http_date(&modified_since?)?)
}

// send's isPreconditionFailure: an If-Match none of whose tags is the
// file's, or a file changed since If-Unmodified-Since. None: a date not
// read here.
pub(crate) fn precondition_fails(request: &HeaderMap, etag: &str, last_modified: &str) -> Option<bool> {
    if let Some(wanted) = said(request, "if-match") {
        return Some(wanted != "*" && !matches_etag(&wanted, etag));
    }
    match said(request, "if-unmodified-since") {
        Some(since) => Some(parse_http_date(last_modified)? > parse_http_date(&since)?),
        None => Some(false),
    }
}

// send's isRangeFresh: whether a Range still holds for this file, by its
// If-Range (an ETag, or a date). None: a date not read here.
pub(crate) fn range_fresh(request: &HeaderMap, etag: &str, last_modified: &str) -> Option<bool> {
    let Some(if_range) = said(request, "if-range") else { return Some(true) };
    if if_range.contains('"') {
        return Some(if_range.contains(etag));
    }
    Some(parse_http_date(last_modified)? <= parse_http_date(&if_range)?)
}

// The ETag send gives a file: its size and its time (in milliseconds, as
// Node rounds a file's time), weak.
pub(crate) fn file_etag(size: u64, modified_ms: i64) -> String {
    format!("W/\"{size:x}-{modified_ms:x}\"")
}

// A file's time as Node's fs.stat gives it in a Date: its milliseconds,
// computed in floating point as Node does, then rounded.
pub(crate) fn node_milliseconds(modified: std::time::SystemTime) -> i64 {
    let since = modified.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (since.as_secs() as f64 * 1e3 + f64::from(since.subsec_nanos()) / 1e6 + 0.5).floor() as i64
}

// The ETag Express gives an answer sent whole (res.send): its length and
// the start of its SHA-1, weak.
pub(crate) fn body_etag(body: &[u8]) -> String {
    let hash = base64::engine::general_purpose::STANDARD.encode(sha1(body));
    format!("W/\"{:x}-{}\"", body.len(), &hash[..27])
}

// SHA-1 (FIPS 180-4), for Express's ETags only: nothing is signed or
// trusted with it.
fn sha1(message: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476, 0xc3d2_e1f0];
    let mut padded = message.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&((message.len() as u64) * 8).to_be_bytes());
    for block in padded.chunks(64) {
        let mut words = [0_u32; 80];
        for (index, word) in block.chunks(4).enumerate() {
            words[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..80 {
            words[index] = (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let next = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (kept, added) in state.iter_mut().zip([a, b, c, d, e]) {
            *kept = kept.wrapping_add(added);
        }
    }
    let mut digest = [0_u8; 20];
    for (index, word) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

// decodeURIComponent: None where it throws (a « % » without two hex
// digits after it, bytes that aren't UTF-8 once decoded).
pub(crate) fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3).filter(|hex| hex.iter().all(u8::is_ascii_hexdigit))?;
            decoded.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use http::HeaderValue;

    use super::*;

    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/static-files.json");

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_static(value));
        }
        headers
    }

    #[test]
    fn an_answers_etag_is_expresss() {
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        for case in fixture["etags"].as_array().unwrap() {
            assert_eq!(body_etag(case[0].as_str().unwrap().as_bytes()), case[1].as_str().unwrap(), "{}", case[0]);
        }
        // FIPS 180's own examples.
        let hex = |digest: [u8; 20]| digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        assert_eq!(hex(sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hex(sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
        assert_eq!(hex(sha1(&[b'a'; 1_000_000])), "34aa973cd4c4daa4f61eeb2bdbad27316534016f");
    }

    #[test]
    fn a_date_is_https_own_both_ways() {
        let ms = parse_http_date("Fri, 02 Jan 2026 03:04:06 GMT").unwrap();
        assert_eq!(ms, 1_767_323_046_000);
        assert_eq!(http_date(ms + 999), "Fri, 02 Jan 2026 03:04:06 GMT");
        assert_eq!(http_date(0), "Thu, 01 Jan 1970 00:00:00 GMT");
        for unread in ["Sat, 02 Jan 2026 03:04:06 GMT", "Fri, 2 Jan 2026 03:04:06 GMT", "2026-01-02T03:04:06Z", "yesterday", "Fri, 02 Jan 2026 03:04:06 UTC", "Fré, 02 Jan 2026 03:04:06 GMT", "Mon, 31 Feb 2026 03:04:06 GMT", "Fri, 02 Jan 2026 24:00:00 GMT", ""] {
            assert_eq!(parse_http_date(unread), None, "{unread}");
        }
    }

    #[test]
    fn a_files_time_is_rounded_as_node_rounds_it() {
        let at = |nanos: u64| node_milliseconds(std::time::UNIX_EPOCH + std::time::Duration::from_nanos(nanos));
        assert_eq!(at(1_767_323_045_999_599_933), 1_767_323_046_000);
        assert_eq!(at(1_767_323_045_499_399_900), 1_767_323_045_499);
        assert_eq!(at(1_700_000_000_250_000_000), 1_700_000_000_250);
    }

    #[test]
    fn headers_are_read_as_node_reads_them() {
        let mut asked = headers(&[("if-none-match", "\"a\""), ("if-none-match", "\"b\""), ("if-modified-since", "first"), ("if-modified-since", "second")]);
        // A byte past ASCII is a Latin-1 character to Node.
        asked.insert("x-forwarded-host", HeaderValue::from_bytes(b"caf\xe9").unwrap());
        assert_eq!(node_header(&asked, "x-forwarded-host").as_deref(), Some("café"));
        assert_eq!(node_header(&asked, "if-none-match").as_deref(), Some("\"a\", \"b\""));
        assert_eq!(node_header(&asked, "if-modified-since").as_deref(), Some("first"));
        assert_eq!(node_header(&asked, "range"), None);
        assert_eq!(token_list(" a , b,,c  d ,"), ["a", "b", "c  d"]);
    }

    #[test]
    fn a_copy_is_fresh_as_fresh_says() {
        let etag = "W/\"16-19b7ca99070\"";
        let date = "Fri, 02 Jan 2026 03:04:06 GMT";
        let fresh_of = |pairs: &[(&'static str, &'static str)]| fresh(&headers(pairs), etag, Some(date));
        assert_eq!(fresh_of(&[]), Some(false));
        assert_eq!(fresh_of(&[("if-none-match", "*")]), Some(true));
        assert_eq!(fresh_of(&[("if-none-match", "\"16-19b7ca99070\"")]), Some(true));
        assert_eq!(fresh_of(&[("if-none-match", "\"other\""), ("if-modified-since", date)]), Some(false));
        assert_eq!(fresh_of(&[("if-none-match", etag), ("cache-control", "no-store, no-cache")]), Some(false));
        assert_eq!(fresh_of(&[("if-modified-since", "Sat, 03 Jan 2026 00:00:00 GMT")]), Some(true));
        assert_eq!(fresh_of(&[("if-modified-since", "Fri, 02 Jan 2026 03:04:05 GMT")]), Some(false));
        assert_eq!(fresh_of(&[("if-modified-since", "yesterday")]), None);
        // An answer without a date is never fresh by one.
        assert_eq!(fresh(&headers(&[("if-modified-since", "yesterday")]), etag, None), Some(false));
    }

    #[test]
    fn decode_uri_component_refuses_what_it_throws_on() {
        assert_eq!(decode_uri_component("/a%20b/%C3%A9%2F").as_deref(), Some("/a b/é/"));
        for thrown in ["%", "%2", "%zz", "%C3", "%C3a", "%E0%A4%A", "%ED%A0%80", "%C0%AF", "%+1"] {
            assert_eq!(decode_uri_component(thrown), None, "{thrown}");
        }
    }
}
