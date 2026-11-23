// Moodle inside the app: a web view of its own laid over the page's
// « Moodle » (src/components/MoodlePage.jsx), not an iframe. Moodle sends
// X-Frame-Options: sameorigin, so a frame in the page stays empty; a web view
// of the app's is a browser of its own, where Moodle is the page.
//
// The page drives it through /__desktop/moodle/* (desktop.rs): `open` makes
// the view, hidden, where the page's slot is; `show` puts it on screen once
// Moodle is there, `hide` takes it off (the page left « Moodle », or opened
// something over it: the view is native, above all the page draws); `state`
// says what the toolbar shows.
//
// Signing in goes through the launch relay (/__ent_auth/launch): the server
// signs in to Moodle with the student's session and the view opens signed
// in. When Moodle asks to sign in again later (its own session ran out), the
// relay is asked again. When the server found the student's session expired
// (its X-Tafac-Session header, server/sessionExpiry), the page signs the
// student out (`expired`); when it couldn't sign in for another reason, the
// page says Moodle is unavailable (`signin`).
//
// What the view keeps (Moodle's cookies) lives in memory only, and the view
// is closed when the student signs out of the app or signs in again
// (main.rs): the next student starts from nothing.
//
// Moodle's own pages take the app's look, its theme as the app's page shows
// it (moodle_style.rs).
//
// Inside the view, the page itself only loads the university's addresses, as
// the server lists them (server/moodleView/policy.ts): Moodle, the CAS, the
// sign-in chain. Any other address opens in the student's browser; what is
// neither is refused. Frames inside a page load as in a browser (macOS,
// moodle_native.rs). Nothing in the view can ask the app's server anything
// (main.rs refuses its requests to the app's scheme). Downloads open the
// Save panel, as the page's (links.rs).

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::webview::PageLoadEvent;
#[cfg(desktop)]
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url};
#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl, Wry};
#[cfg(desktop)]
use tokio::sync::oneshot;
use tokio::sync::watch;

use crate::bridge::{self, Bridge};
use crate::links;
use crate::moodle_style::{self, Theme, ThemeBody};

#[cfg(desktop)]
pub const LABEL: &str = "moodle";

// Moodle's view. On the desktop a web view of Tauri's, a child of the
// window. On iOS Tauri has none to give (a window holds one web view there):
// the view is a WKWebView of the app's own (moodle_ios.rs, plugins/moodle),
// which answers to the same names. Everything below is the same for both:
// what the view may load, how it signs in, what it says to the page.
#[cfg(desktop)]
type View = Webview<Wry>;
#[cfg(target_os = "ios")]
use crate::moodle_ios::View;
const POLICY_PATH: &str = "/__ent_auth/moodle/view";
const LAUNCH_PATH: &str = "/__ent_auth/launch";
const SESSION_HEADER: &str = "x-tafac-session";

// A sign-in page this soon after the relay was asked is the relay not having
// signed in, rather than a session that ran out since.
const RELAY_SETTLES: Duration = Duration::from_secs(20);
// How long `state` waits for something to change before it answers anyway.
const STATE_WAIT: Duration = Duration::from_millis(900);

// What the server says of the university's Moodle (server/moodleView/policy.ts).
#[derive(Clone, Debug)]
struct Policy {
    home: Url,
    hosts: Vec<String>,
    domains: Vec<String>,
    sign_in: Vec<String>,
}

#[derive(Deserialize)]
struct PolicyBody {
    home: String,
    #[serde(default)]
    hosts: Vec<String>,
    #[serde(default)]
    domains: Vec<String>,
    #[serde(default, rename = "signIn")]
    sign_in: Vec<String>,
}

fn under(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|rest| rest.ends_with('.'))
}

impl Policy {
    fn parse(body: &[u8]) -> Option<Self> {
        let body: PolicyBody = serde_json::from_slice(body).ok()?;
        let home = Url::parse(&body.home).ok().filter(|url| url.scheme() == "https" && url.host_str().is_some())?;
        let lower = |list: Vec<String>| list.into_iter().map(|host| host.to_lowercase()).collect();
        Some(Self { home, hosts: lower(body.hosts), domains: lower(body.domains), sign_in: lower(body.sign_in) })
    }

    fn is_moodle(&self, url: &Url) -> bool {
        url.scheme() == "https" && url.host_str() == self.home.host_str()
    }

    // One of the university's own addresses.
    fn is_university(&self, url: &Url) -> bool {
        if url.scheme() != "https" {
            return false;
        }
        let Some(host) = url.host_str() else { return false };
        self.is_moodle(url) || self.hosts.iter().any(|known| known == host) || self.domains.iter().any(|domain| under(host, domain))
    }

    // A page that asks the student to sign in: Moodle's own, or a step of
    // the university's sign-in (CAS, WAYF, IdP).
    fn is_sign_in(&self, url: &Url) -> bool {
        if url.scheme() != "https" {
            return false;
        }
        if self.is_moodle(url) {
            return url.path() == "/login/index.php";
        }
        url.host_str().is_some_and(|host| self.sign_in.iter().any(|domain| under(host, domain)))
    }

    // A page of Moodle's to come back to after a sign-in: not the sign-in's
    // own steps.
    fn is_page(&self, url: &Url) -> bool {
        self.is_moodle(url) && !["/login/", "/auth/", "/Shibboleth.sso/"].iter().any(|prefix| url.path().starts_with(prefix))
    }
}

#[derive(Debug, PartialEq)]
enum Navigation {
    // Loads in the view.
    Stay,
    // Opens in the student's browser.
    Browser,
    Refuse,
}

