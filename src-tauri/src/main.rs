// Tafac's desktop app: a window on the same app as tafac.fr, with the server
// running on the student's computer (sidecar.rs) instead of on tafac.fr. The
// login and every request to the university go from this computer straight
// to the university.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod desktop;
mod jar;
mod links;
mod passwords;
mod sidecar;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let app = tauri::Builder::default()
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

            let start_url: tauri::Url = sidecar::app_url().parse()?;
            // Development: TAFAC_START_PATH=/rennes opens on that page.
            #[cfg(debug_assertions)]
            let start_url = match std::env::var("TAFAC_START_PATH") {
                Ok(path) => start_url.join(&path)?,
                Err(_) => start_url,
            };

            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(start_url))
                .title("Tafac")
                .inner_size(1280.0, 820.0)
                .min_inner_size(380.0, 560.0)
                .on_navigation(links::allow_navigation)
                .on_new_window(move |url, _features| links::new_window(&handle, url))
                .on_download(links::download)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tafac could not start");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(sidecar) = handle.try_state::<sidecar::Sidecar>() {
                sidecar.stop();
            }
        }
    });
}
