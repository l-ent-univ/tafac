// The files a session uploaded (POST /__ent_auth/mail/upload), in order:
// Partage's attachment id, its size, name and type. A send or a draft names
// only those: an aid made up, another session's, or one from before a
// restart is refused as expired (the page uploads it again), and their
// sizes add up against the account's limit. Node's runtimeMailUploads,
// rememberMailUpload, forgetMailUploads and checkMailUploads
// (server/entAuthApp.js).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use super::faults::ComposeRefusal;
use super::payload::{InlineImage, PartReference, INLINE_IMAGE_TYPES};

// Uploads kept per session, the oldest forgotten first (MAIL_UPLOADS_KEPT).
pub(crate) const UPLOADS_KEPT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Upload {
    pub size: u64,
    pub name: String,
    pub content_type: String,
}

#[derive(Default)]
pub(crate) struct Uploads {
    sessions: Mutex<HashMap<String, Vec<(String, Upload)>>>,
}

impl Uploads {
    fn sessions(&self) -> MutexGuard<'_, HashMap<String, Vec<(String, Upload)>>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // One more of the session's, the newest (the same aid again moves it).
    pub(crate) fn remember(&self, session_id: &str, aid: &str, upload: Upload) {
        let mut sessions = self.sessions();
        let uploads = sessions.entry(session_id.to_string()).or_default();
        uploads.retain(|(known, _)| known != aid);
        uploads.push((aid.to_string(), upload));
        let excess = uploads.len().saturating_sub(UPLOADS_KEPT);
        uploads.drain(..excess);
    }

    // Used by a send or a save: Zimbra deletes an upload it has put into a
    // mail.
    pub(crate) fn forget(&self, session_id: &str, aids: &[String]) {
        let mut sessions = self.sessions();
        if let Some(uploads) = sessions.get_mut(session_id) {
            uploads.retain(|(aid, _)| !aids.contains(aid));
            if uploads.is_empty() {
                sessions.remove(session_id);
            }
        }
    }

    pub(crate) fn forget_session(&self, session_id: &str) {
        self.sessions().remove(session_id);
    }

    pub(crate) fn get(&self, session_id: &str, aid: &str) -> Option<Upload> {
        self.sessions().get(session_id)?.iter().find(|(known, _)| known == aid).map(|(_, upload)| upload.clone())
    }

    // The uploads a mail names (checkMailUploads): each one this session
    // made, the text's images of an image type, and all of them together
    // within the account's limit (`max_total_bytes`; the files of other
    // mails aren't counted: Partage checks the mail as a whole anyway).
    // → their aids, the files' then the images'.
    pub(crate) fn check(&self, session_id: &str, attachments: &[PartReference], images: &[InlineImage], max_total_bytes: u64) -> Result<Vec<String>, ComposeRefusal> {
        let sessions = self.sessions();
        let uploads = sessions.get(session_id).map(Vec::as_slice).unwrap_or_default();
        let find = |aid: &str| uploads.iter().find(|(known, _)| known == aid).map(|(_, upload)| upload);
        let image_aids: Vec<String> = images.iter().filter_map(|image| image.file.aid()).map(str::to_string).collect();
        let aids: Vec<String> = attachments.iter().filter_map(PartReference::aid).map(str::to_string).chain(image_aids.iter().cloned()).collect();
        let unknown: Vec<String> = aids.iter().filter(|aid| find(aid).is_none()).cloned().collect();
        if !unknown.is_empty() {
            return Err(ComposeRefusal { aids: Some(unknown), ..ComposeRefusal::new(409, "mail_send_upload_expired") });
        }
        if image_aids.iter().any(|aid| find(aid).is_none_or(|upload| !INLINE_IMAGE_TYPES.contains(&upload.content_type.as_str()))) {
            return Err(ComposeRefusal::new(400, "mail_send_invalid"));
        }
        let total: u64 = aids.iter().filter_map(|aid| find(aid)).map(|upload| upload.size).sum();
        if total > max_total_bytes {
            return Err(ComposeRefusal { max_bytes: Some(max_total_bytes), ..ComposeRefusal::new(413, "mail_send_too_large") });
        }
        Ok(aids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upload(size: u64, content_type: &str) -> Upload {
        Upload { size, name: "a.txt".into(), content_type: content_type.into() }
    }

    fn file(aid: &str) -> PartReference {
        PartReference::Upload { aid: aid.into() }
    }

    fn image(aid: &str) -> InlineImage {
        InlineImage { cid: "tafac-img-0123abcd-4567-89ab@tafac.fr".into(), file: file(aid), width: 10, height: 10 }
    }

    #[test]
    fn a_send_names_only_its_own_sessions_uploads() {
        let uploads = Uploads::default();
        uploads.remember("s1", "aid-0001", upload(10, "text/plain"));
        uploads.remember("s1", "aid-0002", upload(20, "image/png"));
        uploads.remember("s2", "aid-0003", upload(30, "text/plain"));
        let message = PartReference::Message { message_id: "257".into(), part: "2".into() };
        assert_eq!(uploads.check("s1", &[file("aid-0001"), message.clone()], &[image("aid-0002")], 100), Ok(vec!["aid-0001".to_string(), "aid-0002".to_string()]));
        // Another session's aid: to upload again.
        let refusal = uploads.check("s1", &[file("aid-0003"), file("aid-0001")], &[], 100).unwrap_err();
        assert_eq!(refusal.body(), serde_json::json!({ "error": "mail_send_upload_expired", "aids": ["aid-0003"] }));
        assert_eq!(refusal.status, 409);
        assert_eq!(uploads.check("s3", &[file("aid-0001")], &[], 100).unwrap_err().code, "mail_send_upload_expired");
        // An image of the text is an image.
        assert_eq!(uploads.check("s1", &[], &[image("aid-0001")], 100).unwrap_err(), ComposeRefusal::new(400, "mail_send_invalid"));
        // All of a mail's together, within the account's limit.
        let refusal = uploads.check("s1", &[file("aid-0001")], &[image("aid-0002")], 29).unwrap_err();
        assert_eq!(refusal.body(), serde_json::json!({ "error": "mail_send_too_large", "maxBytes": 29 }));
        assert_eq!(refusal.status, 413);
    }

    #[test]
    fn uploads_are_kept_in_order_and_forgotten() {
        let uploads = Uploads::default();
        for index in 0..=UPLOADS_KEPT {
            uploads.remember("s1", &format!("aid-{index:04}"), upload(1, "text/plain"));
        }
        // The oldest went.
        assert_eq!(uploads.get("s1", "aid-0000"), None);
        assert!(uploads.get("s1", &format!("aid-{UPLOADS_KEPT:04}")).is_some());
        // Used by a send: gone.
        uploads.forget("s1", &["aid-0001".to_string()]);
        assert_eq!(uploads.get("s1", "aid-0001"), None);
        assert!(uploads.get("s1", "aid-0002").is_some());
        uploads.forget_session("s1");
        assert_eq!(uploads.get("s1", "aid-0002"), None);
    }
}
