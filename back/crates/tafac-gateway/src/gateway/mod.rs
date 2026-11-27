// The gateway itself: a request of the page in, its answer out.
//
//   mod.rs        the Gateway: which route, whose session, whether the
//                 answer made is still the session's when it is ready, a
//                 route that fails, and a session the university no longer
//                 knows
//   signin.rs     POST /login and /logout: the session made (tonAPI signs
//                 in, the cookie is written) and ended
//   attempts.rs   the sign-in's limits, and the address a request came from
//   portal.rs     the routes the portal answers: the session check and the
//                 account (one question, asked once for both)
//   services.rs   the routes another service answers (Moodle, ScoDoc): its
//                 turn, the answer kept, the question, what the session
//                 holds of the service
//   behind.rs     the home page's three answers: an old one given while
//                 the university is asked again, and all three asked at
//                 the sign-in
//   settled.rs    the routes answered to their end here, failures included:
//                 launch.rs (the launch relay, its preview) and student.rs
//                 (the photo, the school certificate)
//   planning.rs   the planning's routes: tonAPI's own answers, its refusals
//                 too, with no translator
//   mail/         the mail page's routes, /__ent_auth/mail/*: the webmail
//                 signed in to with the CAS ticket, Node's JSON
//   nobody.rs     what every moved route says when the request holds no
//                 session of the gateway's: Node's answers for nobody
//   portal_proxy.rs   /__ent_proxy/*: an old link to a portal's page sent
//                 on to the launch relay, anything else refused
//
// And one route of Tafac's own, which asks the university nothing: the
// applications' icons (own/icons.rs).
//
// The session is the gateway's: it signs the student in, holds what tonAPI
// got from the university, and says when the session is over. Every route
// of the page's API is answered here: for a session it holds, its errors
// too (translate/failed.rs); for nobody, a cookie that isn't read, a
// session of a university it doesn't serve, as Node answered nobody
// (nobody.rs); a path that is no route, 404. A Node behind, when there is
// one, is only told when a session ends (node.rs). None from here is left
// for the apps' own Node alone (apps_node_answers), until their bridge goes
// without it: who holds no session of the gateway's (a session of a
// university it doesn't serve aside), what is no route, /__ent_proxy/*;
// and what the bridge doesn't set the gateway up for: the list of
// universities, the statistics, the icons.

mod attempts;
mod behind;
mod launch;
mod mail;
mod nobody;
mod planning;
pub(crate) mod portal;
mod portal_proxy;
mod services;
mod settled;
mod signin;
mod student;

use std::collections::BTreeMap;
use std::future::Future;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use http::{HeaderMap, Method};
use tonapi_providers::NetSettings;

pub use attempts::TrustedProxies;
pub(crate) use mail::is_mail_path;
#[cfg(feature = "server")]
pub(crate) use nobody::not_found;
pub use mail::{BoxError, ByteStream, MailBody};
use behind::Lasting;

use crate::node::{self, NodeAnswer, NodeRequest};
use crate::own::universities::Served;
use crate::routes::{self, Moved};
use crate::session::cookie;
use crate::session::handed::CAS_TICKET;
use crate::session::memory::{self, Ended, Memory, Turn};
use crate::session::Held;
use crate::tonapi;
use crate::translate::{self, Failure, Translated};
use crate::universities::{self, University};

// How long Node is waited for when it is told a session ended: it ends the
// webmail's session and tells the CAS too, and the page waits meanwhile.
const NODE_TOLD_PATIENCE: Duration = Duration::from_secs(6);
// Why a route failed when tonAPI said `session_expired` of a session the
// CAS still knows, or doesn't say is over: the service's own refusal.
const REFUSED_NOT_OVER: &str = "session_expired, and the CAS doesn't say the session is over";

// A request of the page's.
pub struct Asked<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    // What follows the path's « ? », as it came.
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
    // A sign-in's body; nothing for a request whose body isn't read here.
    pub body: &'a [u8],
    // The address the connection came from, where there is one (a server);
    // the apps have none.
    pub peer: Option<IpAddr>,
}

