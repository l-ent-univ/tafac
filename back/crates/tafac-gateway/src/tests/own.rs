// tafac.fr's server answering what is Tafac's own, on the wire: the page's
// files when it is given the build, the applications' icons with their
// body read on the way, and what it leaves to Node then.

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::*;
use crate::proxy::{serve, Proxy};

// Node, as much of it as asked here: it keeps each request's head and the
// length of its body, and answers {"from":"node"}.
struct Node {
    address: String,
    got: Arc<Mutex<Vec<(String, usize)>>>,
}

fn node() -> Node {
    let got = Arc::new(Mutex::new(Vec::new()));
    let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let record = got.clone();
    spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let record = record.clone();
            spawn(async move {
                let Some((head, mut body)) = read_request(&mut stream).await else { return };
                let length: usize = header_of(&head, "content-length").parse().unwrap_or(0);
                let mut chunk = vec![0_u8; 64 * 1024];
                while body.len() < length {
                    match stream.read(&mut chunk).await {
                        Ok(read) if read > 0 => body.extend_from_slice(&chunk[..read]),
                        _ => break,
                    }
                }
                record.lock().unwrap().push((head, body.len()));
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 15\r\nconnection: close\r\n\r\n{\"from\":\"node\"}").await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Node { address, got }
}

fn server(proxy: Proxy) -> String {
    let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
    let address = listener.local_addr().unwrap().to_string();
    spawn(async move {
        let _ = serve(listener, Arc::new(proxy)).await;
    });
    address
}

// One request as a browser writes it, and all of the answer: its head, its body.
fn send(address: &str, request: &[u8]) -> (String, Vec<u8>) {
    block_on(async {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream.write_all(request).await.unwrap();
        let mut answer = Vec::new();
        stream.read_to_end(&mut answer).await.unwrap();
        let split = answer.windows(4).position(|window| window == b"\r\n\r\n").unwrap();
        (String::from_utf8_lossy(&answer[..split]).to_string(), answer[split + 4..].to_vec())
    })
}

fn get(address: &str, method: &str, path: &str, headers: &str) -> (String, Vec<u8>) {
    send(address, format!("{method} {path} HTTP/1.1\r\nhost: tafac.exemple.test\r\n{headers}connection: close\r\n\r\n").as_bytes())
}

// A build of the test's own, gone after it.
struct Build(std::path::PathBuf);

impl Build {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("tafac-gateway-build-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("assets/index-abc.js"), "console.log(1)").unwrap();
        std::fs::write(root.join("index.html"), "<p>the build's page</p>").unwrap();
        std::fs::write(root.join("robots.txt"), "the build's robots").unwrap();
        Self(root)
    }
}

impl Drop for Build {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn the_pages_files_are_answered_here_when_the_server_has_the_build() {
    let (node, build) = (node(), Build::new("served"));
    let address = server(Proxy::new(None, &node.address).with_page_files(build.0.clone(), "", crate::own::universities::Served::from_environment(|_| None, false).unwrap()));

    let (head, body) = get(&address, "GET", "/assets/index-abc.js", "");
    assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
    assert_eq!(body, b"console.log(1)");
    assert_eq!(header_of(&head, "content-type"), "text/javascript; charset=utf-8");
    assert_eq!(header_of(&head, "cache-control"), "public, max-age=31536000, immutable");
    assert_eq!(header_of(&head, "content-length"), "14");
    assert_eq!(header_of(&head, "x-frame-options"), "SAMEORIGIN");
    assert_eq!(header_of(&head, "content-security-policy"), "frame-ancestors 'self'");
    let etag = header_of(&head, "etag");

    // As it goes out: HEAD says the length, 304 says neither it nor the type.
    let (head, body) = get(&address, "HEAD", "/assets/index-abc.js", "");
    assert_eq!((header_of(&head, "content-length").as_str(), body.len()), ("14", 0), "{head}");
    let (head, body) = get(&address, "GET", "/assets/index-abc.js", &format!("if-none-match: {etag}\r\n"));
    assert!(head.starts_with("HTTP/1.1 304"), "{head}");
    assert_eq!((header_of(&head, "content-length").as_str(), header_of(&head, "content-type").as_str(), body.len()), ("", "", 0), "{head}");
    assert_eq!(header_of(&head, "etag"), etag);
    let (head, body) = get(&address, "GET", "/assets/index-abc.js", "range: bytes=0-6\r\n");
    assert!(head.starts_with("HTTP/1.1 206"), "{head}");
    assert_eq!((header_of(&head, "content-range").as_str(), body.as_slice()), ("bytes 0-6/14", &b"console"[..]));

    // robots.txt is server.js's, not the build's.
    let (head, body) = get(&address, "GET", "/robots.txt", "");
    assert_eq!(body, b"User-agent: *\nAllow: /\nDisallow: /__ent_auth/\nDisallow: /__ent_proxy/\nSitemap: http://tafac.exemple.test/sitemap.xml", "{head}");
    let (head, body) = get(&address, "GET", "/.well-known/apple-app-site-association", "");
    assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    assert!(body.is_empty());
    assert!(node.got.lock().unwrap().is_empty());

    // The page itself, filled for this request, with its own policy and
    // what res.send adds; a copy the browser still has isn't sent again.
    let (head, body) = get(&address, "GET", "/", "");
    assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
    assert_eq!(body, b"<p>the build's page</p>");
    assert_eq!((header_of(&head, "content-type").as_str(), header_of(&head, "content-language").as_str(), header_of(&head, "vary").as_str()), ("text/html; charset=utf-8", "fr", "Cookie"));
    assert_eq!(header_of(&head, "link"), "<http://tafac.exemple.test/>; rel=\"canonical\"");
    assert!(header_of(&head, "content-security-policy").starts_with("default-src 'self'; script-src 'self'"), "{head}");
    assert_eq!(header_of(&head, "x-frame-options"), "SAMEORIGIN");
    let etag = header_of(&head, "etag");
    let (head, body) = get(&address, "GET", "/", &format!("if-none-match: {etag}\r\n"));
    assert!(head.starts_with("HTTP/1.1 304"), "{head}");
    assert_eq!((header_of(&head, "content-type").as_str(), body.len()), ("", 0));
    assert_eq!(get(&address, "HEAD", "/", "").1.len(), 0);
    // Its file: the same, out of search engines.
    let (head, body) = get(&address, "GET", "/index.html", "");
    assert_eq!((header_of(&head, "x-robots-tag").as_str(), body.as_slice()), ("noindex", &b"<p>the build's page</p>"[..]), "{head}");

    // An address of the app's; a university's under another spelling, sent
    // to its own; what is no address of the app's and no file: the page all
    // the same, as a 404, never from a copy.
    let (head, _) = get(&address, "GET", "/rennes", "");
    assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
    let (head, body) = get(&address, "GET", "/univ-rennes?from=mail", "accept: text/html\r\n");
    assert!(head.starts_with("HTTP/1.1 301"), "{head}");
    assert_eq!((header_of(&head, "location").as_str(), header_of(&head, "vary").as_str()), ("/rennes?from=mail", "Accept"));
    assert_eq!(body, b"<p>Moved Permanently. Redirecting to /rennes?from=mail</p>");
    let (head, body) = get(&address, "GET", "/assets/missing.js", &format!("if-none-match: {etag}\r\n"));
    assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    assert_eq!((header_of(&head, "content-type").as_str(), body.as_slice()), ("text/html; charset=utf-8", &b"<p>the build's page</p>"[..]));

    // The sitemap, at this request's own address.
    let (head, body) = get(&address, "GET", "/sitemap.xml", "");
    assert_eq!(header_of(&head, "content-type"), "application/xml; charset=utf-8", "{head}");
    let sitemap = String::from_utf8(body).unwrap();
    assert!(sitemap.contains("<loc>http://tafac.exemple.test/</loc>") && sitemap.contains("<loc>http://tafac.exemple.test/rennes2</loc>"), "{sitemap}");
    assert!(node.got.lock().unwrap().is_empty());

    // Node's: a folder of the build, a hidden file, the API, another method.
    for path in ["/assets", "/.env", "/__ent_auth/session"] {
        let (head, body) = get(&address, "GET", path, "");
        assert_eq!(body, br#"{"from":"node"}"#, "{path}: {head}");
    }
    assert_eq!(get(&address, "POST", "/assets/index-abc.js", "content-length: 0\r\n").1, br#"{"from":"node"}"#);
    assert_eq!(get(&address, "POST", "/", "content-length: 0\r\n").1, br#"{"from":"node"}"#);
    assert_eq!(node.got.lock().unwrap().len(), 5);
}

#[test]
fn a_build_without_its_page_leaves_the_page_to_node() {
    let (node, build) = (node(), Build::new("no-page"));
    std::fs::remove_file(build.0.join("index.html")).unwrap();
    let address = server(Proxy::new(None, &node.address).with_page_files(build.0.clone(), "", crate::own::universities::Served::from_environment(|_| None, false).unwrap()));
    assert_eq!(get(&address, "GET", "/assets/index-abc.js", "").1, b"console.log(1)");
    for path in ["/", "/index.html", "/rennes", "/sitemap.xml", "/assets/missing.js"] {
        assert_eq!(get(&address, "GET", path, "").1, br#"{"from":"node"}"#, "{path}");
    }
}

#[test]
fn without_the_build_the_pages_files_are_nodes() {
    let node = node();
    let address = server(Proxy::new(None, &node.address));
    for path in ["/assets/index-abc.js", "/robots.txt", "/.well-known/apple-app-site-association"] {
        assert_eq!(get(&address, "GET", path, "").1, br#"{"from":"node"}"#, "{path}");
    }
    assert_eq!(node.got.lock().unwrap().len(), 3);
}

#[test]
fn the_icons_body_is_read_on_its_way_and_goes_to_node_whole_when_its_nodes() {
    let (campus, node) = (campus(), node());
    let data = std::env::temp_dir().join(format!("tafac-gateway-proxy-icons-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data);
    let address = server(Proxy::new(Some(campus.gateway().with_icons_in(&data)), &node.address));
    let cookie = format!("cookie: {COOKIE_NAME}={}\r\n", campus.alive());
    let post = |headers: &str, body: &str| {
        send(&address, format!("POST /__ent_auth/app-icons HTTP/1.1\r\nhost: tafac.exemple.test\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes())
    };

    let (head, body) = post(&format!("{cookie}content-type: application/json\r\n"), r#"{"services":[{"id":"webapp-mail","title":"Messagerie"}]}"#);
    assert_eq!(header_of(&head, ANSWERED_BY), "tonapi", "{head}");
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["icons"]["webapp-mail"]["icon"], "ph:envelope-simple-duotone");
    assert!(node.got.lock().unwrap().is_empty());

    // Nobody signed in, a body Node reads its own way, one past the limit:
    // Node gets each whole.
    let large = format!(r#"{{"services":[],"x":"{}"}}"#, "x".repeat(100 * 1024));
    for (headers, sent) in [("content-type: application/json\r\n".to_string(), r#"{"services":[]}"#.to_string()), (cookie.clone(), r#"{"services":[]}"#.to_string()), (format!("{cookie}content-type: application/json\r\n"), large)] {
        let (_, body) = post(&headers, &sent);
        assert_eq!(body, br#"{"from":"node"}"#);
        assert_eq!(node.got.lock().unwrap().last().unwrap().1, sent.len());
    }
    let _ = std::fs::remove_dir_all(&data);
}