// Where a navigation of the view's page goes. `data:` is the relay's own
// page (WebKit lets no page send itself there), `blob:` a file Moodle made.
fn classify(policy: &Policy, url: &Url) -> Navigation {
    match url.scheme() {
        "https" if policy.is_university(url) => Navigation::Stay,
        "about" | "blob" | "data" => Navigation::Stay,
        "http" | "https" | "mailto" | "tel" => Navigation::Browser,
        _ => Navigation::Refuse,
    }
}

fn same_page(left: &Url, right: &Url) -> bool {
    let bare = |url: &Url| {
        let mut url = url.clone();
        url.set_fragment(None);
        url
    };
    bare(left) == bare(right)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    // No view.
    #[default]
    None,
    // Signing in, or on the way to the page asked for: nothing to show yet.
    Opening,
    Ready,
    // Moodle asks to sign in and the server couldn't, its session still
    // valid (a step of the sign-in down).
    SignIn,
    // The server found the student's session expired: the page signs out.
    Expired,
    // The page didn't load (offline, Moodle not answering).
    Failed,
    // In another window of the app than the one asking (never kept in the
    // state: `state` says it to that window's page).
    Elsewhere,
    // Closed with the window it was in (said once, by `state`): the page
    // opens it again.
    Gone,
}

#[derive(Default)]
struct State {
    // Kept while the session lasts (`close` forgets it).
    policy: Option<Policy>,
    phase: Phase,
    // The page wants the view on screen.
    shown: bool,
    // The window the view is in.
    window: String,
    relay_at: Option<Instant>,
    // Where the student asked to go, reached once signed in.
    target: Option<Url>,
    // The last page of Moodle's asked for: where a new sign-in goes back to.
    wanted: Option<Url>,
    // The address that didn't load.
    failed: Option<Url>,
    // The view shows a file (a PDF, a picture), not a web page.
    file: bool,
    // `open` is making the view: it isn't there yet.
    making: bool,
}

pub struct Moodle {
    state: Mutex<State>,
    // The app's theme, as its page last sent it: kept across views.
    theme: Mutex<Option<Theme>>,
    // Counts the changes: `state` waits on it.
    version: watch::Sender<u64>,
    // One `open` at a time.
    opening: tokio::sync::Mutex<()>,
}

impl Default for Moodle {
    fn default() -> Self {
        Self { state: Mutex::default(), theme: Mutex::default(), version: watch::channel(0).0, opening: tokio::sync::Mutex::default() }
    }
}

impl Moodle {
    // Never held across a call to Tauri: those wait for the main thread,
    // which may be waiting for this.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn theme(&self) -> Option<Theme> {
        self.theme.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    fn touch(&self) {
        self.version.send_modify(|version| *version = version.wrapping_add(1));
    }

    fn update<T>(&self, change: impl FnOnce(&mut State) -> T) -> T {
        let result = change(&mut self.lock());
        self.touch();
        result
    }
}

fn moodle(app: &AppHandle) -> Arc<Moodle> {
    app.state::<Arc<Moodle>>().inner().clone()
}

#[cfg(desktop)]
fn view(app: &AppHandle) -> Option<View> {
    app.get_webview(LABEL)
}

#[cfg(target_os = "ios")]
fn view(app: &AppHandle) -> Option<View> {
    View::of(app)
}

#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn usable(&self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite()) && self.width >= 1.0 && self.height >= 1.0
    }
}

#[cfg(desktop)]
fn place(view: &View, bounds: Bounds) {
    let _ = view.set_position(LogicalPosition::new(bounds.x, bounds.y));
    let _ = view.set_size(LogicalSize::new(bounds.width, bounds.height));
}

#[cfg(target_os = "ios")]
fn place(view: &View, bounds: Bounds) {
    view.place(bounds.x, bounds.y, bounds.width, bounds.height);
}

// The app's own server, asked as the page would (the view can't).
async fn ask(app: &AppHandle, path: &str) -> Option<http::Response<Vec<u8>>> {
    let bridge = app.state::<Arc<Bridge>>().inner().clone();
    let request = http::Request::get(path).header(http::header::ACCEPT, "text/html,application/json,*/*").body(Vec::new()).ok()?;
    Some(bridge::forward(&bridge, request).await)
}

// The server's answer says the student's session is no longer valid
// (server/sessionExpiry): never guessed from a failure.
fn says_expired(response: &http::Response<Vec<u8>>) -> bool {
    response.headers().get(SESSION_HEADER).and_then(|value| value.to_str().ok()) == Some("expired")
}

fn expire(app: &AppHandle) {
    moodle(app).update(|state| state.phase = Phase::Expired);
}

// None: signed out (its session expired: `expire`), or a university
// without Moodle.
async fn policy(app: &AppHandle) -> Option<Policy> {
    let moodle = moodle(app);
    if let Some(policy) = moodle.lock().policy.clone() {
        return Some(policy);
    }
    let response = ask(app, POLICY_PATH).await?;
    if says_expired(&response) {
        expire(app);
        return None;
    }
    let policy = (response.status() == http::StatusCode::OK).then(|| Policy::parse(response.body())).flatten()?;
    moodle.lock().policy = Some(policy.clone());
    Some(policy)
}

fn launch_path(target: &Url) -> String {
    let query = Url::parse_with_params("https://launch.invalid/", &[("url", target.as_str())])
        .ok()
        .and_then(|url| url.query().map(str::to_string))
        .unwrap_or_default();
    format!("{LAUNCH_PATH}?{query}")
}

