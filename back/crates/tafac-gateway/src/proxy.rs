// tafac.fr's side of the gateway: its HTTP server, alone or in front of
// Node.
//
// It answers tafac.fr's own routes first (own/: the apps' remote settings,
// the desktop update), which the apps' bridge never sees; then every
// request of the page's API, as the apps' bridge does (Gateway::answer: the
// sign-in, the session, every route, for anyone). What is left, an address
// outside the API that the page's files don't take (a POST to /, any
// address where the server has no build), is Express's 404 without Node
// (no TAFAC_GATEWAY_NODE: nothing is ever passed on). With a Node behind,
// it is passed on as it came, and Node's answer back as it
// came: the method, the path and its query, every header (Host, Cookie,
// X-Forwarded-*: none added, none renamed), the body as it streams (an
// upload, a download), the status (a redirect is passed on, never
// followed), every Set-Cookie. Only what belongs to one connection stays on
// it (Connection, Keep-Alive, Transfer-Encoding…). An upgraded connection
// (the development server's WebSocket) is joined end to end.
//
// Three bodies are read here before anything is decided: a sign-in's, which
// says who signs in, the statistics', and the applications' list their
// icons are for (Gateway::reads_body). They are small: one past express.json's
// limit is refused unread (Gateway::body_too_large).
//
// Given the page's build, it answers the page's files itself
// (own/statics.rs), before the gateway and Node.
//
// Node sees the requests it gets as before, but for where they come from:
// this server, on the same machine, in place of what was in front of it.

use std::convert::Infallible;
use std::net::IpAddr;
use std::sync::Arc;

use bytes::Bytes;
use http::header::{HeaderName, CONNECTION, CONTENT_LENGTH, COOKIE, UPGRADE};
use http::{HeaderMap, Request, Response, StatusCode, Version};
use http_body_util::combinators::UnsyncBoxBody;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::Frame;
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use tokio::net::{TcpListener, TcpStream};

use crate::own::{self, Service};
use crate::session::cookie;
use crate::{Asked, Gateway, NodeAnswer, NodeRequest};

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type Body = UnsyncBoxBody<Bytes, BoxError>;

// The largest body read here, a sign-in's or the icons' (express.json's own
// limit: Node refuses a larger one, and gets it as it streams).
const MAX_SIGN_IN_BYTES: u64 = 100 * 1024;

// How long a request's head may take to come (Node's headersTimeout).
const HEADER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

// What a hop keeps to itself (RFC 9110 § 7.6.1), besides what Connection names.
const HOP_BY_HOP: &[&str] = &["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"];

pub struct Proxy {
    // None: every request goes to Node (no secret to read the session's
    // cookie with, or to write it).
    gateway: Option<Gateway>,
    // Node's address, host:port, when there is one behind.
    node: Option<String>,
    client: Client<HttpConnector, Body>,
    // tafac.fr's own services (own/), with or without a gateway.
    own: Vec<Box<dyn Service>>,
    // The page's files, when this server is given the build.
    statics: Option<crate::own::statics::Statics>,
    // The page itself, where the build has no file (own/page.rs).
    page: Option<crate::own::page::Page>,
}

fn full(body: impl Into<Bytes>) -> Body {
    Full::new(body.into()).map_err(|never: Infallible| match never {}).boxed_unsync()
}

fn plain(status: StatusCode, words: &'static str) -> Response<Body> {
    let mut response = Response::new(full(words));
    *response.status_mut() = status;
    response.headers_mut().insert("content-type", http::HeaderValue::from_static("text/plain; charset=utf-8"));
    response
}

fn strip_hop_by_hop(headers: &mut HeaderMap) {
    let named: Vec<HeaderName> = headers
        .get_all(CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| name.trim().parse().ok())
        .collect();
    for name in named {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(*name);
    }
}

// A body refused for its size, read a little further and thrown away: the
// client that is still sending it gets the refusal rather than a
// connection reset. A megabyte and five seconds at most.
async fn drained(body: Incoming) {
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), http_body_util::Limited::new(body, 1024 * 1024).collect()).await;
}

fn is_upgrade(headers: &HeaderMap) -> bool {
    headers.contains_key(UPGRADE)
        && headers.get_all(CONNECTION).iter().filter_map(|value| value.to_str().ok()).any(|value| value.to_ascii_lowercase().contains("upgrade"))
}

