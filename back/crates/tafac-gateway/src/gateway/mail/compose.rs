// A message read, and the composer's mail: read, saved, sent.
//
//   GET message?id     one message for the reader, its HTML cleaned
//                      (tonapi_providers::mail::html), its parts by
//                      Tafac's own route
//   GET draft?id       a draft of the Drafts folder, to resume it, its HTML
//                      cleaned again to what the editor may hold
//   POST draft         the composer's draft saved (SaveDraftRequest)
//   POST send          the composer's mail sent (SendMsgRequest)
//
// A send's body is the page's (crate::mail::payload: Node's checks and
// codes), but never its From address nor a signature's HTML: the address
// is one of the account's identities, read from the webmail; the signature
// is built here from the university's settings, or is the student's own,
// read from the webmail when the mail goes. Its files are this session's
// uploads only; the images of its text are png, jpeg or gif, the ones from
// another mail too (W8). A send's uid sends once, however many times the
// page asks (crate::mail::limits::SendOnce: the entry made before the
// first await). Only a draft gone meanwhile has the send asked again,
// without it and with the same uid. Nothing of the mail is ever logged.

use std::sync::Arc;

use serde_json::{json, Value};
use tonapi_http::RequestBody;
use tonapi_providers::mail::html::{build_mail_html, composer_html_to_text, frame_signature, sanitize_composer_html, select_inline_images, InlineImageSource};
use tonapi_providers::zimbra::compose::{self as zimbra_compose, build_zimbra_message, InlinePart, ReplyOrigin, SenderIdentity, ZimbraMessage};
use tonapi_providers::zimbra::identities::pick_identity;
use tonapi_providers::zimbra::listing::is_valid_message_id;
use tonapi_providers::zimbra::message::mail_message_response;
use tonapi_providers::zimbra::signatures::{find_custom_signature, pick_partage_signature};
use tonapi_providers::zimbra::upload::{parse_upload_response, upload_disposition};
use tonapi_providers::zimbra::webmail::PartError;

use super::state::Context;
use super::{error, reply, retry_after, Call, MailBody, MailError, Query, SOAP_TIMEOUT};
use crate::gateway::Gateway;
use crate::mail::faults::{is_partial_send, map_send_fault, partial_body, retry_without_draft, ComposeRefusal};
use crate::mail::limits::{limit_keys, Begun};
use crate::mail::payload::{normalize_compose_payload, ComposePayload, InlineImage, PartReference, SignatureMode};
use crate::mail::signature_block::{build_mail_signature, resolve_signature, BuiltSignature, LogoPart};
use crate::mail::Sent;

const MAIL: &str = "urn:zimbraMail";
// A message's body read up to this much (Node's MAIL_MESSAGE_MAX_BYTES).
const MESSAGE_MAX_BYTES: u64 = 1_000_000;
// The image types a mail's text may show (Node's INLINE_IMAGE_TYPES).
const INLINE_TYPES: [&str; 3] = ["image/png", "image/jpeg", "image/gif"];

// Why a send or a save has no answer of its own.
enum Refused {
    // Refused here, or a fault of Zimbra's the page can act on.
    Page(ComposeRefusal),
    Failed(MailError),
}

impl From<MailError> for Refused {
    fn from(error: MailError) -> Self {
        Refused::Failed(error)
    }
}

impl From<ComposeRefusal> for Refused {
    fn from(refusal: ComposeRefusal) -> Self {
        Refused::Page(refusal)
    }
}

// An image of the text, as the mail takes it.
struct Image {
    listed: InlineImage,
    alt: String,
}

// A send's or a save's body, checked, its HTML cleaned to the composer's
// own and its images to those the text shows (normalizeComposePayload).
struct Prepared {
    payload: ComposePayload,
    html: String,
    images: Vec<Image>,
}

fn prepare(body: &Value, draft: bool) -> Result<Prepared, ComposeRefusal> {
    let payload = normalize_compose_payload(body, draft)?;
    let clean = sanitize_composer_html(&payload.raw_html);
    let references: Vec<Value> = payload.listed_images.iter().map(|image| json!({ "cid": image.cid })).collect();
    let (html, kept) = select_inline_images(&clean, &references);
    let images = kept
        .iter()
        .filter_map(|kept| {
            let cid = kept.get("cid")?.as_str()?;
            let listed = payload.listed_images.iter().find(|image| image.cid == cid)?.clone();
            Some(Image { listed, alt: kept.get("alt").and_then(Value::as_str).unwrap_or_default().to_string() })
        })
        .collect();
    Ok(Prepared { payload, html, images })
}

