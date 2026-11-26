// tafac.fr publishes the desktop app's updates by itself
// (server/desktopUpdate/follow.ts): it reads the manifest of the newest
// GitHub release every ten minutes and, when it changed and checks, puts it
// where it serves it from (DESKTOP_LATEST_FILE, desktop_update.rs). CI
// uploads latest.json to the release only once the signed, notarized build
// is done (.github/workflows/desktop.yml), so a release whose desktop build
// failed, or is still running, has none: what is served stays as it is.
// tafac.fr can't be reached from GitHub (it is on a home network), hence
// tafac.fr asking, not CI pushing.
//
//   DESKTOP_LATEST_FILE  where the manifest is served from; following is on
//                        when it is set
//   DESKTOP_LATEST_FROM  where to read it (default: the newest release's
//                        latest.json on GitHub)
//   DESKTOP_LATEST_PIN   set (to anything): the file stays as it is, by hand
//                        (hold an update back, raise `minimum`)
//
// Withdrawing an update: delete its GitHub release (the previous one is the
// newest again, its manifest comes back), or pin and edit the file.
//
// One look, and what comes of it:
//
//   published  a new manifest is served from now on, written whole beside
//              the file and moved over it
//   unchanged  the release's is the one already served
//   none       no manifest there (404, or any answer but 2xx), or no answer
//              at all (down, 20 seconds): what is served stays
//   refused    one that doesn't check: not served, what is served stays,
//              and the log says why
//
// It is asked with tonAPI's own client (tonapi-http), redirects followed
// (GitHub's points to its file storage). As Node's fetch, but: the client's
// own User-Agent and Accept; an answer over 8 MB is none; and an address
// given in https stays in https, a redirect to http taken in https (Node
// would follow it in clear). One given in http (a test, a mirror on this
// network) is asked in http.
//
// The file written beside is « <file>.<this process>.next », where Node's is
// « <file>.next »: with Node still following too (DESKTOP_LATEST_FILE set
// for both), neither writes over the other's half-written file.

use std::path::Path;
use std::time::Duration;

use tonapi_http::{Browser, BrowserOptions, CookieJar};

use crate::own::Report;

use super::manifest::parse_desktop_manifest;

pub(crate) const DEFAULT_RELEASE_MANIFEST: &str = "https://github.com/l-ent-univ/tafac/releases/latest/download/latest.json";
pub(crate) const EVERY: Duration = Duration::from_secs(10 * 60);
pub(crate) const FIRST_AFTER: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FollowOutcome {
    Published,
    Unchanged,
    None,
    Refused,
}

// The release's manifest, when the answer is one (2xx), read as fetch's
// text() reads it: UTF-8, a byte order mark at its start dropped.
async fn ask(from: &str) -> Option<String> {
    let address = url::Url::parse(from).ok()?;
    let options = BrowserOptions { https_only: address.scheme() == "https", timeout: TIMEOUT, ..BrowserOptions::default() };
    let page = Browser::new(&options, CookieJar::default()).ok()?.get(address).await.ok()?;
    page.status.is_success().then(|| page.body.strip_prefix('\u{feff}').map_or_else(|| page.body.clone(), str::to_string))
}

