// macOS: what Moodle's view (moodle.rs) needs from WebKit itself, beyond what
// Tauri hands over.
//
// Tauri's navigation rule is asked for every frame of the page, with the
// address alone. A course page's embedded video (a frame on another site)
// would be refused and sent to the browser, once per frame. So the view's
// navigation delegate is wrapped: frames inside a page load as in a browser,
// and only the page itself (and new tabs) go to Tauri's rule, unchanged.
//
// The wrapper also:
// - downloads what the server sends as a file (Content-Disposition:
//   attachment), which WebKit would show when it can (a PDF, a picture);
// - says what the page shows (a web page or a file), when a page starts
//   loading and when it failed, which Tauri doesn't.

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, Sel};
use objc2::{define_class, msg_send, ClassType, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::NSAutoresizingMaskOptions;
use objc2_foundation::{ns_string, NSError, NSHTTPURLResponse, NSProcessInfo, NSString};
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationResponse, WKNavigationResponsePolicy, WKWebView,
};
use tauri::{Webview, Wry};

// What the view tells moodle.rs, on the main thread.
pub struct Hooks {
    // What the page now shows: a file (a PDF, a picture) rather than a web page.
    pub shown: Box<dyn Fn(bool)>,
    // A page starts loading, or a load ended without one (a download).
    pub changed: Box<dyn Fn()>,
    // A page could not load (offline, the server not answering): its address.
    pub failed: Box<dyn Fn(Option<String>)>,
}

struct Ivars {
    // Tauri's own delegate, which every other message goes to.
    inner: Retained<AnyObject>,
    hooks: Hooks,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "TafacMoodleNavigationDelegate"]
    #[ivars = Ivars]
    struct NavigationDelegate;

    unsafe impl NSObjectProtocol for NavigationDelegate {}

    impl NavigationDelegate {
        // WebKit asks once which messages its delegate takes: Tauri's too.
        #[unsafe(method(respondsToSelector:))]
        fn responds_to_selector(&self, selector: Sel) -> bool {
            Self::class().responds_to(selector) || unsafe { msg_send![&*self.ivars().inner, respondsToSelector: selector] }
        }

        #[unsafe(method(forwardingTargetForSelector:))]
        fn forwarding_target(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().inner).cast_mut()
        }

        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_action(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            handler: &block2::Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let url = unsafe { action.request().URL() };
            // No target frame: a new tab, the page's business as well.
            let in_frame = unsafe { action.targetFrame() }.is_some_and(|frame| !unsafe { frame.isMainFrame() });
            if in_frame {
                let scheme = url.and_then(|url| url.scheme()).map(|scheme| scheme.to_string().to_lowercase());
                let policy = match scheme.as_deref() {
                    Some("https" | "http" | "about" | "blob" | "data") => WKNavigationActionPolicy::Allow,
                    _ => WKNavigationActionPolicy::Cancel,
                };
                handler.call((policy,));
                return;
            }
            let _: () = unsafe {
                msg_send![&*self.ivars().inner, webView: webview, decidePolicyForNavigationAction: action, decisionHandler: handler]
            };
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn decide_response(
            &self,
            webview: &WKWebView,
            response: &WKNavigationResponse,
            handler: &block2::Block<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            if unsafe { response.isForMainFrame() } {
                let answer = unsafe { response.response() };
                let is_attachment = answer
                    .downcast_ref::<NSHTTPURLResponse>()
                    .and_then(|http| http.valueForHTTPHeaderField(ns_string!("Content-Disposition")))
                    .is_some_and(|disposition| disposition.to_string().trim_start().to_lowercase().starts_with("attachment"));
                if is_attachment && downloads_exist() {
                    handler.call((WKNavigationResponsePolicy::Download,));
                    return;
                }
                if unsafe { response.canShowMIMEType() } {
                    let mime = answer.MIMEType().map(|mime| mime.to_string().to_lowercase()).unwrap_or_default();
                    (self.ivars().hooks.shown)(!matches!(mime.as_str(), "" | "text/html" | "application/xhtml+xml"));
                }
            }
            let _: () = unsafe {
                msg_send![&*self.ivars().inner, webView: webview, decidePolicyForNavigationResponse: response, decisionHandler: handler]
            };
        }

        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start(&self, _webview: &WKWebView, _navigation: Option<&WKNavigation>) {
            (self.ivars().hooks.changed)();
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(&self, _webview: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            self.failed(error);
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _webview: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            self.failed(error);
        }
    }
);

