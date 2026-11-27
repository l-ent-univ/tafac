// What the page is told when a send or a draft is refused: by the server
// itself (a malformed body, an upload not the session's), or by Zimbra for
// a reason the page can act on (addresses refused, uploads gone, the quota,
// the size). Any other failure is the mail routes' generic answer (500
// `mail_unavailable`), never one of these.
//
// The addresses and ids sent back are only ever ones the page sent:
// nothing else of a fault (its arguments are never logged either).

use serde_json::{json, Map, Value};
use tonapi_providers::mail::text::is_js_space;

// A refusal of a send or a draft: its status and `{ error: code, …extra }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ComposeRefusal {
    pub status: u16,
    pub code: &'static str,
    // The addresses refused (`mail_send_invalid_recipients`,
    // `mail_send_partial`).
    pub invalid: Option<Vec<String>>,
    // The uploads to send again (`mail_send_upload_expired`).
    pub aids: Option<Vec<String>>,
    // The account's limit (`mail_send_too_large` from the server's check).
    pub max_bytes: Option<u64>,
}

impl ComposeRefusal {
    pub(crate) fn new(status: u16, code: &'static str) -> Self {
        Self { status, code, invalid: None, aids: None, max_bytes: None }
    }

    // `{ error: code, invalid?, aids?, maxBytes? }`.
    pub(crate) fn body(&self) -> Value {
        let mut body = Map::new();
        body.insert("error".into(), Value::from(self.code));
        if let Some(invalid) = &self.invalid {
            body.insert("invalid".into(), json!(invalid));
        }
        if let Some(aids) = &self.aids {
            body.insert("aids".into(), json!(aids));
        }
        if let Some(max_bytes) = self.max_bytes {
            body.insert("maxBytes".into(), json!(max_bytes));
        }
        Value::Object(body)
    }
}

// The fault Zimbra gave, by what the page sent (mapZimbraSendFault):
// `code` its fault code (`mail.NO_SUCH_UPLOAD`…), `arguments` its `<a n=…>`
// arguments as (name, content); `recipients` the addresses the page sent,
// `aids` its uploads. None for a fault the page can't act on.
pub(crate) fn map_send_fault(code: Option<&str>, arguments: &[(&str, &str)], recipients: &[String], aids: &[String]) -> Option<ComposeRefusal> {
    let code = code.unwrap_or_default();
    // The arguments of those names, each cut at commas and spaces.
    let values = |names: &[&str]| -> Vec<String> {
        arguments
            .iter()
            .filter(|(name, _)| names.contains(name))
            .flat_map(|(_, content)| content.split(|c: char| c == ',' || is_js_space(c)))
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()
    };
    if code == "mail.SEND_ABORTED_ADDRESS_FAILURE" || code == "mail.SEND_PARTIAL_ADDRESS_FAILURE" {
        let named: Vec<String> = values(&["invalid", "unsent"]).iter().map(|value| unbracket(value).to_lowercase()).collect();
        let invalid: Vec<String> = recipients.iter().filter(|email| named.contains(&email.to_lowercase())).cloned().collect();
        let (status, code) = if code == "mail.SEND_PARTIAL_ADDRESS_FAILURE" { (200, "mail_send_partial") } else { (422, "mail_send_invalid_recipients") };
        return Some(ComposeRefusal { invalid: Some(invalid), ..ComposeRefusal::new(status, code) });
    }
    if code == "mail.NO_SUCH_UPLOAD" {
        let named = values(&["id", "aid"]);
        let aids = aids.iter().filter(|aid| named.contains(aid)).cloned().collect();
        return Some(ComposeRefusal { aids: Some(aids), ..ComposeRefusal::new(409, "mail_send_upload_expired") });
    }
    if code.contains("QUOTA_EXCEEDED") {
        return Some(ComposeRefusal::new(413, "mail_send_quota"));
    }
    // UPLOAD_TOO_LARGE is a TOO_LARGE.
    if code.contains("MESSAGE_TOO_BIG") || code.contains("TOO_LARGE") {
        return Some(ComposeRefusal::new(413, "mail_send_too_large"));
    }
    if ["NO_SUCH_MSG", "NO_SUCH_ITEM", "NO_SUCH_PART"].iter().any(|name| code.contains(name)) {
        return Some(ComposeRefusal::new(409, "mail_send_missing_reference"));
    }
    None
}

// `/^<|>$/g`: one « < » before, one « > » after.
fn unbracket(value: &str) -> &str {
    let value = value.strip_prefix('<').unwrap_or(value);
    value.strip_suffix('>').unwrap_or(value)
}

// A send that went to some addresses only: sent all the same, the page
// told which ones were refused.
pub(crate) fn is_partial_send(code: Option<&str>) -> bool {
    code == Some("mail.SEND_PARTIAL_ADDRESS_FAILURE")
}

