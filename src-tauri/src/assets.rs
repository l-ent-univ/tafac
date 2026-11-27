// The page's built files (/assets/…: scripts, styles, fonts, pictures, the
// small videos of the animated icons), kept in memory once the site (the
// build the app carries, bridge.rs) gave them, and answered from there.
//
// WebKit keeps nothing of what comes from the app's own scheme between two
// uses, and reads a video a few bytes at a time (a Range request for each
// box of the file, again each time the video starts): the home page's six
// animated icons were some sixty requests a second, each one a file read
// again (a round trip to the app's Node, when there was one: on a phone,
// without a JIT, the icons took a second to show at each return to the
// page, and everything else waited behind them).
//
// Vite names these files after their content (name-hash.ext): a name never
// means another file while the app runs, so nothing is ever stale. The
// site is still asked for each file once, whole, and its answer's headers
// are kept with it: it stays the one that says what a file is.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use http::header::{ACCEPT_RANGES, CACHE_CONTROL, CONNECTION, CONTENT_LENGTH, CONTENT_RANGE, SET_COOKIE, TRANSFER_ENCODING};
use http::{HeaderMap, HeaderValue, Method, StatusCode};

const PREFIX: &str = "/assets/";
// A file larger than this is not kept (the landing page's films), nor
// anything once this much is.
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_BYTES: usize = 64 * 1024 * 1024;
// A name is one file for good.
const FOREVER: &str = "public, max-age=31536000, immutable";

pub struct File {
    headers: HeaderMap,
    body: Vec<u8>,
}

#[derive(Default)]
pub struct Assets {
    files: Mutex<HashMap<String, Arc<File>>>,
    // One file fetched at a time: sixty requests for a file not there yet
    // ask the site for it once.
    pub fetching: tokio::sync::Mutex<()>,
}

// Whether a request is for one of the page's built files.
pub fn is_asset(method: &Method, path: &str) -> bool {
    method == Method::GET && path.starts_with(PREFIX) && !path.contains("..")
}

impl Assets {
    pub fn get(&self, path: &str) -> Option<Arc<File>> {
        self.files.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(path).cloned()
    }

    // The server's whole answer for `path` (200), kept when there is room.
    // The file either way, to answer from.
    pub fn keep(&self, path: &str, response: http::Response<Vec<u8>>) -> Arc<File> {
        let (parts, body) = response.into_parts();
        let mut headers = parts.headers;
        for name in [CONTENT_LENGTH, CONTENT_RANGE, ACCEPT_RANGES, CACHE_CONTROL, TRANSFER_ENCODING, CONNECTION, SET_COOKIE] {
            headers.remove(name);
        }
        let file = Arc::new(File { headers, body });
        let mut files = self.files.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let kept: usize = files.values().map(|file| file.body.len()).sum();
        if file.body.len() <= MAX_FILE_BYTES && kept + file.body.len() <= MAX_BYTES {
            files.insert(path.to_string(), file.clone());
        }
        file
    }
}

#[derive(Debug, PartialEq)]
enum Part {
    Whole,
    // First and last byte, both included.
    Bytes(usize, usize),
    Unsatisfiable,
}

// What a Range header asks of a file of `length` bytes: bytes=a-b, bytes=a-,
// bytes=-n. Several ranges at once, or anything else, is the whole file (a
// server may always answer that).
fn part(range: Option<&str>, length: usize) -> Part {
    let Some(spec) = range.and_then(|range| range.trim().strip_prefix("bytes=")) else { return Part::Whole };
    let Some((first, last)) = spec.trim().split_once('-') else { return Part::Whole };
    if spec.contains(',') {
        return Part::Whole;
    }
    let number = |text: &str| text.trim().parse::<usize>().ok();
    match (first.trim().is_empty(), last.trim().is_empty()) {
        // The last n bytes.
        (true, false) => match number(last) {
            Some(0) => Part::Unsatisfiable,
            Some(count) if length > 0 => Part::Bytes(length.saturating_sub(count), length - 1),
            Some(_) => Part::Unsatisfiable,
            None => Part::Whole,
        },
        (false, _) => {
            let Some(start) = number(first) else { return Part::Whole };
            let end = if last.trim().is_empty() { Some(length.saturating_sub(1)) } else { number(last).map(|end| end.min(length.saturating_sub(1))) };
            match end {
                Some(end) if start < length && start <= end => Part::Bytes(start, end),
                Some(_) => Part::Unsatisfiable,
                None => Part::Whole,
            }
        }
        (true, true) => Part::Whole,
    }
}

