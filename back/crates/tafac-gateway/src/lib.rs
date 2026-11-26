// Tafac's backend in Rust: it signs the student in, holds the session, and
// answers what has moved to tonAPI. Node is behind it for the rest.
//
// The page asks /__ent_auth/* and /__ent_proxy/*. tonAPI
// (github.com/l-ent-univ/tonAPI, in Rust: one provider per software, one
// settings file per university) signs in at the university and reads what
// its services say; Node (server.js) still answers the routes that haven't
// moved, with the session made here. This crate is where a route moves,
// once, for every place Tafac runs.
//
// A request goes down this file's list:
//
//   routes.rs        the one table: each route, moved or Node's
//   gateway/         the Gateway: the sign-in and the sign-out, whose
//                    session a request is, the route's question, and a
//                    session the university no longer knows
//   session/         the student's session: its cookie read and written,
//                    what of it tonAPI is handed, what it holds in this
//                    process
//   tonapi/          the questions to tonAPI, one file per thing asked
//   translate/       one translator per moved route: tonAPI's answer as the
//                    page reads it today, JSON and status, its errors too
//   node.rs          Node behind: what it is told, and what the two share
//                    (the User-Agent, whether the statistics are on)
//   universities.rs  tonAPI's settings, from the tonAPI the crate is built
//                    with (build.rs): nothing of tonAPI is copied here
//
// And two ways in:
//
//   the apps         call Gateway::answer from their bridge, in the app
//                    itself (src-tauri/src/bridge.rs), then ask Node
//   tafac.fr         runs the binary in front of Node (proxy.rs, main.rs):
//                    it answers the same way and passes everything else on
//
// The page doesn't change: /__ent_auth/* stays the only contract.
//
// To move a route: its line in routes.rs, its question in tonapi/, its
// translator in translate/, three lines in gateway/, and its answer
// compared with Node's on a real account.

pub mod routes;
pub mod session;
pub mod translate;

mod gateway;
mod node;
mod tonapi;
mod universities;

#[cfg(feature = "server")]
pub mod proxy;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use crate::gateway::{Asked, Gateway, TrustedProxies};
pub use crate::node::{NodeAnswer, NodeRequest, UNIVERSITY_HEADER};
pub use crate::session::cookie::{DEVELOPMENT_COOKIE, PRODUCTION_COOKIE};
pub use crate::translate::ANSWERED_BY;
pub use crate::universities::TONAPI_COMMIT;

#[cfg(test)]
mod tests;