impl Proxy {
    // `node`: where Node listens, when there is one behind. Without it the
    // gateway answers alone: a gateway is wanted then (main.rs).
    pub fn new(gateway: Option<Gateway>, node: Option<&str>) -> Self {
        // One connection per request, as the apps' bridge: Node is on the
        // same machine, and closes an idle connection when it likes.
        let client = Client::builder(TokioExecutor::new()).pool_max_idle_per_host(0).build_http();
        Self { gateway, node: node.map(str::to_string), client, own: Vec::new(), statics: None, page: None }
    }

    // One of tafac.fr's own services, answered before the gateway and Node.
    pub fn serving(mut self, service: impl Service + 'static) -> Self {
        self.own.push(Box::new(service));
        self
    }

    // The page's files answered here, from its build (`dist`), with
    // robots.txt and Apple's file (`apple_app_ids`: APPLE_APP_IDS, as Node
    // is given it).
    // `served`: the universities this server serves, whose text and pages
    // the page is filled with. Without the build's index.html, the page
    // itself stays Node's.
    pub fn with_page_files(mut self, dist: std::path::PathBuf, apple_app_ids: &str, served: crate::own::universities::Served) -> Self {
        self.page = crate::own::page::Page::read(&dist, served);
        if self.page.is_none() {
            eprintln!("Tafac gateway: no index.html in {}: the page itself is Node's, or a 404 without Node", dist.display());
        }
        self.statics = Some(crate::own::statics::Statics::new(dist, apple_app_ids));
        self
    }

    // `peer`: the address the connection came from.
    async fn handle(self: Arc<Self>, mut request: Request<Incoming>, peer: IpAddr) -> Response<Body> {
        if let Some(statics) = &self.statics {
            if let Some(response) = statics.answer(request.method(), request.uri(), request.headers()).await {
                return response;
            }
        }
        let method = request.method().clone();
        let path = request.uri().path().to_string();
        if let Some(response) = own::answer(&self.own, &method, &path, request.headers()) {
            return response.map(full);
        }
        if let Some(page) = &self.page {
            if let Some(response) = page.answer(&method, request.uri(), request.headers()).await {
                return response.map(full);
            }
        }
        let cookie = self.gateway.as_ref().and_then(|gateway| {
            let header: Vec<&str> = request.headers().get_all(COOKIE).iter().filter_map(|value| value.to_str().ok()).collect();
            cookie::cookie_in_header(&header.join("; "), gateway.cookie_name()).map(str::to_string)
        });
        // The mail's: its body as it streams in, its answer as it streams
        // out (an upload, a part), never held whole here.
        if let Some(gateway) = &self.gateway {
            if gateway.takes_mail(&path, cookie.as_deref()) {
                let (parts, body) = request.into_parts();
                let stream: crate::ByteStream = Box::pin(body.into_data_stream().map(|chunk| chunk.map_err(BoxError::from)));
                let asked = Asked { method: &method, path: &path, query: parts.uri.query(), headers: &parts.headers, body: &[], peer: Some(peer) };
                let answered = gateway.mail(&asked, crate::MailBody::Stream(stream), || cookie.clone(), |to_node| self.ask_node(to_node)).await;
                return answered.map(|body| match body {
                    crate::MailBody::Whole(bytes) => full(bytes),
                    crate::MailBody::Stream(stream) => StreamBody::new(stream.map(|chunk| chunk.map(Frame::data))).boxed_unsync(),
                });
            }
        }

        // A sign-in's body, read here.
        let mut read = None;

        if let Some(gateway) = &self.gateway {
            if Gateway::reads_body(&method, &path) {
                // Past the limit, declared or sent: refused, and the
                // connection closed after it.
                let declared = request.headers().get(CONTENT_LENGTH).and_then(|length| length.to_str().ok()?.parse::<u64>().ok());
                let too_large = || {
                    let mut refused = Gateway::body_too_large(&method, &path).map(full);
                    refused.headers_mut().insert(CONNECTION, http::HeaderValue::from_static("close"));
                    refused
                };
                if declared.is_some_and(|length| length > MAX_SIGN_IN_BYTES) {
                    drained(request.into_body()).await;
                    return too_large();
                }
                match http_body_util::Limited::new(request.body_mut(), MAX_SIGN_IN_BYTES as usize).collect().await {
                    Ok(body) => read = Some(body.to_bytes()),
                    Err(error) if error.is::<http_body_util::LengthLimitError>() => {
                        drained(request.into_body()).await;
                        return too_large();
                    }
                    Err(_) => return plain(StatusCode::BAD_REQUEST, "Requête interrompue"),
                }
            }
            let asked = Asked {
                method: &method,
                path: &path,
                query: request.uri().query(),
                headers: request.headers(),
                body: read.as_deref().unwrap_or_default(),
                peer: Some(peer),
            };
            let answered = gateway.answer(&asked, || cookie.clone(), |to_node| self.ask_node(to_node)).await;
            if let Some(response) = answered {
                return response.map(full);
            }
            if self.node.is_some() {
                gateway.saw_request(&method, &path, cookie.as_deref());
            }
        }

        // No Node behind: nothing is passed on. Express's 404, as Node's
        // server would end the request (the page's API's as JSON).
        let Some(node) = &self.node else {
            if crate::routes::is_api(&path) {
                return crate::gateway::not_found().map(full);
            }
            return own::express::not_found(&method, &path).map(full);
        };
        let passed = if is_upgrade(request.headers()) { self.join(node, request).await } else { self.pass_on(node, request, read).await };
        match passed {
            Ok(response) => {
                if let Some(gateway) = &self.gateway {
                    gateway.saw_response(cookie.as_deref(), response.headers());
                }
                response
            }
            Err(error) => {
                eprintln!("[tafac] gateway: Node unreachable for {method} {path}: {error}");
                plain(StatusCode::BAD_GATEWAY, "Le serveur de Tafac ne répond pas")
            }
        }
    }

