// The apps' remote settings (docs/REMOTE_SETTINGS.md): patches over the
// universities' settings, from a small signed file on tafac.fr. The gateway
// in the app asks for it, checks it, keeps it and lays it over the page's
// settings (tafac_gateway::own::RemoteSettings); the app only says which
// app this is, where the file is and whose signature it takes: the
// updates' public key (tauri.conf.json), which is in the app, not on the
// device. The same for both apps.
//
// As the updates (updater.rs): a packaged build made here (0.0.0) asks for
// nothing, a patch for a release being none of its business; and a debug
// build only when TAFAC_SETTINGS_URL names a file (http on this computer
// allowed), with the key TAFAC_SETTINGS_PUBKEY names if any (one made for a
// test).

use std::path::Path;

use tafac_gateway::own::{RemoteSettings, RemoteSource};
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

// Where the file is and whose signature it takes, for this build; None:
// nothing is asked.
pub fn source(build: Build, data_dir: &Path) -> Option<RemoteSource> {
    let (url, key) = if build.debug {
        (build.url_override, build.key_override.or(build.key.map(str::to_string)))
    } else if build.version == LOCAL_VERSION {
        (None, None)
    } else {
        (Some(URL.to_string()), build.key.map(str::to_string))
    };
    let (url, public_key) = (url?, key?);
    Some(RemoteSource { url, public_key, file: data_dir.join("remote-settings.json"), app: build.app.to_string(), version: build.version.to_string() })
}

// The remote settings of this app (`name`: ios, desktop). The app runs
// them on a task of its own as it starts (RemoteSettings::run): the list of
// universities waits for their start, a second and a half at most.
pub fn for_this_app(app: &AppHandle, name: &str, data_dir: &Path) -> RemoteSettings {
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
    let remote_settings = RemoteSettings::new(source(build, data_dir));
    let running = remote_settings.clone();
    tauri::async_runtime::spawn(async move { running.run().await });
    remote_settings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(version: &'static str, debug: bool) -> Build<'static> {
        Build { app: "desktop", version, key: Some("the updates' key"), debug, url_override: None, key_override: None }
    }

    #[test]
    fn a_release_reads_tafac_frs_file_with_the_updates_key() {
        let source = source(build("0.27.0", false), Path::new("/data")).unwrap();
        assert_eq!(source.app, "desktop");
        assert_eq!(source.version, "0.27.0");
        assert_eq!(source.url, URL);
        assert_eq!(source.public_key, "the updates' key");
        assert_eq!(source.file, Path::new("/data/remote-settings.json"));
    }

    #[test]
    fn a_release_takes_no_address_or_key_from_its_environment() {
        let asked = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), key_override: Some("another key".into()), ..build("0.27.0", false) };
        let source = source(asked, Path::new("/data")).unwrap();
        assert_eq!(source.url, URL);
        assert_eq!(source.public_key, "the updates' key");
    }

    #[test]
    fn a_build_made_here_asks_for_nothing() {
        assert!(source(build("0.0.0", false), Path::new("/data")).is_none());
    }

    #[test]
    fn a_debug_build_asks_only_where_it_is_told() {
        assert!(source(build("0.0.0", true), Path::new("/data")).is_none());

        let told = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), ..build("0.0.0", true) };
        let source_told = source(told, Path::new("/data")).unwrap();
        assert_eq!(source_told.url, "http://127.0.0.1:8787/settings.json");
        assert_eq!(source_told.public_key, "the updates' key");

        let test_key = Build { url_override: Some("http://127.0.0.1:8787/settings.json".into()), key_override: Some("a test key".into()), ..build("0.0.0", true) };
        assert_eq!(source(test_key, Path::new("/data")).unwrap().public_key, "a test key");
    }

    #[test]
    fn without_a_key_nothing_is_asked() {
        let keyless = Build { key: None, ..build("0.27.0", false) };
        assert!(source(keyless, Path::new("/data")).is_none());
    }
}