// Where the launch relay sends for `target`. Either a redirect: Moodle with
// its CAS ticket (or the target itself when the server can't sign in); or,
// for a Moodle behind Shibboleth (Rennes), a page that posts the
// university's sign-in to Moodle by itself, loaded as is so its form posts
// from the view. The relay's own address is the app's, which the view can't
// load, so it is asked here. None: the server found the session expired.
async fn relay(app: &AppHandle, target: &Url) -> Option<Url> {
    let Some(response) = ask(app, &launch_path(target)).await else { return Some(target.clone()) };
    if says_expired(&response) {
        return None;
    }
    Some(relay_start(&response, target))
}

fn relay_start(response: &http::Response<Vec<u8>>, target: &Url) -> Url {
    if response.status().is_redirection() {
        let location = response.headers().get(http::header::LOCATION).and_then(|value| value.to_str().ok());
        return location.and_then(|location| Url::parse(location).ok()).filter(|url| url.scheme() == "https").unwrap_or_else(|| target.clone());
    }
    let is_html = response
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"));
    if response.status() == http::StatusCode::OK && is_html {
        if let Ok(page) = Url::parse(&format!("data:text/html;charset=utf-8;base64,{}", base64(response.body()))) {
            return page;
        }
    }
    target.clone()
}

pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(char::from(ALPHABET[(triple >> (18 - 6 * index) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

// Signs in again through the relay, then on to `target`.
fn sign_in(app: &AppHandle, target: Url) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(start) = relay(&app, &target).await else {
            expire(&app);
            return;
        };
        if let Some(view) = view(&app) {
            let _ = view.navigate(start);
        }
    });
}

// A navigation of the view's page (and, elsewhere than on macOS, of its
// frames).
fn allows(app: &AppHandle, policy: &Policy, url: &Url) -> bool {
    match classify(policy, url) {
        Navigation::Stay => {
            if policy.is_page(url) {
                moodle(app).lock().wanted = Some(url.clone());
            }
            true
        }
        Navigation::Browser => {
            links::open_outside(url);
            false
        }
        Navigation::Refuse => {
            // The scheme only: the rest may hold what a page was fed.
            eprintln!("[tafac] Moodle: navigation refused: {}:", url.scheme());
            false
        }
    }
}

fn page_loaded(app: &AppHandle, policy: &Policy, event: PageLoadEvent, url: &Url) {
    let moodle = moodle(app);
    // The relay's own page (data:) isn't one of Moodle's.
    if event == PageLoadEvent::Started || url.scheme() != "https" {
        moodle.touch();
        return;
    }
    if policy.is_sign_in(url) {
        let again = moodle.update(|state| {
            if state.relay_at.is_some_and(|at| at.elapsed() < RELAY_SETTLES) {
                state.phase = Phase::SignIn;
                return None;
            }
            // Moodle's session ran out: the server signs in again.
            state.relay_at = Some(Instant::now());
            state.phase = Phase::Opening;
            Some(state.wanted.clone().unwrap_or_else(|| policy.home.clone()))
        });
        if let Some(target) = again {
            sign_in(app, target);
        }
        return;
    }
    // The theme may have changed while another site's page was in view.
    if let (Some(theme), Some(view), true) = (moodle.theme(), view(app), policy.is_moodle(url)) {
        let _ = view.eval(moodle_style::announce(&theme));
    }
    let onward = moodle.update(|state| {
        let onward = state.target.take().filter(|target| policy.is_moodle(url) && !same_page(target, url));
        if onward.is_none() {
            state.phase = Phase::Ready;
        }
        state.failed = None;
        onward
    });
    // Signed in on the dashboard (a CAS login lands there): on to the page
    // that was asked for.
    if let (Some(target), Some(view)) = (onward, view(app)) {
        let _ = view.navigate(target);
    }
}

#[cfg(desktop)]
fn builder(app: &AppHandle, policy: &Policy, start: Url) -> WebviewBuilder<Wry> {
    let navigation = (app.clone(), policy.clone());
    let new_window = (app.clone(), policy.clone());
    let download = policy.clone();
    let loaded = (app.clone(), policy.clone());
    let title = app.clone();
    let style = moodle_style::script(policy.home.host_str().unwrap_or_default(), moodle(app).theme().as_ref());
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
        // Moodle's own pages in the app's look (moodle_style.rs).
        .initialization_script(style)
        // Nothing of Moodle's is written to disk, and it all goes with the view.
        .incognito(true)
        .focused(false)
        // Files dropped on Moodle's own drop zones are for its page.
        .disable_drag_drop_handler()
        .on_navigation(move |url| allows(&navigation.0, &navigation.1, url))
        // A new tab: in the view itself when it is the university's.
        .on_new_window(move |url, _features| {
            match classify(&new_window.1, &url) {
                Navigation::Stay => {
                    if let Some(view) = view(&new_window.0) {
                        let _ = view.navigate(url);
                    }
                }
                Navigation::Browser => links::open_outside(&url),
                Navigation::Refuse => eprintln!("[tafac] Moodle: new tab refused: {}:", url.scheme()),
            }
            NewWindowResponse::Deny
        })
        // The university's files (a course's PDF) are saved; any other
        // download follows the window's rules.
        .on_download(move |webview, event| {
            let is_ours = matches!(&event, DownloadEvent::Requested { url, .. } if classify(&download, url) == Navigation::Stay);
            if is_ours {
                links::save_download(event)
            } else {
                links::download(webview, event)
            }
        })
        .on_page_load(move |_view, payload| page_loaded(&loaded.0, &loaded.1, payload.event(), payload.url()))
        .on_document_title_changed(move |_view, _title| moodle(&title).touch());
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(&crate::moodle_native::safari_user_agent());
    builder
}

#[cfg(any(target_os = "macos", windows))]
fn hooks(app: &AppHandle) -> crate::moodle_native::Hooks {
    let (shown, changed, failed) = (moodle(app), moodle(app), moodle(app));
    crate::moodle_native::Hooks {
        shown: Box::new(move |file| shown.update(|state| state.file = file)),
        changed: Box::new(move || changed.touch()),
        failed: Box::new(move |address| {
            failed.update(|state| {
                // Back to a page of Moodle's, not to wherever a link led.
                let address = address.as_deref().and_then(|address| Url::parse(address).ok());
                state.failed = address.filter(|url| state.policy.as_ref().is_some_and(|policy| policy.is_moodle(url)));
                state.phase = Phase::Failed;
            })
        }),
    }
}

async fn create(app: &AppHandle, window_label: &str, policy: &Policy, bounds: Bounds, target: Option<Url>) -> Result<(), String> {
    let window = app.get_window(window_label).ok_or("no window")?;
    let destination = target.clone().unwrap_or_else(|| policy.home.clone());
    moodle(app).update(|state| {
        *state = State {
            policy: state.policy.take(),
            phase: Phase::Opening,
            window: window_label.to_string(),
            relay_at: Some(Instant::now()),
            target,
            wanted: Some(destination.clone()),
            making: true,
            ..State::default()
        };
    });
    let Some(start) = relay(app, &destination).await else {
        moodle(app).update(|state| {
            state.making = false;
            state.phase = Phase::Expired;
        });
        return Ok(());
    };
    let result = make(app, window, policy, bounds, start).await;
    moodle(app).update(|state| {
        state.making = false;
        if result.is_err() {
            state.phase = Phase::None;
        }
    });
    result
}

// The view itself, made hidden where the slot is, on its way to `start`.
#[cfg(desktop)]
async fn make(app: &AppHandle, window: tauri::Window, policy: &Policy, bounds: Bounds, start: Url) -> Result<(), String> {
    let builder = builder(app, policy, start);

    // On the main thread, in one go: the view is made and hidden before it
    // is ever drawn.
    let (reply, made) = oneshot::channel();
    let handle = app.clone();
    let asked = app.run_on_main_thread(move || {
        let result = window
            .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width, bounds.height))
            .map(|view| {
                let _ = view.hide();
                #[cfg(any(target_os = "macos", windows))]
                {
                    let handle = handle.clone();
                    crate::moodle_native::install(&view, move || hooks(&handle));
                }
                let _ = &handle;
            })
            .map_err(|error| error.to_string());
        let _ = reply.send(result);
    });
    match asked {
        Ok(()) => made.await.map_err(|error| error.to_string()).and_then(|result| result),
        Err(error) => Err(error.to_string()),
    }
}

