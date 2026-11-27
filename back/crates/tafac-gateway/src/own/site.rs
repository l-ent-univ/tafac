// The page and its built files in the apps, which carry the build (dist/)
// among their resources: answered as tafac.fr's server answers them
// (statics.rs, then page.rs), what neither takes with Express's 404, as the
// Node the apps ran before did (server.js, started with the build beside
// it). The app's bridge asks this for every address outside the page's API
// (src-tauri/src/bridge.rs).
//
// As that Node, the apps have no landing pages (dist/.prerender, written
// for search engines, was never in them): signed out, / is the bare page,
// and a reload doesn't flash the landing. No Apple file either
// (APPLE_APP_IDS is tafac.fr's).
//
// The whole answer at once: the app hands it to the web view in one piece,
// and keeps the files under /assets/ in memory (src-tauri/src/assets.rs).

use std::path::PathBuf;

use http::{HeaderMap, Method, Response, Uri};
use http_body_util::BodyExt;

use super::page::Page;
use super::statics::Statics;
use super::universities::Served;
use crate::routes;

pub struct Site {
    statics: Statics,
    // None: the build has no index.html.
    page: Option<Page>,
}

impl Site {
    // `dist`: the build the app carries. `served`: the universities whose
    // text the page is filled with (the apps': every one, Tafac's own text).
    pub fn new(dist: PathBuf, served: Served) -> Self {
        let page = Page::read(&dist, served, false);
        if page.is_none() {
            eprintln!("[tafac] no index.html in {}: the app has no page to show", dist.display());
        }
        Self { statics: Statics::new(dist, ""), page }
    }

    // The answer to a request for an address outside the page's API.
    pub async fn answer(&self, method: &Method, uri: &Uri, headers: &HeaderMap) -> Response<Vec<u8>> {
        if let Some(response) = self.statics.answer(method, uri, headers).await {
            let (parts, body) = response.into_parts();
            if let Ok(body) = body.collect().await {
                return Response::from_parts(parts, body.to_bytes().to_vec());
            }
        }
        if let Some(response) = self.page.as_ref() {
            if let Some(response) = response.answer(method, uri, headers).await {
                return response;
            }
        }
        if routes::is_api(uri.path()) {
            return crate::gateway::not_found();
        }
        super::express::not_found(method, uri.path())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::block_on;

    struct Build(PathBuf);

    impl Drop for Build {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // A build as Vite writes it, with the landing for search engines.
    fn build() -> Build {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dist = std::env::temp_dir().join(format!("tafac-site-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::create_dir_all(dist.join(".prerender")).unwrap();
        std::fs::write(dist.join("index.html"), "<!doctype html><html><head><title>%LENT_APP_NAME%</title><link rel=\"canonical\" href=\"__PUBLIC_ORIGIN__/\"></head><body><div id=\"root\"></div></body></html>").unwrap();
        std::fs::write(dist.join("assets").join("index-abc123.js"), "console.log(1)").unwrap();
        std::fs::write(dist.join(".prerender").join("landing.json"), r#"{"home":{"html":"<main>THE LANDING</main>"}}"#).unwrap();
        Build(dist)
    }

    fn get(site: &Site, method: Method, path: &str) -> Response<Vec<u8>> {
        let mut headers = HeaderMap::new();
        // As the app's bridge asks: its own scheme, under the name localhost.
        headers.insert("host", "localhost".parse().unwrap());
        block_on(site.answer(&method, &path.parse().unwrap(), &headers))
    }

    fn every_university() -> Served {
        Served::from_environment(|_| None, false).unwrap()
    }

    #[test]
    fn the_page_and_its_files_come_from_the_build_the_app_carries() {
        let build = build();
        let site = Site::new(build.0.clone(), every_university());

        let file = get(&site, Method::GET, "/assets/index-abc123.js");
        assert_eq!(file.status(), 200);
        assert_eq!(file.headers()["content-type"], "text/javascript; charset=utf-8");
        assert_eq!(file.headers()["cache-control"], "public, max-age=31536000, immutable");
        assert_eq!(file.body(), b"console.log(1)");
        let part = {
            let mut headers = HeaderMap::new();
            headers.insert("host", "localhost".parse().unwrap());
            headers.insert("range", "bytes=0-6".parse().unwrap());
            block_on(site.answer(&Method::GET, &"/assets/index-abc123.js".parse().unwrap(), &headers))
        };
        assert_eq!((part.status().as_u16(), part.body().as_slice()), (206, &b"console"[..]));

        // The page, at the app's addresses and any other, filled as Node
        // filled it for the app: Tafac's own text, the app's own address.
        for path in ["/login", "/", "/notes"] {
            let page = get(&site, Method::GET, path);
            let html = String::from_utf8(page.body().clone()).unwrap();
            assert!(html.contains("<title>Tafac</title>"), "{path}: {html}");
            assert!(html.contains("href=\"http://localhost/\""), "{path}: {html}");
            // No landing: the app shows the bare page, signed in or not.
            assert!(!html.contains("THE LANDING"), "{path}");
            assert_eq!(page.headers()["content-type"], "text/html; charset=utf-8", "{path}");
            assert!(page.headers().contains_key("content-security-policy"), "{path}");
        }
        assert_eq!(get(&site, Method::GET, "/login").status(), 200);
    }

    #[test]
    fn what_neither_takes_is_expresss_404() {
        let build = build();
        let site = Site::new(build.0.clone(), every_university());
        let posted = get(&site, Method::POST, "/");
        assert_eq!(posted.status(), 404);
        assert!(String::from_utf8_lossy(posted.body()).contains("Cannot POST /"));
        // A path of the page's API that came this far: its JSON 404.
        assert_eq!(get(&site, Method::DELETE, "/__ent_auth/nothing").body(), br#"{"error":"Not found."}"#);
    }

    #[test]
    fn without_a_build_every_address_is_a_404() {
        let site = Site::new(std::env::temp_dir().join("tafac-site-no-build"), every_university());
        assert_eq!(get(&site, Method::GET, "/login").status(), 404);
    }
}
