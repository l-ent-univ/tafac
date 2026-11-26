// POST /__ent_auth/login and POST /__ent_auth/logout: a session made, and
// ended (translate/signin.rs says each answer).
//
// A sign-in, step by step:
//
//   whose          the university the page chose (`university` of the body,
//                  else the X-Tafac-University header), when it is one of
//                  routes.rs'. Any other, and a body Node would refuse, is
//                  Node's
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
// Node is asked nothing of a sign-in at a university of routes.rs'.

use std::future::Future;

use http::header::CONTENT_TYPE;
use tonapi_providers::{Context, OtpTransport};
use tonapi_session::SessionData;

use super::attempts::{requester, Who};
use super::{now_ms, Asked, Gateway};
use crate::node::{NodeAnswer, NodeRequest, UNIVERSITY_HEADER};
use crate::session::cookie::NewSession;
use crate::session::memory::{Ended, Snapshot};
use crate::session::{handed, Held};
use crate::tonapi::signin::{Code, SignIn, Waiting, Ways};
use crate::tonapi::{self, bounded, PORTAL_PATIENCE};
use crate::translate::signin as said;
use crate::universities::University;

// A login or a password longer than this is nobody's: Node's to answer.
const MAX_USERNAME_BYTES: usize = 256;
const MAX_PASSWORD_BYTES: usize = 1024;

// The login the page sent, as Node reads it (app.post('/__ent_auth/login')).
struct Login {
    username: String,
    password: String,
    // The university the page chose, in the body.
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

// None: a body Node would refuse or read its own way (not JSON, no login,
// no password, a field that isn't text).
fn read_login(asked: &Asked<'_>) -> Option<Login> {
    // As express.json: only a body said to be JSON is read.
    let content_type = asked.headers.get(CONTENT_TYPE)?.to_str().ok()?;
    if !content_type.split(';').next()?.trim().eq_ignore_ascii_case("application/json") {
        return None;
    }
    let body: serde_json::Value = serde_json::from_slice(asked.body).ok()?;
    let body = body.as_object()?;
    let text = |name: &str| match body.get(name) {
        None | Some(serde_json::Value::Null) => Some(String::new()),
        Some(serde_json::Value::String(value)) => Some(value.clone()),
        Some(_) => None,
    };
    let (username, password) = (text("username")?.trim().to_string(), text("password")?);
    if username.is_empty() || password.is_empty() || username.len() > MAX_USERNAME_BYTES || password.len() > MAX_PASSWORD_BYTES {
        return None;
    }
    let code = read_code(body.get("otp"));
    let send = match body.get("sendCode").and_then(|transport| transport.as_str()).filter(|_| code.is_none()) {
        Some("sms") => Some(OtpTransport::Sms),
        Some("mail") => Some(OtpTransport::Mail),
        _ => None,
    };
    let quiet = body.get("quiet").and_then(|quiet| quiet.as_bool()) == Some(true);
    let university = text("university")?.trim().to_lowercase();
    Some(Login { username, password, university: Some(university).filter(|id| !id.is_empty()), code, send, quiet })
}

impl Gateway {
    // The university a login is for, when it is one answered here: the one
    // the body names, else the one the header names (Node's resolveUniversity,
    // for the ids; a slug, a host's university, the default one are Node's
    // to know).
    fn chosen(&self, login: &Login, asked: &Asked<'_>) -> Option<&University> {
        let named = match &login.university {
            Some(id) => id.clone(),
            None => asked.headers.get(UNIVERSITY_HEADER)?.to_str().ok()?.trim().to_lowercase(),
        };
        self.universities.get(&named)
    }

    // POST /__ent_auth/login. None: a sign-in that is Node's (another
    // university, a body Node reads its own way). The demo account's login
    // never comes: the page signs in to the demo by itself
    // (src/demoSession.js), and here it would be a login like any other.
    pub(super) async fn sign_in(&self, asked: &Asked<'_>) -> Option<http::Response<Vec<u8>>> {
        let login = read_login(asked)?;
        let university = self.chosen(&login, asked)?;
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
        let user = match profile.username.trim() {
            "" => who.login.as_str(),
            named => named,
        };

        let (ticket, others) = handed::for_the_cookie(university, &signed_in.cookies);
        let new = NewSession { university: &university.settings.university.id, user, ticket: &ticket, others: &others, secure: university.asked_over_https() };
        let Some((cookie, session)) = self.codec.write(&new, now_ms()) else {
            eprintln!("[tafac] sign-in: no session made (the system gave no random bytes)");
            return said::unreachable();
        };

        // What the session holds from its first moment: the sessions tonAPI
        // opened besides the portal's, the component it found, the profile.
        let in_the_cookie: Vec<_> = ticket.iter().chain(&others).map(handed::stored_cookie).collect();
        let memory = self.memory.of(&session.id);
        memory.keep(&Snapshot::default(), &signed_in, &in_the_cookie);
        memory.detected(signed_in.establishment.clone());
        memory.keep_profile(&profile);
        self.attempts.signed_in(who);
        said::signed_in(&session.user, &session.university, (&self.cookie_name, &cookie))
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
        self.memory.end(&held.session.id, Ended::SignedOut);
        tokio::join!(tonapi::signin::sign_out(held.university, &held.session, self.net), self.tell_node_it_ended(cookie, node));
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
        assert_eq!((login.username.as_str(), login.password.as_str(), login.university.as_deref()), ("JDoe", " pass word ", Some("univ-rennes")));
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
    fn what_node_would_refuse_or_read_its_own_way_is_nodes() {
        for (content_type, body) in [
            (JSON, r#"{"username":"","password":"p"}"#),
            (JSON, r#"{"username":"   ","password":"p"}"#),
            (JSON, r#"{"username":"jdoe"}"#),
            (JSON, r#"{"username":"jdoe","password":""}"#),
            (JSON, r#"{"username":12,"password":"p"}"#),
            (JSON, r#"{"username":"jdoe","password":"p","university":7}"#),
            (JSON, r#"["jdoe","p"]"#),
            (JSON, "not json"),
            (JSON, ""),
            ("text/plain", r#"{"username":"jdoe","password":"p"}"#),
            ("", r#"{"username":"jdoe","password":"p"}"#),
        ] {
            assert!(read(content_type, body).is_none(), "{content_type} {body}");
        }
        let long = format!(r#"{{"username":"{}","password":"p"}}"#, "x".repeat(MAX_USERNAME_BYTES + 1));
        assert!(read(JSON, &long).is_none());
    }
}
