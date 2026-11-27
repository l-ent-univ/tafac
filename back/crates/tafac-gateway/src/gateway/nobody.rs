// What a moved route answers when the request holds no session of the
// gateway's: no cookie, one that isn't read (past its lifetime, the demo
// account's from before, sealed with a secret no longer taken), a session
// signed out, or one of a university the gateway doesn't serve. Node's own
// answers when it read no session (server/entAuthApp.js), given here: Node
// is never asked.
//
// Each in Node's order:
//
//   the feature     a university without the service (Node's FEATURES,
//                   read from universities/directory.json): 404 { ok:
//                   false, disabled: true, feature }, before the route
//   the route       its own answer for nobody, below
//   the header      `X-Tafac-Session: expired` on every answer but the
//                   session check's, the sign-out's and the statistics'
//                   (Node's SESSION_FREE_PATHS, its middleware before the
//                   routes): the page signs out if it thought it was
//                   signed in (src/sessionSignal.js)
//
// The routes' answers for nobody, as Node's:
//
//   GET /session                200 { authenticated: false, user: null, …,
//                               university }: the university the request is
//                               for (own/universities.rs)
//   POST /logout                200 { authenticated: false }, the cookie
//                               cleared
//   GET /account                200 { authenticated: false, account: null,
//                               sessionMode: null }
//   GET /apps                   200 { authenticated: false, apps: null }
//   GET /moodle/deadlines       200 { authenticated: false, deadlines: null }
//   GET /moodle/view            404 { ok: false }
//   GET /grades, /grades/semester/<id>
//                               200 { authenticated: false, grades: null }
//   GET /grades/department-message
//                               200 { authenticated: false, message: null }
//   GET /grades/evaluation-distribution
//                               200 { authenticated: false, status:
//                               'unavailable', reason: 'signed-out' }
//   GET /grades/report.pdf      401 { error: 'Not signed in.' }
//   GET /launch                 to the target when it is one of the
//                               university's services, to the app otherwise
//   GET /launch-preview         the target for the browser to open itself
//                               (`missing-session`), or the target refused
//   GET /student-pic            401 { error: 'Authentication required.' };
//                               with `meta=1`, 200 { authenticated: false,
//                               available: false, source: 'scodoc',
//                               previewUrl: null }
//   GET /documents/school-certificate/status
//                               401 { available: false, error: 'Authentication required.' }
//   GET /documents/school-certificate
//                               401 { ok: false, error: 'Authentication required.' }
//   POST /app-icons             401 { ok: false, error: 'Authentication required.' }
//   GET /timetable, /timetable/tree, /timetable/resources
//                               never Node's: tonAPI's own refusal of a
//                               request without a session, `invalid_token`
//                               (401, application/problem+json)
//   /__ent_proxy/*              portal_proxy.rs
//   any other path of the API   404 { error: 'Not found.' }
//
// Which university a request without a session is for: the one the server
// says (own/universities.rs, as Node's resolveUniversity). In the apps,
// which don't tell the gateway what is served, their own Node still answers
// nobody (gateway/mod.rs: apps_node_answers); a session of a university the
// gateway doesn't serve is answered here, for the university the page
// chose (X-Tafac-University) when the gateway answers for it, else Node's
// default.

use http::header::{CACHE_CONTROL, HeaderValue};
use serde_json::{json, Value};
use tonapi_core::{ErrorCode, Problem};

use super::{planning, Asked, Gateway};
use crate::mail::request::query_value;
use crate::node::{SESSION_EXPIRED, SESSION_HEADER, UNIVERSITY_HEADER};
use crate::own::universities::{self, Feature, DEFAULT_UNIVERSITY};
use crate::routes::Moved;
use crate::translate::{self, json_response};

const AUTHENTICATION_REQUIRED: &str = "Authentication required.";

fn json(status: u16, body: &Value) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default())
}

// A path of the page's API that is no route: Express's 404, as JSON (the
// mail's own say it so too).
pub(crate) fn not_found() -> http::Response<Vec<u8>> {
    json(404, &json!({ "error": "Not found." }))
}

// Node's feature gate: the route of a service the university hasn't.
fn disabled(feature: &str) -> http::Response<Vec<u8>> {
    json(404, &json!({ "ok": false, "disabled": true, "feature": feature }))
}

// The service a route is gated by, as Node's FEATURE_GATED_PREFIXES: its
// name there, and the flag.
fn gate(route: Moved) -> Option<(&'static str, Feature)> {
    match route {
        Moved::Grades | Moved::GradesSemester | Moved::GradesMessage | Moved::GradesDistribution | Moved::GradesTranscript => Some(("grades", Feature::Grades)),
        Moved::MoodleDeadlines | Moved::MoodleView => Some(("moodleDeadlines", Feature::MoodleDeadlines)),
        _ => None,
    }
}