fn reference(file: &PartReference) -> zimbra_compose::PartReference {
    match file {
        PartReference::Upload { aid } => zimbra_compose::PartReference::Upload { aid: aid.clone() },
        PartReference::Message { message_id, part } => zimbra_compose::PartReference::Message { message_id: message_id.clone(), part: part.clone() },
    }
}

fn recipients(list: &[crate::mail::payload::Recipient]) -> Vec<zimbra_compose::Recipient> {
    list.iter().map(|entry| zimbra_compose::Recipient { name: entry.name.clone(), email: entry.email.clone() }).collect()
}

// The images as the mail's HTML shows them: by their Content-ID.
fn image_sources(images: &[Image]) -> Vec<InlineImageSource> {
    images.iter().map(|image| InlineImageSource { cid: image.listed.cid.clone(), src: format!("cid:{}", image.listed.cid), width: image.listed.width, height: image.listed.height, alt: image.alt.clone() }).collect()
}

fn image_parts(images: &[Image]) -> Vec<InlinePart> {
    images.iter().map(|image| InlinePart { cid: image.listed.cid.clone(), reference: reference(&image.listed.file) }).collect()
}

// A part of a message's MIME tree, by its number.
fn find_part<'a>(parts: Option<&'a Value>, wanted: &str, depth: usize) -> Option<&'a Value> {
    if depth > 32 {
        return None;
    }
    let list: Vec<&Value> = match parts? {
        Value::Array(list) => list.iter().collect(),
        single @ Value::Object(_) => vec![single],
        _ => return None,
    };
    list.into_iter().find_map(|part| if part.get("part").and_then(Value::as_str) == Some(wanted) { Some(part) } else { find_part(part.get("mp"), wanted, depth + 1) })
}

// The `m` of a GetMsg or SaveDraft answer.
fn first_message(answer: &Value) -> Option<&Value> {
    match answer.get("m")? {
        Value::Array(list) => list.first(),
        single => Some(single),
    }
}

fn fault_arguments(fault: &tonapi_providers::zimbra::webmail::SoapError) -> Vec<(String, String)> {
    fault.args.iter().filter_map(|argument| Some((argument.get("n")?.as_str()?.to_string(), argument.get("_content")?.as_str()?.to_string()))).collect()
}

// A Content-ID for a logo of the signature, unique to this mail.
fn logo_cid(index: usize) -> String {
    let unique = crate::session::cookie::random_id().unwrap_or_else(|| format!("{}", super::super::now_ms()));
    format!("<tafac-logo-{}.{unique}@tafac.fr>", index + 1)
}

impl Gateway {
    // GET /mail/message?id: one message, cleaned for the reader.
    pub(super) async fn mail_message(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let id = query.text("id").unwrap_or_default();
        if !is_valid_message_id(&id) {
            return Ok(error(400, "Invalid message id."));
        }
        let (id, own) = (&id, call.own_host.as_deref());
        let found = self
            .with_webmail(call, |context| async move {
                let request = json!({ "m": { "id": id, "html": 1, "neuter": 0, "needExp": 1, "max": MESSAGE_MAX_BYTES } });
                match context.webmail.soap("GetMsgRequest", MAIL, request, SOAP_TIMEOUT).await {
                    Ok(answer) => Ok(mail_message_response(&answer, id, &own.into_iter().collect::<Vec<_>>())),
                    Err(fault) if !fault.refused && (fault.code_is("NO_SUCH_MSG") || fault.code_is("NO_SUCH_ITEM")) => Ok(None),
                    Err(fault) => Err(fault.into()),
                }
            })
            .await?;
        Ok(found.map_or_else(|| error(404, "No such message."), |message| reply(200, &message)))
    }