pub struct Gateway {
    // Shared with what is asked behind an answer (behind.rs).
    universities: BTreeMap<String, Arc<University>>,
    cookie_name: String,
    pub(crate) codec: cookie::Codec,
    net: NetSettings,
    trusted: TrustedProxies,
    // Whether the statistics are on, as Node is set up (node.rs).
    statistics: bool,
    // Where the statistics go, when the gateway sends them (own/analytics.rs).
    pub(crate) statistics_sent: Option<crate::own::analytics::Statistics>,
    // Says every request a moved route refused, not only the ones that
    // failed.
    verbose: bool,
    pub(crate) memory: Memory,
    pub(crate) attempts: attempts::Attempts,
    pub(crate) early: portal::Early,
    // A sign-in has the home page's answers asked at once (behind.rs).
    // Always, but in the tests, which count what a sign-in asks.
    asks_ahead: bool,
    // The universities this server serves, where it says (`serving`):
    // Tafac's own routes about them are then answered here
    // (own/universities.rs), and so is a session check nobody is signed in
    // for.
    served: Option<Served>,
    // The applications' icons, when the gateway has Node's data directory
    // (own/icons.rs); None: Node answers them.
    icons: Option<crate::own::icons::Icons>,
    // The mail's sessions with the webmail, and its limits (gateway/mail/).
    pub(crate) mail_memory: mail::state::MailMemory,
    pub(crate) mail_limits: crate::mail::MailLimits,
    // Whether a Node is behind, to be told when a session ends: in the apps
    // (their bridge's server) and on a server given TAFAC_GATEWAY_NODE.
    node_behind: bool,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0)
}

impl Gateway {
    // `session_secret`: SESSION_SECRET, which Node is given too. `cookie_name`:
    // the session cookie's (PRODUCTION_COOKIE or DEVELOPMENT_COOKIE, as Node
    // runs).
    pub fn new(session_secret: &str, cookie_name: &str) -> Self {
        Self::with(universities::served(), session_secret, cookie_name, NetSettings { user_agent: Some(node::USER_AGENT), ..NetSettings::default() })
    }

    fn with(universities: BTreeMap<String, University>, session_secret: &str, cookie_name: &str, net: NetSettings) -> Self {
        Self {
            universities: universities.into_iter().map(|(id, university)| (id, Arc::new(university))).collect(),
            cookie_name: cookie_name.to_string(),
            codec: cookie::Codec::new(session_secret),
            net,
            trusted: TrustedProxies::Private,
            statistics: false,
            statistics_sent: None,
            verbose: std::env::var_os("TAFAC_LOG_REQUESTS").is_some(),
            memory: Memory::default(),
            attempts: attempts::Attempts::default(),
            early: portal::Early::default(),
            asks_ahead: true,
            served: None,
            icons: None,
            mail_memory: mail::state::MailMemory::default(),
            mail_limits: crate::mail::MailLimits::default(),
            node_behind: true,
        }
    }

    // No Node behind (tafac.fr's server without TAFAC_GATEWAY_NODE):
    // nothing is ever told it.
    pub fn without_node(mut self) -> Self {
        self.node_behind = false;
        self
    }

    // The applications' icons answered here, from the file Node keeps in
    // `data_dir` (its DATA_DIR): tafac.fr's server. The apps leave them to
    // their own Node.
    pub fn with_icons_in(mut self, data_dir: impl Into<std::path::PathBuf>) -> Self {
        self.icons = Some(crate::own::icons::Icons::new(data_dir));
        self
    }

    // What this server serves, as Node is set up (`Served::from_environment`):
    // the university a request without a session is for. Without it (the
    // apps), the list of universities stays their Node's, and a request
    // without a session is for the university the page chose
    // (nobody.rs).
    pub fn serving(mut self, served: Served) -> Self {
        self.served = Some(served);
        self
    }

    // Whose word is taken for the address a request came from (the
    // sign-in's limits), on a server behind another: Node's TRUST_PROXY.
    pub fn trusting(mut self, trusted: TrustedProxies) -> Self {
        self.trusted = trusted;
        self
    }

    // Whether the statistics are on, which a session check says to the page
    // (`analyticsEnabled`). `posthog_project_key`: POSTHOG_PROJECT_KEY as
    // the Node behind is given it, which decides it for Node; None where
    // Node sends nothing whatever its key (a development server without
    // POSTHOG_IN_DEV).
    pub fn with_statistics(mut self, posthog_project_key: Option<&str>) -> Self {
        self.statistics = node::statistics_on(posthog_project_key);
        self
    }

