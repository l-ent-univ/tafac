// Asking tonAPI: one file per thing asked, and here what they share.
//
//   profile.rs    the portal: who the student is (session check, account)
//   homework.rs   Moodle: what is due
//
// tonAPI's providers are called in this process (no HTTP between the two),
// with a session made for the one question: the cookies of Node's session
// the question is handed (session/handed.rs) and, for a service, what the
// gateway remembers of it (session/memory.rs).
//
// A question either has tonAPI's answer or the reason it has none
// (Unanswered): the route's translator turns the first into Node's answer,
// and the second into « Node answers ».

pub(crate) mod homework;
pub(crate) mod profile;

use std::future::Future;
use std::time::Duration;

use futures_util::FutureExt;
use tonapi_config::{ServiceAvailability, ServiceKind};
use tonapi_core::{ErrorCode, Problem};
use tonapi_providers::{Context, Fetched, NetSettings};
use tonapi_session::SessionData;

use crate::session::cookie::NodeSession;
use crate::session::handed;
use crate::session::memory::{Remembered, Snapshot};
use crate::universities::University;

// How long the portal is waited for before Node is asked instead: the page
// waits on this answer to show anything.
pub(crate) const PORTAL_PATIENCE: Duration = Duration::from_secs(6);
// How long a service is: signing in to Moodle through the federation takes
// a few seconds by itself, and Node asked next would start it all again.
const SERVICE_PATIENCE: Duration = Duration::from_secs(20);
// tonAPI's session wants an end; this one lives for one question.
const SESSION_SECONDS: i64 = 5 * 60;

// Why tonAPI has no answer to translate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Unanswered {
    // tonAPI's own refusal, by its stable code (tonapi-core's ErrorCode).
    Problem(ErrorCode),
    // The university didn't answer in time.
    Slow,
    // The portal answered, and replaced one of its cookies in Node's
    // session: Node, which holds the session, must be the one to get it.
    CookiesChanged,
    // The session holds no cookie of the portal's to ask with.
    NoPortalSession,
    // The session holds no CAS ticket to sign in to a service with.
    NoTicket,
    // tonAPI's code gave up halfway (a panic): its request is Node's.
    Failed,
}

impl std::fmt::Display for Unanswered {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unanswered::Problem(code) => write!(formatter, "{code}"),
            Unanswered::Slow => formatter.write_str("the university is slow to answer"),
            Unanswered::CookiesChanged => formatter.write_str("the university changed the session's cookies"),
            Unanswered::NoPortalSession => formatter.write_str("no portal session to ask with"),
            Unanswered::NoTicket => formatter.write_str("no CAS ticket to ask with"),
            Unanswered::Failed => formatter.write_str("tonAPI failed"),
        }
    }
}

// tonAPI's answer, and how long it says it may be given again without
// asking (None: not at all).
pub(crate) struct Asked<T> {
    pub value: T,
    pub keep_secs: Option<u32>,
}

// One of tonAPI's calls, waited for no longer than `patience`. A panic
// inside a provider is one request left to Node, not a request lost.
pub(crate) async fn bounded<T>(patience: Duration, call: impl Future<Output = T>) -> Result<T, Unanswered> {
    match std::panic::AssertUnwindSafe(tokio::time::timeout(patience, call)).catch_unwind().await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(Unanswered::Slow),
        Err(_) => Err(Unanswered::Failed),
    }
}

fn answered<T>(asked: Result<Result<Fetched<T>, Problem>, Unanswered>) -> Result<T, Unanswered> {
    match asked? {
        Ok(fetched) => Ok(fetched.data),
        Err(problem) => Err(Unanswered::Problem(problem.code)),
    }
}

// tonAPI's session for one question, with these cookies.
pub(crate) fn session_data(university: &University, session: &NodeSession, cookies: Vec<tonapi_session::StoredCookie>) -> Result<SessionData, Unanswered> {
    let now = chrono::Utc::now();
    Ok(SessionData {
        university: session.university.clone(),
        username: session.user.clone(),
        establishment: tonapi_providers::pick_establishment(&university.settings, None).map_err(|problem| Unanswered::Problem(problem.code))?,
        cookies,
        tokens: Default::default(),
        pending: false,
        issued_at: now.timestamp(),
        expires_at: now.timestamp() + SESSION_SECONDS,
    })
}

// A question to one of the university's services (Moodle, ScoDoc, ADE), for
// one session: asked with the CAS ticket and what is remembered of the
// session, which then remembers what the question left.
pub(crate) struct Service<'a> {
    pub university: &'a University,
    pub session: &'a NodeSession,
    pub remembered: &'a Remembered,
    pub net: NetSettings,
}

impl Service<'_> {
    pub(crate) async fn ask<T, F>(&self, kind: ServiceKind, call: F) -> Result<Asked<T>, Unanswered>
    where
        F: AsyncFnOnce(&mut Context<'_>) -> Result<Fetched<T>, Problem>,
    {
        let ticket = handed::cas_cookies(self.university, self.session);
        if ticket.is_empty() {
            return Err(Unanswered::NoTicket);
        }
        let before = self.remembered.snapshot();
        let mut data = session_data(self.university, self.session, ticket.iter().chain(&before.cookies).cloned().collect())?;
        data.tokens = before.tokens.clone();
        if before.detected {
            if let Some(component) = &before.component {
                data.establishment = Some(component.clone());
            }
        } else if self.university.differs_by_component(kind) {
            data = self.detect(data, &before, &ticket).await?;
        }

        let settings = &self.university.settings;
        let services = settings.services_for(data.establishment.as_ref().map(|component| component.id.as_str()));
        let mut context = Context { university: settings, session: &mut data, now: chrono::Utc::now(), net: self.net };
        let asked = bounded(SERVICE_PATIENCE, call(&mut context)).await;
        // What the question left is kept even when it has no answer: a
        // session the service refused is no longer handed back.
        self.remembered.keep(&before, &data, &ticket);
        Ok(Asked { value: answered(asked)?, keep_secs: tonapi_providers::keep_secs(&services, kind) })
    }

    // The student's component (an IUT, a faculty), which decides where some
    // services are: tonAPI asks the university for it, once per session.
    async fn detect(&self, data: SessionData, before: &Snapshot, ticket: &[tonapi_session::StoredCookie]) -> Result<SessionData, Unanswered> {
        let detecting = tonapi_providers::with_detected_establishment(&self.university.settings, data, chrono::Utc::now(), self.net);
        let data = bounded(SERVICE_PATIENCE, detecting).await?;
        self.remembered.keep(before, &data, ticket);
        self.remembered.detected(data.establishment.clone());
        Ok(data)
    }
}

impl University {
    // Whether a service isn't the same for every component of the
    // university: only then is the student's worth looking for.
    pub(crate) fn differs_by_component(&self, kind: ServiceKind) -> bool {
        let of = |component: Option<&str>| -> Option<ServiceAvailability> {
            self.settings.services_for(component).availability().into_iter().find_map(|(found, how)| (found == kind).then_some(how))
        };
        let everyone = of(None);
        self.settings.establishments.keys().any(|component| of(Some(component.as_str())) != everyone)
    }
}
