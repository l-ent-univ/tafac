// What the mail page reads (tonapi_providers::zimbra::listing, folders,
// prefs for the shapes, Node's for each):
//
//   GET recent?offset&q&folder&fresh   a page of the list (threads, newest
//                                      first), or a search; the inbox's
//                                      first page kept two minutes
//   GET message?id                     one message, its HTML cleaned
//   GET thread?id&folder               a thread's messages, oldest first
//   GET folders                        the folder tree, always read afresh
//   GET prefs                          « mark read » delay, attachment
//                                      limits, identities
//   GET open                           the webmail opened signed in
//
// Recent's parameters never refuse: an offset is read as parseInt does and
// held to 0..5000, a folder not of its kind is the inbox, a search keeps
// only the words it may send (src/mailSearch.js).

use http::header::{CACHE_CONTROL, LOCATION};
use http::HeaderValue;
use serde_json::Value;
use tonapi_providers::zimbra::folders::{folders_answer, is_valid_folder_id, INBOX_FOLDER};
use tonapi_providers::zimbra::listing::{self, InboxRows};
use tonapi_providers::zimbra::prefs::prefs_answer;
use tonapi_providers::zimbra::search::parse_search_words;
use tonapi_config::MailService;

use super::{empty, error, reply, Call, MailBody, MailError, Query, SOAP_TIMEOUT};
use crate::gateway::Gateway;

const MAIL: &str = "urn:zimbraMail";
// Where a row and the webmail link of the list lead: the webmail opened
// signed in (open, below).
pub(crate) const WEBMAIL_HREF: &str = "/__ent_auth/mail/open";
// A page of the list: the universities' maxMessages (20 for both).
const PAGE: f64 = 20.0;

impl Gateway {
    pub(super) async fn mail_recent(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let offset = listing::parse_offset(query.text("offset").as_deref());
        let words = query.text("q").map(|written| parse_search_words(&written)).unwrap_or_default();
        let folder = query.text("folder").filter(|folder| is_valid_folder_id(folder)).unwrap_or_else(|| INBOX_FOLDER.to_string());
        let searching = !words.is_empty();
        let first_page = folder == INBOX_FOLDER && !searching && offset == 0;

        if first_page && query.text("fresh").as_deref() != Some("1") {
            if let Some(kept) = call.mail.kept_inbox() {
                return Ok(reply(200, &listing::recent_answer(kept, None, false)));
            }
        }
        let (words_asked, folder_asked) = (&words, &folder);
        let mail = self.with_webmail(call, |context| async move { self.inbox_page(&context, offset, words_asked, folder_asked).await }).await?;
        if first_page {
            call.mail.keep_inbox(&mail);
        }
        Ok(reply(200, &listing::recent_answer(mail, None, searching)))
    }

    // queryZimbraInbox: the search, and the folder's unread count for a
    // first page; the inbox, unsearched, read through REST when SOAP is
    // refused for another reason than the session.
    async fn inbox_page(&self, context: &std::sync::Arc<super::state::Context>, offset: usize, words: &[String], folder: &str) -> Result<Value, MailError> {
        let page = listing::page_size(Some(PAGE));
        let Some(search) = listing::inbox_search_request(offset, words, folder, page) else {
            return Err(MailError::Other("a search the webmail can't be asked".to_string()));
        };
        let count = async {
            if listing::reads_folder_count(offset, words) {
                context.webmail.soap("GetFolderRequest", MAIL, listing::folder_count_request(folder), SOAP_TIMEOUT).await.ok()
            } else {
                None
            }
        };
        let (searched, counted) = tokio::join!(context.webmail.soap("SearchRequest", MAIL, search, SOAP_TIMEOUT), count);
        match searched {
            Ok(found) => Ok(listing::inbox_page(InboxRows::Threads(&found), counted.as_ref(), page, Some(WEBMAIL_HREF))),
            Err(failure) if !listing::uses_rest_fallback(words, folder) || failure.refused => Err(failure.into()),
            Err(_) => {
                let messages = context.webmail.rest_inbox(offset + page + 1).await?;
                Ok(listing::inbox_page(InboxRows::Rest { messages: &messages, offset }, counted.as_ref(), page, Some(WEBMAIL_HREF)))
            }
        }
    }

