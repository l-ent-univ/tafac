// One student's session: its cookie, what tonAPI is handed of it, and what
// this process holds beside it.
//
//   cookie.rs   the session's cookie, read and written: who it is, at which
//               university, and the university's own cookies (the CAS
//               ticket, the portal's session). In the format Node reads
//   handed.rs   what of those cookies tonAPI is handed for a question: the
//               portal's for the portal, the CAS ticket for another service
//   memory.rs   what the session holds in this process: the services' own
//               sessions, the student's component, the answers still good
//               to give again, and the sessions that ended
//
// The gateway makes the session (gateway/signin.rs: tonAPI signs in, the
// cookie is written here) and ends it. Node reads the cookie for the routes
// that are still its own, and keeps the portal's cookies in it up to date.

pub mod cookie;
pub(crate) mod handed;
pub(crate) mod memory;

use std::sync::Arc;

pub use cookie::{Session, UpstreamCookie};

use crate::universities::University;

// A session while a request of its student is answered: what its cookie
// says, its university, and what this process holds of it.
pub(crate) struct Held<'a> {
    pub session: Session,
    pub university: &'a University,
    pub memory: Arc<memory::Remembered>,
}
