// Tafac's app: a window on the same app as tafac.fr, with the server running
// on the student's own device instead of on tafac.fr. The login and every
// request to the university go from the device straight to the university.
//
// Desktop (app.rs): the server is a Node process beside the app
// (sidecar.rs). iOS (ios.rs): a phone runs no second program, so Node runs
// inside the app (node.rs). The rest is the same: the tafac:// scheme and
// its bridge to the server (bridge.rs), the cookie jar (jar.rs), the kept
// login (signin.rs), where links go (links.rs).

mod assets;
mod bridge;
mod jar;
mod links;
mod secret;
mod sidecar;
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
#[cfg(target_os = "ios")]
mod node;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    app::run();
    #[cfg(target_os = "ios")]
    ios::run();
}
