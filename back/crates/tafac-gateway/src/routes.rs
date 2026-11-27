// The one table: which side answers each of the page's routes.
//
// The page asks /__ent_auth/* and /__ent_proxy/* and nothing else, on
// tafac.fr and in the apps alike. The gateway answers every one of them:
// it signs the student in, holds the session, and answers each route for a
// session it holds and for nobody (gateway/nobody.rs: Node's answers when it
// read no session), a university it doesn't serve included. A path of the
// page's API not listed is no route: 404, as Express says it (Moved::NotFound).
//
// The page's own files are at the end: tafac.fr's server answers them when
// it is given the build, and the last line takes every GET left (a file of
// the build, or the page where there is none).
//
// What is left of Node: an address outside the page's API that no line
// takes (a POST to /, a GET where the server has no build), passed on when
// a Node is behind (TAFAC_GATEWAY_NODE), Express's 404 without one
// (proxy.rs). The apps have no Node: their bridge answers those itself,
// from the build they carry (own/site.rs).
//
// A moved route is written once more in translate/ (tonAPI's answer as the
// page reads it today, its errors too). The planning's are the exception:
// the page reads tonAPI's own answers there (gateway/planning.rs), and Node
// has no such route.

use http::Method;

// The universities the gateway signs in at and answers for: named alike in
// tonAPI's settings and in Tafac's (universities/<id>), and checked there on
// a real account (back/README.md, « The universities answered here »). Any
// other university is refused at the sign-in, and a session of one is
// nobody's (gateway/signin.rs, gateway/nobody.rs). One added here brings
// the relay's own lists (launch/targets.rs).
pub const UNIVERSITIES: &[&str] = &["univ-rennes", "univ-rennes-2", "univ-sorbonne-nouvelle"];

// A route tonAPI answers, by its translator (translate/<name>.rs), or with
// tonAPI's own answer (the planning's).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Moved {
    Login,
    Logout,
    Session,
    Account,
    Apps,
    MoodleDeadlines,
    Grades,
    GradesSemester,
    GradesMessage,
    GradesDistribution,
    GradesTranscript,
    Launch,
    LaunchPreview,
    MoodleView,
    StudentPicture,
    CertificateStatus,
    Certificate,
    // The planning, as tonAPI's server answers it on its /v1 routes of the
    // same names: no translator (gateway/planning.rs).
    Timetable,
    TimetableTree,
    TimetableResources,
    // The mail page's: every path under /__ent_auth/mail, in any case
    // (gateway/mail/: tonAPI's webmail, Node's JSON).
    Mail,
    // Tafac's own (own/): no university answers them, and tonAPI is asked
    // nothing.
    Universities,
    UniversityLogo,
    Analytics,
    AppIcons,
    // /__ent_proxy/*: the portal's pages Node relayed. An old link to one
    // goes to the launch relay; nothing else is relayed any more
    // (gateway/portal_proxy.rs).
    PortalProxy,
    // Any other path of the page's API: no route (Express's 404).
    NotFound,
}

// A route of tafac.fr's own that its server answers itself, before Node
// (own/): the apps ask tafac.fr for these over the network, never their
// bridge, and carry their own files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Servers {
    AppSettings,
    AppSettingsSignature,
    DesktopManifest,
    DesktopInstaller,
    // With the page's build (own/statics.rs).
    Robots,
    AppleAssociation,
    // The page itself, and its sitemap (own/page.rs).
    Page,
    PageFile,
    Sitemap,
    // A file of the build, when there is one at that address; the page
    // where there is none.
    BuiltFile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    TonApi(Moved),
    // tafac.fr's server: always for the apps' settings and updates, and
    // given the build (TAFAC_GATEWAY_DIST) for the page's files; Node
    // otherwise. The apps' page files: their bridge's (own/site.rs).
    Server(Servers),
    // An address outside the page's API that no line takes: Node's, when
    // there is one behind (proxy.rs).
    Node,
}

