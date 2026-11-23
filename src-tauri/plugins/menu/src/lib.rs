// The system's menu (UIMenu) in place of the page's own context menu
// (src/components/ContextMenu.jsx) in the iOS app: ios/Sources/MenuPlugin.swift.
//
// (and of its dropdowns: src/components/Dropdown.jsx).
//
// The page stays in charge. It says where the menu opens and what is in it
// (`show`); what is picked, or nothing, comes back to it as a `tafac:menu`
// event on window, its detail { token, id } (id null: closed without a
// pick). `close` takes back a menu the page no longer wants.
//
// No command for the page to call: the app's route takes what the page
// says (src-tauri/src/ios_chrome.rs).

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_menu);

pub struct Menu<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Menu<R> {
    // { token, x, y, width?, height?, title?, items: [{ id, label, subtitle?, image?, template?,
    //   destructive?, disabled?, checked? } | { separator: true }] }
    // Whether the system could show it (not before iOS 17.4: the page then
    // draws its own).
    pub fn show(&self, menu: serde_json::Value) -> Result<bool, String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("show", menu)
            .map(|answer| answer.get("shown").and_then(|shown| shown.as_bool()) == Some(true))
            .map_err(|error| error.to_string())
    }

    // { token }
    pub fn close(&self, menu: serde_json::Value) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("close", menu).map(|_| ()).map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("menu")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(Menu(api.register_ios_plugin(init_plugin_menu)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
