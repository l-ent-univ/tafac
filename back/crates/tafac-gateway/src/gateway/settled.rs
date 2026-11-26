// The routes answered to their end here: the launch relay and its preview,
// Moodle's view, the student's photo, the school certificate.
//
// For a session the gateway holds, none of their answers is Node's: a
// failure is worded here, in what the page reads for that route
// (translate/settled.rs). Each goes the same way:
//
//   a session that ended    found expired a moment ago, its cookie still
//                           shown: told so (the relay answers it as it
//                           answers nobody, with the word that it expired)
//   the route               gateway/launch.rs, gateway/student.rs
//   a session that is lost  tonAPI says the university no longer knows it,
//                           or the CAS showed its login form: the CAS is
//                           asked, and the session ends here when it is
//                           over (mod.rs); when it isn't, the route's own
//                           answer
//
// Node is still behind for who isn't held: nobody signed in (the gateway
// doesn't know which university an address is for), the demo account,
// another university.

use std::future::Future;

use super::{now_ms, Asked, Gateway};
use crate::node::{NodeAnswer, NodeRequest};
use crate::routes::Moved;
use crate::session::memory::Ended;
use crate::translate;
use crate::translate::settled::Settled;

impl Gateway {
    // Whether a route is one of these.
    pub(super) fn settles(route: Moved) -> bool {
        matches!(route, Moved::Launch | Moved::LaunchPreview | Moved::MoodleView | Moved::StudentPicture | Moved::CertificateStatus | Moved::Certificate)
    }

    // The answer to one of them. `value`: the session's cookie as the
    // request came with it; `cookie`: as the caller holds it now. None:
    // Node's (nobody the gateway holds a session for).
    pub(super) async fn settled<C, N, Fut>(&self, route: Moved, asked: &Asked<'_>, value: &str, cookie: &C, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        C: Fn() -> Option<String>,
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if let Some(told) = self.ended_already(route, asked, value, node).await {
            return Some(told);
        }
        let held = self.signed_in(Some(value))?;
        let settled = match route {
            Moved::Launch => self.launch(&held, asked).await,
            Moved::LaunchPreview => self.launch_preview(&held, asked).await,
            Moved::MoodleView => Settled::Answer(translate::moodle_view::translate(held.university)),
            Moved::StudentPicture => self.student_picture(&held, asked.query).await,
            Moved::CertificateStatus => self.certificate_status(&held).await,
            Moved::Certificate => self.certificate(&held).await,
            _ => return None,
        };
        let response = match settled {
            Settled::Answer(response) => response,
            Settled::Lost { otherwise } => match self.lost(route, &held, value, node).await {
                // The relay is opened as a page: to the login form, which
                // says why, rather than the JSON the other routes answer.
                Some(over) if route == Moved::Launch => return Some(translate::launch::expired(&over)),
                Some(over) => return Some(over),
                None => otherwise,
            },
        };
        // Signed out, or in again, while the university was asked: the
        // session this answer is about is no longer the one there is.
        let still = self.signed_in(cookie().as_deref()).is_some_and(|current| current.session.id == held.session.id);
        still.then_some(response)
    }

    // A request that still shows the cookie of a session found expired
    // here. The relay and its preview answer it as they answer nobody, as
    // Node does (the browser goes to the service, which asks to sign in),
    // with the word that the session expired; the other routes say what
    // every route says (mod.rs).
    async fn ended_already<N, Fut>(&self, route: Moved, asked: &Asked<'_>, value: &str, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if !matches!(route, Moved::Launch | Moved::LaunchPreview) {
            return self.found_expired_already(route, value, node).await;
        }
        let session = self.codec.read(value, now_ms())?;
        if self.memory.ended(&session.id) != Some(Ended::Expired) {
            return None;
        }
        let university = self.universities.get(&session.university)?;
        let for_nobody = match route {
            Moved::Launch => Self::launch_for_nobody(university, asked),
            _ => Self::preview_for_nobody(university, asked),
        };
        Some(translate::launch::told_expired(for_nobody))
    }
}
