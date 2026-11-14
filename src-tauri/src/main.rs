// Tafac's desktop app: a window on the same app as tafac.fr, with the server
// running on the student's computer (sidecar.rs) instead of on tafac.fr. The
// login and every request to the university go from this computer straight
// to the university.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod desktop;
mod jar;
mod links;
#[cfg(target_os = "macos")]
mod menu;
mod passwords;
mod sidecar;
mod window;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let builder = tauri::Builder::default()
        // The main window comes back where and as big as it was. The other
        // pages' windows (links.rs) open at their default size.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .with_filter(|label| label == "main")
                .build(),
        );
    // macOS: the menu bar (menu.rs), and closing the main window doesn't
    // quit: it hides, the app (and its server) keeps running, a click on its
    // Dock icon shows it again (RunEvent::Reopen below). ⌘Q quits.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| menu::build(app))
        .on_menu_event(menu::handle)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    let app = builder
        .register_asynchronous_uri_scheme_protocol("tafac", |context, request, responder| {
            let app = context.app_handle().clone();
            let window_label = context.webview_label().to_string();
            tauri::async_runtime::spawn(async move {
                let response = if request.uri().path().starts_with(desktop::PREFIX) {
                    desktop::handle(&app, &window_label, request).await
                } else {
                    let bridge = app.state::<Arc<bridge::Bridge>>().inner().clone();
                    bridge::forward(&bridge, request).await
                };
                responder.respond(response);
            });
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let endpoint = sidecar::endpoint();
            let secret = sidecar::session_secret(&data_dir)?;
            app.manage(sidecar::spawn(app.handle(), &endpoint, &secret, &data_dir)?);
            app.manage(Arc::new(bridge::Bridge {
                endpoint,
                jar: jar::CookieJar::load(data_dir.join("cookies.json")),
            }));

            #[cfg(target_os = "macos")]
            window::enable_spell_checking();

            let start_url: tauri::Url = sidecar::app_url().parse()?;
            // Development: TAFAC_START_PATH=/rennes opens on that page.
            #[cfg(debug_assertions)]
            let start_url = match std::env::var("TAFAC_START_PATH") {
                Ok(path) => start_url.join(&path)?,
                Err(_) => start_url,
            };

            let handle = app.handle().clone();
            let main_window = window::style(WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(start_url)))
                .title("Tafac")
                .inner_size(1280.0, 820.0)
                .on_navigation(links::allow_navigation)
                .on_new_window(move |url, _features| links::new_window(&handle, url))
                .on_download(links::download)
                .build()?;
            window::show(&main_window)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tafac could not start");

    app.run(|handle, event| match event {
        RunEvent::Exit => {
            if let Some(sidecar) = handle.try_state::<sidecar::Sidecar>() {
                sidecar.stop();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
