// The apps' side of the remote settings (docs/REMOTE_SETTINGS.md): the
// file asked of tafac.fr, checked, kept on the device for the next start,
// and its patches for this app laid over the universities' settings once,
// as the app starts. Node's createRemoteSettings
// (server/remoteSettings/index.ts), which ran in the apps' own Node before,
// moved here as it was:
//
//   the start    the file kept from before is read (and checked again: the
//                copy is the device's); tafac.fr is asked for a newer one,
//                and when the one kept is older than six hours, the start
//                waits for it a second and a half at most
//   then         tafac.fr is asked again every hour; a newer file is kept
//                for the next start, never laid over the settings of this
//                one (they are read once)
//   a patch      for its university, this app and this version (document.rs),
//                refused whole when it names what a patch may not (guard.rs)
//
// It never gets in the way: no answer, a file that doesn't read, a bad
// signature, an older file, and the app goes on with what it has. Without
// an address or a key (a build made on this computer), nothing is asked.
//
// What differs from Node: the patches' `client` (and `features`, which go
// to both sides) are what the app lays over the page's settings, in the
// list of universities (`settings`, own/universities.rs). Their `server`
// was laid over Node's own settings of a university, which nothing reads
// any more: the university is asked through tonAPI, whose settings are in
// the app. It is still checked, so a patch that names an address outside
// the university's domains is refused whole, as before. Those domains are
// the ones the app asks the university at (launch/targets.rs: tonAPI's
// settings and Tafac's own lists), where Node read them from its settings.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use http::header::{HeaderValue, CACHE_CONTROL};
use http::{HeaderMap, Method};
use serde_json::{json, Map, Value};
use tokio::sync::watch;
use tonapi_http::{Browser, BrowserOptions, CookieJar};

use super::document::{parse_settings, resolve_with, SettingsDocument};
use super::minisign::verify_signature;
use crate::gateway::now_ms;
use crate::own::Report;

// A file older than this is asked for again before the app starts.
const STALE_AFTER_MS: i64 = 6 * 60 * 60 * 1000;
// How long the app's start waits for it.
const START_WAIT: Duration = Duration::from_millis(1500);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RECHECK_EVERY: Duration = Duration::from_secs(60 * 60);
// The file is a few lines: anything big isn't it.
const MAX_BYTES: usize = 256 * 1024;

// What the app says of the file, and of itself (src-tauri/src/remote_settings.rs).
pub struct Source {
    // The file's address; its signature's: the same, plus « .sig ».
    pub url: String,
    // The public key it is signed with: the desktop updates' own.
    pub public_key: String,
    // Where the last file taken is kept.
    pub file: PathBuf,
    // ios, desktop: which app this is.
    pub app: String,
    pub version: String,
}

// https, or this device itself (development).
fn is_allowed_address(address: &str) -> bool {
    url::Url::parse(address).is_ok_and(|url| url.scheme() == "https" || (url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))))
}

// What is kept of the last file taken: its text and its signature, and when
// tafac.fr last answered (with a file, or that there is none).
#[derive(Clone, Default)]
struct Kept {
    text: Option<String>,
    signature: Option<String>,
    checked_at: i64,
}

#[derive(Default)]
struct State {
    // The file the universities' settings are read with: the one there as
    // the app starts.
    document: Option<Arc<SettingsDocument>>,
    kept: Kept,
    newest_serial: i64,
    // Once the universities' settings are read, what is applied stays.
    started: bool,
}

// What tafac.fr said of one of the two files.
enum Said {
    Text(String),
    // 404: no such file there.
    None,
}

struct Inner {
    source: Option<Source>,
    state: Mutex<State>,
    // Whether the start is over: the settings can be read.
    ready: watch::Sender<bool>,
    // The page's settings, by university, read once.
    page: OnceLock<Map<String, Value>>,
    report: Report,
}

// Shared by the gateway, which reads the page's settings from it, and the
// task that asks tafac.fr (run).
#[derive(Clone)]
pub struct RemoteSettings(Arc<Inner>);

impl RemoteSettings {
    // `source`: None for a build that reads no remote settings.
    pub fn new(source: Option<Source>) -> Self {
        Self::reporting(source, crate::own::to_log())
    }

