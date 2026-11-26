// The tafac:// scheme: every request the window makes (the page, its files,
// /__ent_auth, /__ent_proxy) is answered here, and its answer handed back.
// No TCP port: other programs and browser tabs on the computer can't reach
// the app's server.
//
// Who answers:
//
//   the gateway    in the app itself (back/crates/tafac-gateway, the same
//                  code as on tafac.fr): it signs the student in through
//                  tonAPI, holds the session, and answers the routes that
//                  have moved
//   the server     Node, over its Unix socket (named pipe on Windows): every
//                  other route, and what the gateway leaves or asks it
//
// The bridge also holds the session's cookie (jar.rs: the window never sees
// it), whoever set it, and signs in again with the kept login when an answer
// says the session is gone (signin.rs): the request is then asked again, and
// the page gets the second answer.
//
// The page's built files (/assets/…) are asked for once and answered from
// memory after that (assets.rs): WebKit keeps nothing from this scheme, and
// reads a video a few bytes at a time.

use std::error::Error;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http::{HeaderMap, HeaderValue, Method};
use http_body_util::{BodyExt, Full};
use hyper::header::{CONNECTION, CONTENT_TYPE, COOKIE, HOST, IF_MODIFIED_SINCE, IF_NONE_MATCH, IF_RANGE, RANGE, SET_COOKIE, TRANSFER_ENCODING};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};

use tafac_gateway::session::cookie::clears_cookie;
use tafac_gateway::{Asked, Gateway, NodeAnswer, NodeRequest};

use crate::assets::{self, Assets};
use crate::jar::CookieJar;
use crate::signin::{self, KeptLogin, Outcome, SignIn};

type BoxError = Box<dyn Error + Send + Sync>;

pub struct Bridge {
    pub endpoint: String,
    pub jar: CookieJar,
    pub signin: SignIn,
    pub assets: Assets,
    // What signs in and answers the moved routes in the app itself; None:
    // the server does it all.
    pub gateway: Option<Gateway>,
}

impl Bridge {
    pub fn new(endpoint: String, jar: CookieJar, signin: SignIn) -> Self {
        Self { endpoint, jar, signin, assets: Assets::default(), gateway: None }
    }

    // With the gateway, for the app's own server: the secret both write and
    // read the session's cookie with, and the cookie's name (the app's
    // server always runs in production).
    pub fn with_gateway(mut self, session_secret: &str) -> Self {
        self.gateway = Some(Gateway::new(session_secret, tafac_gateway::PRODUCTION_COOKIE));
        // Development: TAFAC_NO_TONAPI=1 leaves every route to the server,
        // to compare the two on the same build.
        #[cfg(debug_assertions)]
        if std::env::var_os("TAFAC_NO_TONAPI").is_some() {
            self.gateway = None;
        }
        self
    }

    // The session's cookie, as the jar holds it now.
    fn session_cookie(&self) -> Option<String> {
        self.jar.get(self.gateway.as_ref()?.cookie_name())
    }
}

// How long a request waits for the server to be up (it is starting when the
// window opens).
const STARTUP_WAIT: Duration = Duration::from_secs(20);

// A request as it goes to the server, kept whole to be sent again.
struct Outgoing {
    method: Method,
    path: String,
    headers: HeaderMap,
    body: Bytes,
}

pub async fn forward(bridge: &Bridge, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    // Development: TAFAC_LOG_REQUESTS=1 says what the page asks, how long
    // each answer took, and which ones tonAPI gave in the server's place.
    #[cfg(debug_assertions)]
    let asked = std::env::var_os("TAFAC_LOG_REQUESTS").map(|_| (format!("{} {}", request.method(), request.uri().path()), Instant::now()));
    let response = answer(bridge, request).await;
    #[cfg(debug_assertions)]
    if let Some((what, since)) = asked {
        let by = if response.headers().contains_key(tafac_gateway::ANSWERED_BY) { " tonapi" } else { "" };
        // Written at once: the system's log cuts a line that comes in pieces.
        let line = format!("[tafac] {what} {} {}ms {}b{by}", response.status().as_u16(), since.elapsed().as_millis(), response.body().len());
        eprintln!("{line}");
    }
    response
}

