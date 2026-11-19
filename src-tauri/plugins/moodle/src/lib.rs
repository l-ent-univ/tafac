// Moodle's web view on iOS: a WKWebView of the app's own, laid over the
// page's « Moodle » (ios/Sources/MoodlePlugin.swift). On the desktop Tauri
// gives a window a second web view; on iOS it has none to give.
//
// The app drives it (src-tauri/src/moodle_ios.rs, for moodle.rs): `run` asks
// the view something by name, as the Swift side lists them.

use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_moodle);

pub struct MoodleView<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MoodleView<R> {
    // Waits for the view's answer: never from the main thread, where the
    // view does its work.
    pub fn run(&self, command: &str, payload: impl Serialize) -> Result<serde_json::Value, String> {
        self.0.run_mobile_plugin::<serde_json::Value>(command, payload).map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("moodle")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(MoodleView(api.register_ios_plugin(init_plugin_moodle)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
