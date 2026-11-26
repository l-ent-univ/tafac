// What a session holds in this process, beside its cookie.
//
// The cookie is what a session starts again from: the CAS ticket and the
// portal's cookies (cookie.rs). What tonAPI gets from the university while
// it answers is kept here, with the session's id, as Node keeps its own
// (runtimeSessions):
//
//   the services' sessions   the cookies and tokens tonAPI got from a
//                            service (MoodleSession, its sesskey…), handed
//                            back with the next question. The portal's
//                            among them, once tonAPI opened one of its own
//                            (the applications, or a session check after
//                            the cookie's own portal session lapsed)
//   the student's component  found at the sign-in, or at the first question
//                            that needs it (tonAPI asks the university)
//   the student's profile    half a minute: the page asks who is signed in,
//                            then for the account
//   the answers              each kept as long as tonAPI says it may be
//                            (its `keep_secs`: the settings' cache-ttl-secs)
//   the CAS's word           that it still knew the ticket, a minute
//
// Not in the cookie: two questions asked at once would each write it, one
// undoing the other, and a browser drops a cookie past 4 kB. A process
// that starts again signs in to the services again, with the ticket.
//
// It goes with the session (signed out, expired: `ended` says so to any
// request still on its way with the cookie) or after an hour unused. The
// CAS ticket's own value says nothing of whose it is: the CAS writes it
// anew each time someone signs in to a service, for the same session.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tonapi_config::ServiceKind;
use tonapi_core::Profile;
use tonapi_session::{EstablishmentPick, SessionData, StoredCookie};

use crate::session::handed::same_cookie;

// How long a session's memory outlives its last question (Node's
// MOODLE_CONTEXT_TTL_MS: an hour).
const UNUSED_KEPT: Duration = Duration::from_secs(60 * 60);
// Sessions remembered at once (tafac.fr serves many; an app, one).
const REMEMBERED: usize = 10_000;
// Answers kept for one session: one per route and what it was asked.
const ANSWERS_KEPT: usize = 64;
// How long the profile read for a session check stands for the account
// asked after it: the page asks one, then the other.
const PROFILE_KEPT: Duration = Duration::from_secs(30);
// How long the CAS's « I know this ticket » is taken as said: a service
// down for a while doesn't send the CAS a question at each of its failures
// (Node's DEFAULT_VALID_FOR_MS).
const CAS_WORD_KEPT: Duration = Duration::from_secs(60);
// How long a session that ended is remembered as ended (Node's
// ENDED_KEPT_MS): past any request still on its way with its cookie.
const ENDED_KEPT: Duration = Duration::from_secs(60 * 60);

// Why a session ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Ended {
    SignedOut,
    // The CAS no longer knows its ticket.
    Expired,
}

#[derive(Default)]
pub(crate) struct Memory {
    sessions: Mutex<HashMap<String, Arc<Remembered>>>,
    ended: Mutex<HashMap<String, (Ended, Instant)>>,
}

// Whose turn it is: one question at a time to each service of a session,
// and to the CAS about its ticket.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Turn {
    Service(ServiceKind),
    Cas,
}

// One session's memory.
pub(crate) struct Remembered {
    state: Mutex<State>,
    // A second question waits for the first, then finds its answer kept.
    turns: Mutex<HashMap<Turn, Arc<tokio::sync::Mutex<()>>>>,
}

struct State {
    used: Instant,
    cookies: Vec<StoredCookie>,
    tokens: BTreeMap<String, String>,
    component: Option<EstablishmentPick>,
    // The component was looked for: found or not, not twice.
    detected: bool,
    answers: HashMap<String, KeptAnswer>,
    profile: Option<(Instant, Profile)>,
    // When the CAS last said it knew the ticket.
    cas_knew: Option<Instant>,
    // tonAPI opened a portal session of its own for this session, which is
    // among the cookies above: the portal is asked with it from then on.
    portal_opened: bool,
}

struct KeptAnswer {
    until: Instant,
    body: Vec<u8>,
}

// What a question starts from: the memory as it was then.
#[derive(Clone, Default)]
pub(crate) struct Snapshot {
    pub cookies: Vec<StoredCookie>,
    pub tokens: BTreeMap<String, String>,
    pub component: Option<EstablishmentPick>,
    pub detected: bool,
}

