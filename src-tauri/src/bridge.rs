// The tafac:// scheme: every request the window makes (the page, its files,
// /__ent_auth, /__ent_proxy) is answered here, in the app itself, and its
// answer handed back. No TCP port, and no other program: other programs and
// browser tabs on the device can't reach any of it.
//
// Who answers:
//
//   the gateway    the page's API (back/crates/tafac-gateway, the same code
//                  as tafac.fr's server): it signs the student in through
//                  tonAPI, holds the session, and answers every route, for
//                  a session it holds and for nobody, its errors too; the
//                  list of universities with the remote settings
//                  (remote_settings.rs), the statistics, the icons
//   the site       everything else: the page and its built files, from the
//                  build the app carries (the gateway's Site, as tafac.fr's
//                  server answers them)
//
// The bridge also holds the session's cookie (jar.rs: the window never sees
// it), and signs in again with the kept login when an answer says the
// session is gone (signin.rs): the request is then asked again, and the
// page gets the second answer.
//
// The page's built files (/assets/…) are read once and answered from
// memory after that (assets.rs): WebKit keeps nothing from this scheme, and
// reads a video a few bytes at a time.

use std::path::Path;
#[cfg(debug_assertions)]
use std::time::Instant;

use bytes::Bytes;
use http::header::{CONTENT_TYPE, HOST, IF_MODIFIED_SINCE, IF_NONE_MATCH, IF_RANGE, RANGE, SET_COOKIE};
use http::{HeaderMap, HeaderValue, Method};

use tafac_gateway::own::universities::Served;
use tafac_gateway::own::{RemoteSettings, Site};
use tafac_gateway::session::cookie::clears_cookie;
use tafac_gateway::{Asked, Gateway, NodeAnswer, Statistics};

use crate::assets::{self, Assets};
use crate::jar::CookieJar;
use crate::signin::{self, KeptLogin, Outcome, SignIn};

pub struct Bridge {
    pub jar: CookieJar,
    pub signin: SignIn,
    pub assets: Assets,
    // What signs in and answers the page's API, in the app itself.
    pub gateway: Gateway,
    // The page and its built files.
    pub site: Site,
}

impl Bridge {
    pub fn new(gateway: Gateway, site: Site, jar: CookieJar, signin: SignIn) -> Self {
        Self { jar, signin, assets: Assets::default(), gateway, site }
    }

    // The session's cookie, as the jar holds it now.
    fn session_cookie(&self) -> Option<String> {
        self.jar.get(self.gateway.cookie_name())
    }
}

// The gateway as the app has it, set up as the Node the app ran before was
// (started with NODE_ENV=production and MULTI_UNIVERSITY=1):
//
//   `session_secret`  what the session's cookie is sealed with (secret.rs)
//   the cookie        production's name: the app's server always ran so
//   the universities  every one (Served::every), Tafac's own text
//   no Node behind    nobody to tell a session ended
//   the statistics    on with the key CI builds in, sent from this device
//                     to PostHog, as that Node sent them (statistics_key)
//   the icons         in `data_dir`/server, the folder that Node kept them
//                     in (its DATA_DIR)
//   `remote_settings` what their patches lay over the page's settings, in
//                     the list of universities
pub fn gateway(session_secret: &str, data_dir: &Path, remote_settings: RemoteSettings) -> Gateway {
    let key = statistics_key();
    // MULTI_UNIVERSITY=1, as that Node was started: every university, for
    // the university a visitor's events are tagged with. PostHog's own
    // address (POSTHOG_HOST unset), nobody kept out.
    let setting = |name: &str| (name == "MULTI_UNIVERSITY").then(|| "1".to_string());
    Gateway::new(session_secret, tafac_gateway::PRODUCTION_COOKIE)
        .without_node()
        .serving(Served::every())
        .with_statistics(key.as_deref())
        .sending_statistics(Statistics::read(key.as_deref(), setting))
        .with_icons_in(data_dir.join("server"))
        .with_remote_settings(remote_settings)
}