pub struct Route {
    // "*": any method.
    pub method: &'static str,
    // A path, or every path under one ("/…/*").
    pub path: &'static str,
    pub backend: Backend,
}

const fn moved(method: &'static str, path: &'static str, to: Moved) -> Route {
    Route { method, path, backend: Backend::TonApi(to) }
}

const fn servers(method: &'static str, path: &'static str, to: Servers) -> Route {
    Route { method, path, backend: Backend::Server(to) }
}

pub const ROUTES: &[Route] = &[
    // The session: made, checked, ended.
    moved("POST", "/__ent_auth/login", Moved::Login),
    moved("POST", "/__ent_auth/logout", Moved::Logout),
    moved("GET", "/__ent_auth/session", Moved::Session),
    moved("GET", "/__ent_auth/account", Moved::Account),
    // What the university's services say.
    moved("GET", "/__ent_auth/apps", Moved::Apps),
    moved("GET", "/__ent_auth/moodle/deadlines", Moved::MoodleDeadlines),
    moved("GET", "/__ent_auth/grades", Moved::Grades),
    moved("GET", "/__ent_auth/grades/semester/*", Moved::GradesSemester),
    moved("GET", "/__ent_auth/grades/department-message", Moved::GradesMessage),
    moved("GET", "/__ent_auth/grades/evaluation-distribution", Moved::GradesDistribution),
    moved("GET", "/__ent_auth/grades/report.pdf", Moved::GradesTranscript),
    // Tafac's own: the universities this server serves, and their logos
    // (own/universities.rs); in the apps, every one, with what their remote
    // settings lay over the page's settings.
    moved("GET", "/__ent_auth/universities", Moved::Universities),
    moved("GET", "/__ent_auth/universities/*", Moved::UniversityLogo),
    moved("POST", "/__ent_auth/analytics", Moved::Analytics),
    // The portal's pages Node relayed: an old link to one, sent on to the
    // launch relay; anything else refused (gateway/portal_proxy.rs).
    moved("*", "/__ent_proxy/*", Moved::PortalProxy),
    moved("POST", "/__ent_auth/app-icons", Moved::AppIcons),
    // Tafac's own relay: a service opened signed in (launch/).
    moved("GET", "/__ent_auth/launch", Moved::Launch),
    moved("GET", "/__ent_auth/launch-preview", Moved::LaunchPreview),
    // The planning: tonAPI's own answers, read by the page as they are.
    moved("GET", "/__ent_auth/timetable", Moved::Timetable),
    moved("GET", "/__ent_auth/timetable/tree", Moved::TimetableTree),
    moved("GET", "/__ent_auth/timetable/resources", Moved::TimetableResources),
    // The student's own files: the photo ScoDoc keeps, the school certificate.
    moved("GET", "/__ent_auth/student-pic", Moved::StudentPicture),
    moved("GET", "/__ent_auth/documents/school-certificate/status", Moved::CertificateStatus),
    moved("GET", "/__ent_auth/documents/school-certificate", Moved::Certificate),
    // Mail, Moodle.
    moved("*", "/__ent_auth/mail/*", Moved::Mail),
    // Tafac's own, for the apps' Moodle page: what its view may show.
    moved("GET", "/__ent_auth/moodle/view", Moved::MoodleView),
    // tafac.fr's own, for the apps: their remote settings, the desktop app's
    // update. Answered by its server whatever the session (own/).
    servers("GET", "/app/settings.json", Servers::AppSettings),
    servers("GET", "/app/settings.json.sig", Servers::AppSettingsSignature),
    servers("GET", "/desktop/latest.json", Servers::DesktopManifest),
    servers("GET", "/desktop/download/*", Servers::DesktopInstaller),
    // The page, its files and the addresses beside them, answered by
    // tafac.fr's server when it is given the build (own/statics.rs,
    // own/page.rs).
    servers("GET", "/", Servers::Page),
    servers("GET", "/index.html", Servers::PageFile),
    servers("GET", "/sitemap.xml", Servers::Sitemap),
    servers("GET", "/robots.txt", Servers::Robots),
    servers("GET", "/.well-known/apple-app-site-association", Servers::AppleAssociation),
    // Last: any other address but the page's API. A file of the build where
    // there is one; the page where there isn't.
    servers("GET", "/*", Servers::BuiltFile),
];