    // GET /mail/draft?id: a draft to resume, only a mail of the Drafts
    // folder (or flagged a draft).
    pub(super) async fn mail_draft_read(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let id = query.text("id").unwrap_or_default();
        if !is_valid_message_id(&id) || id.starts_with('-') {
            return Ok(error(400, "Invalid message id."));
        }
        let id = &id;
        let found = self
            .with_webmail(call, |context| async move {
                let request = json!({ "m": { "id": id, "html": 1, "neuter": 0, "max": MESSAGE_MAX_BYTES } });
                let answer = match context.webmail.soap("GetMsgRequest", MAIL, request, SOAP_TIMEOUT).await {
                    Ok(answer) => answer,
                    Err(fault) if !fault.refused && (fault.code_is("NO_SUCH_MSG") || fault.code_is("NO_SUCH_ITEM")) => return Ok(None),
                    Err(fault) => return Err(fault.into()),
                };
                let identities = self.identities(&context, false).await?;
                let ids: Vec<&str> = identities.list.iter().map(|identity| identity.id.as_str()).collect();
                Ok(zimbra_compose::draft_response(&answer, &ids))
            })
            .await?;
        Ok(found.map_or_else(|| error(404, "No such draft."), |draft| reply(200, &draft)))
    }

    // POST /mail/draft: the draft saved, each of the page's files and
    // images as a part of it now.
    pub(super) async fn mail_draft_save(&self, call: &Call<'_, '_>, body: &Value) -> Result<http::Response<MailBody>, MailError> {
        let prepared = match prepare(body, true) {
            Ok(prepared) => prepared,
            Err(refused) => return Ok(reply(refused.status, &refused.body())),
        };
        let keys = limit_keys(&call.held.session.id, Some(&call.held.session.user));
        let _slot = match self.mail_limits.sends.drafts.take(&keys, 0) {
            Ok(slot) => slot,
            Err(seconds) => return Ok(retry_after(error(429, "mail_send_rate_limited"), seconds)),
        };
        let prepared = &prepared;
        let saved = self.with_webmail(call, |context| async move { Ok(self.save_draft(call, &context, prepared).await) }).await;
        let saved = match saved {
            Ok(Ok(draft)) => draft,
            Ok(Err(Refused::Page(refused))) => return Ok(reply(refused.status, &refused.body())),
            Ok(Err(Refused::Failed(failure))) | Err(failure) => return self.compose_failed(call, failure, &prepared.payload),
        };
        call.mail.forget_inbox();
        Ok(reply(200, &json!({ "draft": saved })))
    }

