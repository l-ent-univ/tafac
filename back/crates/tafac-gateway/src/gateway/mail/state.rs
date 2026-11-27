// What a session's mail holds in this process, by the session's id, never
// in its cookie and never by student (Node's runtimeMail* maps):
//
//   the webmail     one sign-in to it (tonAPI's Webmail: its origin, its
//                   cookies, its CSRF token) and what was read once with it:
//                   the folders, the account's GetInfo, its identities and
//                   their signatures, the « mark read » delay, the attachment
//                   limits. Until the webmail refuses it, or the session ends
//   the inbox       its first page, two minutes, for the home page's widget
//                   and the mail page that follows
//
// (The files the session uploaded are kept with the limits: mail/uploads.rs.)
//
// One sign-in to the webmail at a time for a session: the mail page asks
// several routes at once, and each would otherwise walk the whole SAML
// chain, the last one winning and the others' webmail sessions left open
// (W5). A request that needs it while one is under way waits for it. A
// sign-in that lands after the session ended is ended at once, not kept.
//
// Nothing here is ever given stale: a session's mail is its own, asked
// again whenever the inbox's two minutes are up.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tonapi_providers::mail::attachments::AttachmentLimits;
use tonapi_providers::zimbra::folders::MailFolder;
use tonapi_providers::zimbra::identities::{Identity, IdentitySignatureIds};
use tonapi_providers::zimbra::webmail::Webmail;

// How long the inbox's first page is given again without asking.
const INBOX_KEPT: Duration = Duration::from_secs(2 * 60);
// A session's mail forgotten when it went this long unused.
const UNUSED_KEPT: Duration = Duration::from_secs(24 * 60 * 60);
// Sessions remembered at once.
const REMEMBERED: usize = 10_000;

#[derive(Default)]
pub(crate) struct MailMemory {
    sessions: Mutex<HashMap<String, Arc<MailSession>>>,
}

// The account's identities, and the webmail signatures each one names.
pub(crate) struct Identities {
    pub list: Vec<Identity>,
    pub signatures: HashMap<String, IdentitySignatureIds>,
}

pub(crate) struct MailSession {
    // The webmail's sign-in kept, and the turn of the one under way.
    context: Mutex<Option<Arc<Context>>>,
    signing: tokio::sync::Mutex<()>,
    ended: AtomicBool,
    used: Mutex<Instant>,
    inbox: Mutex<Option<(Instant, Value)>>,
}

// One sign-in to the webmail, and what was read with it.
pub(crate) struct Context {
    pub webmail: Webmail,
    pub folders: Mutex<Option<Vec<MailFolder>>>,
    pub mark_read: Mutex<Option<i64>>,
    pub limits: Mutex<Option<AttachmentLimits>>,
    // The account's GetInfo, read once however many routes ask at once:
    // the turn held while it is asked; a failure isn't kept.
    pub info: tokio::sync::Mutex<Option<Value>>,
    pub identities: Mutex<Option<Arc<Identities>>>,
}

impl Context {
    pub(crate) fn new(webmail: Webmail) -> Self {
        Self {
            webmail,
            folders: Mutex::new(None),
            mark_read: Mutex::new(None),
            limits: Mutex::new(None),
            info: tokio::sync::Mutex::new(None),
            identities: Mutex::new(None),
        }
    }
}

// Why the webmail has no context for a request.
pub(crate) enum NoContext<E> {
    // The session ended while it was signing in: the one made was ended.
    Ended,
    Failed(E),
}

impl MailMemory {
    // A session's mail: the one there is, or a new one.
    pub(crate) fn of(&self, session: &str) -> Arc<MailSession> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(found) = sessions.get(session) {
            *found.used.lock().unwrap() = Instant::now();
            return found.clone();
        }
        sessions.retain(|_, kept| kept.used.lock().unwrap().elapsed() < UNUSED_KEPT);
        if sessions.len() >= REMEMBERED {
            sessions.clear();
        }
        let made = Arc::new(MailSession {
            context: Mutex::new(None),
            signing: tokio::sync::Mutex::new(()),
            ended: AtomicBool::new(false),
            used: Mutex::new(Instant::now()),
            inbox: Mutex::new(None),
        });
        sessions.insert(session.to_string(), made.clone());
        made
    }

    // The session ended: its mail goes, and the webmail's context it held
    // is handed back for its own end (EndSession). A sign-in under way ends
    // the one it makes when it lands.
    pub(crate) fn end(&self, session: &str) -> Option<Arc<Context>> {
        let gone = self.sessions.lock().unwrap().remove(session)?;
        gone.ended.store(true, Ordering::SeqCst);
        gone.inbox.lock().unwrap().take();
        let context = gone.context.lock().unwrap().take();
        context
    }

    #[cfg(test)]
    pub(crate) fn holds(&self, session: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(session)
    }
}