    pub(crate) fn reporting(source: Option<Source>, report: Report) -> Self {
        let source = source.filter(|source| !source.public_key.trim().is_empty() && is_allowed_address(source.url.trim()));
        let (ready, _) = watch::channel(source.is_none());
        Self(Arc::new(Inner { source, state: Mutex::default(), ready, page: OnceLock::new(), report }))
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // The start, then a look every hour, for as long as the app runs: the
    // app runs it on a task of its own as it starts. Nothing without a
    // source.
    pub async fn run(&self) {
        if self.0.source.is_none() {
            return;
        }
        self.read_kept();
        let stale = now_ms() - self.state().kept.checked_at >= STALE_AFTER_MS;
        let first = self.refresh();
        tokio::pin!(first);
        let done = stale && tokio::time::timeout(START_WAIT, &mut first).await.is_ok();
        self.state().started = true;
        self.0.ready.send_replace(true);
        if !done {
            first.await;
        }
        loop {
            tokio::time::sleep(RECHECK_EVERY).await;
            self.refresh().await;
        }
    }

    // The serial number of the file the settings are read with.
    pub fn serial(&self) -> Option<i64> {
        self.state().document.as_ref().map(|document| document.serial)
    }

    // What the page lays over each university's settings (`client`, and
    // the `features` switched), for the universities `ids`, once the start
    // is over; none for a university without a patch. `trusted`: a
    // university's own domains. Read once: the next call gives the same.
    pub async fn page_settings(&self, ids: &[&str], trusted: impl Fn(&str) -> Vec<String>) -> Map<String, Value> {
        let mut ready = self.0.ready.subscribe();
        let _ = ready.wait_for(|ready| *ready).await;
        self.0
            .page
            .get_or_init(|| {
                let (document, app, version) = {
                    let mut state = self.state();
                    state.started = true;
                    let source = self.0.source.as_ref();
                    (state.document.clone(), source.map_or("", |source| source.app.as_str()).to_string(), source.map_or("", |source| source.version.as_str()).to_string())
                };
                let report = |message: &str| (self.0.report)(message);
                ids.iter()
                    .filter_map(|id| {
                        let resolved = resolve_with(document.as_deref(), id, &json!({}), &trusted(id), &app, &version, &report);
                        Some((id.to_string(), resolved.client?))
                    })
                    .collect()
            })
            .clone()
    }

    // The file when it is ours (the signature) and reads.
    fn check(&self, text: &str, signature: &str, origin: &str, public_key: &str) -> Option<SettingsDocument> {
        if !verify_signature(text.as_bytes(), signature, public_key) {
            (self.0.report)(&format!("Remote settings ({origin}) not taken: bad signature"));
            return None;
        }
        match parse_settings(text) {
            Ok(document) => Some(document),
            Err(error) => {
                (self.0.report)(&format!("Remote settings ({origin}) not taken: {error}"));
                None
            }
        }
    }

    fn read_kept(&self) {
        let Some(source) = &self.0.source else { return };
        let Some(read) = std::fs::read(&source.file).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) else { return };
        let answered_at = read.get("checkedAt").and_then(Value::as_f64).filter(|at| at.is_finite()).map_or(0, |at| at as i64);
        let (Some(text), Some(signature)) = (read.get("text").and_then(Value::as_str), read.get("signature").and_then(Value::as_str)) else {
            self.state().kept = Kept { checked_at: answered_at, ..Kept::default() };
            return;
        };
        let Some(checked) = self.check(text, signature, "kept", source.public_key.trim()) else { return };
        let mut state = self.state();
        state.newest_serial = checked.serial;
        state.document = Some(Arc::new(checked));
        state.kept = Kept { text: Some(text.to_string()), signature: Some(signature.to_string()), checked_at: answered_at };
    }

    // Written whole, readable by this account only.
    fn keep(&self) {
        let Some(source) = &self.0.source else { return };
        let kept = self.state().kept.clone();
        let mut written = Map::new();
        if let Some(text) = kept.text {
            written.insert("text".to_string(), text.into());
        }
        if let Some(signature) = kept.signature {
            written.insert("signature".to_string(), signature.into());
        }
        written.insert("checkedAt".to_string(), kept.checked_at.into());
        if let Err(error) = write_private(&source.file, Value::Object(written).to_string().as_bytes()) {
            (self.0.report)(&format!("Remote settings not kept: {error}"));
        }
    }

