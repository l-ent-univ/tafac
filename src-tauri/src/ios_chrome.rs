// What iOS draws around the page: the status bar, and the tab bar.
//
// On a phone the web view covers the whole screen, status bar included, and
// never changes size: each page draws its own top behind the bar (a photo,
// its band's colour) and keeps what is read or pressed below it, by the
// bar's height the web view gives it (env(safe-area-inset-top);
// src/overrides.css, « iOS app · status bar »). A web view that stopped
// below the bar would leave a plain strip over every page, and moving its
// edge between two pages shows as a step.
//
// On a tablet, where the page has its sidebar layout, the web view stays
// below the status bar (the safe area's top), as in the installed web app,
// and the view behind it shows through the bar in the page's colour: that
// layout isn't made for the bar yet.
//
// The page says its colour and its theme through the app's own route
// (src/iosApp.js):
//
//   POST /__ios/chrome  { color?: "#rrggbb", theme?: "light" | "dark" | "auto" }: 204
//
// `theme`: « Clair » or « Sombre » sets the window's appearance, so the
// clock reads on the bar; « Automatique » leaves it to the system (set
// there, the page's prefers-color-scheme would stop following it).
//
// The tab bar is the system's (plugins/tabbar), in place of the page's own.
// The page says its tabs, the selected one and whether the bar may show:
//
//   POST /__ios/tabbar  { items: [{ id, label, image?, selectedImage?, symbol,
//                       selectedSymbol?, link?, badge? }], selected?,
//                       visible, tint? }: 204
//
// and a tab pressed comes back to it as a `tafac:tab` event (src/iosTabBar.js).
//
// The page's context menu and its dropdowns are the system's too
// (plugins/menu), where iOS can open one from the app (17.4):
//
//   POST /__ios/menu  { token, x, y, width?, height?, title?, items: [{ id, label,
//                     subtitle?, image?, template?, destructive?, disabled?, checked? }
//                     | { separator: true }] }: 204, or 501 where the
//                     system can't (the page draws its own)
//   POST /__ios/menu  { close: token }: 204
//
// and what is picked comes back as a `tafac:menu` event, { token, id }
// (src/iosMenu.js).
//
// The controls of the page's own chrome (the pills and round buttons of a
// header, of a bar) are of the system's glass (plugins/glass), where there
// is one (iOS 26, a phone):
//
//   POST /__ios/glass  { controls: [{ id, anchor: "page" | "fixed" |
//                      "sticky", x, y, width, height, radius, stick?,
//                      limit?, tint?, image?, spins?, busy?, move?, fade? }],
//                      images?: { key: PNG in base64 }, dark?, veil?,
//                      fade?: [id], after?: "#rrggbb" }: 204, or 501 where
//                      there is none (the page keeps its own drawing)
//
// All the controls there are, each time. The answer comes once they show:
// with the page's frame they were read from (`after`, the mark the page
// put on it). Nothing else comes back: the glass is in the web view, a
// finger on it is a finger on the page (src/iosGlass.js).
//
// Like the desktop's routes (desktop.rs), all ask for a header no link,
// image or form can send.

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

pub const PREFIX: &str = "/__ios/";
const CHROME_PATH: &str = "/__ios/chrome";
const TAB_BAR_PATH: &str = "/__ios/tabbar";
const MENU_PATH: &str = "/__ios/menu";
const GLASS_PATH: &str = "/__ios/glass";
const REFRESH_PATH: &str = "/__ios/refresh";
const REQUIRED_HEADER: &str = "x-tafac-ios";

// --color-bg in both themes (src/tokens.css, index.html's theme-color),
// until the page says its own.
const LIGHT: [u8; 3] = [0xFC, 0xFB, 0xF8];
const DARK: [u8; 3] = [0x0F, 0x0F, 0x0F];

// UIUserInterfaceStyle
const STYLE_UNSPECIFIED: isize = 0;
const STYLE_LIGHT: isize = 1;
const STYLE_DARK: isize = 2;

#[derive(Deserialize)]
struct Body {
    color: Option<String>,
    theme: Option<String>,
}