async fn answer(bridge: &Bridge, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let (parts, body) = request.into_parts();
    let outgoing = Outgoing {
        path: parts.uri.path_and_query().map(|value| value.as_str()).unwrap_or("/").to_string(),
        method: parts.method,
        headers: parts.headers,
        body: Bytes::from(body),
    };
    let path = parts.uri.path();

    if assets::is_asset(&outgoing.method, path) {
        if let Some(response) = asset(bridge, &outgoing, path).await {
            return response;
        }
    }

    if outgoing.method == Method::POST && path == signin::LOGIN_PATH {
        let response = ask(bridge, &outgoing, true).await;
        let university = header(&outgoing.headers, signin::UNIVERSITY_HEADER);
        bridge.signin.after_login(&outgoing.body, university, response.status().as_u16(), response.body()).await;
        return response;
    }
    if outgoing.method == Method::POST && path == signin::LOGOUT_PATH {
        bridge.signin.before_logout(header(&outgoing.headers, signin::LOGOUT_REASON_HEADER)).await;
        return ask(bridge, &outgoing, true).await;
    }

    let round = bridge.signin.round();
    let response = ask(bridge, &outgoing, true).await;
    let signed_out = signin::says_signed_out(
        path,
        response.status().as_u16(),
        header(response.headers(), signin::SESSION_HEADER),
        response.body(),
    );
    if signed_out && bridge.signin.again(round, |login| sign_in_again(bridge, login)).await {
        return ask(bridge, &outgoing, true).await;
    }
    response
}

// A request answered: in the app itself when the gateway has its answer (a
// sign-in, a session it holds, a route that moved), by the server otherwise.
// `with_cookies`: whether it goes with the session's cookie.
async fn ask(bridge: &Bridge, outgoing: &Outgoing, with_cookies: bool) -> http::Response<Vec<u8>> {
    if let Some(response) = answered_here(bridge, outgoing, with_cookies).await {
        return response;
    }
    // A sign-out the server answers ends the session for the gateway as it
    // leaves.
    if let Some(gateway) = bridge.gateway.as_ref().filter(|_| with_cookies) {
        gateway.saw_request(&outgoing.method, path_of(outgoing), bridge.session_cookie().as_deref());
    }
    send_or_answer(bridge, outgoing, with_cookies).await
}

fn path_of(outgoing: &Outgoing) -> &str {
    outgoing.path.split('?').next().unwrap_or_default()
}

// The gateway's answer, when it has one. The session's cookie it sets or
// takes away goes to the jar, not to the window. None: the server answers.
async fn answered_here(bridge: &Bridge, outgoing: &Outgoing, with_cookies: bool) -> Option<http::Response<Vec<u8>>> {
    let gateway = bridge.gateway.as_ref()?;
    let session_cookie = || bridge.session_cookie().filter(|_| with_cookies);
    let sent_with = session_cookie();
    let asked = Asked {
        method: &outgoing.method,
        path: path_of(outgoing),
        query: outgoing.path.split_once('?').map(|(_, query)| query),
        headers: &outgoing.headers,
        body: &outgoing.body,
        // One student, one process: no address to count sign-ins by.
        peer: None,
    };
    let response = gateway.answer(&asked, session_cookie, |request| server_asked(bridge, request)).await?;
    let (mut parts, body) = response.into_parts();
    keep_cookies(bridge, &parts.headers, sent_with.as_deref());
    parts.headers.remove(SET_COOKIE);
    Some(http::Response::from_parts(parts, body))
}

// As the app starts: the session check the page is about to ask for, made
// while the server and the page start (the gateway's check_early).
pub async fn start_ahead(bridge: &Bridge) {
    if let Some(gateway) = bridge.gateway.as_ref() {
        gateway.check_early(bridge.session_cookie().as_deref(), |request| server_asked(bridge, request)).await;
    }
}

// A request the gateway makes to the server (what the server is set up for,
// a session that ended), and the server's whole answer. It goes as the gateway wrote it, and nothing of
// the answer is kept here: the gateway says what goes to the page.
async fn server_asked(bridge: &Bridge, request: NodeRequest) -> NodeAnswer {
    let (parts, body) = request.into_parts();
    let mut builder = hyper::Request::builder().method(parts.method).uri(parts.uri.path_and_query().map_or("/", |path| path.as_str()));
    for (name, value) in parts.headers.iter().filter(|(name, _)| *name != HOST) {
        builder = builder.header(name, value);
    }
    let upstream = builder.header(HOST, "localhost").body(Full::new(Bytes::from(body))).ok()?;
    let (mut parts, body) = send(&bridge.endpoint, upstream).await.ok()?.into_parts();
    for name in [TRANSFER_ENCODING, CONNECTION] {
        parts.headers.remove(name);
    }
    let body = body.collect().await.ok()?.to_bytes().to_vec();
    Some(http::Response::from_parts(parts, body))
}

