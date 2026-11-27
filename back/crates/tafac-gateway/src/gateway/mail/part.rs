// GET /__ent_auth/mail/part?id&part[&download=1]: one part of a message,
// the reader's inline images and the files it offers, streamed from the
// webmail's REST servlet as it comes, never held whole.
//
//   404, empty     no session (before any check of the ids)
//   400, empty     an id or a part not of their kind
//   404 / 502      the webmail has no such part / failed; 413 past 50 MiB
//
// Its headers make it inert wherever it is opened: its own CSP (the
// baseline's replaced, `frame-ancestors 'self'` kept in it: one CSP only),
// nosniff, no referrer, and never kept by the browser (W3: the address
// names only numbers of one mailbox, the next student's message 300 would
// otherwise be this one's). `inline` only for a raster image the reader
// shows; anything else downloads. GET only, never a redirect: the page
// allows this exact path in its frame's `img-src`.
//
// The upstream's headers within 15 seconds, then a minute at most between
// two pieces; the student's side gone, the upstream request goes with it
// (the stream dropped). The bytes are counted as they go: a part that
// grows past 50 MiB without saying so is cut there (W11). Its length is
// given only when the bytes come as they were sent (not decompressed on
// the way).

use std::time::Duration;

use bytes::Bytes;
use futures_util::stream;
use http::header::{CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use http::HeaderValue;
use tonapi_http::Streamed;
use tonapi_providers::zimbra::message as zimbra_message;

use super::{empty, BoxError, ByteStream, Call, MailBody, MailError, Query};
use crate::gateway::Gateway;

// A part's size at most, through Tafac's server.
pub(crate) const MAX_PART_BYTES: u64 = 50 * 1024 * 1024;
// The longest wait between two pieces of a part.
const IDLE: Duration = Duration::from_secs(60);

const PART_CSP: &str = "default-src 'none'; sandbox; frame-ancestors 'self'";

#[derive(Debug)]
struct PartBroke(&'static str);

impl std::fmt::Display for PartBroke {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for PartBroke {}

// The part's bytes as they come: a minute at most between two pieces, 50
// MiB at most in all.
fn counted(streamed: Streamed) -> ByteStream {
    Box::pin(stream::unfold((streamed, 0_u64, false), |(mut streamed, sent, done)| async move {
        if done {
            return None;
        }
        let next = match tokio::time::timeout(IDLE, streamed.chunk()).await {
            Err(_) => Err(PartBroke("the webmail went quiet")),
            Ok(Err(_)) => Err(PartBroke("the webmail's answer broke off")),
            Ok(Ok(None)) => return None,
            Ok(Ok(Some(chunk))) => Ok(chunk),
        };
        match next {
            Ok(chunk) => {
                let sent = sent + chunk.len() as u64;
                if sent > MAX_PART_BYTES {
                    return Some((Err(Box::new(PartBroke("past 50 MiB")) as BoxError), (streamed, sent, true)));
                }
                Some((Ok::<Bytes, BoxError>(chunk), (streamed, sent, false)))
            }
            Err(broke) => Some((Err(Box::new(broke) as BoxError), (streamed, sent, true))),
        }
    }))
}

impl Gateway {
    pub(super) async fn mail_part(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let id = query.text("id").unwrap_or_default();
        let part = query.text("part").unwrap_or_default();
        if !tonapi_providers::zimbra::listing::is_valid_message_id(&id) || !zimbra_message::is_valid_part_id(&part) {
            return Ok(part_headers(empty(400)));
        }
        let download = query.text("download").as_deref() == Some("1");
        let (id, part) = (&id, &part);
        let streamed = self.with_webmail(call, |context| async move { Ok(context.webmail.part(id, part).await?) }).await?;

        let status = streamed.status.as_u16();
        if !(200..300).contains(&status) {
            return Ok(part_headers(empty(if status == 404 { 404 } else { 502 })));
        }
        let declared = streamed.headers.get(CONTENT_LENGTH).and_then(|value| value.to_str().ok()).and_then(|value| value.trim().parse::<u64>().ok());
        if declared.is_some_and(|length| length > MAX_PART_BYTES) {
            return Ok(part_headers(empty(413)));
        }
        let upstream_type = streamed.headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).map(str::to_string);
        let upstream_name = streamed.headers.get(CONTENT_DISPOSITION).and_then(|value| value.to_str().ok()).and_then(zimbra_message::read_content_disposition_filename);
        let shown = zimbra_message::part_disposition(upstream_type.as_deref(), upstream_name.as_deref(), download);
        // The length of the bytes as they will come: none when decompressed
        // on the way (the upstream's would be the compressed one's).
        let length = streamed.content_length().filter(|length| *length > 0);

        let mut response = empty(200);
        *response.body_mut() = MailBody::Stream(counted(streamed));
        let headers = response.headers_mut();
        let content_type = HeaderValue::from_str(&shown.content_type).map_err(|_| MailError::Other("a part's type that is no header".to_string()))?;
        let disposition = HeaderValue::from_str(&shown.disposition).map_err(|_| MailError::Other("a part's name that is no header".to_string()))?;
        headers.insert(CONTENT_TYPE, content_type);
        headers.insert(CONTENT_DISPOSITION, disposition);
        if let Some(length) = length {
            headers.insert(CONTENT_LENGTH, HeaderValue::from(length));
        }
        Ok(part_headers(response))
    }
}

// What every answer of the part's carries, its errors too.
fn part_headers(mut response: http::Response<MailBody>) -> http::Response<MailBody> {
    let headers = response.headers_mut();
    headers.insert("content-security-policy", HeaderValue::from_static(PART_CSP));
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_parts_answer_has_one_csp_and_is_never_kept() {
        let response = part_headers(empty(400));
        assert_eq!(response.headers().get_all("content-security-policy").iter().count(), 1);
        assert_eq!(response.headers()["content-security-policy"], PART_CSP);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert_eq!(response.headers().get_all("referrer-policy").iter().count(), 1);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert!(response.headers().get(CONTENT_TYPE).is_none());
    }
}