    async fn save_draft(&self, call: &Call<'_, '_>, context: &Arc<Context>, prepared: &Prepared) -> Result<Value, Refused> {
        let payload = &prepared.payload;
        let session = &call.held.session.id;
        let (identities, limits) = tokio::join!(self.identities(context, false), self.attachment_limits(context));
        let (identities, limits) = (identities?, limits?);
        let identity = pick_identity(&identities.list, payload.identity_id.as_deref()).or_else(|| identities.list.first());
        let listed: Vec<InlineImage> = prepared.images.iter().map(|image| image.listed.clone()).collect();
        self.mail_limits.uploads.check(session, &payload.attachments, &listed, limits.max_total_bytes)?;
        // The uploads' names, for their parts to be found by name when the
        // draft's count of them isn't what was sent.
        let names: Vec<Option<String>> = payload.attachments.iter().map(|entry| entry.aid().and_then(|aid| self.mail_limits.uploads.get(session, aid)).map(|upload| upload.name)).collect();
        let sender = identity.map(|identity| SenderIdentity { id: identity.id.clone(), name: identity.name.clone(), email: identity.email.clone() });
        let attachments: Vec<zimbra_compose::PartReference> = payload.attachments.iter().map(reference).collect();
        let inline = image_parts(&prepared.images);
        let origin = payload.origin.as_ref().map(|origin| ReplyOrigin { message_id: origin.message_id.clone(), reply_type: origin.kind.reply_type().to_string(), message_id_header: None });
        let (to, cc, bcc) = (recipients(&payload.to), recipients(&payload.cc), recipients(&payload.bcc));
        let html = build_mail_html(&prepared.html, "", true, &image_sources(&prepared.images));
        let text = composer_html_to_text(&prepared.html, "");
        let mut draft_id = payload.draft_id.clone();
        let answer = loop {
            let message = build_zimbra_message(&ZimbraMessage {
                identity: sender.as_ref(),
                to: &to,
                cc: &cc,
                bcc: &bcc,
                subject: &payload.subject,
                html: &html,
                text: &text,
                inline_parts: &inline,
                attachments: &attachments,
                origin: origin.as_ref(),
                draft_id: draft_id.as_deref(),
                for_draft: true,
            });
            match context.webmail.soap("SaveDraftRequest", MAIL, json!({ "m": message }), SOAP_TIMEOUT).await {
                Ok(answer) => break answer,
                // The draft deleted meanwhile (in the webmail): saved as a new one.
                Err(fault) if draft_id.is_some() && !fault.refused && (fault.code_is("NO_SUCH_MSG") || fault.code_is("NO_SUCH_ITEM")) => draft_id = None,
                Err(fault) => return Err(MailError::from(fault).into()),
            }
        };
        let mut draft = first_message(&answer).cloned();
        let id = draft.as_ref().and_then(|draft| draft.get("id")).map(super::js_string).unwrap_or_default();
        if !is_valid_message_id(&id) {
            return Err(MailError::Other("Zimbra SaveDraftRequest gave no draft id".to_string()).into());
        }
        // Its parts, when the answer didn't list them. Saved already: a
        // failure here still gives the page the draft's id.
        if (!payload.attachments.is_empty() || !prepared.images.is_empty()) && !draft.as_ref().is_some_and(|draft| draft.get("mp").is_some_and(Value::is_array)) {
            draft = match context.webmail.soap("GetMsgRequest", MAIL, json!({ "m": { "id": id, "max": 1 } }), SOAP_TIMEOUT).await {
                Ok(read) => first_message(&read).cloned(),
                Err(fault) if fault.refused => return Err(MailError::from(fault).into()),
                Err(fault) => {
                    eprintln!("[mail] draft parts unread: {fault}");
                    None
                }
            };
        }
        let draft = draft.unwrap_or(Value::Null);
        let settled = zimbra_compose::settle_draft_attachments(&attachments, &id, &zimbra_compose::read_draft_attachment_parts(&draft), &names);
        let images = zimbra_compose::settle_draft_inline_images(&inline, &id, &zimbra_compose::read_draft_inline_parts(&draft));
        self.mail_limits.uploads.forget(session, &settled.used.iter().chain(&images.used).cloned().collect::<Vec<_>>());
        Ok(json!({
            "id": id,
            "attachments": settled.attachments.iter().map(|part| part.as_ref().map_or(Value::Null, |part| json!({ "messageId": part.message_id, "part": part.part }))).collect::<Vec<_>>(),
            "inlineImages": images.inline_images.iter().map(|image| image.as_ref().map_or(Value::Null, |(cid, part)| json!({ "cid": cid, "messageId": part.message_id, "part": part.part }))).collect::<Vec<_>>(),
        }))
    }