// The page and its files: the build the app carries among its resources
// (tauri.bundle.conf.json, tauri.ios.conf.json: dist/). A debug build of
// the desktop app without one (`npm run desktop:dev`, tauri.conf.json
// alone) reads the repository's own, which `tauri dev` builds first.
pub fn site(resource_dir: &Path) -> Site {
    let dist = resource_dir.join("dist");
    #[cfg(all(debug_assertions, desktop))]
    let dist = if dist.join("index.html").is_file() { dist } else { std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist") };
    Site::new(dist, Served::every())
}

// PostHog's project key (POSTHOG_PROJECT_KEY): the one CI builds in, else
// the one of the environment the app runs in. Without one the app sends no
// statistics. Sent from this device to PostHog, not through tafac.fr, and
// only while the student leaves « Statistiques anonymes » on.
fn statistics_key() -> Option<String> {
    let built_in = option_env!("TAFAC_POSTHOG_PROJECT_KEY").filter(|key| !key.is_empty());
    built_in.map(str::to_string).or_else(|| std::env::var("POSTHOG_PROJECT_KEY").ok())
}

// The address the window opens: Tauri serves custom schemes as
// <scheme>://localhost, except on Windows (WebView2) where it is
// http://<scheme>.localhost. On /login, not /: the app goes on to / by
// itself once signed in (src/desktopApp.js, App.jsx).
pub fn app_url() -> &'static str {
    if cfg!(windows) {
        "http://tafac.localhost/login"
    } else {
        "tafac://localhost/login"
    }
}

// A request as it was made, kept whole to be asked again.
struct Outgoing {
    method: Method,
    // The path and its query.
    path: String,
    headers: HeaderMap,
    body: Bytes,
}

pub async fn forward(bridge: &Bridge, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    // Development: TAFAC_LOG_REQUESTS=1 says what the page asks, how long
    // each answer took, and which ones tonAPI gave.
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
    let signed_out = signin::says_signed_out(path, response.status().as_u16(), header(response.headers(), signin::SESSION_HEADER), response.body());
    if signed_out && bridge.signin.again(round, |login| sign_in_again(bridge, login)).await {
        return ask(bridge, &outgoing, true).await;
    }
    response
}

fn path_of(outgoing: &Outgoing) -> &str {
    outgoing.path.split('?').next().unwrap_or_default()
}

// A request answered: by the gateway for the page's API, the session's
// cookie it sets or takes away going to the jar, not to the window; by the
// site for any other address. `with_cookies`: whether it goes with the
// session's cookie.
async fn ask(bridge: &Bridge, outgoing: &Outgoing, with_cookies: bool) -> http::Response<Vec<u8>> {
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
    // No Node behind: the gateway never asks one.
    let no_node = |_| std::future::ready(NodeAnswer::None);
    if let Some(response) = bridge.gateway.answer(&asked, session_cookie, no_node).await {
        let (mut parts, body) = response.into_parts();
        keep_cookies(bridge, &parts.headers, sent_with.as_deref());
        parts.headers.remove(SET_COOKIE);
        return http::Response::from_parts(parts, body);
    }
    site_answer(bridge, &outgoing.method, &outgoing.path, &outgoing.headers).await
}

// The site's answer for an address outside the page's API, asked as the
// app's Node was: under the name localhost, the address the page is filled
// with (its links for previews, which the app never shows).
async fn site_answer(bridge: &Bridge, method: &Method, path: &str, headers: &HeaderMap) -> http::Response<Vec<u8>> {
    let mut headers = headers.clone();
    headers.insert(HOST, HeaderValue::from_static("localhost"));
    let Ok(uri) = path.parse::<http::Uri>() else {
        return http::Response::builder().status(400).body(Vec::new()).unwrap();
    };
    bridge.site.answer(method, &uri, &headers).await
}

// As the app starts: the session check the page is about to ask for, made
// while the page starts (the gateway's check_early).
pub async fn start_ahead(bridge: &Bridge) {
    bridge.gateway.check_early(bridge.session_cookie().as_deref()).await;
}

