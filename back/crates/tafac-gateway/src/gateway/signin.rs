// POST /__ent_auth/login and POST /__ent_auth/logout: a session made, and
// ended (translate/signin.rs says each answer).
//
// A sign-in, step by step:
//
//   the login      the body as Node reads it: no login or no password is
//                  Node's 400
//   whose          the university the page chose (`university` of the body,
//                  else the X-Tafac-University header: an id, an id without
//                  its dashes, a slug), else the one the address is for,
//                  else the default one (Node's resolveUniversity). One
//                  named that the gateway doesn't serve is refused, in
//                  Node's words for an unknown university: 400 { error:
//                  'Unknown university "<id>".' }; Node is never asked
//   the limits     too many failed attempts from this address or for this
//                  login wait (attempts.rs)
//   tonAPI         signs in at the CAS: the form, the password posted once,
//                  the way back to the portal, the student's component
//   the portal     says who the student is: the session's `user`
//   the cookie     written here (session/cookie.rs) with the CAS ticket and
//                  the portal's cookies; what tonAPI got besides is held in
//                  this process (session/memory.rs)
//
// A second factor (Esup OTP: the CAS answers a right password with its code
// page) is one more step of the same sign-in, in three requests of the
// page's, each with the login and the password, as Node's own login reads
// them:
//
//   no code      the password is posted; the answer is « a code is wanted »,
//                with what the student can type one from. Their only way to
//                a code (no application, one of SMS and mail) is sent
//                unasked, as the university's own page sends it, unless the
//                sign-in is one the student doesn't see (`quiet`: the
//                desktop app signing in again by itself)
//   `sendCode`   the same, and a code sent by SMS or by mail
//   `otp`        the password is posted again, then the code: signed in, or
//                the code refused
//
// Nothing of the first request is kept for the next: the code the
// university sent stays good for the sign-in that follows. The codes sent
// to one login are counted (attempts.rs): past the limit none leaves
// unasked, and asking waits.
//
// Node is asked nothing of a sign-in.

use std::future::Future;

use http::header::CONTENT_TYPE;
use tonapi_providers::{Context, OtpTransport};
use tonapi_session::SessionData;

use super::attempts::{requester, Who};
use super::{now_ms, Asked, Gateway};
use crate::node::{NodeAnswer, NodeRequest, UNIVERSITY_HEADER};
use crate::session::cookie::NewSession;
use crate::session::memory::{self, Ended, Snapshot};
use crate::session::{handed, Held};
use crate::tonapi::signin::{Code, SignIn, Waiting, Ways};
use crate::tonapi::{self, bounded, PORTAL_PATIENCE};
use crate::translate::signin as said;
use crate::universities::University;

// A login or a password longer than this is no CAS's: refused as the CAS
// would refuse it, without asking it.
const MAX_USERNAME_BYTES: usize = 256;
const MAX_PASSWORD_BYTES: usize = 1024;

// The login the page sent, as Node reads it (app.post('/__ent_auth/login')).
struct Login {
    username: String,
    password: String,
    // The university the page chose, in the body, as it was written.
    university: Option<String>,
    // The one-time code, without its spaces: what Node makes of `otp`.
    code: Option<String>,
    // The transport a code is asked by (`sendCode`), when no code came.
    send: Option<OtpTransport>,
    // A sign-in the student doesn't see: no code leaves unasked.
    quiet: bool,
}

// A one-time code is four to ten digits (Node's own check).
fn is_a_code(code: &str) -> bool {
    (4..=10).contains(&code.len()) && code.bytes().all(|byte| byte.is_ascii_digit())
}

// `otp` as Node reads it (String(otp ?? '') without its spaces): a number is
// its digits, and what is neither text nor a number is no code a CAS takes.
fn read_code(otp: Option<&serde_json::Value>) -> Option<String> {
    let code: String = match otp? {
        serde_json::Value::Null => return None,
        serde_json::Value::String(text) => text.chars().filter(|character| !character.is_whitespace()).collect(),
        serde_json::Value::Number(number) => number.to_string(),
        _ => "not a code".to_string(),
    };
    Some(code).filter(|code| !code.is_empty())
}