    // POST /mail/send: the mail sent, once per uid.
    pub(super) async fn mail_send(&self, call: &Call<'_, '_>, body: &Value) -> Result<http::Response<MailBody>, MailError> {
        let prepared = match prepare(body, false) {
            Ok(prepared) => prepared,
            Err(refused) => return Ok(reply(refused.status, &refused.body())),
        };
        let session = &call.held.session.id;
        let uid = prepared.payload.send_uid.clone().unwrap_or_default();
        let recipients = prepared.payload.recipients();
        // A uid asked already: its first answer, nothing counted again.
        let slot = if self.mail_limits.send_once.has(session, &uid) {
            None
        } else {
            let keys = limit_keys(session, Some(&call.held.session.user));
            match self.mail_limits.sends.sends.take(&keys, recipients.len() as u64) {
                Ok(slot) => Some(slot),
                Err(seconds) => return Ok(retry_after(error(429, "mail_send_rate_limited"), seconds)),
            }
        };
        let ticket = match self.mail_limits.send_once.begin(session, &uid) {
            Begun::Repeat(wait) => {
                return Ok(match wait.outcome().await {
                    Some(Ok((status, body)) | Err(Some((status, body)))) => reply(status, &body),
                    Some(Err(None)) | None => error(500, "mail_unavailable"),
                });
            }
            Begun::First(ticket) => ticket,
        };
        let prepared = &prepared;
        let sent = self.with_webmail(call, |context| async move { Ok(self.send_mail(call, &context, prepared).await) }).await;
        let outcome = match sent {
            Ok(Ok(sent)) => Ok(sent),
            Ok(Err(refused)) => Err(refused),
            Err(failure) => Err(Refused::Failed(failure)),
        };
        match outcome {
            Ok(sent) => {
                ticket.finish(Ok(sent.clone()));
                Ok(reply(sent.0, &sent.1))
            }
            Err(Refused::Page(refused)) => {
                // Refused here (not a fault of Zimbra's): not counted.
                if let Some(slot) = slot {
                    slot.release();
                }
                let said: Sent = (refused.status, refused.body());
                ticket.finish(Err(Some(said.clone())));
                Ok(reply(said.0, &said.1))
            }
            Err(Refused::Failed(failure)) => {
                if let MailError::Soap(fault) = &failure {
                    let arguments = fault_arguments(fault);
                    let arguments: Vec<(&str, &str)> = arguments.iter().map(|(name, value)| (name.as_str(), value.as_str())).collect();
                    if let Some(mapped) = map_send_fault(fault.code.as_deref(), &arguments, &recipients, &prepared.payload.upload_aids()) {
                        eprintln!("[mail] send refused: {}", mapped.code);
                        let said: Sent = (mapped.status, mapped.body());
                        ticket.finish(Err(Some(said.clone())));
                        return Ok(reply(said.0, &said.1));
                    }
                }
                ticket.finish(Err(None));
                Err(failure)
            }
        }
    }

    async fn send_mail(&self, call: &Call<'_, '_>, context: &Arc<Context>, prepared: &Prepared) -> Result<Sent, Refused> {
        let payload = &prepared.payload;
        let session = &call.held.session.id;
        let (identities, limits) = tokio::join!(self.identities(context, false), self.attachment_limits(context));
        let (identities, limits) = (identities?, limits?);
        let Some(identity) = pick_identity(&identities.list, payload.identity_id.as_deref()) else {
            return Err(ComposeRefusal::new(400, "mail_send_invalid_identity").into());
        };
        let listed: Vec<InlineImage> = prepared.images.iter().map(|image| image.listed.clone()).collect();
        let aids = self.mail_limits.uploads.check(session, &payload.attachments, &listed, limits.max_total_bytes)?;
        self.check_message_images(context, &prepared.images).await?;

        let own_signature = payload.signature.include && payload.signature.mode != SignatureMode::Auto;
        let signature = resolve_signature(&call.held.session.university, &payload.signature, &identity.name, Some(&call.held.session.user));
        let logos = async {
            match &signature {
                Some(signature) if !signature.logos.is_empty() => self.upload_logos(context, signature).await,
                _ => Ok(Vec::new()),
            }
        };
        let original = async {
            match &payload.origin {
                Some(origin) => self.read_original(context, &origin.message_id).await.map(Some),
                None => Ok(None),
            }
        };
        let own_list = async { if own_signature { self.signature_list(context).await.map(Some) } else { Ok(None) } };
        let (logos, original, own_list) = tokio::join!(logos, original, own_list);
        let (logos, original, own_list) = (logos?, original?, own_list?);

        // An original deleted meanwhile: the mail still goes, as a new one.
        let origin = match (&payload.origin, original) {
            (Some(origin), Some(Some(header))) => Some(ReplyOrigin { message_id: origin.message_id.clone(), reply_type: origin.kind.reply_type().to_string(), message_id_header: header }),
            _ => None,
        };
        let built = match (&own_list, &signature) {
            (Some(list), _) => {
                let picked = if payload.signature.mode == SignatureMode::Custom {
                    find_custom_signature(list)
                } else {
                    pick_partage_signature(list, identities.signatures.get(&identity.id), payload.origin.is_some())
                };
                let framed = picked.map_or_else(|| frame_signature("", ""), |picked| frame_signature(&picked.html, &picked.text));
                BuiltSignature { html: framed.html, text: framed.text }
            }
            (None, Some(signature)) => build_mail_signature(&signature.lines, &logos.iter().map(|(part, _)| part.clone()).collect::<Vec<_>>()),
            (None, None) => BuiltSignature::default(),
        };
        let sender = SenderIdentity { id: identity.id.clone(), name: identity.name.clone(), email: identity.email.clone() };
        let attachments: Vec<zimbra_compose::PartReference> = payload.attachments.iter().map(reference).collect();
        let mut inline: Vec<InlinePart> = logos.iter().map(|(part, aid)| InlinePart { cid: part.cid.clone(), reference: zimbra_compose::PartReference::Upload { aid: aid.clone() } }).collect();
        inline.extend(image_parts(&prepared.images));
        let (to, cc, bcc) = (recipients(&payload.to), recipients(&payload.cc), recipients(&payload.bcc));
        let html = build_mail_html(&prepared.html, &built.html, false, &image_sources(&prepared.images));
        let text = composer_html_to_text(&prepared.html, &built.text);
        let mut draft_id = payload.draft_id.clone();
        let uid = payload.send_uid.clone().unwrap_or_default();
        let partial = loop {
            let message = build_zimbra_message(&ZimbraMessage {
                identity: Some(&sender),
                to: &to,
                cc: &cc,
                bcc: &bcc,
                subject: &payload.subject,
                html: &html,
                text: &text,
                inline_parts: &inline,
                attachments: &attachments,
                origin: origin.as_ref(),
                draft_id: draft_id.as_deref(),
                for_draft: false,
            });
            match context.webmail.soap("SendMsgRequest", MAIL, json!({ "suid": uid, "m": message }), SOAP_TIMEOUT).await {
                Ok(_) => break None,
                // Sent to some addresses only: sent all the same.
                Err(fault) if is_partial_send(fault.code.as_deref()) => break Some(fault),
                // The draft it replaces gone meanwhile: once more without
                // it, the same uid (Zimbra sends a uid once).
                Err(fault) if !fault.refused && retry_without_draft(fault.code.as_deref(), draft_id.is_some()) => draft_id = None,
                Err(fault) => return Err(MailError::from(fault).into()),
            }
        };
        self.mail_limits.uploads.forget(session, &aids);
        call.mail.forget_inbox();
        Ok(match partial {
            None => (200, json!({ "ok": true })),
            Some(fault) => {
                let arguments = fault_arguments(&fault);
                let arguments: Vec<(&str, &str)> = arguments.iter().map(|(name, value)| (name.as_str(), value.as_str())).collect();
                let mapped = map_send_fault(fault.code.as_deref(), &arguments, &payload.recipients(), &payload.upload_aids());
                (200, partial_body(mapped.as_ref()))
            }
        })
    }

