// The mail page's routes, /__ent_auth/mail/*, answered here with tonAPI's
// webmail (tonapi_providers::zimbra): Node's sixteen routes, their JSON,
// statuses and error codes as the page reads them (server/entAuthApp.js).
//
//   mod.rs        which route (as Express matches it), the order of the
//                 checks before it, a failure, the webmail's sign-in and
//                 the one retry when it refuses the session
//   state.rs      what a session's mail holds in this process
//   read.rs       recent, message, thread, folders, prefs, open
//   part.rs       part: a message's part, streamed
//   organise.rs   action, folder-action
//   write.rs      autocomplete, signatures, signature
//   compose.rs    message, draft (read and saved), send
//   upload.rs     upload, the file streamed to the webmail
//
// The order of the checks is Node's (its middleware, then the route), and
// it matters: an upload is refused before a byte of it is read, a send or
// a draft is refused and counted before its body is read; every other
// route's JSON body is read, then the feature, then the mail routes' own
// limit, then the route.
//
// Every path under /__ent_auth/mail is answered here, in any case, with or
// without a slash at its end, HEAD as GET (Express's router): none reaches
// Node, which would skip the limits here.
//
// A failure is always `500 { error: 'mail_unavailable' }` (the part's: an
// empty 502; the open link's: the webmail's own link), after the CAS is
// asked whether the session is over: then the session ends and the page is
// told (`X-Tafac-Session: expired`). The log says the route, the kind of
// failure, the webmail's request, its fault code cleaned and the HTTP
// status: never a token, a cookie, an address with its query, a search,
// a recipient, a subject, a text or a file's name.

mod account;
mod compose;
mod organise;
mod part;
mod read;
pub(crate) mod state;
mod upload;
mod write;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;

use bytes::Bytes;
use futures_util::stream::{Stream, StreamExt};
use http::header::{CONNECTION, RETRY_AFTER};
use http::{HeaderValue, Method};
use serde_json::{json, Value};
use tonapi_config::MailService;
use tonapi_providers::zimbra::webmail::{self, PartError, SignIn, SignInDomains, SignInError, SoapError, Webmail};

use self::state::{Context, MailSession, NoContext};
use super::{now_ms, Asked, Gateway};
use crate::mail::request;
use crate::node::{NodeAnswer, NodeRequest, SESSION_EXPIRED, SESSION_HEADER};
use crate::routes::Moved;
use crate::session::handed;
use crate::session::Held;
use crate::translate::json_response;

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;
pub type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, BoxError>> + Send>>;

// A request's or an answer's body: whole (the apps' bridge, a JSON answer)
// or as it streams (tafac.fr's server: an upload, a part).
pub enum MailBody {
    Whole(Vec<u8>),
    Stream(ByteStream),
}

impl MailBody {
    fn empty() -> Self {
        MailBody::Whole(Vec::new())
    }

    // The body read whole, `limit` bytes at most: None past it (or a body
    // that broke off). A minute at most between two pieces, five minutes in
    // all: a client sending a byte now and then holds no connection longer
    // (Node's server bounds it so, its requestTimeout).
    pub(crate) async fn read(self, limit: usize) -> Result<Vec<u8>, Unread> {
        self.read_within(limit, BODY_IDLE, BODY_DEADLINE).await
    }

    async fn read_within(self, limit: usize, idle: Duration, deadline: Duration) -> Result<Vec<u8>, Unread> {
        match self {
            MailBody::Whole(bytes) if bytes.len() > limit => Err(Unread::TooLarge),
            MailBody::Whole(bytes) => Ok(bytes),
            MailBody::Stream(mut stream) => {
                let end = Instant::now() + deadline;
                let mut bytes = Vec::new();
                loop {
                    let wait = idle.min(end.saturating_duration_since(Instant::now()));
                    let next = match tokio::time::timeout(wait, stream.next()).await {
                        Err(_) => return Err(Unread::Slow),
                        Ok(None) => return Ok(bytes),
                        Ok(Some(next)) => next,
                    };
                    let chunk = next.map_err(|_| Unread::Broken)?;
                    if bytes.len() + chunk.len() > limit {
                        return Err(Unread::TooLarge);
                    }
                    bytes.extend_from_slice(&chunk);
                }
            }
        }
    }