// The routes Node answers whether or not a session is read: no header that
// says it is over (SESSION_FREE_PATHS).
fn session_free(route: Moved) -> bool {
    matches!(route, Moved::Session | Moved::Login | Moved::Logout | Moved::Analytics | Moved::Universities | Moved::UniversityLogo)
}

// Node's middleware said it on any path under its two prefixes.
pub(crate) fn says_no_session(mut response: http::Response<Vec<u8>>, path: &str) -> http::Response<Vec<u8>> {
    if path.starts_with("/__ent_auth/") || path.starts_with("/__ent_proxy/") {
        response.headers_mut().insert(SESSION_HEADER, HeaderValue::from_static(SESSION_EXPIRED));
    }
    response
}

impl Gateway {
    // The university a request without a session is for.
    pub(crate) fn university_for_nobody(&self, headers: &http::HeaderMap) -> String {
        if let Some(served) = &self.served {
            return served.for_nobody(headers).to_string();
        }
        let chosen = headers.get(UNIVERSITY_HEADER).and_then(|value| value.to_str().ok()).map(|name| name.trim().to_lowercase());
        chosen.filter(|id| self.universities.contains_key(id)).unwrap_or_else(|| DEFAULT_UNIVERSITY.to_string())
    }

    // A moved route's answer for nobody signed in (the list at the top).
    pub(super) fn for_nobody(&self, route: Moved, asked: &Asked<'_>) -> http::Response<Vec<u8>> {
        let university = self.university_for_nobody(asked.headers);
        let response = match gate(route) {
            Some((name, feature)) if !universities::has(&university, feature) => disabled(name),
            _ => self.nobodys(route, asked, &university),
        };
        if session_free(route) {
            return response;
        }
        says_no_session(response, asked.path)
    }

    fn nobodys(&self, route: Moved, asked: &Asked<'_>, university: &str) -> http::Response<Vec<u8>> {
        let signed_out = |field: &str| {
            let mut body = json!({ "authenticated": false });
            body[field] = Value::Null;
            json(200, &body)
        };
        match route {
            Moved::Session => translate::expired::nobody_signed_in(university, self.statistics),
            Moved::Logout => translate::signin::signed_out(&self.cookie_name),
            Moved::Account => json(200, &json!({ "authenticated": false, "account": null, "sessionMode": null })),
            Moved::Apps => signed_out("apps"),
            Moved::MoodleDeadlines => signed_out("deadlines"),
            Moved::MoodleView => json(404, &json!({ "ok": false })),
            Moved::Grades | Moved::GradesSemester => signed_out("grades"),
            Moved::GradesMessage => signed_out("message"),
            Moved::GradesDistribution => json(200, &json!({ "authenticated": false, "status": "unavailable", "reason": "signed-out" })),
            Moved::GradesTranscript => {
                let mut response = json(401, &json!({ "error": "Not signed in." }));
                response.headers_mut().insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
                response
            }
            Moved::Launch => match self.universities.get(university) {
                Some(university) => Self::launch_for_nobody(university, asked),
                None => translate::launch::redirect(translate::launch::APP_PATH),
            },
            Moved::LaunchPreview => match self.universities.get(university) {
                Some(university) => Self::preview_for_nobody(university, asked),
                None => translate::launch::invalid_target(""),
            },
            Moved::StudentPicture if query_value(asked.query, "meta").one() == Some("1") => {
                json(200, &json!({ "authenticated": false, "available": false, "source": "scodoc", "previewUrl": null }))
            }
            Moved::StudentPicture => json(401, &json!({ "error": AUTHENTICATION_REQUIRED })),
            Moved::CertificateStatus => json(401, &json!({ "available": false, "error": AUTHENTICATION_REQUIRED })),
            Moved::Certificate | Moved::AppIcons => json(401, &json!({ "ok": false, "error": AUTHENTICATION_REQUIRED })),
            Moved::Timetable | Moved::TimetableTree | Moved::TimetableResources => planning::problem_answer(&Problem::new(ErrorCode::InvalidToken)),
            Moved::PortalProxy => self.portal_proxy(asked, None),
            // Answered before a session is looked for (mod.rs): the
            // sign-in, the mail, Tafac's own; and no route at all.
            Moved::Login | Moved::Mail | Moved::Universities | Moved::UniversityLogo | Moved::Analytics | Moved::NotFound => not_found(),
        }
    }
}
