// The local server on iOS: Node inside the app.
//
// An iOS app can't start another program, so there is no Node process
// beside it as on the desktop (sidecar.rs). Node runs in the app's own
// process instead, on a thread of its own: nodejs-mobile's NodeMobile
// framework (Node 18, without a JIT, which iOS forbids, and without ICU),
// linked by the Xcode project (gen/apple/project.yml) and fetched by
// scripts/ios-prepare.mjs. It runs desktop/ios.mjs, which loads server.js as
// on tafac.fr, from the copy of the server in the app's resources: the same
// script makes it, rewritten for Node 18, with what that Node lacks put back
// (desktop/iosRuntime.mjs).
//
// Same server, same bridge (bridge.rs), same Unix socket: nothing listens
// on the network, and no other app can reach a file of this one's.

use std::ffi::{c_char, c_int, CString};
use std::path::Path;

use tauri::AppHandle;

extern "C" {
    // NodeMobile.framework: Node's own main(), which returns when Node exits.
    fn node_start(argc: c_int, argv: *mut *mut c_char) -> c_int;
}

// The socket's name, in the folder the app works from (below).
const SOCKET: &str = "s.sock";

// Where the server listens. A Unix socket's path fits in ~104 bytes, and an
// app's data folder on iOS is longer than that on its own
// (/var/mobile/Containers/Data/Application/<uuid>/Library/…). So the app
// works from its data folder and names the socket from there: Node is in
// the same process, so it means the same folder.
pub fn endpoint(data_dir: &Path) -> std::io::Result<String> {
    std::env::set_current_dir(data_dir)?;
    // The last run's: Node couldn't listen on a name already taken.
    let _ = std::fs::remove_file(SOCKET);
    Ok(SOCKET.to_string())
}

// The remote settings (remote_settings.rs): which app this is, where their
// file is and whose signature it takes, for the server to read.
pub fn remote_settings(app: &AppHandle, data_dir: &Path) {
    for (name, value) in crate::remote_settings::environment(app, "ios", data_dir) {
        std::env::set_var(name, value);
    }
}

// Starts the server: `script` (desktop/ios.mjs) with the same environment
// as the desktop's (sidecar.rs). Node reads the process's environment, which
// is the app's: nothing else runs in it.
pub fn start(script: &Path, endpoint: &str, secret: &str, data_dir: &Path) -> std::io::Result<()> {
    std::env::set_var("PORT", endpoint);
    std::env::set_var("SESSION_SECRET", secret);
    std::env::set_var("DATA_DIR", data_dir.join("server"));
    std::env::set_var("NODE_ENV", "production");
    std::env::set_var("MULTI_UNIVERSITY", "1");
    // The phone's time zone: this Node has no ICU to name it, and what gives
    // it dates back (desktop/iosRuntime.mjs) is told here.
    if let Ok(time_zone) = iana_time_zone::get_timezone() {
        std::env::set_var("TAFAC_TIME_ZONE", time_zone);
    }
    // Anonymous statistics: only in the builds CI makes, as on the desktop.
    if let Some(key) = option_env!("TAFAC_POSTHOG_PROJECT_KEY").filter(|key| !key.is_empty()) {
        std::env::set_var("POSTHOG_PROJECT_KEY", key);
    }

    let arguments = [
        CString::new("node").map_err(std::io::Error::other)?,
        CString::new(script.to_string_lossy().as_bytes()).map_err(std::io::Error::other)?,
    ];
    std::thread::Builder::new()
        .name("node".to_string())
        // Node's main thread: the size a program's first thread has.
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            // libuv wants the arguments one after the other in one block of
            // memory, as a program's are.
            let mut block: Vec<u8> = arguments.iter().flat_map(|argument| argument.as_bytes_with_nul().iter().copied()).collect();
            let mut argv: Vec<*mut c_char> = Vec::with_capacity(arguments.len() + 1);
            let mut offset = 0;
            for argument in &arguments {
                argv.push(block[offset..].as_mut_ptr().cast());
                offset += argument.as_bytes_with_nul().len();
            }
            argv.push(std::ptr::null_mut());
            let code = unsafe { node_start(arguments.len() as c_int, argv.as_mut_ptr()) };
            // The bridge then answers 502 to the page (bridge.rs).
            eprintln!("[tafac] the local server stopped ({code})");
        })?;
    Ok(())
}