    // As a stream, whatever it was.
    pub(crate) fn into_stream(self) -> ByteStream {
        match self {
            MailBody::Stream(stream) => stream,
            MailBody::Whole(bytes) => Box::pin(futures_util::stream::once(async move { Ok::<_, BoxError>(Bytes::from(bytes)) })),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Unread {
    TooLarge,
    Broken,
    Slow,
}

// A JSON body's pace: a minute at most between two pieces, five minutes in
// all.
const BODY_IDLE: Duration = Duration::from_secs(60);
const BODY_DEADLINE: Duration = Duration::from_secs(300);

// The page's mail routes, by Node's paths.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    Recent,
    Message,
    Thread,
    Folders,
    Prefs,
    Autocomplete,
    Signatures,
    DraftRead,
    Part,
    Open,
    Action,
    FolderAction,
    Signature,
    Upload,
    DraftSave,
    Send,
}

impl Route {
    // As the log names it (Node's sendMailRouteError).
    fn name(self) -> &'static str {
        match self {
            Route::Recent => "recent",
            Route::Message => "message",
            Route::Thread => "thread",
            Route::Folders => "folders",
            Route::Prefs => "prefs",
            Route::Autocomplete => "autocomplete",
            Route::Signatures => "signatures",
            Route::DraftRead | Route::DraftSave => "draft",
            Route::Part => "part",
            Route::Open => "open",
            Route::Action => "action",
            Route::FolderAction => "folder-action",
            Route::Signature => "signature",
            Route::Upload => "upload",
            Route::Send => "send",
        }
    }
}

const PREFIX: &str = "/__ent_auth/mail";

// Whether a path is the mail's, in any case (Express matches paths so).
pub(crate) fn is_mail_path(path: &str) -> bool {
    path.get(..PREFIX.len()).is_some_and(|start| start.eq_ignore_ascii_case(PREFIX)) && matches!(path.as_bytes().get(PREFIX.len()), None | Some(b'/'))
}

// The route a request is, as Express's router matches it: the path in any
// case, one slash after it or none, HEAD as GET. `true` with it: a HEAD,
// answered without a body.
pub(crate) fn route(method: &Method, path: &str) -> Option<(Route, bool)> {
    if !is_mail_path(path) {
        return None;
    }
    let rest = path[PREFIX.len()..].to_ascii_lowercase();
    let rest = rest.strip_suffix('/').unwrap_or(&rest);
    let head = method == Method::HEAD;
    let get = method == Method::GET || head;
    let post = method == Method::POST;
    let found = match rest {
        "/recent" if get => Route::Recent,
        "/message" if get => Route::Message,
        "/thread" if get => Route::Thread,
        "/folders" if get => Route::Folders,
        "/prefs" if get => Route::Prefs,
        "/autocomplete" if get => Route::Autocomplete,
        "/signatures" if get => Route::Signatures,
        "/draft" if get => Route::DraftRead,
        "/part" if get => Route::Part,
        "/open" if get => Route::Open,
        "/action" if post => Route::Action,
        "/folder-action" if post => Route::FolderAction,
        "/signature" if post => Route::Signature,
        "/upload" if post => Route::Upload,
        "/draft" if post => Route::DraftSave,
        "/send" if post => Route::Send,
        _ => return None,
    };
    Some((found, head))
}

// A request to the webmail: its answer within 15 seconds.
pub(crate) const SOAP_TIMEOUT: std::time::Duration = webmail::REQUEST_TIMEOUT;

// `String(value)` in JavaScript, for the values the page's JSON may hold
// where Node converts them so (`ids.map(String)`, `String(folder)`).
pub(crate) fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => match (number.as_i64(), number.as_u64(), number.as_f64()) {
            (Some(integer), _, _) => integer.to_string(),
            (_, Some(integer), _) => integer.to_string(),
            // An integer written with a fraction (257.0) is 257 to JavaScript.
            (_, _, Some(float)) if float.fract() == 0.0 && float.abs() < 1e21 => format!("{float:.0}"),
            (_, _, Some(float)) => float.to_string(),
            _ => String::new(),
        },
        // An array's elements joined by commas, null as nothing.
        Value::Array(items) => items.iter().map(|item| if item.is_null() { String::new() } else { js_string(item) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

// The query, its parameters as Express reads them: one value, or none (a
// key given twice, or with brackets, is no value a route accepts).
pub(crate) struct Query<'a>(Option<&'a str>);

impl Query<'_> {
    pub(crate) fn text(&self, name: &str) -> Option<String> {
        request::query_value(self.0, name).one().map(str::to_string)
    }
}

// The host the request was made to, without its port.
fn own_host(asked: &Asked<'_>) -> Option<String> {
    let host = asked.headers.get(http::header::HOST)?.to_str().ok()?;
    let host = if host.starts_with('[') { host.split(']').next().map(|h| format!("{h}]"))? } else { host.split(':').next()?.to_string() };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

// A JSON body as express.json reads it: its headers checked before a byte
// is read, then `limit` bytes at most.
async fn read_json(asked: &Asked<'_>, body: MailBody, limit: usize) -> Result<Value, request::BodyRefusal> {
    request::check_json_headers(asked.headers, limit)?;
    let bytes = body.read(limit).await.map_err(|unread| match unread {
        Unread::TooLarge => request::BodyRefusal::TooLarge,
        Unread::Broken => request::BodyRefusal::Malformed,
        Unread::Slow => request::BodyRefusal::Slow,
    })?;
    request::read_json(asked.headers, &bytes, limit)
}

// Node's limits on the bodies: express.json()'s, and the composer's.
const JSON_LIMIT: usize = 100 * 1024;
pub(crate) const COMPOSE_LIMIT: usize = 2 * 1024 * 1024;

// ── Answers ────────────────────────────────────────────────────────────────

// A JSON answer of the mail's: never kept.
pub(crate) fn reply(status: u16, body: &Value) -> http::Response<MailBody> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default()).map(MailBody::Whole)
}