    // Whether Node runs as on tafac.fr and in the apps, which the cookie's
    // name says (getSessionCookieName): its routes then say one sentence
    // for an error of the university's, and the reason in development
    // (server/routeErrors).
    fn in_production(&self) -> bool {
        self.cookie_name != cookie::DEVELOPMENT_COOKIE
    }

    // For the tests: the universities given, asked without TLS.
    #[cfg(any(test, feature = "testing"))]
    pub fn for_tests(universities: Vec<tonapi_config::ResolvedUniversity>, session_secret: &str, cookie_name: &str) -> Self {
        let universities =
            universities.into_iter().filter_map(|settings| Some((settings.university.id.clone(), University::of(settings)?))).collect();
        let mut gateway = Self::with(universities, session_secret, cookie_name, NetSettings { https_only: false, user_agent: Some(node::USER_AGENT) });
        gateway.asks_ahead = false;
        gateway
    }

    // For the tests of what a sign-in asks ahead: as the gateway that runs.
    #[cfg(any(test, feature = "testing"))]
    pub fn asking_ahead(mut self) -> Self {
        self.asks_ahead = true;
        self
    }

    pub fn cookie_name(&self) -> &str {
        &self.cookie_name
    }

    // The ids of the universities whose moved routes are answered here.
    pub fn universities(&self) -> Vec<&str> {
        self.universities.keys().map(String::as_str).collect()
    }

    // Whether a request's body is read here: a sign-in's, which says who
    // signs in, the statistics', and the applications' list their icons
    // are for. No other route reads one (the mail streams its own).
    pub fn reads_body(method: &Method, path: &str) -> bool {
        matches!(routes::moved_route(method, path), Some(Moved::Login | Moved::Analytics | Moved::AppIcons))
    }

