// The page's own files on tafac.fr, answered by this server when it is
// given the build (TAFAC_GATEWAY_DIST: Node's dist/), and the two
// addresses beside them that server.js answers by itself. Off without it:
// every such request is Node's, as before. The apps answer the build they
// carry with it too (site.rs).
//
// Node's answers (server.js; server/staticFiles/: express.static), given
// here:
//
//   a file of the build, GET or HEAD
//       200 the file, with how long it may be kept (Cache-Control: a year
//       and immutable under /assets/, whose names are their content's;
//       read again at each visit for /sw.js, /index.html and
//       /manifest.webmanifest; a day for the rest), Accept-Ranges, its date
//       (Last-Modified), a weak ETag of its size and time, its type.
//       304, the same headers but the type and the length, for a copy the
//       browser holds that is still good (If-None-Match, If-Modified-Since,
//       Cache-Control: no-cache asking for the file all the same).
//       206 for one range of its bytes (Range, If-Range), with
//       Content-Range.
//   GET /robots.txt
//       200 text/plain: everything allowed but the page's API, and the
//       sitemap's address when the request's own address reads as one
//       (X-Forwarded-Proto, X-Forwarded-Host or Host); its ETag, and 304.
//   GET /.well-known/apple-app-site-association
//       200 the desktop app's ids (APPLE_APP_IDS) as JSON, its ETag, and
//       304; 404 empty without them.
//   Still Node's: the page itself and the routes server.js has before its
//       files (routes.rs: the sitemap, the desktop app's updates, the
//       apps' settings); whatever isn't a file of the build (a missing
//       file, which gets the page, a folder, a dotfile, a path that goes up
//       or reads oddly: Node's handler passes them on, or redirects a
//       folder); another method; a type not listed below; a Range of
//       several parts, or one that can't be given (416); a precondition
//       that fails (412); a date that isn't HTTP's own (Date.parse reads
//       more), and a request without a Host.
//
// Every answer carries the baseline headers, as Node's (BASELINE_HEADERS).
// Node's say X-Powered-By: Express too; not these.

use std::io::SeekFrom;
use std::path::PathBuf;

use bytes::Bytes;
use http::{HeaderMap, Method, Response, StatusCode, Uri};
use http_body_util::combinators::UnsyncBoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::conditional::{self, said};
use super::js;
use crate::routes::{self, Servers};
use crate::translate::BASELINE_HEADERS;

pub(crate) type Body = UnsyncBoxBody<Bytes, Box<dyn std::error::Error + Send + Sync>>;