// The page's API: never a file.
pub(crate) fn is_api(path: &str) -> bool {
    ["/__ent_auth", "/__ent_proxy"].iter().any(|api| path.strip_prefix(api).is_some_and(|rest| rest.is_empty() || rest.starts_with('/')))
}

// HEAD is answered wherever GET is, as Express's router does (the answer's
// status and headers, no body: Gateway::answer).
fn matches(route: &Route, method: &Method, path: &str) -> bool {
    let method_matches = route.method == "*" || route.method == method.as_str() || (route.method == "GET" && method == Method::HEAD);
    let path_matches = match route.path.strip_suffix("/*") {
        // The whole site: every address but the page's API.
        Some("") => path.starts_with('/') && !is_api(path),
        Some(folder) => path.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/')),
        None => path == route.path,
    };
    method_matches && path_matches
}

// Which side answers a request: the first line of the table that fits it;
// for a path of the page's API that none fits, no route (Express's 404);
// Node for any other address.
pub fn backend(method: &Method, path: &str) -> Backend {
    // The mail's, in any case and with or without a slash at the end, as
    // Express matches them: none of its paths reaches Node.
    if crate::gateway::is_mail_path(path) {
        return Backend::TonApi(Moved::Mail);
    }
    // Node mounted its portal proxy on the prefix itself too.
    if path == "/__ent_proxy" {
        return Backend::TonApi(Moved::PortalProxy);
    }
    match ROUTES.iter().find(|route| matches(route, method, path)) {
        Some(route) => route.backend,
        None if is_api(path) => Backend::TonApi(Moved::NotFound),
        None => Backend::Node,
    }
}

// The route a request is, when tonAPI answers it.
pub fn moved_route(method: &Method, path: &str) -> Option<Moved> {
    match backend(method, path) {
        Backend::TonApi(route) => Some(route),
        Backend::Server(_) | Backend::Node => None,
    }
}

// What tafac.fr's server answers itself, when it is given the build.
pub fn server_route(method: &Method, path: &str) -> Option<Servers> {
    match backend(method, path) {
        Backend::Server(route) => Some(route),
        Backend::TonApi(_) | Backend::Node => None,
    }
}

fn line_of(moved: Moved) -> Option<&'static Route> {
    ROUTES.iter().find(|route| route.backend == Backend::TonApi(moved))
}

// A moved route as the table writes it (« GET /__ent_auth/grades/semester/* »):
// what the log says of a request, never what the page put in its path.
pub fn written(moved: Moved) -> String {
    line_of(moved).map_or_else(String::new, |route| format!("{} {}", route.method, route.path))
}

