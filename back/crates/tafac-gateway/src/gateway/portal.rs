// The routes the portal answers: the session check and the account.
//
// Both are one question to tonAPI (the student's profile, tonapi/profile.rs),
// which the page asks for twice in a row: the session keeps the profile half
// a minute for the account that follows (a sign-in reads it too). An app
// asks it a third time before either, as it starts (check_early), so the
// page's first check waits for nothing.
//
// The portal's own session is the one thing of a session Node keeps up: its
// portal requests (/__ent_proxy, the applications) go with its own copy of
// the cookies. So the question is asked with the portal's cookies and never
// the CAS ticket (session/handed.rs), and a portal that no longer knows the
// session is Node's to sign in to again, unless the CAS says the whole
// session is over (mod.rs).

use std::future::Future;
use std::time::{Duration, Instant};

use tonapi_core::Profile;
use tonapi_session::StoredCookie;

use super::Gateway;
use crate::node::{NodeAnswer, NodeRequest};
use crate::session::{handed, Held};
use crate::tonapi::{self, Unanswered};
use crate::translate::{self, Translated};

// How long the check an app makes as it starts stands for its page's first
// one: the time Node and the page take to start, with room.
pub(crate) const EARLY_KEPT: Duration = Duration::from_secs(20);

// The check an app makes as it starts, until its page's first one takes
// it. Locked while it is made: the page's question, if it comes before the
// portal's answer, waits for it rather than ask a second time.
#[derive(Default)]
pub(crate) struct Early {
    pub(crate) check: tokio::sync::Mutex<Option<EarlyCheck>>,
}

// The session check an app made as it started.
pub(crate) struct EarlyCheck {
    session: String,
    // The portal cookies it was made with: the session's, at that moment.
    sent: Vec<StoredCookie>,
    pub(crate) at: Instant,
    profile: Result<Profile, Unanswered>,
}

impl Gateway {
    // GET /__ent_auth/session (translate/session.rs).
    pub(super) async fn session_check<N, Fut>(&self, held: &Held<'_>, node: &N) -> Translated
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let Held { session, university, memory } = held;
        let sent = handed::portal_cookies(university, session);
        // The check made as the app started, if it was about this very
        // session a moment ago; taken once.
        let early = self.early.check.lock().await.take();
        let early = early.filter(|check| check.session == session.id && check.sent == sent && check.at.elapsed() < EARLY_KEPT);
        let profile = async {
            match early {
                Some(check) => check.profile,
                None => tonapi::profile::read(university, session, &sent, self.net).await,
            }
        };
        let (profile, facts) = tokio::join!(profile, self.node.facts(&session.university, node));
        let Some(facts) = facts else {
            return Translated::Node("Node didn't say what it is set up for".to_string());
        };
        if let Ok(profile) = &profile {
            memory.keep_profile(profile);
        }
        translate::session::translate(profile.as_ref().map_err(|why| *why), session, university, facts.analytics_enabled)
    }

    // GET /__ent_auth/account (translate/account.rs).
    pub(super) async fn account(&self, held: &Held<'_>) -> Translated {
        let Held { session, university, memory } = held;
        let profile = match memory.profile() {
            Some(profile) => Ok(profile),
            None => tonapi::profile::read(university, session, &handed::portal_cookies(university, session), self.net).await,
        };
        translate::account::translate(profile.as_ref().map_err(|why| *why), session)
    }

    // As an app starts: the session check its page is about to ask for,
    // made while Node and the page start, and what Node says of itself
    // (`node`, as answer's: it waits for Node to be up). Nothing when
    // nobody is signed in. Not for a server: it has no start a student
    // waits for.
    pub async fn check_early<N, Fut>(&self, cookie: Option<&str>, node: N)
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let Some(held) = self.signed_in(cookie) else { return };
        let Held { session, university, .. } = &held;
        {
            let mut early = self.early.check.lock().await;
            let sent = handed::portal_cookies(university, session);
            let profile = tonapi::profile::read(university, session, &sent, self.net).await;
            if let Err(why) = &profile {
                self.left_to_node(&why.to_string());
            }
            // A portal that no longer knows the session: the CAS is asked
            // ahead too whether the session is over, and its « no » kept.
            if profile == Err(Unanswered::Problem(tonapi_core::ErrorCode::SessionExpired)) {
                let _ = self.cas_still_knows(&held).await;
            }
            *early = Some(EarlyCheck { session: session.id.clone(), sent, at: Instant::now(), profile });
        }
        let _ = self.node.facts(&session.university, &node).await;
    }
}