    // A request to Node as it came, and Node's answer as it comes. `read`:
    // its body, when it was read here.
    async fn pass_on(&self, node: &str, request: Request<Incoming>, read: Option<Bytes>) -> Result<Response<Body>, BoxError> {
        let (mut parts, body) = request.into_parts();
        let path = parts.uri.path_and_query().map_or("/", |path| path.as_str());
        parts.uri = format!("http://{node}{path}").parse()?;
        parts.version = Version::HTTP_11;
        strip_hop_by_hop(&mut parts.headers);
        let body = match read {
            Some(body) => full(body),
            None => body.map_err(BoxError::from).boxed_unsync(),
        };

        let (mut parts, body) = self.client.request(Request::from_parts(parts, body)).await?.into_parts();
        strip_hop_by_hop(&mut parts.headers);
        Ok(Response::from_parts(parts, body.map_err(BoxError::from).boxed_unsync()))
    }

    // A connection the page asks to upgrade (a WebSocket): Node's answer,
    // then the two connections joined, each side's bytes passed to the other.
    async fn join(&self, node: &str, mut request: Request<Incoming>) -> Result<Response<Body>, BoxError> {
        let stream = TcpStream::connect(node).await?;
        let (mut sender, connection) = hyper::client::conn::http1::Builder::new().preserve_header_case(true).handshake(TokioIo::new(stream)).await?;
        tokio::spawn(async move {
            let _ = connection.with_upgrades().await;
        });

        let from_page = hyper::upgrade::on(&mut request);
        let (mut parts, body) = request.into_parts();
        parts.uri = parts.uri.path_and_query().map_or("/", |path| path.as_str()).parse()?;
        let mut response = sender.send_request(Request::from_parts(parts, body.map_err(BoxError::from).boxed_unsync())).await?;

        if response.status() == StatusCode::SWITCHING_PROTOCOLS {
            let from_node = hyper::upgrade::on(&mut response);
            tokio::spawn(async move {
                if let (Ok(page), Ok(node)) = (from_page.await, from_node.await) {
                    let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(page), &mut TokioIo::new(node)).await;
                }
            });
        }
        let (parts, body) = response.into_parts();
        Ok(Response::from_parts(parts, body.map_err(BoxError::from).boxed_unsync()))
    }

    // A request the gateway makes to Node (node.rs says which: Node told
    // that a session ended), and Node's whole answer. None without a Node
    // (the gateway asks nothing then: Gateway::without_node).
    async fn ask_node(&self, request: NodeRequest) -> NodeAnswer {
        let node = self.node.as_ref()?;
        let (mut parts, body) = request.into_parts();
        let path = parts.uri.path_and_query().map_or("/", |path| path.as_str());
        parts.uri = format!("http://{node}{path}").parse().ok()?;
        parts.version = Version::HTTP_11;
        strip_hop_by_hop(&mut parts.headers);

        let (mut parts, body) = self.client.request(Request::from_parts(parts, full(body))).await.ok()?.into_parts();
        strip_hop_by_hop(&mut parts.headers);
        let body = body.collect().await.ok()?.to_bytes().to_vec();
        Some(Response::from_parts(parts, body))
    }
}

