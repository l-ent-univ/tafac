// The translators: one per moved route (routes.rs).
//
// Each turns what tonAPI said into what the page gets for that route today
// (server/entAuthApp.js): the same JSON, field for field, and the same
// status. The page doesn't change, so these are still Node's words; a
// translator goes when the page reads tonAPI's own model instead.
//
//   signin.rs    POST /__ent_auth/login and /logout: the session made, ended
//   expired.rs   any route, once the CAS says the session is over
//   failed.rs    any route, when it has no answer of its own: the service
//                is down, the request is one to refuse
//   session.rs, account.rs, moodle_deadlines.rs, grades/   the routes' own
//   apps.rs      GET /__ent_auth/apps: tonAPI's own list, which the page
//                reads as it is
//   launch.rs, moodle_view.rs, student_pic.rs, school_certificate.rs
//                the routes answered to their end here (settled.rs): the
//                launch relay, Moodle's view, the photo, the certificate
//
// A translator says one of three things: the page's answer; why there is
// none (failed.rs words it, as Node words its own errors); or « the session
// is lost », when tonAPI says the university no longer knows it, for the
// gateway to ask the CAS whether it is over (gateway/mod.rs).

pub mod account;
pub mod apps;
pub mod expired;
pub mod failed;
pub mod grades;
pub mod launch;
pub mod moodle_deadlines;
pub mod moodle_view;
pub mod school_certificate;
pub mod session;
pub mod settled;
pub mod signin;
pub mod student_pic;

use tonapi_core::{ErrorCode, Profile};

pub use self::failed::Failure;
use crate::session::cookie::Session;
pub use crate::tonapi::Unanswered;

// On an answer made here, not by Node: for the request logs.
pub const ANSWERED_BY: &str = "x-tafac-answered-by";
pub(crate) const ANSWERED_BY_TONAPI: &str = "tonapi";

pub enum Translated {
    // The page's answer, as Node gives it.
    Answer(http::Response<Vec<u8>>),
    // No answer to give: why, for failed.rs to word as Node does.
    Failed(Failure),
    // tonAPI says the university no longer knows the session: over, if the
    // CAS says so too.
    Lost,
}

// What a question without an answer comes to.
pub(crate) fn unanswered(why: Unanswered) -> Translated {
    match why {
        Unanswered::Problem(ErrorCode::SessionExpired) => Translated::Lost,
        why => Translated::Failed(Failure::Unavailable(why.to_string())),
    }
}

// The portal answered for someone: the student the session is for, or
// (never seen, never trusted) another.
pub(crate) fn same_student(profile: &Profile, session: &Session) -> bool {
    profile.username.trim().eq_ignore_ascii_case(session.user.trim())
}

// Nobody's answer: the route's error, and nothing of what the portal said.
pub(crate) fn another_student() -> Translated {
    Translated::Failed(Failure::Unavailable("the portal answers for another name than the session's".to_string()))
}

// A JSON answer with the headers Node's API answers carry that matter to a
// page: its type, never kept, never guessed at.
pub(crate) fn json_answer(body: &serde_json::Value) -> Translated {
    kept_answer(serde_json::to_vec(body).unwrap_or_default())
}

// The same, for an answer already written: one the gateway kept to give
// again (session/memory.rs), as Node gives its own cached one.
pub(crate) fn kept_answer(body: Vec<u8>) -> Translated {
    Translated::Answer(json_response(200, body))
}

// On an answer kept past its freshness and given all the same: the
// university is being asked again behind it (gateway/behind.rs). The page
// shows the answer and asks once more, `?fresh=1`, for the one that comes.
pub const REFRESHING: &str = "x-tafac-refreshing";

pub(crate) fn old_answer(body: Vec<u8>) -> Translated {
    let mut response = json_response(200, body);
    response.headers_mut().insert(REFRESHING, http::HeaderValue::from_static("1"));
    Translated::Answer(response)
}

// The headers every answer of Node's production server carries
// (server/securityHeaders/baseline.ts: BASELINE_HEADERS), which an answer
// made here carries too: no sniffing, no framing by another site, HTTPS
// only. A test below holds them to Node's.
pub(crate) const BASELINE_HEADERS: &[(&str, &str)] = &[
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "SAMEORIGIN"),
    ("content-security-policy", "frame-ancestors 'self'"),
    ("referrer-policy", "strict-origin-when-cross-origin"),
    ("strict-transport-security", "max-age=31536000"),
    ("permissions-policy", "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"),
];

// An answer made here, before its own headers: said to be this crate's, and
// kept out of the search engines as Node's API answers are.
pub(crate) fn answer(status: u16) -> http::response::Builder {
    let mut builder = http::Response::builder().status(status).header("x-robots-tag", "noindex, nofollow, noarchive").header(ANSWERED_BY, ANSWERED_BY_TONAPI);
    for (name, value) in BASELINE_HEADERS {
        builder = builder.header(*name, *value);
    }
    builder
}

// A JSON answer made here, whatever its status.
pub(crate) fn json_response(status: u16, body: Vec<u8>) -> http::Response<Vec<u8>> {
    answer(status).header("content-type", "application/json; charset=utf-8").header("cache-control", "no-store").body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answer_made_here_carries_the_headers_nodes_do() {
        let node = include_str!("../../../../../server/securityHeaders/baseline.ts");
        for (name, value) in BASELINE_HEADERS {
            let said = node.lines().find_map(|line| {
                let (found, written) = line.trim().split_once(':')?;
                found.trim_matches('\'').eq_ignore_ascii_case(name).then(|| written.trim().trim_end_matches(',').to_string())
            });
            let said = said.unwrap_or_else(|| panic!("{name} is no longer one of Node's"));
            assert!(said == format!("'{value}'") || said == format!("\"{value}\""), "{name}: {said}");
        }
        assert_eq!(node.matches("': ").count(), BASELINE_HEADERS.len(), "Node has a header this crate doesn't");

        let response = json_response(200, b"{}".to_vec());
        assert_eq!(response.headers()["x-frame-options"], "SAMEORIGIN");
        assert_eq!(response.headers()["strict-transport-security"], "max-age=31536000");
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(response.headers().get_all("x-content-type-options").iter().count(), 1);
    }
}
