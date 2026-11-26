// The page itself, as the server sends it: the built index.html, filled.
//
// Node's own (server.js: sendAppShell, readShells; server/appShell.js),
// whose words these are. The build keeps placeholders in index.html, since
// one build serves every university; the server fills them as it sends the
// page:
//
//   %LENT_…%            the page's name and its text for search engines and
//                       link previews: Tafac's own where every university
//                       is served, the university's where it is the only
//                       one (universities/directory.json: `page`)
//   __PUBLIC_ORIGIN__   this request's own address, so that link previews,
//                       which don't run the app, get whole addresses. It
//                       comes from the request (X-Forwarded-Host): only one
//                       that reads as an address is written (statics.rs),
//                       else the links stay relative
//
// Where every university is served, each listed one has its own page at
// /<slug> while signed out, with its text and its landing already in it
// (dist/.prerender/landing.json, written at build time), and so has the
// home page: search engines don't run the app. Signed in, every address is
// the bare app.
//
// Which address is what:
//
//   /, /login, /universites, /<slug>   the page, 200
//   /<id>, /<Slug>/, /<idwithoutdashes>  301 to /<slug>, its query kept:
//                                      the address search engines keep
//   any other                          the page too, as a 404: not indexed
//   /index.html                        the bare app, never the landing: what
//                                      the service worker keeps and serves
//                                      on every visit, signed in or not
//
// sitemap.xml lists the home page and each listed university's.

use std::collections::HashMap;

use serde::Deserialize;

use super::universities::Served;

// The text a shell is filled with (scripts/universities-directory.mjs).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageText {
    app_name: Option<String>,
    seo_title: Option<String>,
    seo_description: Option<String>,
    repo_url: String,
    alternate_names: Vec<String>,
}

// fillBrandingPlaceholders: each %LENT_NAME% the text has a word for; any
// other stays as it is.
pub(crate) fn fill_text(html: &str, text: &PageText) -> String {
    let alternate_names = serde_json::to_string(&text.alternate_names).unwrap_or_else(|_| "[]".to_string());
    let word = |token: &str| -> Option<&str> {
        match token {
            "LENT_APP_NAME" => text.app_name.as_deref(),
            "LENT_SEO_TITLE" => text.seo_title.as_deref(),
            "LENT_SEO_DESCRIPTION" => text.seo_description.as_deref(),
            "LENT_REPO_URL" => Some(&text.repo_url),
            "LENT_ALTERNATE_NAMES_JSON" => Some(&alternate_names),
            _ => None,
        }
    };
    let mut filled = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("%LENT_") {
        filled.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let name_length = after.bytes().take_while(|byte| byte.is_ascii_uppercase() || *byte == b'_').count();
        let token = &after[..name_length];
        match (after[name_length..].starts_with('%'), word(token)) {
            (true, Some(word)) => {
                filled.push_str(word);
                rest = &after[name_length + 1..];
            }
            // No placeholder after all, or one nobody fills: as it is.
            _ => {
                filled.push('%');
                rest = after;
            }
        }
    }
    filled.push_str(rest);
    filled
}

// fillPagePath: the page's own address in its canonical link and link
// previews, `path` like « /rennes ». Before `fill_origin`.
fn fill_path(html: &str, path: &str) -> String {
    html.replace("href=\"__PUBLIC_ORIGIN__/\"", &format!("href=\"__PUBLIC_ORIGIN__{path}\"")).replace("content=\"__PUBLIC_ORIGIN__/\"", &format!("content=\"__PUBLIC_ORIGIN__{path}\""))
}

// fillPublicOrigin: `origin` is the site's address, or nothing to leave
// the links relative.
fn fill_origin(html: &str, origin: &str) -> String {
    html.replace("__PUBLIC_ORIGIN__", origin)
}

// A landing rendered at build time.
#[derive(Deserialize)]
struct Landing {
    html: String,
    // Each as the build wrote it: read and written again, its keys would
    // come out sorted, and the page would no longer be Node's byte for
    // byte (JSON.stringify keeps them in their order).
    #[serde(default, rename = "structuredData")]
    structured_data: Vec<Box<serde_json::value::RawValue>>,
}

#[derive(Default, Deserialize)]
struct Landings {
    home: Option<Landing>,
    #[serde(default)]
    universities: HashMap<String, Landing>,
}

// withPrerenderedLanding: the landing in the page's root, its structured
// data in its head, where a « < » can't end the script.
fn with_landing(shell: &str, landing: &Landing) -> String {
    let structured: String = landing
        .structured_data
        .iter()
        .map(|data| format!("<script type=\"application/ld+json\">{}</script>", data.get().replace('<', "\\u003c")))
        .collect();
    shell.replacen("<div id=\"root\"></div>", &format!("<div id=\"root\">{}</div>", landing.html), 1).replacen("</head>", &format!("{structured}</head>"), 1)
}

