// Tafac's mail, its gateway side: what the mail routes check and count
// before anything is asked of the webmail, ported from Node
// (server/mailSend.js, server/mailUpload.js, server/entAuthApp.js).
//
// tonAPI speaks to Zimbra and holds the rules any client of it needs
// (tonapi_providers::mail: addresses, names, subjects, attachments). What
// is here is Tafac's own, the page's contract:
//
//   request.rs          a request as Express reads it before the route:
//                       Sec-Fetch-Site, the query, a JSON body, an
//                       upload's declared length
//   payload.rs          a send's or a draft's body, checked
//                       (normalizeComposePayload)
//   signature_block.rs  the automatic signature, built here from the
//                       university's settings, never from the page
//   faults.rs           what the page is told when a send is refused
//                       (mapZimbraSendFault)
//   limits.rs           the mail bucket, the uploads', the sends', the
//                       drafts' and the signature's limits, a send asked
//                       twice, an upload's byte count
//   uploads.rs          the files a session uploaded, the only ones its
//                       sends may name
//
// Everything is in this process, keyed by the session's id, and gone with
// the session (each holder's forget_session).

pub(crate) mod faults;
pub(crate) mod limits;
pub(crate) mod payload;
pub(crate) mod request;
pub(crate) mod signature_block;
pub(crate) mod uploads;

// Every limit and count of the mail's, held by the gateway.
#[derive(Default)]
pub(crate) struct MailLimits {
    pub bucket: limits::MailBucket,
    pub upload: limits::UploadLimiter,
    pub sends: SendLimits,
    pub send_once: limits::SendOnce<Sent, Option<Sent>>,
    pub uploads: uploads::Uploads,
}

// A send's answer, given again to a repeat of its uid: its status and body.
pub(crate) type Sent = (u16, serde_json::Value);

pub(crate) struct SendLimits {
    pub sends: limits::SendLimiter,
    pub drafts: limits::SendLimiter,
    pub signatures: limits::SendLimiter,
}

impl Default for SendLimits {
    fn default() -> Self {
        Self { sends: limits::SendLimiter::sends(), drafts: limits::SendLimiter::drafts(), signatures: limits::SendLimiter::signatures() }
    }
}

impl MailLimits {
    // A session ended: what it counted goes (a student's own count, by
    // login, stays).
    pub(crate) fn forget_session(&self, session_id: &str) {
        self.bucket.forget_session(session_id);
        self.upload.forget_session(session_id);
        self.sends.sends.forget_session(session_id);
        self.sends.drafts.forget_session(session_id);
        self.sends.signatures.forget_session(session_id);
        self.send_once.forget_session(session_id);
        self.uploads.forget_session(session_id);
    }
}
