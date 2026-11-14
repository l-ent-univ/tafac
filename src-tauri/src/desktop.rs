// The app's own routes on the tafac:// scheme, answered here instead of by
// the local server: /__desktop/*. Only the app's pages can reach them (the
// scheme exists in its windows only), and each asks for a header no link,
// image or form can send, so a mail's content can't set them off.
//
//   POST /__desktop/password/pick  the system's saved passwords for tafac.fr:
//                                  200 { username, password }, or 204
//   POST /__desktop/password/save  { username, password }: offered to be
//                                  saved for tafac.fr; 204
//   POST /__desktop/menu           what the page has, for the menu bar
//                                  (macOS, menu.rs): 204
//   POST /__desktop/update/state   the app's version and its update, if any
//                                  (updater.rs): 200 { current, phase,
//                                  version, required, downloaded, total,
//                                  failed, download, enabled, checking,
//                                  checked }. Answers once the
//                                  launch check has, a few seconds after
//                                  launch at most
//   POST /__desktop/update/install the update now, then the app again: 204
//   POST /__desktop/update/check   checks now (Réglages › Mises à jour): 200
//                                  { kind, version }, the menu's note
//   POST /__desktop/moodle/show    { launch, x, y, width, height }: Moodle's
//                                  web view over the page's slot (moodle.rs),
//                                  made the first time: 204, or 400
//   POST /__desktop/moodle/bounds  { x, y, width, height }: the slot moved: 204
//   POST /__desktop/moodle/hide    the page left « Moodle » or covers it: 204
//   POST /__desktop/moodle/command { command: back | forward | reload | home |
//                                  browser, home? }: the page's toolbar: 204

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::passwords::{self, Credential};

pub const PREFIX: &str = "/__desktop/";
const REQUIRED_HEADER: &str = "x-tafac-desktop";

#[derive(Serialize, Deserialize)]
struct CredentialBody {
    username: String,
    password: String,
}

pub async fn handle(app: &AppHandle, window_label: &str, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    if request.method() != http::Method::POST || !request.headers().contains_key(REQUIRED_HEADER) {
        return status(404);
    }

    match request.uri().path() {
        "/__desktop/password/pick" => match log_pick(passwords::pick(app, window_label).await) {
            Some(credential) => {
                let body = CredentialBody { username: credential.username, password: credential.password };
                http::Response::builder()
                    .status(200)
                    .header("content-type", "application/json")
                    .header("cache-control", "no-store")
                    .body(serde_json::to_vec(&body).unwrap_or_default())
                    .unwrap()
            }
            None => status(204),
        },
        "/__desktop/password/save" => {
            if let Ok(body) = serde_json::from_slice::<CredentialBody>(request.body()) {
                if !body.username.is_empty() && !body.password.is_empty() {
                    passwords::save(Credential { username: body.username, password: body.password });
                }
            }
            status(204)
        }
        "/__desktop/menu" => {
            #[cfg(target_os = "macos")]
            if let Ok(state) = serde_json::from_slice::<crate::menu::PageState>(request.body()) {
                crate::menu::update(app, state);
            }
            status(204)
        }
        "/__desktop/update/state" => http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .header("cache-control", "no-store")
            .body(serde_json::to_vec(&crate::updater::page_state(app).await).unwrap_or_default())
            .unwrap(),
        "/__desktop/update/check" => http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .header("cache-control", "no-store")
            .body(serde_json::to_vec(&crate::updater::check_from_page(app).await).unwrap_or_default())
            .unwrap(),
        "/__desktop/moodle/show" => match serde_json::from_slice::<crate::moodle::ShowBody>(request.body()) {
            Ok(body) => match crate::moodle::show(app, window_label, body).await {
                Ok(()) => status(204),
                Err(error) => {
                    eprintln!("[tafac] Moodle view: {error}");
                    status(400)
                }
            },
            Err(_) => status(400),
        },
        "/__desktop/moodle/bounds" => {
            if let Ok(bounds) = serde_json::from_slice::<crate::moodle::Bounds>(request.body()) {
                crate::moodle::bounds(app, bounds);
            }
            status(204)
        }
        "/__desktop/moodle/hide" => {
            crate::moodle::hide(app);
            status(204)
        }
        "/__desktop/moodle/command" => {
            if let Ok(body) = serde_json::from_slice::<crate::moodle::CommandBody>(request.body()) {
                crate::moodle::command(app, body);
            }
            status(204)
        }
        "/__desktop/update/install" => {
            crate::updater::install(app);
            status(204)
        }
        _ => status(404),
    }
}

// Development: whether the system's sheet gave anything (never the values).
fn log_pick(picked: Option<Credential>) -> Option<Credential> {
    #[cfg(debug_assertions)]
    eprintln!("[tafac] saved password sheet: {}", if picked.is_some() { "picked" } else { "nothing" });
    picked
}

fn status(code: u16) -> http::Response<Vec<u8>> {
    http::Response::builder().status(code).body(Vec::new()).unwrap()
}