// An answer's cookies, kept in the jar. `sent_with`: the session cookie the
// request left with. An answer that takes the session's cookie away is
// about that session: when the jar holds another by now (the app signed in
// again meanwhile), that one stays.
fn keep_cookies(bridge: &Bridge, headers: &HeaderMap, sent_with: Option<&str>) {
    let session = bridge.gateway.as_ref().map(Gateway::cookie_name);
    let stale = |set_cookie: &&str| session.is_some_and(|name| clears_cookie(set_cookie, name) && bridge.jar.get(name).as_deref() != sent_with);
    // Sorted out before the jar is opened: it is read to tell which.
    let kept: Vec<&str> = headers.get_all(SET_COOKIE).iter().filter_map(|value| value.to_str().ok()).filter(|set_cookie| !stale(set_cookie)).collect();
    bridge.jar.store(kept.into_iter());
}

// One of the page's built files, from memory; the first time, from the
// server, asked for the whole file whatever part the page wanted. None when
// the server has no such file to give whole: it answers the request itself.
async fn asset(bridge: &Bridge, outgoing: &Outgoing, path: &str) -> Option<http::Response<Vec<u8>>> {
    let range = header(&outgoing.headers, RANGE.as_str());
    if let Some(file) = bridge.assets.get(path) {
        return Some(assets::answer(&file, range));
    }
    let _one_at_a_time = bridge.assets.fetching.lock().await;
    if let Some(file) = bridge.assets.get(path) {
        return Some(assets::answer(&file, range));
    }
    let mut headers = outgoing.headers.clone();
    for name in [RANGE, IF_RANGE, IF_NONE_MATCH, IF_MODIFIED_SINCE] {
        headers.remove(name);
    }
    let whole = Outgoing { method: Method::GET, path: outgoing.path.clone(), headers, body: Bytes::new() };
    let response = try_forward(bridge, &whole, false).await.ok()?;
    if response.status() != http::StatusCode::OK {
        return None;
    }
    Some(assets::answer(&bridge.assets.keep(path, response), range))
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

// The kept login, sent as the page sends one, without the old session's
// cookie: answered by the gateway (tonAPI signs in) or by the server, as
// the page's own. Its answer's cookie goes to the jar: the session the
// retried requests then carry.
async fn sign_in_again(bridge: &Bridge, login: KeptLogin) -> Outcome {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(value) = login.university.as_deref().and_then(|id| HeaderValue::from_str(id).ok()) {
        headers.insert(signin::UNIVERSITY_HEADER, value);
    }
    let outgoing = Outgoing {
        method: Method::POST,
        path: signin::LOGIN_PATH.to_string(),
        headers,
        body: Bytes::from(signin::login_request_body(&login)),
    };
    let response = ask(bridge, &outgoing, false).await;
    signin::outcome(response.status().as_u16(), response.body())
}

async fn send_or_answer(bridge: &Bridge, outgoing: &Outgoing, with_cookies: bool) -> http::Response<Vec<u8>> {
    match try_forward(bridge, outgoing, with_cookies).await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[tafac] local server unreachable: {error}");
            http::Response::builder()
                .status(502)
                .header("content-type", "text/plain; charset=utf-8")
                .body(format!("Le serveur local de Tafac ne répond pas ({error})").into_bytes())
                .unwrap()
        }
    }
}

