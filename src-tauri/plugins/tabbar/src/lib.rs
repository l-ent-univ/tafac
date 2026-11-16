// The system's tab bar (UITabBar) at the bottom of the iOS app, in place of
// the page's own: ios/Sources/TabBarPlugin.swift.
//
// The page stays in charge. It says which tabs there are, which one is
// selected and whether the bar may show (not under a sheet of the page's:
// the bar is native, above everything the page draws); the app passes that
// on with `update`. A tab pressed reaches the page as a `tafac:tab` event on
// window, its detail { id }, and the page does what its own bar did.
//
// No command for the page to call: the app's route takes what the page
// says (src-tauri/src/ios_chrome.rs).

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_tabbar);

pub struct TabBar<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> TabBar<R> {
    // { items: [{ id, label, image?, selectedImage?, symbol, selectedSymbol?,
    //   link?, badge? }], selected?: id, visible: bool, tint?: "#rrggbb" }
    pub fn update(&self, state: serde_json::Value) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("update", state).map(|_| ()).map_err(|error| error.to_string())
    }
}

impl<R: Runtime> TabBar<R> {
    // Development: the tab `id` pressed, as a finger would.
    pub fn press(&self, id: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("press", serde_json::json!({ "id": id }))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("tabbar")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(TabBar(api.register_ios_plugin(init_plugin_tabbar)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