// The one fault a send is tried again for (submitZimbraSend): the draft it
// replaces gone meanwhile (sent or deleted in the webmail), once, without
// `did`, with the same `suid`. Never for anything else.
pub(crate) fn retry_without_draft(code: Option<&str>, with_draft: bool) -> bool {
    with_draft && code.is_some_and(|code| code.contains("NO_SUCH_MSG") || code.contains("NO_SUCH_ITEM"))
}

// The answer to a partial send: `{ ok: true, partial: true, invalid }`.
pub(crate) fn partial_body(refusal: Option<&ComposeRefusal>) -> Value {
    let invalid = refusal.and_then(|refusal| refusal.invalid.clone()).unwrap_or_default();
    json!({ "ok": true, "partial": true, "invalid": invalid })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn zimbras_faults_the_page_is_told_about() {
        let aborted = map_send_fault(
            Some("mail.SEND_ABORTED_ADDRESS_FAILURE"),
            &[("invalid", "Bad@Univ.fr"), ("unsent", "other@x.fr"), ("invalid", "not-ours@evil.fr")],
            &strings(&["bad@univ.fr", "ok@univ.fr", "other@x.fr"]),
            &[],
        )
        .unwrap();
        assert_eq!((aborted.status, aborted.code, aborted.invalid.clone()), (422, "mail_send_invalid_recipients", Some(strings(&["bad@univ.fr", "other@x.fr"]))));
        assert_eq!(aborted.body(), json!({ "error": "mail_send_invalid_recipients", "invalid": ["bad@univ.fr", "other@x.fr"] }));

        let partial = map_send_fault(Some("mail.SEND_PARTIAL_ADDRESS_FAILURE"), &[("invalid", "<bad@univ.fr>, x@y.fr")], &strings(&["bad@univ.fr"]), &[]).unwrap();
        assert_eq!((partial.status, partial.code, partial.invalid.clone()), (200, "mail_send_partial", Some(strings(&["bad@univ.fr"]))));
        assert_eq!(partial_body(Some(&partial)), json!({ "ok": true, "partial": true, "invalid": ["bad@univ.fr"] }));
        assert_eq!(partial_body(None), json!({ "ok": true, "partial": true, "invalid": [] }));

        let upload = map_send_fault(Some("mail.NO_SUCH_UPLOAD"), &[("id", "aid-1")], &[], &strings(&["aid-1", "aid-2"])).unwrap();
        assert_eq!(upload.body(), json!({ "error": "mail_send_upload_expired", "aids": ["aid-1"] }));
        assert_eq!(upload.status, 409);
        // An id the page didn't send isn't echoed.
        let other = map_send_fault(Some("mail.NO_SUCH_UPLOAD"), &[("aid", "someone-elses")], &[], &strings(&["aid-1"])).unwrap();
        assert_eq!(other.aids, Some(Vec::new()));

        let simple = |code: &str| map_send_fault(Some(code), &[], &[], &[]).map(|refusal| (refusal.status, refusal.code));
        assert_eq!(simple("mail.QUOTA_EXCEEDED"), Some((413, "mail_send_quota")));
        assert_eq!(simple("mail.MESSAGE_TOO_BIG"), Some((413, "mail_send_too_large")));
        assert_eq!(simple("mail.UPLOAD_TOO_LARGE"), Some((413, "mail_send_too_large")));
        assert_eq!(simple("mail.NO_SUCH_MSG"), Some((409, "mail_send_missing_reference")));
        assert_eq!(simple("mail.NO_SUCH_PART"), Some((409, "mail_send_missing_reference")));
        assert_eq!(simple("service.FAILURE"), None);
        assert_eq!(map_send_fault(None, &[], &[], &[]), None);
    }

    #[test]
    fn a_send_is_retried_only_when_its_draft_is_gone() {
        assert!(retry_without_draft(Some("mail.NO_SUCH_MSG"), true));
        assert!(retry_without_draft(Some("mail.NO_SUCH_ITEM"), true));
        assert!(!retry_without_draft(Some("mail.NO_SUCH_MSG"), false));
        assert!(!retry_without_draft(Some("mail.NO_SUCH_PART"), true));
        assert!(!retry_without_draft(Some("service.FAILURE"), true));
        assert!(!retry_without_draft(None, true));
        assert!(is_partial_send(Some("mail.SEND_PARTIAL_ADDRESS_FAILURE")));
        assert!(!is_partial_send(Some("mail.SEND_ABORTED_ADDRESS_FAILURE")));
    }

    #[test]
    fn a_refusal_says_its_code_and_what_goes_with_it() {
        let refusal = ComposeRefusal { max_bytes: Some(1024), ..ComposeRefusal::new(413, "mail_send_too_large") };
        assert_eq!(refusal.body(), json!({ "error": "mail_send_too_large", "maxBytes": 1024 }));
        assert_eq!(ComposeRefusal::new(400, "mail_send_invalid").body(), json!({ "error": "mail_send_invalid" }));
    }
}
