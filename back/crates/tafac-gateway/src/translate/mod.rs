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
pub mod moodle_deadlines;
pub mod session;

use tonapi_core::Profile;

use crate::session::cookie::NodeSession;
pub use crate::tonapi::Unanswered;

// On an answer made here, not by Node: for the request logs.
pub const ANSWERED_BY: &str = "x-tafac-answered-by";
const ANSWERED_BY_TONAPI: &str = "tonapi";

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
    kept_answer(serde_json::to_vec(body).unwrap_or_default())
}

// The same, for an answer already written: one the gateway kept to give
// again (session/memory.rs), as Node gives its own cached one.
pub(crate) fn kept_answer(body: Vec<u8>) -> Translated {
    Translated::Answer(
        http::Response::builder()
            .status(200)
            .header("content-type", "application/json; charset=utf-8")
            .header("cache-control", "no-store")
            .header("x-content-type-options", "nosniff")
            .header("x-robots-tag", "noindex, nofollow, noarchive")
            .header(ANSWERED_BY, ANSWERED_BY_TONAPI)
            .body(body)
            .unwrap(),
    )
}
