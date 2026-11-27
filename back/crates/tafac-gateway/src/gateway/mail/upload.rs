// POST /__ent_auth/mail/upload: a file for the composer, streamed to the
// webmail's upload servlet as it comes, never held whole nor written down.
// Its answer: { attachment: { aid, name, size, contentType } }, the aid
// remembered as this session's (a send names only its own).
//
// Refused before a byte of the body is read, the connection closed after
// (Node's order):
//
//   404  the university has no mail          403  another site asked
//   401  no session                          411  Transfer-Encoding, or no
//   400  an empty file                            Content-Length of digits
//   413  past 50 MiB, or the account's      429  the uploads' own limit
//        limit (GetInfo's attSizeLimit)
//
// Then the bytes are counted as they pass: more than declared ends it
// (413), a client quiet for a minute too (408), and the webmail has 15
// seconds once the last byte went. The webmail refusing the session: 502
// `mail_upload_retry`, the page uploads again (the body is gone: no second
// try here). Neither the file nor its name is ever written in the log.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use futures_util::stream::{self, StreamExt};
use http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use serde_json::json;
use tonapi_http::RequestBody;
use tonapi_providers::mail::attachments::{normalize_attachment_type, sanitize_attachment_name, HARD_ATTACHMENT_LIMIT_BYTES};
use tonapi_providers::zimbra::{message as zimbra_message, upload as zimbra_upload};

use crate::mail::limits::{limit_keys, ByteCounter};
use crate::mail::uploads::Upload;
use super::{closing, error, reply, retry_after, BoxError, ByteStream, Call, MailBody, MailError, Route};
use crate::gateway::{Asked, Gateway};
use crate::mail::request;
use crate::node::{NodeAnswer, NodeRequest};
use crate::routes::Moved;

// The longest a client may go quiet while it sends.
const IDLE: Duration = Duration::from_secs(60);

// Why the body stopped before its end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stopped {
    TooLarge,
    Idle,
    Broken,
}

#[derive(Debug)]
struct UploadStopped(Stopped);

impl std::fmt::Display for UploadStopped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "upload stopped: {:?}", self.0)
    }
}

impl std::error::Error for UploadStopped {}

// The body as the webmail gets it: counted (never more than declared), and
// a minute at most between two pieces. Why it stopped, and how much came,
// are kept for the answer.
fn counted(body: ByteStream, declared: u64, stopped: Arc<Mutex<Option<Stopped>>>, received: Arc<AtomicU64>) -> ByteStream {
    Box::pin(stream::unfold((body, ByteCounter::new(declared), false), move |(mut body, mut counter, done)| {
        let stopped = stopped.clone();
        let received = received.clone();
        async move {
            if done {
                return None;
            }
            let stop = |why: Stopped, counter: ByteCounter| {
                *stopped.lock().unwrap() = Some(why);
                Some((Err(Box::new(UploadStopped(why)) as BoxError), (Box::pin(stream::empty()) as ByteStream, counter, true)))
            };
            match tokio::time::timeout(IDLE, body.next()).await {
                Err(_) => stop(Stopped::Idle, counter),
                Ok(None) => None,
                Ok(Some(Err(_))) => stop(Stopped::Broken, counter),
                Ok(Some(Ok(chunk))) => match counter.add(chunk.len()) {
                    Ok(_) => {
                        received.store(counter.total(), Ordering::SeqCst);
                        Some((Ok::<Bytes, BoxError>(chunk), (body, counter, false)))
                    }
                    Err(_) => stop(Stopped::TooLarge, counter),
                },
            }
        }
    }))
}