// The student's only way to a code, which leaves unasked: no application,
// and one of SMS and mail (Node's pickEsupOtpAutoTransport).
fn only_way(ways: Option<&Ways>) -> Option<OtpTransport> {
    let ways = ways.filter(|ways| !ways.app)?;
    match (&ways.sms, &ways.mail) {
        (Some(_), None) => Some(OtpTransport::Sms),
        (None, Some(_)) => Some(OtpTransport::Mail),
        _ => None,
    }
}

// The body as Node reads it: JSON said to be JSON (express.json), each field
// `String(field ?? '')`. None: no login or no password, which Node
// refuses (400), and any body it doesn't read as an object: one that isn't
// JSON, or isn't said to be (Node's own error then, a 400 or a 401 that
// says nothing to the page; the page always sends JSON).
fn read_login(asked: &Asked<'_>) -> Option<Login> {
    // As express.json: only a body said to be JSON is read.
    let content_type = asked.headers.get(CONTENT_TYPE)?.to_str().ok()?;
    if !content_type.split(';').next()?.trim().eq_ignore_ascii_case("application/json") {
        return None;
    }
    let body: serde_json::Value = serde_json::from_slice(asked.body).ok()?;
    let body = body.as_object()?;
    let text = |name: &str| match body.get(name) {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(value) => super::mail::js_string(value),
    };
    let (username, password) = (text("username").trim().to_string(), text("password"));
    if username.is_empty() || password.is_empty() {
        return None;
    }
    let code = read_code(body.get("otp"));
    let send = match body.get("sendCode").and_then(|transport| transport.as_str()).filter(|_| code.is_none()) {
        Some("sms") => Some(OtpTransport::Sms),
        Some("mail") => Some(OtpTransport::Mail),
        _ => None,
    };
    let quiet = body.get("quiet").and_then(|quiet| quiet.as_bool()) == Some(true);
    // findUniversityId reads text only.
    let university = body.get("university").and_then(|university| university.as_str()).map(str::to_string);
    Some(Login { username, password, university, code, send, quiet })
}

