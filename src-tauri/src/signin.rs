// The student's sign-in, kept so that the app signs in again by itself.
//
// The university's session dies on its own (the Rennes CAS ends it 30 to 47
// minutes after the login, whatever the student does). The app keeps the
// login, password and university of the last sign-in made in its window, and
// when the local server says the session is gone (bridge.rs), it signs in
// again with them and asks again: the page never sees the expiry. At launch,
// a signed-out answer to the page's first questions does the same, so the
// login page doesn't show.
//
//   kept       after a login the page sent went through (POST
//              /__ent_auth/login, 200): not the demo account's, nor one that
//              needed a one-time code (it can't be signed in again without
//              the student)
//   forgotten  on the student's own sign-out (POST /__ent_auth/logout without
//              `X-Tafac-Logout: expired`), when the university refuses it
//              (`code: 'login_refused'`, server/casLogin/refusal.ts) or asks
//              for a code, and when another login replaces it
//   kept as is when the sign-in couldn't be tried: no network, the CAS down,
//              the local server down. The page then signs out as before, and
//              the next signed-out answer tries again (not before COOL_DOWN)
//
// Where: a packaged app keeps it in the system's credential store (macOS
// Keychain), one entry beside the session secret's (secret.rs). A debug build
// keeps it in memory only, for the run: an unsigned build would have macOS
// ask for the keychain at each rebuild, and the password goes in no file.
//
// The password is sent nowhere but the local server's login route (and from
// there to the university's CAS), and never logged.

use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const LOGIN_PATH: &str = "/__ent_auth/login";
pub const LOGOUT_PATH: &str = "/__ent_auth/logout";
const SESSION_PATH: &str = "/__ent_auth/session";
const UNIVERSITIES_PATH: &str = "/__ent_auth/universities";
pub const UNIVERSITY_HEADER: &str = "x-tafac-university";
pub const SESSION_HEADER: &str = "x-tafac-session";
// The page's sign-out when the session expired (src/entApi.js logoutFromEnt).
pub const LOGOUT_REASON_HEADER: &str = "x-tafac-logout";
const DEMO_SESSION_MODE: &str = "demo";

// After a sign-in that couldn't be tried, how long signed-out answers are
// passed on as they are: a burst of them, or a page asking again and again,
// doesn't make one sign-in each.
const COOL_DOWN: Duration = Duration::from_secs(30);

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct KeptLogin {
    pub username: String,
    pub password: String,
    // The university's id, as the page chose it (multi-university server).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub university: Option<String>,
}

// Never the password, even in a debug print.
impl std::fmt::Debug for KeptLogin {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("KeptLogin").field("university", &self.university).finish_non_exhaustive()
    }
}

// ---------------------------------------------------------------------------
// The decisions, without effects (tested below)
// ---------------------------------------------------------------------------

// What a login the page sent means for the kept one.
#[derive(Debug, PartialEq)]
pub enum Capture {
    Keep(KeptLogin),
    Forget,
    // It didn't go through: what is kept stays.
    Leave,
}

#[derive(Deserialize)]
struct LoginBody {
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    otp: Option<String>,
    #[serde(default)]
    university: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct LoginAnswer {
    authenticated: bool,
    #[serde(rename = "sessionMode")]
    session_mode: Option<String>,
    code: Option<String>,
}

pub fn capture(request_body: &[u8], university_header: Option<&str>, status: u16, response_body: &[u8]) -> Capture {
    let answer: LoginAnswer = serde_json::from_slice(response_body).unwrap_or_default();
    if status != 200 || !answer.authenticated {
        return Capture::Leave;
    }
    let Ok(body) = serde_json::from_slice::<LoginBody>(request_body) else { return Capture::Forget };
    let needed_code = body.otp.as_deref().is_some_and(|otp| !otp.trim().is_empty());
    let demo = answer.session_mode.as_deref() == Some(DEMO_SESSION_MODE);
    if needed_code || demo || body.username.trim().is_empty() || body.password.is_empty() {
        return Capture::Forget;
    }
    let university = body
        .university
        .or_else(|| university_header.map(str::to_string))
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());
    Capture::Keep(KeptLogin { username: body.username.trim().to_string(), password: body.password, university })
}

// What the server answered a sign-in made with the kept login.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Outcome {
    SignedIn,
    // The university refused the login: it is forgotten.
    Refused,
    // The account asks for a one-time code: only the student can sign in.
    SecondFactor,
    // Not tried through: no network, the CAS or the local server down, too
    // many attempts. Kept for later.
    NotNow,
}

