// Tafac's setup on Windows: a Mica window in front, the NSIS setup that
// Tauri builds behind it, run silently. NSIS keeps installing the files, the
// uninstaller and the updates (the updater runs the same NSIS setup).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, fs, path::PathBuf, process::Command};

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));

// Where the NSIS setup installs for the current user (Tauri's default):
// the folder is the product's name, the exe keeps the crate's name
// (src-tauri/Cargo.toml) unless mainBinaryName says otherwise.
fn app_exe() -> Option<PathBuf> {
    let dir = PathBuf::from(env::var_os("LOCALAPPDATA")?).join("Tafac");
    ["tafac-desktop.exe", "Tafac.exe"]
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.exists())
}

#[tauri::command]
fn installed() -> bool {
    app_exe().is_some()
}

#[tauri::command]
async fn install() -> Result<(), String> {
    if PAYLOAD.is_empty() {
        return Err("Ce build ne contient pas Tafac".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let dir = env::temp_dir().join(format!("tafac-setup-{}", std::process::id()));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let setup = dir.join("Tafac-nsis.exe");
        fs::write(&setup, PAYLOAD).map_err(|e| e.to_string())?;
        let status = Command::new(&setup).arg("/S").status();
        let _ = fs::remove_dir_all(&dir);
        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("L'installation a échoué (code {})", s.code().unwrap_or(-1))),
            Err(e) => Err(format!("L'installation n'a pas pu démarrer : {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_app(app: tauri::AppHandle) -> Result<(), String> {
    let exe = app_exe().ok_or("Tafac est introuvable")?;
    Command::new(exe).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![installed, install, open_app])
        .run(tauri::generate_context!())
        .expect("installer window");
}