// iOS: the view is the app's own (moodle_ios.rs). It decides by itself what
// its page may load, from the university's addresses given here (WebKit
// wants its answer at once), and tells of the rest: `view_event`.
#[cfg(target_os = "ios")]
async fn make(app: &AppHandle, _window: tauri::Window, policy: &Policy, bounds: Bounds, start: Url) -> Result<(), String> {
    let style = moodle_style::script(policy.home.host_str().unwrap_or_default(), moodle(app).theme().as_ref());
    let rules = crate::moodle_ios::Rules {
        home: policy.home.host_str().unwrap_or_default().to_string(),
        hosts: policy.hosts.clone(),
        domains: policy.domains.clone(),
    };
    View::create(app, rules, (bounds.x, bounds.y, bounds.width, bounds.height), start, style).await
}

// iOS: what the view tells of itself, in the order it happened.
#[cfg(target_os = "ios")]
pub fn view_event(app: &AppHandle, event: crate::moodle_ios::Event) {
    use crate::moodle_ios::Event;
    let moodle = moodle(app);
    let Some(policy) = moodle.lock().policy.clone() else { return };
    match event {
        // Its page goes to one of the university's addresses.
        Event::Going(url) => {
            let _ = allows(app, &policy, &url);
        }
        // Its page, or a new tab, asks for an address the view doesn't
        // take: the browser's, or refused. (One it should have taken after
        // all loads in it.)
        Event::Asked(url) => {
            if allows(app, &policy, &url) {
                if let Some(view) = view(app) {
                    let _ = view.navigate(url);
                }
            }
        }
        Event::Started(url) => page_loaded(app, &policy, PageLoadEvent::Started, &url),
        Event::Finished(url) => page_loaded(app, &policy, PageLoadEvent::Finished, &url),
        Event::Shown { file } => moodle.update(|state| state.file = file),
        Event::Changed => moodle.touch(),
        Event::Failed(address) => moodle.update(|state| {
            // Back to a page of Moodle's, not to wherever a link led.
            state.failed = address.filter(|url| policy.is_moodle(url));
            state.phase = Phase::Failed;
        }),
    }
}

// The page's routes for the view (desktop.rs lists them), the same on iOS
// (ios.rs): POST /__desktop/moodle/<what>.
pub const ROUTES: &str = "/__desktop/moodle/";

pub async fn route(app: &AppHandle, window_label: &str, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let status = |code: u16| http::Response::builder().status(code).body(Vec::new()).unwrap();
    match request.uri().path() {
        "/__desktop/moodle/open" => match serde_json::from_slice::<OpenBody>(request.body()) {
            Ok(body) => match open(app, window_label, body).await {
                Ok(()) => status(204),
                Err(error) => {
                    eprintln!("[tafac] Moodle view: {error}");
                    status(400)
                }
            },
            Err(_) => status(400),
        },
        "/__desktop/moodle/show" => {
            if let Ok(bounds) = serde_json::from_slice::<Bounds>(request.body()) {
                show(app, window_label, bounds);
            }
            status(204)
        }
        "/__desktop/moodle/bounds" => {
            if let Ok(place) = serde_json::from_slice::<Bounds>(request.body()) {
                bounds(app, window_label, place);
            }
            status(204)
        }
        "/__desktop/moodle/hide" => {
            hide(app, window_label);
            status(204)
        }
        "/__desktop/moodle/state" => {
            let asked = serde_json::from_slice::<StateRequest>(request.body()).unwrap_or_default();
            http::Response::builder()
                .status(200)
                .header("content-type", "application/json")
                .header("cache-control", "no-store")
                .body(serde_json::to_vec(&state(app, window_label, asked).await).unwrap_or_default())
                .unwrap()
        }
        "/__desktop/moodle/command" => {
            if let Ok(body) = serde_json::from_slice::<CommandBody>(request.body()) {
                command(app, window_label, body);
            }
            status(204)
        }
        "/__desktop/moodle/theme" => {
            if let Ok(body) = serde_json::from_slice::<ThemeBody>(request.body()) {
                theme(app, body);
            }
            status(204)
        }
        _ => status(404),
    }
}