async fn try_forward(bridge: &Bridge, outgoing: &Outgoing, with_cookies: bool) -> Result<http::Response<Vec<u8>>, BoxError> {
    let mut builder = hyper::Request::builder().method(outgoing.method.clone()).uri(outgoing.path.as_str());
    for (name, value) in outgoing.headers.iter() {
        if name != HOST && name != COOKIE {
            builder = builder.header(name, value);
        }
    }
    builder = builder.header(HOST, "localhost");
    if let Some(cookies) = bridge.jar.header().filter(|_| with_cookies) {
        builder = builder.header(COOKIE, cookies);
    }
    let upstream = builder.body(Full::new(outgoing.body.clone()))?;
    let session_cookie = bridge.session_cookie().filter(|_| with_cookies);

    let response = send(&bridge.endpoint, upstream).await?;
    let (parts, body) = response.into_parts();
    // A session the server says is gone is gone for the gateway too.
    if let Some(gateway) = &bridge.gateway {
        gateway.saw_response(session_cookie.as_deref(), &parts.headers);
    }
    keep_cookies(bridge, &parts.headers, session_cookie.as_deref());
    let body = body.collect().await?.to_bytes().to_vec();

    let mut builder = http::Response::builder().status(parts.status);
    for (name, value) in parts.headers.iter() {
        if name != SET_COOKIE && name != TRANSFER_ENCODING && name != CONNECTION {
            builder = builder.header(name, value);
        }
    }
    Ok(builder.body(body)?)
}

async fn send(
    endpoint: &str,
    request: hyper::Request<Full<Bytes>>,
) -> Result<hyper::Response<hyper::body::Incoming>, BoxError> {
    let deadline = Instant::now() + STARTUP_WAIT;
    loop {
        match open(endpoint).await {
            Ok(stream) => return exchange(stream, request).await,
            Err(_) if Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(100)).await,
            Err(error) => return Err(error.into()),
        }
    }
}

// One connection per request: local, so cheap, and no pool to manage.
async fn exchange<S>(
    stream: S,
    request: hyper::Request<Full<Bytes>>,
) -> Result<hyper::Response<hyper::body::Incoming>, BoxError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    Ok(sender.send_request(request).await?)
}

#[cfg(unix)]
async fn open(endpoint: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(endpoint).await
}

#[cfg(windows)]
async fn open(endpoint: &str) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint)
}

// What the gateway answers and what still goes to the server, through the
// bridge itself: the gateway's made-up campus, and a made-up server on a
// socket.
#[cfg(all(test, unix))]
mod tests {
    use std::future::Future;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    use tafac_gateway::testing::{campus, header_of, read_head, Campus, CODE, COOKIE_NAME, NODE_SAYS, PASSWORD, STUDENT, STUDENT_WITH_CODE};
    use tafac_gateway::ANSWERED_BY;
    use tokio::io::AsyncWriteExt;

    use super::*;

    // The server's own answer to a session check, told from a translated
    // one by what only the server says (`runtime`).
    const SERVERS_SESSION: &str = r#"{"authenticated":true,"user":"jdoe","sessionSource":"runtime"}"#;
    const SERVERS_OTHER: &str = r#"{"from":"the server"}"#;
    const SIGNED_OUT: &str = "{}";
    // The server's own sign-in, and the cookie of the session it makes.
    const SERVERS_LOGIN: &str = r#"{"authenticated":true,"user":"otp-user","sessionMode":null,"from":"the server"}"#;
    const SERVERS_COOKIE: &str = "v1.made.by.the-server";

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    // The local server, as much of it as the bridge asks here.
    struct Server {
        endpoint: String,
        // Each request received: its method and path, and whether it came
        // with the session's cookie.
        seen: Arc<Mutex<Vec<(String, bool)>>>,
    }

