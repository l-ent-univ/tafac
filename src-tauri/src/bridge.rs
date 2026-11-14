// The tafac:// scheme: every request the window makes (the page, its files,
// /__ent_auth, /__ent_proxy) is handed to the local server over its Unix
// socket (named pipe on Windows), and its answer handed back. No TCP port:
// other programs and browser tabs on the computer can't reach the server.
//
// The bridge also holds the server's cookies (jar.rs).

use std::error::Error;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::header::{CONNECTION, COOKIE, HOST, SET_COOKIE, TRANSFER_ENCODING};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::jar::CookieJar;

type BoxError = Box<dyn Error + Send + Sync>;

pub struct Bridge {
    pub endpoint: String,
    pub jar: CookieJar,
}

// How long a request waits for the server to be up (it is starting when the
// window opens).
const STARTUP_WAIT: Duration = Duration::from_secs(20);

pub async fn forward(bridge: &Bridge, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    match try_forward(bridge, request).await {
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

async fn try_forward(bridge: &Bridge, request: http::Request<Vec<u8>>) -> Result<http::Response<Vec<u8>>, BoxError> {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path_and_query().map(|value| value.as_str()).unwrap_or("/");

    let mut builder = hyper::Request::builder().method(parts.method).uri(path);
    for (name, value) in parts.headers.iter() {
        if name != HOST && name != COOKIE {
            builder = builder.header(name, value);
        }
    }
    builder = builder.header(HOST, "localhost");
    if let Some(cookies) = bridge.jar.header() {
        builder = builder.header(COOKIE, cookies);
    }
    let upstream = builder.body(Full::new(Bytes::from(body)))?;

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
