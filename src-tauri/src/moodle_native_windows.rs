// Windows: what Moodle's view (moodle.rs) needs from WebView2 itself, beyond
// what Tauri hands over. The same interface as moodle_native.rs (macOS).
//
// Unlike WebKit, WebView2 asks Tauri's navigation rule for the page alone
// (NavigationStarting): an embedded video's frame loads as in a browser
// already, and a server's « attachment » is downloaded already. What is
// left: saying what the page shows (a web page or a file), when a page
// starts loading, when it failed, and where the history stands.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use tauri::{Webview, Wry};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::*;
use windows::core::{Interface, BOOL, PWSTR};

// What the view tells moodle.rs, on the main thread.
pub struct Hooks {
    // What the page now shows: a file (a PDF, a picture) rather than a web page.
    pub shown: Box<dyn Fn(bool)>,
    // A page starts loading, or a load ended without one (a download).
    pub changed: Box<dyn Fn()>,
    // A page could not load (offline, the server not answering): its address.
    pub failed: Box<dyn Fn(Option<String>)>,
}

// The page being loaded, between NavigationStarting and NavigationCompleted.
#[derive(Default)]
struct Loading {
    active: Cell<bool>,
    address: RefCell<String>,
    // It became a download: its end is no failure.
    downloaded: Cell<bool>,
}

thread_local! {
    // The view's, on the main thread where WebView2's events come (the next
    // view's takes its place).
    static LOADING: RefCell<Rc<Loading>> = RefCell::new(Rc::new(Loading::default()));
}

fn core(platform: &tauri::webview::PlatformWebview) -> Option<ICoreWebView2> {
    unsafe { platform.controller().CoreWebView2() }.ok()
}

fn text(read: impl FnOnce(&mut PWSTR) -> windows::core::Result<()>) -> Option<String> {
    let mut value = PWSTR::null();
    read(&mut value).ok()?;
    Some(take_pwstr(value))
}

// Once, when the view is made (on the main thread, before its first page).
pub fn install(view: &Webview<Wry>, hooks: impl FnOnce() -> Hooks + Send + 'static) {
    let _ = view.with_webview(move |platform| {
        let Some(webview) = core(&platform) else { return };
        let hooks = Rc::new(hooks());
        let loading = Rc::new(Loading::default());
        LOADING.with(|kept| *kept.borrow_mut() = loading.clone());
        if let Err(error) = unsafe { listen(&webview, &hooks, &loading) } {
            eprintln!("[tafac] Moodle: WebView2 events not set: {error}");
        }
    });
}

unsafe fn listen(webview: &ICoreWebView2, hooks: &Rc<Hooks>, loading: &Rc<Loading>) -> windows::core::Result<()> {
    let mut token = Default::default();

    let (h, l) = (hooks.clone(), loading.clone());
    webview.add_NavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                *l.address.borrow_mut() = text(|value| unsafe { args.Uri(value) }).unwrap_or_default();
            }
            l.active.set(true);
            l.downloaded.set(false);
            (h.shown)(false);
            (h.changed)();
            Ok(())
        })),
        &mut token,
    )?;

    let (h, l) = (hooks.clone(), loading.clone());
    webview.add_NavigationCompleted(
        &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            l.active.set(false);
            let Some(args) = args else { return Ok(()) };
            let mut success = BOOL::default();
            unsafe { args.IsSuccess(&mut success)? };
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            unsafe { args.WebErrorStatus(&mut status)? };
            // Not failures: a load another one replaced or the student
            // stopped, one that became a download. A download ends its load
            // as aborted, and DownloadStarting can come after this event:
            // an aborted load is never taken for a failure (offline is
            // DISCONNECTED, CANNOT_CONNECT, TIMEOUT…, not this).
            let is_ours = status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
                || status == COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
                || l.downloaded.get();
            if success.as_bool() || is_ours {
                (h.changed)();
            } else {
                let address = l.address.borrow().clone();
                (h.failed)((!address.is_empty()).then_some(address));
            }
            Ok(())
        })),
        &mut token,
    )?;

    let h = hooks.clone();
    webview.add_HistoryChanged(
        &HistoryChangedEventHandler::create(Box::new(move |_, _| {
            (h.changed)();
            Ok(())
        })),
        &mut token,
    )?;

    // The page's own response: its type says a file (a PDF, a picture).
    if let Ok(webview) = webview.cast::<ICoreWebView2_2>() {
        let (h, l) = (hooks.clone(), loading.clone());
        webview.add_WebResourceResponseReceived(
            &WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                if !l.active.get() {
                    return Ok(());
                }
                let request = unsafe { args.Request()? };
                let address = text(|value| unsafe { request.Uri(value) }).unwrap_or_default();
                if address != *l.address.borrow() {
                    return Ok(());
                }
                let headers = unsafe { args.Response()?.Headers()? };
                let mime = text(|value| unsafe { headers.GetHeader(windows::core::w!("Content-Type"), value) })
                    .unwrap_or_default();
                let mime = mime.split(';').next().unwrap_or_default().trim().to_lowercase();
                (h.shown)(!matches!(mime.as_str(), "" | "text/html" | "application/xhtml+xml"));
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Alongside Tauri's own handler (which saves the file).
    if let Ok(webview) = webview.cast::<ICoreWebView2_4>() {
        let l = loading.clone();
        webview.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, _| {
                l.downloaded.set(true);
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

// What the toolbar shows of the view.
#[derive(Default, Clone)]
pub struct Reading {
    pub loading: bool,
    pub back: bool,
    pub forward: bool,
    pub title: String,
}

pub async fn read(view: &Webview<Wry>) -> Reading {
    let (reply, reading) = tokio::sync::oneshot::channel();
    let asked = view.with_webview(move |platform| {
        let Some(webview) = core(&platform) else { return };
        let (mut back, mut forward) = (BOOL::default(), BOOL::default());
        unsafe {
            let _ = webview.CanGoBack(&mut back);
            let _ = webview.CanGoForward(&mut forward);
        }
        let _ = reply.send(Reading {
            loading: LOADING.with(|loading| loading.borrow().active.get()),
            back: back.as_bool(),
            forward: forward.as_bool(),
            title: text(|value| unsafe { webview.DocumentTitle(value) }).unwrap_or_default(),
        });
    });
    match asked {
        Ok(()) => reading.await.unwrap_or_default(),
        Err(_) => Reading::default(),
    }
}

#[derive(Clone, Copy)]
pub enum Move {
    Back,
    Forward,
    Stop,
}

pub fn go(view: &Webview<Wry>, to: Move) {
    let _ = view.with_webview(move |platform| {
        let Some(webview) = core(&platform) else { return };
        let _ = unsafe {
            match to {
                Move::Back => webview.GoBack(),
                Move::Forward => webview.GoForward(),
                Move::Stop => webview.Stop(),
            }
        };
    });
}
