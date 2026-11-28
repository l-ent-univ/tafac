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
// The answers are the student's rather than the session's (`Answers`): a
// student who signs in again finds the ones of the session before. Some
// are still given once they are no longer fresh, up to a day after they
// were read, while the university is asked again behind the answer
// (gateway/behind.rs): the home page's, which a student opens Tafac for.
//
// Not in the cookie: two questions asked at once would each write it, one
// undoing the other, and a browser drops a cookie past 4 kB. A process
// that starts again signs in to the services again, with the ticket.
//
// It goes with the session (signed out, expired: `ended` says so to any
// request still on its way with the cookie) or after an hour unused. The
// answers go when the student signs out, or a day after they were read;
// they are never written anywhere. The
// CAS ticket's own value says nothing of whose it is: the CAS writes it
// anew each time someone signs in to a service, for the same session.

use std::collections::{BTreeMap, HashMap, HashSet};
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
// Answers kept for one student: one per route and what it was asked.
const ANSWERS_KEPT: usize = 64;
// How long after it was read an answer may still be given, old, while the
// university is asked again: tonAPI's own bound for an answer kept (past a
// day it is no longer the day's).
const OLD_KEPT: Duration = Duration::from_secs(24 * 60 * 60);
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
// A look for the component that failed (ADE down, or too slow): the
// session's questions go with the default component this long before one
// looks again, rather than each waiting on a service that doesn't answer.
const LOOK_AGAIN_AFTER: Duration = Duration::from_secs(2 * 60);

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
    // What the university last answered each student (`student`'s key),
    // whatever the session.
    students: Mutex<HashMap<String, Arc<Answers>>>,
}

// Who a session's answers are kept for: the student, at their university.
// None for a session that names nobody: its answers are its own.
pub(crate) fn student(university: &str, user: &str) -> Option<String> {
    let user = user.trim();
    (!user.is_empty()).then(|| format!("{university}\n{user}"))
}

// One student's answers.
#[derive(Default)]
pub(crate) struct Answers {
    state: Mutex<AnswersState>,
}

#[derive(Default)]
struct AnswersState {
    kept: HashMap<String, KeptAnswer>,
    // The answers the university is being asked again for, behind an old
    // one given meanwhile.
    refreshing: HashSet<String>,
    // The student signed out: nothing is kept from then on, whatever a
    // question still on its way brings back.
    closed: bool,
}

// An answer kept, as it may be given again.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Kept {
    // As good as asking again.
    Fresh(Vec<u8>),
    // No longer fresh: given while the university is asked again.
    Old(Vec<u8>),
}

// An answer is being asked again behind an old one, until this is dropped.
pub(crate) struct Refreshing {
    answers: Arc<Answers>,
    key: String,
}

impl Drop for Refreshing {
    fn drop(&mut self) {
        self.answers.state.lock().unwrap().refreshing.remove(&self.key);
    }
}

// Whose turn it is: one question at a time to each service of a session,
// and to the CAS about its ticket.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Turn {
    Service(ServiceKind),
    Cas,
    // The student's component, looked for once at a time (tonapi/mod.rs).
    Component,
}

// One session's memory.
pub(crate) struct Remembered {
    state: Mutex<State>,
    // The student's answers, and whose they are (`student`'s key).
    answers: Arc<Answers>,
    student: Option<String>,
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
    // When a look last failed (session/memory.rs's LOOK_AGAIN_AFTER).
    look_failed: Option<Instant>,
    // When the service only one component has last didn't know the student
    // (tonapi/mod.rs's probe): not asked again before LOOK_AGAIN_AFTER.
    probe_failed: Option<Instant>,
    profile: Option<(Instant, Profile)>,
    // When the CAS last said it knew the ticket.
    cas_knew: Option<Instant>,
    // tonAPI opened a portal session of its own for this session, which is
    // among the cookies above: the portal is asked with it from then on.
    portal_opened: bool,
}