    pub(super) async fn mail_thread(&self, call: &Call<'_, '_>, query: &Query<'_>) -> Result<http::Response<MailBody>, MailError> {
        let id = query.text("id").unwrap_or_default();
        if !listing::is_valid_message_id(&id) {
            return Ok(error(400, "Invalid thread id."));
        }
        let folder = query.text("folder").filter(|folder| is_valid_folder_id(folder)).unwrap_or_else(|| INBOX_FOLDER.to_string());
        let (id, folder) = (&id, &folder);
        let rows = self
            .with_webmail(call, |context| async move {
                match context.webmail.soap("GetConvRequest", MAIL, listing::thread_request(id), SOAP_TIMEOUT).await {
                    Ok(conversation) => Ok(listing::thread_rows(Some(&conversation), id, folder, Some(WEBMAIL_HREF))),
                    // A lone mail's virtual thread Zimbra won't give: that
                    // mail alone.
                    Err(failure) if id.starts_with('-') && !failure.refused => Ok(listing::thread_rows(None, id, folder, Some(WEBMAIL_HREF))),
                    Err(failure) => Err(failure.into()),
                }
            })
            .await?;
        Ok(reply(200, &listing::thread_answer(&rows)))
    }

    pub(super) async fn mail_folders(&self, call: &Call<'_, '_>) -> Result<http::Response<MailBody>, MailError> {
        let folders = self.with_webmail(call, |context| async move { self.mail_folder_list(&context, true).await }).await?;
        Ok(reply(200, &folders_answer(&folders)))
    }

    pub(super) async fn mail_prefs(&self, call: &Call<'_, '_>) -> Result<http::Response<MailBody>, MailError> {
        let answer = self
            .with_webmail(call, |context| async move {
                let (delay, limits, identities) = tokio::join!(self.mark_read_delay(&context), self.attachment_limits(&context), self.identities(&context, false));
                // « De : » without a choice rather than no prefs at all.
                let identities = match identities {
                    Ok(identities) => identities.list.clone(),
                    Err(failure) if failure.refused() => return Err(failure),
                    Err(_) => Vec::new(),
                };
                Ok(prefs_answer(delay?, &limits?, &identities))
            })
            .await?;
        Ok(reply(200, &answer))
    }

    // The webmail opened already signed in: Zimbra's preauth with the
    // session's own token (its cookie set for the browser, the inbox
    // shown). Never in the log: the address holds the token.
    pub(super) async fn mail_open(&self, call: &Call<'_, '_>) -> Result<http::Response<MailBody>, MailError> {
        let preauth = self.with_webmail(call, |context| async move { Ok(context.webmail.preauth_url()) }).await?;
        Ok(match preauth {
            Some(address) => redirect(address.as_str()).unwrap_or_else(|| self.mail_open_fallback(Some(&call.held.session.university))),
            None => self.mail_open_fallback(Some(&call.held.session.university)),
        })
    }

    // Where the open link leads when the webmail can't be opened signed in:
    // the launch relay's own link to it (its sign-in walked there), or the
    // page.
    pub(super) fn mail_open_fallback(&self, university: Option<&str>) -> http::Response<MailBody> {
        let entry = university.and_then(|university| self.universities.get(university)).and_then(|found| match &found.settings.university.services.mail {
            Some(MailService::ZimbraRest { base_url, entry_url, .. }) => Some(entry_url.clone().unwrap_or_else(|| base_url.clone())),
            _ => None,
        });
        let address = entry.map_or_else(|| "/".to_string(), |entry| format!("/__ent_auth/launch?url={}", encode_component(entry.as_str())));
        redirect(&address).unwrap_or_else(|| empty(500))
    }
}

// encodeURIComponent.
fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

// A 302 to `address`, never kept, never with a Referer: the address may
// hold the webmail's token.
fn redirect(address: &str) -> Option<http::Response<MailBody>> {
    let location = HeaderValue::from_str(address).ok()?;
    let mut response = empty(302);
    let headers = response.headers_mut();
    headers.insert(LOCATION, location);
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_link_is_encoded_as_node_encodes_it() {
        assert_eq!(encode_component("https://partage.univ-rennes.fr/"), "https%3A%2F%2Fpartage.univ-rennes.fr%2F");
        assert_eq!(encode_component("a b&c=é"), "a%20b%26c%3D%C3%A9");
        let response = redirect("/__ent_auth/launch?url=x").unwrap();
        assert_eq!(response.status(), 302);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert!(redirect("/a\r\nset-cookie: x").is_none());
    }
}