impl Gateway {
    pub(super) async fn upload<N, Fut>(&self, asked: &Asked<'_>, body: MailBody, cookie: Option<&str>, feature: bool, node: &N) -> http::Response<MailBody>
    where
        N: Fn(NodeRequest) -> Fut,
        Fut: std::future::Future<Output = NodeAnswer>,
    {
        let refuse = |status: u16, code: &str| closing(error(status, code));
        if !feature {
            return closing(reply(404, &json!({ "ok": false, "disabled": true, "feature": "mail" })));
        }
        if request::from_another_site(asked.headers) {
            return refuse(403, "Cross-site request.");
        }
        let Some(cookie) = cookie else { return refuse(401, "Authentication required.") };
        if let Some(expired) = self.found_expired_already(Moved::Mail, cookie) {
            return closing(expired.map(MailBody::Whole));
        }
        let Some(held) = self.signed_in(Some(cookie)) else { return refuse(401, "Authentication required.") };
        let Some(length) = request::upload_length(asked.headers) else { return refuse(411, "mail_upload_length_required") };
        if length == 0 {
            return refuse(400, "mail_upload_empty");
        }
        if length > HARD_ATTACHMENT_LIMIT_BYTES {
            return closing(reply(413, &json!({ "error": "mail_upload_too_large", "maxBytes": HARD_ATTACHMENT_LIMIT_BYTES })));
        }
        let mut slot = match self.mail_limits.upload.take(&limit_keys(&held.session.id, Some(&held.session.user)), length) {
            Ok(slot) => slot,
            Err(seconds) => return closing(retry_after(error(429, "mail_upload_rate_limited"), seconds)),
        };
        let disposition = asked.headers.get(CONTENT_DISPOSITION).and_then(|value| value.to_str().ok()).and_then(zimbra_message::read_content_disposition_filename);
        let name = sanitize_attachment_name(disposition.as_deref().unwrap_or_default());
        let content_type = normalize_attachment_type(asked.headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or_default());

        let call = Call { held: &held, mail: self.mail_memory.of(&held.session.id), route: Route::Upload, cookie, own_host: None };
        // The account's limit, and a context known to work: signing in again
        // is only possible before the body starts going.
        let ready = self.with_webmail(&call, |context| async move { Ok((context.clone(), self.attachment_limits(&context).await?)) }).await;
        let (context, limits) = match ready {
            Ok(ready) => ready,
            Err(failure) => {
                slot.settle(0);
                return closing(self.mail_failed(&call, &failure, node).await);
            }
        };
        if length > limits.max_file_bytes {
            slot.settle(0);
            return closing(reply(413, &json!({ "error": "mail_upload_too_large", "maxBytes": limits.max_file_bytes })));
        }

        let stopped = Arc::new(Mutex::new(None));
        let received = Arc::new(AtomicU64::new(0));
        let sent = counted(body.into_stream(), length, stopped.clone(), received.clone());
        let outcome = context.webmail.upload(RequestBody::wrap_stream(sent), length, &content_type, &zimbra_upload::upload_disposition(&name)).await;
        slot.settle(received.load(Ordering::SeqCst));
        let stopped = *stopped.lock().unwrap();
        match stopped {
            Some(Stopped::TooLarge) => return closing(error(413, "mail_upload_too_large")),
            Some(Stopped::Idle) => return closing(error(408, "mail_upload_idle")),
            _ => {}
        }
        let (status, text) = match outcome {
            Ok(answered) => answered,
            Err(tonapi_providers::zimbra::webmail::PartError::Refused) => {
                call.mail.drop_context(&context);
                eprintln!("[mail] upload failed: Zimbra rejected the session ({})", if context.webmail.has_csrf() { "with a CSRF token" } else { "no CSRF token" });
                return closing(error(502, "mail_upload_retry"));
            }
            Err(failure) => return closing(self.mail_failed(&call, &MailError::from(failure), node).await),
        };
        let parsed = zimbra_upload::parse_upload_response(&text);
        let servlet = parsed.as_ref().map(|parsed| parsed.status);
        if servlet == Some(401) {
            call.mail.drop_context(&context);
            eprintln!("[mail] upload failed: Zimbra rejected the session (HTTP {status}, 401{})", if context.webmail.has_csrf() { "" } else { ", no CSRF token" });
            return closing(error(502, "mail_upload_retry"));
        }
        if servlet == Some(413) {
            return closing(reply(413, &json!({ "error": "mail_upload_too_large", "maxBytes": limits.max_file_bytes })));
        }
        let uploaded = parsed.filter(|parsed| status == 200 && parsed.status == 200 && parsed.uploads.len() == 1).and_then(|parsed| parsed.uploads.into_iter().next());
        let Some(uploaded) = uploaded else {
            let said = servlet.map_or_else(|| "unreadable answer".to_string(), |servlet| format!("status {servlet}"));
            return closing(self.mail_failed(&call, &MailError::Other(format!("Zimbra upload failed (HTTP {status}, {said})")), node).await);
        };
        let size = uploaded.size.unwrap_or_else(|| received.load(Ordering::SeqCst));
        let content_type = if uploaded.content_type.is_empty() { content_type } else { uploaded.content_type };
        self.mail_limits.uploads.remember(&held.session.id, &uploaded.aid, Upload { size, name: name.clone(), content_type: content_type.clone() });
        reply(200, &json!({ "attachment": { "aid": uploaded.aid, "name": name, "size": size, "contentType": content_type } }))
    }
}
