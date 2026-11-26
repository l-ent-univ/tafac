// POST /__ent_auth/login and POST /__ent_auth/logout: a session made, and
// ended (translate/signin.rs says each answer).
//
// A sign-in, step by step:
//
//   whose          the university the page chose (`university` of the body,
//                  else the X-Tafac-University header), when it is one of
//                  routes.rs'. Any other, and a body Node would refuse, is
//                  Node's
//   the demo       the demo account never reaches a university: Node's
//   the limits     too many failed attempts from this address or for this
//                  login wait (attempts.rs)
//   tonAPI         signs in at the CAS: the form, the password posted once,
//                  the way back to the portal, the student's component
//   the portal     says who the student is: the session's `user`
//   the cookie     written here (session/cookie.rs) with the CAS ticket and
//                  the portal's cookies; what tonAPI got besides is held in
//                  this process (session/memory.rs)
//
// A second factor is the one sign-in tonAPI can't finish at Rennes: its
// esup-otp is another university's variant, and it has no code sent by SMS
// or mail. When the CAS asks for one (or answers a page tonAPI doesn't
// know), and when the page sends a code or asks for one, the page's request
// goes to Node's own login, which posts the password itself. The session
// Node makes is one like any other here: the same cookie, the same
// User-Agent.

use std::future::Future;

use http::header::CONTENT_TYPE;
use tonapi_providers::Context;
use tonapi_session::SessionData;

use super::attempts::{requester, Who};
use super::{now_ms, Asked, Gateway};
use crate::node::{self, NodeAnswer, NodeRequest, UNIVERSITY_HEADER};
use crate::session::cookie::NewSession;
use crate::session::memory::{Ended, Snapshot};
use crate::session::{handed, Held};
use crate::tonapi::signin::SignIn;
use crate::tonapi::{self, bounded, PORTAL_PATIENCE};
use crate::translate::signin::{self as said, NodeSaid};
use crate::universities::University;

// The demo account's login, which is public (src/demoAccount.js:
// DEMO_CREDENTIALS; a test below reads them there).
const DEMO_USERNAME: &str = "demo@tafac.fr";
const DEMO_PASSWORD: &str = "tafac-demo";
// A login or a password longer than this is nobody's: Node's to answer.
const MAX_USERNAME_BYTES: usize = 256;
const MAX_PASSWORD_BYTES: usize = 1024;

// The login the page sent, as Node reads it (app.post('/__ent_auth/login')).
struct Login {
    username: String,
    password: String,
    // The university the page chose, in the body.
    university: Option<String>,
    // A one-time code, or the request to have one sent.
    second_factor: bool,
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
    let code = body.get("otp").is_some_and(|code| code.as_str().map_or(!code.is_null(), |code| !code.trim().is_empty()));
    let send_code = body.get("sendCode").is_some_and(|transport| !transport.is_null());
    let university = text("university")?.trim().to_lowercase();
    Some(Login { username, password, university: Some(university).filter(|id| !id.is_empty()), second_factor: code || send_code })
}

fn is_demo(login: &Login) -> bool {
    login.username.to_lowercase() == DEMO_USERNAME && login.password == DEMO_PASSWORD
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

    // POST /__ent_auth/login. `cookie`: the session cookie the request came
    // with, if any (it goes to Node with the request when Node answers).
    pub(super) async fn sign_in<N, Fut>(&self, asked: &Asked<'_>, cookie: Option<&str>, node: &N) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let login = read_login(asked)?;
        let university = self.chosen(&login, asked)?;
        if is_demo(&login) {
            return None;
        }
        let who = Who::new(requester(asked.peer, asked.headers, self.trusted), &login.username);
        if let Some(seconds) = self.attempts.blocked(&who) {
            return Some(said::too_many(seconds));
        }
        if login.second_factor {
            return self.nodes_sign_in(asked, cookie, node, &who, "a one-time code").await;
        }
        match tonapi::signin::sign_in(university, &login.username, &login.password, self.net).await {
            SignIn::Done(session) => Some(self.session_made(university, *session, &who).await),
            SignIn::Refused(words) => Some(self.failed(&who, said::refused(words.as_deref()))),
            SignIn::Unsure(why) => self.nodes_sign_in(asked, cookie, node, &who, why).await,
            SignIn::Unreachable(why) => {
                eprintln!("[tafac] sign-in: not tried through ({why})");
                Some(self.failed(&who, said::unreachable()))
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

    // Node's own login, with the page's request as it came, and its answer
    // as it comes (with the cookie of the session it made). What it says of
    // the attempt counts here too. None: Node can't be reached, and the
    // caller finds that out the same way.
    async fn nodes_sign_in<N, Fut>(&self, asked: &Asked<'_>, cookie: Option<&str>, node: &N, who: &Who, why: &str) -> Option<http::Response<Vec<u8>>>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        eprintln!("[tafac] sign-in: left to Node ({why})");
        let answer = node(node::as_it_came(asked, &self.cookie_name, cookie)?).await?;
        match said::node_said(answer.status().as_u16(), answer.body()) {
            NodeSaid::SignedIn => self.attempts.signed_in(who),
            NodeSaid::Failed => {
                if let Some(seconds) = self.attempts.failed(who) {
                    return Some(said::too_many(seconds));
                }
            }
            NodeSaid::Neither => {}
        }
        Some(answer)
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
        assert_eq!((login.username.as_str(), login.password.as_str(), login.university.as_deref(), login.second_factor), ("JDoe", " pass word ", Some("univ-rennes"), false));
        assert!(read(JSON, r#"{"username":"jdoe","password":"p","quiet":true}"#).unwrap().university.is_none());

        // A one-time code, or one asked for: the second factor's leg.
        assert!(read(JSON, r#"{"username":"jdoe","password":"p","otp":"123 456"}"#).unwrap().second_factor);
        assert!(read(JSON, r#"{"username":"jdoe","password":"p","sendCode":"sms"}"#).unwrap().second_factor);
        assert!(read(JSON, r#"{"username":"jdoe","password":"p","otp":123456}"#).unwrap().second_factor);
        assert!(!read(JSON, r#"{"username":"jdoe","password":"p","otp":"","sendCode":null}"#).unwrap().second_factor);
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

    // The demo account's login is Node's own: held to what Node has.
    #[test]
    fn the_demo_account_is_the_one_node_knows() {
        let source = include_str!("../../../../../src/demoAccount.js");
        assert!(source.contains(&format!("username: '{DEMO_USERNAME}'")) && source.contains(&format!("password: '{DEMO_PASSWORD}'")));
        assert!(is_demo(&read(JSON, r#"{"username":" Demo@Tafac.fr ","password":"tafac-demo"}"#).unwrap()));
        assert!(!is_demo(&read(JSON, r#"{"username":"demo@tafac.fr","password":"Tafac-Demo"}"#).unwrap()));
    }
}
