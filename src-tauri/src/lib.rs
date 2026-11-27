// Tafac's app: a window on the same app as tafac.fr, with its server running
// in the app itself on the student's own device instead of on tafac.fr. The
// login and every request to the university go from the device straight to
// the university.
//
// The server is the gateway (back/crates/tafac-gateway, tafac.fr's own, in
// Rust): it signs in and asks the university through tonAPI, in the app's
// process. No other program runs. Desktop (app.rs) and iOS (ios.rs) share
// the rest: the tafac:// scheme and its bridge to the gateway and the
// page's files (bridge.rs), the cookie jar (jar.rs), the kept login
// (signin.rs), the remote settings (remote_settings.rs), where links go
// (links.rs).

mod assets;
mod bridge;
mod jar;
mod links;
mod secret;
mod signin;

#[cfg(desktop)]
mod app;
#[cfg(desktop)]
mod desktop;
#[cfg(target_os = "macos")]
mod menu;
mod moodle;
#[cfg(target_os = "ios")]
mod moodle_ios;
#[cfg(target_os = "macos")]
mod moodle_native;
#[cfg(windows)]
#[path = "moodle_native_windows.rs"]
mod moodle_native;
mod moodle_style;
mod remote_settings;
#[cfg(desktop)]
mod passwords;
#[cfg(desktop)]
mod updater;
#[cfg(desktop)]
mod window;

#[cfg(target_os = "ios")]
mod ios;
#[cfg(target_os = "ios")]
mod ios_chrome;
#[cfg(target_os = "ios")]
mod ios_downloads;
#[cfg(target_os = "ios")]
mod ios_windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    app::run();
    #[cfg(target_os = "ios")]
    ios::run();
}
