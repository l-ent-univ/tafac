// Two more made-up campuses, for the portals that are not uPortal: a Drupal
// site (as Rennes 2's) and iSorbonne (the Sorbonne Nouvelle's). Each has the
// first campus's CAS and Moodle (mod.rs), and a portal of its own:
//
//   Drupal      every page sends nobody to the CAS; /casservice takes the
//               ticket and opens the session; / is the entry, /user leads
//               to the student's page (the name), /tous-outils lists the
//               tools
//   iSorbonne   one page, /ENT/secure/index.xhtml: it sends nobody to the
//               CAS, takes the ticket itself, and has the logout link (the
//               name in it) and the tiles
//
// Their settings are tonAPI's own files for the two universities
// (univ-rennes-2, univ-sorbonne-nouvelle), as the crate has them, with the
// campus's addresses in place of the real ones: what a test finds working
// here is what switching a university on in routes.rs turns on, short of
// the real hosts.
//
// The pages are files (pages/), which a test of Node's reads too
// (tests/portalAppsParity.test.js): one page, the same list from both.

use std::ops::Deref;
use std::sync::atomic::Ordering;

use tonapi_config::{HomeworkService, PortalConfig, ResolvedUniversity, Sso};
use url::Url;

use super::{cas_answer, listening, moodle_answer, percent_encoded, query_of, Answer, Campus, Received, State, COOKIE_NAME, SECRET};
use crate::universities::{self, EMBEDDED};
use crate::Gateway;

pub const DRUPAL_TOOLS: &str = include_str!("pages/drupal-tools.html");
pub const DRUPAL_USER: &str = include_str!("pages/drupal-user.html");
pub const ISORBONNE_HOME: &str = include_str!("pages/isorbonne-home.html");
// The applications each page lists, as the page gets them (`{origin}`: the
// portal's own address).
pub const DRUPAL_APPS: &str = include_str!("pages/drupal-apps.json");
pub const ISORBONNE_APPS: &str = include_str!("pages/isorbonne-apps.json");

#[derive(Clone, Copy)]
enum Kind {
    Drupal,
    Isorbonne,
}

// A campus whose portal is not uPortal. What it shares with the first one
// (the CAS, Moodle, what was seen, what is forgotten) is the first one's.
pub struct OtherCampus {
    campus: Campus,
    kind: Kind,
}

impl Deref for OtherCampus {
    type Target = Campus;

    fn deref(&self) -> &Campus {
        &self.campus
    }
}

pub fn drupal_campus() -> OtherCampus {
    OtherCampus { campus: listening(drupal_answer), kind: Kind::Drupal }
}

pub fn isorbonne_campus() -> OtherCampus {
    OtherCampus { campus: listening(isorbonne_answer), kind: Kind::Isorbonne }
}

fn html(page: &str) -> Answer {
    Answer::of("200 OK", "text/html; charset=utf-8", page.to_string())
}

// The portal's session of the moment: `alive`, then `alive-1`… once it forgot.
fn session_of(state: &State) -> String {
    match state.portal_sessions.load(Ordering::SeqCst) {
        0 => "alive".to_string(),
        forgotten => format!("alive-{forgotten}"),
    }
}

fn shows(cookies: &str, cookie: &str) -> bool {
    cookies.split("; ").any(|shown| shown == cookie)
}

fn to_the_cas(port: &str, service: &str) -> Answer {
    Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(service)))
}

fn shared_answer(received: &Received<'_>, port: &str, state: &State) -> Option<Answer> {
    let path = received.path;
    if path.starts_with("/cas/") {
        return Some(cas_answer(received, port, state));
    }
    if path.starts_with("/moodle/") {
        return Some(moodle_answer(path, received.cookies, port, &state.moodle));
    }
    None
}

// The Drupal portal: its session's cookie is SSESScampus.
fn drupal_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    if let Some(answer) = shared_answer(received, port, state) {
        return answer;
    }
    let (path, cookies) = (received.path, received.cookies);
    let route = path.split('?').next().unwrap_or_default();
    let here = format!("http://127.0.0.1:{port}");
    if route == "/casservice" {
        let destination = query_of(path, "destination").unwrap_or_else(|| "/".to_string());
        return match query_of(path, "ticket").as_deref() {
            Some("ST-campus") => Answer::redirect(&format!("{here}{destination}")).with(format!("set-cookie: SSESScampus={}; Path=/", session_of(state))),
            _ => Answer::of("403 Forbidden", "text/html; charset=utf-8", "<html><body class=\"user-anonymous\">Accès refusé</body></html>".to_string()),
        };
    }
    // The portal forces the sign-in: any page sends nobody to the CAS.
    if !shows(cookies, &format!("SSESScampus={}", session_of(state))) {
        return to_the_cas(port, &format!("{here}/casservice?destination={}", percent_encoded(route)));
    }
    match route {
        "/" => html("<html><body class=\"user-logged-in path-frontpage\">Accueil</body></html>"),
        "/user" => Answer::redirect(&format!("{here}/user/7")),
        "/user/7" => html(DRUPAL_USER),
        "/tous-outils" => html(DRUPAL_TOOLS),
        _ => Answer::of("404 Not Found", "text/html; charset=utf-8", "<html><body class=\"user-logged-in\">Page non trouvée</body></html>".to_string()),
    }
}