#[derive(Deserialize)]
pub struct OpenBody {
    #[serde(flatten)]
    bounds: Bounds,
    // A page of Moodle's to open on (a deadline's activity), else where the
    // view is, or the dashboard.
    #[serde(default)]
    target: Option<String>,
    // The app's theme, for the view's pages.
    #[serde(default)]
    theme: Option<ThemeBody>,
}

// POST /__desktop/moodle/open: the view made, hidden, where the page's slot
// is; one already there goes to `target`.
pub async fn open(app: &AppHandle, window_label: &str, body: OpenBody) -> Result<(), String> {
    if !body.bounds.usable() {
        return Err("bad request".into());
    }
    let moodle = moodle(app);
    if let Some(body) = body.theme {
        theme(app, body);
    }
    let _one_at_a_time = moodle.opening.lock().await;
    let policy = policy(app).await.ok_or("no Moodle for this session")?;
    let target = match body.target.as_deref() {
        Some(target) => Some(Url::parse(target).ok().filter(|url| policy.is_moodle(url)).ok_or("not an address of Moodle's")?),
        None => None,
    };

    let Some(view) = view(app) else {
        return create(app, window_label, &policy, body.bounds, target).await;
    };
    // Asked from another window than the one it is in: it moves there.
    if moodle.lock().window != window_label {
        let window = app.get_window(window_label).ok_or("no window")?;
        let _ = view.hide();
        view.reparent(&window).map_err(|error| error.to_string())?;
        moodle.update(|state| {
            state.window = window_label.to_string();
            state.shown = false;
        });
    }
    place(&view, body.bounds);
    if let Some(target) = target {
        // Off screen until that page is there.
        moodle.update(|state| {
            state.phase = Phase::Opening;
            state.target = Some(target.clone());
            state.wanted = Some(target.clone());
        });
        let _ = view.navigate(target);
        return Ok(());
    }
    // Back on « Moodle » after it couldn't open (the network was down, the
    // server couldn't sign in): another try, what failed may have passed.
    let again = moodle.update(|state| {
        let stuck = matches!(state.phase, Phase::SignIn | Phase::Failed);
        if !stuck || state.relay_at.is_some_and(|at| at.elapsed() < RELAY_SETTLES) {
            return None;
        }
        state.phase = Phase::Opening;
        state.relay_at = Some(Instant::now());
        state.failed.take().or_else(|| state.wanted.clone()).or_else(|| Some(policy.home.clone()))
    });
    if let Some(target) = again {
        sign_in(app, target);
    }
    Ok(())
}

// POST /__desktop/moodle/theme: the app's theme changed (or the page says
// what it is). Kept for the next view, and the view there now takes it at
// once, without a reload.
pub fn theme(app: &AppHandle, body: ThemeBody) {
    let theme = Theme::from_body(body);
    let moodle = moodle(app);
    {
        let mut kept = moodle.theme.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if kept.as_ref().is_some_and(|kept| kept.looks_like(&theme)) {
            return;
        }
        *kept = Some(theme.clone());
    }
    if let Some(view) = view(app) {
        let _ = view.eval(moodle_style::announce(&theme));
    }
}

// Whether the view is in the window `window_label`: only that window's page
// places it, shows it, hides it and drives it.
fn is_in(app: &AppHandle, window_label: &str) -> bool {
    moodle(app).lock().window == window_label
}

// POST /__desktop/moodle/show: on screen, where the slot is, the keyboard in
// it.
pub fn show(app: &AppHandle, window_label: &str, bounds: Bounds) {
    if !is_in(app, window_label) {
        return;
    }
    let (Some(view), true) = (view(app), bounds.usable()) else { return };
    place(&view, bounds);
    let _ = view.show();
    let _ = view.set_focus();
    moodle(app).lock().shown = true;
}

// POST /__desktop/moodle/bounds: the slot moved or changed size.
pub fn bounds(app: &AppHandle, window_label: &str, bounds: Bounds) {
    if let (Some(view), true, true) = (view(app), bounds.usable(), is_in(app, window_label)) {
        place(&view, bounds);
    }
}

// The keyboard back to the app's page: a hidden view would keep it.
#[cfg(target_os = "ios")]
fn focus_page(_app: &AppHandle, _window_label: &str) {}

#[cfg(desktop)]
fn focus_page(app: &AppHandle, window_label: &str) {
    if let Some(page) = crate::window::page(app, window_label) {
        let _ = page.view.set_focus();
    }
}

// POST /__desktop/moodle/hide: the page left « Moodle », or covers it.
pub fn hide(app: &AppHandle, window_label: &str) {
    if !is_in(app, window_label) {
        return;
    }
    let Some(view) = view(app) else { return };
    let _ = view.hide();
    let moodle = moodle(app);
    let (was_shown, window) = {
        let mut state = moodle.lock();
        (std::mem::replace(&mut state.shown, false), state.window.clone())
    };
    if was_shown {
        focus_page(app, &window);
    }
}

