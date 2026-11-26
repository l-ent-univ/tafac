// The page on the wire: tafac.fr's server sends it itself when it is given
// the build. shell.rs says what is sent for an address; this says how, as
// Express sends it for Node (server.js: sendAppShell, sendPage, the
// sitemap).
//
//   GET /                the page, with its landing while signed out
//   GET /index.html      the bare app, out of search engines
//   GET /sitemap.xml     the home page and each listed university's; 404,
//                        empty, without an address to write in it
//   any other address    where the build has no file: the page, 200 for an
//                        address of the app's and 404 for any other, or
//                        301 to a university's own address
//
// The page goes with Node's headers for it: the baseline ones and the
// page's own policy, read from the HTML as it is sent (page_headers.rs);
// its language, what it varies by, its canonical address (shell.rs); and
// what res.send adds, an ETag, and 304 for a copy the browser still has.
//
// Node's still (None): a method other than GET or HEAD; an address that
// doesn't decode, or holds a hidden or empty part (express.static refuses
// or skips those its own way); one a file or a folder of the build is at,
// which statics.rs answers or leaves to Node; a request without a Host;
// and conditional headers read another way than here (conditional.rs).

use std::path::{Path, PathBuf};

use http::header::{CONTENT_LENGTH, CONTENT_TYPE, COOKIE, ETAG, LOCATION, VARY};
use http::{HeaderMap, HeaderName, HeaderValue, Method, Response, Uri};

use super::conditional;
use super::express::{accepted, encode_url, escape_html};
use super::page_headers::page_headers;
use super::shell::{Shells, Shown};
use super::statics::{as_routed, public_origin};
use super::universities::Served;
use crate::routes::{self, Servers};
use crate::translate::BASELINE_HEADERS;

const HTML: &str = "text/html; charset=utf-8";
// res.type('application/xml'), then res.send of a string.
const XML: &str = "application/xml; charset=utf-8";

pub(crate) struct Page {
    dist: PathBuf,
    shells: Shells,
    served: Served,
}

// A signed-in student's request (server.js: SESSION_COOKIE_PATTERN), under
// either name of the session's cookie: they get the app, not the landing.
fn has_session_cookie(headers: &HeaderMap) -> bool {
    let cookies: Vec<String> = headers.get_all(COOKIE).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    let cookies = cookies.join("; ");
    let named = |piece: &str| piece.starts_with("lent_session=") || piece.starts_with("__Host-lent_session=");
    let mut pieces = cookies.split(';');
    // The first as it is; the others after the white space that follows « ; ».
    pieces.next().is_some_and(named) || pieces.any(|piece| named(piece.trim_start()))
}

// An answer of this server's, with the headers every one of Node's carries.
fn baseline(status: u16) -> http::response::Builder {
    BASELINE_HEADERS.iter().fold(Response::builder().status(status), |builder, (name, value)| builder.header(*name, *value))
}

// res.status(404).end().
fn nothing() -> Response<Vec<u8>> {
    baseline(404).header(CONTENT_LENGTH, 0).body(Vec::new()).unwrap()
}

// res.send of a text: its type, its ETag, its length; 304 for a copy the
// browser still has, of an answer that is found. `builder`: the answer so
// far. None: the conditional headers are Node's to read.
fn sent(builder: http::response::Builder, status: u16, headers: &HeaderMap, head: bool, content_type: &str, body: String) -> Option<Response<Vec<u8>>> {
    let etag = conditional::body_etag(body.as_bytes());
    let builder = builder.header(ETAG, &etag);
    if (200..300).contains(&status) && conditional::fresh(headers, &etag, None)? {
        return builder.status(304).body(Vec::new()).ok();
    }
    let builder = builder.status(status).header(CONTENT_TYPE, content_type).header(CONTENT_LENGTH, body.len());
    builder.body(if head { Vec::new() } else { body.into_bytes() }).ok()
}