pub fn outcome(status: u16, response_body: &[u8]) -> Outcome {
    let answer: LoginAnswer = serde_json::from_slice(response_body).unwrap_or_default();
    match (status, answer.code.as_deref()) {
        (200, _) if answer.authenticated && answer.session_mode.as_deref() != Some(DEMO_SESSION_MODE) => Outcome::SignedIn,
        (401, Some("login_refused")) => Outcome::Refused,
        (401, Some(code)) if code.starts_with("mfa_") => Outcome::SecondFactor,
        _ => Outcome::NotNow,
    }
}

// Whether an answer says the student isn't signed in (any more): the
// server's expiry header on any answer, or, for the page's first questions
// at launch, a signed-out session (`/session`: authenticated false;
// `/universities`: no session's university).
pub fn says_signed_out(path: &str, status: u16, session_header: Option<&str>, response_body: &[u8]) -> bool {
    if path == LOGIN_PATH || path == LOGOUT_PATH {
        return false;
    }
    if session_header == Some("expired") {
        return true;
    }
    if status != 200 {
        return false;
    }
    let Ok(answer) = serde_json::from_slice::<serde_json::Value>(response_body) else { return false };
    match path {
        SESSION_PATH => answer.get("authenticated").and_then(|value| value.as_bool()) == Some(false),
        UNIVERSITIES_PATH => answer.get("universities").is_some() && answer.get("session").is_some_and(|value| value.is_null()),
        _ => false,
    }
}

// The student's own sign-out forgets the login; the page's, after an expiry
// the app couldn't get past, doesn't.
pub fn logout_forgets(reason_header: Option<&str>) -> bool {
    reason_header != Some("expired")
}

#[derive(Debug, PartialEq)]
pub enum Step {
    // Another request's sign-in went through since this one left: ask again.
    Retry,
    // The answer goes to the page as it is.
    GiveUp,
    SignIn,
}

// For a request that left after `sent_round` sign-ins and came back signed
// out. `last_ok`: whether the last sign-in went through; `cooling`: it
// couldn't be tried, a moment ago.
pub fn next_step(sent_round: u64, round: u64, last_ok: bool, cooling: bool, has_login: bool) -> Step {
    if round != sent_round {
        return if last_ok { Step::Retry } else { Step::GiveUp };
    }
    if !has_login || cooling {
        return Step::GiveUp;
    }
    Step::SignIn
}

// ---------------------------------------------------------------------------
// Where the login is kept
// ---------------------------------------------------------------------------

// The system's credential store, as far as the login needs it.
pub trait LoginStore: Send + Sync {
    // Ok(None): the store works and holds nothing.
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

#[derive(Default)]
struct Turn {
    last_ok: bool,
    // When the last sign-in couldn't be tried.
    not_now_at: Option<Instant>,
}

pub struct SignIn {
    store: Option<Box<dyn LoginStore>>,
    // The kept login; None until read from the store, once.
    kept: Mutex<Option<Option<KeptLogin>>>,
    // One sign-in at a time: the requests that came back signed out wait
    // for it, then are asked again.
    turn: tokio::sync::Mutex<Turn>,
    // Sign-ins done (tried, or a login of the page's that went through).
    round: AtomicU64,
}

impl SignIn {
    pub fn new(store: Option<Box<dyn LoginStore>>) -> Self {
        Self { store, kept: Mutex::new(None), turn: tokio::sync::Mutex::new(Turn::default()), round: AtomicU64::new(0) }
    }

    // The packaged app's store; memory only in a debug build.
    pub fn for_this_build() -> Self {
        Self::new(system_store())
    }

    pub fn round(&self) -> u64 {
        self.round.load(Ordering::SeqCst)
    }

    pub fn kept(&self) -> Option<KeptLogin> {
        let mut kept = self.kept.lock().unwrap();
        if kept.is_none() {
            *kept = Some(self.read_store());
        }
        kept.clone().flatten()
    }

    pub fn has_kept(&self) -> bool {
        self.kept().is_some()
    }

    fn read_store(&self) -> Option<KeptLogin> {
        let store = self.store.as_ref()?;
        match store.read() {
            Ok(Some(value)) => serde_json::from_str(&value).ok().or_else(|| {
                // Not one of ours: nothing kept.
                let _ = store.delete();
                None
            }),
            Ok(None) => None,
            Err(error) => {
                eprintln!("[tafac] sign-in: credential store unavailable: {error}");
                None
            }
        }
    }

