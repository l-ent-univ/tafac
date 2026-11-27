// What the mail page does to messages and folders (Zimbra's
// MsgActionRequest and FolderActionRequest):
//
//   POST /__ent_auth/mail/action          { ids, action, folder? }
//   POST /__ent_auth/mail/folder-action   { folder, action: read | empty }
//
// Same-origin only (mod.rs), a JSON body of 100 kB at most. An action is
// one of the table's own (a `match`: `__proto__` or `constructor` is none).
// A move, and any folder action, is to one of the account's own folders,
// read again once when it isn't among the kept ones: a folder shared by
// someone else (a mountpoint, never listed), a calendar or an id made up is
// refused before the webmail is asked. The inbox's first page kept is
// forgotten: it would show the message as it was.

use serde_json::{json, Value};
use tonapi_providers::zimbra::folders::is_listed_folder;
use tonapi_providers::zimbra::listing::is_valid_message_id;

use super::{error, js_string, reply, Call, MailBody, MailError};
use crate::gateway::Gateway;

// A selection: the loaded list at most.
const MAX_IDS: usize = 500;

// Zimbra's op for each of the page's actions, and what it holds it to.
fn message_action(action: &str) -> Option<Value> {
    Some(match action {
        "read" => json!({ "op": "read" }),
        "unread" => json!({ "op": "!read" }),
        "flag" => json!({ "op": "flag" }),
        "unflag" => json!({ "op": "!flag" }),
        "trash" => json!({ "op": "trash" }),
        "spam" => json!({ "op": "spam" }),
        "inbox" => json!({ "op": "move", "l": "2" }),
        // To the body's `folder`.
        "move" => json!({ "op": "move" }),
        // Gone for good, only what lies in the trash (t) or the junk (j).
        "delete" => json!({ "op": "delete", "tcon": "tj" }),
        // A draft discarded: held to the Drafts folder (d).
        "discard" => json!({ "op": "delete", "tcon": "d" }),
        _ => return None,
    })
}

// A folder's id as the routes take it: digits only, 9 at most.
pub(crate) fn is_folder_id(id: &str) -> bool {
    (1..=9).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit())
}

// `String(body.folder ?? '')`.
fn folder_of(body: &Value) -> String {
    match body.get("folder") {
        None | Some(Value::Null) => String::new(),
        Some(folder) => js_string(folder),
    }
}

impl Gateway {
    pub(super) async fn mail_action(&self, call: &Call<'_, '_>, body: &Value) -> Result<http::Response<MailBody>, MailError> {
        let ids: Vec<String> = body.get("ids").and_then(Value::as_array).map(|ids| ids.iter().map(js_string).collect()).unwrap_or_default();
        if ids.is_empty() || ids.len() > MAX_IDS || !ids.iter().all(|id| is_valid_message_id(id)) {
            return Ok(error(400, "Invalid message ids."));
        }
        let asked = body.get("action").and_then(Value::as_str).unwrap_or_default();
        let Some(mut action) = message_action(asked) else { return Ok(error(400, "Invalid action.")) };
        let moving = asked == "move";
        let folder = folder_of(body);
        if moving && !is_folder_id(&folder) {
            return Ok(error(400, "Invalid folder."));
        }
        if moving && !self.own_folder(call, &folder).await? {
            return Ok(error(400, "Invalid folder."));
        }
        if moving {
            action["l"] = Value::String(folder);
        }
        action["id"] = Value::String(ids.join(","));
        let request = &json!({ "action": action });
        self.with_webmail(call, |context| async move { Ok(context.webmail.soap("MsgActionRequest", "urn:zimbraMail", request.clone(), super::SOAP_TIMEOUT).await?) }).await?;
        call.mail.forget_inbox();
        Ok(reply(200, &json!({ "ok": true })))
    }

    pub(super) async fn mail_folder_action(&self, call: &Call<'_, '_>, body: &Value) -> Result<http::Response<MailBody>, MailError> {
        let action = match body.get("action").and_then(Value::as_str) {
            Some(action @ ("read" | "empty")) => action,
            _ => return Ok(error(400, "Invalid action.")),
        };
        let folder = folder_of(body);
        // The root (1) and lower ids are no mail folders; emptying is held to
        // the trash (3) and the junk folder (4).
        let number: u64 = folder.parse().unwrap_or(0);
        if !is_folder_id(&folder) || number < 2 || (action == "empty" && !matches!(folder.as_str(), "3" | "4")) {
            return Ok(error(400, "Invalid folder."));
        }
        if !self.own_folder(call, &folder).await? {
            return Ok(error(400, "Invalid folder."));
        }
        // Emptying the trash takes the folders deleted into it along; the
        // junk folder keeps any sub-folder a filter made there.
        let request = if action == "empty" {
            json!({ "action": { "op": "empty", "id": folder, "recursive": folder == "3" } })
        } else {
            json!({ "action": { "op": "read", "id": folder } })
        };
        let request = &request;
        self.with_webmail(call, |context| async move { Ok(context.webmail.soap("FolderActionRequest", "urn:zimbraMail", request.clone(), super::SOAP_TIMEOUT).await?) }).await?;
        call.mail.forget_inbox();
        Ok(reply(200, &json!({ "ok": true })))
    }

    // Whether a folder is one of the account's own: among the kept ones, or
    // among them read again once.
    async fn own_folder(&self, call: &Call<'_, '_>, folder: &str) -> Result<bool, MailError> {
        if is_listed_folder(&self.with_webmail(call, |context| async move { self.mail_folder_list(&context, false).await }).await?, folder) {
            return Ok(true);
        }
        Ok(is_listed_folder(&self.with_webmail(call, |context| async move { self.mail_folder_list(&context, true).await }).await?, folder))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_action_is_one_of_the_tables_own() {
        assert_eq!(message_action("delete"), Some(json!({ "op": "delete", "tcon": "tj" })));
        assert_eq!(message_action("discard"), Some(json!({ "op": "delete", "tcon": "d" })));
        for other in ["__proto__", "constructor", "toString", "hasOwnProperty", "Read", ""] {
            assert_eq!(message_action(other), None, "{other}");
        }
    }

    #[test]
    fn a_folder_is_digits_only() {
        assert!(is_folder_id("2") && is_folder_id("123456789"));
        for other in ["", "1234567890", "-1", "2a", "٣", "２", " 2"] {
            assert!(!is_folder_id(other), "{other}");
        }
        assert_eq!(folder_of(&json!({ "folder": 257 })), "257");
        assert_eq!(folder_of(&json!({ "folder": null })), "");
        assert_eq!(folder_of(&json!({})), "");
        assert_eq!(folder_of(&json!({ "folder": [2] })), "2");
    }
}
