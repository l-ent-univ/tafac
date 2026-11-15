// The tafac:// scheme: every request the window makes (the page, its files,
// /__ent_auth, /__ent_proxy) is handed to the local server over its Unix
// socket (named pipe on Windows), and its answer handed back. No TCP port:
// other programs and browser tabs on the computer can't reach the server.
//
// The bridge also holds the server's cookies (jar.rs), and signs in again
// with the kept login when an answer says the session is gone (signin.rs):
// the request is then asked again, and the page gets the second answer.

use std::error::Error;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http::{HeaderMap, HeaderValue, Method};
use http_body_util::{BodyExt, Full};
use hyper::header::{CONNECTION, CONTENT_TYPE, COOKIE, HOST, SET_COOKIE, TRANSFER_ENCODING};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::jar::CookieJar;
use crate::signin::{self, KeptLogin, Outcome, SignIn};

type BoxError = Box<dyn Error + Send + Sync>;

pub struct Bridge {
    pub endpoint: String,
    pub jar: CookieJar,
    pub signin: SignIn,
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
    let (parts, body) = request.into_parts();
    let outgoing = Outgoing {
        path: parts.uri.path_and_query().map(|value| value.as_str()).unwrap_or("/").to_string(),
        method: parts.method,
        headers: parts.headers,
        body: Bytes::from(body),
    };
    let path = parts.uri.path();

    if outgoing.method == Method::POST && path == signin::LOGIN_PATH {
        let response = send_or_answer(bridge, &outgoing, true).await;
        let university = header(&outgoing.headers, signin::UNIVERSITY_HEADER);
        bridge.signin.after_login(&outgoing.body, university, response.status().as_u16(), response.body()).await;
        return response;
    }
    if outgoing.method == Method::POST && path == signin::LOGOUT_PATH {
        bridge.signin.before_logout(header(&outgoing.headers, signin::LOGOUT_REASON_HEADER)).await;
        return send_or_answer(bridge, &outgoing, true).await;
    }

    let round = bridge.signin.round();
    let response = send_or_answer(bridge, &outgoing, true).await;
    let signed_out = signin::says_signed_out(
        path,
        response.status().as_u16(),
        header(response.headers(), signin::SESSION_HEADER),
        response.body(),
    );
    if signed_out && bridge.signin.again(round, |login| sign_in_again(bridge, login)).await {
        return send_or_answer(bridge, &outgoing, true).await;
    }
    response
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

// The kept login, sent as the page sends one, without the old session's
// cookie. Its answer's cookie goes to the jar: the session the retried
// requests then carry.
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
    let response = send_or_answer(bridge, &outgoing, false).await;
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

    let response = send(&bridge.endpoint, upstream).await?;
    let (parts, body) = response.into_parts();
    bridge
        .jar
        .store(parts.headers.get_all(SET_COOKIE).iter().filter_map(|value| value.to_str().ok()));
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