    // The images of the text taken from another mail: png, jpeg or gif
    // parts, as an upload has to be (W8). A part not found is left to the
    // webmail, which refuses it.
    async fn check_message_images(&self, context: &Arc<Context>, images: &[Image]) -> Result<(), Refused> {
        for image in images {
            let PartReference::Message { message_id, part } = &image.listed.file else { continue };
            let read = match context.webmail.soap("GetMsgRequest", MAIL, json!({ "m": { "id": message_id, "max": 1 } }), SOAP_TIMEOUT).await {
                Ok(read) => read,
                Err(fault) if !fault.refused => continue,
                Err(fault) => return Err(MailError::from(fault).into()),
            };
            let found = first_message(&read).and_then(|message| find_part(message.get("mp"), part, 0));
            if let Some(found) = found {
                let kind = found.get("ct").and_then(Value::as_str).unwrap_or_default().split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
                if !INLINE_TYPES.contains(&kind.as_str()) {
                    return Err(ComposeRefusal::new(400, "mail_send_invalid").into());
                }
            }
        }
        Ok(())
    }

    // The mail answered or forwarded: whether it is still there (None), and
    // its Message-ID for In-Reply-To, read here, never taken from the page.
    async fn read_original(&self, context: &Arc<Context>, id: &str) -> Result<Option<Option<String>>, MailError> {
        match context.webmail.soap("GetMsgRequest", MAIL, json!({ "m": { "id": id, "max": 1 } }), SOAP_TIMEOUT).await {
            Ok(read) => Ok(first_message(&read).map(|message| {
                let header = message.get("mid").and_then(Value::as_str).unwrap_or_default().trim();
                let valid = header.len() <= 502 && header.starts_with('<') && header.ends_with('>') && header.len() > 2 && !header[1..header.len() - 1].chars().any(|c| c == '<' || c == '>' || c.is_whitespace());
                valid.then(|| header.to_string())
            })),
            Err(fault) if !fault.refused && (fault.code_is("NO_SUCH_MSG") || fault.code_is("NO_SUCH_ITEM")) => Ok(None),
            Err(fault) => Err(fault.into()),
        }
    }

