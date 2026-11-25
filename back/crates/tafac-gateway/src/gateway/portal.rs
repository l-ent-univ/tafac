// The routes the portal answers: the session check and the account.
//
// Both are one question to tonAPI (the student's profile, tonapi/profile.rs),
// which the page asks for twice in a row: the session check keeps its
// profile half a minute for the account that follows. An app asks it a
// third time before either, as it starts (check_early), so the page's first
// check waits for nothing.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tonapi_core::Profile;
use tonapi_session::StoredCookie;

use super::Gateway;
use crate::session::cookie::NodeSession;
use crate::session::handed;
use crate::tonapi::{self, Unanswered};
use crate::translate::{self, Translated};
use crate::universities::University;

// How long the profile a session check read stands for the account asked
// after it: the page asks one, then the other.
const PROFILE_KEPT: Duration = Duration::from_secs(30);
// How long the check an app makes as it starts stands for its page's first
// one: the time Node and the page take to start, with room.
pub(crate) const EARLY_KEPT: Duration = Duration::from_secs(20);
// Students whose profile is remembered at once (tafac.fr serves many; an
// app, one).
const REMEMBERED: usize = 10_000;

#[derive(Default)]
pub(crate) struct Portal {
    // By session: the last session check's profile.
    profiles: Mutex<HashMap<String, KeptProfile>>,
    // The check an app makes as it starts, until its page's first one takes
    // it. Locked while it is made: the page's question, if it comes before
    // the portal's answer, waits for it rather than ask a second time.
    pub(crate) early: tokio::sync::Mutex<Option<EarlyCheck>>,
}

struct KeptProfile {
    at: Instant,
    profile: Profile,
}

// The session check an app made as it started.
pub(crate) struct EarlyCheck {
    session: String,
    // The portal cookies it was made with: the session's, at that moment.
    sent: Vec<StoredCookie>,
    pub(crate) at: Instant,
    profile: Result<Profile, Unanswered>,
}

impl Portal {
    fn keep(&self, session: &str, profile: &Profile) {
        let mut profiles = self.profiles.lock().unwrap();
        profiles.retain(|_, kept| kept.at.elapsed() < PROFILE_KEPT);
        if profiles.len() >= REMEMBERED {
            profiles.clear();
        }
        profiles.insert(session.to_string(), KeptProfile { at: Instant::now(), profile: profile.clone() });
    }

    fn kept(&self, session: &str) -> Option<Profile> {
        let profiles = self.profiles.lock().unwrap();
        let kept = profiles.get(session).filter(|kept| kept.at.elapsed() < PROFILE_KEPT)?;
        Some(kept.profile.clone())
    }

    pub(crate) fn forget(&self, session: &str) {
        self.profiles.lock().unwrap().remove(session);
    }
}

impl Gateway {
    // GET /__ent_auth/session (translate/session.rs).
    pub(super) async fn session_check<F, Fut>(&self, university: &University, session: &NodeSession, ask_node: F) -> Translated
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        let sent = handed::portal_cookies(university, session);
        // The check made as the app started, if it was about this very
        // session a moment ago; taken once.
        let early = self.portal.early.lock().await.take();
        let early = early.filter(|check| check.session == session.id && check.sent == sent && check.at.elapsed() < EARLY_KEPT);
        let profile = async {
            match early {
                Some(check) => check.profile,
                None => tonapi::profile::read(university, session, &sent, self.net).await,
            }
        };
        let (profile, facts) = tokio::join!(profile, self.node.facts(&session.university, ask_node));
        let Some(facts) = facts else {
            return Translated::Node("Node didn't say what it is set up for".to_string());
        };
        if let Ok(profile) = &profile {
            self.portal.keep(&session.id, profile);
        }
        translate::session::translate(profile.as_ref().map_err(|why| *why), session, university, facts.analytics_enabled)
    }

    // GET /__ent_auth/account (translate/account.rs).
    pub(super) async fn account(&self, university: &University, session: &NodeSession) -> Translated {
        let profile = match self.portal.kept(&session.id) {
            Some(profile) => Ok(profile),
            None => tonapi::profile::read(university, session, &handed::portal_cookies(university, session), self.net).await,
        };
        translate::account::translate(profile.as_ref().map_err(|why| *why), session)
    }

    // As an app starts: the session check its page is about to ask for,
    // made while Node and the page start, and what Node says of itself
    // (`ask_node`, as answer's: it waits for Node to be up). Nothing when
    // nobody is signed in. Not for a server: it has no start a student
    // waits for.
    pub async fn check_early<F, Fut>(&self, cookie: Option<&str>, ask_node: F)
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<Vec<u8>>>,
    {
        let Some((session, university)) = self.signed_in(cookie) else { return };
        {
            let mut early = self.portal.early.lock().await;
            let sent = handed::portal_cookies(university, &session);
            let profile = tonapi::profile::read(university, &session, &sent, self.net).await;
            if let Err(why) = &profile {
                self.left_to_node(&why.to_string());
            }
            *early = Some(EarlyCheck { session: session.id.clone(), sent, at: Instant::now(), profile });
        }
        let _ = self.node.facts(&session.university, ask_node).await;
    }
}
