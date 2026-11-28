// Asking tonAPI: one file per thing asked, and here what they share.
//
//   signin.rs     the CAS: a student signed in, signed out, and whether it
//                 still knows a session
//   profile.rs    the portal: who the student is (session check, account)
//   apps.rs       the portal: the applications it lists
//   homework.rs   Moodle: what is due
//   grades.rs     ScoDoc: the report, a department's notice, a distribution,
//                 the PDF
//   picture.rs    ScoDoc: the student's photo
//   documents.rs  the school records: the documents listed, the file of one
//   timetable.rs  the planning (ADE, TEMPO): the classes of a range, the
//                 tree of groups, teachers and rooms, the ones searched for.
//                 Their answers go to the page as tonAPI gives them, its
//                 refusals too (gateway/planning.rs)
//
// tonAPI's providers are called in this process (no HTTP between the two),
// with a session made for the one question: the cookies of the student's
// session the question is handed (session/handed.rs) and, for a service,
// what the session holds of it in this process (session/memory.rs).
//
// A question either has tonAPI's answer or the reason it has none
// (Unanswered): the route's translator turns the first into the page's
// answer, and the second into the route's error, or into « the session is
// lost » for the gateway to ask the CAS about.

pub(crate) mod apps;
pub(crate) mod documents;
pub(crate) mod grades;
pub(crate) mod homework;
pub(crate) mod picture;
pub(crate) mod profile;
pub(crate) mod signin;
pub(crate) mod timetable;

use std::future::Future;
use std::time::Duration;

use futures_util::FutureExt;
use tonapi_config::{ServiceAvailability, ServiceKind};
use tonapi_core::{ErrorCode, EstablishmentSource, Problem};
use tonapi_providers::{Context, Fetched, NetSettings};
use tonapi_session::{EstablishmentPick, SessionData};

use crate::session::cookie::Session;
use crate::session::memory::Turn;
use crate::session::{handed, Held};
use crate::universities::University;

// How long the portal is waited for before the route fails. The page waits
// on this answer to show anything, and nobody asks a second time: a slow
// portal is waited for rather than said to be down.
pub(crate) const PORTAL_PATIENCE: Duration = Duration::from_secs(15);
// How long a service is: signing in to Moodle through the federation takes
// a few seconds by itself.
const SERVICE_PATIENCE: Duration = Duration::from_secs(20);
// How long a look for the student's component waits, for ADE's turn and
// for ADE: ADE answers it in a second when it is up.
const LOOK_PATIENCE: Duration = if cfg!(test) { Duration::from_secs(2) } else { Duration::from_secs(10) };
// tonAPI's session wants an end; this one lives for one question.
const SESSION_SECONDS: i64 = 5 * 60;

// Why tonAPI has no answer to translate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Unanswered {
    // tonAPI's own refusal, by its stable code (tonapi-core's ErrorCode).
    Problem(ErrorCode),
    // The university didn't answer in time.
    Slow,
    // The portal answered, and replaced one of its cookies in the session:
    // Node, whose portal requests go with those cookies, must be the one to
    // get the new one. The question is asked again with a portal session
    // of the gateway's own (gateway/portal.rs).
    CookiesChanged,
    // The session holds no cookie of the portal's to ask with.
    NoPortalSession,
    // The session holds no CAS ticket to sign in to a service with.
    NoTicket,
    // tonAPI's code gave up halfway (a panic): its request fails.
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
// inside a provider is one route's error, not a request lost.
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
pub(crate) fn session_data(university: &University, session: &Session, cookies: Vec<tonapi_session::StoredCookie>) -> Result<SessionData, Unanswered> {
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
// one session: asked with the CAS ticket and what the session holds of the
// service, which then holds what the question left.
pub(crate) struct Service<'a> {
    pub held: &'a Held<'a>,
    pub net: NetSettings,
}

// tonAPI's answer to a question as it gave it: its data and the provider
// that answered, or its refusal with its words and its link. For the routes
// that give the page tonAPI's own answers (gateway/planning.rs).
pub(crate) struct Said<T> {
    pub said: Result<Fetched<T>, Problem>,
    pub keep_secs: Option<u32>,
}

