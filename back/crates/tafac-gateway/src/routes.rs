// The one table: which side answers each of the page's routes.
//
// The page asks /__ent_auth/* and /__ent_proxy/* and nothing else, on
// tafac.fr and in the apps alike. The gateway is in front: it signs the
// student in, holds the session, and answers the routes that have moved to
// tonAPI. Node is behind it for the rest, each listed here with what keeps
// it there, so this file says where the move stands. A route not listed is
// Node's.
//
// A moved route is written once more in translate/ (tonAPI's answer as the
// page reads it today, its errors too). It is still Node's for the sessions
// the gateway doesn't hold: nobody signed in, another university.

use http::Method;

// The universities the gateway signs in at and answers for: named alike in
// tonAPI's settings and in Tafac's (universities/<id>), and checked there on
// a real account (back/README.md, « The universities answered here »). Any
// other university is Node's, sign-in included. One added here brings the
// relay's own lists (launch/targets.rs).
pub const UNIVERSITIES: &[&str] = &["univ-rennes", "univ-rennes-2", "univ-sorbonne-nouvelle"];

// A route tonAPI answers, by its translator (translate/<name>.rs).
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    TonApi(Moved),
    Node,
}

pub struct Route {
    // "*": any method.
    pub method: &'static str,
    // A path, or every path under one ("/…/*").
    pub path: &'static str,
    pub backend: Backend,
    // For a route of Node's: what tonAPI lacks to answer it as Node does.
    pub why: &'static str,
}

const fn moved(method: &'static str, path: &'static str, to: Moved) -> Route {
    Route { method, path, backend: Backend::TonApi(to), why: "" }
}

const fn node(method: &'static str, path: &'static str, why: &'static str) -> Route {
    Route { method, path, backend: Backend::Node, why }
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
    // Tafac's own.
    node("GET", "/__ent_auth/universities", "Tafac's own list of universities"),
    node("GET", "/__ent_auth/universities/*", "Tafac's own logos"),
    node("POST", "/__ent_auth/analytics", "Tafac's own statistics"),
    // The portal.
    node("*", "/__ent_proxy/*", "the account's photo, and an old link to a page of the portal's (sent on to the launch relay)"),
    node("POST", "/__ent_auth/app-icons", "Tafac's own icons"),
    // Tafac's own relay: a service opened signed in (launch/).
    moved("GET", "/__ent_auth/launch", Moved::Launch),
    moved("GET", "/__ent_auth/launch-preview", Moved::LaunchPreview),
    // The planning.
    node("GET", "/__ent_auth/planning", "tonAPI's timetable is the student's own groups only, without ADE's colours and ids"),
    node("*", "/__ent_auth/ade/*", "tonAPI's timetable takes no resource to ask for, and has no tree, search, rooms or teachers"),
    // The student's own files: the photo ScoDoc keeps, the school certificate.
    moved("GET", "/__ent_auth/student-pic", Moved::StudentPicture),
    moved("GET", "/__ent_auth/documents/school-certificate/status", Moved::CertificateStatus),
    moved("GET", "/__ent_auth/documents/school-certificate", Moved::Certificate),
    // Mail, Moodle.
    node("*", "/__ent_auth/mail/*", "tonAPI reads an inbox only, and Rennes' stops at the SAML step: no message, folder, draft or send"),
    // Tafac's own, for the apps' Moodle page: what its view may show.
    moved("GET", "/__ent_auth/moodle/view", Moved::MoodleView),
];

fn matches(route: &Route, method: &Method, path: &str) -> bool {
    let method_matches = route.method == "*" || route.method == method.as_str();
    let path_matches = match route.path.strip_suffix("/*") {
        Some(folder) => path.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/')),
        None => path == route.path,
    };
    method_matches && path_matches
}

// Which side answers a request: the first line of the table that fits it,
// Node when none does.
pub fn backend(method: &Method, path: &str) -> Backend {
    ROUTES.iter().find(|route| matches(route, method, path)).map_or(Backend::Node, |route| route.backend)
}

// The route a request is, when tonAPI answers it.
pub fn moved_route(method: &Method, path: &str) -> Option<Moved> {
    match backend(method, path) {
        Backend::TonApi(route) => Some(route),
        Backend::Node => None,
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
        ] {
            assert_eq!(backend(&Method::GET, path), Backend::TonApi(route), "{path}");
        }
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
            (Method::POST, "/__ent_auth/ade/upcoming"),
            (Method::POST, "/__ent_auth/mail/send"),
            (Method::GET, "/__ent_proxy/api/v4-3/dlm/layout.json"),
            (Method::GET, "/__ent_auth/something-new"),
            (Method::GET, "/"),
            (Method::GET, "/assets/index.js"),
        ] {
            assert_eq!(backend(&method, path), Backend::Node, "{method} {path}");
            assert_eq!(moved_route(&method, path), None);
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
    fn every_line_is_a_route_of_the_page_and_says_why_it_stays() {
        for route in ROUTES {
            assert!(route.path.starts_with("/__ent_auth/") || route.path.starts_with("/__ent_proxy/"), "{}", route.path);
            assert!(["GET", "POST", "*"].contains(&route.method), "{}", route.method);
            assert_eq!(route.backend == Backend::Node, !route.why.is_empty(), "{}", route.path);
        }
    }

    // Node's routes, read from its source: one added there shows here, to be
    // listed above with the side that answers it.
    #[test]
    fn every_route_node_has_is_in_the_table() {
        let mut missing = Vec::new();
        for source in [include_str!("../../../../server/entAuthApp.js"), include_str!("../../../../server/universitiesApp.js")] {
            for line in source.lines() {
                let line = line.trim_start();
                let Some(rest) = ["app.get(", "app.post(", "app.all(", "app.use("].iter().find_map(|call| line.strip_prefix(call)) else { continue };
                let is_use = line.starts_with("app.use(");
                let Some(path) = rest.strip_prefix('\'').and_then(|rest| rest.split('\'').next()) else { continue };
                if !path.starts_with("/__ent_auth/") && !path.starts_with("/__ent_proxy") {
                    continue;
                }
                // A parameter is a folder's content; a mounted prefix too.
                let path = path.split("/:").next().unwrap_or(path);
                let listed = ROUTES.iter().any(|route| {
                    let folder = route.path.strip_suffix("/*");
                    route.path == path || folder.is_some_and(|folder| path == folder || path.starts_with(&format!("{folder}/")))
                });
                if !listed && !(is_use && path == "/__ent_auth") {
                    missing.push(path.to_string());
                }
            }
        }
        assert!(missing.is_empty(), "routes of Node's missing from routes.rs: {missing:?}");
    }
}
