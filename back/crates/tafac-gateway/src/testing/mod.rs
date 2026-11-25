// A made-up campus for the tests, here and in what uses the crate (the
// apps' bridge): a portal, its CAS and a Moodle on this computer, as much of
// them as tonAPI asks, and Node's cookie for a student there.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tonapi_config::ResolvedUniversity;

use crate::session::cookie;
use crate::Gateway;

pub const SECRET: &str = "a secret of the tests, long enough to be one";
pub const UNIVERSITY: &str = "univ-rennes";
pub const COOKIE_NAME: &str = cookie::PRODUCTION_COOKIE;
// Node's User-Agent, to which the campus's CAS binds its ticket.
const NODE_AGENT: &str = "node";
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
// the same listener under another name (localhost), and knows one ticket,
// `TGC=the-ticket`. Moodle is under /moodle/ on the portal's host: it signs
// in through the CAS and answers its calendar's two lists.
pub struct Campus {
    port: String,
    // Each request received: its path and query, and its cookies.
    pub seen: Arc<Mutex<Vec<(String, String)>>>,
    moodle: Arc<Moodle>,
}

// Moodle's state: the session it knows (a number: it forgets the one before
// when the number changes), and whether it answers at all.
#[derive(Default)]
struct Moodle {
    sessions: AtomicU32,
    down: AtomicBool,
}

// What the campus answers to one request.
struct Answer {
    status: &'static str,
    content_type: &'static str,
    body: String,
    // More headers, as written: a redirect's Location, a Set-Cookie.
    headers: Vec<String>,
}

impl Answer {
    fn of(status: &'static str, content_type: &'static str, body: String) -> Self {
        Self { status, content_type, body, headers: Vec::new() }
    }

    fn redirect(location: &str) -> Self {
        Self { status: "302 Found", content_type: "text/plain", body: String::new(), headers: vec![format!("location: {location}")] }
    }

    fn with(mut self, header: String) -> Self {
        self.headers.push(header);
        self
    }
}

fn token(claims: serde_json::Value) -> String {
    format!("{}.{}.signature", URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#), URL_SAFE_NO_PAD.encode(claims.to_string()))
}

const LOGIN_FORM: &str = r#"<html><body><form id="fm1" method="post" action="login">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="execution" value="e1s1"></form></body></html>"#;

fn query_of(path: &str, name: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (found, value) = pair.split_once('=')?;
        (found == name).then(|| percent_decoded(value))
    })
}

fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        let hex = (byte == b'%').then(|| text.get(at + 1..at + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok())).flatten();
        match hex {
            Some(value) => {
                decoded.push(value);
                at += 3;
            }
            None => {
                decoded.push(if byte == b'+' { b' ' } else { byte });
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn percent_encoded(text: &str) -> String {
    text.bytes().map(|byte| if byte.is_ascii_alphanumeric() { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

// One event of Moodle's calendar, due `days` from now.
fn moodle_event(port: &str, id: u32, module: &str, name: &str, days: i64, action: bool) -> serde_json::Value {
    let due = chrono::Utc::now().timestamp() + days * 24 * 60 * 60 + 3600;
    let mut event = serde_json::json!({
        "id": id, "name": format!("{name} doit être rendu"), "activityname": name, "modulename": module,
        "eventtype": "due", "timesort": due, "timestart": due,
        "course": { "id": 7, "fullname": "Développement web" },
        "url": format!("http://127.0.0.1:{port}/moodle/mod/{module}/view.php?id={id}"),
    });
    if action {
        event["action"] = serde_json::json!({ "name": "Ajouter un travail", "url": format!("http://127.0.0.1:{port}/moodle/mod/{module}/view.php?id={id}"), "actionable": true });
    }
    event
}

// Moodle's answer to the two calls tonAPI sends in one request: what is
// still to do (overdue included), then the upcoming events, where what was
// handed in has lost its action.
fn moodle_calendar(port: &str) -> String {
    let event = |id, module, name, days, action| moodle_event(port, id, module, name, days, action);
    let to_do = [
        event(101, "assign", "Très vieux rendu", -10, true),
        event(102, "assign", "Rendu en retard A", -5, true),
        event(103, "quiz", "Quiz en retard", -3, true),
        event(104, "assign", "Rendu en retard B", -2, true),
        event(105, "assign", "Rendu en retard C", -1, true),
        event(106, "assign", "Maquette", 2, true),
        event(107, "forum", "Débat", 5, true),
        event(108, "assign", "Rapport", 7, true),
        event(109, "assign", "Rendu lointain", 40, true),
    ];
    let upcoming = [
        event(106, "assign", "Maquette", 2, true),
        event(201, "assign", "Compte rendu déjà rendu", 6, false),
        event(202, "quiz", "QCM passé", 8, false),
    ];
    serde_json::json!([
        { "error": false, "data": { "events": to_do, "firstid": 101, "lastid": 109 } },
        { "error": false, "data": { "events": upcoming } },
    ])
    .to_string()
}

fn moodle_answer(path: &str, cookies: &str, port: &str, moodle: &Moodle) -> Answer {
    let generation = moodle.sessions.load(Ordering::SeqCst);
    let session = format!("MoodleSession=open{generation}");
    let signed_in = cookies.contains(&session);
    let dashboard = |key: &str| {
        format!(r#"<html><head><script>M.cfg = {{"sesskey":"{key}","userId":42}};</script></head><body class="path-my">Tableau de bord</body></html>"#)
    };
    let route = path.split('?').next().unwrap_or_default();
    match route {
        "/moodle/login/index.php" => {
            let entry = format!("http://127.0.0.1:{port}/moodle/login/index.php?authCAS=CAS");
            if query_of(path, "ticket").as_deref() == Some("ST-campus") {
                Answer::redirect(&format!("http://127.0.0.1:{port}/moodle/my/")).with(format!("set-cookie: {session}; Path=/moodle"))
            } else if signed_in {
                Answer::of("200 OK", "text/html; charset=utf-8", dashboard(&format!("CAMPUSKEY{generation}")))
            } else {
                Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&entry)))
            }
        }
        "/moodle/my/" if signed_in => Answer::of("200 OK", "text/html; charset=utf-8", dashboard(&format!("CAMPUSKEY{generation}"))),
        "/moodle/my/" => Answer::of("200 OK", "text/html; charset=utf-8", r#"<html><body class="notloggedin">Connexion</body></html>"#.to_string()),
        "/moodle/lib/ajax/service.php" => {
            if moodle.down.load(Ordering::SeqCst) {
                return Answer::of("503 Service Unavailable", "text/plain", String::new());
            }
            let key_matches = query_of(path, "sesskey").as_deref() == Some(format!("CAMPUSKEY{generation}").as_str());
            if signed_in && key_matches {
                Answer::of("200 OK", "application/json", moodle_calendar(port))
            } else {
                Answer::of("200 OK", "application/json", r#"[{"error":true,"exception":{"errorcode":"servicerequireslogin","message":"SECRET"}}]"#.to_string())
            }
        }
        _ => Answer::of("404 Not Found", "text/plain", String::new()),
    }
}

fn campus_answer(path: &str, cookies: &str, agent: &str, port: &str, moodle: &Moodle) -> Answer {
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
        return Answer::of("200 OK", "application/jwt", token(claims));
    }
    if path.starts_with("/cas/login") {
        // The ticket is bound to the User-Agent that signed in (Node's): from
        // another one the CAS deletes it, as Rennes' does.
        if cookies.contains("TGC=the-ticket") && agent != NODE_AGENT {
            return Answer::of("200 OK", "text/html; charset=utf-8", LOGIN_FORM.to_string()).with("set-cookie: TGC=; Path=/cas; Max-Age=0".to_string());
        }
        // The CAS knows the ticket: back to the service, signed in.
        return match (cookies.contains("TGC=the-ticket"), query_of(path, "service")) {
            (true, Some(service)) => {
                let separator = if service.contains('?') { '&' } else { '?' };
                // The same ticket, written anew: a CAS does at each sign-in.
                Answer::redirect(&format!("{service}{separator}ticket=ST-campus")).with("set-cookie: TGC=the-ticket-written-anew; Path=/cas".to_string())
            }
            _ => Answer::of("200 OK", "text/html; charset=utf-8", LOGIN_FORM.to_string()),
        };
    }
    if path.starts_with("/moodle/") {
        return moodle_answer(path, cookies, port, moodle);
    }
    Answer::of("404 Not Found", "text/plain", String::new())
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
    let moodle = Arc::new(Moodle::default());
    let (answering, at) = (moodle.clone(), port.clone());
    spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let (record, moodle, port) = (record.clone(), answering.clone(), at.clone());
            spawn(async move {
                let Some(head) = read_head(&mut stream).await else { return };
                let path = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                let cookies = header_of(&head, "cookie");
                let Answer { status, content_type, body, headers } = campus_answer(&path, &cookies, &header_of(&head, "user-agent"), &port, &moodle);
                record.lock().unwrap().push((path, cookies));
                let more: String = headers.iter().map(|header| format!("{header}\r\n")).collect();
                let answer = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\n{more}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(answer.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Campus { port, seen, moodle }
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
            [services.homework]
            provider = "moodle-ajax"
            base-url = "http://127.0.0.1:{port}/moodle/"
            entry = "cas"
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
            "createdAt": crate::gateway::now_ms(), "jar": cookies,
        });
        for (name, value) in overrides.as_object().unwrap() {
            payload[name] = value.clone();
        }
        cookie::seal(SECRET, &payload)
    }

    // A student whose portal session lives.
    pub fn alive(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "alive"), ("lb", "node2")])
    }

    // The same student, the portal's session lapsed.
    pub fn lapsed(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "lapsed")])
    }

    // Moodle no longer knows the session it gave: the next question signs
    // in again.
    pub fn moodle_forgets(&self) {
        self.moodle.sessions.fetch_add(1, Ordering::SeqCst);
    }

    // Moodle stops (or starts again) answering its calendar.
    pub fn moodle_is_down(&self, down: bool) {
        self.moodle.down.store(down, Ordering::SeqCst);
    }

    // How many requests went to a path of the campus's.
    pub fn asked(&self, path: &str) -> usize {
        self.paths().iter().filter(|seen| seen.as_str() == path).count()
    }

    pub fn paths(&self) -> Vec<String> {
        self.seen.lock().unwrap().iter().map(|(path, _)| path.split('?').next().unwrap().to_string()).collect()
    }
}