    // The answer to one of those whose body is longer than Node's limit
    // (express.json's, the statistics' own), which its server doesn't read.
    pub fn body_too_large(method: &Method, path: &str) -> http::Response<Vec<u8>> {
        match routes::moved_route(method, path) {
            Some(Moved::Analytics) => crate::own::analytics::refused_too_large(),
            _ => translate::json_response(413, br#"{"error":"Request body too large."}"#.to_vec()),
        }
    }

    // The answer to a request of the page's API (routes.rs), for anyone.
    // None: not one of the page's API (an address of the site), or a route
    // the apps' own Node still answers (the top of this file).
    //
    // `cookie`: the value of the session cookie as the caller holds it now
    // (asked again before answering: the session may have ended meanwhile).
    // `node`: a request to Node and its answer (node.rs says which is made:
    // Node told that a session ended).
    //
    // An answer may set or clear the session's cookie (Set-Cookie): a
    // caller that keeps the cookie itself takes it from there.
    pub async fn answer<C, N, Fut>(&self, asked: &Asked<'_>, cookie: C, node: N) -> Option<http::Response<Vec<u8>>>
    where
        C: Fn() -> Option<String>,
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let route = routes::moved_route(asked.method, asked.path)?;
        // A sign-in is the one route without a session to answer for.
        if route == Moved::Login {
            return self.sign_in(asked).await;
        }
        // Tafac's own, whoever asks, with a session or without (own/).
        if let Moved::Universities | Moved::UniversityLogo = route {
            return self.own_universities(route, asked, cookie().as_deref());
        }
        if route == Moved::Analytics {
            return self.statistics_posted(asked, cookie());
        }
        // The mail's, with the body read whole (the apps' bridge): its answer
        // read whole too. tafac.fr's server streams them (proxy.rs).
        if route == Moved::Mail {
            let answered = self.mail(asked, MailBody::Whole(asked.body.to_vec()), &cookie, node).await;
            let (parts, body) = answered.into_parts();
            let body = body.read(usize::MAX).await.ok()?;
            return Some(http::Response::from_parts(parts, body));
        }
        // No route: Express's 404, whoever asks.
        let semester_unread = route == Moved::GradesSemester && !routes::under(route, asked.path).is_some_and(|id| !id.is_empty() && !id.contains('/'));
        if route == Moved::NotFound || semester_unread {
            if self.apps_node_answers() {
                return None;
            }
            let held = cookie().is_some_and(|value| self.signed_in(Some(&value)).is_some());
            return Some(if held { nobody::not_found() } else { nobody::says_no_session(nobody::not_found(), asked.path) });
        }
        let Some(value) = cookie() else {
            return (!self.apps_node_answers()).then(|| self.for_nobody(route, asked));
        };
        // Tafac's own icons: nothing asked of the university.
        if route == Moved::AppIcons {
            let Some(held) = self.signed_in(Some(&value)) else { return self.unheld(route, asked, &value, &node).await };
            return self.icons.as_ref()?.answer(&held.session.university, asked);
        }
        // The routes answered to their end here, failures included.
        if Self::settles(route) {
            return self.settled(route, asked, &value, &cookie, &node).await;
        }
        if route == Moved::PortalProxy {
            if self.apps_node_answers() {
                return None;
            }
            return match self.signed_in(Some(&value)) {
                Some(held) => Some(self.portal_proxy(asked, Some(&held))),
                None => self.unheld(route, asked, &value, &node).await,
            };
        }
        if route != Moved::Logout {
            if let Some(expired) = self.found_expired_already(route, &value) {
                return Some(expired);
            }
        }
        let Some(held) = self.signed_in(Some(&value)) else { return self.unheld(route, asked, &value, &node).await };
        let query = asked.query;

        let translated = match route {
            // A sign-in was answered above, and so were the routes of
            // settled.rs and Tafac's own.
            Moved::Login | Moved::Launch | Moved::LaunchPreview | Moved::MoodleView | Moved::StudentPicture | Moved::CertificateStatus | Moved::Certificate => return None,
            Moved::Universities | Moved::UniversityLogo | Moved::Analytics | Moved::AppIcons | Moved::Mail | Moved::PortalProxy | Moved::NotFound => return None,
            // The session ends: nothing to check of it after.
            Moved::Logout => return Some(self.sign_out(&held, &value, &node).await),
            Moved::Session => self.session_check(&held).await,
            Moved::Account => self.account(&held).await,
            Moved::Apps => self.lasting(&held, Lasting::Apps, query).await,
            Moved::MoodleDeadlines => self.lasting(&held, Lasting::Deadlines, query).await,
            Moved::Grades => self.lasting(&held, Lasting::Grades, query).await,
            // Node's route reads one part of the path after the folder: a
            // path with none, or more, was answered 404 above.
            Moved::GradesSemester => self.grades(&held, routes::under(route, asked.path).unwrap_or_default()).await,
            Moved::GradesMessage => self.grades_message(&held, query).await,
            Moved::GradesDistribution => self.grades_distribution(&held, query).await,
            Moved::GradesTranscript => self.grades_transcript(&held, query).await,
            Moved::Timetable => self.timetable(&held, query).await,
            Moved::TimetableTree => self.timetable_tree(&held, query).await,
            Moved::TimetableResources => self.timetable_resources(&held, query).await,
        };

        let response = match translated {
            Translated::Answer(response) => response,
            Translated::Failed(failure) => self.route_failed(route, &failure),
            Translated::Lost => match self.lost(route, &held, &value, &node).await {
                Some(expired) => return Some(expired),
                // The CAS still knows the ticket, or doesn't say: the
                // service refused for a reason of its own.
                None => self.route_failed(route, &Failure::Unavailable(REFUSED_NOT_OVER.to_string())),
            },
        };
        self.still_the_sessions(route, asked, &value, &held, &cookie, response, &node).await
    }

    // In the apps, whose bridge doesn't tell the gateway what is served and
    // has their own Node behind: that Node still answers who holds no
    // session of the gateway's, and what is no route, until the bridge goes
    // without it. None from the routes then. A session of a university the
    // gateway doesn't serve is answered here all the same (unheld).
    pub(super) fn apps_node_answers(&self) -> bool {
        self.served.is_none() && self.node_behind
    }

    // An answer made for a session, once it is ready. Signed out while the
    // university was asked (or out and in again): the session this answer
    // is about is over, and the request is answered as one that holds no
    // session.
    #[allow(clippy::too_many_arguments)]
    async fn still_the_sessions<C, N, Fut>(&self, route: Moved, asked: &Asked<'_>, value: &str, held: &Held<'_>, cookie: &C, response: http::Response<Vec<u8>>, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        C: Fn() -> Option<String>,
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let still = self.signed_in(cookie().as_deref()).is_some_and(|current| current.session.id == held.session.id);
        if still || self.signed_in(Some(value)).is_some() {
            return Some(response);
        }
        self.unheld(route, asked, value, node).await
    }

    // A request whose session cookie holds no session the gateway answers
    // with: found expired a moment ago (told so again); one of its own
    // universities without the CAS ticket, which nothing can be asked with
    // (ended here, as the mail ends it); else nobody's (nobody.rs): a
    // cookie past its lifetime or not read, a session signed out, the demo
    // account's from before, a university the gateway doesn't serve. In
    // the apps, their Node's (None) but for the last.
    async fn unheld<N, Fut>(&self, route: Moved, asked: &Asked<'_>, value: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if !matches!(route, Moved::PortalProxy | Moved::Logout) {
            if let Some(expired) = self.found_expired_already(route, value) {
                return Some(expired);
            }
        }
        let session = self.codec.read(value, now_ms());
        let elsewhere = session.as_ref().is_some_and(|session| !self.universities.contains_key(&session.university));
        if self.apps_node_answers() && !elsewhere {
            return None;
        }
        if let Some(session) = session {
            if !elsewhere && self.memory.ended(&session.id).is_none() {
                let why = if route == Moved::Logout { Ended::SignedOut } else { Ended::Expired };
                self.memory.end(&session.id, why);
                self.mail_ended(&session.id).await;
                self.tell_node_it_ended(value, node).await;
                if route == Moved::Logout {
                    return Some(translate::signin::signed_out(&self.cookie_name));
                }
                eprintln!("[tafac] session: signed out, no CAS ticket to ask the university with");
                let over = self.expired(route, &session.university, true);
                return Some(if route == Moved::Launch { translate::launch::expired(&over) } else { over });
            }
        }
        Some(self.for_nobody(route, asked))
    }

