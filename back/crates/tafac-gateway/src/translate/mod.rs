// The translators: one per moved route (routes.rs).
//
// Each turns what tonAPI said into what the page gets from Node for that
// route today (server/entAuthApp.js): the same JSON, field for field, and the
// same status. Where the answer is one only Node can give (it holds the
// session: it signs in to the portal again, ends an expired session, clears
// its cookie, says so in `X-Tafac-Session`), the translator says Node, and
// the request goes there as it came: an expiry or an error reaches the page
// exactly as before, because it is still Node's.

pub mod account;
pub mod session;

use tonapi_core::{ErrorCode, Profile};

use crate::session_link::NodeSession;

// On an answer made here, not by Node: for the request logs.
pub const ANSWERED_BY: &str = "x-tafac-answered-by";
const ANSWERED_BY_TONAPI: &str = "tonapi";

// Why tonAPI has no answer to translate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Unanswered {
    // tonAPI's own refusal, by its stable code (tonapi-core's ErrorCode).
    Problem(ErrorCode),
    // The university didn't answer in time.
    Slow,
    // The portal answered, and replaced one of the session's cookies: Node,
    // which holds the session, must be the one to get it.
    CookiesChanged,
    // The session holds no cookie of the portal's to ask with.
    NoPortalSession,
    // tonAPI's code gave up halfway (a panic): its request is Node's.
    Failed,
}

impl std::fmt::Display for Unanswered {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unanswered::Problem(code) => write!(formatter, "{code}"),
            Unanswered::Slow => formatter.write_str("the portal is slow to answer"),
            Unanswered::CookiesChanged => formatter.write_str("the portal changed the session's cookies"),
            Unanswered::NoPortalSession => formatter.write_str("no portal session to ask with"),
            Unanswered::Failed => formatter.write_str("tonAPI failed"),
        }
    }
}

pub enum Translated {
    // The page's answer, as Node gives it.
    Answer(http::Response<Vec<u8>>),
    // Node answers. Why, for the log: tonAPI's code or words of this crate,
    // never anything of the account.
    Node(String),
}

// The portal answered for someone: the student the session is for, or
// (never seen, never trusted) another.
pub(crate) fn same_student(profile: &Profile, session: &NodeSession) -> bool {
    profile.username.trim().eq_ignore_ascii_case(session.user.trim())
}

pub(crate) fn another_student() -> Translated {
    Translated::Node("the portal answers for another name than the session's".to_string())
}

// A JSON answer with the headers Node's API answers carry that matter to a
// page: its type, never kept, never guessed at.
pub(crate) fn json_answer(body: &serde_json::Value) -> Translated {
    Translated::Answer(
        http::Response::builder()
            .status(200)
            .header("content-type", "application/json; charset=utf-8")
            .header("cache-control", "no-store")
            .header("x-content-type-options", "nosniff")
            .header("x-robots-tag", "noindex, nofollow, noarchive")
            .header(ANSWERED_BY, ANSWERED_BY_TONAPI)
            .body(serde_json::to_vec(body).unwrap_or_default())
            .unwrap(),
    )
}