// The page of the window `window_label` loads again (a reload, the address
// changed): whatever it had asked is forgotten, so the view leaves the
// screen until the new page asks for it.
pub fn page_reloaded(app: &AppHandle, window_label: &str) {
    let moodle = moodle(app);
    let is_there = {
        let state = moodle.lock();
        state.shown && state.window == window_label
    };
    if is_there {
        hide(app, window_label);
    }
}

// The view when it is the one on screen in that window (« Imprimer… »).
#[cfg(desktop)]
pub fn shown_in(app: &AppHandle, window_label: &str) -> Option<View> {
    let moodle = moodle(app);
    let is_shown = {
        let state = moodle.lock();
        state.shown && state.window == window_label
    };
    is_shown.then(|| view(app)).flatten()
}

// The student signs out of the app, or signs in: the view goes, and with it
// all it kept of Moodle (its cookies were in memory only).
pub fn close(app: &AppHandle) {
    let moodle = moodle(app);
    let (was_shown, window) = {
        let state = moodle.lock();
        (state.shown, state.window.clone())
    };
    if let Some(view) = view(app) {
        let _ = view.close();
        if was_shown {
            focus_page(app, &window);
        }
    }
    moodle.update(|state| *state = State::default());
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Command {
    Back,
    Forward,
    Reload,
    Stop,
    // Moodle's own dashboard again.
    Home,
    // Where the view is, in the student's browser.
    Browser,
    // The file in view, saved.
    Download,
    // After a page that didn't load.
    Retry,
}

#[derive(Deserialize)]
pub struct CommandBody {
    command: Command,
}

#[cfg(target_os = "ios")]
fn go(view: &View, command: Command) {
    view.go(match command {
        Command::Back => "back",
        Command::Forward => "forward",
        _ => "stop",
    });
}

#[cfg(any(target_os = "macos", windows))]
fn go(view: &View, command: Command) {
    use crate::moodle_native::Move;
    let to = match command {
        Command::Back => Move::Back,
        Command::Forward => Move::Forward,
        _ => Move::Stop,
    };
    crate::moodle_native::go(view, to);
}

#[cfg(all(desktop, not(target_os = "macos"), not(windows)))]
fn go(view: &View, command: Command) {
    let _ = view.eval(match command {
        Command::Back => "history.back()",
        Command::Forward => "history.forward()",
        _ => "window.stop()",
    });
}

// « Télécharger »: the file in view, saved. The view's document fetches it
// again (from its cache, with its session) and saves the copy, named after
// the file: a download link straight to the address would be asked without
// the session, and Moodle would send its login page instead (seen with a PDF
// in view).
fn download(view: &View) {
    let Ok(url) = view.url() else { return };
    if url.scheme() != "https" {
        return;
    }
    let name = serde_json::to_string(&file_name(&url)).unwrap_or_else(|_| "\"\"".into());
    let _ = view.eval(format!(
        "(async () => {{ \
            const response = await fetch(location.href, {{ credentials: 'include' }}); \
            if (!response.ok) return; \
            const address = URL.createObjectURL(await response.blob()); \
            const link = document.createElement('a'); \
            link.href = address; \
            link.download = {name}; \
            document.documentElement.append(link); \
            link.click(); \
            link.remove(); \
            setTimeout(() => URL.revokeObjectURL(address), 60000); \
        }})()"
    ));
}

// POST /__desktop/moodle/command: the page's toolbar.
pub fn command(app: &AppHandle, window_label: &str, body: CommandBody) {
    if !is_in(app, window_label) {
        return;
    }
    let Some(view) = view(app) else { return };
    let moodle = moodle(app);
    match body.command {
        Command::Back | Command::Forward | Command::Stop => go(&view, body.command),
        Command::Reload => {
            let _ = view.reload();
        }
        Command::Home => {
            let home = moodle.lock().policy.as_ref().map(|policy| policy.home.clone());
            if let Some(home) = home {
                let _ = view.navigate(home);
            }
        }
        // Before Moodle is there (or when it can't be), its dashboard.
        Command::Browser => {
            let home = moodle.lock().policy.as_ref().map(|policy| policy.home.clone());
            if let Some(url) = view.url().ok().filter(|url| url.scheme() == "https").or(home) {
                links::open_outside(&url);
            }
        }
        Command::Download => download(&view),
        Command::Retry => {
            let target = moodle.update(|state| {
                let home = state.policy.as_ref().map(|policy| policy.home.clone());
                let target = state.failed.take().or_else(|| state.wanted.clone()).or(home);
                state.phase = Phase::Opening;
                state.relay_at = Some(Instant::now());
                target
            });
            if let Some(target) = target {
                sign_in(app, target);
            }
        }
    }
    moodle.touch();
}

#[derive(Deserialize, Default)]
pub struct StateRequest {
    // The version the page already has: the answer waits for another.
    #[serde(default)]
    since: Option<u64>,
}

#[derive(Serialize)]
pub struct StateBody {
    version: u64,
    phase: Phase,
    loading: bool,
    back: bool,
    forward: bool,
    title: String,
    // A file in view (a PDF, a picture): « Télécharger » applies.
    file: bool,
}

#[cfg(target_os = "ios")]
async fn reading(view: &View) -> (bool, bool, bool, String) {
    view.reading().await
}

#[cfg(any(target_os = "macos", windows))]
async fn reading(view: &View) -> (bool, bool, bool, String) {
    let reading = crate::moodle_native::read(view).await;
    (reading.loading, reading.back, reading.forward, reading.title)
}

// Elsewhere the view doesn't say: the arrows stay on.
#[cfg(all(desktop, not(target_os = "macos"), not(windows)))]
async fn reading(_view: &View) -> (bool, bool, bool, String) {
    (false, true, true, String::new())
}

// A file has no title: its name, from its address (percent-decoded).
fn file_name(url: &Url) -> String {
    let name = url.path_segments().and_then(|mut segments| segments.next_back()).unwrap_or_default();
    let raw = name.as_bytes();
    let mut bytes = Vec::with_capacity(raw.len());
    let mut index = 0;
    while index < raw.len() {
        let escaped = (raw[index] == b'%')
            .then(|| raw.get(index + 1..index + 3))
            .flatten()
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match escaped {
            Some(byte) => {
                bytes.push(byte);
                index += 3;
            }
            None => {
                bytes.push(raw[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

// POST /__desktop/moodle/state: what the toolbar shows. Answers when
// something changed since `since`, or after a short wait.
pub async fn state(app: &AppHandle, window_label: &str, request: StateRequest) -> StateBody {
    let moodle = moodle(app);
    let mut version = moodle.version.subscribe();
    if request.since == Some(*version.borrow_and_update()) {
        let _ = tokio::time::timeout(STATE_WAIT, version.changed()).await;
    }
    let version = *version.borrow();
    let (phase, file, is_here) = {
        let state = moodle.lock();
        (state.phase, state.file, state.window == window_label)
    };
    let nothing = |phase| StateBody { version, phase, loading: false, back: false, forward: false, title: String::new(), file: false };
    // Said to every window, view or not: the page signs out.
    if phase == Phase::Expired {
        return nothing(Phase::Expired);
    }
    let Some(view) = view(app) else {
        // A state without its view: the window it was in was closed.
        let is_gone = {
            let mut state = moodle.lock();
            let is_gone = state.phase != Phase::None && !state.making;
            if is_gone {
                *state = State { policy: state.policy.take(), ..State::default() };
            }
            is_gone
        };
        return nothing(if is_gone { Phase::Gone } else if phase == Phase::Opening { Phase::Opening } else { Phase::None });
    };
    if !is_here {
        return nothing(Phase::Elsewhere);
    }
    let (loading, back, forward, title) = reading(&view).await;
    let title = match (title.is_empty(), file, view.url()) {
        (true, true, Ok(url)) => file_name(&url),
        _ => title,
    };
    StateBody { version, phase, loading, back, forward, title, file }
}

// A link the app's page opens in a new tab that is Moodle's (a deadline,
// Moodle's tile, a link in a mail): its address there, to open in
// « Moodle » rather than in the browser. The relay's link to a page of
// Moodle's counts.
pub async fn link_target(app: &AppHandle, url: &Url) -> Option<Url> {
    let address = if links::is_app_url(url) {
        if url.path() != LAUNCH_PATH {
            return None;
        }
        let target = url.query_pairs().find(|(name, _)| name == "url")?.1.into_owned();
        Url::parse(&target).ok()?
    } else {
        url.clone()
    };
    if address.scheme() != "https" {
        return None;
    }
    policy(app).await?.is_moodle(&address).then_some(address)
}

// Tells that window's page to show « Moodle » on `target` (src/App.jsx).
#[cfg(target_os = "ios")]
pub fn open_in_page(app: &AppHandle, _window_label: &str, target: &Url) -> bool {
    let Some(page) = app.get_webview_window("main") else { return false };
    let detail = serde_json::json!({ "command": "moodle", "url": target.as_str() });
    page.eval(format!("window.dispatchEvent(new CustomEvent('tafac:command', {{ detail: {detail} }}))")).is_ok()
}

#[cfg(desktop)]
pub fn open_in_page(app: &AppHandle, window_label: &str, target: &Url) -> bool {
    let Some(page) = crate::window::page(app, window_label).or_else(|| crate::window::page(app, "main")) else { return false };
    let detail = serde_json::json!({ "command": "moodle", "url": target.as_str() });
    page.view.eval(format!("window.dispatchEvent(new CustomEvent('tafac:command', {{ detail: {detail} }}))")).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(address: &str) -> Url {
        Url::parse(address).unwrap()
    }

    fn rennes() -> Policy {
        Policy::parse(
            br#"{
                "home": "https://foad.univ-rennes.fr/my/",
                "hosts": ["foad.univ-rennes.fr", "sso-cas.univ-rennes.fr", "notes9.iutlan.univ-rennes1.fr"],
                "domains": ["wayf.univ-rennes.fr", "ident-shib.univ-rennes1.fr", "univ-rennes.fr"],
                "signIn": ["sso-cas.univ-rennes.fr", "wayf.univ-rennes.fr", "ident-shib.univ-rennes1.fr"]
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn base64_pads_as_the_standard_says() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64("<p>é</p>".as_bytes()), "PHA+w6k8L3A+");
    }

    #[test]
    fn a_policy_needs_a_moodle_over_https() {
        assert!(Policy::parse(br#"{ "home": "http://moodle.example.fr/my/" }"#).is_none());
        assert!(Policy::parse(br#"{ "home": "/my/" }"#).is_none());
        assert!(Policy::parse(br#"{ "ok": false }"#).is_none());
        assert!(Policy::parse(br#"{ "home": "https://moodle.example.fr/my/" }"#).is_some());
    }

    #[test]
    fn the_universitys_addresses_stay_in_the_view() {
        let policy = rennes();
        for address in [
            "https://foad.univ-rennes.fr/course/view.php?id=1",
            "https://sso-cas.univ-rennes.fr/login",
            // The sign-in chain's IdP, on another domain than Moodle's.
            "https://ident-shib.univ-rennes1.fr/idp/profile/SAML2/Redirect/SSO",
            "https://wayf.univ-rennes.fr/",
            "https://video.univ-rennes.fr/video/1/",
            "about:blank",
            "blob:https://foad.univ-rennes.fr/0b1c8a52-6c0f-4e0a-9c53-1d1f0a6f8e11",
            "data:text/html;base64,PHA+",
        ] {
            assert_eq!(classify(&policy, &url(address)), Navigation::Stay, "{address}");
        }
    }

    #[test]
    fn any_other_web_address_goes_to_the_browser() {
        let policy = rennes();
        for address in [
            "https://www.youtube.com/watch?v=x",
            "http://foad.univ-rennes.fr/",
            // Look-alikes of the university's.
            "https://univ-rennes.fr.evil.example/",
            "https://evil-univ-rennes.fr/",
            "https://foad.univ-rennes.fr.evil.example/my/",
            "https://other.univ-rennes1.fr/",
            "mailto:scolarite@univ-rennes.fr",
        ] {
            assert_eq!(classify(&policy, &url(address)), Navigation::Browser, "{address}");
        }
    }

    #[test]
    fn the_apps_own_pages_and_other_programs_are_refused() {
        let policy = rennes();
        for address in ["tafac://localhost/", "tafac://localhost/__ent_auth/session", "file:///etc/passwd", "javascript:alert(1)", "zoommtg://zoom.us/join"] {
            assert_eq!(classify(&policy, &url(address)), Navigation::Refuse, "{address}");
        }
    }

    #[test]
    fn a_sign_in_page_is_moodles_login_or_a_step_of_the_universitys() {
        let policy = rennes();
        assert!(policy.is_sign_in(&url("https://foad.univ-rennes.fr/login/index.php")));
        assert!(policy.is_sign_in(&url("https://sso-cas.univ-rennes.fr/login?service=x")));
        assert!(policy.is_sign_in(&url("https://wayf.univ-rennes.fr/?entityID=x")));
        assert!(policy.is_sign_in(&url("https://ident-shib.univ-rennes1.fr/idp/profile")));
        assert!(!policy.is_sign_in(&url("https://foad.univ-rennes.fr/my/")));
        assert!(!policy.is_sign_in(&url("https://foad.univ-rennes.fr/login/logout.php")));
        assert!(!policy.is_sign_in(&url("https://video.univ-rennes.fr/login/index.php")));
    }

    #[test]
    fn a_new_sign_in_goes_back_to_a_page_not_to_a_step_of_the_sign_in() {
        let policy = rennes();
        assert!(policy.is_page(&url("https://foad.univ-rennes.fr/mod/assign/view.php?id=1")));
        assert!(!policy.is_page(&url("https://foad.univ-rennes.fr/login/index.php")));
        assert!(!policy.is_page(&url("https://foad.univ-rennes.fr/Shibboleth.sso/SAML2/POST")));
        assert!(!policy.is_page(&url("https://foad.univ-rennes.fr/auth/shibboleth/index.php")));
        assert!(!policy.is_page(&url("https://sso-cas.univ-rennes.fr/login")));
    }

    #[test]
    fn the_relay_is_asked_for_the_page_wanted() {
        assert_eq!(
            launch_path(&url("https://foad.univ-rennes.fr/mod/assign/view.php?id=1&x=a b")),
            "/__ent_auth/launch?url=https%3A%2F%2Ffoad.univ-rennes.fr%2Fmod%2Fassign%2Fview.php%3Fid%3D1%26x%3Da%2520b"
        );
    }

    #[test]
    fn the_same_page_whatever_its_fragment() {
        assert!(same_page(&url("https://foad.univ-rennes.fr/my/"), &url("https://foad.univ-rennes.fr/my/#")));
        assert!(!same_page(&url("https://foad.univ-rennes.fr/my/"), &url("https://foad.univ-rennes.fr/my/courses.php")));
    }

    fn answer(status: u16, headers: &[(&str, &str)]) -> http::Response<Vec<u8>> {
        let mut builder = http::Response::builder().status(status);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        builder.body(Vec::new()).unwrap()
    }

    #[test]
    fn only_the_servers_header_says_the_session_expired() {
        assert!(says_expired(&answer(302, &[("location", "/login?session=expired"), ("X-Tafac-Session", "expired")])));
        assert!(says_expired(&answer(404, &[("x-tafac-session", "expired")])));
        // A failure of its own is no expired session: the page says Moodle
        // is unavailable.
        assert!(!says_expired(&answer(502, &[])));
        assert!(!says_expired(&answer(302, &[("location", "https://foad.univ-rennes.fr/my/")])));
        assert!(!says_expired(&answer(200, &[("x-tafac-session", "valid")])));
    }

    #[test]
    fn a_relay_without_a_page_goes_to_the_target() {
        let target = url("https://foad.univ-rennes.fr/my/");
        // The login form the server redirects a browser to is no page of
        // Moodle's: never loaded in the view.
        assert_eq!(relay_start(&answer(302, &[("location", "/login?session=expired")]), &target), target);
        assert_eq!(relay_start(&answer(302, &[("location", "https://foad.univ-rennes.fr/my/?ticket=1")]), &target).as_str(), "https://foad.univ-rennes.fr/my/?ticket=1");
        assert_eq!(relay_start(&answer(502, &[]), &target), target);
    }

    #[test]
    fn a_file_is_named_after_its_address() {
        assert_eq!(file_name(&url("https://foad.univ-rennes.fr/pluginfile.php/1/mod_resource/content/2/R304%200%20pr%C3%A9sentation.pdf")), "R304 0 présentation.pdf");
        assert_eq!(file_name(&url("https://foad.univ-rennes.fr/a/100%.pdf")), "100%.pdf");
    }
}