// "#rrggbb"
fn parse_color(text: &str) -> Option<[u8; 3]> {
    let hex = text.strip_prefix('#').filter(|hex| hex.len() == 6 && hex.is_ascii())?;
    let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

fn parse_theme(text: &str) -> Option<isize> {
    match text {
        "light" => Some(STYLE_LIGHT),
        "dark" => Some(STYLE_DARK),
        "auto" => Some(STYLE_UNSPECIFIED),
        _ => None,
    }
}

fn status(code: u16) -> http::Response<Vec<u8>> {
    http::Response::builder().status(code).body(Vec::new()).unwrap()
}

pub fn handle(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    if request.method() != http::Method::POST || !request.headers().contains_key(REQUIRED_HEADER) {
        return status(404);
    }
    match request.uri().path() {
        CHROME_PATH => chrome(app, request),
        TAB_BAR_PATH => tab_bar(app, request),
        MENU_PATH => menu(app, request),
        GLASS_PATH => glass(app, request),
        REFRESH_PATH => refresh(app, request),
        _ => status(404),
    }
}

// What the page says goes to the plugin as it is: the plugin reads it, and
// refuses what it can't.
fn tab_bar(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(state) = serde_json::from_slice::<serde_json::Value>(request.body()) else { return status(400) };
    match app.state::<tauri_plugin_tabbar::TabBar<tauri::Wry>>().update(state) {
        Ok(()) => status(204),
        Err(error) => {
            eprintln!("[tafac] tab bar: {error}");
            status(400)
        }
    }
}

// Pull to refresh (plugins/refresh): the page says whether what it shows can
// be refreshed and when a refresh has ended, { enabled?, done? }: 204. A
// pull comes back to it as a `tafac:refresh` event (src/iosRefresh.js).
fn refresh(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(state) = serde_json::from_slice::<serde_json::Value>(request.body()) else { return status(400) };
    match app.state::<tauri_plugin_refresh::Refresh<tauri::Wry>>().update(state) {
        Ok(()) => status(204),
        Err(error) => {
            eprintln!("[tafac] refresh: {error}");
            status(400)
        }
    }
}

fn glass(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(state) = serde_json::from_slice::<serde_json::Value>(request.body()) else { return status(400) };
    match app.state::<tauri_plugin_glass::Glass<tauri::Wry>>().update(state) {
        Ok(true) => status(204),
        Ok(false) => status(501),
        Err(error) => {
            eprintln!("[tafac] glass: {error}");
            status(400)
        }
    }
}

fn menu(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(request.body()) else { return status(400) };
    let plugin = app.state::<tauri_plugin_menu::Menu<tauri::Wry>>();
    let done = match body.get("close") {
        Some(token) => plugin.close(serde_json::json!({ "token": token })).map(|()| true),
        None => plugin.show(body),
    };
    match done {
        Ok(true) => status(204),
        Ok(false) => status(501),
        Err(error) => {
            eprintln!("[tafac] menu: {error}");
            status(400)
        }
    }
}

fn chrome(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(body) = serde_json::from_slice::<Body>(request.body()) else { return status(400) };
    let color = body.color.as_deref().and_then(parse_color);
    let style = body.theme.as_deref().and_then(parse_theme);
    if let Some(window) = app.get_webview_window("main") {
        // On the main thread, where UIKit is touched.
        let _ = window.with_webview(move |webview| unsafe {
            let view: *mut AnyObject = webview.inner().cast();
            if let Some(color) = color {
                paint_behind(view, color);
            }
            if let Some(style) = style {
                let window: *mut AnyObject = msg_send![view, window];
                if !window.is_null() {
                    let _: () = msg_send![window, setOverrideUserInterfaceStyle: style];
                }
            }
        });
    }
    status(204)
}

// Once the window is built: the web view in its place, the view behind it
// in the app's background colour.
pub fn install(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let view: *mut AnyObject = webview.inner().cast();
        pin(view);
        allow_windows_without_a_press(view);
        bounce(view);
        let traits: *mut AnyObject = msg_send![view, traitCollection];
        let style: isize = if traits.is_null() { STYLE_UNSPECIFIED } else { msg_send![traits, userInterfaceStyle] };
        paint_behind(view, if style == STYLE_DARK { DARK } else { LIGHT });
    });
}