    // One of the two files: its text, None when tafac.fr says there is no
    // such file. Err for anything else (no answer, another status, a
    // redirect, too big).
    async fn ask(address: &str) -> Result<Said, ()> {
        let url = url::Url::parse(address).map_err(|_| ())?;
        let options = BrowserOptions { https_only: url.scheme() == "https", timeout: REQUEST_TIMEOUT, ..BrowserOptions::default() };
        let mut headers = HeaderMap::new();
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        let mut browser = Browser::new(&options, CookieJar::default()).map_err(|_| ())?;
        let (status, _, text) = browser.send(Method::GET, url, headers, None, Some(REQUEST_TIMEOUT)).await.map_err(|_| ())?;
        if status.as_u16() == 404 {
            return Ok(Said::None);
        }
        if !status.is_success() || text.len() > MAX_BYTES {
            return Err(());
        }
        Ok(Said::Text(text))
    }

    // Asks tafac.fr. A newer file than the one kept takes its place: now
    // while the app is still starting, else for the next start.
    async fn refresh(&self) {
        let Some(source) = &self.0.source else { return };
        let address = source.url.trim();
        let signature_address = format!("{address}.sig");
        let (text, signature) = tokio::join!(Self::ask(address), Self::ask(&signature_address));
        let (Ok(text), Ok(signature)) = (text, signature) else { return };
        let (Said::Text(text), Said::Text(signature)) = (text, signature) else {
            // No file there: nothing new to patch. What is kept stays: only
            // a newer file takes patches away (an empty one does).
            self.state().kept.checked_at = now_ms();
            self.keep();
            return;
        };
        let Some(checked) = self.check(&text, &signature, "tafac.fr", source.public_key.trim()) else { return };
        {
            let mut state = self.state();
            if checked.serial < state.newest_serial {
                let newest = state.newest_serial;
                drop(state);
                (self.0.report)(&format!("Remote settings not taken: serial {} is older than {newest}", checked.serial));
                return;
            }
            state.newest_serial = checked.serial;
            if !state.started {
                state.document = Some(Arc::new(checked));
            }
            state.kept = Kept { text: Some(text), signature: Some(signature), checked_at: now_ms() };
        }
        self.keep();
    }
}

