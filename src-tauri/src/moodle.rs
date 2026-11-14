// Moodle inside the app: a web view of its own laid over the page's
// « Moodle » (src/components/MoodlePage.jsx), not an iframe. Moodle sends
// X-Frame-Options: sameorigin, so a frame in the page stays empty; a web view
// of the app's is a browser of its own, where Moodle is the page.
//
// The page says where its slot is (POST /__desktop/moodle/show, /bounds,
// desktop.rs), in the window's points; the view follows it, and hides when
// the page leaves « Moodle » or something opens over it (a sheet, a menu).
// It opens through the launch relay (/__ent_auth/launch): the server asks
// CAS for a Moodle ticket with the student's session, so Moodle opens
// signed in. Its cookies stay in the app's web data, as a browser's would.
//
// Inside the view: Moodle and the university's own addresses (CAS, other
// services on the same domain) stay in it; anything else opens in the
// student's browser. A new tab (target="_blank") on the university's domain
// opens in the view itself. Downloads go to the Downloads folder, as the
// page's.

use std::sync::Arc;

use serde::Deserialize;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl, Wry};

use crate::bridge::{self, Bridge};
use crate::links;

const LABEL: &str = "moodle";
const LAUNCH_PREFIX: &str = "/__ent_auth/launch?";

#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn usable(&self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite())
            && self.width >= 1.0
            && self.height >= 1.0
    }
}

#[derive(Deserialize)]
pub struct ShowBody {
    // The launch relay's address for Moodle (navItems.js), path and query.
    launch: String,
    #[serde(flatten)]
    bounds: Bounds,
}

fn view(app: &AppHandle) -> Option<Webview<Wry>> {
    app.get_webview(LABEL)
}

fn place(view: &Webview<Wry>, bounds: Bounds) {
    let _ = view.set_position(LogicalPosition::new(bounds.x, bounds.y));
    let _ = view.set_size(LogicalSize::new(bounds.width, bounds.height));
}

// The registrable part of a host, for "the university's own addresses":
// foad.univ-rennes.fr → univ-rennes.fr.
fn site(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    labels[labels.len().saturating_sub(2)..].join(".")
}

fn stays_inside(url: &Url, home: &str) -> bool {
    match url.scheme() {
        "https" => url.host_str().is_some_and(|host| site(host) == home),
        "about" | "blob" | "data" => true,
        _ => false,
    }
}

// Where the launch relay sends. Either a redirect: Moodle with its CAS
// ticket (or CAS' login page if the session is gone); or, for a Moodle
// behind Shibboleth (Rennes), a page that posts the university's sign-in to
// Moodle by itself, loaded as is so its form posts from the view. The
// relay's own address is the app's, which this view can't load, so it is
// asked through the bridge, as a new tab's.
async fn launch_target(app: &AppHandle, launch: &str) -> Option<Url> {
    let bridge = app.state::<Arc<Bridge>>().inner().clone();
    let request = http::Request::get(launch)
        .header(http::header::ACCEPT, "text/html,*/*")
        .body(Vec::new())
        .ok()?;
    let response = bridge::forward(&bridge, request).await;
    if response.status().is_redirection() {
        let location = response.headers().get(http::header::LOCATION)?.to_str().ok()?;
        return Url::parse(location).ok().filter(|url| url.scheme() == "https");
    }
    let is_html = response
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"));
    if response.status() == http::StatusCode::OK && is_html {
        return Url::parse(&format!("data:text/html;charset=utf-8;base64,{}", base64(response.body()))).ok();
    }
    None
}

