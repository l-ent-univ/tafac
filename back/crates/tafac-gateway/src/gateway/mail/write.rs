// What the composer and Réglages › Messagerie write and read
// (tonapi_providers::zimbra, crate::mail for the page's payloads):
//
//   GET autocomplete?q        recipient suggestions, 6 seconds at most
//   GET signatures?fresh      the webmail's signatures, the custom one
//   POST signature { text }   the custom signature written
//   GET draft?id              a draft, to resume it
//   POST draft                a draft saved
//   POST send                 a mail sent

use std::sync::Arc;

use serde_json::{json, Value};
use tonapi_providers::mail::html::read_signature_content;
use tonapi_providers::zimbra::autocomplete::{autocomplete_answer, autocomplete_query, autocomplete_request, normalize_autocomplete, DEFAULT_LIMIT};
use tonapi_providers::zimbra::signatures::{custom_signature_request, find_custom_signature, normalize_custom_signature_text, read_signatures, signatures_answer, CustomSignatureError, Signature};

use super::state::Context;
use super::{error, reply, retry_after, Call, MailBody, MailError, Query, SOAP_TIMEOUT};
use crate::gateway::Gateway;
use crate::mail::limits::limit_keys;

const ACCOUNT: &str = "urn:zimbraAccount";

// The directory's answer is waited for this long: the composer asks as the
// student types.
const AUTOCOMPLETE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);

impl Gateway {
    pub(super) async fn mail_autocomplete(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        // Too short, or not one text: nothing is asked. Never logged.
        let Some(searched) = autocomplete_query(query.text("q").as_deref()) else {
            return Ok(reply(200, &autocomplete_answer(&[])));
        };
        let request = &autocomplete_request(&searched);
        let suggestions = self
            .with_webmail(call, |context| async move {
                let answer = context.webmail.soap("AutoCompleteRequest", "urn:zimbraMail", request.clone(), AUTOCOMPLETE_TIMEOUT).await?;
                Ok(normalize_autocomplete(&answer, DEFAULT_LIMIT))
            })
            .await?;
        Ok(reply(200, &autocomplete_answer(&suggestions)))
    }

    pub(super) async fn mail_signatures(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let fresh = query.text("fresh").as_deref() == Some("1");
        let answer = self
            .with_webmail(call, |context| async move {
                let (list, identities) = tokio::join!(self.signature_list(&context), self.identities(&context, fresh));
                let (list, identities) = (list?, identities?);
                Ok(signatures_answer(&list, &identities.list, &identities.signatures))
            })
            .await?;
        Ok(reply(200, &answer))
    }

    // POST /mail/signature { text }: the webmail's « Tafac » signature made
    // `text` (that one only, by its id), then the list as it is now. Its own
    // limit by session. The text is never logged.
    pub(super) async fn mail_signature(&self, call: &Call<'_, '_>, body: &Value) -> Result<http::Response<MailBody>, MailError> {
        let text = match normalize_custom_signature_text(body.get("text")) {
            Ok(text) => text,
            Err(refused @ CustomSignatureError::TooLong) => return Ok(error(413, refused.code())),
            Err(refused) => return Ok(error(400, refused.code())),
        };
        let slot = match self.mail_limits.sends.signatures.take(&limit_keys(&call.held.session.id, None), 1) {
            Ok(slot) => slot,
            Err(seconds) => return Ok(retry_after(error(429, "mail_signature_rate_limited"), seconds)),
        };
        let text = &text;
        let written = self
            .with_webmail(call, |context| async move {
                self.write_custom_signature(&context, text).await?;
                let (list, identities) = tokio::join!(self.signature_list(&context), self.identities(&context, false));
                let (list, identities) = (list?, identities?);
                Ok(signatures_answer(&list, &identities.list, &identities.signatures))
            })
            .await;
        match written {
            Ok(answer) => Ok(reply(200, &answer)),
            Err(MailError::Soap(fault)) if fault.code_is("TOO_MANY_SIGNATURES") => {
                slot.release();
                Ok(error(409, "mail_signature_limit"))
            }
            Err(MailError::Soap(fault)) if fault.code_is("SIGNATURE_TOO_LONG") || fault.code_is("TOO_LONG") => {
                slot.release();
                Ok(error(413, "mail_signature_too_long"))
            }
            Err(failure) => Err(failure),
        }
    }

    // The webmail's signatures, each cleaned (readSignatureContent).
    pub(super) async fn signature_list(&self, context: &Arc<Context>) -> Result<Vec<Signature>, MailError> {
        let answer = context.webmail.soap("GetSignaturesRequest", ACCOUNT, json!({}), SOAP_TIMEOUT).await?;
        Ok(read_signatures(&answer)
            .into_iter()
            .map(|raw| {
                let content = read_signature_content(raw.html.as_deref(), raw.text.as_deref());
                Signature { id: raw.id, name: raw.name, html: content.html, text: content.text, has_images: content.has_images }
            })
            .collect())
    }

    // The custom signature written: created, modified or deleted by its id.
    // Made meanwhile (another tab, the webmail): modified instead, once.
    async fn write_custom_signature(&self, context: &Arc<Context>, text: &str) -> Result<(), MailError> {
        let list = self.signature_list(context).await?;
        let Some(request) = custom_signature_request(text, find_custom_signature(&list)) else { return Ok(()) };
        match context.webmail.soap(request.name, ACCOUNT, request.body, SOAP_TIMEOUT).await {
            Ok(_) => Ok(()),
            Err(fault) if request.name == "CreateSignatureRequest" && fault.code_is("SIGNATURE_EXISTS") => {
                let list = self.signature_list(context).await?;
                match custom_signature_request(text, find_custom_signature(&list)) {
                    Some(retry) if retry.name != "CreateSignatureRequest" => {
                        context.webmail.soap(retry.name, ACCOUNT, retry.body, SOAP_TIMEOUT).await?;
                        Ok(())
                    }
                    _ => Err(fault.into()),
                }
            }
            Err(fault) => Err(fault.into()),
        }
    }



}
