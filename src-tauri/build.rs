fn main() {
    // sidecar.rs reads it with option_env!: a new key rebuilds the app.
    println!("cargo:rerun-if-env-changed=TAFAC_POSTHOG_PROJECT_KEY");
    tauri_build::build()
}
