// Tafac's iOS app: the same page as tafac.fr and the desktop app, in the
// phone's layout, with the server running inside the app (node.rs). The
// login and every request to the university go from the phone straight to
// the university.
//
// One window, below the status bar and over the system's tab bar
// (ios_chrome.rs), on the tafac:// scheme: the bridge (bridge.rs)
// hands each request to the server, holds its cookie (jar.rs) and signs in
// again with the kept login (signin.rs), as on the desktop. « Moodle » is a
// page of the app here too (moodle.rs), its web view the app's own
// (moodle_ios.rs). A file downloaded goes to the share sheet, where the
// desktop has its Save panel (ios_downloads.rs). What else the desktop adds
// around the page isn't here: no menu bar, no updater (the App Store's), no
// saved password sheet.

use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::{bridge, ios_chrome, ios_downloads, jar, links, moodle, node, secret, sidecar, signin};

// The desktop app's own routes (desktop.rs): none of them here, but
// Moodle's view's (moodle.rs).
const DESKTOP_PREFIX: &str = "/__desktop/";
const DESKTOP_HEADER: &str = "x-tafac-desktop";

// The app, for what has no handle to it (links.rs' navigation rule).
static APP: OnceLock<AppHandle> = OnceLock::new();

// A web address opens over the app, in the system's browser sheet (« OK »
// brings the app back); a mail address or a phone number in the app iOS has
// for it.
pub fn open_outside(url: &Url) {
    let Some(app) = APP.get() else { return };
    let sheet = matches!(url.scheme(), "http" | "https").then_some("inAppBrowser");
    #[cfg(debug_assertions)]
    eprintln!("[tafac] opening over the app ({}:)", url.scheme());
    if let Err(error) = app.opener().open_url(url.as_str(), sheet) {
        eprintln!("[tafac] could not open {}: {error}", url.scheme());
    }
}

// window.open and target="_blank" (ios_windows.rs tells of them): a web
// address opens over the app; the launch relay (/__ent_auth/launch) too,
// where its redirect points (the university's service with its CAS ticket);
// any other app page loads in the window, the only one.
pub fn open_new_window(url: Url) {
    #[cfg(debug_assertions)]
    eprintln!("[tafac] new window asked ({}:)", url.scheme());
    let Some(app) = APP.get() else { return };
    if links::is_outside_url(&url) || links::is_app_url(&url) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Moodle's (a deadline, Moodle's tile, a link in a mail): in
            // « Moodle », which the page then shows.
            let in_moodle = match moodle::link_target(&app, &url).await {
                Some(target) => moodle::open_in_page(&app, "main", &target),
                None => false,
            };
            if in_moodle {
                return;
            }
            if links::is_outside_url(&url) {
                open_outside(&url);
                return;
            }
            let target = links::app_link_target(&app, url).await;
            if links::is_outside_url(&target) {
                open_outside(&target);
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.navigate(target);
            }
        });
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_tabbar::init())
        .plugin(tauri_plugin_menu::init())
        .plugin(tauri_plugin_glass::init())
        .plugin(tauri_plugin_refresh::init())
        .plugin(tauri_plugin_moodle::init())
        .plugin(tauri_plugin_share::init())
        .register_asynchronous_uri_scheme_protocol("tafac", |context, request, responder| {
            let app = context.app_handle().clone();
            let window_label = context.webview_label().to_string();
            tauri::async_runtime::spawn(async move {
                // Signing out, or in: Moodle's view goes with the session it
                // was opened for, whatever in the page asked.
                if matches!(request.uri().path(), "/__ent_auth/logout" | "/__ent_auth/login") {
                    moodle::close(&app);
                }
                let response = if request.uri().path().starts_with(ios_chrome::PREFIX) {
                    ios_chrome::handle(&app, &request)
                } else if request.uri().path().starts_with(moodle::ROUTES) {
                    // The desktop's routes for Moodle's view, and its header.
                    if request.method() == http::Method::POST && request.headers().contains_key(DESKTOP_HEADER) {
                        moodle::route(&app, &window_label, &request).await
                    } else {
                        http::Response::builder().status(404).body(Vec::new()).unwrap()
                    }
                } else if request.uri().path().starts_with(DESKTOP_PREFIX) {
                    http::Response::builder().status(404).body(Vec::new()).unwrap()
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

            let endpoint = node::endpoint(&data_dir)?;
            let secret = secret::session_secret(&data_dir)?;
            let script = app.path().resource_dir()?.join("server").join("desktop").join("ios.mjs");
            node::remote_settings(app.handle(), &data_dir);
            node::start(&script, &endpoint, &secret, &data_dir)?;
            let bridge = Arc::new(
                bridge::Bridge::new(endpoint, jar::CookieJar::load(data_dir.join("cookies.json")), signin::SignIn::for_this_build())
                    .with_gateway(&secret),
            );
            app.manage(bridge.clone());
            // The page's first question, asked of the university now, while
            // the server and the page start.
            tauri::async_runtime::spawn(async move { bridge::start_ahead(&bridge).await });
            app.manage(Arc::new(moodle::Moodle::default()));
            let _ = APP.set(app.handle().clone());
            ios_downloads::clear();

            let start_url: Url = sidecar::app_url().parse()?;
            // Development: TAFAC_START_PATH=/rennes opens on that page
            // (SIMCTL_CHILD_TAFAC_START_PATH, for an app `simctl` launches).
            #[cfg(debug_assertions)]
            let start_url = match std::env::var("TAFAC_START_PATH") {
                Ok(path) => start_url.join(&path)?,
                Err(_) => start_url,
            };
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(start_url))
                .on_navigation(links::allow_navigation)
                // A file: to the share sheet (ios_downloads.rs).
                .on_download(ios_downloads::handle)
                // The page loads again: Moodle's view, if it was on screen,
                // leaves it until the new page asks for it.
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        moodle::page_reloaded(window.app_handle(), window.label());
                    }
                })
                .build()?;
            ios_chrome::install(&window);
            let _ = window.with_webview(|webview| unsafe { crate::ios_windows::install(webview.inner().cast()) });

            // Development: TAFAC_PRESS_TAB=moodle,planning presses those
            // tabs one after the other, a few seconds apart (nothing taps a
            // simulator from a script).
            #[cfg(debug_assertions)]
            if let Ok(tabs) = std::env::var("TAFAC_PRESS_TAB") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for tab in tabs.split(',') {
                        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                        if let Err(error) = handle.state::<tauri_plugin_tabbar::TabBar<tauri::Wry>>().press(tab) {
                            eprintln!("[tafac] tab bar: {error}");
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tafac could not start");
}