// res.redirect(301, address).
fn moved(headers: &HeaderMap, head: bool, address: &str) -> Response<Vec<u8>> {
    let location = encode_url(address);
    let mut builder = baseline(301).header(LOCATION, &location).header(VARY, "Accept");
    let body = match accepted(headers, &["text/plain", "text/html"]) {
        Some(0) => {
            builder = builder.header(CONTENT_TYPE, "text/plain; charset=utf-8");
            format!("Moved Permanently. Redirecting to {location}")
        }
        Some(_) => {
            builder = builder.header(CONTENT_TYPE, HTML);
            format!("<p>Moved Permanently. Redirecting to {}</p>", escape_html(&location))
        }
        None => String::new(),
    };
    let builder = builder.header(CONTENT_LENGTH, body.len());
    builder.body(if head { Vec::new() } else { body.into_bytes() }).unwrap()
}

impl Page {
    // The page of the build at `dist`, for the universities `served`. None
    // without its index.html: the page is Node's then.
    pub(crate) fn read(dist: &Path, served: Served) -> Option<Self> {
        let template = std::fs::read_to_string(dist.join("index.html")).ok()?;
        let landings = std::fs::read_to_string(dist.join(".prerender").join("landing.json")).ok();
        let shells = Shells::new(&template, landings.as_deref(), &served);
        Some(Self { dist: dist.to_path_buf(), shells, served })
    }

    // The answer to a request, when it is the page's or the sitemap's;
    // None: Node's, or a file's (statics.rs, asked first).
    pub(crate) async fn answer(&self, method: &Method, uri: &Uri, headers: &HeaderMap) -> Option<Response<Vec<u8>>> {
        let head = method == Method::HEAD;
        if method != Method::GET && !head {
            return None;
        }
        let origin = public_origin(headers)?;
        let shown = match routes::server_route(&Method::GET, &as_routed(uri.path()))? {
            Servers::Sitemap => {
                return match self.shells.sitemap(&origin) {
                    Some(sitemap) => sent(baseline(200), 200, headers, head, XML, sitemap),
                    None => Some(nothing()),
                }
            }
            Servers::PageFile => self.shells.file(&origin),
            Servers::Page => self.shown(uri, headers, &origin),
            Servers::BuiltFile if self.has_no_file(uri.path()).await => self.shown(uri, headers, &origin),
            _ => return None,
        };
        match shown {
            Shown::Moved(address) => Some(moved(headers, head, &address)),
            Shown::Page { status, headers: own, html } => {
                let mut builder = Response::builder();
                for (name, value) in &page_headers(&html) {
                    builder = builder.header(name, value);
                }
                for (name, value) in own {
                    builder = builder.header(HeaderName::from_static(name), HeaderValue::from_str(&value).ok()?);
                }
                sent(builder, status, headers, head, HTML, html)
            }
        }
    }

    fn shown(&self, uri: &Uri, headers: &HeaderMap, origin: &str) -> Shown {
        let query = uri.query().map(|query| format!("?{query}")).unwrap_or_default();
        self.shells.page(&self.served, uri.path(), &query, !has_session_cookie(headers), origin)
    }

    // Whether the build has nothing at an address, for sure: express.static
    // then passes the request on, and the page is sent. Anything less sure
    // (a path it reads its own way, a folder, a file that can't be read) is
    // not said here.
    async fn has_no_file(&self, path: &str) -> bool {
        let Some(decoded) = conditional::decode_uri_component(path) else { return false };
        let Some(relative) = decoded.strip_prefix('/') else { return false };
        let relative = relative.strip_suffix('/').unwrap_or(relative);
        let parts: Vec<&str> = relative.split('/').collect();
        if parts.iter().any(|part| part.is_empty() || part.starts_with('.') || part.contains(['\\', '\0'])) {
            return false;
        }
        let file = parts.iter().fold(self.dist.clone(), |file, part| file.join(part));
        matches!(tokio::fs::metadata(&file).await, Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory))
    }
}