// A university's own page: its id and its address.
struct UniversityPage {
    id: String,
    path: String,
}

// What the server sends for an address.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Shown {
    // The page: its status, its HTML, and the headers that are its own
    // (the language, what it varies by, its canonical address, whether it
    // is kept out of search engines). Its type and its security headers are
    // the caller's to add (own/page_headers.rs reads them from the HTML).
    Page { status: u16, headers: Vec<(&'static str, String)>, html: String },
    // To the university's own address.
    Moved(String),
}

// The shells, read and filled once.
pub(crate) struct Shells {
    app: String,
    home: String,
    universities: HashMap<String, String>,
    // By slug, id, and id without dashes; the listed ones only.
    pages: HashMap<String, usize>,
    listed: Vec<UniversityPage>,
}

// The page's own addresses besides a university's (src/universityRuntime.js).
const CLIENT_PATHS: [&str; 3] = ["/", "/login", "/universites"];

impl Shells {
    // `template`: dist/index.html. `landings`: dist/.prerender/landing.json
    // when the build wrote it (read only where every university is served).
    pub(crate) fn new(template: &str, landings: Option<&str>, served: &Served) -> Self {
        let landings: Landings = landings.filter(|_| served.is_multi()).and_then(|written| serde_json::from_str(written).ok()).unwrap_or_default();
        let app = fill_text(template, served.page_text());
        let home = landings.home.as_ref().map_or_else(|| app.clone(), |landing| with_landing(&app, landing));
        let (mut universities, mut pages, mut listed) = (HashMap::new(), HashMap::new(), Vec::new());
        for (id, slug, text) in served.listed_pages() {
            let path = format!("/{slug}");
            let shell = fill_path(&fill_text(template, text), &path);
            universities.insert(id.to_string(), landings.universities.get(id).map_or_else(|| shell.clone(), |landing| with_landing(&shell, landing)));
            for name in [slug.to_string(), id.to_string(), id.replace('-', "")] {
                pages.insert(name, listed.len());
            }
            listed.push(UniversityPage { id: id.to_string(), path });
        }
        Self { app, home, universities, pages, listed }
    }

    // sendAppShell. `path`: the request's, as it came (still encoded);
    // `query`: what follows it, « ? » included, or nothing; `signed_out`:
    // no session cookie on the request; `origin`: the request's own
    // address as it may be written (statics.rs), or nothing.
    pub(crate) fn page(&self, served: &Served, path: &str, query: &str, signed_out: bool, origin: &str) -> Shown {
        // Malformed: matches no address of the page's.
        let decoded = url::form_urlencoded::parse(format!("p={}", path.replace('+', "%2B")).as_bytes()).next().map(|(_, value)| value.into_owned()).filter(|_| decodes(path)).unwrap_or_else(|| path.to_string());
        let pathname = decoded.as_str();
        let university = self.pages.get(&pathname.trim_end_matches('/').get(1..).unwrap_or_default().to_lowercase()).map(|index| &self.listed[*index]);
        if let Some(page) = university.filter(|page| pathname != page.path) {
            return Shown::Moved(format!("{}{query}", page.path));
        }

        let is_home = pathname == "/";
        let shown = university.filter(|_| signed_out);
        let shell = match shown {
            _ if signed_out && is_home => &self.home,
            Some(page) => self.universities.get(&page.id).unwrap_or(&self.app),
            None => &self.app,
        };
        let mut headers = vec![("content-language", "fr".to_string())];
        // Signed out or in, one address with two pages.
        if is_home || university.is_some() {
            headers.push(("vary", "Cookie".to_string()));
        }
        if !origin.is_empty() {
            headers.push(("link", format!("<{origin}{}>; rel=\"canonical\"", shown.map_or("/", |page| page.path.as_str()))));
        }
        Shown::Page { status: if self.is_client_path(served, pathname) { 200 } else { 404 }, headers, html: fill_origin(shell, origin) }
    }

    // GET /index.html.
    pub(crate) fn file(&self, origin: &str) -> Shown {
        let mut headers = vec![("x-robots-tag", "noindex".to_string())];
        if !origin.is_empty() {
            headers.push(("link", format!("<{origin}/>; rel=\"canonical\"")));
        }
        Shown::Page { status: 200, headers, html: fill_origin(&self.app, origin) }
    }

    fn is_client_path(&self, served: &Served, pathname: &str) -> bool {
        let clean = Some(pathname.trim_end_matches('/')).filter(|clean| !clean.is_empty()).unwrap_or("/");
        if CLIENT_PATHS.contains(&clean) {
            return true;
        }
        let name = &clean[1..];
        !name.contains('/') && served.names(name)
    }

    // GET /sitemap.xml; None without an address to write in it (404).
    pub(crate) fn sitemap(&self, origin: &str) -> Option<String> {
        if origin.is_empty() {
            return None;
        }
        let pages: String = self.listed.iter().map(|page| format!("  <url>\n    <loc>{origin}{}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n", page.path)).collect();
        Some(format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url>\n    <loc>{origin}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n{pages}</urlset>"
        ))
    }
}