// Serves until the listener fails: each connection on its own task.
pub async fn serve(listener: TcpListener, proxy: Arc<Proxy>) -> std::io::Result<()> {
    loop {
        let (stream, peer) = listener.accept().await?;
        let proxy = proxy.clone();
        tokio::spawn(async move {
            let service = service_fn(move |request| {
                let proxy = proxy.clone();
                async move { Ok::<_, Infallible>(proxy.handle(request, peer.ip()).await) }
            });
            // A request's head within a minute, as Node's server waits for
            // it: a slow client holds no connection longer. A body's own
            // pace is each route's (the mail's upload: a minute between
            // two pieces).
            let connection = hyper::server::conn::http1::Builder::new()
                .preserve_header_case(true)
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_TIMEOUT)
                .serve_connection(TokioIo::new(stream), service);
            let _ = connection.with_upgrades().await;
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;
    use crate::testing::{block_on, campus, header_of, read_head, read_request, spawn, Campus, NODE_SAYS};

    // Node's own answer to a session check, told from a translated one by
    // what only Node says (`runtime`).
    const NODES_SESSION: &str = r#"{"authenticated":true,"user":"jdoe","sessionSource":"runtime"}"#;

    // Node, as much of it as these tests ask: it says of each request its
    // head as received, and answers by the path.
    struct Node {
        address: String,
        heads: Arc<Mutex<Vec<String>>>,
    }

    async fn node_answers(stream: &mut TcpStream, head: &str, mut body: Vec<u8>) {
        let asked = head.split_whitespace().nth(1).unwrap_or_default().to_string();
        let path = asked.split('?').next().unwrap_or_default();
        let length: usize = header_of(head, "content-length").parse().unwrap_or(0);
        let mut chunk = vec![0_u8; 64 * 1024];
        while body.len() < length {
            match stream.read(&mut chunk).await {
                Ok(read) if read > 0 => body.extend_from_slice(&chunk[..read]),
                _ => break,
            }
        }
        let answer: Vec<u8> = match path {
            "/__ent_auth/session" if header_of(head, "cookie").is_empty() => ok_json(NODE_SAYS),
            "/__ent_auth/session" => ok_json(NODES_SESSION.as_bytes()),
            "/__ent_auth/logout" => {
                b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nset-cookie: __Host-lent_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}".to_vec()
            }
            // Its own login: it says how much of the request it was given.
            "/__ent_auth/login" => {
                let said = format!(r#"{{"from":"node","read":{},"type":"{}"}}"#, body.len(), header_of(head, "content-type"));
                let mut answer = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nset-cookie: __Host-lent_session=v1.made.by.node; Path=/; HttpOnly\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", said.len()).into_bytes();
                answer.extend_from_slice(said.as_bytes());
                answer
            }
            "/redirect" => b"HTTP/1.1 302 Found\r\nlocation: https://elsewhere.exemple.test/next?ticket=1\r\nset-cookie: one=1; Path=/\r\nset-cookie: two=2; Path=/; HttpOnly\r\nx-from: node\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_vec(),
            "/echo" => {
                let mut answer = format!("HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()).into_bytes();
                answer.extend_from_slice(&body);
                answer
            }
            "/chunked" => b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n".to_vec(),
            "/socket" => {
                let _ = stream.write_all(b"HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: echo\r\n\r\n").await;
                // The connection is the page's from here: what comes, goes back.
                loop {
                    match stream.read(&mut chunk).await {
                        Ok(read) if read > 0 => {
                            if stream.write_all(&chunk[..read]).await.is_err() {
                                return;
                            }
                        }
                        _ => return,
                    }
                }
            }
            _ => ok_json(br#"{"from":"node"}"#),
        };
        let _ = stream.write_all(&answer).await;
        let _ = stream.shutdown().await;
    }

    fn ok_json(body: &[u8]) -> Vec<u8> {
        let mut answer = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()).into_bytes();
        answer.extend_from_slice(body);
        answer
    }

    fn node() -> Node {
        let heads = Arc::new(Mutex::new(Vec::new()));
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let record = heads.clone();
        spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let record = record.clone();
                spawn(async move {
                    let Some((head, body)) = read_request(&mut stream).await else { return };
                    record.lock().unwrap().push(head.clone());
                    node_answers(&mut stream, &head, body).await;
                });
            }
        });
        Node { address, heads }
    }

    impl Node {
        fn heads(&self) -> Vec<String> {
            self.heads.lock().unwrap().clone()
        }
    }

    // The gateway in front of that Node; its own address.
    fn gateway_before(node: &Node, campus: Option<&Campus>) -> String {
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let proxy = Arc::new(Proxy::new(campus.map(Campus::server_gateway), Some(&node.address)));
        spawn(async move {
            let _ = serve(listener, proxy).await;
        });
        address
    }

    // One request written as a browser writes it, and all of the answer.
    fn send(address: &str, request: &[u8]) -> (String, Vec<u8>) {
        block_on(async {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(request).await.unwrap();
            let mut answer = Vec::new();
            stream.read_to_end(&mut answer).await.unwrap();
            let split = answer.windows(4).position(|window| window == b"\r\n\r\n").unwrap();
            let head = String::from_utf8_lossy(&answer[..split]).to_string();
            let body = answer[split + 4..].to_vec();
            // An answer sent in pieces: the pieces, without their sizes.
            if header_of(&head, "transfer-encoding") == "chunked" {
                return (head, unchunked(&body));
            }
            (head, body)
        })
    }

    fn unchunked(mut body: &[u8]) -> Vec<u8> {
        let mut whole = Vec::new();
        while let Some(line_end) = body.windows(2).position(|window| window == b"\r\n") {
            let size = usize::from_str_radix(String::from_utf8_lossy(&body[..line_end]).trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            whole.extend_from_slice(&body[line_end + 2..line_end + 2 + size]);
            body = &body[line_end + 2 + size + 2..];
        }
        whole
    }

    fn get(address: &str, path: &str, headers: &str) -> (String, Vec<u8>) {
        send(address, format!("GET {path} HTTP/1.1\r\nhost: tafac.exemple.test\r\n{headers}connection: close\r\n\r\n").as_bytes())
    }

    fn session_cookie(value: &str) -> String {
        format!("cookie: theme=dark; __Host-lent_session={value}\r\n")
    }

    #[test]
    fn a_request_reaches_node_as_it_came_and_its_answer_comes_back_as_it_is() {
        let node = node();
        let address = gateway_before(&node, None);
        let (head, body) = get(&address, "/redirect?next=%2Fhome&x=1", "cookie: theme=dark; other=1\r\nx-forwarded-for: 203.0.113.7\r\nx-forwarded-proto: https\r\naccept-language: fr\r\n");

        // Node's answer: the redirect itself, both cookies, its own header.
        assert!(head.starts_with("HTTP/1.1 302 Found"), "{head}");
        assert_eq!(header_of(&head, "location"), "https://elsewhere.exemple.test/next?ticket=1");
        let cookies: Vec<&str> = head.lines().filter(|line| line.to_ascii_lowercase().starts_with("set-cookie:")).collect();
        assert_eq!(cookies.len(), 2, "{head}");
        assert!(cookies[0].ends_with("one=1; Path=/") && cookies[1].ends_with("two=2; Path=/; HttpOnly"));
        assert_eq!(header_of(&head, "x-from"), "node");
        assert!(body.is_empty());

        // What Node received: the same line, host, cookies and forwarding
        // headers, nothing added.
        let received = &node.heads()[0];
        assert!(received.starts_with("GET /redirect?next=%2Fhome&x=1 HTTP/1.1"), "{received}");
        assert_eq!(header_of(received, "host"), "tafac.exemple.test");
        assert_eq!(header_of(received, "cookie"), "theme=dark; other=1");
        assert_eq!(header_of(received, "x-forwarded-for"), "203.0.113.7");
        assert_eq!(header_of(received, "x-forwarded-proto"), "https");
        assert_eq!(header_of(received, "accept-language"), "fr");
        assert_eq!(received.lines().filter(|line| line.to_ascii_lowercase().starts_with("x-forwarded")).count(), 2);
        assert_eq!(header_of(received, "via"), "");
    }

    #[test]
    fn bodies_pass_both_ways_whatever_their_size() {
        let node = node();
        let address = gateway_before(&node, None);
        let sent: Vec<u8> = (0..3_000_000_u32).map(|index| (index % 251) as u8).collect();
        let mut request = format!("POST /echo HTTP/1.1\r\nhost: tafac.exemple.test\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", sent.len()).into_bytes();
        request.extend_from_slice(&sent);
        let (head, body) = send(&address, &request);
        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        assert_eq!(header_of(&head, "content-length"), sent.len().to_string());
        assert!(body == sent);

        // An answer Node sends in pieces comes whole.
        let (head, body) = get(&address, "/chunked", "");
        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        assert_eq!(body, b"hello world");
    }

    #[test]
    fn a_moved_route_is_answered_here_and_node_is_asked_nothing() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        let (head, body) = get(&address, "/__ent_auth/session", &session_cookie(&campus.alive()));
        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        assert_eq!(header_of(&head, "cache-control"), "no-store");
        let answer: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!((&answer["authenticated"], &answer["user"], &answer["sessionSource"]), (&true.into(), &"jdoe".into(), &"cookie".into()));

        let (head, body) = get(&address, "/__ent_auth/account", &session_cookie(&campus.alive()));
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        let answer: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(answer["account"]["email"], "jeanne.doe@exemple.test");

        // Its error too, in Node's own words: a semester id that isn't one.
        let (head, body) = get(&address, "/__ent_auth/grades/semester/abc", &session_cookie(&campus.alive()));
        assert!(head.starts_with("HTTP/1.1 400"), "{head}");
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        assert_eq!(body, br#"{"error":"Invalid semester id."}"#);

        assert!(node.heads().is_empty());
    }

    #[test]
    fn the_page_s_api_is_answered_here_for_anyone_and_node_gets_the_rest() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        // A session the gateway doesn't hold (a cookie from when Node
        // served the demo account, read as nobody's), and nobody signed in.
        let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
        for cookie in [session_cookie(&demo), String::new()] {
            let (head, body) = get(&address, "/__ent_auth/session", &cookie);
            assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
            let answer: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!((&answer["authenticated"], &answer["university"]), (&false.into(), &"univ-rennes".into()));
        }
        // Node's old planning route, no longer asked: no route.
        let (head, body) = get(&address, "/__ent_auth/planning", &session_cookie(&campus.alive()));
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert_eq!(body, br#"{"error":"Not found."}"#);
        assert!(node.heads().is_empty());
        // An address outside the API no line takes: Node's.
        let (_, body) = post(&address, "/somewhere", "", "");
        assert_eq!(body, br#"{"from":"node"}"#);
        assert_eq!(node.heads().len(), 1);
    }

    fn post(address: &str, path: &str, headers: &str, body: &str) -> (String, Vec<u8>) {
        send(address, format!("POST {path} HTTP/1.1\r\nhost: tafac.exemple.test\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes())
    }

    const JSON: &str = "content-type: application/json\r\n";

    #[test]
    fn a_sign_in_is_answered_here_with_the_sessions_cookie() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        let login = serde_json::json!({ "username": crate::testing::STUDENT, "password": crate::testing::PASSWORD, "university": "univ-rennes" }).to_string();
        let (head, body) = post(&address, "/__ent_auth/login", JSON, &login);
        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        let answer: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!((&answer["authenticated"], &answer["user"], &answer["university"]), (&true.into(), &"jdoe".into(), &"univ-rennes".into()));
        // Node wasn't asked: the session is made here.
        assert!(node.heads().is_empty());

        // The cookie the browser got is a session: the next requests are
        // answered with it, here and (for its own routes) by Node.
        let set = header_of(&head, "set-cookie");
        let value = set.strip_prefix("__Host-lent_session=").and_then(|rest| rest.split(';').next()).unwrap();
        assert!(set.contains("HttpOnly") && set.contains("Secure") && set.contains("SameSite=Lax"), "{set}");
        let (head, body) = get(&address, "/__ent_auth/session", &session_cookie(value));
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["user"], "jdoe");
        assert!(node.heads().is_empty());
    }

    #[test]
    fn a_sign_in_is_never_nodes() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        // A university the gateway doesn't serve; a body that isn't JSON;
        // one too large to be read, declared or sent in pieces.
        let here = r#"{"username":"jdoe","password":"p","university":"univ-rennes"}"#.to_string();
        let elsewhere = r#"{"username":"jdoe","password":"p","university":"univ-nulle-part"}"#.to_string();
        let large = format!(r#"{{"username":"jdoe","password":"{}","university":"univ-rennes"}}"#, "p".repeat(MAX_SIGN_IN_BYTES as usize));
        for (headers, sent, status, said) in [
            (JSON, &elsewhere, "400", r#"{"error":"Unknown university \"univ-nulle-part\"."}"#),
            ("content-type: text/plain\r\n", &here, "400", r#"{"error":"Username and password are required."}"#),
            (JSON, &large, "413", r#"{"error":"Request body too large."}"#),
        ] {
            let (head, body) = post(&address, "/__ent_auth/login", headers, sent);
            assert!(head.starts_with(&format!("HTTP/1.1 {status}")), "{head}");
            assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
            assert_eq!(String::from_utf8_lossy(&body), said);
            assert_eq!(header_of(&head, "set-cookie"), "");
        }
        let chunked = format!("POST /__ent_auth/login HTTP/1.1\r\nhost: tafac.exemple.test\r\n{JSON}transfer-encoding: chunked\r\nconnection: close\r\n\r\n{:x}\r\n{large}\r\n0\r\n\r\n", large.len());
        let (head, _) = send(&address, chunked.as_bytes());
        assert!(head.starts_with("HTTP/1.1 413"), "{head}");
        assert!(campus.seen.lock().unwrap().is_empty());
        assert!(node.heads().is_empty());

        // Without a gateway (no SESSION_SECRET), every sign-in is Node's.
        let address = gateway_before(&node, None);
        let (_, body) = post(&address, "/__ent_auth/login", JSON, r#"{"username":"jdoe","password":"the-password","university":"univ-rennes"}"#);
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["from"], "node");
    }

    #[test]
    fn a_sign_out_is_answered_here_and_node_is_told() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        let cookie = session_cookie(&campus.alive());
        assert_eq!(header_of(&get(&address, "/__ent_auth/session", &cookie).0, crate::ANSWERED_BY), "tonapi");

        // The page's sign-out, with a body of its own, which isn't read
        // here: Node is told with a request of the gateway's, not with half
        // of the page's (it would wait for the body that never comes).
        let asked_at = std::time::Instant::now();
        let (head, body) = post(&address, "/__ent_auth/logout", &format!("{cookie}content-type: application/json\r\n"), "{}");
        assert!(asked_at.elapsed() < std::time::Duration::from_secs(3), "{:?}", asked_at.elapsed());
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        assert_eq!(body, br#"{"authenticated":false}"#);
        assert!(header_of(&head, "set-cookie").starts_with("__Host-lent_session=;"), "{head}");
        // The CAS was told, and Node, with the session's cookie.
        assert!(!campus.cas_knows_the_ticket());
        let told = node.heads().into_iter().find(|head| head.starts_with("POST /__ent_auth/logout")).unwrap();
        assert!(header_of(&told, "cookie").contains("__Host-lent_session=v1."));
        assert_eq!(header_of(&told, "content-length"), "0");

        // A copy of the cookie kept past the sign-out: nobody's, here.
        let (head, body) = get(&address, "/__ent_auth/session", &cookie);
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "tonapi");
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["authenticated"], false);
        assert_eq!(node.heads().len(), 1);
    }

    #[test]
    fn a_session_found_expired_is_said_here_and_node_is_told() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        let cookie = session_cookie(&campus.alive());
        campus.cas_forgets();
        let (head, body) = get(&address, "/__ent_auth/grades", &cookie);
        assert!(head.starts_with("HTTP/1.1 401"), "{head}");
        assert_eq!(header_of(&head, "x-tafac-session"), "expired");
        assert_eq!(body, br#"{"error":"session_expired"}"#);
        assert!(header_of(&head, "set-cookie").starts_with("__Host-lent_session=;"), "{head}");
        assert!(node.heads().iter().any(|head| head.starts_with("POST /__ent_auth/logout")));
    }

    #[test]
    fn without_a_gateway_or_without_node() {
        let (campus, node) = (campus(), node());
        // No secret: everything is Node's, the moved routes too.
        let address = gateway_before(&node, None);
        let (head, body) = get(&address, "/__ent_auth/session", &session_cookie(&campus.alive()));
        assert_eq!(header_of(&head, crate::ANSWERED_BY), "");
        assert_eq!(body, NODES_SESSION.as_bytes());
        assert!(campus.seen.lock().unwrap().is_empty());

        // Node down: the page is told so, as by any server in front of it.
        let nowhere = Node { address: "127.0.0.1:1".to_string(), heads: Default::default() };
        let address = gateway_before(&nowhere, None);
        let (head, _) = get(&address, "/__ent_auth/planning", "");
        assert!(head.starts_with("HTTP/1.1 502"), "{head}");
    }

    // The gateway with no Node behind: every request answered, none passed
    // on, Node never told a session ended. A Node listens all the same,
    // not given to the server: nothing reaches it.
    #[test]
    fn without_node_every_request_is_answered_here_and_none_is_passed_on() {
        let (campus, node) = (campus(), node());
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let proxy = Arc::new(Proxy::new(Some(campus.gateway().without_node()), None));
        spawn(async move {
            let _ = serve(listener, proxy).await;
        });
        let alive = session_cookie(&campus.alive());
        // Nobody signed in, at each kind of route: Node's words, here.
        for (path, status, said) in [
            ("/__ent_auth/account", "200", serde_json::json!({ "authenticated": false, "account": null, "sessionMode": null })),
            ("/__ent_auth/apps", "200", serde_json::json!({ "authenticated": false, "apps": null })),
            ("/__ent_auth/grades/report.pdf", "401", serde_json::json!({ "error": "Not signed in." })),
            ("/__ent_auth/ade/tree", "404", serde_json::json!({ "error": "Not found." })),
            ("/__ent_proxy/api/v4-3/dlm/layout.json", "401", serde_json::json!({ "error": "Authentication required." })),
        ] {
            let (head, body) = get(&address, path, "");
            assert!(head.starts_with(&format!("HTTP/1.1 {status}")), "{path}: {head}");
            assert_eq!(header_of(&head, "x-tafac-session"), "expired", "{path}");
            assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap(), said, "{path}");
        }
        // Signed in, then signed out: the CAS is told, Node isn't.
        assert_eq!(header_of(&get(&address, "/__ent_auth/session", &alive).0, crate::ANSWERED_BY), "tonapi");
        let (head, _) = post(&address, "/__ent_auth/logout", &alive, "");
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert!(!campus.cas_knows_the_ticket());
        // A session found expired: said, and Node isn't told.
        let other = session_cookie(&campus.alive());
        campus.cas_forgets();
        let (head, _) = get(&address, "/__ent_auth/grades", &other);
        assert_eq!(header_of(&head, "x-tafac-session"), "expired");
        // What Node's server would have ended: Express's 404, no build here.
        let (head, body) = post(&address, "/", "", "");
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert_eq!(header_of(&head, "content-security-policy"), "default-src 'none'");
        assert!(String::from_utf8_lossy(&body).contains("<pre>Cannot POST /</pre>"));
        let (head, _) = get(&address, "/some/page", "");
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        // A connection asked to upgrade isn't joined to anything.
        let (head, _) = get(&address, "/socket", "connection: Upgrade\r\nupgrade: echo\r\n");
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert!(node.heads().is_empty());
    }

    // HEAD wherever GET is answered: the same status and headers, the
    // length said, no body; 404 where there is no GET.
    #[test]
    fn head_is_answered_as_get_without_its_body() {
        let (campus, node) = (campus(), node());
        let address = gateway_before(&node, Some(&campus));
        let head = |path: &str, headers: &str| send(&address, format!("HEAD {path} HTTP/1.1\r\nhost: tafac.exemple.test\r\n{headers}connection: close\r\n\r\n").as_bytes());
        let alive = session_cookie(&campus.alive());
        for (path, cookie) in [("/__ent_auth/session", ""), ("/__ent_auth/account", alive.as_str()), ("/__ent_auth/grades/semester/abc", alive.as_str()), ("/__ent_auth/student-pic?meta=1", "")] {
            let (got, body) = get(&address, path, cookie);
            let (headed, nothing) = head(path, cookie);
            assert_eq!(got.lines().next(), headed.lines().next(), "{path}");
            assert_eq!(header_of(&headed, "content-length"), body.len().to_string(), "{path}");
            for name in ["content-type", "cache-control", "x-tafac-session", crate::ANSWERED_BY] {
                assert_eq!(header_of(&headed, name), header_of(&got, name), "{path}: {name}");
            }
            assert!(nothing.is_empty(), "{path}");
        }
        let catalogue = format!("http://127.0.0.1:{}/library/catalogue", campus.port());
        let (headed, _) = head(&format!("/__ent_auth/launch?url={}", catalogue.replace(':', "%3A").replace('/', "%2F")), "");
        assert!(headed.starts_with("HTTP/1.1 302"), "{headed}");
        let (headed, _) = head("/__ent_auth/login", "");
        assert!(headed.starts_with("HTTP/1.1 404"), "{headed}");
        assert!(node.heads().is_empty());
    }

    #[test]
    fn an_upgraded_connection_is_joined_end_to_end() {
        let node = node();
        let address = gateway_before(&node, None);
        block_on(async {
            let mut stream = TcpStream::connect(&address).await.unwrap();
            stream.write_all(b"GET /socket HTTP/1.1\r\nhost: tafac.exemple.test\r\nconnection: Upgrade\r\nupgrade: echo\r\n\r\n").await.unwrap();
            let head = read_head(&mut stream).await.unwrap();
            assert!(head.starts_with("HTTP/1.1 101"), "{head}");
            assert_eq!(header_of(&head, "upgrade"), "echo");
            for message in [&b"first"[..], &b"second, longer"[..]] {
                stream.write_all(message).await.unwrap();
                let mut back = vec![0_u8; message.len()];
                stream.read_exact(&mut back).await.unwrap();
                assert_eq!(back, message);
            }
        });
        assert_eq!(header_of(&node.heads()[0], "upgrade"), "echo");
    }
}