impl Memory {
    // The memory of a session (by its id): a new one when there is none,
    // or when the one there is went an hour unused.
    pub(crate) fn of(&self, session: &str) -> Arc<Remembered> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(remembered) = sessions.get(session) {
            if remembered.state.lock().unwrap().used.elapsed() < UNUSED_KEPT {
                return remembered.clone();
            }
        }
        sessions.retain(|_, remembered| remembered.state.lock().unwrap().used.elapsed() < UNUSED_KEPT);
        if sessions.len() >= REMEMBERED {
            sessions.clear();
        }
        let remembered = Arc::new(Remembered {
            state: Mutex::new(State {
                used: Instant::now(),
                cookies: Vec::new(),
                tokens: BTreeMap::new(),
                component: None,
                detected: false,
                answers: HashMap::new(),
                profile: None,
                cas_knew: None,
                portal_opened: false,
            }),
            turns: Mutex::new(HashMap::new()),
        });
        sessions.insert(session.to_string(), remembered.clone());
        remembered
    }

    // The session ended: nothing of it stays, and a copy of its cookie is
    // worth nothing from now on. Whether this ended it: false when it had
    // ended already (two requests found it expired together: one ends it).
    pub(crate) fn end(&self, session: &str, why: Ended) -> bool {
        self.sessions.lock().unwrap().remove(session);
        let mut ended = self.ended.lock().unwrap();
        ended.retain(|_, (_, at)| at.elapsed() < ENDED_KEPT);
        if ended.contains_key(session) {
            return false;
        }
        if ended.len() >= REMEMBERED {
            ended.clear();
        }
        ended.insert(session.to_string(), (why, Instant::now()));
        true
    }

    // Why a session ended, when it did, lately.
    pub(crate) fn ended(&self, session: &str) -> Option<Ended> {
        let ended = self.ended.lock().unwrap();
        ended.get(session).filter(|(_, at)| at.elapsed() < ENDED_KEPT).map(|(why, _)| *why)
    }

    #[cfg(test)]
    pub(crate) fn remembers(&self, session: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(session)
    }
}

impl Remembered {
    // This question's turn: held until it is answered.
    pub(crate) async fn turn(&self, turn: Turn) -> tokio::sync::OwnedMutexGuard<()> {
        let turn = self.turns.lock().unwrap().entry(turn).or_default().clone();
        turn.lock_owned().await
    }

    pub(crate) fn snapshot(&self) -> Snapshot {
        let mut state = self.state.lock().unwrap();
        state.used = Instant::now();
        Snapshot { cookies: state.cookies.clone(), tokens: state.tokens.clone(), component: state.component.clone(), detected: state.detected }
    }

    // What a question left in tonAPI's session, kept for the next one: what
    // it added or changed since `before`, and no longer what it took away.
    // The cookies handed from the session's own cookie (`handed`: the CAS
    // ticket, the portal's) stay where they are, in the cookie.
    // Two questions to two services may cross: each keeps its own.
    pub(crate) fn keep(&self, before: &Snapshot, after: &SessionData, handed: &[StoredCookie]) {
        let mut state = self.state.lock().unwrap();
        let ours = |cookie: &StoredCookie| !handed.iter().any(|other| same_cookie(other, cookie));
        for gone in before.cookies.iter().filter(|cookie| !after.cookies.iter().any(|other| same_cookie(other, cookie))) {
            state.cookies.retain(|cookie| !same_cookie(cookie, gone));
        }
        for cookie in after.cookies.iter().filter(|cookie| ours(cookie)) {
            if before.cookies.contains(cookie) {
                continue;
            }
            state.cookies.retain(|other| !same_cookie(other, cookie));
            state.cookies.push(cookie.clone());
        }
        for gone in before.tokens.keys().filter(|name| !after.tokens.contains_key(*name)) {
            state.tokens.remove(gone);
        }
        for (name, value) in &after.tokens {
            if before.tokens.get(name) != Some(value) {
                state.tokens.insert(name.clone(), value.clone());
            }
        }
    }

