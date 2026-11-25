// A made-up campus for the tests, here and in what uses the crate (the
// apps' bridge): a portal and its CAS on this computer, as much of them as
// tonAPI asks, and Node's cookie for a student there.

use std::future::Future;
use std::sync::{Arc, LazyLock, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tonapi_config::ResolvedUniversity;

use crate::{session_link, Gateway};

pub const SECRET: &str = "a secret of the tests, long enough to be one";
pub const UNIVERSITY: &str = "univ-rennes";
pub const COOKIE_NAME: &str = session_link::PRODUCTION_COOKIE;
// Node's answer to a session check without a session.
pub const NODE_SAYS: &[u8] = br#"{"authenticated":false,"user":null,"analyticsEnabled":true,"university":"univ-rennes"}"#;

// The campus's listeners live on a runtime of their own, whatever runs the
// test that asks them.
static RUNTIME: LazyLock<tokio::runtime::Runtime> =
    LazyLock::new(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("a runtime for the tests"));

pub fn block_on<F: Future>(future: F) -> F::Output {
    RUNTIME.block_on(future)
}

pub fn spawn<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    RUNTIME.spawn(future);
}

// The portal (127.0.0.1) knows one session, `JSESSIONID=alive`; the CAS is
// the same listener under another name (localhost).
pub struct Campus {
    port: String,
    // Each request received: its path and query, and its cookies.
    pub seen: Arc<Mutex<Vec<(String, String)>>>,
}

fn token(claims: serde_json::Value) -> String {
    format!("{}.{}.signature", URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#), URL_SAFE_NO_PAD.encode(claims.to_string()))
}

const LOGIN_FORM: &str = r#"<html><body><form id="fm1" method="post" action="login">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="execution" value="e1s1"></form></body></html>"#;

fn campus_answer(path: &str, cookies: &str) -> (&'static str, &'static str, String) {
    if path.starts_with("/api/v5-1/userinfo") {
        let claims = if cookies.contains("JSESSIONID=alive") {
            serde_json::json!({
                "sub": "jdoe", "name": "Jeanne Doe", "given_name": "Jeanne", "family_name": "Doe",
                "email": "jeanne.doe@exemple.test", "iat": 1, "exp": 2,
            })
        } else if cookies.contains("JSESSIONID=someone-else") {
            serde_json::json!({ "sub": "asmith", "name": "Al Smith" })
        } else {
            serde_json::json!({ "sub": "guest" })
        };
        return ("200 OK", "application/jwt", token(claims));
    }
    if path.starts_with("/cas/login") {
        return ("200 OK", "text/html; charset=utf-8", LOGIN_FORM.to_string());
    }
    ("404 Not Found", "text/plain", String::new())
}

// A request read from a connection: its head (the first line and the
// headers), and what of its body came with it.
pub async fn read_request<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Option<(String, Vec<u8>)> {
    let mut received = Vec::new();
    let mut chunk = [0_u8; 2048];
    loop {
        if let Some(end) = received.windows(4).position(|window| window == b"\r\n\r\n") {
            let body = received.split_off(end + 4);
            received.truncate(end);
            return Some((String::from_utf8_lossy(&received).to_string(), body));
        }
        match stream.read(&mut chunk).await {
            Ok(read) if read > 0 => received.extend_from_slice(&chunk[..read]),
            _ => return None,
        }
    }
}

pub async fn read_head<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Option<String> {
    Some(read_request(stream).await?.0)
}

pub fn header_of(head: &str, name: &str) -> String {
    let prefix = format!("{name}:");
    head.lines()
        .find_map(|line| line.to_ascii_lowercase().starts_with(&prefix).then(|| line[prefix.len()..].trim().to_string()))
        .unwrap_or_default()
}

pub fn campus() -> Campus {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let listener = block_on(tokio::net::TcpListener::bind("127.0.0.1:0")).unwrap();
    let port = listener.local_addr().unwrap().port().to_string();
    let record = seen.clone();
    spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let record = record.clone();
            spawn(async move {
                let Some(head) = read_head(&mut stream).await else { return };
                let path = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                let cookies = header_of(&head, "cookie");
                let (status, content_type, body) = campus_answer(&path, &cookies);
                record.lock().unwrap().push((path, cookies));
                let answer = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(answer.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Campus { port, seen }
}

impl Campus {
    // tonAPI's settings for it, as a university.toml says them.
    pub fn settings(&self) -> ResolvedUniversity {
        let file = format!(
            r#"
            id = "{UNIVERSITY}"
            name = "Université d'exemple"
            [sso]
            kind = "cas"
            base-url = "http://localhost:{port}/cas/"
            [portal]
            kind = "uportal5"
            base-url = "http://127.0.0.1:{port}/"
            [services.profile]
            provider = "portal"
            "#,
            port = self.port
        );
        ResolvedUniversity { dir: Default::default(), university: toml::from_str(&file).unwrap(), establishments: Default::default() }
    }

    pub fn gateway(&self) -> Gateway {
        Gateway::for_tests(vec![self.settings()], SECRET, COOKIE_NAME)
    }

    // Node's cookie (its value) for a student with these portal cookies.
    pub fn cookie(&self, overrides: serde_json::Value, portal_cookies: &[(&str, &str)]) -> String {
        let mut cookies = vec![serde_json::json!(["TGC", "the-ticket", "localhost", "/cas", 1, 1, null])];
        for (name, value) in portal_cookies {
            cookies.push(serde_json::json!([name, value, "127.0.0.1", "/", 1, 1, null]));
        }
        let mut payload = serde_json::json!({
            "id": "one-session", "uni": UNIVERSITY, "user": "jdoe", "mode": null, "demoState": null,
            "createdAt": crate::now_ms(), "jar": cookies,
        });
        for (name, value) in overrides.as_object().unwrap() {
            payload[name] = value.clone();
        }
        session_link::seal(SECRET, &payload)
    }

    // A student whose portal session lives.
    pub fn alive(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "alive"), ("lb", "node2")])
    }

    // The same student, the portal's session lapsed.
    pub fn lapsed(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "lapsed")])
    }

    pub fn paths(&self) -> Vec<String> {
        self.seen.lock().unwrap().iter().map(|(path, _)| path.split('?').next().unwrap().to_string()).collect()
    }
}
