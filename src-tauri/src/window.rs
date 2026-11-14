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
// Elsewhere, every window opens hidden, painted in the app's background
// colour (light or dark, as the system is), then shown: no white flash
// before the page.

use tauri::{Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

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
    builder
}

// After build(): the window on screen (elsewhere than on macOS, painted in
// the app's background colour first).
pub fn show<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
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