// The answer to a request for `file`, whole or the part its Range asks for.
pub fn answer(file: &File, range: Option<&str>) -> http::Response<Vec<u8>> {
    let length = file.body.len();
    let (status, body, content_range) = match part(range, length) {
        Part::Whole => (StatusCode::OK, file.body.clone(), None),
        Part::Bytes(start, end) => (StatusCode::PARTIAL_CONTENT, file.body[start..=end].to_vec(), Some(format!("bytes {start}-{end}/{length}"))),
        Part::Unsatisfiable => (StatusCode::RANGE_NOT_SATISFIABLE, Vec::new(), Some(format!("bytes */{length}"))),
    };
    let sent = body.len();
    let mut response = http::Response::builder().status(status).body(body).unwrap();
    let headers = response.headers_mut();
    headers.extend(file.headers.iter().map(|(name, value)| (name.clone(), value.clone())));
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(FOREVER));
    headers.insert(CONTENT_LENGTH, HeaderValue::from(sent));
    if let Some(value) = content_range.and_then(|value| HeaderValue::from_str(&value).ok()) {
        headers.insert(CONTENT_RANGE, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served(body: &[u8]) -> http::Response<Vec<u8>> {
        http::Response::builder()
            .status(200)
            .header("content-type", "video/quicktime")
            .header("etag", "\"abc\"")
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "public, max-age=0")
            .header("content-length", body.len())
            .body(body.to_vec())
            .unwrap()
    }

    #[test]
    fn only_the_pages_built_files_are_kept() {
        assert!(is_asset(&Method::GET, "/assets/mail-GfOfwDUF.mov"));
        assert!(!is_asset(&Method::POST, "/assets/mail-GfOfwDUF.mov"));
        assert!(!is_asset(&Method::GET, "/__ent_auth/session"));
        assert!(!is_asset(&Method::GET, "/login"));
        assert!(!is_asset(&Method::GET, "/assets/../server.js"));
    }

    #[test]
    fn a_range_is_read_as_a_server_reads_it() {
        assert_eq!(part(None, 100), Part::Whole);
        assert_eq!(part(Some("bytes=0-1"), 100), Part::Bytes(0, 1));
        assert_eq!(part(Some("bytes=8-15"), 100), Part::Bytes(8, 15));
        assert_eq!(part(Some("bytes=90-"), 100), Part::Bytes(90, 99));
        // Past the end: up to the last byte.
        assert_eq!(part(Some("bytes=90-500"), 100), Part::Bytes(90, 99));
        assert_eq!(part(Some("bytes=-10"), 100), Part::Bytes(90, 99));
        assert_eq!(part(Some("bytes=-500"), 100), Part::Bytes(0, 99));
        // Nothing there.
        assert_eq!(part(Some("bytes=100-"), 100), Part::Unsatisfiable);
        assert_eq!(part(Some("bytes=20-10"), 100), Part::Unsatisfiable);
        assert_eq!(part(Some("bytes=-0"), 100), Part::Unsatisfiable);
        assert_eq!(part(Some("bytes=0-"), 0), Part::Unsatisfiable);
        // Not one range of bytes: the whole file.
        assert_eq!(part(Some("bytes=0-1,5-6"), 100), Part::Whole);
        assert_eq!(part(Some("lines=0-1"), 100), Part::Whole);
        assert_eq!(part(Some("bytes=a-b"), 100), Part::Whole);
        assert_eq!(part(Some("bytes=-"), 100), Part::Whole);
    }

    #[test]
    fn a_file_is_answered_whole_or_in_part_with_the_servers_headers() {
        let assets = Assets::default();
        assert!(assets.get("/assets/a.mov").is_none());
        let file = assets.keep("/assets/a.mov", served(b"0123456789"));
        assert!(assets.get("/assets/a.mov").is_some());

        let whole = answer(&file, None);
        assert_eq!(whole.status(), 200);
        assert_eq!(whole.body(), b"0123456789");
        assert_eq!(whole.headers()["content-type"], "video/quicktime");
        assert_eq!(whole.headers()["etag"], "\"abc\"");
        assert_eq!(whole.headers()["x-content-type-options"], "nosniff");
        assert_eq!(whole.headers()["content-length"], "10");
        assert_eq!(whole.headers()["accept-ranges"], "bytes");
        assert_eq!(whole.headers()["cache-control"], FOREVER);
        assert!(whole.headers().get("content-range").is_none());

        let some = answer(&file, Some("bytes=2-5"));
        assert_eq!(some.status(), 206);
        assert_eq!(some.body(), b"2345");
        assert_eq!(some.headers()["content-range"], "bytes 2-5/10");
        assert_eq!(some.headers()["content-length"], "4");
        assert_eq!(some.headers()["content-type"], "video/quicktime");

        let none = answer(&file, Some("bytes=10-"));
        assert_eq!(none.status(), 416);
        assert_eq!(none.headers()["content-range"], "bytes */10");
        assert!(none.body().is_empty());
    }

    #[test]
    fn a_file_too_big_is_answered_but_not_kept() {
        let assets = Assets::default();
        let film = vec![0u8; MAX_FILE_BYTES + 1];
        let file = assets.keep("/assets/film.mp4", served(&film));
        assert_eq!(answer(&file, Some("bytes=0-1")).status(), 206);
        assert!(assets.get("/assets/film.mp4").is_none());
    }
}
