// The system's pull to refresh (UIRefreshControl) on the page, in the iOS
// app: ios/Sources/RefreshPlugin.swift.
//
// The page stays in charge. It says whether there is something to refresh
// (`enabled`: the spinner is there to pull only then) and when a refresh
// has ended (`done`). A pull reaches the page as a `tafac:refresh` event
// on window, and the page reloads what it shows (src/iosRefresh.js).
//
// No command for the page to call: the app's route takes what the page
// says (src-tauri/src/ios_chrome.rs).

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_refresh);

pub struct Refresh<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Refresh<R> {
    // { enabled?: bool, done?: bool }
    pub fn update(&self, state: serde_json::Value) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("update", state).map(|_| ()).map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("refresh")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(Refresh(api.register_ios_plugin(init_plugin_refresh)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