    // GET /__ent_auth/universities and a university's logo
    // (own/universities.rs), where the server said what it serves. None
    // elsewhere: the apps' Node, whose list carries their remote settings.
    // A session cookie that isn't read here is no session.
    fn own_universities(&self, route: Moved, asked: &Asked<'_>, cookie: Option<&str>) -> Option<http::Response<Vec<u8>>> {
        let served = self.served.as_ref()?;
        if route == Moved::UniversityLogo {
            return Some(routes::under(route, asked.path).and_then(|id| served.logo(id, asked.headers)).unwrap_or_else(nobody::not_found));
        }
        let session = cookie.and_then(|cookie| self.codec.read(cookie, now_ms())).map(|session| session.university);
        Some(served.list(asked.headers, session.as_deref()))
    }

    // A moved route without an answer of its own: its error, worded here as
    // Node words its own (translate/failed.rs). An error of the
    // university's is worth a line: the route as the table writes it, and
    // tonAPI's error code or words of this crate, never anything of the
    // account. A request refused is said only when asked
    // (TAFAC_LOG_REQUESTS).
    fn route_failed(&self, route: Moved, failure: &Failure) -> http::Response<Vec<u8>> {
        match failure {
            Failure::Unavailable(why) => eprintln!("[tafac] tonapi: {} failed ({why})", routes::written(route)),
            Failure::Said(status, _) if self.verbose => eprintln!("[tafac] tonapi: {} refused ({status})", routes::written(route)),
            Failure::Said(..) => {}
        }
        // The planning's routes say it as tonAPI does, whatever the server:
        // their words are this crate's, never anything of the account.
        if let (Moved::Timetable | Moved::TimetableTree | Moved::TimetableResources, Failure::Unavailable(why)) = (route, failure) {
            return planning::unavailable(why);
        }
        translate::failed::answer(route, failure, self.in_production())
    }