    fn keep(&self, login: KeptLogin) {
        if let Some(store) = &self.store {
            let stored = serde_json::to_string(&login).map_err(|error| error.to_string()).and_then(|value| store.write(&value));
            // Refused: kept for this run only.
            if let Err(error) = stored {
                eprintln!("[tafac] sign-in: kept for this run only, the credential store refused it: {error}");
            }
        }
        *self.kept.lock().unwrap() = Some(Some(login));
    }

    fn forget(&self) {
        if let Some(store) = &self.store {
            if let Err(error) = store.delete() {
                eprintln!("[tafac] sign-in: not removed from the credential store: {error}");
            }
        }
        *self.kept.lock().unwrap() = Some(None);
    }

    // A login the page sent, and its answer.
    pub async fn after_login(&self, request_body: &[u8], university_header: Option<&str>, status: u16, response_body: &[u8]) {
        let capture = capture(request_body, university_header, status, response_body);
        if capture == Capture::Leave {
            return;
        }
        let mut turn = self.turn.lock().await;
        match capture {
            Capture::Keep(login) => {
                self.keep(login);
                eprintln!("[tafac] sign-in: kept");
            }
            Capture::Forget => {
                if self.has_kept() {
                    eprintln!("[tafac] sign-in: forgotten (another login)");
                }
                self.forget();
            }
            Capture::Leave => {}
        }
        // A new session: requests that left before it are asked again.
        turn.last_ok = true;
        turn.not_now_at = None;
        self.round.fetch_add(1, Ordering::SeqCst);
    }

    // The page's sign-out, before it goes to the server: after any sign-in
    // under way, so that none signs the student in again behind it.
    pub async fn before_logout(&self, reason_header: Option<&str>) {
        let mut turn = self.turn.lock().await;
        if logout_forgets(reason_header) {
            if self.has_kept() {
                eprintln!("[tafac] sign-in: forgotten (signed out)");
            }
            self.forget();
        }
        turn.last_ok = false;
        self.round.fetch_add(1, Ordering::SeqCst);
    }

    // A request that left after `sent_round` sign-ins came back signed out:
    // whether to ask again. Signs in with the kept login when it is the
    // first to come back since the last sign-in; `attempt` sends it.
    pub async fn again<F, Fut>(&self, sent_round: u64, attempt: F) -> bool
    where
        F: FnOnce(KeptLogin) -> Fut,
        Fut: Future<Output = Outcome>,
    {
        let mut turn = self.turn.lock().await;
        let login = self.kept();
        let cooling = turn.not_now_at.is_some_and(|at| at.elapsed() < COOL_DOWN);
        match next_step(sent_round, self.round(), turn.last_ok, cooling, login.is_some()) {
            Step::Retry => true,
            Step::GiveUp => false,
            Step::SignIn => {
                let Some(login) = login else { return false };
                let outcome = attempt(login).await;
                match outcome {
                    Outcome::SignedIn => eprintln!("[tafac] sign-in: signed in again"),
                    Outcome::Refused => eprintln!("[tafac] sign-in: refused by the university, forgotten"),
                    Outcome::SecondFactor => eprintln!("[tafac] sign-in: the account asks for a code, forgotten"),
                    Outcome::NotNow => eprintln!("[tafac] sign-in: not possible now, kept for later"),
                }
                if matches!(outcome, Outcome::Refused | Outcome::SecondFactor) {
                    self.forget();
                }
                turn.last_ok = outcome == Outcome::SignedIn;
                turn.not_now_at = (outcome == Outcome::NotNow).then(Instant::now);
                self.round.fetch_add(1, Ordering::SeqCst);
                turn.last_ok
            }
        }
    }
}

// The body of the sign-in made with the kept login. `quiet`: the server
// sends no one-time code unasked for it (server/entAuthApp.js).
pub fn login_request_body(login: &KeptLogin) -> Vec<u8> {
    let mut body = serde_json::json!({ "username": login.username, "password": login.password, "quiet": true });
    if let Some(university) = &login.university {
        body["university"] = serde_json::Value::String(university.clone());
    }
    serde_json::to_vec(&body).unwrap_or_default()
}

// Packaged builds, on the systems with a credential store.
#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
fn system_store() -> Option<Box<dyn LoginStore>> {
    Some(Box::new(system::Keychain))
}

#[cfg(not(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows))))]
fn system_store() -> Option<Box<dyn LoginStore>> {
    None
}

#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
mod system {
    use super::LoginStore;