pub(crate) fn error(status: u16, code: &str) -> http::Response<MailBody> {
    reply(status, &json!({ "error": code }))
}

// A refusal sent before the body is read: the connection closes after it,
// so the rest of the body isn't read to be thrown away.
pub(crate) fn closing(mut response: http::Response<MailBody>) -> http::Response<MailBody> {
    response.headers_mut().insert(CONNECTION, HeaderValue::from_static("close"));
    response
}

pub(crate) fn retry_after(mut response: http::Response<MailBody>, seconds: u64) -> http::Response<MailBody> {
    if let Ok(value) = HeaderValue::from_str(&seconds.max(1).to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

fn no_session() -> http::Response<MailBody> {
    error(401, "Authentication required.")
}

fn disabled() -> http::Response<MailBody> {
    reply(404, &json!({ "ok": false, "disabled": true, "feature": "mail" }))
}

// An answer with an empty body (the part's errors).
pub(crate) fn empty(status: u16) -> http::Response<MailBody> {
    let mut response = json_response(status, Vec::new()).map(|_| MailBody::empty());
    response.headers_mut().remove(http::header::CONTENT_TYPE);
    response
}

// ── Failures ───────────────────────────────────────────────────────────────

// Why a mail route has no answer of its own.
#[derive(Debug)]
pub(crate) enum MailError {
    // The webmail's sign-in failed.
    SignIn(SignInError),
    // A request to the webmail failed (refused, a fault, an outage).
    Soap(SoapError),
    // The part's or the upload's request: the webmail refused the session.
    Refused(&'static str),
    // The network, a timeout, an answer not understood.
    Other(String),
    // No CAS ticket to sign in to the webmail with.
    NoTicket,
    // The session ended while the webmail was asked.
    Ended,
}

impl MailError {
    // The webmail refused the session: a new sign-in may help.
    fn refused(&self) -> bool {
        matches!(self, MailError::Soap(error) if error.refused) || matches!(self, MailError::Refused(_))
    }

    // Whether the CAS is asked about the session (every failure but a
    // session that already ended: answerIfSessionExpired).
    fn may_be_expired(&self) -> bool {
        !matches!(self, MailError::Ended)
    }

    // For the log: never a token, an address with its query, a body.
    fn words(&self) -> String {
        let said = match self {
            MailError::SignIn(error) => format!("SignInError: {error}"),
            MailError::Soap(error) => format!("SoapError: {error}"),
            MailError::Refused(what) => format!("Refused: Zimbra {what} rejected the session"),
            MailError::Other(why) => format!("Error: {why}"),
            MailError::NoTicket => "Error: CAS session unavailable for mail".to_string(),
            MailError::Ended => "Error: the session ended".to_string(),
        };
        said.chars().take(300).collect()
    }
}

impl From<SoapError> for MailError {
    fn from(error: SoapError) -> Self {
        MailError::Soap(error)
    }
}

impl From<PartError> for MailError {
    fn from(error: PartError) -> Self {
        match error {
            PartError::Refused => MailError::Refused("REST"),
            PartError::Network(why) => MailError::Other(why),
        }
    }
}

// One request's session and its mail.
pub(crate) struct Call<'a, 'b> {
    pub held: &'a Held<'b>,
    pub mail: Arc<MailSession>,
    pub route: Route,
    // The session's cookie as it came, for Node to be told it ended.
    pub cookie: &'a str,
    // The host the page is served from: a received mail's links to it are
    // dropped (W6).
    pub own_host: Option<String>,
}

impl Gateway {
    // Whether a request is the mail's, answered here whatever its cookie:
    // one that is nobody's (not readable, past its lifetime, the demo
    // account's from before, made with a secret no longer taken, a session
    // of a university the gateway doesn't serve) is answered as no
    // session, as Node answered it. The server streams the body in then
    // (proxy.rs).
    pub fn takes_mail(&self, path: &str, _cookie: Option<&str>) -> bool {
        is_mail_path(path)
    }

    // A mail request (takes_mail), its body as it comes, and its answer.
    pub async fn mail<C, N, Fut>(&self, asked: &Asked<'_>, body: MailBody, cookie: C, node: N) -> http::Response<MailBody>
    where
        C: Fn() -> Option<String>,
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let Some((route, head)) = route(asked.method, asked.path) else {
            // Express's own 404, as JSON.
            return error(404, "Not found.");
        };
        let value = cookie();
        let mut response = self.mail_route(route, asked, body, value.as_deref(), &node).await;
        // No session of the app's own: every answer says so to the page.
        if value.as_deref().and_then(|cookie| self.signed_in(Some(cookie))).is_none() {
            response.headers_mut().insert(SESSION_HEADER, HeaderValue::from_static(SESSION_EXPIRED));
        }
        if head {
            *response.body_mut() = MailBody::empty();
        }
        response
    }

    // Whether the university of a session (or of a request without one)
    // has the mail: Zimbra's webmail in tonAPI's settings.
    fn has_mail(&self, university: &str) -> bool {
        self.universities.get(university).is_some_and(|found| matches!(found.settings.university.services.mail, Some(MailService::ZimbraRest { .. })))
    }

    // The university a request is about: its session's, or the one the
    // server says a request without one (or with one of a university the
    // gateway doesn't serve) is for.
    fn mail_university(&self, cookie: Option<&str>, asked: &Asked<'_>) -> Option<String> {
        match cookie.and_then(|cookie| self.codec.read(cookie, now_ms())).filter(|session| self.universities.contains_key(&session.university)) {
            Some(session) => Some(session.university),
            None => self.served.as_ref().map(|served| served.for_nobody(asked.headers).to_string()),
        }
    }

    // The mail routes' limit, by the session cookie's id (an expired
    // session's too). None: under it, or no cookie (its route says 401).
    fn mail_bucket(&self, cookie: Option<&str>) -> Option<u64> {
        let session = cookie.and_then(|cookie| self.codec.read_id(cookie))?;
        self.mail_limits.bucket.take(&session)
    }

    async fn mail_route<N, Fut>(&self, route: Route, asked: &Asked<'_>, body: MailBody, cookie: Option<&str>, node: &N) -> http::Response<MailBody>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let university = self.mail_university(cookie, asked);
        let feature = university.as_deref().is_none_or(|university| self.has_mail(university));

        // The upload: answered before any body is read, by its own checks.
        if route == Route::Upload {
            return self.upload(asked, body, cookie, feature, node).await;
        }

        // A send's or a draft's body: refused and counted before it is
        // read, then read up to the composer's limit.
        let read = match route {
            Route::Send | Route::DraftSave => {
                let refuse = |response: http::Response<MailBody>| closing(response);
                if !feature {
                    return refuse(disabled());
                }
                if request::from_another_site(asked.headers) {
                    return refuse(error(403, "Cross-site request."));
                }
                if cookie.and_then(|cookie| self.codec.read_id(cookie)).is_none() {
                    return refuse(no_session());
                }
                if let Some(seconds) = self.mail_bucket(cookie) {
                    return refuse(retry_after(error(429, "mail_rate_limited"), seconds));
                }
                match read_json(asked, body, COMPOSE_LIMIT).await {
                    Ok(body) => body,
                    Err(request::BodyRefusal::TooLarge) => return refuse(error(413, "mail_send_too_large")),
                    Err(request::BodyRefusal::Slow) => return refuse(error(408, "mail_send_timeout")),
                    // No JSON body: what the route sees is no payload.
                    Err(request::BodyRefusal::NotJson) => Value::Null,
                    Err(_) => return refuse(error(400, "mail_send_invalid")),
                }
            }
            // The other routes with a body: refused before it is read too, as
            // the composer's are, so that a client sending nothing (or a
            // byte now and then) holds no connection without a session.
            // Node read their body first; only the statuses of a request
            // both malformed and refused differ.
            Route::Action | Route::FolderAction | Route::Signature => {
                let refuse = |response: http::Response<MailBody>| closing(response);
                if !feature {
                    return refuse(disabled());
                }
                if request::from_another_site(asked.headers) {
                    return refuse(error(403, "Cross-site request."));
                }
                if cookie.and_then(|cookie| self.codec.read_id(cookie)).is_none() {
                    return refuse(no_session());
                }
                if let Some(seconds) = self.mail_bucket(cookie) {
                    return refuse(retry_after(error(429, "mail_rate_limited"), seconds));
                }
                match read_json(asked, body, JSON_LIMIT).await {
                    Ok(body) => body,
                    Err(request::BodyRefusal::TooLarge) => return refuse(error(413, "Request body too large.")),
                    Err(request::BodyRefusal::Slow) => return refuse(error(408, "Request timeout.")),
                    Err(request::BodyRefusal::NotJson) => Value::Null,
                    Err(request::BodyRefusal::Charset) => return error(415, "Unsupported charset."),
                    Err(_) => return error(400, "Invalid JSON."),
                }
            }
            _ => Value::Null,
        };

        if !feature {
            return disabled();
        }
        if !matches!(route, Route::Send | Route::DraftSave | Route::Action | Route::FolderAction | Route::Signature) {
            if let Some(seconds) = self.mail_bucket(cookie) {
                return retry_after(error(429, "mail_rate_limited"), seconds);
            }
        }
        self.mail_routed(route, asked, read, cookie, node).await
    }

    // The route itself, once Node's middleware has let the request through.
    async fn mail_routed<N, Fut>(&self, route: Route, asked: &Asked<'_>, body: Value, cookie: Option<&str>, node: &N) -> http::Response<MailBody>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        let query = Query(asked.query);
        if matches!(route, Route::Autocomplete | Route::Signatures | Route::Action | Route::FolderAction | Route::Signature | Route::Send | Route::DraftSave | Route::Open)
            && request::from_another_site(asked.headers)
        {
            return match route {
                // A link from another site: the webmail's own, signed out (W9).
                Route::Open => self.mail_open_fallback(self.mail_university(cookie, asked).as_deref()),
                _ => error(403, "Cross-site request."),
            };
        }

        let Some(cookie) = cookie else { return self.mail_nobody(route, self.mail_university(None, asked).as_deref()) };
        if let Some(expired) = self.found_expired_already(Moved::Mail, cookie) {
            return expired.map(MailBody::Whole);
        }
        let Some(held) = self.signed_in(Some(cookie)) else {
            // A session of the gateway's without its CAS ticket: the webmail
            // can't be signed in to; the CAS says whether it is over.
            return match self.codec.read(cookie, now_ms()) {
                Some(session) if self.universities.contains_key(&session.university) && self.memory.ended(&session.id).is_none() => {
                    let university = session.university.clone();
                    self.memory.end(&session.id, crate::session::memory::Ended::Expired);
                    self.mail_ended(&session.id).await;
                    self.tell_node_it_ended(cookie, node).await;
                    eprintln!("[tafac] session: signed out, no CAS ticket to open the webmail with");
                    self.expired(Moved::Mail, &university, true).map(MailBody::Whole)
                }
                _ => self.mail_nobody(route, self.mail_university(None, asked).as_deref()),
            };
        };
        let call = Call { held: &held, mail: self.mail_memory.of(&held.session.id), route, cookie, own_host: own_host(asked) };
        let answered = match route {
            Route::Recent => self.mail_recent(&call, &query).await,
            Route::Message => self.mail_message(&call, &query).await,
            Route::Thread => self.mail_thread(&call, &query).await,
            Route::Folders => self.mail_folders(&call).await,
            Route::Prefs => self.mail_prefs(&call).await,
            Route::Part => self.mail_part(&call, &query).await,
            Route::Open => self.mail_open(&call).await,
            Route::Action => self.mail_action(&call, &body).await,
            Route::FolderAction => self.mail_folder_action(&call, &body).await,
            Route::Autocomplete => self.mail_autocomplete(&call, &query).await,
            Route::Signatures => self.mail_signatures(&call, &query).await,
            Route::Signature => self.mail_signature(&call, &body).await,
            Route::DraftRead => self.mail_draft_read(&call, &query).await,
            Route::DraftSave => self.mail_draft_save(&call, &body).await,
            Route::Send => self.mail_send(&call, &body).await,
            Route::Upload => return error(404, "Not found."),
        };
        let response = match answered {
            Ok(response) => response,
            Err(failure) => self.mail_failed(&call, &failure, node).await,
        };
        // Signed out meanwhile: the answer is no longer this session's. The
        // open link's is a way to the webmail signed out, whatever happened:
        // kept.
        if route != Route::Open
            && self.signed_in(Some(cookie)).is_none_or(|current| current.session.id != held.session.id)
            && self.memory.ended(&held.session.id).is_some()
        {
            return self.found_expired_already(Moved::Mail, cookie).map_or_else(no_session, |expired| expired.map(MailBody::Whole));
        }
        response
    }

    // A route asked without a session cookie: the recent mail says so in
    // its own words, the part with an empty 404, the open link with the
    // webmail's own; any other 401.
    fn mail_nobody(&self, route: Route, university: Option<&str>) -> http::Response<MailBody> {
        match route {
            Route::Recent => reply(200, &json!({ "authenticated": false, "mail": null })),
            Route::Part => empty(404),
            Route::Open => self.mail_open_fallback(university),
            _ => no_session(),
        }
    }

    // A route that failed: said in the log, then the CAS is asked whether
    // the session is over (the page signs out then), else the route's own
    // failure.
    async fn mail_failed<N, Fut>(&self, call: &Call<'_, '_>, failure: &MailError, node: &N) -> http::Response<MailBody>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: Future<Output = NodeAnswer>,
    {
        if !matches!(call.route, Route::Part | Route::Open) {
            eprintln!("[mail] {} failed: {}", call.route.name(), failure.words());
        }
        if failure.may_be_expired() {
            if let Some(expired) = self.lost(Moved::Mail, call.held, call.cookie, node).await {
                self.mail_ended(&call.held.session.id).await;
                // The open link is a page opened in a tab, never read by the
                // page's code: the webmail's own link, signed out, whatever
                // happened (Node's silent fallback), the session ended all
                // the same. Its answer still carries the cookie cleared and
                // `X-Tafac-Session: expired`.
                if call.route == Route::Open {
                    let mut fallback = self.mail_open_fallback(Some(&call.held.session.university));
                    for (name, value) in expired.headers() {
                        if name == http::header::SET_COOKIE || name.as_str() == SESSION_HEADER {
                            fallback.headers_mut().append(name.clone(), value.clone());
                        }
                    }
                    return fallback;
                }
                return expired.map(MailBody::Whole);
            }
        }
        match call.route {
            Route::Part => empty(502),
            Route::Open => self.mail_open_fallback(Some(&call.held.session.university)),
            _ => error(500, "mail_unavailable"),
        }
    }

    // A session ended (signed out, expired): its mail goes, and the
    // webmail's session ends too, at most four seconds later.
    pub(crate) async fn mail_ended(&self, session: &str) {
        if let Some(context) = self.mail_memory.end(session) {
            context.webmail.end_session().await;
        }
        self.mail_limits.forget_session(session);
    }

    // The same, without waiting for the webmail (a request that only saw
    // the session end).
    pub(crate) fn mail_ended_behind(&self, session: &str) {
        if let Some(context) = self.mail_memory.end(session) {
            tokio::spawn(async move { context.webmail.end_session().await });
        }
        self.mail_limits.forget_session(session);
    }

    // Signs in to the webmail with the session's CAS ticket.
    async fn webmail_sign_in(&self, held: &Held<'_>) -> Result<Webmail, MailError> {
        let university = held.university;
        let ticket = handed::cas_cookies(university, &held.session);
        if ticket.is_empty() {
            return Err(MailError::NoTicket);
        }
        let component = held.memory.snapshot().component.map(|component| component.id);
        let services = university.settings.services_for(component.as_deref());
        let Some(MailService::ZimbraRest { base_url, entry_url, .. }) = services.mail else {
            return Err(MailError::Other("no Zimbra webmail in the settings".to_string()));
        };
        let entry = entry_url.unwrap_or_else(|| base_url.clone());
        let own = crate::launch::targets::own(&held.session.university);
        let hosts = [base_url.host_str(), entry.host_str(), Some(university.cas_host.as_str())];
        let domains = SignInDomains::new(own.mail_sign_in.iter().copied().chain(hosts.into_iter().flatten()), self.net.https_only);
        webmail::sign_in(SignIn { entry: &entry, domains: &domains, cas_host: &university.cas_host, cookies: ticket, net: self.net, extra_ca: Vec::new() })
            .await
            .map_err(MailError::SignIn)
    }

    // `work` with the session's webmail: signed in again, once, when the
    // webmail refuses the session (runWithMailContext). Any other failure
    // keeps the context: other requests may be using it.
    pub(crate) async fn with_webmail<T, F, Fut>(&self, call: &Call<'_, '_>, work: F) -> Result<T, MailError>
    where
        F: Fn(Arc<Context>) -> Fut,
        Fut: Future<Output = Result<T, MailError>>,
    {
        let mut refused: Option<Arc<Context>> = None;
        for attempt in 0..2 {
            let context = match call.mail.context(refused.as_ref(), || self.webmail_sign_in(call.held)).await {
                Ok(context) => context,
                Err(NoContext::Ended) => return Err(MailError::Ended),
                Err(NoContext::Failed(error)) => return Err(error),
            };
            match work(context.clone()).await {
                Ok(value) => return Ok(value),
                Err(error) if error.refused() => {
                    call.mail.drop_context(&context);
                    if attempt > 0 {
                        return Err(error);
                    }
                    refused = Some(context);
                }
                Err(error) => return Err(error),
            }
        }
        Err(MailError::Other("Unable to reach the webmail.".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_strings_as_javascript_writes_them() {
        for (value, written) in [
            (json!("257"), "257"),
            (json!(257), "257"),
            (json!(257.0), "257"),
            (json!(-3), "-3"),
            (json!(1.5), "1.5"),
            (json!(null), "null"),
            (json!(true), "true"),
            (json!([1, null, "a"]), "1,,a"),
            (json!({ "a": 1 }), "[object Object]"),
        ] {
            assert_eq!(js_string(&value), written, "{value}");
        }
    }

    // A body sent a byte now and then: refused once a piece is late, or
    // once the whole took too long, never waited for.
    #[tokio::test]
    async fn a_slow_body_is_not_waited_for() {
        let trickle = |gap: u64| -> ByteStream {
            Box::pin(futures_util::stream::unfold(0_u32, move |sent| async move {
                tokio::time::sleep(Duration::from_millis(gap)).await;
                Some((Ok::<_, BoxError>(Bytes::from_static(b" ")), sent + 1))
            }))
        };
        let idle = Duration::from_millis(50);
        let started = std::time::Instant::now();
        let late = MailBody::Stream(trickle(200)).read_within(1024, idle, Duration::from_secs(5)).await;
        assert_eq!(late, Err(Unread::Slow));
        let endless = MailBody::Stream(trickle(5)).read_within(1024 * 1024, idle, Duration::from_millis(300)).await;
        assert_eq!(endless, Err(Unread::Slow));
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
        let whole = MailBody::Stream(Box::pin(futures_util::stream::iter([Ok::<_, BoxError>(Bytes::from_static(b"{}"))])));
        assert_eq!(whole.read_within(1024, idle, Duration::from_secs(1)).await, Ok(b"{}".to_vec()));
    }

    #[test]
    fn the_routes_are_matched_as_express_matches_them() {
        assert_eq!(route(&Method::GET, "/__ent_auth/mail/recent"), Some((Route::Recent, false)));
        assert_eq!(route(&Method::GET, "/__ent_auth/MAIL/Recent/"), Some((Route::Recent, false)));
        assert_eq!(route(&Method::HEAD, "/__ent_auth/mail/part"), Some((Route::Part, true)));
        assert_eq!(route(&Method::POST, "/__ent_auth/mail/send"), Some((Route::Send, false)));
        assert_eq!(route(&Method::POST, "/__ent_auth/Mail/SEND/"), Some((Route::Send, false)));
        assert_eq!(route(&Method::GET, "/__ent_auth/mail/draft"), Some((Route::DraftRead, false)));
        assert_eq!(route(&Method::POST, "/__ent_auth/mail/draft"), Some((Route::DraftSave, false)));
        for (method, path) in [
            (Method::GET, "/__ent_auth/mail/send"),
            (Method::POST, "/__ent_auth/mail/recent"),
            (Method::GET, "/__ent_auth/mail/recent//"),
            (Method::GET, "/__ent_auth/mail"),
            (Method::GET, "/__ent_auth/mail/other"),
            (Method::HEAD, "/__ent_auth/mail/send"),
        ] {
            assert_eq!(route(&method, path), None, "{method} {path}");
        }
        for path in ["/__ent_auth/mail", "/__ent_auth/mail/", "/__ent_auth/MAIL/send", "/__ENT_AUTH/mail/x"] {
            assert!(is_mail_path(path), "{path}");
        }
        for path in ["/__ent_auth/mailbox", "/__ent_auth/mai", "/__ent_auth/other/mail", "/__ent_auth/maïl"] {
            assert!(!is_mail_path(path), "{path}");
        }
    }
}