impl Service<'_> {
    pub(crate) async fn ask<T, F>(&self, kind: ServiceKind, call: F) -> Result<Asked<T>, Unanswered>
    where
        F: AsyncFnOnce(&mut Context<'_>) -> Result<Fetched<T>, Problem>,
    {
        let Said { said, keep_secs } = self.ask_as_said(kind, call).await?;
        match said {
            Ok(fetched) => Ok(Asked { value: fetched.data, keep_secs }),
            Err(problem) => Err(Unanswered::Problem(problem.code)),
        }
    }

    // The same question, tonAPI's refusal kept as it said it.
    pub(crate) async fn ask_as_said<T, F>(&self, kind: ServiceKind, call: F) -> Result<Said<T>, Unanswered>
    where
        F: AsyncFnOnce(&mut Context<'_>) -> Result<Fetched<T>, Problem>,
    {
        let Held { session, university, memory } = self.held;
        let ticket = handed::cas_cookies(university, session);
        if ticket.is_empty() {
            return Err(Unanswered::NoTicket);
        }
        if memory.snapshot().look_due && university.differs_by_component(kind) {
            self.detect(kind, &ticket).await?;
        }
        if kind == ServiceKind::Grades && memory.snapshot().probe_due {
            self.probe(&ticket).await?;
        }
        let before = memory.snapshot();
        let mut data = session_data(university, session, ticket.iter().chain(&before.cookies).cloned().collect())?;
        data.tokens = before.tokens.clone();
        if before.detected {
            if let Some(component) = &before.component {
                data.establishment = Some(component.clone());
            }
        }

        let settings = &university.settings;
        let services = settings.services_for(data.establishment.as_ref().map(|component| component.id.as_str()));
        let mut context = Context { university: settings, session: &mut data, now: chrono::Utc::now(), net: self.net };
        let asked = bounded(SERVICE_PATIENCE, call(&mut context)).await;
        // What the question left is kept even when it has no answer: a
        // session the service refused is no longer handed back.
        memory.keep(&before, &data, &ticket);
        Ok(Said { said: asked?, keep_secs: tonapi_providers::keep_secs(&services, kind) })
    }

    // The student's component (an IUT, a faculty), which decides where some
    // services are. A sign-in made here found it already; for a session made
    // elsewhere (the app or the server started again since the sign-in, a
    // session of Node's) tonAPI asks the university for it, kept once it
    // knows. The memory holds it, not the cookie: every process that starts
    // again looks for it again, at the first question that needs it.
    //
    //   one look at a time  the home page's questions come together (the
    //                       grades, the photo, the absences): one looks,
    //                       the others wait and find what it found
    //   ADE's turn          the component is read in ADE's tree, whose
    //                       session is the planning's too: the planning
    //                       isn't asked at the same moment (two sessions of
    //                       ADE's opened at once, one undoing the other)
    //   a look that failed  the portal or ADE didn't answer, or not in
    //                       time, or the CAS refused the ticket: nothing
    //                       kept. The CAS's refusal is the question's (the
    //                       session is lost); otherwise the question, and
    //                       the session's others for LOOK_AGAIN_AFTER, are
    //                       asked with the default component, then one
    //                       looks again: a service that doesn't answer is
    //                       not waited for by every question
    //
    // Found, or the university answered without the student matching any
    // component: kept, never looked for again (as before).
    async fn detect(&self, kind: ServiceKind, ticket: &[tonapi_session::StoredCookie]) -> Result<(), Unanswered> {
        let Held { session, university, memory } = self.held;
        // ADE's turn first, then the component's: the planning, which holds
        // its own turn, may ask for the component too.
        let failed = |why: &str| {
            eprintln!("[tafac] tonapi: the student's component wasn't found ({why}), looked for again in a while");
            memory.look_failed()
        };
        let _ade = if kind == ServiceKind::Timetable {
            None
        } else {
            // A planning question that waits on a hung ADE holds its turn.
            match tokio::time::timeout(LOOK_PATIENCE, memory.turn(Turn::Service(ServiceKind::Timetable))).await {
                Ok(turn) => Some(turn),
                Err(_) => return Ok(failed("ADE busy")),
            }
        };
        let _looking = memory.turn(Turn::Component).await;
        // Another question found it, or failed to, while this one waited.
        let before = memory.snapshot();
        if !before.look_due {
            return Ok(());
        }
        let mut data = session_data(university, session, ticket.iter().chain(&before.cookies).cloned().collect())?;
        data.tokens = before.tokens.clone();
        let looking = tonapi_providers::look_for_establishment(&university.settings, data, chrono::Utc::now(), self.net);
        let (data, looked) = match bounded(LOOK_PATIENCE, looking).await {
            Ok(done) => done,
            Err(_) => return Ok(failed("no answer in time")),
        };
        memory.keep(&before, &data, ticket);
        match looked {
            Ok(()) => memory.detected(data.establishment.clone()),
            Err(problem) if problem.code == ErrorCode::SessionExpired => return Err(Unanswered::Problem(problem.code)),
            Err(problem) => failed(&problem.code.to_string()),
        }
        Ok(())
    }

    // The look failed (ADE down, or too slow): the grades are one
    // component's alone (Rennes's IUT), and its ScoDoc knows its students.
    // Asked for the student's report there, as of that component: a report
    // says the student is of it, kept as if the look had found it. Anything
    // else (ScoDoc's error to a student it doesn't know, no answer) says
    // nothing: the question goes with the default component, and the probe
    // waits LOOK_AGAIN_AFTER. Not the photo: a gateway may give an image to
    // anyone; a report is the student's own.
    async fn probe(&self, ticket: &[tonapi_session::StoredCookie]) -> Result<(), Unanswered> {
        let Held { session, university, memory } = self.held;
        let Some(component) = university.only_component_with(ServiceKind::Grades) else {
            return Ok(());
        };
        let _looking = memory.turn(Turn::Component).await;
        let before = memory.snapshot();
        if !before.probe_due {
            return Ok(());
        }
        let pick = EstablishmentPick { id: component, source: EstablishmentSource::Detected, confidence: 0.5 };
        let mut data = session_data(university, session, ticket.iter().chain(&before.cookies).cloned().collect())?;
        data.tokens = before.tokens.clone();
        data.establishment = Some(pick.clone());
        let mut context = Context { university: &university.settings, session: &mut data, now: chrono::Utc::now(), net: self.net };
        let asked = bounded(SERVICE_PATIENCE, tonapi_providers::grades_and_absences_of(&mut context, None)).await;
        let report = match asked {
            Ok((report, _)) => report,
            Err(_) => {
                eprintln!("[tafac] tonapi: the student's component wasn't found by their report either (no answer in time)");
                memory.probe_failed();
                return Ok(());
            }
        };
        memory.keep(&before, &data, ticket);
        match report {
            Ok(_) => memory.detected(Some(pick)),
            Err(problem) if problem.code == ErrorCode::SessionExpired => return Err(Unanswered::Problem(problem.code)),
            Err(problem) => {
                eprintln!("[tafac] tonapi: the student's component wasn't found by their report either ({})", problem.code);
                memory.probe_failed();
            }
        }
        Ok(())
    }
}

impl University {
    fn availability(&self, component: Option<&str>, kind: ServiceKind) -> Option<ServiceAvailability> {
        self.settings.services_for(component).availability().into_iter().find_map(|(found, how)| (found == kind).then_some(how))
    }

    // Whether a service isn't the same for every component of the
    // university: only then is the student's worth looking for.
    pub(crate) fn differs_by_component(&self, kind: ServiceKind) -> bool {
        let everyone = self.availability(None, kind);
        self.settings.establishments.keys().any(|component| self.availability(Some(component.as_str()), kind) != everyone)
    }

    // The one component whose students have this service from tonAPI,
    // when the others haven't (Rennes's IUT and its ScoDoc).
    pub(crate) fn only_component_with(&self, kind: ServiceKind) -> Option<String> {
        let served = |component: Option<&str>| matches!(self.availability(component, kind), Some(ServiceAvailability::Api { .. }));
        if served(None) {
            return None;
        }
        let mut with = self.settings.establishments.keys().filter(|component| served(Some(component.as_str())));
        let one = with.next()?;
        with.next().is_none().then(|| one.clone())
    }
}