    // The component, once looked for.
    pub(crate) fn detected(&self, component: Option<EstablishmentPick>) {
        let mut state = self.state.lock().unwrap();
        state.component = component;
        state.detected = true;
    }

    // An answer kept, while it is still good to give again.
    pub(crate) fn answer(&self, key: &str) -> Option<Vec<u8>> {
        let state = self.state.lock().unwrap();
        let kept = state.answers.get(key).filter(|kept| Instant::now() < kept.until)?;
        Some(kept.body.clone())
    }

    pub(crate) fn keep_answer(&self, key: &str, seconds: u32, body: &[u8]) {
        let mut state = self.state.lock().unwrap();
        let now = Instant::now();
        state.answers.retain(|_, kept| now < kept.until);
        if state.answers.len() >= ANSWERS_KEPT {
            state.answers.clear();
        }
        state.answers.insert(key.to_string(), KeptAnswer { until: now + Duration::from_secs(u64::from(seconds)), body: body.to_vec() });
    }

    // The profile a session check or a sign-in just read, for the account
    // asked next.
    pub(crate) fn keep_profile(&self, profile: &Profile) {
        self.state.lock().unwrap().profile = Some((Instant::now(), profile.clone()));
    }

    pub(crate) fn profile(&self) -> Option<Profile> {
        let state = self.state.lock().unwrap();
        state.profile.as_ref().filter(|(at, _)| at.elapsed() < PROFILE_KEPT).map(|(_, profile)| profile.clone())
    }

    // tonAPI opened a portal session with the ticket, held here.
    pub(crate) fn portal_opened(&self) {
        self.state.lock().unwrap().portal_opened = true;
    }

    pub(crate) fn has_portal_session(&self) -> bool {
        self.state.lock().unwrap().portal_opened
    }

    // The CAS said it knows the ticket.
    pub(crate) fn cas_knows(&self) {
        self.state.lock().unwrap().cas_knew = Some(Instant::now());
    }

    // Whether it said so a moment ago.
    pub(crate) fn cas_knew(&self) -> bool {
        self.state.lock().unwrap().cas_knew.is_some_and(|at| at.elapsed() < CAS_WORD_KEPT)
    }

    #[cfg(test)]
    pub(crate) fn age_cas_word(&self) {
        let mut state = self.state.lock().unwrap();
        state.cas_knew = state.cas_knew.and_then(|at| at.checked_sub(CAS_WORD_KEPT + Duration::from_secs(1)));
    }

    #[cfg(test)]
    pub(crate) fn age_answers(&self, by: Duration) {
        for kept in self.state.lock().unwrap().answers.values_mut() {
            kept.until = kept.until.checked_sub(by).unwrap_or_else(Instant::now);
        }
    }