// An answer's cookies, kept in the jar. `sent_with`: the session cookie the
// request left with. An answer that takes the session's cookie away is
// about that session: when the jar holds another by now (the app signed in
// again meanwhile), that one stays.
fn keep_cookies(bridge: &Bridge, headers: &HeaderMap, sent_with: Option<&str>) {
    let name = bridge.gateway.cookie_name();
    let stale = |set_cookie: &&str| clears_cookie(set_cookie, name) && bridge.jar.get(name).as_deref() != sent_with;
    // Sorted out before the jar is opened: it is read to tell which.
    let kept: Vec<&str> = headers.get_all(SET_COOKIE).iter().filter_map(|value| value.to_str().ok()).filter(|set_cookie| !stale(set_cookie)).collect();
    bridge.jar.store(kept.into_iter());
}

// One of the page's built files, from memory; the first time, from the
// site, read whole whatever part the page wanted. None when the site has no
// such file to give whole: it answers the request itself.
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
    let response = site_answer(bridge, &Method::GET, &outgoing.path, &headers).await;
    if response.status() != http::StatusCode::OK {
        return None;
    }
    Some(assets::answer(&bridge.assets.keep(path, response), range))
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

// The kept login, sent as the page sends one, without the old session's
// cookie: tonAPI signs in, as for the page's own. Its answer's cookie goes
// to the jar: the session the retried requests then carry.
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

