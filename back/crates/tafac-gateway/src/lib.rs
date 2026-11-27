// Tafac's backend in Rust: it signs the student in, holds the session, and
// answers every route of the page's API. On tafac.fr it can run with no
// Node behind it; the apps' bridge still has their own.
//
// The page asks /__ent_auth/* and /__ent_proxy/*. tonAPI
// (github.com/l-ent-univ/tonAPI, in Rust: one provider per software, one
// settings file per university) signs in at the university and reads what
// its services say; Node (server.js), where it is still behind, is told
// when a session ends, and gets what is left (routes.rs says what). This
// crate is where a route moves, once, for every place Tafac runs.
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
//   launch/          the launch relay: a service's sign-in walked with the
//                    CAS ticket, for the browser to finish
//   translate/       one translator per moved route: tonAPI's answer as the
//                    page reads it today, JSON and status, its errors too
//   own/             Tafac's own routes, which ask the university nothing:
//                    the statistics, sent on to PostHog
//   node.rs          Node behind: what it is told, and what the two share
//                    (the User-Agent, whether the statistics are on)
//   universities.rs  tonAPI's settings, from the tonAPI the crate is built
//                    with (build.rs): nothing of tonAPI is copied here
//   portals.rs       what differs from one portal software to another
//   own/             what Tafac answers of its own: the applications'
//                    icons; and tafac.fr's server's, the page's files and
//                    its security headers
//
// And two ways in:
//
//   the apps         call Gateway::answer from their bridge, in the app
//                    itself (src-tauri/src/bridge.rs), then ask their Node
//                    what it leaves (None)
//   tafac.fr         runs the binary (proxy.rs, main.rs), alone or in front
//                    of Node: it answers the same way, and tafac.fr's own
//                    routes (own/: the apps' remote settings, the desktop
//                    update, the page's files); with a Node behind
//                    (TAFAC_GATEWAY_NODE), it passes on what is left
//
// The page doesn't change: /__ent_auth/* stays the only contract.
//
// To move a route: its line in routes.rs, its question in tonapi/, its
// translator in translate/, three lines in gateway/, and its answer
// compared with Node's on a real account.

pub mod own;
pub mod routes;
pub mod session;
pub mod translate;

mod gateway;
mod launch;
mod mail;
mod node;
mod portals;
mod tonapi;
mod universities;

#[cfg(feature = "server")]
pub mod proxy;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use crate::gateway::{Asked, BoxError, ByteStream, Gateway, MailBody, TrustedProxies};
pub use crate::node::{NodeAnswer, NodeRequest, UNIVERSITY_HEADER};
pub use crate::own::analytics::Statistics;
pub use crate::session::cookie::{DEVELOPMENT_COOKIE, PRODUCTION_COOKIE};
pub use crate::translate::{ANSWERED_BY, REFRESHING};
pub use crate::universities::TONAPI_COMMIT;
// For whoever serves the page here: its security headers, as Node's.
#[cfg(feature = "server")]
pub use crate::own::page_headers::page_headers;

#[cfg(test)]
mod tests;
