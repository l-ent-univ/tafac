// The system's share sheet (UIActivityViewController) for a file the iOS
// app downloaded (src-tauri/src/ios_downloads.rs):
// ios/Sources/SharePlugin.swift.
//
// The file is alone in a folder of the app's temporary folder; that folder
// goes once the sheet is closed. No command for the page to call: the app
// asks the plugin itself.

use std::path::Path;

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_share);

pub struct Share<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Share<R> {
    // Answers once the sheet is asked for, not once it closes. Not from the
    // main thread: the answer is awaited, and the sheet is put up there.
    pub fn file(&self, path: &Path) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("share", serde_json::json!({ "path": path.to_string_lossy() }))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(Share(api.register_ios_plugin(init_plugin_share)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