struct KeptAnswer {
    fresh_until: Instant,
    // Past this it is given no more, fresh or old.
    held_until: Instant,
    body: Vec<u8>,
}

// What a question starts from: the memory as it was then.
#[derive(Clone, Default)]
pub(crate) struct Snapshot {
    pub cookies: Vec<StoredCookie>,
    pub tokens: BTreeMap<String, String>,
    pub component: Option<EstablishmentPick>,
    pub detected: bool,
    // Not found yet, and no look failed lately: the next question looks.
    pub look_due: bool,
    // Not found, a look failed, and the probe didn't lately: the next
    // question that can probes.
    pub probe_due: bool,
}

impl Memory {
    // The memory of a session (by its id): a new one when there is none,
    // or when the one there is went an hour unused. `student`: whose
    // answers it holds (`student`'s key).
    pub(crate) fn of(&self, session: &str, student: Option<&str>) -> Arc<Remembered> {
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
                look_failed: None,
                probe_failed: None,
                profile: None,
                cas_knew: None,
                portal_opened: false,
            }),
            answers: student.map_or_else(Arc::default, |student| self.answers_of(student)),
            student: student.map(str::to_string),
            turns: Mutex::new(HashMap::new()),
        });
        sessions.insert(session.to_string(), remembered.clone());
        remembered
    }

    // A student's answers: the ones there are, or none yet.
    fn answers_of(&self, student: &str) -> Arc<Answers> {
        let mut students = self.students.lock().unwrap();
        if let Some(answers) = students.get(student) {
            return answers.clone();
        }
        // Whoever has no session left and no answer still good goes.
        students.retain(|_, answers| Arc::strong_count(answers) > 1 || answers.holds_any());
        if students.len() >= REMEMBERED {
            students.clear();
        }
        students.entry(student.to_string()).or_default().clone()
    }

    // The session ended: nothing of it stays, and a copy of its cookie is
    // worth nothing from now on. A student who signed out leaves no answer
    // either; one whose session expired finds them at the next sign-in.
    // Whether this ended it: false when it had ended already (two requests
    // found it expired together: one ends it).
    pub(crate) fn end(&self, session: &str, why: Ended) -> bool {
        let gone = self.sessions.lock().unwrap().remove(session);
        if let (Ended::SignedOut, Some(gone)) = (why, gone) {
            if let Some(student) = &gone.student {
                self.students.lock().unwrap().remove(student);
            }
            gone.answers.close();
        }
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

    // Every session's failed look, as if it were long ago.
    #[cfg(test)]
    pub(crate) fn age_looks(&self) {
        for remembered in self.sessions.lock().unwrap().values() {
            remembered.age_look();
        }
    }
}

