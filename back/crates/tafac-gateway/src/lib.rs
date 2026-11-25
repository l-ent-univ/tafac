// Tafac's gateway: the routes tonAPI answers, in front of the Node server.
//
// The page asks /__ent_auth/* and /__ent_proxy/*. The Node server
// (server.js) answers them all in JavaScript; tonAPI
// (github.com/l-ent-univ/tonAPI, in Rust: one provider per software, one
// settings file per university) takes them over a route at a time. This
// crate is where a route moves, once, for every place Tafac runs.
//
// A request goes down this file's list:
//
//   routes.rs        the one table: each route, tonAPI's or Node's
//   gateway/         the Gateway: who is signed in, the route's question,
//                    and the answer only if it is the one Node would give
//   session/         the student's session: Node's cookie read, what of it
//                    tonAPI is handed, what is remembered between questions
//   tonapi/          the questions to tonAPI, one file per thing asked
//   translate/       one translator per moved route: tonAPI's answer as the
//                    page gets it from Node, JSON and status
//   node.rs          Node seen from here: what it says of itself, the
//                    sessions it ended
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

pub use crate::gateway::Gateway;
pub use crate::node::{SESSION_PATH, UNIVERSITY_HEADER};
pub use crate::session::cookie::{DEVELOPMENT_COOKIE, PRODUCTION_COOKIE};
pub use crate::translate::ANSWERED_BY;
pub use crate::universities::TONAPI_COMMIT;

#[cfg(test)]
mod tests;
