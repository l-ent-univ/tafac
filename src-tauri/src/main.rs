// The desktop app's executable: the app itself is the library (lib.rs),
// which iOS links too.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tafac_lib::run()
}