fn read_served(file: &Path) -> Option<String> {
    std::fs::read(file).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

// One look at the release's manifest. An error: the file couldn't be
// written, tried again next time.
pub(crate) async fn follow_once(from: &str, file: &Path, report: &Report) -> std::io::Result<FollowOutcome> {
    let Some(text) = ask(from).await else { return Ok(FollowOutcome::None) };
    let manifest = match parse_desktop_manifest(&text) {
        Ok(manifest) => manifest,
        Err(error) => {
            report(&format!("Desktop update manifest from {from} not published: {error}"));
            return Ok(FollowOutcome::Refused);
        }
    };
    if read_served(file).as_deref() == Some(text.as_str()) {
        return Ok(FollowOutcome::Unchanged);
    }

    // Whole or not at all: written beside it, then moved over it.
    if let Some(folder) = file.parent().filter(|folder| !folder.as_os_str().is_empty()) {
        std::fs::create_dir_all(folder)?;
    }
    let mut next = file.as_os_str().to_os_string();
    next.push(format!(".{}.next", std::process::id()));
    std::fs::write(&next, &text)?;
    std::fs::rename(&next, file)?;
    report(&format!("Desktop update manifest: {} published", manifest.version));
    Ok(FollowOutcome::Published)
}

// The releases followed while the server runs, on a task of its own.
pub struct Following(Option<tokio::task::JoinHandle<()>>);

impl Following {
    // No look after this one.
    pub fn stop(self) {
        if let Some(task) = self.0 {
            task.abort();
        }
    }

    pub fn is_following(&self) -> bool {
        self.0.is_some()
    }
}

// Follows the releases (main.rs, Node's settings): nothing without
// DESKTOP_LATEST_FILE, or with DESKTOP_LATEST_PIN. On the runtime it is
// called from.
pub fn follow_releases(file: &str, from: &str, pinned: bool) -> Following {
    following(file, from, pinned, FIRST_AFTER, EVERY, crate::own::to_log())
}

pub(crate) fn following(file: &str, from: &str, pinned: bool, first_after: Duration, every: Duration, report: Report) -> Following {
    if file.is_empty() || pinned {
        if !file.is_empty() {
            report("Desktop update manifest pinned (DESKTOP_LATEST_PIN): not following the releases");
        }
        return Following(None);
    }
    let from = if from.is_empty() { DEFAULT_RELEASE_MANIFEST.to_string() } else { from.to_string() };
    let file = std::path::PathBuf::from(file);
    Following(Some(tokio::spawn(async move {
        tokio::time::sleep(first_after).await;
        loop {
            if let Err(error) = follow_once(&from, &file, &report).await {
                report(&format!("Desktop update manifest not published: {error}"));
            }
            tokio::time::sleep(every).await;
        }
    })))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    use super::*;
    use crate::testing::{block_on, read_request, spawn};

    fn manifest(version: &str, extra: serde_json::Value) -> String {
        let mut manifest = serde_json::json!({
            "version": version,
            "pub_date": "2026-11-20T09:00:00Z",
            "platforms": { "darwin-aarch64": { "url": format!("https://example.org/Tafac_{version}_aarch64.app.tar.gz"), "signature": "c2ln" } },
        });
        for (key, value) in extra.as_object().unwrap() {
            manifest[key] = value.clone();
        }
        manifest.to_string()
    }

    // A made-up GitHub on this computer: what it answers now (a status and a
    // body; a status of 302 sends to /stored, which answers the body), and
    // each path it was asked.
    struct GitHub {
        address: String,
        answer: Arc<Mutex<(u16, String)>>,
        asked: Arc<Mutex<Vec<String>>>,
    }

    fn github(status: u16, body: &str) -> GitHub {
        let listener = block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let answer = Arc::new(Mutex::new((status, body.to_string())));
        let asked = Arc::new(Mutex::new(Vec::new()));
        let (answering, recording) = (answer.clone(), asked.clone());
        spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let (answer, asked) = (answering.lock().unwrap().clone(), recording.clone());
                spawn(async move {
                    let Some((head, _)) = read_request(&mut stream).await else { return };
                    let path = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                    asked.lock().unwrap().push(path.clone());
                    let (status, body) = if answer.0 == 302 && path == "/stored" { (200, answer.1) } else { answer };
                    let reply = match status {
                        302 => "HTTP/1.1 302 Found\r\nlocation: /stored\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string(),
                        status => format!("HTTP/1.1 {status} X\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()),
                    };
                    let _ = stream.write_all(reply.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        GitHub { address, answer, asked }
    }

    impl GitHub {
        fn from(&self) -> String {
            format!("{}/l-ent-univ/tafac/releases/latest/download/latest.json", self.address)
        }

        fn answers(&self, status: u16, body: &str) {
            *self.answer.lock().unwrap() = (status, body.to_string());
        }
    }

    struct Folder(PathBuf);

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // A folder of the test's own, and the file under a folder not made yet.
    fn folder() -> (Folder, PathBuf) {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!("tafac-follow-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        std::fs::create_dir_all(&path).unwrap();
        let file = path.join("data").join("desktop-latest.json");
        (Folder(path), file)
    }

    fn reporting() -> (Report, Arc<Mutex<Vec<String>>>) {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let kept = messages.clone();
        (Arc::new(move |message: &str| kept.lock().unwrap().push(message.to_string())), messages)
    }

    fn look(from: &str, file: &Path, report: &Report) -> FollowOutcome {
        block_on(follow_once(from, file, report)).unwrap()
    }

    #[test]
    fn a_new_releases_manifest_is_published_once() {
        let (_folder, file) = folder();
        let (report, messages) = reporting();
        let github = github(200, &manifest("0.26.0", serde_json::json!({})));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Published);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.26.0", serde_json::json!({})));
        assert_eq!(*messages.lock().unwrap(), ["Desktop update manifest: 0.26.0 published"]);
        assert!(std::fs::read_dir(file.parent().unwrap()).unwrap().count() == 1, "nothing left beside it");
        // The same again: nothing written, nothing said.
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Unchanged);
        assert_eq!(messages.lock().unwrap().len(), 1);
        // Through GitHub's redirect to its storage.
        github.answers(302, &manifest("0.27.0", serde_json::json!({})));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Published);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.27.0", serde_json::json!({})));
        assert_eq!(github.asked.lock().unwrap().last().unwrap(), "/stored");
    }

    #[test]
    fn without_a_manifest_on_the_release_or_without_github_what_is_served_stays() {
        let (_folder, file) = folder();
        let (report, _) = reporting();
        let github = github(200, &manifest("0.25.0", serde_json::json!({})));
        look(&github.from(), &file, &report);
        // The newest release's desktop build failed or is still running: 404.
        github.answers(404, "Not Found");
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::None);
        github.answers(500, &manifest("0.26.0", serde_json::json!({})));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::None);
        // Nobody there.
        assert_eq!(look("http://127.0.0.1:1/latest.json", &file, &report), FollowOutcome::None);
        assert_eq!(look("not an address", &file, &report), FollowOutcome::None);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.25.0", serde_json::json!({})));
    }

    #[test]
    fn a_manifest_that_would_break_the_apps_is_never_published() {
        let (_folder, file) = folder();
        let (report, messages) = reporting();
        let github = github(200, &manifest("0.25.0", serde_json::json!({})));
        look(&github.from(), &file, &report);
        github.answers(200, &manifest("0.26.0", serde_json::json!({ "minimum": "0.27.0" })));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Refused);
        github.answers(200, "<html>");
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Refused);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.25.0", serde_json::json!({})));
        assert_eq!(messages.lock().unwrap()[1], format!("Desktop update manifest from {} not published: \"minimum\" is above \"version\"", github.from()));
    }

    #[test]
    fn an_older_releases_manifest_comes_back_when_the_newest_is_deleted() {
        let (_folder, file) = folder();
        let (report, _) = reporting();
        let github = github(200, &manifest("0.26.0", serde_json::json!({})));
        look(&github.from(), &file, &report);
        github.answers(200, &manifest("0.25.0", serde_json::json!({})));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Published);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.25.0", serde_json::json!({})));
    }

    #[test]
    fn a_file_that_cant_be_written_is_an_error_and_what_is_served_stays() {
        let (folder, _) = folder();
        let (report, messages) = reporting();
        let github = github(200, &manifest("0.26.0", serde_json::json!({})));
        // Where the folder should be, a file.
        std::fs::write(folder.0.join("data"), "").unwrap();
        let file = folder.0.join("data").join("desktop-latest.json");
        assert!(block_on(follow_once(&github.from(), &file, &report)).is_err());
        assert!(messages.lock().unwrap().is_empty());
        // And a byte order mark before the manifest is dropped, as fetch drops it.
        let file = folder.0.join("latest.json");
        github.answers(200, &format!("\u{feff}{}", manifest("0.26.0", serde_json::json!({}))));
        assert_eq!(look(&github.from(), &file, &report), FollowOutcome::Published);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), manifest("0.26.0", serde_json::json!({})));
    }

    #[test]
    fn following_needs_desktop_latest_file_and_stops_when_pinned() {
        let github = github(404, "");
        let (report, messages) = reporting();
        block_on(async {
            assert!(!following("", &github.from(), false, Duration::ZERO, Duration::from_millis(5), report.clone()).is_following());
            assert!(!following("", &github.from(), true, Duration::ZERO, Duration::from_millis(5), report.clone()).is_following());
            let pinned = following("/tmp/x.json", &github.from(), true, Duration::ZERO, Duration::from_millis(5), report.clone());
            assert!(!pinned.is_following());
            tokio::time::sleep(Duration::from_millis(20)).await;
            pinned.stop();
        });
        assert!(github.asked.lock().unwrap().is_empty());
        assert_eq!(*messages.lock().unwrap(), ["Desktop update manifest pinned (DESKTOP_LATEST_PIN): not following the releases"]);

        // Set: asked at the address given, again and again, until stopped.
        let (_folder, file) = folder();
        let stop = block_on(async { following(file.to_str().unwrap(), &github.from(), false, Duration::ZERO, Duration::from_millis(5), report.clone()) });
        let waited = std::time::Instant::now();
        while github.asked.lock().unwrap().len() < 2 && waited.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(5));
        }
        stop.stop();
        let asked = github.asked.lock().unwrap().clone();
        assert!(asked.len() >= 2, "{asked:?}");
        assert_eq!(asked[0], "/l-ent-univ/tafac/releases/latest/download/latest.json");
        // Without one, GitHub's newest release (never asked here).
        assert_eq!(DEFAULT_RELEASE_MANIFEST, "https://github.com/l-ent-univ/tafac/releases/latest/download/latest.json");
    }

    #[test]
    fn the_rhythm_and_the_address_are_nodes() {
        let node = include_str!("../../../../../../server/desktopUpdate/follow.ts");
        assert!(node.contains(&format!("export const DEFAULT_RELEASE_MANIFEST = '{DEFAULT_RELEASE_MANIFEST}'")));
        assert!(node.contains(&format!("const EVERY_MS = {} * 60 * 1000", EVERY.as_secs() / 60)));
        assert!(node.contains(&format!("const FIRST_AFTER_MS = {} * 1000", FIRST_AFTER.as_secs())));
        assert!(node.contains(&format!("const TIMEOUT_MS = {} * 1000", TIMEOUT.as_secs())));
        for words in ["Desktop update manifest from ${from} not published: ${manifest.error}", "Desktop update manifest: ${manifest.version} published", "Desktop update manifest pinned (DESKTOP_LATEST_PIN): not following the releases", "Desktop update manifest not published: "] {
            assert!(node.contains(words), "{words}");
        }
    }
}
