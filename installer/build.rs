use std::{env, fs, path::PathBuf};

// The NSIS setup goes inside the exe: TAFAC_SETUP names it. Without it (a
// build on the Mac, to work on the window), an empty payload: installing
// then fails with a message.
fn main() {
    println!("cargo:rerun-if-env-changed=TAFAC_SETUP");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("payload.exe");
    match env::var("TAFAC_SETUP") {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");
            fs::copy(&path, &out).unwrap_or_else(|e| panic!("TAFAC_SETUP {path}: {e}"));
        }
        Err(_) => fs::write(&out, []).unwrap(),
    }
    tauri_build::build()
}