    fn server() -> Server {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!("tafac-bridge-test-{}-{}.sock", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
        let endpoint = std::env::temp_dir().join(name);
        let _ = std::fs::remove_file(&endpoint);
        let listener = block_on(async { tokio::net::UnixListener::bind(&endpoint) }).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let record = record.clone();
                tauri::async_runtime::spawn(async move {
                    let Some(head) = read_head(&mut stream).await else { return };
                    let mut words = head.split_whitespace();
                    let asked = format!("{} {}", words.next().unwrap_or_default(), words.next().unwrap_or_default());
                    let with_cookie = !header_of(&head, "cookie").is_empty();
                    let (body, extra) = match (asked.as_str(), with_cookie) {
                        ("GET /__ent_auth/session", false) => (String::from_utf8_lossy(NODE_SAYS).to_string(), String::new()),
                        ("GET /__ent_auth/session", true) => (SERVERS_SESSION.to_string(), String::new()),
                        // Its own sign-in makes a session of its own.
                        ("POST /__ent_auth/login", _) => (SERVERS_LOGIN.to_string(), format!("set-cookie: {COOKIE_NAME}={SERVERS_COOKIE}; Path=/; HttpOnly\r\n")),
                        // A sign-out clears the session's cookie.
                        ("POST /__ent_auth/logout", _) => (SIGNED_OUT.to_string(), format!("set-cookie: {COOKIE_NAME}=; Path=/; Max-Age=0\r\n")),
                        _ => (SERVERS_OTHER.to_string(), String::new()),
                    };
                    record.lock().unwrap().push((asked, with_cookie));
                    let answer = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(answer.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        Server { endpoint: endpoint.to_string_lossy().to_string(), seen }
    }

    impl Server {
        fn seen(&self) -> Vec<(String, bool)> {
            self.seen.lock().unwrap().clone()
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.endpoint);
        }
    }

    // A jar that holds the session cookie, as after a sign-in; an empty
    // one without.
    fn jar_with(session_cookie: Option<&str>) -> CookieJar {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!("tafac-bridge-test-{}-{}.json", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
        // No expiry: nothing is saved to the file.
        let jar = CookieJar::load(std::env::temp_dir().join(name));
        if let Some(session_cookie) = session_cookie {
            jar.store([format!("{COOKIE_NAME}={session_cookie}; Path=/; HttpOnly").as_str()].into_iter());
        }
        jar
    }

    fn bridge(server: &Server, campus: Option<&Campus>, session_cookie: &str) -> Bridge {
        let mut bridge = Bridge::new(server.endpoint.clone(), jar_with(Some(session_cookie)), SignIn::new(None));
        bridge.gateway = campus.map(Campus::gateway);
        bridge
    }

    // The app as it first opens: nobody signed in.
    fn signed_out_bridge(server: &Server, campus: &Campus) -> Bridge {
        let mut bridge = Bridge::new(server.endpoint.clone(), jar_with(None), SignIn::new(None));
        bridge.gateway = Some(campus.gateway());
        bridge
    }

    fn ask(bridge: &Bridge, method: &str, path: &str) -> http::Response<Vec<u8>> {
        let request = http::Request::builder().method(method).uri(format!("tafac://localhost{path}")).body(Vec::new()).unwrap();
        block_on(forward(bridge, request))
    }

    // The page's sign-in, as src/entApi.js sends it.
    fn sign_in(bridge: &Bridge, username: &str, password: &str) -> http::Response<Vec<u8>> {
        sign_in_with(bridge, username, password, None)
    }

    // `code`: the one-time code of a sign-in with a second factor.
    fn sign_in_with(bridge: &Bridge, username: &str, password: &str, code: Option<&str>) -> http::Response<Vec<u8>> {
        let mut body = serde_json::json!({ "username": username, "password": password, "university": "univ-rennes" });
        if let Some(code) = code {
            body["otp"] = code.into();
        }
        let body = body.to_string();
        let request = http::Request::builder()
            .method("POST")
            .uri("tafac://localhost/__ent_auth/login")
            .header("content-type", "application/json")
            .body(body.into_bytes())
            .unwrap();
        block_on(forward(bridge, request))
    }

    fn by_tonapi(response: &http::Response<Vec<u8>>) -> bool {
        response.headers().contains_key(ANSWERED_BY)
    }

    fn session_request(with_cookie: bool) -> (String, bool) {
        ("GET /__ent_auth/session".to_string(), with_cookie)
    }

    #[test]
    fn a_sign_in_is_made_in_the_app_and_its_cookie_kept_from_the_window() {
        let (campus, server) = (campus(), server());
        let bridge = signed_out_bridge(&server, &campus);
        let response = sign_in(&bridge, STUDENT, PASSWORD);
        assert_eq!(response.status(), 200);
        assert!(by_tonapi(&response));
        let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!((&answer["authenticated"], &answer["user"]), (&true.into(), &"jdoe".into()));
        // The cookie is the jar's: the window gets none.
        assert!(response.headers().get(SET_COOKIE).is_none());
        assert!(bridge.session_cookie().is_some_and(|cookie| cookie.starts_with("v1.")));
        // The login is kept to sign in again, as after a sign-in the server made.
        assert!(bridge.signin.has_kept());
        // The server was asked nothing: the password went from the app to the CAS.
        assert!(server.seen().is_empty());
        assert_eq!(campus.posted_to("/cas/login"), 1);

        // The session is one like any other, here and for the server's routes.
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
        assert_eq!(ask(&bridge, "GET", "/__ent_auth/planning").body(), SERVERS_OTHER.as_bytes());
        assert_eq!(server.seen(), [("GET /__ent_auth/planning".to_string(), true)]);
    }

    #[test]
    fn a_sign_in_the_cas_refuses_keeps_nothing() {
        let (campus, server) = (campus(), server());
        let bridge = signed_out_bridge(&server, &campus);
        let response = sign_in(&bridge, STUDENT, "not-the-password");
        assert_eq!(response.status(), 401);
        let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(answer["code"], "login_refused");
        assert_eq!(bridge.session_cookie(), None);
        assert!(!bridge.signin.has_kept());
        assert!(server.seen().is_empty());
    }

    #[test]
    fn a_second_factor_is_answered_in_the_app() {
        let (campus, server) = (campus(), server());
        let bridge = signed_out_bridge(&server, &campus);
        // The CAS answers the password with its code page: a code is wanted,
        // and the student's only way to one left unasked. No session yet.
        let response = sign_in(&bridge, STUDENT_WITH_CODE, PASSWORD);
        assert!(by_tonapi(&response));
        assert_eq!(response.status(), 401);
        let answer: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!((&answer["code"], &answer["mfa"]["sent"]), (&serde_json::json!("mfa_required"), &serde_json::json!("mail")));
        assert_eq!(bridge.session_cookie(), None);
        assert_eq!(campus.codes_sent().len(), 1);

        // The code: the session is made in the app, and a login that needed
        // a code isn't one the app keeps to sign in again by itself.
        let response = sign_in_with(&bridge, STUDENT_WITH_CODE, PASSWORD, Some(CODE));
        assert!(by_tonapi(&response));
        assert_eq!(response.status(), 200);
        assert!(bridge.session_cookie().is_some());
        assert!(!bridge.signin.has_kept());
        // The server's own login was never asked.
        assert!(server.seen().is_empty());
    }

    #[test]
    fn a_session_found_expired_is_signed_in_again_without_the_page_seeing_it() {
        let (campus, server) = (campus(), server());
        let first = campus.alive();
        let bridge = bridge(&server, Some(&campus), &first);
        // The login the app kept at the student's sign-in.
        let kept = serde_json::json!({ "username": STUDENT, "password": PASSWORD, "university": "univ-rennes" }).to_string();
        block_on(bridge.signin.after_login(kept.as_bytes(), None, 200, br#"{"authenticated":true}"#));
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/grades")));

        // The CAS ended the session (Rennes' does, half an hour in).
        campus.cas_forgets();
        let deadlines = ask(&bridge, "GET", "/__ent_auth/moodle/deadlines");
        // The gateway found it expired, the bridge signed in again with the
        // kept login and asked again: the page gets the deadlines.
        assert_eq!(deadlines.status(), 200);
        assert!(by_tonapi(&deadlines));
        assert!(deadlines.headers().get(signin::SESSION_HEADER).is_none());
        let second = bridge.session_cookie().unwrap();
        assert_ne!(second, first);
        // Signed in again in the app: the password went to the CAS once.
        assert_eq!(campus.posted_to("/cas/login"), 1);
        // The server: told the first session ended, with that session's cookie.
        assert_eq!(server.seen(), [("POST /__ent_auth/logout".to_string(), true)]);
    }

    #[test]
    fn an_answer_about_a_session_gone_since_leaves_the_new_ones_cookie() {
        let (campus, server) = (campus(), server());
        let current = campus.alive();
        let bridge = bridge(&server, Some(&campus), &current);
        // A request left with the old session's cookie; the app signed in
        // again before its answer came, and the answer takes « the »
        // session's cookie away.
        let mut headers = HeaderMap::new();
        headers.append(SET_COOKIE, HeaderValue::from_str(&format!("{COOKIE_NAME}=; Path=/; Max-Age=0")).unwrap());
        keep_cookies(&bridge, &headers, Some("v1.the.old.session"));
        assert_eq!(bridge.session_cookie().as_deref(), Some(current.as_str()));
        // The same answer to a request of the session there is.
        keep_cookies(&bridge, &headers, Some(&current));
        assert_eq!(bridge.session_cookie(), None);
    }

    #[test]
    fn a_session_tonapi_answers_for_reaches_the_server_only_for_what_it_says_of_itself() {
        let (campus, server) = (campus(), server());
        let bridge = bridge(&server, Some(&campus), &campus.alive());

        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(by_tonapi(&session));
        let answer: serde_json::Value = serde_json::from_slice(session.body()).unwrap();
        assert_eq!((&answer["authenticated"], &answer["user"], &answer["sessionSource"]), (&true.into(), &"jdoe".into(), &"cookie".into()));
        // Asked once what it is set up for, without the session's cookie.
        assert_eq!(server.seen(), [session_request(false)]);

        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/session")));
        assert_eq!(server.seen().len(), 1);
    }

    #[test]
    fn what_tonapi_leaves_is_the_servers_own_answer() {
        let (campus, server) = (campus(), server());
        // The portal answers for another name than the session's: nobody's
        // answer here, the server's own to give.
        let someone_else = campus.cookie(serde_json::json!({}), &[("JSESSIONID", "someone-else")]);
        let bridge = bridge(&server, Some(&campus), &someone_else);

        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(!by_tonapi(&session));
        assert_eq!(session.body(), SERVERS_SESSION.as_bytes());
        // The student's request, as the page sent it, with the cookie; and
        // the question of what the server is set up for, asked meanwhile.
        let mut seen = server.seen();
        seen.sort();
        assert_eq!(seen, [session_request(false), session_request(true)]);

        let account = ask(&bridge, "GET", "/__ent_auth/account");
        assert_eq!(account.body(), SERVERS_OTHER.as_bytes());
        assert_eq!(server.seen()[2], ("GET /__ent_auth/account".to_string(), true));
    }

    #[test]
    fn every_other_request_goes_to_the_server() {
        let (campus, server) = (campus(), server());
        let bridge = bridge(&server, Some(&campus), &campus.alive());
        for (method, path) in [
            ("GET", "/__ent_auth/planning"),
            ("POST", "/__ent_auth/ade/upcoming"),
            ("GET", "/__ent_proxy/api/v4-3/dlm/layout.json"),
            ("GET", "/__ent_auth/universities"),
            ("POST", "/__ent_auth/session"),
            ("GET", "/"),
        ] {
            let response = ask(&bridge, method, path);
            assert!(!by_tonapi(&response), "{method} {path}");
            assert_eq!(response.body(), SERVERS_OTHER.as_bytes(), "{method} {path}");
        }
        assert_eq!(server.seen().len(), 6);
        assert!(campus.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn asked_ahead_as_the_app_starts_the_first_check_asks_nobody() {
        let (campus, server) = (campus(), server());
        let bridge = bridge(&server, Some(&campus), &campus.alive());
        block_on(start_ahead(&bridge));
        let (portal, local) = (campus.paths().len(), server.seen().len());
        assert_eq!((portal, local), (1, 1));

        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/session")));
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
        assert_eq!((campus.paths().len(), server.seen().len()), (portal, local));
    }

    #[test]
    fn a_sign_out_is_answered_in_the_app_and_the_server_is_told() {
        let (campus, server) = (campus(), server());
        let cookie = campus.alive();
        let bridge = bridge(&server, Some(&campus), &cookie);
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/session")));
        let asked_before = server.seen().len();

        let response = ask(&bridge, "POST", "/__ent_auth/logout");
        assert!(by_tonapi(&response));
        assert_eq!(response.body(), br#"{"authenticated":false}"#);
        assert!(!campus.cas_knows_the_ticket());
        // The server was told, with the session's cookie, for what it kept.
        assert_eq!(server.seen()[asked_before..], [("POST /__ent_auth/logout".to_string(), true)]);
        // The jar lost the cookie, and the gateway the session: even with
        // the cookie put back (a copy kept), the server answers.
        assert_eq!(bridge.session_cookie(), None);
        bridge.jar.store([format!("{COOKIE_NAME}={cookie}; Path=/").as_str()].into_iter());
        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(!by_tonapi(&session));
        assert_eq!(session.body(), SERVERS_SESSION.as_bytes());
    }

    #[test]
    fn without_the_gateway_the_server_answers_everything() {
        let (campus, server) = (campus(), server());
        let bridge = bridge(&server, None, &campus.alive());
        block_on(start_ahead(&bridge));
        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert_eq!(session.body(), SERVERS_SESSION.as_bytes());
        assert_eq!(server.seen(), [session_request(true)]);
        assert!(campus.seen.lock().unwrap().is_empty());
    }
}
