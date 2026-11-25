// What the gateway remembers of a session between two questions.
//
// Node keeps, for each session, the services' own sessions (Moodle's, an
// hour) and their last answers (the deadlines, five minutes). The routes
// that moved here need the same, or every question would sign in to the
// service again and ask it again:
//
//   the services' sessions   the cookies and tokens tonAPI got from a
//                            service (MoodleSession, its sesskey…), handed
//                            back with the next question
//   the student's component  detected once (tonAPI asks the university)
//   the answers              each kept as long as tonAPI says it may be
//                            (its `keep_secs`: the settings' cache-ttl-secs)
//
// All of it lives in this process: nothing is written to Node's cookie or to
// a disk, and it goes with the session (signed out, expired) or after an
// hour unused. It is made for one CAS ticket: when Node signs in again the
// ticket is another, and the memory starts over.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tonapi_config::ServiceKind;
use tonapi_session::{EstablishmentPick, SessionData, StoredCookie};

use crate::session::handed::same_cookie;

// How long a session's memory outlives its last question (Node's
// MOODLE_CONTEXT_TTL_MS: an hour).
const UNUSED_KEPT: Duration = Duration::from_secs(60 * 60);
// Sessions remembered at once (tafac.fr serves many; an app, one).
const REMEMBERED: usize = 10_000;
// Answers kept for one session: one per route and what it was asked.
const ANSWERS_KEPT: usize = 64;

#[derive(Default)]
pub(crate) struct Memory {
    sessions: Mutex<HashMap<String, Arc<Remembered>>>,
}

// One session's memory.
pub(crate) struct Remembered {
    // The CAS cookies it was made with.
    ticket: Vec<StoredCookie>,
    state: Mutex<State>,
    // One question at a time to each service of a session: a second one
    // waits for the first, then finds its answer kept.
    turns: Mutex<HashMap<ServiceKind, Arc<tokio::sync::Mutex<()>>>>,
}

struct State {
    used: Instant,
    cookies: Vec<StoredCookie>,
    tokens: BTreeMap<String, String>,
    component: Option<EstablishmentPick>,
    // The component was looked for: found or not, not twice.
    detected: bool,
    answers: HashMap<String, KeptAnswer>,
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
    // The memory of a session, for the CAS cookies it holds now: a new one
    // when there is none, or when the ticket is no longer the same.
    pub(crate) fn of(&self, session: &str, ticket: &[StoredCookie]) -> Arc<Remembered> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(remembered) = sessions.get(session) {
            if remembered.ticket == ticket && remembered.state.lock().unwrap().used.elapsed() < UNUSED_KEPT {
                return remembered.clone();
            }
        }
        sessions.retain(|_, remembered| remembered.state.lock().unwrap().used.elapsed() < UNUSED_KEPT);
        if sessions.len() >= REMEMBERED {
            sessions.clear();
        }
        let remembered = Arc::new(Remembered {
            ticket: ticket.to_vec(),
            state: Mutex::new(State {
                used: Instant::now(),
                cookies: Vec::new(),
                tokens: BTreeMap::new(),
                component: None,
                detected: false,
                answers: HashMap::new(),
            }),
            turns: Mutex::new(HashMap::new()),
        });
        sessions.insert(session.to_string(), remembered.clone());
        remembered
    }

    // The session ended (signed out, expired): nothing of it stays.
    pub(crate) fn forget(&self, session: &str) {
        self.sessions.lock().unwrap().remove(session);
    }

    #[cfg(test)]
    pub(crate) fn remembers(&self, session: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(session)
    }
}

impl Remembered {
    // This question's turn at a service: held until it is answered.
    pub(crate) async fn turn(&self, service: ServiceKind) -> tokio::sync::OwnedMutexGuard<()> {
        let turn = self.turns.lock().unwrap().entry(service).or_default().clone();
        turn.lock_owned().await
    }

    pub(crate) fn snapshot(&self) -> Snapshot {
        let mut state = self.state.lock().unwrap();
        state.used = Instant::now();
        Snapshot { cookies: state.cookies.clone(), tokens: state.tokens.clone(), component: state.component.clone(), detected: state.detected }
    }

    // What a question left in tonAPI's session, kept for the next one: what
    // it added or changed since `before`, and no longer what it took away.
    // The cookies handed from Node's session (`handed`) are Node's to keep.
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
    fn what_a_service_gave_is_kept_and_nodes_cookies_are_not() {
        let memory = Memory::default();
        let remembered = memory.of("one-session", &ticket());
        let before = remembered.snapshot();
        let mut after = ticket();
        after.push(cookie("moodle.exemple.test", "MoodleSession", "abc"));
        remembered.keep(&before, &session(after, &[("moodle.sesskey", "KEY1")]), &ticket());

        let kept = remembered.snapshot();
        assert_eq!(kept.cookies, [cookie("moodle.exemple.test", "MoodleSession", "abc")]);
        assert_eq!(kept.tokens.get("moodle.sesskey").map(String::as_str), Some("KEY1"));
        // The same memory at the next question, for the same ticket.
        assert_eq!(memory.of("one-session", &ticket()).snapshot().cookies.len(), 1);
    }

    #[test]
    fn what_a_question_took_away_or_changed_is() {
        let remembered = Memory::default().of("one-session", &ticket());
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
        let remembered = Memory::default().of("one-session", &ticket());
        let start = remembered.snapshot();
        // Both started from the same empty memory.
        remembered.keep(&start, &session(vec![cookie("moodle.test", "MoodleSession", "m")], &[("moodle.sesskey", "K")]), &ticket());
        remembered.keep(&start, &session(vec![cookie("notes.test", "PHPSESSID", "p")], &[("scodoc-student", "s")]), &ticket());
        let kept = remembered.snapshot();
        assert_eq!(kept.cookies.len(), 2);
        assert_eq!(kept.tokens.len(), 2);
    }

    #[test]
    fn another_ticket_or_an_hour_unused_starts_over() {
        let memory = Memory::default();
        let remembered = memory.of("one-session", &ticket());
        remembered.detected(None);
        remembered.keep_answer("deadlines", 300, b"{}");
        assert!(memory.of("one-session", &ticket()).snapshot().detected);

        // Node signed in again: another ticket.
        let other = vec![cookie("cas.exemple.test", "TGC", "another-ticket")];
        let fresh = memory.of("one-session", &other);
        assert!(!fresh.snapshot().detected);
        assert_eq!(fresh.answer("deadlines"), None);

        fresh.detected(None);
        fresh.age(UNUSED_KEPT + Duration::from_secs(1));
        assert!(!memory.of("one-session", &other).snapshot().detected);

        memory.forget("one-session");
        assert!(!memory.remembers("one-session"));
    }

    #[test]
    fn an_answer_is_kept_as_long_as_it_was_said_and_no_longer() {
        let remembered = Memory::default().of("one-session", &ticket());
        assert_eq!(remembered.answer("deadlines"), None);
        remembered.keep_answer("deadlines", 300, b"{\"a\":1}");
        assert_eq!(remembered.answer("deadlines").as_deref(), Some(&b"{\"a\":1}"[..]));
        assert_eq!(remembered.answer("grades"), None);
        remembered.age_answers(Duration::from_secs(301));
        assert_eq!(remembered.answer("deadlines"), None);
    }
}