// What the app answers, through the bridge itself: the gateway's made-up
// campus, and a made-up build.
#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use tafac_gateway::testing::{campus, Campus, CODE, COOKIE_NAME, PASSWORD, STUDENT, STUDENT_WITH_CODE};
    use tafac_gateway::ANSWERED_BY;

    use super::*;

    const PAGE: &str = "<!doctype html><html><head><title>%LENT_APP_NAME%</title></head><body><div id=\"root\"></div></body></html>";
    const SCRIPT: &[u8] = b"console.log('the page')";

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn scratch(name: &str) -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        std::env::temp_dir().join(format!("tafac-bridge-test-{}-{}-{name}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)))
    }

    // A build as Vite writes it.
    fn build() -> PathBuf {
        let dist = scratch("dist");
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::write(dist.join("index.html"), PAGE).unwrap();
        std::fs::write(dist.join("assets").join("index-abc123.js"), SCRIPT).unwrap();
        dist
    }

    // A jar that holds the session cookie, as after a sign-in; an empty
    // one without.
    fn jar_with(session_cookie: Option<&str>) -> CookieJar {
        // No expiry: nothing is saved to the file.
        let jar = CookieJar::load(scratch("cookies.json"));
        if let Some(session_cookie) = session_cookie {
            jar.store([format!("{COOKIE_NAME}={session_cookie}; Path=/; HttpOnly").as_str()].into_iter());
        }
        jar
    }

    fn bridge_with(campus: &Campus, session_cookie: Option<&str>) -> Bridge {
        Bridge::new(campus.gateway(), Site::new(build(), Served::every()), jar_with(session_cookie), SignIn::new(None))
    }

    fn bridge(campus: &Campus, session_cookie: &str) -> Bridge {
        bridge_with(campus, Some(session_cookie))
    }

    // The app as it first opens: nobody signed in.
    fn signed_out_bridge(campus: &Campus) -> Bridge {
        bridge_with(campus, None)
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

    fn json(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn a_sign_in_is_made_in_the_app_and_its_cookie_kept_from_the_window() {
        let campus = campus();
        let bridge = signed_out_bridge(&campus);
        let response = sign_in(&bridge, STUDENT, PASSWORD);
        assert_eq!(response.status(), 200);
        assert!(by_tonapi(&response));
        let answer = json(&response);
        assert_eq!((&answer["authenticated"], &answer["user"]), (&true.into(), &"jdoe".into()));
        // The cookie is the jar's: the window gets none.
        assert!(response.headers().get(SET_COOKIE).is_none());
        assert!(bridge.session_cookie().is_some_and(|cookie| cookie.starts_with("v1.")));
        // The login is kept to sign in again.
        assert!(bridge.signin.has_kept());
        // The password went from the app to the CAS.
        assert_eq!(campus.posted_to("/cas/login"), 1);

        // The session is one like any other, for every route.
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
        // A route the page no longer asks: no route, the session kept.
        let gone = ask(&bridge, "GET", "/__ent_auth/planning");
        assert_eq!((gone.status().as_u16(), json(&gone)), (404, serde_json::json!({ "error": "Not found." })));
        assert!(bridge.session_cookie().is_some());
    }

    #[test]
    fn a_sign_in_the_cas_refuses_keeps_nothing() {
        let campus = campus();
        let bridge = signed_out_bridge(&campus);
        let response = sign_in(&bridge, STUDENT, "not-the-password");
        assert_eq!(response.status(), 401);
        assert_eq!(json(&response)["code"], "login_refused");
        assert_eq!(bridge.session_cookie(), None);
        assert!(!bridge.signin.has_kept());
    }

    #[test]
    fn a_second_factor_is_answered_in_the_app() {
        let campus = campus();
        let bridge = signed_out_bridge(&campus);
        // The CAS answers the password with its code page: a code is wanted,
        // and the student's only way to one left unasked. No session yet.
        let response = sign_in(&bridge, STUDENT_WITH_CODE, PASSWORD);
        assert!(by_tonapi(&response));
        assert_eq!(response.status(), 401);
        let answer = json(&response);
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
    }

    #[test]
    fn a_session_found_expired_is_signed_in_again_without_the_page_seeing_it() {
        let campus = campus();
        let first = campus.alive();
        let bridge = bridge(&campus, &first);
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
    }

    #[test]
    fn an_answer_about_a_session_gone_since_leaves_the_new_ones_cookie() {
        let campus = campus();
        let current = campus.alive();
        let bridge = bridge(&campus, &current);
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
    fn a_session_is_answered_in_the_app() {
        let campus = campus();
        let bridge = bridge(&campus, &campus.alive());

        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(by_tonapi(&session));
        let answer = json(&session);
        assert_eq!((&answer["authenticated"], &answer["user"], &answer["sessionSource"]), (&true.into(), &"jdoe".into(), &"cookie".into()));
        // Whether the statistics are on is said here too (the campus's
        // gateway has no key for them).
        assert_eq!(answer["analyticsEnabled"], false);
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
    }

    #[test]
    fn a_moved_routes_error_is_answered_in_the_app_too() {
        let campus = campus();
        // The portal answers for another name than the session's: nobody's
        // answer, and the route's error, worded in the app as Node worded
        // its own.
        let someone_else = campus.cookie(serde_json::json!({}), &[("JSESSIONID", "someone-else")]);
        let bridge = bridge(&campus, &someone_else);
        for path in ["/__ent_auth/session", "/__ent_auth/account"] {
            let response = ask(&bridge, "GET", path);
            assert!(by_tonapi(&response), "{path}");
            assert_eq!(response.status(), 500, "{path}");
            assert_eq!(response.body(), br#"{"error":"Service indisponible pour le moment"}"#, "{path}");
        }
        // A parameter Node's own route refused, in its words.
        let refused = ask(&bridge, "GET", "/__ent_auth/grades/semester/abc");
        assert!(by_tonapi(&refused));
        assert_eq!(refused.status(), 400);
        assert_eq!(refused.body(), br#"{"error":"Invalid semester id."}"#);

        // Nothing says the session is over: it is kept, nobody signs in
        // again.
        assert_eq!(bridge.session_cookie().as_deref(), Some(someone_else.as_str()));
        assert_eq!(campus.posted_to("/cas/login"), 0);
    }

    #[test]
    fn a_session_the_gateway_doesnt_hold_is_nobodys() {
        let campus = campus();
        // The demo account's session, from when Node served it: nobody's.
        let demo = campus.cookie(serde_json::json!({ "mode": "demo" }), &[]);
        let bridge = bridge(&campus, &demo);

        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(by_tonapi(&session));
        assert_eq!((&json(&session)["authenticated"], &json(&session)["university"]), (&false.into(), &"univ-rennes".into()));
        let account = ask(&bridge, "GET", "/__ent_auth/account");
        assert_eq!(json(&account), serde_json::json!({ "authenticated": false, "account": null, "sessionMode": null }));
        assert_eq!(account.headers()[signin::SESSION_HEADER], "expired");
        assert!(campus.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn every_request_is_answered_in_the_app() {
        let campus = campus();
        let bridge = bridge(&campus, &campus.alive());
        // The page's API: no route, the portal proxy's refusal, the list of
        // universities, another method.
        for (method, path, status) in [
            ("POST", "/__ent_auth/ade/upcoming", 404),
            ("GET", "/__ent_proxy/api/v4-3/dlm/layout.json", 403),
            ("GET", "/__ent_auth/universities", 200),
            ("POST", "/__ent_auth/session", 404),
        ] {
            let response = ask(&bridge, method, path);
            assert!(by_tonapi(&response), "{method} {path}");
            assert_eq!(response.status().as_u16(), status, "{method} {path}");
        }
        let universities = json(&ask(&bridge, "GET", "/__ent_auth/universities"));
        assert_eq!((&universities["mode"], &universities["session"], universities["universities"].as_array().unwrap().len()), (&"multi".into(), &"univ-rennes".into(), 3));

        // The page itself, at the app's addresses, Tafac's own.
        for path in ["/login", "/"] {
            let page = ask(&bridge, "GET", path);
            assert_eq!(page.status(), 200, "{path}");
            assert_eq!(page.headers()["content-type"], "text/html; charset=utf-8", "{path}");
            assert!(String::from_utf8_lossy(page.body()).contains("<title>Tafac</title>"), "{path}");
        }
        // Anything else: Express's 404, as the app's Node said it.
        assert_eq!(ask(&bridge, "POST", "/").status(), 404);
        assert!(campus.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn the_pages_files_are_read_once_and_kept() {
        let campus = campus();
        let bridge = signed_out_bridge(&campus);
        let whole = ask(&bridge, "GET", "/assets/index-abc123.js");
        assert_eq!((whole.status().as_u16(), whole.body().as_slice()), (200, SCRIPT));
        assert_eq!(whole.headers()["content-type"], "text/javascript; charset=utf-8");
        assert!(bridge.assets.get("/assets/index-abc123.js").is_some());
        // A part, from memory.
        let request = http::Request::builder().uri("tafac://localhost/assets/index-abc123.js").header("range", "bytes=0-6").body(Vec::new()).unwrap();
        let part = block_on(forward(&bridge, request));
        assert_eq!((part.status().as_u16(), part.body().as_slice()), (206, &b"console"[..]));
        // A file the build hasn't: the page, not kept.
        assert_eq!(ask(&bridge, "GET", "/assets/gone-123.js").headers()["content-type"], "text/html; charset=utf-8");
        assert!(bridge.assets.get("/assets/gone-123.js").is_none());
    }

    #[test]
    fn asked_ahead_as_the_app_starts_the_first_check_asks_nobody() {
        let campus = campus();
        let bridge = bridge(&campus, &campus.alive());
        block_on(start_ahead(&bridge));
        // The portal, once.
        let portal = campus.paths().len();
        assert_eq!(portal, 1);

        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/session")));
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/account")));
        assert_eq!(campus.paths().len(), portal);
    }

    #[test]
    fn a_sign_out_is_answered_in_the_app() {
        let campus = campus();
        let cookie = campus.alive();
        let bridge = bridge(&campus, &cookie);
        assert!(by_tonapi(&ask(&bridge, "GET", "/__ent_auth/session")));

        let response = ask(&bridge, "POST", "/__ent_auth/logout");
        assert!(by_tonapi(&response));
        assert_eq!(response.body(), br#"{"authenticated":false}"#);
        assert!(!campus.cas_knows_the_ticket());
        // The jar lost the cookie, and the gateway the session: even with
        // the cookie put back (a copy kept), nobody is signed in.
        assert_eq!(bridge.session_cookie(), None);
        bridge.jar.store([format!("{COOKIE_NAME}={cookie}; Path=/").as_str()].into_iter());
        let session = ask(&bridge, "GET", "/__ent_auth/session");
        assert!(by_tonapi(&session));
        assert_eq!(json(&session)["authenticated"], false);
    }
}