// Whether decodeURIComponent takes a path: every « % » starts two hex
// digits, and what they spell is UTF-8.
fn decodes(path: &str) -> bool {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let Some(byte) = path.get(at + 1..at + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok()) else { return false };
            decoded.push(byte);
            at += 3;
        } else {
            decoded.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(decoded).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPLATE: &str = "<html><head><title>%LENT_SEO_TITLE%</title><meta name=\"application-name\" content=\"%LENT_APP_NAME%\" /><link rel=\"canonical\" href=\"__PUBLIC_ORIGIN__/\" /><meta property=\"og:url\" content=\"__PUBLIC_ORIGIN__/\" /><meta property=\"og:image\" content=\"__PUBLIC_ORIGIN__/og-image.jpg\" /><script type=\"application/ld+json\">{\"alternateName\": %LENT_ALTERNATE_NAMES_JSON%, \"sameAs\": [\"%LENT_REPO_URL%\"], \"other\": \"%LENT_UNKNOWN%\", \"rate\": \"100%\"}</script></head><body><div id=\"root\"></div></body></html>";
    const LANDINGS: &str = r#"{"home":{"html":"<h1>Tafac</h1>","structuredData":[{"q":"a < b","a":1}]},"universities":{"univ-rennes":{"html":"<h1>Rennes</h1>","structuredData":[]}}}"#;

    fn all() -> Served {
        Served::from_environment(|_| None, false).unwrap()
    }

    fn html(shown: &Shown) -> &str {
        match shown {
            Shown::Page { html, .. } => html,
            Shown::Moved(to) => panic!("moved to {to}"),
        }
    }

    fn header<'a>(shown: &'a Shown, name: &str) -> Option<&'a str> {
        match shown {
            Shown::Page { headers, .. } => headers.iter().find(|(header, _)| *header == name).map(|(_, value)| value.as_str()),
            Shown::Moved(_) => None,
        }
    }

    #[test]
    fn the_shell_is_filled_with_the_text_and_what_nobody_fills_stays() {
        let served = all();
        let filled = fill_text(TEMPLATE, served.page_text());
        assert!(filled.contains("<title>Tafac – Tout votre ENT en une seule app</title>"));
        assert!(filled.contains("content=\"Tafac\""));
        assert!(filled.contains("\"alternateName\": [\"l'ent\"], \"sameAs\": [\"https://github.com/l-ent-univ/tafac\"]"));
        assert!(filled.contains("\"other\": \"%LENT_UNKNOWN%\", \"rate\": \"100%\""));
        // A text without a word leaves its placeholder, as Node does.
        assert_eq!(fill_text("%LENT_APP_NAME% %LENT_REPO_URL%|", &PageText::default()), "%LENT_APP_NAME% |");
        assert_eq!(fill_text("50% %LENT_ %LENT_APP_NAME", &PageText::default()), "50% %LENT_ %LENT_APP_NAME");
    }

    #[test]
    fn signed_out_the_home_page_and_each_listed_university_come_with_their_landing() {
        let served = all();
        let shells = Shells::new(TEMPLATE, Some(LANDINGS), &served);
        let home = shells.page(&served, "/", "", true, "https://tafac.fr");
        assert!(html(&home).contains("<div id=\"root\"><h1>Tafac</h1></div>"));
        // A « < » of the structured data can't end its script.
        // Its keys stay in the order the build wrote them.
        assert!(html(&home).contains("<script type=\"application/ld+json\">{\"q\":\"a \\u003c b\",\"a\":1}</script></head>"));
        assert!(html(&home).contains("href=\"https://tafac.fr/\"") && !html(&home).contains("__PUBLIC_ORIGIN__"));
        assert_eq!((header(&home, "vary"), header(&home, "link"), header(&home, "content-language")), (Some("Cookie"), Some("<https://tafac.fr/>; rel=\"canonical\""), Some("fr")));

        let rennes = shells.page(&served, "/rennes", "", true, "https://tafac.fr");
        assert!(matches!(rennes, Shown::Page { status: 200, .. }));
        assert!(html(&rennes).contains("<div id=\"root\"><h1>Rennes</h1></div>"));
        assert!(html(&rennes).contains("Votre ENT de l'Université de Rennes"));
        // Its own address in its canonical link and previews; the image's stays the site's.
        assert!(html(&rennes).contains("href=\"https://tafac.fr/rennes\"") && html(&rennes).contains("content=\"https://tafac.fr/rennes\"") && html(&rennes).contains("content=\"https://tafac.fr/og-image.jpg\""));
        assert_eq!(header(&rennes, "link"), Some("<https://tafac.fr/rennes>; rel=\"canonical\""));
        // No landing written for Rennes 2: its page, with its text.
        let rennes2 = shells.page(&served, "/rennes2", "", true, "");
        assert!(html(&rennes2).contains("<div id=\"root\"></div>") && html(&rennes2).contains("href=\"/rennes2\""));
        assert_eq!(header(&rennes2, "link"), None);

        // Signed in: the bare app everywhere, which still varies by cookie.
        for path in ["/", "/rennes"] {
            let app = shells.page(&served, path, "", false, "https://tafac.fr");
            assert!(html(&app).contains("<div id=\"root\"></div>") && html(&app).contains("Tout votre ENT"), "{path}");
            assert_eq!((header(&app, "vary"), header(&app, "link")), (Some("Cookie"), Some("<https://tafac.fr/>; rel=\"canonical\"")), "{path}");
        }
    }

    #[test]
    fn an_address_is_the_page_a_universitys_own_or_a_404_that_shows_the_page() {
        let served = all();
        let shells = Shells::new(TEMPLATE, Some(LANDINGS), &served);
        // Another spelling of a university's page: to its own, query kept.
        for (path, query, to) in [("/univ-rennes", "", "/rennes"), ("/Rennes/", "?utm=1", "/rennes?utm=1"), ("/univrennes2", "", "/rennes2"), ("/RENNES2", "", "/rennes2"), ("/%72ennes/", "", "/rennes")] {
            assert_eq!(shells.page(&served, path, query, true, ""), Shown::Moved(to.to_string()), "{path}");
        }
        let status = |path: &str| match shells.page(&served, path, "", true, "") {
            Shown::Page { status, .. } => status,
            Shown::Moved(to) => panic!("{path} moved to {to}"),
        };
        for path in ["/", "/login", "/login/", "/universites", "/rennes", "/rennes2"] {
            assert_eq!(status(path), 200, "{path}");
        }
        // One for development servers has no page of its own, yet its
        // address is one of the app's (the picker's link): the bare app.
        assert_eq!(status("/exemple"), 200);
        assert_eq!(header(&shells.page(&served, "/exemple", "", true, ""), "vary"), None);
        for path in ["/nowhere", "/rennes/notes", "/login/x", "/%E0%A4%A", "/example-minimal"] {
            assert_eq!(status(path), 404, "{path}");
        }
        // The file itself: the bare app, out of search engines.
        let file = shells.file("https://tafac.fr");
        assert!(html(&file).contains("<div id=\"root\"></div>"));
        assert_eq!((header(&file, "x-robots-tag"), header(&file, "link")), (Some("noindex"), Some("<https://tafac.fr/>; rel=\"canonical\"")));
    }

    #[test]
    fn one_university_alone_has_its_own_text_and_no_page_but_the_apps() {
        let served = Served::from_environment(|name| (name == "UNIVERSITY").then(|| "univ-rennes".to_string()), false).unwrap();
        let shells = Shells::new(TEMPLATE, Some(LANDINGS), &served);
        let home = shells.page(&served, "/", "", true, "");
        assert!(html(&home).contains("Votre ENT de l'Université de Rennes") && html(&home).contains("<div id=\"root\"></div>"));
        // Its slug is an address of the app's, not a page of its own.
        assert!(matches!(shells.page(&served, "/univ-rennes", "", true, ""), Shown::Page { status: 200, .. }));
        assert_eq!(shells.sitemap("https://ent.exemple.fr").unwrap().matches("<url>").count(), 1);
    }

    #[test]
    fn the_sitemap_lists_the_home_page_and_each_listed_university() {
        let served = all();
        let shells = Shells::new(TEMPLATE, None, &served);
        let sitemap = shells.sitemap("https://tafac.fr").unwrap();
        assert!(sitemap.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset") && sitemap.ends_with("</url>\n</urlset>"));
        let listed: Vec<&str> = sitemap.split("<loc>").skip(1).map(|rest| rest.split("</loc>").next().unwrap()).collect();
        assert_eq!(listed, ["https://tafac.fr/", "https://tafac.fr/rennes", "https://tafac.fr/rennes2"]);
        assert_eq!(shells.sitemap(""), None);
    }
}