    // The signature's logos uploaded with the mail (a few kB each): each
    // its Content-ID and the upload's id. A logo that won't upload is left
    // out (the signature's text stays); the session refused, signed in again.
    async fn upload_logos(&self, context: &Arc<Context>, signature: &crate::mail::signature_block::ResolvedSignature) -> Result<Vec<(LogoPart, String)>, MailError> {
        let mut parts = Vec::new();
        for (index, logo) in signature.logos.iter().enumerate() {
            let name = format!("logo-{}.png", index + 1);
            let sent = context.webmail.upload(RequestBody::from(logo.png.to_vec()), logo.png.len() as u64, "image/png", &upload_disposition(&name)).await;
            let uploaded = match sent {
                Ok((200, text)) => parse_upload_response(&text).filter(|parsed| parsed.status == 200 && parsed.uploads.len() == 1).and_then(|parsed| parsed.uploads.into_iter().next()),
                Ok((status, _)) if status == 401 || status == 403 => return Err(MailError::Refused("upload")),
                Ok(_) => None,
                Err(PartError::Refused) => return Err(MailError::Refused("upload")),
                Err(PartError::Network(_)) => None,
            };
            match uploaded {
                Some(uploaded) => parts.push((LogoPart { cid: logo_cid(index), width: logo.width, height: logo.height, alt: logo.alt.to_string() }, uploaded.aid)),
                None => eprintln!("[mail] signature logo left out: Zimbra logo upload failed"),
            }
        }
        Ok(parts)
    }

    // A send or a save that failed: a fault of Zimbra's the page can act on
    // (mapZimbraSendFault), else the route's own failure.
    fn compose_failed(&self, call: &Call<'_, '_>, failure: MailError, payload: &ComposePayload) -> Result<http::Response<MailBody>, MailError> {
        if let MailError::Soap(fault) = &failure {
            let arguments = fault_arguments(fault);
            let arguments: Vec<(&str, &str)> = arguments.iter().map(|(name, value)| (name.as_str(), value.as_str())).collect();
            if let Some(mapped) = map_send_fault(fault.code.as_deref(), &arguments, &[], &payload.upload_aids()) {
                eprintln!("[mail] {} refused: {}", call.route.name(), mapped.code);
                return Ok(reply(mapped.status, &mapped.body()));
            }
        }
        Err(failure)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_part_is_found_however_deep() {
        let tree = json!([{ "part": "1", "ct": "multipart/mixed", "mp": [{ "part": "1.1", "ct": "text/html" }, { "part": "2", "ct": "image/png" }] }]);
        assert_eq!(find_part(Some(&tree), "2", 0).and_then(|part| part.get("ct")), Some(&json!("image/png")));
        assert!(find_part(Some(&tree), "3", 0).is_none());
    }

    #[test]
    fn the_body_is_cleaned_and_only_the_images_the_text_shows_are_kept() {
        let body = json!({
            "to": [{ "email": "alex.martin@exemple.test" }],
            "subject": "Bonjour",
            "html": "<p>Salut<script>alert(1)</script></p><img data-inline-cid=\"tafac-img-0123abcd@tafac.fr\" alt=\"un chat\" width=\"10\" height=\"10\"><img data-inline-cid=\"tafac-img-0123abce@tafac.fr\">",
            "inlineImages": [
                { "cid": "tafac-img-0123abcd@tafac.fr", "source": "upload", "aid": "aid-00000001", "width": 10, "height": 10 },
            ],
            "sendUid": "uid-00000001",
            "from": "boss@exemple.test",
        });
        let prepared = prepare(&body, false).ok().unwrap();
        assert!(!prepared.html.contains("script"));
        assert_eq!(prepared.images.len(), 1);
        assert_eq!(prepared.images[0].alt, "un chat");
        // An image whose cid isn't listed leaves no <img> behind.
        assert_eq!(prepared.html.matches("<img").count(), 1);
    }
}