impl Answers {
    fn keep(&self, key: &str, fresh: Duration, old: Duration, body: &[u8]) {
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return;
        }
        let now = Instant::now();
        state.kept.retain(|_, kept| now < kept.held_until);
        if state.kept.len() >= ANSWERS_KEPT {
            state.kept.clear();
        }
        state.kept.insert(key.to_string(), KeptAnswer { fresh_until: now + fresh, held_until: now + fresh.max(old), body: body.to_vec() });
    }

    fn holds_any(&self) -> bool {
        let now = Instant::now();
        self.state.lock().unwrap().kept.values().any(|kept| now < kept.held_until)
    }

    fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.kept.clear();
        state.closed = true;
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
        let lately = |at: Option<Instant>| at.is_some_and(|at| at.elapsed() < LOOK_AGAIN_AFTER);
        let look_due = !state.detected && !lately(state.look_failed);
        let probe_due = !state.detected && state.look_failed.is_some() && !lately(state.probe_failed);
        Snapshot {
            cookies: state.cookies.clone(),
            tokens: state.tokens.clone(),
            component: state.component.clone(),
            detected: state.detected,
            look_due,
            probe_due,
        }
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

    // The look failed: not again for a while.
    pub(crate) fn look_failed(&self) {
        self.state.lock().unwrap().look_failed = Some(Instant::now());
    }

    // The probe didn't tell: not again for a while.
    pub(crate) fn probe_failed(&self) {
        self.state.lock().unwrap().probe_failed = Some(Instant::now());
    }

    // An answer kept, while it is still fresh.
    pub(crate) fn answer(&self, key: &str) -> Option<Vec<u8>> {
        match self.kept(key)? {
            Kept::Fresh(body) => Some(body),
            Kept::Old(_) => None,
        }
    }

    // An answer kept, fresh or old (one kept with `keep_answer_to_give_old`).
    pub(crate) fn kept(&self, key: &str) -> Option<Kept> {
        let state = self.answers.state.lock().unwrap();
        let now = Instant::now();
        let kept = state.kept.get(key).filter(|kept| now < kept.held_until)?;
        Some(if now < kept.fresh_until { Kept::Fresh(kept.body.clone()) } else { Kept::Old(kept.body.clone()) })
    }

    // Kept as long as it is fresh: `seconds`.
    pub(crate) fn keep_answer(&self, key: &str, seconds: u32, body: &[u8]) {
        self.answers.keep(key, Duration::from_secs(u64::from(seconds)), Duration::ZERO, body);
    }

    // Kept past that, to be given old while the university is asked again.
    pub(crate) fn keep_answer_to_give_old(&self, key: &str, seconds: u32, body: &[u8]) {
        self.answers.keep(key, Duration::from_secs(u64::from(seconds)), OLD_KEPT, body);
    }

    // An answer that is not to be given again: asking again found the
    // university no longer knows the session.
    pub(crate) fn forget_answer(&self, key: &str) {
        self.answers.state.lock().unwrap().kept.remove(key);
    }

    // This answer is being asked again from now, until what is returned is
    // dropped. None when it is already, or when nothing is kept any more.
    pub(crate) fn refreshing(&self, key: &str) -> Option<Refreshing> {
        let mut state = self.answers.state.lock().unwrap();
        (!state.closed && state.refreshing.insert(key.to_string())).then(|| Refreshing { answers: self.answers.clone(), key: key.to_string() })
    }

    pub(crate) fn is_refreshing(&self, key: &str) -> bool {
        self.answers.state.lock().unwrap().refreshing.contains(key)
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
        for kept in self.answers.state.lock().unwrap().kept.values_mut() {
            kept.fresh_until = kept.fresh_until.checked_sub(by).unwrap_or_else(Instant::now);
            kept.held_until = kept.held_until.checked_sub(by).unwrap_or_else(Instant::now);
        }
    }

    #[cfg(test)]
    pub(crate) fn forget_answers(&self) {
        self.answers.state.lock().unwrap().kept.clear();
    }

    #[cfg(test)]
    pub(crate) fn age_look(&self) {
        let mut state = self.state.lock().unwrap();
        state.look_failed = state.look_failed.and_then(|at| at.checked_sub(LOOK_AGAIN_AFTER));
        state.probe_failed = state.probe_failed.and_then(|at| at.checked_sub(LOOK_AGAIN_AFTER));
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
            university: "univ-rennes-2".into(),
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
        let remembered = memory.of("one-session", None);
        let before = remembered.snapshot();
        let mut after = ticket();
        after.push(cookie("moodle.exemple.test", "MoodleSession", "abc"));
        remembered.keep(&before, &session(after, &[("moodle.sesskey", "KEY1")]), &ticket());

        let kept = remembered.snapshot();
        assert_eq!(kept.cookies, [cookie("moodle.exemple.test", "MoodleSession", "abc")]);
        assert_eq!(kept.tokens.get("moodle.sesskey").map(String::as_str), Some("KEY1"));
        // The same memory at the next question, for the same ticket.
        assert_eq!(memory.of("one-session", None).snapshot().cookies.len(), 1);
    }

    #[test]
    fn what_a_question_took_away_or_changed_is() {
        let remembered = Memory::default().of("one-session", None);
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
        let remembered = Memory::default().of("one-session", None);
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
        let remembered = memory.of("one-session", None);
        remembered.detected(None);
        remembered.keep_answer("deadlines", 300, b"{}");
        assert!(memory.of("one-session", None).snapshot().detected);
        // Another session's memory is another.
        assert!(!memory.of("another-session", None).snapshot().detected);

        remembered.age(UNUSED_KEPT + Duration::from_secs(1));
        let fresh = memory.of("one-session", None);
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
        assert!(!memory.of("one-session", None).snapshot().detected);
    }

    #[test]
    fn a_profile_and_the_cas_word_are_kept_a_moment() {
        let remembered = Memory::default().of("one-session", None);
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
    fn the_answers_are_the_students_fresh_then_old_until_they_sign_out() {
        let memory = Memory::default();
        let jdoe = student("univ-rennes-2", " jdoe ");
        assert_eq!(jdoe.as_deref(), Some("univ-rennes-2\njdoe"));
        // A session that names nobody shares nothing.
        assert_eq!(student("univ-rennes-2", " "), None);

        let morning = memory.of("the-morning", jdoe.as_deref());
        morning.keep_answer_to_give_old("deadlines", 300, b"{}");
        morning.keep_answer("grades/semester/12", 600, b"[]");
        assert_eq!(morning.kept("deadlines"), Some(Kept::Fresh(b"{}".to_vec())));

        // The session expired; the student signs in again an hour later:
        // the answer kept to be given old is there, old, and only that one.
        assert!(memory.end("the-morning", Ended::Expired));
        let afternoon = memory.of("the-afternoon", jdoe.as_deref());
        afternoon.age_answers(Duration::from_secs(3601));
        assert_eq!(afternoon.kept("deadlines"), Some(Kept::Old(b"{}".to_vec())));
        assert_eq!(afternoon.answer("deadlines"), None);
        assert_eq!(afternoon.kept("grades/semester/12"), None);
        // Another student, or the same login at another university, has none.
        assert_eq!(memory.of("someone-else", student("univ-rennes-2", "asmith").as_deref()).kept("deadlines"), None);
        assert_eq!(memory.of("elsewhere", student("univ-autre", "jdoe").as_deref()).kept("deadlines"), None);
        // Past a day after it was read, it is given no more.
        afternoon.age_answers(OLD_KEPT);
        assert_eq!(afternoon.kept("deadlines"), None);

        // One question behind an answer at a time, until it is done.
        afternoon.keep_answer_to_give_old("deadlines", 300, b"{}");
        let asking = afternoon.refreshing("deadlines").expect("nobody was asking");
        assert!(afternoon.refreshing("deadlines").is_none() && afternoon.is_refreshing("deadlines"));
        drop(asking);
        assert!(!afternoon.is_refreshing("deadlines"));

        // Signed out: nothing stays, whatever a question still on its way
        // brings back, and the next session starts from nothing.
        assert!(memory.end("the-afternoon", Ended::SignedOut));
        afternoon.keep_answer_to_give_old("deadlines", 300, b"{}");
        assert_eq!(afternoon.kept("deadlines"), None);
        assert!(afternoon.refreshing("deadlines").is_none() && !afternoon.is_refreshing("deadlines"));
        assert_eq!(memory.of("the-evening", jdoe.as_deref()).kept("deadlines"), None);
    }

    #[test]
    fn an_answer_is_kept_as_long_as_it_was_said_and_no_longer() {
        let remembered = Memory::default().of("one-session", None);
        assert_eq!(remembered.answer("deadlines"), None);
        remembered.keep_answer("deadlines", 300, b"{\"a\":1}");
        assert_eq!(remembered.answer("deadlines").as_deref(), Some(&b"{\"a\":1}"[..]));
        assert_eq!(remembered.answer("grades"), None);
        remembered.age_answers(Duration::from_secs(301));
        assert_eq!(remembered.answer("deadlines"), None);
    }
}