    // The entry's name in the store: the app's identifier (tauri.conf.json)
    // and what it holds.
    const SERVICE: &str = "fr.tafac.desktop";
    const ACCOUNT: &str = "sign-in";

    pub struct Keychain;

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
    }

    impl LoginStore for Keychain {
        fn read(&self) -> Result<Option<String>, String> {
            match entry()?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error.to_string()),
            }
        }

        fn write(&self, value: &str) -> Result<(), String> {
            entry()?.set_password(value).map_err(|error| error.to_string())
        }

        fn delete(&self) -> Result<(), String> {
            match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    const SIGNED_IN: &[u8] = br#"{"authenticated":true,"user":"jdoe","sessionMode":null,"university":"univ-rennes"}"#;
    const DEMO: &[u8] = br#"{"authenticated":true,"user":"demo","sessionMode":"demo","university":"univ-rennes"}"#;

    fn login(university: Option<&str>) -> KeptLogin {
        KeptLogin { username: "jdoe".into(), password: "right horse".into(), university: university.map(str::to_string) }
    }

    #[test]
    fn a_login_that_went_through_is_kept_with_its_university() {
        let body = br#"{"username":" jdoe ","password":"right horse","university":"univ-rennes"}"#;
        assert_eq!(capture(body, None, 200, SIGNED_IN), Capture::Keep(login(Some("univ-rennes"))));
        // The header names it when the body doesn't.
        let body = br#"{"username":"jdoe","password":"right horse"}"#;
        assert_eq!(capture(body, Some("univ-rennes-2"), 200, SIGNED_IN), Capture::Keep(login(Some("univ-rennes-2"))));
        assert_eq!(capture(body, None, 200, SIGNED_IN), Capture::Keep(login(None)));
    }

    #[test]
    fn a_login_with_a_code_or_the_demo_replaces_what_is_kept_with_nothing() {
        let with_code = br#"{"username":"jdoe","password":"right horse","otp":"123456"}"#;
        assert_eq!(capture(with_code, None, 200, SIGNED_IN), Capture::Forget);
        let demo = br#"{"username":"demo","password":"demo"}"#;
        assert_eq!(capture(demo, None, 200, DEMO), Capture::Forget);
    }

    #[test]
    fn a_login_that_failed_leaves_what_is_kept() {
        let body = br#"{"username":"jdoe","password":"wrong"}"#;
        assert_eq!(capture(body, None, 401, br#"{"error":"x","code":"login_refused"}"#), Capture::Leave);
        assert_eq!(capture(body, None, 401, br#"{"error":"MFA required.","code":"mfa_required"}"#), Capture::Leave);
        assert_eq!(capture(body, None, 429, br#"{"error":"Too many"}"#), Capture::Leave);
        assert_eq!(capture(body, None, 502, b"Le serveur local de Tafac ne repond pas"), Capture::Leave);
    }

    #[test]
    fn what_a_sign_in_gave() {
        assert_eq!(outcome(200, SIGNED_IN), Outcome::SignedIn);
        assert_eq!(outcome(401, br#"{"error":"Identifiants incorrects","code":"login_refused"}"#), Outcome::Refused);
        assert_eq!(outcome(401, br#"{"error":"MFA required.","code":"mfa_required","mfa":{}}"#), Outcome::SecondFactor);
        // No network, the CAS down, too many attempts, the server down: later.
        assert_eq!(outcome(401, br#"{"error":"fetch failed"}"#), Outcome::NotNow);
        assert_eq!(outcome(401, br#"{"error":"Could not extract the CAS login form."}"#), Outcome::NotNow);
        assert_eq!(outcome(429, br#"{"error":"Too many login attempts. Please try again later."}"#), Outcome::NotNow);
        assert_eq!(outcome(500, b""), Outcome::NotNow);
        assert_eq!(outcome(502, b"Le serveur local"), Outcome::NotNow);
        assert_eq!(outcome(200, DEMO), Outcome::NotNow);
    }

    #[test]
    fn signed_out_answers() {
        // The expiry header, on any answer.
        assert!(says_signed_out("/__ent_auth/mail/recent", 401, Some("expired"), br#"{"error":"session_expired"}"#));
        assert!(says_signed_out("/__ent_auth/launch", 302, Some("expired"), b""));
        assert!(!says_signed_out("/__ent_auth/mail/recent", 502, None, b""));
        assert!(!says_signed_out("/__ent_auth/mail/recent", 401, None, br#"{"error":"session_expired"}"#));
        // At launch: no session yet.
        assert!(says_signed_out("/__ent_auth/session", 200, None, br#"{"authenticated":false,"user":null}"#));
        assert!(!says_signed_out("/__ent_auth/session", 200, None, br#"{"authenticated":true}"#));
        assert!(says_signed_out("/__ent_auth/universities", 200, None, br#"{"mode":"multi","session":null,"universities":[]}"#));
        assert!(!says_signed_out("/__ent_auth/universities", 200, None, br#"{"mode":"multi","session":"univ-rennes","universities":[]}"#));
        // Signing in and out are never asked again.
        assert!(!says_signed_out("/__ent_auth/login", 401, Some("expired"), b""));
        assert!(!says_signed_out("/__ent_auth/logout", 200, Some("expired"), b""));
    }

    #[test]
    fn only_the_students_own_sign_out_forgets() {
        assert!(logout_forgets(None));
        assert!(logout_forgets(Some("")));
        assert!(!logout_forgets(Some("expired")));
    }

    #[test]
    fn the_first_request_back_signs_in_the_others_wait_and_ask_again() {
        assert_eq!(next_step(3, 3, true, false, true), Step::SignIn);
        assert_eq!(next_step(3, 4, true, false, true), Step::Retry);
        // The sign-in since didn't go through: the page hears it.
        assert_eq!(next_step(3, 4, false, false, true), Step::GiveUp);
        // Nothing kept, or tried a moment ago without a network.
        assert_eq!(next_step(3, 3, true, false, false), Step::GiveUp);
        assert_eq!(next_step(3, 3, false, true, true), Step::GiveUp);
    }

    // A store for the tests: `kept` is what it holds.
    #[derive(Default)]
    struct FakeStore {
        kept: Mutex<Option<String>>,
        write_fails: bool,
    }

    impl LoginStore for Arc<FakeStore> {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.kept.lock().unwrap().clone())
        }
        fn write(&self, value: &str) -> Result<(), String> {
            if self.write_fails {
                return Err("denied".into());
            }
            *self.kept.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.kept.lock().unwrap() = None;
            Ok(())
        }
    }

    fn sign_in_with(store: &Arc<FakeStore>) -> SignIn {
        SignIn::new(Some(Box::new(store.clone())))
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    const LOGIN_BODY: &[u8] = br#"{"username":"jdoe","password":"right horse","university":"univ-rennes"}"#;

    #[test]
    fn kept_in_the_store_and_read_back_at_the_next_launch() {
        let store = Arc::new(FakeStore::default());
        block_on(sign_in_with(&store).after_login(LOGIN_BODY, None, 200, SIGNED_IN));
        assert!(store.kept.lock().unwrap().as_deref().is_some_and(|value| value.contains("univ-rennes")));
        assert_eq!(sign_in_with(&store).kept(), Some(login(Some("univ-rennes"))));
    }

    #[test]
    fn a_store_that_refuses_keeps_it_for_the_run() {
        let store = Arc::new(FakeStore { write_fails: true, ..Default::default() });
        let sign_in = sign_in_with(&store);
        block_on(sign_in.after_login(LOGIN_BODY, None, 200, SIGNED_IN));
        assert!(sign_in.has_kept());
        assert_eq!(*store.kept.lock().unwrap(), None);
    }

    #[test]
    fn signing_out_forgets_an_expiry_does_not() {
        let store = Arc::new(FakeStore::default());
        let sign_in = sign_in_with(&store);
        block_on(sign_in.after_login(LOGIN_BODY, None, 200, SIGNED_IN));
        block_on(sign_in.before_logout(Some("expired")));
        assert!(sign_in.has_kept());
        block_on(sign_in.before_logout(None));
        assert!(!sign_in.has_kept());
        assert_eq!(*store.kept.lock().unwrap(), None);
    }

    #[test]
    fn something_else_in_the_store_counts_for_nothing() {
        let store = Arc::new(FakeStore { kept: Mutex::new(Some("not json".into())), ..Default::default() });
        assert!(!sign_in_with(&store).has_kept());
        assert_eq!(*store.kept.lock().unwrap(), None);
    }

    fn signed_in_store() -> (Arc<FakeStore>, SignIn) {
        let store = Arc::new(FakeStore::default());
        let sign_in = sign_in_with(&store);
        block_on(sign_in.after_login(LOGIN_BODY, None, 200, SIGNED_IN));
        (store, sign_in)
    }

    #[test]
    fn signed_in_again_then_asked_again() {
        let (_, sign_in) = signed_in_store();
        let sent = sign_in.round();
        let tried = std::cell::Cell::new(0);
        assert!(block_on(sign_in.again(sent, |login| {
            tried.set(tried.get() + 1);
            assert_eq!(login.university.as_deref(), Some("univ-rennes"));
            async { Outcome::SignedIn }
        })));
        // A request that left before it: asked again, no second sign-in.
        assert!(block_on(sign_in.again(sent, |_| async { unreachable!() })));
        assert_eq!(tried.get(), 1);
        assert!(sign_in.has_kept());
    }

    #[test]
    fn requests_back_together_make_one_sign_in() {
        let (_, sign_in) = signed_in_store();
        let sign_in = Arc::new(sign_in);
        let tried = Arc::new(AtomicU64::new(0));
        let sent = sign_in.round();
        let answers = block_on(async {
            let tasks: Vec<_> = (0..5)
                .map(|_| {
                    let (sign_in, tried) = (sign_in.clone(), tried.clone());
                    tauri::async_runtime::spawn(async move {
                        sign_in
                            .again(sent, |_| async move {
                                tried.fetch_add(1, Ordering::SeqCst);
                                tokio::time::sleep(Duration::from_millis(20)).await;
                                Outcome::SignedIn
                            })
                            .await
                    })
                })
                .collect();
            let mut answers = Vec::new();
            for task in tasks {
                answers.push(task.await.unwrap());
            }
            answers
        });
        assert_eq!(answers, vec![true; 5]);
        assert_eq!(tried.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_refused_login_or_a_code_is_forgotten() {
        for refusal in [Outcome::Refused, Outcome::SecondFactor] {
            let (store, sign_in) = signed_in_store();
            let sent = sign_in.round();
            assert!(!block_on(sign_in.again(sent, |_| async move { refusal })));
            assert!(!sign_in.has_kept());
            assert_eq!(*store.kept.lock().unwrap(), None);
            // Nothing more is tried.
            assert!(!block_on(sign_in.again(sign_in.round(), |_| async { unreachable!() })));
        }
    }

    #[test]
    fn no_network_keeps_the_login_and_waits_before_trying_again() {
        let (store, sign_in) = signed_in_store();
        let sent = sign_in.round();
        assert!(!block_on(sign_in.again(sent, |_| async { Outcome::NotNow })));
        assert!(sign_in.has_kept());
        assert!(store.kept.lock().unwrap().is_some());
        // The requests of the same burst, and the next ones for a while:
        // the page hears the expiry, nothing is tried.
        assert!(!block_on(sign_in.again(sent, |_| async { unreachable!() })));
        assert!(!block_on(sign_in.again(sign_in.round(), |_| async { unreachable!() })));
    }

    #[test]
    fn nothing_kept_nothing_tried() {
        let sign_in = SignIn::new(None);
        assert!(!block_on(sign_in.again(0, |_| async { unreachable!() })));
    }

    #[test]
    fn debug_builds_keep_it_in_memory_for_the_run() {
        let sign_in = SignIn::new(None);
        block_on(sign_in.after_login(LOGIN_BODY, None, 200, SIGNED_IN));
        assert!(sign_in.has_kept());
        assert!(!SignIn::new(None).has_kept());
    }

    #[test]
    fn the_sign_in_asks_for_no_code_and_names_the_university() {
        let body: serde_json::Value = serde_json::from_slice(&login_request_body(&login(Some("univ-rennes")))).unwrap();
        assert_eq!(body, serde_json::json!({ "username": "jdoe", "password": "right horse", "quiet": true, "university": "univ-rennes" }));
        let body: serde_json::Value = serde_json::from_slice(&login_request_body(&login(None))).unwrap();
        assert!(body.get("university").is_none());
    }

    #[test]
    fn the_password_never_shows_in_a_debug_print() {
        assert!(!format!("{:?}", login(None)).contains("right horse"));
    }
}
