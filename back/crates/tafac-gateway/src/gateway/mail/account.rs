// What a webmail sign-in reads once and keeps with it (state.rs, Context):
// the folders, the account's GetInfo, the attachment limits, the identities
// and the signatures each names, the « mark read » delay. Each goes with
// its context: a new sign-in reads them again.

use std::sync::Arc;

use serde_json::{json, Value};
use tonapi_providers::mail::attachments::AttachmentLimits;
use tonapi_providers::zimbra::folders::{folder_tree_request, folder_tree_root, normalize_folder_tree, MailFolder};
use tonapi_providers::zimbra::identities::{normalize_identities, read_identity_signature_ids};
use tonapi_providers::zimbra::prefs::{context_attachment_limits, info_request, mark_read_pref_request, parse_mark_read_pref, InfoRead};

use super::state::{Context, Identities};
use super::{MailError, SOAP_TIMEOUT};
use crate::gateway::Gateway;

const MAIL: &str = "urn:zimbraMail";
const ACCOUNT: &str = "urn:zimbraAccount";

impl Gateway {
    // The mailbox's folders (the root and all under it), kept with the
    // context for the `move` and folder action checks; `fresh` reads them
    // again (GET /mail/folders always does).
    pub(super) async fn mail_folder_list(&self, context: &Arc<Context>, fresh: bool) -> Result<Vec<MailFolder>, MailError> {
        if !fresh {
            if let Some(kept) = context.folders.lock().unwrap().clone() {
                return Ok(kept);
            }
        }
        let answer = context.webmail.soap("GetFolderRequest", MAIL, folder_tree_request(), SOAP_TIMEOUT).await?;
        let folders = normalize_folder_tree(folder_tree_root(&answer));
        *context.folders.lock().unwrap() = Some(folders.clone());
        Ok(folders)
    }

    // The account's GetInfo, once per context however many routes ask at
    // once: the one under way is waited for; a failure isn't kept.
    pub(super) async fn account_info(&self, context: &Arc<Context>) -> Result<Value, MailError> {
        let mut kept = context.info.lock().await;
        if let Some(info) = kept.as_ref() {
            return Ok(info.clone());
        }
        let info = context.webmail.soap("GetInfoRequest", ACCOUNT, info_request(), SOAP_TIMEOUT).await?;
        *kept = Some(info.clone());
        Ok(info)
    }

    // The account's attachment limits: kept once read; a GetInfo that fails
    // for another reason than the session gives the fallback's for this
    // request only.
    pub(super) async fn attachment_limits(&self, context: &Arc<Context>) -> Result<AttachmentLimits, MailError> {
        let kept = *context.limits.lock().unwrap();
        if let Some(limits) = kept {
            return Ok(limits);
        }
        let info = match self.account_info(context).await {
            Ok(info) => Some(info),
            Err(error) if error.refused() => return Err(error),
            Err(_) => None,
        };
        let read = context_attachment_limits(None, info.as_ref().map_or(InfoRead::Failed, InfoRead::Read));
        if read.keep {
            *context.limits.lock().unwrap() = Some(read.limits);
        }
        Ok(read.limits)
    }

    // The identities the account may send as, the default first, and the
    // signature each names. A GetIdentities that fails (not for the
    // session) leaves the account's own address. `fresh`: both read again.
    pub(super) async fn identities(&self, context: &Arc<Context>, fresh: bool) -> Result<Arc<Identities>, MailError> {
        if fresh {
            context.identities.lock().unwrap().take();
            context.info.lock().await.take();
        }
        if let Some(kept) = context.identities.lock().unwrap().clone() {
            return Ok(kept);
        }
        let (identities, info) = tokio::join!(context.webmail.soap("GetIdentitiesRequest", ACCOUNT, json!({}), SOAP_TIMEOUT), self.account_info(context));
        let identities = match identities {
            Ok(identities) => Some(identities),
            Err(error) if error.refused => return Err(error.into()),
            Err(_) => None,
        };
        let info = info?;
        {
            let mut limits = context.limits.lock().unwrap();
            if limits.is_none() {
                *limits = Some(context_attachment_limits(None, InfoRead::Read(&info)).limits);
            }
        }
        let read = Arc::new(Identities { list: normalize_identities(identities.as_ref(), Some(&info)), signatures: read_identity_signature_ids(identities.as_ref()) });
        *context.identities.lock().unwrap() = Some(read.clone());
        Ok(read)
    }

    // How long an open mail waits before it is marked read (seconds, -1
    // never), read once per context.
    pub(super) async fn mark_read_delay(&self, context: &Arc<Context>) -> Result<i64, MailError> {
        let kept = *context.mark_read.lock().unwrap();
        if let Some(delay) = kept {
            return Ok(delay);
        }
        let answer = context.webmail.soap("GetPrefsRequest", ACCOUNT, mark_read_pref_request(), SOAP_TIMEOUT).await?;
        let delay = parse_mark_read_pref(&answer);
        *context.mark_read.lock().unwrap() = Some(delay);
        Ok(delay)
    }
}