fn write_private(file: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(folder) = file.parent().filter(|folder| !folder.as_os_str().is_empty()) {
        std::fs::create_dir_all(folder)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(file)?.write_all(bytes)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    use super::super::tests::{fixture, public_key};
    use super::*;
    use crate::testing::{block_on, read_request, spawn};

    // tafac.fr, as much of it as the app asks: the file and its signature,
    // or 404 for each when there is none. Says how many times it was asked.
    struct Tafac {
        address: String,
        files: Arc<Mutex<Option<(String, String)>>>,
        asked: Arc<AtomicU32>,
    }

    fn tafac(files: Option<(String, String)>) -> Tafac {
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = format!("http://{}/app/settings.json", listener.local_addr().unwrap());
        let files = Arc::new(Mutex::new(files));
        let asked = Arc::new(AtomicU32::new(0));
        let (serving, counting) = (files.clone(), asked.clone());
        spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let (serving, counting) = (serving.clone(), counting.clone());
                spawn(async move {
                    let Some((head, _)) = read_request(&mut stream).await else { return };
                    counting.fetch_add(1, Ordering::SeqCst);
                    let path = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                    let files = serving.lock().unwrap().clone();
                    let body = files.map(|(text, signature)| if path.ends_with(".sig") { signature } else { text });
                    let answer = match body {
                        Some(body) => format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()),
                        None => "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string(),
                    };
                    let _ = stream.write_all(answer.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        Tafac { address, files, asked }
    }

    struct Folder(PathBuf);

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn folder() -> Folder {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!("tafac-remote-settings-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&path).unwrap();
        Folder(path)
    }

    fn settings(url: &str, file: &std::path::Path, app: &str, version: &str) -> (RemoteSettings, Arc<Mutex<Vec<String>>>) {
        let said = Arc::new(Mutex::new(Vec::new()));
        let saying = said.clone();
        let source = Source { url: url.to_string(), public_key: public_key(), file: file.to_path_buf(), app: app.to_string(), version: version.to_string() };
        (RemoteSettings::reporting(Some(source), Arc::new(move |message: &str| saying.lock().unwrap().push(message.to_string()))), said)
    }

    // The start, as the app runs it: on a task of its own.
    fn started(settings: &RemoteSettings) {
        let running = settings.clone();
        spawn(async move { running.run().await });
    }

    // Rennes' own domains, as the app ships them.
    fn rennes(_: &str) -> Vec<String> {
        vec!["univ-rennes.fr".to_string()]
    }

    fn page(settings: &RemoteSettings) -> Value {
        Value::Object(block_on(settings.page_settings(&["univ-rennes", "univ-rennes-2"], rennes)))
    }

    #[test]
    fn a_file_from_tafac_fr_is_laid_over_the_page_settings_and_kept() {
        let tafac = tafac(Some(fixture("TAKEN")));
        let folder = folder();
        let kept = folder.0.join("remote-settings.json");
        let (remote, said) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&remote);
        // Nothing kept: the start waits for tafac.fr. The page gets each
        // university's patches for this app: the planning off and the
        // note at Rennes, the mail off at Rennes 2. The one that names
        // another domain is refused whole.
        assert_eq!(
            page(&remote),
            json!({ "univ-rennes": { "features": { "planning": false }, "note": "moved" }, "univ-rennes-2": { "features": { "mail": false } } })
        );
        assert_eq!(remote.serial(), Some(2));
        let said = said.lock().unwrap().clone();
        assert!(said.iter().any(|line| line.starts_with("Remote settings: patch \"cas-stolen\" refused: an address outside the university's domains (sso.example.org)")), "{said:?}");
        assert!(said.contains(&"Remote settings: univ-rennes: planning-off, cas-moved (serial 2)".to_string()), "{said:?}");
        // Kept for the next start, as Node kept it.
        let written: Value = serde_json::from_slice(&std::fs::read(&kept).unwrap()).unwrap();
        assert_eq!(written["text"], fixture("TAKEN").0.as_str());
        assert_eq!(written["signature"], fixture("TAKEN").1.as_str());
        assert!(written["checkedAt"].as_i64().unwrap() > 0);
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(&kept).unwrap().permissions()) & 0o777, 0o600);
    }

    #[test]
    fn another_app_or_version_takes_only_the_patches_for_it() {
        let tafac = tafac(Some(fixture("TAKEN")));
        let folder = folder();
        let (remote, _) = settings(&tafac.address, &folder.0.join("kept.json"), "desktop", "0.28.0");
        started(&remote);
        assert_eq!(page(&remote), json!({ "univ-rennes": { "features": { "planning": false } }, "univ-rennes-2": { "features": { "mail": false } } }));
    }

    #[test]
    fn the_file_kept_is_read_at_the_start_and_a_newer_one_waits_for_the_next() {
        let folder = folder();
        let kept = folder.0.join("remote-settings.json");
        let (text, signature) = fixture("TAKEN");
        // Kept a moment ago: the start doesn't wait for tafac.fr.
        std::fs::write(&kept, json!({ "text": text, "signature": signature, "checkedAt": now_ms() }).to_string()).unwrap();
        let tafac = tafac(Some(fixture("NEWER")));
        let (remote, _) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&remote);
        let first = page(&remote);
        assert_eq!(first["univ-rennes"]["note"], "moved");
        assert_eq!(remote.serial(), Some(2));
        // tafac.fr's newer file, kept for the next start; this one's
        // settings stay as they were read.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !std::fs::read_to_string(&kept).unwrap_or_default().contains("\\\"serial\\\":3") {
            assert!(std::time::Instant::now() < deadline, "the newer file wasn't kept");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(page(&remote), first);
        assert_eq!(remote.serial(), Some(2));

        // The next start reads it.
        let (next, _) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&next);
        assert_eq!(page(&next), json!({}));
        assert_eq!(next.serial(), Some(3));
    }

    #[test]
    fn an_older_file_a_bad_signature_or_no_answer_changes_nothing() {
        let folder = folder();
        let kept = folder.0.join("remote-settings.json");
        let (text, signature) = fixture("TAKEN");
        std::fs::write(&kept, json!({ "text": text, "signature": signature, "checkedAt": 0 }).to_string()).unwrap();

        // Older than the one kept.
        let tafac = tafac(Some(fixture("OLDER")));
        let (remote, said) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&remote);
        assert_eq!(page(&remote)["univ-rennes"]["note"], "moved");
        assert!(said.lock().unwrap().contains(&"Remote settings not taken: serial 1 is older than 2".to_string()));

        // Signed by someone else: the text of one, the signature of another.
        *tafac.files.lock().unwrap() = Some((fixture("NEWER").0, fixture("OLDER").1));
        let (remote, said) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&remote);
        assert_eq!(page(&remote)["univ-rennes"]["note"], "moved");
        assert_eq!(remote.serial(), Some(2));
        assert!(said.lock().unwrap().contains(&"Remote settings (tafac.fr) not taken: bad signature".to_string()));

        // Nobody there.
        let (remote, _) = settings("http://127.0.0.1:9/app/settings.json", &kept, "ios", "0.27.0");
        started(&remote);
        assert_eq!(page(&remote)["univ-rennes"]["note"], "moved");
        // A copy changed on the device is checked again, and dropped.
        std::fs::write(&kept, json!({ "text": text.replace("moved", "elsewhere"), "signature": signature, "checkedAt": now_ms() }).to_string()).unwrap();
        let (remote, said) = settings("http://127.0.0.1:9/app/settings.json", &kept, "ios", "0.27.0");
        started(&remote);
        assert_eq!(page(&remote), json!({}));
        assert!(said.lock().unwrap().contains(&"Remote settings (kept) not taken: bad signature".to_string()));
    }

    #[test]
    fn no_file_on_tafac_fr_is_noted_and_what_is_kept_stays() {
        let folder = folder();
        let kept = folder.0.join("remote-settings.json");
        let tafac = tafac(None);
        let (remote, _) = settings(&tafac.address, &kept, "ios", "0.27.0");
        started(&remote);
        assert_eq!(page(&remote), json!({}));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::fs::read(&kept).is_err() {
            assert!(std::time::Instant::now() < deadline, "nothing kept");
            std::thread::sleep(Duration::from_millis(20));
        }
        let written: Value = serde_json::from_slice(&std::fs::read(&kept).unwrap()).unwrap();
        assert!(written.get("text").is_none());
        assert!(written["checkedAt"].as_i64().unwrap() > 0);
        assert_eq!(tafac.asked.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn without_a_key_or_a_safe_address_nothing_is_asked() {
        let tafac = tafac(Some(fixture("TAKEN")));
        let folder = folder();
        let file = folder.0.join("kept.json");
        let source = |url: &str, key: &str| Source { url: url.to_string(), public_key: key.to_string(), file: file.clone(), app: "ios".into(), version: "0.27.0".into() };
        for remote in [
            RemoteSettings::new(None),
            RemoteSettings::new(Some(source(&tafac.address, " "))),
            RemoteSettings::new(Some(source(&tafac.address.replace("127.0.0.1", "example.org"), &public_key()))),
            RemoteSettings::new(Some(source("ftp://tafac.fr/settings.json", &public_key()))),
        ] {
            // Ready at once, the app's task or not.
            assert_eq!(page(&remote), json!({}));
            block_on(remote.run());
        }
        assert_eq!(tafac.asked.load(Ordering::SeqCst), 0);
        assert!(!file.exists());
    }

    #[test]
    fn the_apps_list_of_universities_carries_them() {
        let tafac = tafac(Some(fixture("TAKEN")));
        let folder = folder();
        let (remote, _) = settings(&tafac.address, &folder.0.join("kept.json"), "desktop", "0.28.0");
        started(&remote);
        let campus = crate::testing::campus();
        let gateway = campus.gateway().with_remote_settings(remote);
        let headers = HeaderMap::new();
        let asked = crate::Asked { method: &Method::GET, path: "/__ent_auth/universities", query: None, headers: &headers, body: &[], peer: None };
        let list = block_on(gateway.answer(&asked, || None, |_| async { None })).unwrap();
        let list: Value = serde_json::from_slice(list.body()).unwrap();
        assert_eq!(list["settings"], json!({ "univ-rennes": { "features": { "planning": false } }, "univ-rennes-2": { "features": { "mail": false } } }));
        assert_eq!(list["universities"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn the_rules_are_as_written() {
        assert_eq!((STALE_AFTER_MS, START_WAIT.as_millis(), REQUEST_TIMEOUT.as_millis(), RECHECK_EVERY.as_millis(), MAX_BYTES), (21_600_000, 1500, 5000, 3_600_000, 262_144));
    }
}