// UIUserInterfaceIdiomPad
const IDIOM_TABLET: isize = 1;

// The web view (a WKWebView) on the edges of the view that holds it; on a
// tablet its top on the safe area's (below the status bar: it follows a
// rotation).
unsafe fn pin(view: *mut AnyObject) {
    let holder: *mut AnyObject = msg_send![view, superview];
    if holder.is_null() {
        return;
    }
    let _: () = msg_send![view, setTranslatesAutoresizingMaskIntoConstraints: false];
    let device: *mut AnyObject = msg_send![class!(UIDevice), currentDevice];
    let idiom: isize = msg_send![device, userInterfaceIdiom];
    let top: *mut AnyObject = if idiom == IDIOM_TABLET {
        let safe_area: *mut AnyObject = msg_send![holder, safeAreaLayoutGuide];
        msg_send![safe_area, topAnchor]
    } else {
        msg_send![holder, topAnchor]
    };

    let pin = |anchor: *mut AnyObject, to: *mut AnyObject| {
        let constraint: *mut AnyObject = msg_send![anchor, constraintEqualToAnchor: to];
        let _: () = msg_send![constraint, setActive: true];
    };
    pin(msg_send![view, topAnchor], top);
    pin(msg_send![view, bottomAnchor], msg_send![holder, bottomAnchor]);
    pin(msg_send![view, leadingAnchor], msg_send![holder, leadingAnchor]);
    pin(msg_send![view, trailingAnchor], msg_send![holder, trailingAnchor]);
}

// The page gives a little past its ends and comes back, as everything that
// scrolls on iOS does (and as the installed web app). Tauri turns it off.
unsafe fn bounce(view: *mut AnyObject) {
    let scroller: *mut AnyObject = msg_send![view, scrollView];
    if !scroller.is_null() {
        let _: () = msg_send![scroller, setBounces: true];
    }
}

// window.open without a press in the page: a tab of the system's bar is
// pressed outside the web view, so the link it opens (Moodle) comes from the
// page with no press of its own, and WebKit would drop it. What opens still
// goes through the app's rule for new windows (ios.rs).
unsafe fn allow_windows_without_a_press(view: *mut AnyObject) {
    let configuration: *mut AnyObject = msg_send![view, configuration];
    let preferences: *mut AnyObject = msg_send![configuration, preferences];
    let _: () = msg_send![preferences, setJavaScriptCanOpenWindowsAutomatically: true];
}

// The colour of what shows around the web view: the status bar's strip.
unsafe fn paint_behind(view: *mut AnyObject, [red, green, blue]: [u8; 3]) {
    let holder: *mut AnyObject = msg_send![view, superview];
    if holder.is_null() {
        return;
    }
    let channel = |value: u8| f64::from(value) / 255.0;
    let color: *mut AnyObject =
        msg_send![class!(UIColor), colorWithRed: channel(red), green: channel(green), blue: channel(blue), alpha: 1.0f64];
    let _: () = msg_send![holder, setBackgroundColor: color];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_is_six_hex_digits() {
        assert_eq!(parse_color("#FCFBF8"), Some([0xFC, 0xFB, 0xF8]));
        assert_eq!(parse_color("#0f0f0f"), Some([0x0F, 0x0F, 0x0F]));
        assert_eq!(parse_color("FCFBF8"), None);
        assert_eq!(parse_color("#fff"), None);
        assert_eq!(parse_color("#gggggg"), None);
        assert_eq!(parse_color("#ééé"), None);
    }

    #[test]
    fn a_theme_is_one_of_the_three() {
        assert_eq!(parse_theme("light"), Some(STYLE_LIGHT));
        assert_eq!(parse_theme("dark"), Some(STYLE_DARK));
        assert_eq!(parse_theme("auto"), Some(STYLE_UNSPECIFIED));
        assert_eq!(parse_theme("sepia"), None);
    }
}
