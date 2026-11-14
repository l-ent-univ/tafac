// Tafac's desktop app: a window on the same app as tafac.fr, with the server
// running on the student's computer (sidecar.rs) instead of on tafac.fr. The
// login and every request to the university go from this computer straight
// to the university.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod jar;
mod links;
mod sidecar;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let app = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("tafac", |context, request, responder| {
            let bridge = context.app_handle().state::<Arc<bridge::Bridge>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(bridge::forward(&bridge, request).await);
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

            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(sidecar::app_url().parse()?))
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
