// What makes a window look like a Mac app rather than a web page in a frame.
//
// macOS: no title bar, and the system's sidebar material behind the page.
// The window is see-through (macOSPrivateApi in tauri.conf.json) over an
// NSVisualEffectView in the sidebar material, the one Finder's and Notes'
// sidebars are made of: the desktop behind, blurred, greyed when the window
// isn't the active one. The page leaves it showing where its sidebar is
// and paints everything else (src/overrides.css, on <html
// data-desktop-macos>). The material is light or dark as the window is, and
// the page sets the window's to its own theme (src/desktopWindowTheme.js).
//
// The page runs up to the window's top edge and the window's buttons (close,
// minimise, zoom) sit in the sidebar's top corner. Dragging the window goes
// through Tauri's drag regions and src/desktopWindowDrag.js, allowed by
// capabilities/default.json. The window is no narrower than the sidebar's
// layout (the 4xl breakpoint, 1024px): the phone's layout has no sidebar.
//
// Windows 11: Mica, the material of the system's own apps (Settings,
// Explorer), behind the title bar and the sidebar. The title bar is drawn
// over the page, 48px high as in Fluent apps (tauri-plugin-decorum: the
// system's one removed, a band that moves the window, the three buttons in
// Segoe Fluent Icons; src/overrides.css sets its height and look). Hovering
// maximise opens Snap Layouts (decorum presses Win+Z for it). The page is told
// before it runs (window.__TAFAC_MICA__, read by src/desktopApp.js: <html
// data-desktop-windows>) and leaves the material showing where its sidebar
// is, the rest on a solid layer with a rounded corner, as in Settings.
// Windows 10 has no Mica: the window stays as elsewhere.
//
// Elsewhere, every window opens hidden, painted in the app's background
// colour (light or dark, as the system is), then shown: no white flash
// before the page.

use tauri::{AppHandle, Manager, Runtime, Webview, WebviewWindow, WebviewWindowBuilder, Window};

#[cfg(target_os = "macos")]
const MIN_SIZE: (f64, f64) = (1024.0, 640.0);
#[cfg(not(target_os = "macos"))]
const MIN_SIZE: (f64, f64) = (380.0, 560.0);

// The first button's top-left corner, from the window's (points): the three
// (60 wide) in the middle of the folded sidebar (96 wide with its 12px
// margin, src/sidebarWidth.js), and in line with the unfolded one's items.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS: (f64, f64) = (18.0, 22.0);

pub fn style<'a, R: Runtime, M: Manager<R>>(builder: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    let builder = builder.min_inner_size(MIN_SIZE.0, MIN_SIZE.1).visible(false);
    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Effect, EffectState};
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHTS.0, TRAFFIC_LIGHTS.1))
            .transparent(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::Sidebar],
                state: Some(EffectState::FollowsWindowActiveState),
                radius: None,
                color: None,
                interactive: false,
            })
    };
    #[cfg(windows)]
    let builder = if has_mica() {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Effect, EffectState};
        builder
            .transparent(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::Mica],
                state: Some(EffectState::FollowsWindowActiveState),
                radius: None,
                color: None,
                interactive: false,
            })
            .initialization_script("window.__TAFAC_MICA__ = true")
    } else {
        builder
    };
    builder
}

// Mica: Windows 11 (build 22000) and later.
#[cfg(windows)]
fn has_mica() -> bool {
    windows_version::OsVersion::current().build >= 22000
}

// After build(): the window on screen (elsewhere than on macOS, painted in
// the app's background colour first).
pub fn show(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(windows)]
    if has_mica() {
        use tauri_plugin_decorum::WebviewWindowExt;
        window.create_overlay_titlebar()?;
        return window.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        // --color-bg in both themes (src/tokens.css, index.html's theme-color).
        let color = match window.theme() {
            Ok(tauri::Theme::Dark) => tauri::window::Color(0x0F, 0x0F, 0x0F, 0xFF),
            _ => tauri::window::Color(0xFC, 0xFB, 0xF8, 0xFF),
        };
        window.set_background_color(Some(color))?;
    }
    window.show()
}

// Windows: no service worker in the app's web view. The page comes from the
// app, which updates it; one left by an earlier version (the website's,
// registered before the page left it out: PwaUpdateManager) keeps serving
// that version's page, and WebView2 never reads the app's /sw.js again to
// replace it. Removed with its caches (Chromium keeps them in the same
// folder) before the first window, so before the web view starts. Cookies
// and storage stay: the student stays signed in.
#[cfg(windows)]
pub fn remove_service_workers<R: Runtime>(app: &AppHandle<R>) {
    let Ok(data) = app.path().app_local_data_dir() else { return };
    let _ = std::fs::remove_dir_all(data.join("EBWebView").join("Default").join("Service Worker"));
}

// One of the app's windows and the page in it (its web view has the window's
// label). Not Tauri's WebviewWindow: with Moodle's view added to a window
// (moodle.rs) it holds two web views, and Tauri no longer gives it as one
// (`get_webview_window` answers None, `webview_windows` leaves it out).
pub struct Page<R: Runtime> {
    pub window: Window<R>,
    pub view: Webview<R>,
}

pub fn page<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<Page<R>> {
    Some(Page { window: app.get_window(label)?, view: app.get_webview(label)? })
}

// Every window of the app with its page.
pub fn pages<R: Runtime>(app: &AppHandle<R>) -> Vec<Page<R>> {
    app.windows().into_keys().filter_map(|label| page(app, &label)).collect()
}

// macOS: spelling checked as you type in the page's fields (the composer,
// the subject…), as in Mail. WebKit reads it from the app's defaults when it
// starts; set only when unset, so turning it off from a field's menu
// (Orthographe et grammaire) sticks.
#[cfg(target_os = "macos")]
pub fn enable_spell_checking() {
    use objc2_foundation::{ns_string, NSUserDefaults};
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = ns_string!("WebContinuousSpellCheckingEnabled");
    if defaults.objectForKey(key).is_none() {
        defaults.setBool_forKey(true, key);
    }
}
