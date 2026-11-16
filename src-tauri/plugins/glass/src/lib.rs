// The system's glass (UIGlassEffect, iOS 26) for the controls of the page's
// own chrome (the pills and round buttons of a header, of a bar), in the
// iOS app: ios/Sources/GlassPlugin.swift.
//
// A page's element can't be of the system's glass: only a native view can.
// So the page says where its controls are and how each moves with the
// scroll, with a picture of what each shows (src/iosGlass.js); the plugin
// lays a glass view for each in the web view, over the page's own element,
// whose drawing the page turns off. The glass has no action: a finger on
// it is a finger on the page under it.
//
// No command for the page to call: the app's route takes what the page
// says (src-tauri/src/ios_chrome.rs).

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_glass);

pub struct Glass<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Glass<R> {
    // { controls: [{ id, anchor: "page" | "fixed" | "sticky", x, y, width,
    //   height, radius, stick?, limit?, tint?, image?, spins?, busy?, move?,
    //   fade? }], images?: { key: PNG in base64 }, dark?, veil?, fade?: [id],
    //   after?: "#rrggbb" }: each field is said in GlassPlugin.swift.
    // All the controls there are: one left out is taken away. Answers once
    // they show (the page's frame `after` marks has come, a quarter of a
    // second at most): whether the system has the glass (not before
    // iOS 26, nor on a tablet: the page keeps its own drawing).
    pub fn update(&self, state: serde_json::Value) -> Result<bool, String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("update", state)
            .map(|answer| answer.get("shown").and_then(|shown| shown.as_bool()) == Some(true))
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("glass")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(Glass(api.register_ios_plugin(init_plugin_glass)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
