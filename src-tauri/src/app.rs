// Tafac's desktop app: a window on the same app as tafac.fr, with its server
// (the gateway, bridge.rs) running in the app on the student's computer
// instead of on tafac.fr. The login and every request to the university go
// from this computer straight to the university.

#[cfg(target_os = "macos")]
use crate::menu;
use crate::{bridge, desktop, jar, links, moodle, remote_settings, secret, signin, updater, window};

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
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
        )
        .plugin(updater::plugin());
    // Windows 11: the window's title bar drawn over the page (window.rs).
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_decorum::init());
    // macOS: the menu bar (menu.rs), and closing the main window doesn't
    // quit: it hides, the app keeps running, a click on its
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
            // Moodle's view (moodle.rs) shows the university's pages, not
            // the app's: nothing there may ask the app's server anything
            // (it would be asked with the student's session).
            if window_label == moodle::LABEL {
                eprintln!("[tafac] a request from Moodle's view to the app was refused");
                responder.respond(http::Response::builder().status(403).body(Vec::new()).unwrap());
                return;
            }
            // Signing out, or in: Moodle's view goes with the session it
            // was opened for, whatever in the page asked.
            if matches!(request.uri().path(), "/__ent_auth/logout" | "/__ent_auth/login") {
                moodle::close(&app);
            }
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
            // The student's alone: the cookie jar, the kept files.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700))?;
            }

            let secret = secret::session_secret(&data_dir)?;
            let remote_settings = remote_settings::for_this_app(app.handle(), "desktop", &data_dir);
            let bridge = Arc::new(bridge::Bridge::new(
                bridge::gateway(&secret, &data_dir, remote_settings),
                bridge::site(&app.path().resource_dir()?),
                jar::CookieJar::load_for(data_dir.join("cookies.json"), &app.package_info().version.to_string()),
                signin::SignIn::for_this_build(),
            ));
            app.manage(bridge.clone());
            // The page's first question, asked of the university now, while
            // the page starts.
            tauri::async_runtime::spawn(async move { bridge::start_ahead(&bridge).await });
            app.manage(Arc::new(moodle::Moodle::default()));

            // Before the window: its page asks for the update's state as it
            // starts.
            updater::start(app.handle())?;

            #[cfg(target_os = "macos")]
            window::enable_spell_checking();
            #[cfg(windows)]
            window::remove_service_workers(app.handle());

            let start_url: tauri::Url = bridge::app_url().parse()?;
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
                .on_new_window(move |url, _features| links::new_window(&handle, "main", url))
                .on_download(links::download)
                .on_page_load(links::page_load)
                .build()?;
            window::show(&main_window)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tafac could not start");

    app.run(|handle, event| match event {
        // A downloaded update takes the app's place now that it has quit.
        RunEvent::Exit => updater::install_on_exit(handle),
        // Moodle's view goes first: the main window is then Tauri's
        // WebviewWindow again, as what saves its state on exit expects.
        RunEvent::ExitRequested { .. } => moodle::close(handle),
        // Not get_webview_window: with Moodle's view in it, Tauri no longer
        // gives the main window as one (window.rs).
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => {
            if let Some(window) = handle.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