fn base64(bytes: &[u8]) -> String {
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

// The launch relay's own fallback: the address it was given (?url=…).
fn launch_destination(launch: &str) -> Option<Url> {
    let query = launch.strip_prefix(LAUNCH_PREFIX)?;
    let base = Url::parse("https://launch.invalid/").ok()?;
    let url = base.join(&format!("?{query}")).ok()?;
    let destination = url.query_pairs().find(|(name, _)| name == "url")?.1.into_owned();
    Url::parse(&destination).ok().filter(|url| url.scheme() == "https")
}

async fn create(app: &AppHandle, window_label: &str, launch: &str, bounds: Bounds) -> Result<(), String> {
    let destination = launch_destination(launch).ok_or("not a Moodle launch address")?;
    let home = site(destination.host_str().ok_or("no host")?);
    let start = launch_target(app, launch).await.unwrap_or(destination);

    let window = app.get_window(window_label).ok_or("no window")?;
    let navigation_home = home.clone();
    let new_window_app = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
        .on_navigation(move |url| {
            if stays_inside(url, &navigation_home) {
                return true;
            }
            // A web address opens in the browser; nothing else (the app's
            // own pages included) loads here.
            links::allow_navigation(url);
            false
        })
        .on_new_window(move |url, _features| {
            if stays_inside(&url, &home) {
                if let Some(view) = view(&new_window_app) {
                    let _ = view.navigate(url);
                }
            } else {
                links::allow_navigation(&url);
            }
            NewWindowResponse::Deny
        })
        .on_download(links::download);

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Another request may have made it meanwhile.
        if let Some(view) = view(&app) {
            place(&view, bounds);
            return Ok(());
        }
        window
            .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width, bounds.height))
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

// POST /__desktop/moodle/show: the view where the page's slot is, made the
// first time.
pub async fn show(app: &AppHandle, window_label: &str, body: ShowBody) -> Result<(), String> {
    if !body.launch.starts_with(LAUNCH_PREFIX) || !body.bounds.usable() {
        return Err("bad request".into());
    }
    match view(app) {
        Some(view) => {
            place(&view, body.bounds);
            view.show().map_err(|error| error.to_string())
        }
        None => create(app, window_label, &body.launch, body.bounds).await,
    }
}

// POST /__desktop/moodle/bounds: the slot moved or changed size.
pub fn bounds(app: &AppHandle, bounds: Bounds) {
    if let (Some(view), true) = (view(app), bounds.usable()) {
        place(&view, bounds);
    }
}

// POST /__desktop/moodle/hide: the page left « Moodle », or covers it.
pub fn hide(app: &AppHandle) {
    if let Some(view) = view(app) {
        let _ = view.hide();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Command {
    Back,
    Forward,
    Reload,
    // Moodle's own dashboard again.
    Home,
    // Where the view is, in the student's browser.
    Browser,
}

#[derive(Deserialize)]
pub struct CommandBody {
    command: Command,
    #[serde(default)]
    home: Option<String>,
}

// POST /__desktop/moodle/command: the page's toolbar.
pub fn command(app: &AppHandle, body: CommandBody) {
    let Some(view) = view(app) else { return };
    match body.command {
        Command::Back => {
            let _ = view.eval("history.back()");
        }
        Command::Forward => {
            let _ = view.eval("history.forward()");
        }
        Command::Reload => {
            let _ = view.reload();
        }
        Command::Home => {
            if let Some(home) = body.home.as_deref().and_then(launch_destination) {
                let _ = view.navigate(home);
            }
        }
        Command::Browser => {
            if let Ok(url) = view.url() {
                if url.scheme() == "https" {
                    links::allow_navigation(&url);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_pads_as_the_standard_says() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64("<p>é</p>".as_bytes()), "PHA+w6k8L3A+");
    }

    #[test]
    fn the_launch_relay_says_where_moodle_is() {
        let launch = "/__ent_auth/launch?url=https%3A%2F%2Ffoad.univ-rennes.fr%2Fmy%2F";
        assert_eq!(launch_destination(launch).unwrap().as_str(), "https://foad.univ-rennes.fr/my/");
        assert!(launch_destination("/__ent_auth/launch?url=http%3A%2F%2Fexample.org").is_none());
        assert_eq!(site("foad.univ-rennes.fr"), "univ-rennes.fr");
        assert!(stays_inside(&Url::parse("https://sso-cas.univ-rennes.fr/login").unwrap(), "univ-rennes.fr"));
        assert!(!stays_inside(&Url::parse("https://www.youtube.com/").unwrap(), "univ-rennes.fr"));
        assert!(!stays_inside(&Url::parse("tafac://localhost/").unwrap(), "univ-rennes.fr"));
    }
}
