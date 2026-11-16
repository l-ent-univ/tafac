// The apps' remote settings (server/remoteSettings/,
// docs/REMOTE_SETTINGS.md): patches over the universities' settings, from a
// small signed file on tafac.fr. The server on the device reads and checks
// it; the app only tells it, through its environment, which app this is,
// where the file is and whose signature it takes: the updates' public key
// (tauri.conf.json), which is in the app, not on the device.
//
// The same for both apps: the desktop's server is a process of its own
// (sidecar.rs), the phone's runs inside the app (node.rs).
//
// As the updates (updater.rs): a packaged build made here (0.0.0) asks for
// nothing, a patch for a release being none of its business; and a debug
// build only when TAFAC_SETTINGS_URL names a file (http on this computer
// allowed), with the key TAFAC_SETTINGS_PUBKEY names if any (one made for a
// test).

use std::path::Path;

use tauri::AppHandle;

const URL: &str = "https://tafac.fr/app/settings.json";
// What tauri.conf.json says: a build that isn't a release's.
const LOCAL_VERSION: &str = "0.0.0";

pub struct Build<'a> {
    // ios, desktop
    pub app: &'a str,
    pub version: &'a str,
    // The updates' public key.
    pub key: Option<&'a str>,
    pub debug: bool,
    // Development (TAFAC_SETTINGS_URL, TAFAC_SETTINGS_PUBKEY).
    pub url_override: Option<String>,
    pub key_override: Option<String>,
}

// What the server's environment gets.
pub fn variables(build: Build, data_dir: &Path) -> Vec<(&'static str, String)> {
    let mut variables = vec![("TAFAC_APP", build.app.to_string()), ("TAFAC_APP_VERSION", build.version.to_string())];
    let (url, key) = if build.debug {
        (build.url_override, build.key_override.or(build.key.map(str::to_string)))
    } else if build.version == LOCAL_VERSION {
        (None, None)
    } else {
        (Some(URL.to_string()), build.key.map(str::to_string))
    };
    if let (Some(url), Some(key)) = (url, key) {
        variables.push(("REMOTE_SETTINGS_URL", url));
        variables.push(("REMOTE_SETTINGS_PUBKEY", key));
        variables.push(("REMOTE_SETTINGS_FILE", data_dir.join("remote-settings.json").to_string_lossy().into_owned()));
    }
    variables
}

pub fn environment(app: &AppHandle, name: &str, data_dir: &Path) -> Vec<(&'static str, String)> {
    let version = app.package_info().version.to_string();
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str());
    let build = Build {
        app: name,
        version: &version,
        key,
        debug: cfg!(debug_assertions),
        url_override: std::env::var("TAFAC_SETTINGS_URL").ok(),
        key_override: std::env::var("TAFAC_SETTINGS_PUBKEY").ok(),
    };
    variables(build, data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(version: &'static str, debug: bool) -> Build<'static> {
        Build { app: "desktop", version, key: Some("the updates' key"), debug, url_override: None, key_override: None }
    }

    fn value(variables: &[(&'static str, String)], name: &str) -> Option<String> {
        variables.iter().find(|(variable, _)| *variable == name).map(|(_, value)| value.clone())
    }

    #[test]
    fn a_release_reads_tafac_frs_file_with_the_updates_key() {
        let variables = variables(build("0.27.0", false), Path::new("/data"));
        assert_eq!(value(&variables, "TAFAC_APP").as_deref(), Some("desktop"));
        assert_eq!(value(&variables, "TAFAC_APP_VERSION").as_deref(), Some("0.27.0"));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_URL").as_deref(), Some(URL));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_PUBKEY").as_deref(), Some("the updates' key"));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_FILE").as_deref(), Some("/data/remote-settings.json"));
    }

    #[test]
    fn a_release_takes_no_address_or_key_from_its_environment() {
        let asked = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), key_override: Some("another key".into()), ..build("0.27.0", false) };
        let variables = variables(asked, Path::new("/data"));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_URL").as_deref(), Some(URL));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_PUBKEY").as_deref(), Some("the updates' key"));
    }

    #[test]
    fn a_build_made_here_asks_for_nothing() {
        let variables = variables(build("0.0.0", false), Path::new("/data"));
        assert_eq!(value(&variables, "TAFAC_APP_VERSION").as_deref(), Some("0.0.0"));
        assert_eq!(value(&variables, "REMOTE_SETTINGS_URL"), None);
        assert_eq!(value(&variables, "REMOTE_SETTINGS_PUBKEY"), None);
    }

    #[test]
    fn a_debug_build_asks_only_where_it_is_told() {
        assert_eq!(value(&variables(build("0.0.0", true), Path::new("/data")), "REMOTE_SETTINGS_URL"), None);

        let told = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), ..build("0.0.0", true) };
        let variables_told = variables(told, Path::new("/data"));
        assert_eq!(value(&variables_told, "REMOTE_SETTINGS_URL").as_deref(), Some("http://127.0.0.1:8787/settings.json"));
        assert_eq!(value(&variables_told, "REMOTE_SETTINGS_PUBKEY").as_deref(), Some("the updates' key"));

        let test_key = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), key_override: Some("a test key".into()), ..build("0.0.0", true) };
        assert_eq!(value(&variables(test_key, Path::new("/data")), "REMOTE_SETTINGS_PUBKEY").as_deref(), Some("a test key"));
    }

    #[test]
    fn without_a_key_nothing_is_asked() {
        let keyless = Build { key: None, ..build("0.27.0", false) };
        assert_eq!(value(&variables(keyless, Path::new("/data")), "REMOTE_SETTINGS_URL"), None);
    }
}