// iSorbonne: its session's cookie is JSESSIONID, for /ENT.
fn isorbonne_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    if let Some(answer) = shared_answer(received, port, state) {
        return answer;
    }
    let (path, cookies) = (received.path, received.cookies);
    let home = format!("http://127.0.0.1:{port}/ENT/secure/index.xhtml");
    if path.split('?').next() != Some("/ENT/secure/index.xhtml") {
        return Answer::of("404 Not Found", "text/plain", String::new());
    }
    if query_of(path, "ticket").as_deref() == Some("ST-campus") {
        return Answer::redirect(&home).with(format!("set-cookie: JSESSIONID={}; Path=/ENT", session_of(state)));
    }
    if !shows(cookies, &format!("JSESSIONID={}", session_of(state))) {
        return to_the_cas(port, &home);
    }
    html(ISORBONNE_HOME)
}

impl OtherCampus {
    // The university the campus stands for, as Tafac and tonAPI both name it.
    pub fn id(&self) -> &'static str {
        match self.kind {
            Kind::Drupal => "univ-rennes-2",
            Kind::Isorbonne => "univ-sorbonne-nouvelle",
        }
    }

    // The name of the portal's session cookie.
    pub fn portal_cookie(&self) -> &'static str {
        match self.kind {
            Kind::Drupal => "SSESScampus",
            Kind::Isorbonne => "JSESSIONID",
        }
    }

    // The page the portal says who the student is on, and the one that
    // lists the applications.
    pub fn pages(&self) -> (&'static str, &'static str) {
        match self.kind {
            Kind::Drupal => ("/user/7", "/tous-outils"),
            Kind::Isorbonne => ("/ENT/secure/index.xhtml", "/ENT/secure/index.xhtml"),
        }
    }

    // The applications the portal lists, as the page gets them.
    pub fn apps(&self) -> serde_json::Value {
        let written = match self.kind {
            Kind::Drupal => DRUPAL_APPS,
            Kind::Isorbonne => ISORBONNE_APPS,
        };
        serde_json::from_str(&written.replace("{origin}", &format!("http://127.0.0.1:{}", self.port()))).expect("the list is JSON")
    }

    // tonAPI's settings for the university, with the campus's addresses in
    // place of the real ones, and only what the gateway asks: the portal
    // and Moodle. Nothing of it names a real host.
    pub fn settings(&self) -> ResolvedUniversity {
        let port = self.port();
        let here = |path: &str| Url::parse(&format!("http://127.0.0.1:{port}/{path}")).expect("an address of the campus's");
        let embedded = EMBEDDED.iter().find(|embedded| embedded.id == self.id()).expect("tonAPI has the university's settings");
        let mut settings = universities::read(embedded).expect("tonAPI's settings read");
        let file = &mut settings.university;
        match &mut file.sso {
            Sso::Cas(cas) => cas.base_url = Url::parse(&format!("http://localhost:{port}/cas/")).expect("the campus's CAS"),
            Sso::Demo => panic!("a university behind a CAS"),
        }
        match (&mut file.portal, self.kind) {
            (PortalConfig::Drupal { base_url, .. }, Kind::Drupal) => *base_url = here(""),
            (PortalConfig::Isorbonne { base_url }, Kind::Isorbonne) => *base_url = here("ENT/"),
            _ => panic!("the university's portal is no longer the one this campus plays"),
        }
        match &mut file.services.homework {
            Some(HomeworkService::MoodleAjax { base_url, .. }) => *base_url = here("moodle/"),
            _ => panic!("the university's Moodle is no longer asked as this campus answers"),
        }
        file.services.timetable = None;
        file.services.mail = None;
        file.services.documents = None;
        file.links = Default::default();
        let written = serde_json::to_string(file).expect("settings are JSON");
        assert!(!written.contains("https://"), "a real address is left in the campus's settings: {written}");
        settings
    }

    pub fn gateway(&self) -> Gateway {
        Gateway::for_tests(vec![self.settings()], SECRET, COOKIE_NAME)
    }

    // The session cookie (its value) of a student there, with these portal
    // cookies.
    pub fn cookie(&self, portal_cookies: &[(&str, &str)]) -> String {
        self.campus.cookie(serde_json::json!({ "uni": self.id() }), portal_cookies)
    }

    // A student whose portal session lives.
    pub fn alive(&self) -> String {
        self.cookie(&[(self.portal_cookie(), "alive")])
    }

    // The same student, the portal's session lapsed.
    pub fn lapsed(&self) -> String {
        self.cookie(&[(self.portal_cookie(), "lapsed")])
    }
}