// Node's answer to a login without a login or a password.
fn no_login() -> http::Response<Vec<u8>> {
    crate::translate::json_response(400, br#"{"error":"Username and password are required."}"#.to_vec())
}

// A university named that isn't served: Node's words for an unknown one
// (universities/index.js, resolveUniversityId), as an answer.
fn unknown_university(named: &str) -> http::Response<Vec<u8>> {
    let error = format!("Unknown university \"{}\".", named.trim());
    crate::translate::json_response(400, serde_json::to_vec(&serde_json::json!({ "error": error })).unwrap_or_default())
}

// The session's `user`: the portal's own name for the student, when it has
// one (uPortal). A portal without one (Drupal, iSorbonne) leaves the login
// typed, trimmed and in lower case, as Node keeps it for those portals.
fn session_user<'a>(university: &University, named_by_the_portal: &'a str, who: &'a Who) -> &'a str {
    match named_by_the_portal.trim() {
        named if university.portal.names_the_student() && !named.is_empty() => named,
        _ => who.login.as_str(),
    }
}

impl Gateway {
    // A university's id, from a name the page gave: through what the server
    // serves where it says (an id, an id without its dashes, a slug), else
    // an id of the gateway's.
    fn university_named(&self, name: &str) -> Option<String> {
        let id = match &self.served {
            Some(served) => served.named(name)?.to_string(),
            None => name.trim().to_lowercase(),
        };
        self.universities.contains_key(&id).then_some(id)
    }

    // The university a login is for: the one the body names, else the one
    // the header names, else the one a request without a session is for
    // (nobody.rs). Err: the name given first, of a university not served
    // here.
    fn chosen(&self, login: &Login, asked: &Asked<'_>) -> Result<&University, String> {
        let header = asked.headers.get(UNIVERSITY_HEADER).and_then(|value| value.to_str().ok());
        let named: Vec<&str> = [login.university.as_deref(), header].into_iter().flatten().filter(|name| !name.trim().is_empty()).collect();
        let id = match named.iter().find_map(|name| self.university_named(name)) {
            Some(id) => id,
            None if !named.is_empty() => return Err(named[0].to_string()),
            None => self.university_for_nobody(asked.headers),
        };
        self.universities.get(&id).map(|university| &**university).ok_or(id)
    }

    // POST /__ent_auth/login. The demo account's login never comes: the
    // page signs in to the demo by itself (src/demoSession.js), and here it
    // would be a login like any other.
    // None: a body the apps' own Node reads its own way (apps_node_answers).
    pub(super) async fn sign_in(&self, asked: &Asked<'_>) -> Option<http::Response<Vec<u8>>> {
        let Some(login) = read_login(asked) else { return (!self.apps_node_answers()).then(no_login) };
        let university = match self.chosen(&login, asked) {
            Ok(university) => university,
            Err(named) => return Some(unknown_university(&named)),
        };
        let who = Who::new(requester(asked.peer, asked.headers, self.trusted), &login.username);
        if let Some(seconds) = self.attempts.blocked(&who) {
            return Some(said::too_many(seconds));
        }
        // What is no code isn't posted to the CAS: a failed attempt.
        if login.code.as_deref().is_some_and(|code| !is_a_code(code)) {
            return Some(self.failed(&who, said::code_refused()));
        }
        // Too many codes sent to this login lately: asking for one waits.
        let codes_wait = self.attempts.codes_wait(&who);
        if let (Some(_), Some(seconds)) = (login.send, codes_wait) {
            return Some(said::too_many_codes(seconds));
        }
        // Longer than any login or password: no CAS's, a failed attempt.
        if login.username.len() > MAX_USERNAME_BYTES || login.password.len() > MAX_PASSWORD_BYTES {
            return Some(self.failed(&who, said::refused(None)));
        }
        Some(match tonapi::signin::sign_in(university, &login.username, &login.password, self.net).await {
            // No code asked for this time, whatever the page sent.
            SignIn::Done(session) => self.session_made(university, *session, &who).await,
            SignIn::Refused(words) => self.failed(&who, said::refused(words.as_deref())),
            SignIn::SecondFactor(waiting) => match &login.code {
                Some(code) => self.code_given(university, *waiting, code, &who).await,
                // None leaves unasked past the limit, nor for a sign-in the
                // student doesn't see.
                None => self.code_wanted(university, &waiting, login.send, codes_wait.is_none() && !login.quiet, &who).await,
            },
            SignIn::Unsure(why) => {
                eprintln!("[tafac] sign-in: not tried through ({why})");
                self.failed(&who, said::unknown_page())
            }
            SignIn::Unreachable(why) => {
                eprintln!("[tafac] sign-in: not tried through ({why})");
                self.failed(&who, said::unreachable())
            }
        })
    }

    // The CAS took the password and waits for a code: the answer says what
    // the student can type one from, after a code was sent when one is asked
    // for (`asked`) or is the student's only way (`unasked_allowed`). A
    // right password waiting for its code is no failed attempt.
    async fn code_wanted(&self, university: &University, waiting: &Waiting, asked: Option<OtpTransport>, unasked_allowed: bool, who: &Who) -> http::Response<Vec<u8>> {
        let ways = waiting.ways.as_ref();
        let Some(transport) = asked.or_else(|| only_way(ways).filter(|_| unasked_allowed)) else {
            return said::code_wanted(ways, None);
        };
        let has_it = ways.is_some_and(|ways| match transport {
            OtpTransport::Sms => ways.sms.is_some(),
            OtpTransport::Mail => ways.mail.is_some(),
        });
        if has_it && tonapi::signin::send_code(university, waiting, transport, asked.is_none(), self.net).await {
            self.attempts.code_sent(who);
            return said::code_wanted(ways, Some(transport));
        }
        // Unasked, a code that didn't leave is no error: the form offers it.
        match asked {
            Some(_) => said::code_not_sent(ways),
            None => said::code_wanted(ways, None),
        }
    }

    // The student's code, posted to the CAS after the password.
    async fn code_given(&self, university: &University, waiting: Waiting, code: &str, who: &Who) -> http::Response<Vec<u8>> {
        match tonapi::signin::give_code(university, waiting, code, self.net).await {
            Code::Done(session) => self.session_made(university, *session, who).await,
            Code::Refused => self.failed(who, said::code_refused()),
            Code::StartedOver => self.failed(who, said::started_over()),
            Code::Unreachable(why) => {
                eprintln!("[tafac] sign-in: the code not tried through ({why})");
                self.failed(who, said::unreachable())
            }
        }
    }

    // tonAPI signed in: the portal says who the student is, and the session
    // is made of what tonAPI holds.
    async fn session_made(&self, university: &University, mut signed_in: SessionData, who: &Who) -> http::Response<Vec<u8>> {
        // The portal's own name for the student, as Node takes it from the
        // portal: what the session check compares each answer of the portal
        // with from then on.
        let profile = {
            let mut context = Context { university: &university.settings, session: &mut signed_in, now: chrono::Utc::now(), net: self.net };
            bounded(PORTAL_PATIENCE, tonapi_providers::profile(&mut context)).await
        };
        let Ok(Ok(profile)) = profile.map(|asked| asked.map(|fetched| fetched.data)) else {
            return self.failed(who, said::no_portal_session());
        };
        let user = session_user(university, &profile.username, who);

        let (ticket, others) = handed::for_the_cookie(university, &signed_in.cookies);
        let new = NewSession { university: &university.settings.university.id, user, ticket: &ticket, others: &others, secure: university.asked_over_https() };
        let Some((cookie, session)) = self.codec.write(&new, now_ms()) else {
            eprintln!("[tafac] sign-in: no session made (the system gave no random bytes)");
            return said::unreachable();
        };

        // What the session holds from its first moment: the sessions tonAPI
        // opened besides the portal's, the component it found, the profile.
        let in_the_cookie: Vec<_> = ticket.iter().chain(&others).map(handed::stored_cookie).collect();
        let memory = self.memory.of(&session.id, memory::student(&session.university, &session.user).as_deref());
        memory.keep(&Snapshot::default(), &signed_in, &in_the_cookie);
        memory.detected(signed_in.establishment.clone());
        memory.keep_profile(&profile);
        self.attempts.signed_in(who);
        let answer = said::signed_in(&session.user, &session.university, (&self.cookie_name, &cookie));
        // The home page's answers are asked from now, before the page asks.
        self.ask_ahead(&Held { session, university, memory });
        answer
    }

    // A sign-in that failed, counted: past the limit the answer is the wait.
    fn failed(&self, who: &Who, answer: http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
        match self.attempts.failed(who) {
            Some(seconds) => said::too_many(seconds),
            None => answer,
        }
    }

    // POST /__ent_auth/logout, for a session held here. It ends here first:
    // no request still on its way is answered for it. Then the CAS is told
    // (tonAPI, with the ticket), and Node (its own sign-out, with the
    // session's cookie), for what it kept of the session and the webmail's
    // own. Neither answer changes the page's: the student is signed out of
    // Tafac whatever they say.
    pub(super) async fn sign_out<N, Fut>(&self, held: &Held<'_>, cookie: &str, node: &N) -> http::Response<Vec<u8>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        // The webmail's session read first, then the session ended, then
        // the webmail's and the CAS's ended together.
        self.memory.end(&held.session.id, Ended::SignedOut);
        tokio::join!(self.mail_ended(&held.session.id), tonapi::signin::sign_out(held.university, &held.session, self.net), self.tell_node_it_ended(cookie, node));
        said::signed_out(&self.cookie_name)
    }
}

#[cfg(test)]
mod tests {
    use http::{HeaderMap, Method};

    use super::*;

    fn read(content_type: &str, body: &str) -> Option<Login> {
        let mut headers = HeaderMap::new();
        if !content_type.is_empty() {
            headers.insert(CONTENT_TYPE, content_type.parse().unwrap());
        }
        read_login(&Asked { method: &Method::POST, path: "/__ent_auth/login", query: None, headers: &headers, body: body.as_bytes(), peer: None })
    }

    const JSON: &str = "application/json";

    #[test]
    fn a_login_is_read_as_node_reads_it() {
        let login = read("application/json; charset=utf-8", r#"{"username":" JDoe ","password":" pass word ","university":" Univ-Rennes "}"#).unwrap();
        assert_eq!((login.username.as_str(), login.password.as_str(), login.university.as_deref()), ("JDoe", " pass word ", Some(" Univ-Rennes ")));
        assert_eq!((login.code, login.send, login.quiet), (None, None, false));
        let quiet = read(JSON, r#"{"username":"jdoe","password":"p","quiet":true}"#).unwrap();
        assert!(quiet.university.is_none() && quiet.quiet);
        assert!(!read(JSON, r#"{"username":"jdoe","password":"p","quiet":"true"}"#).unwrap().quiet);
    }

    #[test]
    fn a_code_and_a_code_asked_for_are_read_as_node_reads_them() {
        let second_factor = |more: &str| {
            let login = read(JSON, &format!(r#"{{"username":"jdoe","password":"p",{more}}}"#)).unwrap();
            (login.code, login.send)
        };
        // The code without its spaces; a number is its digits.
        assert_eq!(second_factor(r#""otp":" 123 456 ""#), (Some("123456".to_string()), None));
        assert_eq!(second_factor(r#""otp":123456"#), (Some("123456".to_string()), None));
        assert_eq!(second_factor(r#""otp":"","sendCode":null"#), (None, None));
        assert_eq!(second_factor(r#""otp":"   ","sendCode":"mail""#), (None, Some(OtpTransport::Mail)));
        assert_eq!(second_factor(r#""sendCode":"sms""#), (None, Some(OtpTransport::Sms)));
        // Another transport is none; a code comes before a code asked for.
        assert_eq!(second_factor(r#""sendCode":"push""#), (None, None));
        assert_eq!(second_factor(r#""sendCode":7"#), (None, None));
        assert_eq!(second_factor(r#""otp":"123456","sendCode":"sms""#), (Some("123456".to_string()), None));

        // What is no code: said without the CAS being asked.
        for (otp, is_one) in [("1234", true), ("1234567890", true), ("123", false), ("12345678901", false), ("12a456", false), ("１２３４５６", false)] {
            assert_eq!(is_a_code(otp), is_one, "{otp}");
        }
        let (code, _) = second_factor(r#""otp":true"#);
        assert!(!is_a_code(&code.unwrap()));
        let (code, _) = second_factor(r#""otp":["123456"]"#);
        assert!(!is_a_code(&code.unwrap()));
    }

    #[test]
    fn a_code_leaves_unasked_only_when_it_is_the_only_way() {
        let ways = |app: bool, sms: Option<&str>, mail: Option<&str>| Ways { app, sms: sms.map(str::to_string), mail: mail.map(str::to_string) };
        assert_eq!(only_way(Some(&ways(false, None, Some("j***@exemple.test")))), Some(OtpTransport::Mail));
        assert_eq!(only_way(Some(&ways(false, Some("06******12"), None))), Some(OtpTransport::Sms));
        assert_eq!(only_way(Some(&ways(false, Some("06******12"), Some("j***@exemple.test")))), None);
        assert_eq!(only_way(Some(&ways(true, None, Some("j***@exemple.test")))), None);
        assert_eq!(only_way(Some(&ways(false, None, None))), None);
        assert_eq!(only_way(None), None);
    }

    #[test]
    fn a_body_without_a_login_is_none() {
        for (content_type, body) in [
            (JSON, r#"{"username":"","password":"p"}"#),
            (JSON, r#"{"username":"   ","password":"p"}"#),
            (JSON, r#"{"username":"jdoe"}"#),
            (JSON, r#"{"username":"jdoe","password":""}"#),
            (JSON, r#"["jdoe","p"]"#),
            (JSON, "not json"),
            (JSON, ""),
            ("text/plain", r#"{"username":"jdoe","password":"p"}"#),
            ("", r#"{"username":"jdoe","password":"p"}"#),
        ] {
            assert!(read(content_type, body).is_none(), "{content_type} {body}");
        }
        // What isn't text is read as JavaScript writes it; a university
        // that isn't text names none.
        let login = read(JSON, r#"{"username":12,"password":["p",1],"university":7}"#).unwrap();
        assert_eq!((login.username.as_str(), login.password.as_str(), login.university), ("12", "p,1", None));
        assert_eq!(body_of(&no_login()), serde_json::json!({ "error": "Username and password are required." }));
        assert_eq!(no_login().status(), 400);
        assert_eq!(body_of(&unknown_university(" univ-nulle-part ")), serde_json::json!({ "error": "Unknown university \"univ-nulle-part\"." }));
    }

    fn body_of(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_sessions_user_is_the_portals_name_or_the_login_typed() {
        let who = Who::new("203.0.113.7".to_string(), " JDoe ");
        let uportal = University::of(crate::testing::campus().settings()).unwrap();
        assert_eq!(session_user(&uportal, " e21901234 ", &who), "e21901234");
        assert_eq!(session_user(&uportal, "  ", &who), "jdoe");
        // No name of the portal's own: tonAPI's profile says the login as
        // typed, and the session keeps it as Node does.
        for campus in [crate::testing::drupal_campus(), crate::testing::isorbonne_campus()] {
            let university = University::of(campus.settings()).unwrap();
            assert_eq!(session_user(&university, "JDoe", &who), "jdoe");
        }
    }
}
