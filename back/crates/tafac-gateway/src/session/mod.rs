// One student's session, from Node's cookie to what tonAPI is handed.
//
//   cookie.rs   Node's session cookie, read: who it is, at which university,
//               and the university's own cookies. Node alone writes it
//   handed.rs   what of those cookies tonAPI is handed for a question: the
//               portal's for the portal, the CAS ticket for another service
//   memory.rs   what the gateway remembers of a session between two
//               questions: the services' own sessions, the student's
//               component, the answers still good to give again
//
// One sign-in, one session: Node's. Nothing here is written to its cookie,
// and what the gateway remembers lives in this process only.

pub mod cookie;
pub(crate) mod handed;
pub(crate) mod memory;

pub use cookie::{NodeSession, UpstreamCookie};
