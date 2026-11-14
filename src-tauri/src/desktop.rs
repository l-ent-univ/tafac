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