impl NavigationDelegate {
    fn new(mtm: MainThreadMarker, inner: Retained<AnyObject>, hooks: Hooks) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars { inner, hooks });
        unsafe { msg_send![super(this), init] }
    }

    fn failed(&self, error: &NSError) {
        let domain = error.domain().to_string();
        let code = error.code();
        // Not failures: a load another one replaced (-999), one that became
        // a download (102), one a plug-in took over (204).
        let is_ours = (domain == "NSURLErrorDomain" && code == -999) || (domain == "WebKitErrorDomain" && matches!(code, 102 | 204));
        if is_ours {
            (self.ivars().hooks.changed)();
            return;
        }
        let address = error
            .userInfo()
            .objectForKey(ns_string!("NSErrorFailingURLStringKey"))
            .and_then(|value| value.downcast::<NSString>().ok())
            .map(|address| address.to_string());
        (self.ivars().hooks.failed)(address);
    }
}

// Turning a navigation into a download came with macOS 11.3: from 12 on.
fn downloads_exist() -> bool {
    NSProcessInfo::processInfo().operatingSystemVersion().majorVersion >= 12
}

thread_local! {
    // WebKit holds its delegate weakly: kept here, as long as the view (the
    // next view's takes its place).
    static DELEGATE: RefCell<Option<Retained<NavigationDelegate>>> = const { RefCell::new(None) };
}

fn webview_of(platform: &tauri::webview::PlatformWebview) -> &WKWebView {
    // SAFETY: Tauri's WKWebView, alive while the closure it was handed to runs.
    unsafe { &*platform.inner().cast::<WKWebView>() }
}

// Once, when the view is made (on the main thread, before its first page
// asks anything). `hooks` is called there: what it makes stays there.
pub fn install(view: &Webview<Wry>, hooks: impl FnOnce() -> Hooks + Send + 'static) {
    let _ = view.with_webview(move |platform| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let hooks = hooks();
        let webview = webview_of(&platform);
        let Some(inner) = (unsafe { webview.navigationDelegate() }) else { return };
        // SAFETY: the delegate is an Objective-C object; kept as one.
        let inner: Retained<AnyObject> = unsafe { Retained::cast_unchecked(inner) };
        let delegate = NavigationDelegate::new(mtm, inner, hooks);
        let _: () = unsafe { msg_send![webview, setNavigationDelegate: &*delegate] };
        DELEGATE.with(|kept| *kept.borrow_mut() = Some(delegate));

        unsafe {
            // Two fingers go back and forward, a pinch zooms, as in Safari.
            webview.setAllowsBackForwardNavigationGestures(true);
            webview.setAllowsMagnification(true);
        }
        // The view keeps its margins as the window is resized: it follows
        // the window at once, the page's own measure coming after.
        webview.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    });
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
        let webview = webview_of(&platform);
        let _ = reply.send(unsafe {
            Reading {
                loading: webview.isLoading(),
                back: webview.canGoBack(),
                forward: webview.canGoForward(),
                title: webview.title().map(|title| title.to_string()).unwrap_or_default(),
            }
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
        let webview = webview_of(&platform);
        unsafe {
            match to {
                Move::Back => drop(webview.goBack()),
                Move::Forward => drop(webview.goForward()),
                Move::Stop => webview.stopLoading(),
            }
        }
    });
}

// Safari's user agent on this system. The view's own leaves « Safari » out,
// and some of what Moodle embeds (players, editors) then takes it for a
// browser it doesn't know. Since macOS 26 Safari has the system's version
// number; before, the system's plus three (macOS 15: Safari 18).
pub fn safari_user_agent() -> String {
    let system = NSProcessInfo::processInfo().operatingSystemVersion().majorVersion;
    let safari = if system >= 26 { system } else { system + 3 };
    format!("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari}.0 Safari/605.1.15")
}