    #[cfg(test)]
    pub(crate) fn age(&self, by: Duration) {
        let mut state = self.state.lock().unwrap();
        if let Some(earlier) = state.used.checked_sub(by) {
            state.used = earlier;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(domain: &str, name: &str, value: &str) -> StoredCookie {
        StoredCookie { domain: domain.into(), path: "/".into(), name: name.into(), value: value.into(), host_only: true, expires: None }
    }

    fn ticket() -> Vec<StoredCookie> {
        vec![cookie("cas.exemple.test", "TGC", "the-ticket")]
    }

    fn session(cookies: Vec<StoredCookie>, tokens: &[(&str, &str)]) -> SessionData {
        SessionData {
            university: "univ-exemple".into(),
            username: "jdoe".into(),
            establishment: None,
            cookies,
            tokens: tokens.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect(),
            pending: false,
            issued_at: 0,
            expires_at: 60,
        }
    }

    #[test]
    fn what_a_service_gave_is_kept_and_the_cookies_own_are_not() {
        let memory = Memory::default();
        let remembered = memory.of("one-session");
        let before = remembered.snapshot();
        let mut after = ticket();
        after.push(cookie("moodle.exemple.test", "MoodleSession", "abc"));
        remembered.keep(&before, &session(after, &[("moodle.sesskey", "KEY1")]), &ticket());

        let kept = remembered.snapshot();
        assert_eq!(kept.cookies, [cookie("moodle.exemple.test", "MoodleSession", "abc")]);
        assert_eq!(kept.tokens.get("moodle.sesskey").map(String::as_str), Some("KEY1"));
        // The same memory at the next question, for the same ticket.
        assert_eq!(memory.of("one-session").snapshot().cookies.len(), 1);
    }

    #[test]
    fn what_a_question_took_away_or_changed_is() {
        let remembered = Memory::default().of("one-session");
        let empty = remembered.snapshot();
        remembered.keep(&empty, &session(vec![cookie("m.test", "MoodleSession", "old"), cookie("m.test", "lang", "fr")], &[("moodle.sesskey", "OLD"), ("ade", "token")]), &ticket());

        // The service refused its session: tonAPI dropped the key and came
        // back with another session cookie.
        let before = remembered.snapshot();
        remembered.keep(&before, &session(vec![cookie("m.test", "MoodleSession", "new")], &[("ade", "token")]), &ticket());
        let kept = remembered.snapshot();
        assert_eq!(kept.cookies, [cookie("m.test", "MoodleSession", "new")]);
        assert_eq!(kept.tokens.keys().collect::<Vec<_>>(), ["ade"]);
    }

    #[test]
    fn two_questions_that_cross_each_keep_their_own() {
        let remembered = Memory::default().of("one-session");
        let start = remembered.snapshot();
        // Both started from the same empty memory.
        remembered.keep(&start, &session(vec![cookie("moodle.test", "MoodleSession", "m")], &[("moodle.sesskey", "K")]), &ticket());
        remembered.keep(&start, &session(vec![cookie("notes.test", "PHPSESSID", "p")], &[("scodoc-student", "s")]), &ticket());
        let kept = remembered.snapshot();
        assert_eq!(kept.cookies.len(), 2);
        assert_eq!(kept.tokens.len(), 2);
    }

    #[test]
    fn an_hour_unused_or_the_session_ended_starts_over() {
        let memory = Memory::default();
        let remembered = memory.of("one-session");
        remembered.detected(None);
        remembered.keep_answer("deadlines", 300, b"{}");
        assert!(memory.of("one-session").snapshot().detected);
        // Another session's memory is another.
        assert!(!memory.of("another-session").snapshot().detected);

        remembered.age(UNUSED_KEPT + Duration::from_secs(1));
        let fresh = memory.of("one-session");
        assert!(!fresh.snapshot().detected);
        assert_eq!(fresh.answer("deadlines"), None);

        assert_eq!(memory.ended("one-session"), None);
        assert!(memory.end("one-session", Ended::Expired));
        // Ended once: whoever comes second didn't end it.
        assert!(!memory.end("one-session", Ended::SignedOut));
        assert!(!memory.remembers("one-session"));
        // Ended, and said so to whoever still shows its cookie; a session
        // under the same id would start from nothing.
        assert_eq!(memory.ended("one-session"), Some(Ended::Expired));
        assert_eq!(memory.ended("another-session"), None);
        assert!(!memory.of("one-session").snapshot().detected);
    }

    #[test]
    fn a_profile_and_the_cas_word_are_kept_a_moment() {
        let remembered = Memory::default().of("one-session");
        assert!(remembered.profile().is_none() && !remembered.cas_knew());
        let profile = Profile { username: "jdoe".into(), display_name: None, first_name: None, last_name: None, email: None, student_number: None, program: None };
        remembered.keep_profile(&profile);
        assert_eq!(remembered.profile().map(|profile| profile.username).as_deref(), Some("jdoe"));
        remembered.cas_knows();
        assert!(remembered.cas_knew());
        remembered.age_cas_word();
        assert!(!remembered.cas_knew());
    }

    #[test]
    fn an_answer_is_kept_as_long_as_it_was_said_and_no_longer() {
        let remembered = Memory::default().of("one-session");
        assert_eq!(remembered.answer("deadlines"), None);
        remembered.keep_answer("deadlines", 300, b"{\"a\":1}");
        assert_eq!(remembered.answer("deadlines").as_deref(), Some(&b"{\"a\":1}"[..]));
        assert_eq!(remembered.answer("grades"), None);
        remembered.age_answers(Duration::from_secs(301));
        assert_eq!(remembered.answer("deadlines"), None);
    }
}