// What a path holds under a moved route's folder (« /…/* »): the semester's
// id of /__ent_auth/grades/semester/<id>. None for a route that is one path.
pub fn under(moved: Moved, path: &str) -> Option<&str> {
    path.strip_prefix(line_of(moved)?.path.strip_suffix('*')?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_moved_routes_and_only_them() {
        assert_eq!(backend(&Method::POST, "/__ent_auth/login"), Backend::TonApi(Moved::Login));
        assert_eq!(backend(&Method::POST, "/__ent_auth/logout"), Backend::TonApi(Moved::Logout));
        assert_eq!(backend(&Method::GET, "/__ent_auth/session"), Backend::TonApi(Moved::Session));
        assert_eq!(backend(&Method::GET, "/__ent_auth/account"), Backend::TonApi(Moved::Account));
        assert_eq!(backend(&Method::GET, "/__ent_auth/moodle/deadlines"), Backend::TonApi(Moved::MoodleDeadlines));
        assert_eq!(backend(&Method::GET, "/__ent_auth/apps"), Backend::TonApi(Moved::Apps));
        for (path, route) in [
            ("/__ent_auth/grades", Moved::Grades),
            ("/__ent_auth/grades/semester/1234", Moved::GradesSemester),
            ("/__ent_auth/grades/department-message", Moved::GradesMessage),
            ("/__ent_auth/grades/evaluation-distribution", Moved::GradesDistribution),
            ("/__ent_auth/grades/report.pdf", Moved::GradesTranscript),
        ] {
            assert_eq!(backend(&Method::GET, path), Backend::TonApi(route), "{path}");
        }
        for (path, route) in [
            ("/__ent_auth/launch", Moved::Launch),
            ("/__ent_auth/launch-preview", Moved::LaunchPreview),
            ("/__ent_auth/moodle/view", Moved::MoodleView),
            ("/__ent_auth/student-pic", Moved::StudentPicture),
            ("/__ent_auth/documents/school-certificate/status", Moved::CertificateStatus),
            ("/__ent_auth/documents/school-certificate", Moved::Certificate),
            ("/__ent_auth/universities", Moved::Universities),
            ("/__ent_auth/universities/univ-rennes/logo", Moved::UniversityLogo),
            ("/__ent_auth/timetable", Moved::Timetable),
            ("/__ent_auth/timetable/tree", Moved::TimetableTree),
            ("/__ent_auth/timetable/resources", Moved::TimetableResources),
        ] {
            assert_eq!(backend(&Method::GET, path), Backend::TonApi(route), "{path}");
        }
        // Any other path of the page's API: no route, answered here.
        for (method, path) in [
            (Method::POST, "/__ent_auth/session"),
            (Method::POST, "/__ent_auth/moodle/deadlines"),
            (Method::POST, "/__ent_auth/moodle/view"),
            (Method::GET, "/__ent_auth/moodle/deadlines/"),
            (Method::GET, "/__ent_auth/session/"),
            (Method::POST, "/__ent_auth/apps"),
            (Method::GET, "/__ent_auth/apps/"),
            (Method::GET, "/__ent_auth/sessions"),
            (Method::GET, "/__ent_auth/login"),
            (Method::GET, "/__ent_auth/logout"),
            (Method::POST, "/__ent_auth/login/"),
            (Method::POST, "/__ent_auth/grades"),
            (Method::GET, "/__ent_auth/grades/semester"),
            (Method::GET, "/__ent_auth/grades/something-new"),
            (Method::POST, "/__ent_auth/student-pic"),
            (Method::POST, "/__ent_auth/launch"),
            (Method::GET, "/__ent_auth/launch/"),
            (Method::GET, "/__ent_auth/documents/school-certificate/"),
            (Method::GET, "/__ent_auth/documents/something-new"),
            (Method::GET, "/__ent_auth/planning"),
            (Method::POST, "/__ent_auth/ade/upcoming"),
            (Method::GET, "/__ent_auth/ade/tree"),
            (Method::POST, "/__ent_auth/timetable"),
            (Method::GET, "/__ent_auth/timetable/"),
            (Method::GET, "/__ent_auth/timetable/groups"),
            (Method::GET, "/__ent_auth/something-new"),
            (Method::GET, "/__ent_auth"),
        ] {
            assert_eq!(backend(&method, path), Backend::TonApi(Moved::NotFound), "{method} {path}");
            assert_eq!(server_route(&method, path), None);
        }
        for (method, path) in [(Method::GET, "/__ent_proxy/api/v4-3/dlm/layout.json"), (Method::POST, "/__ent_proxy/api/layout"), (Method::GET, "/__ent_proxy"), (Method::GET, "/__ent_proxy/")] {
            assert_eq!(backend(&method, path), Backend::TonApi(Moved::PortalProxy), "{method} {path}");
        }
        // Outside the page's API, what no line takes: Node's, when there is
        // one behind.
        for (method, path) in [
            (Method::POST, "/"),
            (Method::POST, "/sitemap.xml"),
            (Method::POST, "/desktop/latest.json"),
            (Method::POST, "/app/settings.json"),
            (Method::POST, "/assets/index.js"),
        ] {
            assert_eq!(backend(&method, path), Backend::Node, "{method} {path}");
            assert_eq!(moved_route(&method, path), None);
            assert_eq!(server_route(&method, path), None);
        }
    }

    #[test]
    fn head_is_answered_wherever_get_is() {
        for (path, route) in [("/__ent_auth/session", Moved::Session), ("/__ent_auth/grades/semester/12", Moved::GradesSemester), ("/__ent_auth/launch", Moved::Launch), ("/__ent_proxy/f/welcome", Moved::PortalProxy)] {
            assert_eq!(backend(&Method::HEAD, path), Backend::TonApi(route), "{path}");
        }
        assert_eq!(server_route(&Method::HEAD, "/robots.txt"), Some(Servers::Robots));
        assert_eq!(server_route(&Method::HEAD, "/assets/index.js"), Some(Servers::BuiltFile));
        // A route with no GET has no HEAD either.
        for path in ["/__ent_auth/login", "/__ent_auth/logout", "/__ent_auth/analytics", "/__ent_auth/app-icons"] {
            assert_eq!(backend(&Method::HEAD, path), Backend::TonApi(Moved::NotFound), "{path}");
        }
    }

    #[test]
    fn every_mail_path_is_the_gateways() {
        for (method, path) in [(Method::POST, "/__ent_auth/mail/send"), (Method::GET, "/__ent_auth/MAIL/recent"), (Method::POST, "/__ent_auth/Mail/Send/"), (Method::GET, "/__ent_auth/mail"), (Method::PUT, "/__ent_auth/mail/x")] {
            assert_eq!(backend(&method, path), Backend::TonApi(Moved::Mail), "{method} {path}");
        }
        assert_eq!(backend(&Method::GET, "/__ent_auth/mailbox"), Backend::TonApi(Moved::NotFound));
    }

    #[test]
    fn the_pages_files_are_the_servers_when_it_has_them() {
        assert_eq!(backend(&Method::POST, "/__ent_auth/app-icons"), Backend::TonApi(Moved::AppIcons));
        assert_eq!(server_route(&Method::GET, "/robots.txt"), Some(Servers::Robots));
        assert_eq!(server_route(&Method::GET, "/.well-known/apple-app-site-association"), Some(Servers::AppleAssociation));
        for path in ["/assets/index.js", "/sw.js", "/icon.png", "/__ent_authx", "/desktop", "/app/other.json", "/univ-rennes"] {
            assert_eq!(server_route(&Method::GET, path), Some(Servers::BuiltFile), "{path}");
            assert_eq!(moved_route(&Method::GET, path), None);
        }
    }

    #[test]
    fn a_moved_route_is_written_and_read_as_the_table_has_it() {
        assert_eq!(written(Moved::Grades), "GET /__ent_auth/grades");
        assert_eq!(written(Moved::GradesSemester), "GET /__ent_auth/grades/semester/*");
        assert_eq!(under(Moved::GradesSemester, "/__ent_auth/grades/semester/1234"), Some("1234"));
        assert_eq!(under(Moved::GradesSemester, "/__ent_auth/grades/semester/12/34"), Some("12/34"));
        assert_eq!(under(Moved::GradesSemester, "/__ent_auth/grades/semester/"), Some(""));
        assert_eq!(under(Moved::Grades, "/__ent_auth/grades"), None);
    }

    #[test]
    fn every_line_is_a_route_of_the_page_and_none_is_nodes() {
        for route in ROUTES {
            // A moved route is one of the page's API; the server's own are
            // the site's other addresses.
            match route.backend {
                Backend::TonApi(_) => assert!(is_api(route.path.trim_end_matches("/*")), "{}", route.path),
                Backend::Server(_) => assert!(route.path.starts_with('/') && !is_api(route.path), "{}", route.path),
                Backend::Node => panic!("{} is Node's", route.path),
            }
            assert!(["GET", "POST", "*"].contains(&route.method), "{}", route.method);
        }
        // The whole site's line is the last: every line above it counts.
        assert_eq!(ROUTES.iter().position(|route| route.path == "/*"), Some(ROUTES.len() - 1));
    }

    #[test]
    fn the_servers_own_routes_are_never_the_gateways() {
        for (path, route) in [
            ("/app/settings.json", Servers::AppSettings),
            ("/app/settings.json.sig", Servers::AppSettingsSignature),
            ("/desktop/latest.json", Servers::DesktopManifest),
            ("/desktop/download/darwin-aarch64", Servers::DesktopInstaller),
        ] {
            assert_eq!(backend(&Method::GET, path), Backend::Server(route), "{path}");
            // Gateway::answer, which the apps' bridge calls, leaves them.
            assert_eq!(moved_route(&Method::GET, path), None, "{path}");
        }
        assert_eq!(backend(&Method::POST, "/desktop/latest.json"), Backend::Node);
        // No platform named: an address like any other of the site's, a
        // file of the build if there were one, as for Node.
        assert_eq!(backend(&Method::GET, "/desktop/download"), Backend::Server(Servers::BuiltFile));
    }

    // Node's routes that the page no longer asks, which have no line: they
    // answer 404 here (Moved::NotFound), and go with Node's code.
    const DROPPED: &[&str] = &["/__ent_auth/planning", "/__ent_auth/ade"];

    // Node's routes, read from its source: one added there shows here, to be
    // listed above with the side that answers it. The API's, and the ones
    // server.js answers before the page's files (its own, and those of the
    // routers it mounts for tafac.fr's own).
    #[test]
    fn every_route_node_has_is_in_the_table() {
        let mut missing = Vec::new();
        let sources = [
            (include_str!("../../../../server/entAuthApp.js"), true),
            (include_str!("../../../../server/universitiesApp.js"), true),
            (include_str!("../../../../server.js"), false),
            (include_str!("../../../../server/desktopUpdate/index.ts"), false),
            (include_str!("../../../../server/remoteSettings/index.ts"), false),
        ];
        for (source, api_only) in sources {
            for line in source.lines() {
                let line = line.trim_start();
                let Some(rest) = ["app.get(", "app.post(", "app.all(", "app.use(", "router.get(", "router.post(", "router.all("].iter().find_map(|call| line.strip_prefix(call)) else { continue };
                let is_use = line.starts_with("app.use(");
                let Some(path) = rest.strip_prefix('\'').and_then(|rest| rest.split('\'').next()) else { continue };
                if api_only && !path.starts_with("/__ent_auth/") && !path.starts_with("/__ent_proxy") {
                    continue;
                }
                // A parameter is a folder's content; a mounted prefix too.
                let path = path.split("/:").next().unwrap_or(path);
                // The whole site's line lists nothing by itself.
                let listed = ROUTES.iter().filter(|route| route.path != "/*").any(|route| {
                    let folder = route.path.strip_suffix("/*");
                    route.path == path || folder.is_some_and(|folder| path == folder || path.starts_with(&format!("{folder}/")))
                });
                let dropped = DROPPED.iter().any(|dropped| path == *dropped || path.starts_with(&format!("{dropped}/")));
                if !listed && !dropped && !(is_use && path == "/__ent_auth") {
                    missing.push(path.to_string());
                }
            }
        }
        assert!(missing.is_empty(), "routes of Node's missing from routes.rs: {missing:?}");
    }
}