impl MailSession {
    pub(crate) fn has_ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    // The webmail's context: the one kept, or a new sign-in when there is
    // none or it is `replacing` (the one the webmail just refused), unless
    // another request signed in again meanwhile. One sign-in at a time.
    pub(crate) async fn context<E, F, Fut>(&self, replacing: Option<&Arc<Context>>, sign_in: F) -> Result<Arc<Context>, NoContext<E>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Webmail, E>>,
    {
        let usable = |kept: &Option<Arc<Context>>| kept.as_ref().filter(|kept| replacing.is_none_or(|refused| !Arc::ptr_eq(kept, refused))).cloned();
        if let Some(kept) = usable(&self.context.lock().unwrap()) {
            return Ok(kept);
        }
        let _turn = self.signing.lock().await;
        if self.has_ended() {
            return Err(NoContext::Ended);
        }
        if let Some(kept) = usable(&self.context.lock().unwrap()) {
            return Ok(kept);
        }
        let webmail = sign_in().await.map_err(NoContext::Failed)?;
        let made = Arc::new(Context::new(webmail));
        {
            let mut slot = self.context.lock().unwrap();
            if !self.has_ended() {
                *slot = Some(made.clone());
                return Ok(made);
            }
        }
        // Signed out while it was signing in: that webmail session ends too.
        made.webmail.end_session().await;
        Err(NoContext::Ended)
    }

    // A context the webmail refused, forgotten, unless another request has
    // replaced it since.
    pub(crate) fn drop_context(&self, refused: &Arc<Context>) {
        let mut slot = self.context.lock().unwrap();
        if slot.as_ref().is_some_and(|kept| Arc::ptr_eq(kept, refused)) {
            *slot = None;
        }
    }

    pub(crate) fn kept_inbox(&self) -> Option<Value> {
        let kept = self.inbox.lock().unwrap();
        kept.as_ref().filter(|(at, _)| at.elapsed() < INBOX_KEPT).map(|(_, mail)| mail.clone())
    }

    pub(crate) fn keep_inbox(&self, mail: &Value) {
        if !self.has_ended() {
            *self.inbox.lock().unwrap() = Some((Instant::now(), mail.clone()));
        }
    }

    pub(crate) fn forget_inbox(&self) {
        self.inbox.lock().unwrap().take();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use tonapi_providers::NetSettings;

    use super::*;

    fn webmail() -> Webmail {
        Webmail::detached(url::Url::parse("http://127.0.0.1:9/").unwrap(), NetSettings { https_only: false, user_agent: None })
    }

    #[test]
    fn an_ended_session_keeps_nothing() {
        let memory = MailMemory::default();
        let session = memory.of("s");
        session.keep_inbox(&serde_json::json!({ "messages": [] }));
        assert!(session.kept_inbox().is_some());
        assert!(memory.end("s").is_none());
        assert!(!memory.holds("s"));
        assert!(session.has_ended());
        assert!(session.kept_inbox().is_none());
        // Whatever a request still on its way brings back.
        session.keep_inbox(&serde_json::json!({}));
        assert!(session.kept_inbox().is_none());
    }

    // W5: the mail page's routes at once sign in to the webmail once.
    #[tokio::test]
    async fn one_sign_in_for_requests_at_once() {
        let memory = MailMemory::default();
        let session = memory.of("s");
        let signed = Arc::new(AtomicUsize::new(0));
        let mut asked = Vec::new();
        for _ in 0..8 {
            let session = session.clone();
            let signed = signed.clone();
            asked.push(tokio::spawn(async move {
                session
                    .context::<(), _, _>(None, || async {
                        signed.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(30)).await;
                        Ok(webmail())
                    })
                    .await
                    .ok()
            }));
        }
        let mut contexts = Vec::new();
        for one in asked {
            contexts.push(one.await.unwrap().unwrap());
        }
        assert_eq!(signed.load(Ordering::SeqCst), 1);
        assert!(contexts.windows(2).all(|pair| Arc::ptr_eq(&pair[0], &pair[1])));

        // Refused: the next request signs in again, once; a request that
        // still holds the refused one finds the new one.
        session.drop_context(&contexts[0]);
        let renewed = session.context::<(), _, _>(Some(&contexts[0]), || async { Ok(webmail()) }).await.ok().unwrap();
        assert!(!Arc::ptr_eq(&renewed, &contexts[0]));
        let found = session.context::<(), _, _>(Some(&contexts[0]), || async { panic!("signed in twice") }).await.ok().unwrap();
        assert!(Arc::ptr_eq(&renewed, &found));
    }

    // A sign-in that lands after the session ended isn't kept.
    #[tokio::test]
    async fn a_sign_in_that_lands_after_a_logout_is_not_kept() {
        let memory = Arc::new(MailMemory::default());
        let session = memory.of("s");
        let signing = {
            let session = session.clone();
            tokio::spawn(async move {
                session
                    .context::<(), _, _>(None, || async {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok(webmail())
                    })
                    .await
                    .is_ok()
            })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(memory.end("s").is_none());
        assert!(!signing.await.unwrap());
        assert!(session.context.lock().unwrap().is_none());
    }
}