    // tonAPI says the university no longer knows the session (its
    // `session_expired`): the CAS wouldn't sign it in to the portal or to a
    // service, or a service refuses for a reason of its own. Only the CAS
    // says a session is over, when its login page, asked with the ticket,
    // wants the password again. Then the session ends here: the page is
    // told (the route's answer, `X-Tafac-Session: expired`, the cookie
    // taken away) and Node is told. None otherwise: the session lives, and
    // the route has failed.
    async fn lost<N, Fut>(&self, route: Moved, held: &Held<'_>, cookie: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if self.cas_still_knows(held).await != Some(false) {
            return None;
        }
        // The one request that ends the session takes its cookie away; one
        // that found it expired at the same moment says so, no more.
        let ends_it = self.memory.end(&held.session.id, Ended::Expired);
        self.mail_ended_behind(&held.session.id);
        if ends_it {
            eprintln!("[tafac] session: signed out, the CAS no longer knows it");
            self.tell_node_it_ended(cookie, node).await;
        }
        Some(self.expired(route, &held.session.university, ends_it))
    }

    // A request that still shows the cookie of a session found expired
    // here: told so again, as Node tells it (the cookie isn't touched: the
    // answer that ended the session took it).
    fn found_expired_already(&self, route: Moved, cookie: &str) -> Option<http::Response<Vec<u8>>> {
        let session = self.codec.read(cookie, now_ms())?;
        if self.memory.ended(&session.id) != Some(Ended::Expired) || !self.universities.contains_key(&session.university) {
            return None;
        }
        Some(self.expired(route, &session.university, false))
    }

    // What a route says of a session that is over (translate/expired.rs).
    // `ends_it`: on the answer that ends the session.
    fn expired(&self, route: Moved, university: &str, ends_it: bool) -> http::Response<Vec<u8>> {
        let session_check = (route == Moved::Session).then_some((university, self.statistics));
        translate::expired::answer(session_check, ends_it.then_some(self.cookie_name.as_str()))
    }

    // Whether the CAS still knows the session's ticket; None when it doesn't
    // say. One question at a time for a session, and its « yes » stands a
    // minute for the requests that fail together.
    pub(crate) async fn cas_still_knows(&self, held: &Held<'_>) -> Option<bool> {
        let _turn = held.memory.turn(Turn::Cas).await;
        if self.memory.ended(&held.session.id) == Some(Ended::Expired) {
            return Some(false);
        }
        if held.memory.cas_knew() {
            return Some(true);
        }
        let known = tonapi::signin::still_known(held.university, &held.session, self.net).await;
        match known {
            Some(true) => held.memory.cas_knows(),
            Some(false) => {}
            None => eprintln!("[tafac] session: the CAS didn't say whether it still knows the session (down, slow, or another page)"),
        }
        known
    }

    // Node told a session ended here, with the session's cookie: its own
    // sign-out, whose answer isn't the page's. Nothing without a Node
    // behind.
    pub(crate) async fn tell_node_it_ended<N, Fut>(&self, cookie: &str, node: &N)
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if !self.node_behind {
            return;
        }
        let Some(request) = node::session_ended(&self.cookie_name, cookie) else { return };
        if tokio::time::timeout(NODE_TOLD_PATIENCE, node(request)).await.ok().flatten().is_none() {
            eprintln!("[tafac] session: Node wasn't told that a session ended (it didn't answer)");
        }
    }

    // A request on its way to Node: a sign-out ends its session here too,
    // for any other request still on its way with the same cookie. (The
    // sign-out of a session held here is answered here: this is for the
    // ones that aren't.)
    pub fn saw_request(&self, method: &Method, path: &str, cookie: Option<&str>) {
        if node::is_sign_out(method, path) {
            self.end(cookie, Ended::SignedOut);
        }
    }

    // Node's answer to a request that came with `cookie`: when it says the
    // session is gone (its header: expired; or the cookie cleared), it is
    // gone here.
    pub fn saw_response(&self, cookie: Option<&str>, headers: &HeaderMap) {
        if let Some(why) = node::says_ended(headers, &self.cookie_name) {
            self.end(cookie, why);
        }
    }

    // A session ended: no more answers for it, and nothing of it held.
    fn end(&self, cookie: Option<&str>, why: Ended) {
        let Some(session) = cookie.and_then(|cookie| self.codec.read(cookie, now_ms())) else { return };
        self.memory.end(&session.id, why);
        self.mail_ended_behind(&session.id);
    }

    // The session a cookie holds, when it is one answered from here: at one
    // of the universities of routes.rs, with its CAS ticket, and not ended.
    pub(crate) fn signed_in(&self, cookie: Option<&str>) -> Option<Held<'_>> {
        let session = self.codec.read(cookie?, now_ms())?;
        let university = self.universities.get(&session.university)?;
        if !session.has_cookie(&university.cas_host, CAS_TICKET) || self.memory.ended(&session.id).is_some() {
            return None;
        }
        let memory = self.memory.of(&session.id, memory::student(&session.university, &session.user).as_deref());
        Some(Held { session, university, memory })
    }
}
