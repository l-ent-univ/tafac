// Tafac's own routes: what the server answers of itself, whoever asks,
// signed in or not, since nothing of a university's is asked for them. Each
// is a route of Node's moved as it is (server/), with Node's answers listed
// at its top.
//
// In the library, so in the apps too where their bridge sets them up
// (routes.rs, Backend::TonApi; answered by Gateway::answer):
//
//   universities.rs    which universities this server serves, the one a
//                      request is for, GET /__ent_auth/universities and
//                      their logos
//   shell.rs           the page itself: the built index.html filled with
//                      the text and the address of each request, and the
//                      sitemap
//   analytics.rs       POST /__ent_auth/analytics: the anonymous statistics,
//                      sent on to PostHog
//   icons.rs           POST /__ent_auth/app-icons: the applications' tiles,
//                      picked once for the whole university and kept in
//                      Node's own file (the apps leave it to their Node)
//   js.rs              what JavaScript does to text where Rust does
//                      otherwise (white space, UTF-16, JSON.stringify)
//
// tafac.fr's alone, answered by its server before the gateway and before
// Node (proxy.rs; routes.rs, Backend::Server). The apps ask tafac.fr for
// these over the network and carry their own files; their bridge never
// sees them, so they are built with the server only, files and outgoing
// requests included:
//
//   express.rs         what Express does around a route of Node's: the
//                      path matched as its router matches it, HEAD, the
//                      headers, a redirect
//   settings.rs        GET /app/settings.json and its .sig: the apps'
//                      remote settings, sent as they are
//   desktop_update.rs  GET /desktop/latest.json, /desktop/download/<platform>:
//                      the desktop app's update, and the releases followed
//   statics.rs         the page's built files, robots.txt and Apple's file,
//                      when the server is given the build
//   conditional.rs     what Express puts in a file's answer: ETags, dates,
//                      a copy still good, a range
//   page_headers.rs    the page's security headers, its policy included
//   page.rs            the page and the sitemap on the wire, as Express
//                      sends them (shell.rs says what is sent)
//
// The settings and the update are each a Service with its settings, read in
// main.rs from Node's own names; the server asks them in turn
// (Proxy::serving). The page's files are asked before them, and the page
// itself after (Proxy::with_page_files).

pub(crate) mod analytics;
#[cfg(feature = "server")]
pub(crate) mod conditional;
#[cfg(feature = "server")]
pub(crate) mod desktop_update;
#[cfg(feature = "server")]
pub(crate) mod express;
pub(crate) mod icons;
pub(crate) mod js;
#[cfg(feature = "server")]
pub(crate) mod page;
#[cfg(feature = "server")]
pub(crate) mod page_headers;
#[cfg(feature = "server")]
pub(crate) mod settings;
pub(crate) mod shell;
#[cfg(feature = "server")]
pub(crate) mod statics;
pub mod universities;

#[cfg(feature = "server")]
use http::{HeaderMap, Method, Response};

#[cfg(feature = "server")]
pub use self::desktop_update::{follow_releases, DesktopUpdate, Following};
#[cfg(feature = "server")]
pub use self::express::Asked;
#[cfg(feature = "server")]
pub use self::settings::AppSettings;

// One of the server's own services: its answer to a request for one of its
// lines of the table, or None when the line isn't its own, or when Node
// answers it after all (express.rs says when).
#[cfg(feature = "server")]
pub trait Service: Send + Sync {
    fn answer(&self, asked: &Asked<'_>) -> Option<Response<Vec<u8>>>;
}

// The first answer a service has for a request, when it is one of the
// server's own routes.
#[cfg(feature = "server")]
pub(crate) fn answer(services: &[Box<dyn Service>], method: &Method, path: &str, headers: &HeaderMap) -> Option<Response<Vec<u8>>> {
    if services.is_empty() {
        return None;
    }
    let asked = express::asked(method, path, headers)?;
    services.iter().find_map(|service| service.answer(&asked))
}

// Where a service says what it did, or refused: the server's log, and a
// list in the tests.
#[cfg(feature = "server")]
pub(crate) type Report = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

#[cfg(feature = "server")]
pub(crate) fn to_log() -> Report {
    std::sync::Arc::new(|message: &str| eprintln!("{message}"))
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;
    use crate::proxy::{serve, Proxy};
    use crate::testing::{block_on, campus, header_of, read_request, spawn};

    // A Node that answers everything « node » and says what it was asked.
    fn node() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let asked = Arc::new(Mutex::new(Vec::new()));
        let recording = asked.clone();
        spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let recording = recording.clone();
                spawn(async move {
                    let Some((head, _)) = read_request(&mut stream).await else { return };
                    recording.lock().unwrap().push(head.lines().next().unwrap_or_default().to_string());
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 4\r\nconnection: close\r\n\r\nnode").await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        (address, asked)
    }

    fn server(proxy: Proxy) -> String {
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let proxy = Arc::new(proxy);
        spawn(async move {
            let _ = serve(listener, proxy).await;
        });
        address
    }

    // One request as a browser writes it: the answer's head and body.
    fn send(address: &str, method: &str, path: &str) -> (String, Vec<u8>) {
        block_on(async {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(format!("{method} {path} HTTP/1.1\r\nhost: tafac.exemple.test\r\nconnection: close\r\n\r\n").as_bytes()).await.unwrap();
            let mut answer = Vec::new();
            stream.read_to_end(&mut answer).await.unwrap();
            let split = answer.windows(4).position(|window| window == b"\r\n\r\n").unwrap();
            (String::from_utf8_lossy(&answer[..split]).to_string(), answer[split + 4..].to_vec())
        })
    }

    #[test]
    fn tafac_frs_own_routes_are_answered_before_node_with_a_gateway_or_without() {
        let manifest = crate::own::desktop_update::manifest::tests::manifest().to_string();
        let (node, asked) = node();
        let campus = campus();
        for gateway in [None, Some(campus.gateway())] {
            let address = server(Proxy::new(gateway, &node).serving(AppSettings::new("")).serving(DesktopUpdate::new("", &manifest)));
            let (head, body) = send(&address, "GET", "/desktop/latest.json");
            assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
            assert_eq!(header_of(&head, "cache-control"), "no-cache");
            assert_eq!(header_of(&head, "x-tafac-answered-by"), "gateway");
            assert_eq!(body, manifest.as_bytes());
            // HEAD: the length of the body, no body.
            let (head, body) = send(&address, "HEAD", "/desktop/latest.json");
            assert_eq!(header_of(&head, "content-length"), manifest.len().to_string());
            assert!(body.is_empty());
            let (head, _) = send(&address, "GET", "/desktop/download/darwin-aarch64");
            assert!(head.starts_with("HTTP/1.1 302"), "{head}");
            assert_eq!(header_of(&head, "location"), "https://example.org/Tafac_0.26.0_aarch64.dmg");
            assert!(asked.lock().unwrap().is_empty(), "{:?}", asked.lock().unwrap());

            // Node's: another method, a name that doesn't decode, the
            // remote settings without their file, and the rest.
            for (method, path) in [("OPTIONS", "/desktop/latest.json"), ("GET", "/desktop/download/%E0"), ("GET", "/app/settings.json"), ("GET", "/robots.txt")] {
                let (_, body) = send(&address, method, path);
                assert_eq!(body, b"node", "{method} {path}");
            }
            assert_eq!(asked.lock().unwrap().len(), 4);
            asked.lock().unwrap().clear();
        }
    }
}
