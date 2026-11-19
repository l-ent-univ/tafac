// Moodle's view on iOS, for moodle.rs: a WKWebView of the app's own
// (plugins/moodle, in Swift), since Tauri gives a window only one web view
// there. It answers to the names moodle.rs calls a desktop view by, so the
// same code drives both.
//
// What the view tells of itself (a page starting, loaded, failed, an address
// it didn't take…) comes back as `Event`s, handed to moodle.rs one after the
// other, off the main thread: what moodle.rs then asks of the view waits
// for the view's answer, which is made on the main thread.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, Url, Wry};

// Whether there is a view (made and not closed since).
static EXISTS: AtomicBool = AtomicBool::new(false);

// The university's addresses the view's page may load: Moodle's host, the
// hosts and the domains the server lists (moodle.rs' Policy). The view
// decides with them by itself, WebKit wanting its answer at once.
#[derive(Serialize)]
pub struct Rules {
    pub home: String,
    pub hosts: Vec<String>,
    pub domains: Vec<String>,
}

pub enum Event {
    // The view's page goes to one of the university's addresses.
    Going(Url),
    // An address the view didn't take: the browser's, or to refuse.
    Asked(Url),
    Started(Url),
    Finished(Url),
    // What the page shows: a file (a PDF, a picture) rather than a web page.
    Shown { file: bool },
    // Its title, whether it is loading, whether it can go back or forward.
    Changed,
    // A page could not load: its address.
    Failed(Option<Url>),
}

fn parse(body: &InvokeResponseBody) -> Option<Event> {
    let InvokeResponseBody::Json(text) = body else { return None };
    let value: Value = serde_json::from_str(text).ok()?;
    let url = || value.get("url").and_then(Value::as_str).and_then(|address| Url::parse(address).ok());
    Some(match value.get("type")?.as_str()? {
        "going" => Event::Going(url()?),
        "asked" => Event::Asked(url()?),
        "started" => Event::Started(url()?),
        "finished" => Event::Finished(url()?),
        "shown" => Event::Shown { file: value.get("file").and_then(Value::as_bool).unwrap_or(false) },
        "changed" => Event::Changed,
        "failed" => Event::Failed(url()),
        _ => return None,
    })
}

#[derive(Clone)]
pub struct View(AppHandle);

impl View {
    pub fn of(app: &AppHandle) -> Option<Self> {
        EXISTS.load(Ordering::SeqCst).then(|| Self(app.clone()))
    }

    fn run(&self, command: &str, payload: Value) -> Result<Value, String> {
        self.0.state::<tauri_plugin_moodle::MoodleView<Wry>>().run(command, payload)
    }

    // The view, made hidden at `place` (x, y, width, height: the slot's, in
    // the app's page), on its way to `start`. `style` runs before each
    // page's own scripts (moodle_style.rs).
    pub async fn create(app: &AppHandle, rules: Rules, place: (f64, f64, f64, f64), start: Url, style: String) -> Result<(), String> {
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel::<Event>();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = received.recv().await {
                crate::moodle::view_event(&handle, event);
            }
        });
        // Called on the main thread, as the view says things: only passed on.
        let channel: Channel<Value> = Channel::new(move |body| {
            if let Some(event) = parse(&body) {
                let _ = events.send(event);
            }
            Ok(())
        });
        let (x, y, width, height) = place;
        let payload = json!({ "x": x, "y": y, "width": width, "height": height, "start": start.as_str(), "script": style, "rules": rules, "channel": channel });
        let view = Self(app.clone());
        tauri::async_runtime::spawn_blocking(move || view.run("create", payload)).await.map_err(|error| error.to_string())??;
        EXISTS.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn navigate(&self, url: Url) -> Result<(), String> {
        self.run("navigate", json!({ "url": url.as_str() })).map(|_| ())
    }

    pub fn eval(&self, script: impl Into<String>) -> Result<(), String> {
        self.run("eval", json!({ "script": script.into() })).map(|_| ())
    }

    pub fn show(&self) -> Result<(), String> {
        self.run("show", Value::Null).map(|_| ())
    }

    pub fn hide(&self) -> Result<(), String> {
        self.run("hide", Value::Null).map(|_| ())
    }

    // The keyboard is the view's when the student presses in it.
    pub fn set_focus(&self) -> Result<(), String> {
        Ok(())
    }

    pub fn reload(&self) -> Result<(), String> {
        self.run("reload", Value::Null).map(|_| ())
    }

    pub fn close(&self) -> Result<(), String> {
        EXISTS.store(false, Ordering::SeqCst);
        self.run("close", Value::Null).map(|_| ())
    }

    // One window on iOS: the view never moves to another.
    pub fn reparent<W>(&self, _window: &W) -> Result<(), String> {
        Ok(())
    }

    pub fn place(&self, x: f64, y: f64, width: f64, height: f64) {
        let _ = self.run("bounds", json!({ "x": x, "y": y, "width": width, "height": height }));
    }

    // back, forward, stop
    pub fn go(&self, to: &str) {
        let _ = self.run("go", json!({ "to": to }));
    }

    fn read(&self) -> Option<Value> {
        self.run("read", Value::Null).ok()
    }

    pub fn url(&self) -> Result<Url, String> {
        let read = self.read().ok_or("no view")?;
        let address = read.get("url").and_then(Value::as_str).unwrap_or_default();
        Url::parse(address).map_err(|error| error.to_string())
    }

    // Whether a page is loading, whether the view can go back, forward, and
    // its page's title.
    pub async fn reading(&self) -> (bool, bool, bool, String) {
        let view = self.clone();
        let read = tauri::async_runtime::spawn_blocking(move || view.read()).await.ok().flatten().unwrap_or(Value::Null);
        let flag = |name: &str| read.get(name).and_then(Value::as_bool).unwrap_or(false);
        (flag("loading"), flag("back"), flag("forward"), read.get("title").and_then(Value::as_str).unwrap_or_default().to_string())
    }
}