// send's types, by extension (mime-types, with a charset for text): the
// ones a build has, and a few more. Another is Node's. A test holds each
// to what Node's handler answered.
const CONTENT_TYPES: &[(&str, &str)] = &[
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("html", "text/html; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("map", "application/json; charset=utf-8"),
    ("webmanifest", "application/manifest+json; charset=utf-8"),
    ("txt", "text/plain; charset=utf-8"),
    ("xml", "application/xml"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("ico", "image/vnd.microsoft.icon"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("otf", "font/otf"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mov", "video/quicktime"),
    ("mp3", "audio/mpeg"),
    ("wasm", "application/wasm"),
    ("pdf", "application/pdf"),
];

// server/staticFiles/index.ts.
const HASHED_DIR: &str = "assets";
const ALWAYS_FRESH: &[&str] = &["sw.js", "index.html", "manifest.webmanifest"];
const FOR_GOOD: &str = "public, max-age=31536000, immutable";
const EVERY_VISIT: &str = "public, max-age=0, must-revalidate";
const A_DAY: &str = "public, max-age=86400";

// server.js's robots.txt, line by line.
const ROBOTS: &[&str] = &["User-agent: *", "Allow: /", "Disallow: /__ent_auth/", "Disallow: /__ent_proxy/"];

// How much of a file is read at a time while it goes out.
const CHUNK_BYTES: usize = 64 * 1024;

pub(crate) struct Statics {
    // The build, as server.js has it (DIST_DIR).
    dist: PathBuf,
    // APPLE_APP_IDS, as server.js reads it.
    apple_app_ids: Vec<String>,
}

fn whole(body: impl Into<Bytes>) -> Body {
    Full::new(body.into()).map_err(|never| match never {}).boxed_unsync()
}

// An answer of this server's, with the headers every one of Node's carries.
fn answer(status: StatusCode) -> http::response::Builder {
    BASELINE_HEADERS.iter().fold(Response::builder().status(status), |builder, (name, value)| builder.header(*name, *value))
}

// cacheControlFor: how long a file may be kept, by its place in the build.
fn cache_control(relative: &str) -> &'static str {
    let parts: Vec<&str> = relative.split('/').filter(|part| !part.is_empty()).collect();
    match parts.as_slice() {
        [first, _, ..] if *first == HASHED_DIR => FOR_GOOD,
        [only] if ALWAYS_FRESH.contains(only) => EVERY_VISIT,
        _ => A_DAY,
    }
}

// The path as Express's routes match it: case aside, one slash at the end
// aside.
pub(crate) fn as_routed(path: &str) -> String {
    let path = if path.len() > 1 { path.strip_suffix('/').unwrap_or(path) } else { path };
    path.to_ascii_lowercase()
}

// getSafePublicOrigin: the address the request was made to, as the page
// may name it; "" when it doesn't read as one. None: no Host, where Node
// names its own port.
pub(crate) fn public_origin(headers: &HeaderMap) -> Option<String> {
    let first = |name: &str| conditional::node_header(headers, name).map(|value| js::trim(value.split(',').next().unwrap_or_default()).to_string()).filter(|value| !value.is_empty());
    let protocol = first("x-forwarded-proto").unwrap_or_else(|| "http".to_string());
    let host = first("x-forwarded-host").or_else(|| conditional::node_header(headers, "host").filter(|host| !host.is_empty()))?;
    let origin = format!("{protocol}://{host}");
    // SAFE_ORIGIN: /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i
    let rest = ["http://", "https://"].iter().find_map(|scheme| origin.get(..scheme.len()).filter(|start| start.eq_ignore_ascii_case(scheme)).map(|_| &origin[scheme.len()..]));
    let safe = rest.is_some_and(|rest| {
        let (name, port) = rest.split_once(':').map_or((rest, None), |(name, port)| (name, Some(port)));
        !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-') && port.is_none_or(|port| (1..=5).contains(&port.len()) && port.bytes().all(|byte| byte.is_ascii_digit()))
    });
    Some(if safe { origin } else { String::new() })
}

// One range of a file, as range-parser gives it: « bytes=a-b », « bytes=a- »,
// « bytes=-n », digits only, the end past the file brought back to it.
// None: anything else (several, spaces, nothing to give), which is Node's.
fn one_range(range: &str, size: u64) -> Option<(u64, u64)> {
    let (from, to) = range.strip_prefix("bytes=")?.split_once('-')?;
    let number = |text: &str| -> Option<u64> { (!text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())).then(|| text.parse().ok()).flatten() };
    let last = size.checked_sub(1)?;
    let (start, end) = match (from.is_empty(), to.is_empty()) {
        (false, true) => (number(from)?, last),
        (false, false) => (number(from)?, number(to)?.min(last)),
        (true, false) => (size.checked_sub(number(to)?)?, last),
        (true, true) => return None,
    };
    (start <= end).then_some((start, end))
}

impl Statics {
    // `dist`: the build. `apple_app_ids`: APPLE_APP_IDS, as Node is given it.
    pub(crate) fn new(dist: PathBuf, apple_app_ids: &str) -> Self {
        let apple_app_ids = apple_app_ids.split(',').map(|id| js::trim(id).to_string()).filter(|id| !id.is_empty()).collect();
        Self { dist, apple_app_ids }
    }

    // The answer to a request, when it is one of these; None: Node's.
    pub(crate) async fn answer(&self, method: &Method, uri: &Uri, headers: &HeaderMap) -> Option<Response<Body>> {
        let head = method == Method::HEAD;
        if method != Method::GET && !head {
            return None;
        }
        match routes::server_route(&Method::GET, &as_routed(uri.path()))? {
            Servers::Robots => {
                let origin = public_origin(headers)?;
                let sitemap = (!origin.is_empty()).then(|| format!("Sitemap: {origin}/sitemap.xml"));
                let body = ROBOTS.iter().map(|line| line.to_string()).chain(sitemap).collect::<Vec<_>>().join("\n");
                Self::sent_whole(headers, head, "text/plain; charset=utf-8", body)
            }
            Servers::AppleAssociation if self.apple_app_ids.is_empty() => Some(answer(StatusCode::NOT_FOUND).header("content-length", "0").body(whole(Bytes::new())).ok()?),
            Servers::AppleAssociation => {
                let body = serde_json::json!({ "webcredentials": { "apps": self.apple_app_ids } }).to_string();
                Self::sent_whole(headers, head, "application/json; charset=utf-8", body)
            }
            Servers::BuiltFile => self.file(uri.path(), headers, head).await,
            // The apps' settings and the desktop update (settings.rs,
            // desktop_update.rs), the page and the sitemap (page.rs): asked
            // after this.
            Servers::AppSettings | Servers::AppSettingsSignature | Servers::DesktopManifest | Servers::DesktopInstaller => None,
            Servers::Page | Servers::PageFile | Servers::Sitemap => None,
        }
    }

    // An answer Express sends whole (res.send): its ETag, and 304 for a
    // copy still good.
    fn sent_whole(headers: &HeaderMap, head: bool, content_type: &str, body: String) -> Option<Response<Body>> {
        let etag = conditional::body_etag(body.as_bytes());
        if conditional::fresh(headers, &etag, None)? {
            return answer(StatusCode::NOT_MODIFIED).header("etag", etag).body(whole(Bytes::new())).ok();
        }
        let length = body.len().to_string();
        let body = if head { Bytes::new() } else { Bytes::from(body) };
        answer(StatusCode::OK).header("content-type", content_type).header("etag", etag).header("content-length", length).body(whole(body)).ok()
    }

    // A file of the build, as send answers it.
    async fn file(&self, path: &str, headers: &HeaderMap, head: bool) -> Option<Response<Body>> {
        let decoded = conditional::decode_uri_component(path)?;
        let relative = decoded.strip_prefix('/')?;
        let parts: Vec<&str> = relative.split('/').collect();
        if parts.iter().any(|part| part.is_empty() || part.starts_with('.') || part.contains(['\\', '\0'])) {
            return None;
        }
        let name = parts.last()?;
        let extension = name.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase())?;
        let content_type = CONTENT_TYPES.iter().find(|(known, _)| *known == extension)?.1;
        let file_path = parts.iter().fold(self.dist.clone(), |file_path, part| file_path.join(part));
        let metadata = tokio::fs::metadata(&file_path).await.ok().filter(std::fs::Metadata::is_file)?;
        let size = metadata.len();
        let modified = conditional::node_milliseconds(metadata.modified().ok()?);
        let etag = conditional::file_etag(size, modified);
        let last_modified = conditional::http_date(modified);

        let mut response = answer(StatusCode::OK)
            .header("cache-control", cache_control(relative))
            .header("accept-ranges", "bytes")
            .header("last-modified", last_modified.as_str())
            .header("etag", etag.as_str());
        let conditional = ["if-match", "if-unmodified-since", "if-none-match", "if-modified-since"].iter().any(|name| said(headers, name).is_some());
        if conditional {
            if conditional::precondition_fails(headers, &etag, &last_modified)? {
                return None;
            }
            if conditional::fresh(headers, &etag, Some(&last_modified))? {
                return response.status(StatusCode::NOT_MODIFIED).body(whole(Bytes::new())).ok();
            }
        }
        response = response.header("content-type", content_type);

        let (mut offset, mut length) = (0, size);
        if let Some(range) = said(headers, "range").filter(|range| range.trim_start_matches(' ').starts_with("bytes=")) {
            if conditional::range_fresh(headers, &etag, &last_modified)? {
                let (start, end) = one_range(&range, size)?;
                response = response.status(StatusCode::PARTIAL_CONTENT).header("content-range", format!("bytes {start}-{end}/{size}"));
                (offset, length) = (start, end - start + 1);
            }
        }
        response = response.header("content-length", length);
        if head || length == 0 {
            return response.body(whole(Bytes::new())).ok();
        }

        let mut file = tokio::fs::File::open(&file_path).await.ok()?;
        file.seek(SeekFrom::Start(offset)).await.ok()?;
        let chunks = futures_util::stream::unfold((file.take(length), vec![0_u8; CHUNK_BYTES]), |(mut reader, mut buffer)| async move {
            match reader.read(&mut buffer).await {
                Ok(0) => None,
                Ok(read) => Some((Ok(http_body::Frame::data(Bytes::copy_from_slice(&buffer[..read]))), (reader, buffer))),
                Err(error) => Some((Err(Box::new(error) as Box<dyn std::error::Error + Send + Sync>), (reader, buffer))),
            }
        });
        response.body(StreamBody::new(chunks).boxed_unsync()).ok()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::{Duration, UNIX_EPOCH};

    use http::HeaderValue;

    use super::*;
    use crate::testing::block_on;

    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/static-files.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    // A build of the test's own, gone after it.
    struct Build(PathBuf);

    impl Build {
        // The fixture's files, with their contents and times to the
        // nanosecond.
        fn of_the_fixture(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("tafac-gateway-dist-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            for file in fixture()["files"].as_array().unwrap() {
                let path = file["path"].as_str().unwrap().split('/').fold(root.clone(), |path, part| path.join(part));
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(&path, file["content"].as_str().unwrap()).unwrap();
                let nanos: u64 = file["mtimeNs"].as_str().unwrap().parse().unwrap();
                std::fs::File::options().write(true).open(&path).unwrap().set_modified(UNIX_EPOCH + Duration::from_nanos(nanos)).unwrap();
            }
            Self(root)
        }
    }

    impl Drop for Build {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn request_headers(pairs: &serde_json::Value) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs.as_object().unwrap() {
            headers.append(http::HeaderName::from_bytes(name.as_bytes()).unwrap(), HeaderValue::from_str(value.as_str().unwrap()).unwrap());
        }
        headers
    }

    fn ask(statics: &Statics, method: &str, target: &str, headers: &HeaderMap) -> Option<(u16, BTreeMap<String, String>, Vec<u8>)> {
        block_on(async {
            let response = statics.answer(&method.parse().unwrap(), &target.parse().unwrap(), headers).await?;
            let status = response.status().as_u16();
            let headers = response.headers().iter().map(|(name, value)| (name.to_string(), value.to_str().unwrap().to_string())).collect();
            let body = response.into_body().collect().await.unwrap().to_bytes().to_vec();
            Some((status, headers, body))
        })
    }

    // Node's own handler on the same files: the same status, every header
    // it sets, the same bytes; or the request left to Node.
    #[test]
    fn a_file_is_answered_as_nodes_handler_answers_it() {
        let build = Build::of_the_fixture("answers");
        let statics = Statics::new(build.0.clone(), "");
        let fixture = fixture();
        for case in fixture["answers"].as_array().unwrap() {
            let (method, path) = (case["method"].as_str().unwrap(), case["path"].as_str().unwrap());
            let answered = ask(&statics, method, path, &request_headers(&case["headers"]));
            if case["left"].as_bool().unwrap() {
                assert!(answered.is_none(), "{method} {path} {}: left to Node", case["headers"]);
                continue;
            }
            let (status, mut headers, body) = answered.unwrap_or_else(|| panic!("{method} {path} {}: answered here", case["headers"]));
            for (name, value) in BASELINE_HEADERS {
                assert_eq!(headers.remove(*name).as_deref(), Some(*value), "{method} {path}: {name}");
            }
            let node: BTreeMap<String, String> = case["answered"].as_object().unwrap().iter().map(|(name, value)| (name.clone(), value.as_str().unwrap().to_string())).collect();
            assert_eq!((status, &headers), (case["status"].as_u64().unwrap() as u16, &node), "{method} {path} {}", case["headers"]);
            assert_eq!(String::from_utf8(body).unwrap(), case["body"].as_str().unwrap(), "{method} {path}");
        }
    }

    #[test]
    fn the_types_and_the_times_kept_are_nodes() {
        let fixture = fixture();
        let types = fixture["contentTypes"].as_object().unwrap();
        assert_eq!(types.len(), CONTENT_TYPES.len());
        for (extension, content_type) in CONTENT_TYPES {
            assert_eq!(types[*extension], *content_type, "{extension}");
        }
        for case in fixture["cacheControl"].as_array().unwrap() {
            assert_eq!(cache_control(case[0].as_str().unwrap()), case[1].as_str().unwrap(), "{}", case[0]);
        }
        let node = include_str!("../../../../../server/staticFiles/index.ts");
        assert!(node.contains(&format!("const HASHED_DIR = '{HASHED_DIR}'")));
        let listed = ALWAYS_FRESH.iter().map(|name| format!("'{name}'")).collect::<Vec<_>>().join(", ");
        assert!(node.contains(&format!("const ALWAYS_FRESH = new Set([{listed}])")));
    }

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_static(value));
        }
        headers
    }

    #[test]
    fn robots_txt_names_the_sitemap_of_the_address_asked() {
        let statics = Statics::new(PathBuf::from("/nowhere"), "");
        let robots = |pairs: &[(&'static str, &'static str)]| ask(&statics, "GET", "/robots.txt", &headers(pairs)).map(|(status, headers, body)| (status, headers, String::from_utf8(body).unwrap()));
        let plain = "User-agent: *\nAllow: /\nDisallow: /__ent_auth/\nDisallow: /__ent_proxy/";
        let (status, answered, body) = robots(&[("host", "tafac.fr"), ("x-forwarded-proto", "https")]).unwrap();
        assert_eq!((status, body.as_str()), (200, format!("{plain}\nSitemap: https://tafac.fr/sitemap.xml").as_str()));
        assert_eq!(answered["content-type"], "text/plain; charset=utf-8");
        assert_eq!(answered["etag"], conditional::body_etag(body.as_bytes()));
        assert_eq!(answered["content-length"], body.len().to_string());
        for (pairs, sitemap) in [
            (&[("host", "127.0.0.1:3000")][..], Some("http://127.0.0.1:3000")),
            (&[("host", "inner"), ("x-forwarded-host", " Tafac.FR , other"), ("x-forwarded-proto", "HTTPS, http")][..], Some("HTTPS://Tafac.FR")),
            (&[("host", "tafac.fr"), ("x-forwarded-proto", "")][..], Some("http://tafac.fr")),
            (&[("host", "tafac.fr"), ("x-forwarded-proto", "ftp")][..], None),
            (&[("host", "tafac.fr:123456")][..], None),
            (&[("host", "tafac.fr\"><script>")][..], None),
            (&[("host", "tafac.fr/x")][..], None),
        ] {
            let expected = sitemap.map_or_else(|| plain.to_string(), |origin| format!("{plain}\nSitemap: {origin}/sitemap.xml"));
            assert_eq!(robots(pairs).map(|(_, _, body)| body).as_deref(), Some(expected.as_str()), "{pairs:?}");
        }
        // No Host: Node names its own port.
        assert_eq!(robots(&[("host", "")]).map(|(_, _, body)| body), None);
        assert_eq!(robots(&[]).map(|(_, _, body)| body), None);
        // Case and a slash at the end aside, as Express's routes; HEAD
        // without the body; a copy still good.
        assert!(ask(&statics, "GET", "/ROBOTS.TXT/", &headers(&[("host", "tafac.fr")])).is_some());
        let whole_body = format!("{plain}\nSitemap: http://tafac.fr/sitemap.xml");
        let (status, answered, body) = ask(&statics, "HEAD", "/robots.txt", &headers(&[("host", "tafac.fr")])).unwrap();
        assert_eq!((status, answered["content-length"].clone(), body.len()), (200, whole_body.len().to_string(), 0));
        let etag = conditional::body_etag(whole_body.as_bytes());
        let mut asked = headers(&[("host", "tafac.fr")]);
        asked.insert("if-none-match", HeaderValue::from_str(&etag).unwrap());
        let (status, answered, body) = ask(&statics, "GET", "/robots.txt", &asked).unwrap();
        assert_eq!((status, answered.get("etag"), answered.get("content-type"), body.len()), (304, Some(&etag), None, 0));
        assert!(ask(&statics, "POST", "/robots.txt", &headers(&[("host", "tafac.fr")])).is_none());
    }

    #[test]
    fn apples_file_lists_the_desktop_app_or_isnt_there() {
        let path = "/.well-known/apple-app-site-association";
        let none = Statics::new(PathBuf::from("/nowhere"), " , ");
        let (status, answered, body) = ask(&none, "GET", path, &HeaderMap::new()).unwrap();
        assert_eq!((status, answered.get("content-type"), body.len()), (404, None, 0));
        let statics = Statics::new(PathBuf::from("/nowhere"), " ABCDE12345.fr.tafac.desktop,,FGHIJ67890.fr.tafac.desktop ");
        let (status, answered, body) = ask(&statics, "GET", path, &HeaderMap::new()).unwrap();
        assert_eq!(status, 200);
        assert_eq!(String::from_utf8(body).unwrap(), r#"{"webcredentials":{"apps":["ABCDE12345.fr.tafac.desktop","FGHIJ67890.fr.tafac.desktop"]}}"#);
        assert_eq!(answered["content-type"], "application/json; charset=utf-8");
        // server.js's own words for both, and its own variable.
        let node = include_str!("../../../../../server.js");
        assert!(node.contains("res.type('application/json').send(JSON.stringify({ webcredentials: { apps: APPLE_APP_IDS } }))"));
        assert!(node.contains("String(process.env.APPLE_APP_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)"));
        for line in ROBOTS {
            assert!(node.contains(&format!("'{line}',")), "{line}");
        }
        assert!(node.contains("...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : []),"));
        assert!(node.contains(r"const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i"));
    }

    #[test]
    fn the_routes_before_the_files_and_the_page_are_nodes() {
        let build = Build::of_the_fixture("routes");
        std::fs::write(build.0.join("index.html"), "<p>the page</p>").unwrap();
        std::fs::write(build.0.join("sitemap.xml"), "<urlset/>").unwrap();
        std::fs::create_dir_all(build.0.join("desktop")).unwrap();
        std::fs::write(build.0.join("desktop/latest.json"), "{}").unwrap();
        std::fs::create_dir_all(build.0.join("app")).unwrap();
        std::fs::write(build.0.join("app/settings.json"), "{}").unwrap();
        std::fs::create_dir_all(build.0.join("__ent_auth")).unwrap();
        std::fs::write(build.0.join("__ent_auth/session.json"), "{}").unwrap();
        let statics = Statics::new(build.0.clone(), "");
        for path in ["/", "/index.html", "/INDEX.HTML", "/sitemap.xml", "/desktop/latest.json", "/Desktop/latest.json/", "/app/settings.json", "/__ent_auth/session.json"] {
            assert!(ask(&statics, "GET", path, &HeaderMap::new()).is_none(), "{path}");
        }
        assert_eq!(ask(&statics, "GET", "/icon.png", &HeaderMap::new()).map(|(status, ..)| status), Some(200));
    }

    #[test]
    fn a_large_file_goes_out_whole_in_pieces() {
        let build = Build::of_the_fixture("large");
        let content: Vec<u8> = (0..(3 * CHUNK_BYTES + 17)).map(|index| (index % 251) as u8).collect();
        std::fs::write(build.0.join("assets/video-abc.mp4"), &content).unwrap();
        let statics = Statics::new(build.0.clone(), "");
        let (status, answered, body) = ask(&statics, "GET", "/assets/video-abc.mp4", &HeaderMap::new()).unwrap();
        assert_eq!((status, answered["content-length"].clone(), answered["cache-control"].as_str()), (200, content.len().to_string(), FOR_GOOD));
        assert!(body == content);
        let (status, answered, body) = ask(&statics, "GET", "/assets/video-abc.mp4", &headers(&[("range", "bytes=65530-65545")])).unwrap();
        assert_eq!((status, answered["content-range"].clone()), (206, format!("bytes 65530-65545/{}", content.len())));
        assert!(body == content[65530..=65545]);
    }
}
