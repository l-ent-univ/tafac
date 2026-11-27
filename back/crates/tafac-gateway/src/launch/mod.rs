// The launch relay: one of the university's services opened signed in.
//
// A tile of the page, a deadline, Moodle's view in the apps: each opens a
// service that sits behind the CAS. The student's browser has no session
// there (the CAS ticket is in the session's cookie, which only the gateway
// reads), so the gateway makes the first steps of the sign-in for it, with
// the ticket, and sends the browser to where the CAS sends it: the service,
// with a service ticket that signs in once.
//
//   targets.rs   which addresses it may ask, and send the browser to: the
//                university's own services, over https
//   site.rs      a request another site started is not the student asking
//   walk.rs      the steps: the chain followed for the page's preview, and
//                for the launch itself
//   moodle.rs    Moodle behind the federation (Shibboleth): the chain as
//                far as the form the browser posts
//   html.rs      what a page of a chain says of where to go next
//   page.rs      the page that hands a form to the browser
//   tickets.rs   a service ticket's value never goes to the page
//
// It is Tafac's own (Node's was server/entAuthApp.js, server/launchRelay/,
// server/launchTargets.js), not a university's software: tonAPI gives its
// browser (a jar, one request at a time) and its settings, nothing else.
// The routes are in gateway/launch.rs, their answers in translate/launch.rs.

pub(crate) mod html;
pub(crate) mod moodle;
pub(crate) mod page;
pub(crate) mod site;
pub(crate) mod targets;
pub(crate) mod tickets;
pub(crate) mod walk;

use tonapi_http::{Browser, BrowserOptions, CookieJar};
use tonapi_providers::NetSettings;
use tonapi_session::StoredCookie;

// A browser for one walk, with the CAS's cookies of the session (its
// ticket) and no other: thrown away after. None when it can't be made.
pub(crate) fn browser(ticket: Vec<StoredCookie>, net: NetSettings) -> Option<Browser> {
    let options = BrowserOptions { https_only: net.https_only, user_agent: net.user_agent, ..BrowserOptions::default() };
    Browser::new(&options, CookieJar::from_stored(ticket)).ok()
}
