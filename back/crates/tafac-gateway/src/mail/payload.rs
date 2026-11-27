// A send's or a draft's body (POST /__ent_auth/mail/send and /mail/draft),
// checked as Node checks it (normalizeComposePayload, server/mailSend.js),
// the same refusals in the same order, from the JSON as it came: never a
// serde struct, which would take the number 257 for the id "257", mistake
// a list for an object, or fail on a field of an unexpected type that Node
// simply ignores.
//
// Nothing the page sends is taken as it is: the recipients are checked
// again with the composer's own rules (tonAPI's mail::address), the subject
// loses its line breaks, the attachments are references of known shapes,
// the signature is two short choices. Never a From address (an identity id,
// checked later against the account's own list), never a signature's HTML:
// `from` and `signature.html` are not read.
//
// The editor's HTML is only checked for its type and length here: it goes
// out as `raw_html`, to go through the composer's sanitizer
// (sanitizeComposerHtml) and selectInlineImages before anything uses it,
// as Node does inside normalizeComposePayload.

use serde_json::{Map, Value};
use tonapi_providers::mail::address::{is_valid_address, normalize_email, sanitize_display_name, MAX_DISPLAY_NAME_LENGTH, MAX_RECIPIENTS};
use tonapi_providers::mail::attachments::MAX_ATTACHMENTS;
use tonapi_providers::mail::text::{cap_chars, collapse_spaces, cut_utf16, is_js_space, nfc, replace_controls, sanitize_subject, trim_js, utf16_len};

use super::faults::ComposeRefusal;

// The editor's HTML, a long thread quoted under a reply included, in UTF-16
// units (the route's JSON body is capped above this).
pub(crate) const MAX_COMPOSER_HTML_LENGTH: usize = 1_500_000;
pub(crate) const MAX_SIGNATURE_GROUP_LENGTH: usize = 80;
// The images inside the text: a few per mail, MAX_INLINE_IMAGE_WIDTH wide
// at most (a mail's usual column).
pub(crate) const MAX_INLINE_IMAGES: usize = 3;
pub(crate) const MAX_INLINE_IMAGE_WIDTH: u32 = 560;
// The types an image of the text may be (INLINE_IMAGE_TYPES).
pub(crate) const INLINE_IMAGE_TYPES: [&str; 3] = ["image/png", "image/jpeg", "image/gif"];
const MAX_PART_ID_LENGTH: usize = 40;

const INVALID: &str = "mail_send_invalid";

// ── The ids a session may name ──────────────────────────────────────────────

// A message's id (isValidMailMessageId): a string `^-?[0-9]{1,10}$`, ASCII
// digits only (`١٢٣` is not one), never a number, never a `zid:`.
pub(crate) fn is_message_id(value: &Value) -> bool {
    value.as_str().is_some_and(|id| {
        let digits = id.strip_prefix('-').unwrap_or(id);
        (1..=10).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

// A message's id that names a mail of the mailbox itself: not negative.
fn is_own_message_id(value: &Value) -> bool {
    is_message_id(value) && value.as_str().is_some_and(|id| !id.starts_with('-'))
}

// An upload's id, as Partage gives it (isValidZimbraUploadId):
// `^[A-Za-z0-9:._-]{8,200}$`. No comma: a send joins them with commas.
pub(crate) fn is_upload_id(value: &Value) -> bool {
    value.as_str().is_some_and(|aid| (8..=200).contains(&aid.len()) && aid.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-')))
}

// A part's id: `^[0-9]+(\.[0-9]+)*$`.
pub(crate) fn is_part_id(part: &str) -> bool {
    part.split('.').all(|piece| !piece.is_empty() && piece.bytes().all(|byte| byte.is_ascii_digit()))
}

// `^[A-Za-z0-9:._-]{1,64}$`.
fn is_identity_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
}

// `^[A-Za-z0-9-]{8,64}$`.
fn is_send_uid(uid: &str) -> bool {
    (8..=64).contains(&uid.len()) && uid.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

// `^[a-z0-9-]{1,40}$`.
fn is_establishment_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

// INLINE_CID_PATTERN: `^tafac-img-[0-9a-f-]{8,64}@tafac\.fr$`.
pub(crate) fn is_inline_cid(cid: &str) -> bool {
    cid.strip_prefix("tafac-img-")
        .and_then(|rest| rest.strip_suffix("@tafac.fr"))
        .is_some_and(|middle| (8..=64).contains(&middle.len()) && middle.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f' | b'-')))
}

// ── What comes out ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Recipient {
    // sanitizeDisplayName's: empty when there is none to show.
    pub name: String,
    pub email: String,
}

// A file as a send names it: an upload of the session's, or a part of a
// mail of its mailbox (a forwarded mail's, a draft's).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PartReference {
    Upload { aid: String },
    Message { message_id: String, part: String },
}

impl PartReference {
    // Its key, to name each file once (referenceKey).
    pub(crate) fn key(&self) -> String {
        match self {
            Self::Upload { aid } => aid.clone(),
            Self::Message { message_id, part } => format!("{message_id}/{part}"),
        }
    }

    pub(crate) fn aid(&self) -> Option<&str> {
        match self {
            Self::Upload { aid } => Some(aid),
            Self::Message { .. } => None,
        }
    }
}

// An image of the text, as the payload lists it: its cid, its file, the
// size it shows at (MAX_INLINE_IMAGE_WIDTH wide at most, its height in
// proportion).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InlineImage {
    pub cid: String,
    pub file: PartReference,
    pub width: u32,
    pub height: u32,
}

// The mail a send answers or forwards. Its Message-ID (In-Reply-To) is read
// by the server, never taken from the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OriginKind {
    Reply,
    ReplyAll,
    Forward,
}

impl OriginKind {
    // An own key of ORIGIN_KINDS, and only that: never `__proto__` nor
    // `constructor`.
    fn read(kind: &str) -> Option<Self> {
        match kind {
            "reply" => Some(Self::Reply),
            "replyAll" => Some(Self::ReplyAll),
            "forward" => Some(Self::Forward),
            _ => None,
        }
    }

    #[allow(dead_code)] // what the page wrote, for the tests
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Reply => "reply",
            Self::ReplyAll => "replyAll",
            Self::Forward => "forward",
        }
    }

    // Zimbra's reply type: `r` replied, `w` forwarded.
    pub(crate) fn reply_type(self) -> &'static str {
        match self {
            Self::Reply | Self::ReplyAll => "r",
            Self::Forward => "w",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Origin {
    pub kind: OriginKind,
    pub message_id: String,
}

// Which signature (src/mailSignatureChoice.js): built by the server from
// the account and the university's settings, the one set in the webmail,
// or the student's own text kept there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignatureMode {
    Auto,
    Partage,
    Custom,
}

impl SignatureMode {
    #[allow(dead_code)] // what the page wrote, for the tests
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Partage => "partage",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignatureChoice {
    pub include: bool,
    pub mode: SignatureMode,
    // The automatic signature's group label, cleaned (empty for the other
    // modes), escaped where it is used.
    pub group: String,
    // An establishment's id of the right shape, for the automatic one only;
    // whether the university has it is the signature's to say
    // (signature_block::resolve_signature).
    pub establishment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ComposePayload {
    pub to: Vec<Recipient>,
    pub cc: Vec<Recipient>,
    pub bcc: Vec<Recipient>,
    pub subject: String,
    // The editor's HTML as the page sent it, at most
    // MAX_COMPOSER_HTML_LENGTH units. Not cleaned: the composer's sanitizer
    // runs on it, then selectInlineImages with `listed_images`.
    pub raw_html: String,
    pub attachments: Vec<PartReference>,
    // The images the payload lists, none of them attached as well; the ones
    // the text shows are selectInlineImages's to keep.
    pub listed_images: Vec<InlineImage>,
    pub origin: Option<Origin>,
    pub identity_id: Option<String>,
    // A send's draft to delete (`did`), a save's draft to replace (`id`).
    pub draft_id: Option<String>,
    // A send's uid (`suid`, and the key of a send asked twice); none for a
    // draft.
    pub send_uid: Option<String>,
    pub signature: SignatureChoice,
}

impl ComposePayload {
    // Every recipient's address, To then Cc then Bcc: what the send limiter
    // counts, and the only addresses a fault may echo.
    pub(crate) fn recipients(&self) -> Vec<String> {
        self.to.iter().chain(&self.cc).chain(&self.bcc).map(|recipient| recipient.email.clone()).collect()
    }

    // The uploads the mail names, the files' then the images'
    // (payloadUploadAids).
    pub(crate) fn upload_aids(&self) -> Vec<String> {
        self.attachments.iter().chain(self.listed_images.iter().map(|image| &image.file)).filter_map(PartReference::aid).map(str::to_string).collect()
    }
}

// ── Reading it ──────────────────────────────────────────────────────────────

// A field of an object, as `object.name` reads it in JavaScript for the
// names read here (none of them is a property every object has).
fn field<'a>(value: &'a Value, name: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(name))
}

// `x === undefined || x === null`.
fn absent(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null))
}

fn refused(code: &'static str) -> ComposeRefusal {
    // readComposePayload's statuses.
    let status = match code {
        INVALID => 400,
        "mail_send_too_large" => 413,
        _ => 422,
    };
    ComposeRefusal::new(status, code)
}

struct Written {
    name: String,
    email: String,
}

// readRecipientList: nothing is none; else a list of at most 200 entries,
// each name cut to 512 units and each address to 1024 (an entry of another
// shape is an empty one). None when malformed.
fn read_recipient_list(value: Option<&Value>) -> Option<Vec<Written>> {
    if absent(value) {
        return Some(Vec::new());
    }
    let list = value?.as_array().filter(|list| list.len() <= MAX_RECIPIENTS * 2)?;
    let text = |entry: &Value, name: &str, max: usize| field(entry, name).and_then(Value::as_str).map(|text| cut_utf16(text, max).to_string()).unwrap_or_default();
    Some(list.iter().map(|entry| Written { name: text(entry, "name", MAX_DISPLAY_NAME_LENGTH * 4), email: text(entry, "email", 1024) }).collect())
}

// readPartReference: `{ source: 'upload', aid }` or `{ source: 'message',
// messageId, part }`, else None.
fn read_part_reference(entry: &Value) -> Option<PartReference> {
    match field(entry, "source").and_then(Value::as_str) {
        Some("upload") => {
            let aid = field(entry, "aid").filter(|aid| is_upload_id(aid))?;
            Some(PartReference::Upload { aid: aid.as_str()?.to_string() })
        }
        Some("message") => {
            let message_id = field(entry, "messageId").filter(|id| is_own_message_id(id))?;
            let part = field(entry, "part").and_then(Value::as_str).filter(|part| utf16_len(part) <= MAX_PART_ID_LENGTH && is_part_id(part))?;
            Some(PartReference::Message { message_id: message_id.as_str()?.to_string(), part: part.to_string() })
        }
        _ => None,
    }
}

// readInlineImages: nothing is none; else at most MAX_INLINE_IMAGES, each a
// cid of the composer's kind, a file reference and a size of whole pixels,
// 1 to 4000, no cid or file twice. None when malformed.
fn read_inline_images(value: Option<&Value>) -> Option<Vec<InlineImage>> {
    if absent(value) {
        return Some(Vec::new());
    }
    let list = value?.as_array().filter(|list| list.len() <= MAX_INLINE_IMAGES)?;
    let mut images: Vec<InlineImage> = Vec::new();
    for entry in list {
        let cid = field(entry, "cid").and_then(Value::as_str).map(str::to_lowercase).unwrap_or_default();
        let file = read_part_reference(entry);
        let (width, height) = (js_number(field(entry, "width")), js_number(field(entry, "height")));
        let in_range = |size: f64| size.fract() == 0.0 && (1.0..=4000.0).contains(&size);
        let file = file.filter(|_| is_inline_cid(&cid) && in_range(width) && in_range(height))?;
        if images.iter().any(|image| image.cid == cid || image.file.key() == file.key()) {
            return None;
        }
        let scale = (f64::from(MAX_INLINE_IMAGE_WIDTH) / width).min(1.0);
        images.push(InlineImage { cid, file, width: js_round(width * scale), height: js_round(height * scale).max(1) });
    }
    Some(images)
}

// Math.round, for the sizes here (positive, at most 4000).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn js_round(value: f64) -> u32 {
    let floor = value.floor();
    let rounded = if value - floor >= 0.5 { floor + 1.0 } else { floor };
    rounded.clamp(0.0, f64::from(u32::MAX)) as u32
}

// `Number(value)`: what JavaScript makes of a JSON value as a number. A
// size may come as 560, "560", " 560 ", [560] or "0x230" and be taken; an
// object, a word, two numbers aren't one (NaN).
fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => string_to_number(text),
        Some(list @ Value::Array(_)) => string_to_number(&js_string(list)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

// A value's `String()` inside a list's `join(',')`.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.as_f64().map(|number| number.to_string()).unwrap_or_default(),
        Value::String(text) => text.clone(),
        Value::Array(list) => list.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

// StringToNumber: spaces around, then nothing (0), a hexadecimal, octal or
// binary integer, or a decimal one with its sign, point and exponent, or
// Infinity.
fn string_to_number(text: &str) -> f64 {
    let text = text.trim_matches(is_js_space);
    if text.is_empty() {
        return 0.0;
    }
    let radix = match text.get(..2) {
        Some("0x" | "0X") => Some(16),
        Some("0o" | "0O") => Some(8),
        Some("0b" | "0B") => Some(2),
        _ => None,
    };
    if let Some(radix) = radix {
        let digits = &text[2..];
        if digits.is_empty() {
            return f64::NAN;
        }
        return digits.chars().try_fold(0.0, |total, c| c.to_digit(radix).map(|digit| total * f64::from(radix) + f64::from(digit))).unwrap_or(f64::NAN);
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if unsigned == "Infinity" {
        return if text.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mantissa_ok = digits(whole) && digits(fraction) && !(whole.is_empty() && fraction.is_empty());
    let exponent_ok = exponent.is_none_or(|exponent| {
        let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
        !exponent.is_empty() && digits(exponent)
    });
    if !mantissa_ok || !exponent_ok {
        return f64::NAN;
    }
    text.parse().unwrap_or(f64::NAN)
}

// The page's body for a send (`draft` false) or a draft: Node's checks, in
// Node's order. A draft takes what a send would refuse (no recipient, an
// address not yet right: left out of the saved draft) and has no send uid.
pub(crate) fn normalize_compose_payload(body: &Value, draft: bool) -> Result<ComposePayload, ComposeRefusal> {
    if !body.is_object() {
        return Err(refused(INVALID));
    }
    let lists = [read_recipient_list(field(body, "to")), read_recipient_list(field(body, "cc")), read_recipient_list(field(body, "bcc"))];
    let [Some(to), Some(cc), Some(bcc)] = lists else { return Err(refused(INVALID)) };

    // Each address once across the three fields (the first field it's in),
    // MAX_RECIPIENTS in all.
    let mut seen: Vec<String> = Vec::new();
    let mut invalid: Vec<String> = Vec::new();
    let mut recipients: [Vec<Recipient>; 3] = Default::default();
    let mut count = 0;
    for (index, written) in [to, cc, bcc].into_iter().enumerate() {
        for entry in written {
            let email = nfc(trim_js(&entry.email));
            if !is_valid_address(&email) {
                if !email.is_empty() {
                    invalid.push(cap_chars(&replace_controls(&email, None), 254).to_string());
                }
                continue;
            }
            let key = normalize_email(&email);
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            count += 1;
            if count > MAX_RECIPIENTS {
                // Node's `break` leaves this field only: the next one's first
                // new address stops there too.
                if draft {
                    break;
                }
                return Err(refused("mail_send_too_many_recipients"));
            }
            recipients[index].push(Recipient { name: sanitize_display_name(&entry.name, &email), email });
        }
    }
    if !draft && !invalid.is_empty() {
        invalid.truncate(MAX_RECIPIENTS);
        return Err(ComposeRefusal { invalid: Some(invalid), ..refused("mail_send_invalid_recipients") });
    }
    if !draft && count == 0 {
        return Err(refused("mail_send_no_recipient"));
    }

    let raw_html = match field(body, "html") {
        None => String::new(),
        Some(Value::String(html)) => html.clone(),
        // null included: `typeof null` is « object ».
        Some(_) => return Err(refused(INVALID)),
    };
    if utf16_len(&raw_html) > MAX_COMPOSER_HTML_LENGTH {
        return Err(refused("mail_send_too_large"));
    }

    // Attachments: references only, of the session's kinds, each once.
    let empty = Vec::new();
    let raw_attachments = match field(body, "attachments") {
        None | Some(Value::Null) => &empty,
        Some(Value::Array(list)) if list.len() <= MAX_ATTACHMENTS => list,
        Some(_) => return Err(refused(INVALID)),
    };
    let mut attachments: Vec<PartReference> = Vec::new();
    for entry in raw_attachments {
        let reference = read_part_reference(entry).ok_or_else(|| refused(INVALID))?;
        if !attachments.iter().any(|known| known.key() == reference.key()) {
            attachments.push(reference);
        }
    }

    // The text's images, none of them a file attached as well.
    let listed_images = read_inline_images(field(body, "inlineImages")).ok_or_else(|| refused(INVALID))?;
    if listed_images.iter().any(|image| attachments.iter().any(|file| file.key() == image.file.key())) {
        return Err(refused(INVALID));
    }

    let origin = match field(body, "origin") {
        None | Some(Value::Null) => None,
        Some(origin) => {
            let kind = field(origin, "kind").and_then(Value::as_str).and_then(OriginKind::read);
            let message_id = field(origin, "messageId").filter(|id| is_own_message_id(id)).and_then(Value::as_str);
            let (Some(kind), Some(message_id)) = (kind, message_id) else { return Err(refused(INVALID)) };
            Some(Origin { kind, message_id: message_id.to_string() })
        }
    };

    let identity_id = match field(body, "identityId") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) if is_identity_id(id) => Some(id.clone()),
        Some(_) => return Err(refused(INVALID)),
    };

    let draft_id = match field(body, "draftId") {
        None | Some(Value::Null) => None,
        Some(id) if is_own_message_id(id) => id.as_str().map(str::to_string),
        Some(_) => return Err(refused(INVALID)),
    };

    let send_uid = if draft {
        None
    } else {
        match field(body, "sendUid") {
            Some(Value::String(uid)) if is_send_uid(uid) => Some(uid.clone()),
            _ => return Err(refused(INVALID)),
        }
    };

    let signature = read_signature_choice(field(body, "signature")).ok_or_else(|| refused(INVALID))?;

    let subject = sanitize_subject(field(body, "subject").and_then(Value::as_str).unwrap_or_default());
    let [to, cc, bcc] = recipients;
    Ok(ComposePayload { to, cc, bcc, subject, raw_html, attachments, listed_images, origin, identity_id, draft_id, send_uid, signature })
}

// The signature's choices: an object (nothing is the automatic one), its
// mode exactly one of the three, `include` exactly true; for the automatic
// one, its group label cleaned and an establishment's id of the right
// shape. Its `html`, if any, is never read.
fn read_signature_choice(value: Option<&Value>) -> Option<SignatureChoice> {
    let empty = Value::Object(Map::new());
    let signature = match value {
        None | Some(Value::Null) => &empty,
        Some(object @ Value::Object(_)) => object,
        Some(_) => return None,
    };
    let mode = match field(signature, "mode") {
        None | Some(Value::Null) => SignatureMode::Auto,
        Some(Value::String(mode)) => match mode.as_str() {
            "auto" => SignatureMode::Auto,
            "partage" => SignatureMode::Partage,
            "custom" => SignatureMode::Custom,
            _ => return None,
        },
        Some(_) => return None,
    };
    let auto = mode == SignatureMode::Auto;
    let group = match field(signature, "group").and_then(Value::as_str) {
        Some(group) if auto => {
            let cleaned = collapse_spaces(&replace_controls(&nfc(cut_utf16(group, 1000)), Some(' ')));
            trim_js(cap_chars(trim_js(&cleaned), MAX_SIGNATURE_GROUP_LENGTH)).to_string()
        }
        _ => String::new(),
    };
    let establishment = field(signature, "establishment").and_then(Value::as_str).filter(|id| auto && is_establishment_id(id)).map(str::to_string);
    Some(SignatureChoice { include: field(signature, "include") == Some(&Value::Bool(true)), mode, group, establishment })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const AID: &str = "4f6e1c2a-0b7d-4c8e-9a51-2f3e4d5c6b7a:9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    const IMAGE_CID: &str = "tafac-img-0123abcd-4567-89ab@tafac.fr";
    const OTHER_CID: &str = "tafac-img-fedcba98-7654-3210@tafac.fr";
    const OTHER_AID: &str = "aid-0002-upload";

    fn base() -> Value {
        json!({ "to": [{ "name": "Camille", "email": "camille@univ.fr" }], "subject": "Objet", "html": "<p>x</p>", "sendUid": "b2a6c1f0-8f4e-4d2a-9a51-2f3e4d5c6b7a" })
    }

    // The base body with these fields set (or removed, as null for a key
    // given as `"-key"`).
    fn with(fields: Value) -> Value {
        let mut body = base();
        for (key, value) in fields.as_object().unwrap() {
            match key.strip_prefix('-') {
                Some(key) => {
                    body.as_object_mut().unwrap().remove(key);
                }
                None => {
                    body[key] = value.clone();
                }
            }
        }
        body
    }

    fn send(body: &Value) -> Result<ComposePayload, ComposeRefusal> {
        normalize_compose_payload(body, false)
    }

    fn code(body: Value) -> &'static str {
        send(&body).unwrap_err().code
    }

    fn recipient(name: &str, email: &str) -> Recipient {
        Recipient { name: name.into(), email: email.into() }
    }

    #[test]
    fn the_pages_request_checked_again() {
        let payload = send(&with(json!({
            "cc": [{ "name": "Boss <boss@univ.fr>", "email": "CAMILLE@univ.fr" }, { "name": "Léo", "email": "leo@univ.fr" }],
            "bcc": [{ "email": "leo@univ.fr" }],
            "subject": "Ligne\r\nBcc: evil@x.fr\u{202e}",
            "attachments": [{ "source": "upload", "aid": AID }, { "source": "message", "messageId": "257", "part": "2.1" }, { "source": "upload", "aid": AID }],
            "origin": { "kind": "replyAll", "messageId": "257" },
            "identityId": "a1b2c3d4-e5f6",
            "draftId": "300",
            "signature": { "include": true, "group": " MMI\n2 ", "establishment": "iutlan", "html": "<img src=x>" },
            "from": "boss@univ.fr",
        })))
        .unwrap();
        assert_eq!(payload.to, [recipient("Camille", "camille@univ.fr")]);
        // Each address once (any case), a name holding an @ dropped.
        assert_eq!(payload.cc, [recipient("Léo", "leo@univ.fr")]);
        assert_eq!(payload.bcc, []);
        assert_eq!(payload.subject, "Ligne Bcc: evil@x.fr");
        assert_eq!(payload.attachments, [PartReference::Upload { aid: AID.into() }, PartReference::Message { message_id: "257".into(), part: "2.1".into() }]);
        assert_eq!(payload.origin, Some(Origin { kind: OriginKind::ReplyAll, message_id: "257".into() }));
        assert_eq!(payload.origin.as_ref().unwrap().kind.reply_type(), "r");
        assert_eq!(payload.identity_id.as_deref(), Some("a1b2c3d4-e5f6"));
        assert_eq!(payload.draft_id.as_deref(), Some("300"));
        assert_eq!(payload.signature, SignatureChoice { include: true, mode: SignatureMode::Auto, group: "MMI 2".into(), establishment: Some("iutlan".into()) });
        assert_eq!(payload.recipients(), ["camille@univ.fr", "leo@univ.fr"]);
        assert_eq!(payload.upload_aids(), [AID]);
    }

    #[test]
    fn what_a_send_refuses() {
        let refusal = send(&with(json!({ "to": [{ "email": "pas une adresse" }, { "email": "a@b.fr\r\nBcc: x@y.fr" }] }))).unwrap_err();
        assert_eq!((refusal.status, refusal.body()), (422, json!({ "error": "mail_send_invalid_recipients", "invalid": ["pas une adresse", "a@b.frBcc: x@y.fr"] })));
        assert_eq!(code(with(json!({ "to": [] }))), "mail_send_no_recipient");
        let many = |count: usize| Value::Array((0..count).map(|index| json!({ "email": format!("p{index}@univ.fr") })).collect());
        assert_eq!(code(with(json!({ "to": many(101) }))), "mail_send_too_many_recipients");
        assert_eq!(send(&with(json!({ "to": many(100) }))).unwrap().to.len(), 100);
        assert_eq!(code(with(json!({ "to": many(201) }))), INVALID);
        assert_eq!(code(with(json!({ "-sendUid": null }))), INVALID);
        assert_eq!(code(with(json!({ "sendUid": "<script>" }))), INVALID);
        assert_eq!(code(with(json!({ "sendUid": 12345678 }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "upload", "aid": "../../etc" }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "upload", "aid": "aid,with,commas" }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": "1", "part": "2&x=1" }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": "zid:1", "part": "2" }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": "-1", "part": "2" }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": "1", "part": "1.".to_string() + &"1".repeat(39) }] }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": (0..21).map(|_| json!({ "source": "upload", "aid": AID })).collect::<Vec<_>>() }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": { "source": "upload", "aid": AID } }))), INVALID);
        assert_eq!(code(with(json!({ "origin": { "kind": "reply", "messageId": "-12" } }))), INVALID);
        assert_eq!(code(with(json!({ "origin": { "kind": "spam", "messageId": "12" } }))), INVALID);
        assert_eq!(code(with(json!({ "origin": "reply" }))), INVALID);
        assert_eq!(code(with(json!({ "identityId": "id with spaces" }))), INVALID);
        assert_eq!(code(with(json!({ "identityId": 12 }))), INVALID);
        assert_eq!(code(with(json!({ "draftId": "-300" }))), INVALID);
        assert_eq!(code(with(json!({ "html": null }))), INVALID);
        assert_eq!(code(with(json!({ "html": ["<p>"] }))), INVALID);
        let too_large = send(&with(json!({ "html": "x".repeat(1_500_001) }))).unwrap_err();
        assert_eq!((too_large.status, too_large.code), (413, "mail_send_too_large"));
        // UTF-16 units, as `.length`: 750 001 emoji are 1 500 002.
        assert_eq!(code(with(json!({ "html": "😀".repeat(750_001) }))), "mail_send_too_large");
        assert!(send(&with(json!({ "html": "😀".repeat(750_000) }))).is_ok());
        for body in [json!([]), json!(null), json!("x"), json!(12)] {
            assert_eq!(send(&body).unwrap_err().body(), json!({ "error": INVALID }), "{body}");
        }
        assert_eq!(send(&json!([])).unwrap_err().status, 400);
        assert_eq!(code(with(json!({ "signature": "auto" }))), INVALID);
        assert_eq!(code(with(json!({ "signature": [] }))), INVALID);
        assert_eq!(code(with(json!({ "signature": { "mode": "html" } }))), INVALID);
        assert_eq!(code(with(json!({ "signature": { "mode": ["auto"] } }))), INVALID);
        assert_eq!(code(with(json!({ "to": "camille@univ.fr" }))), INVALID);
    }

    #[test]
    fn a_draft_keeps_out_what_a_send_would_refuse() {
        let draft = normalize_compose_payload(&json!({ "to": [{ "email": "à moitié@" }, { "email": "ok@univ.fr" }], "html": "<p>x</p>" }), true).unwrap();
        assert_eq!(draft.to, [recipient("", "ok@univ.fr")]);
        assert_eq!(draft.send_uid, None);
        assert!(normalize_compose_payload(&json!({}), true).is_ok());
        // Past MAX_RECIPIENTS, the rest are left out.
        let many: Vec<Value> = (0..150).map(|index| json!({ "email": format!("p{index}@univ.fr") })).collect();
        let draft = normalize_compose_payload(&json!({ "to": many[..90], "cc": many[90..], "bcc": [{ "email": "last@univ.fr" }] }), true).unwrap();
        assert_eq!((draft.to.len(), draft.cc.len(), draft.bcc.len()), (90, 10, 0));
        // A send uid in a draft is not read.
        assert_eq!(normalize_compose_payload(&json!({ "sendUid": "<script>" }), true).unwrap().send_uid, None);
    }

    #[test]
    fn from_and_the_signatures_html_are_never_read() {
        let payload = send(&with(json!({ "from": "boss@univ.fr", "From": { "email": "boss@univ.fr" }, "signature": { "include": true, "mode": "partage", "html": "<img src=x>", "group": "MMI", "establishment": "iutlan" } }))).unwrap();
        // Nothing of it in what comes out: the signature is two choices, and
        // only for the automatic one.
        assert_eq!(payload.signature, SignatureChoice { include: true, mode: SignatureMode::Partage, group: String::new(), establishment: None });
        assert_eq!(payload.recipients(), ["camille@univ.fr"]);
        // `include` is exactly true.
        for include in [json!("true"), json!(1), json!(null)] {
            assert!(!send(&with(json!({ "signature": { "include": include } }))).unwrap().signature.include);
        }
        // Nothing said is the automatic one, not included.
        assert_eq!(send(&base()).unwrap().signature, SignatureChoice { include: false, mode: SignatureMode::Auto, group: String::new(), establishment: None });
    }

    #[test]
    fn own_keys_only_never_proto_or_constructor() {
        for kind in ["__proto__", "constructor", "toString", "hasOwnProperty"] {
            assert_eq!(code(with(json!({ "origin": { "kind": kind, "messageId": "12" } }))), INVALID, "{kind}");
        }
        // An establishment's id of a shape the settings might have is kept
        // here; resolve_signature looks it up in the university's own table.
        let choice = |establishment: &str| send(&with(json!({ "signature": { "include": true, "establishment": establishment } }))).unwrap().signature.establishment;
        assert_eq!(choice("__proto__"), None);
        assert_eq!(choice("constructor").as_deref(), Some("constructor"));
        assert_eq!(choice("IUTLAN"), None);
        assert_eq!(choice(&"a".repeat(41)), None);
        // A JSON key « __proto__ » is a key like another (JSON.parse makes it
        // the object's own).
        let body: Value = serde_json::from_str(r#"{"__proto__":{"to":[{"email":"x@y.fr"}]},"to":[{"email":"camille@univ.fr"}],"sendUid":"uid-12345678"}"#).unwrap();
        assert_eq!(send(&body).unwrap().recipients(), ["camille@univ.fr"]);
    }

    #[test]
    fn ids_are_strings_of_ascii_digits() {
        // The number 257 isn't the id "257".
        assert_eq!(code(with(json!({ "origin": { "kind": "reply", "messageId": 257 } }))), INVALID);
        assert_eq!(code(with(json!({ "draftId": 300 }))), INVALID);
        assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": 257, "part": "2" }] }))), INVALID);
        // Arabic-Indic and full-width digits aren't digits here.
        for id in ["١٢٣", "１２３", "2５7"] {
            assert_eq!(code(with(json!({ "origin": { "kind": "reply", "messageId": id } }))), INVALID, "{id}");
            assert_eq!(code(with(json!({ "draftId": id }))), INVALID, "{id}");
            assert_eq!(code(with(json!({ "attachments": [{ "source": "message", "messageId": "257", "part": id }] }))), INVALID, "{id}");
        }
        assert_eq!(code(with(json!({ "draftId": "12345678901" }))), INVALID);
        assert_eq!(send(&with(json!({ "draftId": "1234567890" }))).unwrap().draft_id.as_deref(), Some("1234567890"));
        assert!(is_message_id(&json!("-5")));
        assert!(!is_message_id(&json!("-")));
        assert!(!is_message_id(&json!("")));
        assert!(!is_message_id(&json!(" 5")));
        // An upload's id: 8 to 200 of its characters.
        assert!(is_upload_id(&json!(AID)));
        assert!(!is_upload_id(&json!("short")));
        assert!(!is_upload_id(&json!("a".repeat(201))));
        assert!(!is_upload_id(&json!("ａｉｄ-0001-upload")));
    }

    #[test]
    fn a_full_width_at_sign_is_no_name() {
        let names = |name: &str| send(&with(json!({ "to": [{ "name": name, "email": "camille@univ.fr" }] }))).unwrap().to[0].name.clone();
        assert_eq!(names("Boss＠univ.fr"), "");
        assert_eq!(names("Boss﹫univ.fr"), "");
        assert_eq!(names("=?utf-8?b?Qm9zcw==?="), "");
        assert_eq!(names("camille@univ.fr"), "");
        assert_eq!(names(" Camille\u{202e}  Martin "), "Camille Martin");
        assert_eq!(names("Camille \"<Martin>\""), "Camille Martin");
    }

    fn image_mail(images: Value) -> Value {
        with(json!({ "to": [{ "email": "prof@univ.fr" }], "inlineImages": images }))
    }

    #[test]
    fn the_texts_images_only_those_listed_once_their_size_capped() {
        let payload = send(&image_mail(json!([{ "cid": IMAGE_CID.to_uppercase(), "source": "upload", "aid": AID, "width": 1040, "height": 600 }]))).unwrap();
        assert_eq!(payload.listed_images, [InlineImage { cid: IMAGE_CID.into(), file: PartReference::Upload { aid: AID.into() }, width: 560, height: 323 }]);
        assert_eq!(payload.upload_aids(), [AID]);
        // A draft's part, by reference.
        let part = send(&image_mail(json!([{ "cid": IMAGE_CID, "source": "message", "messageId": "400", "part": "2.2", "width": 520, "height": 300 }]))).unwrap();
        assert_eq!(part.listed_images, [InlineImage { cid: IMAGE_CID.into(), file: PartReference::Message { message_id: "400".into(), part: "2.2".into() }, width: 520, height: 300 }]);
        // A size as JavaScript's Number() reads it.
        let sized = |width: Value| send(&image_mail(json!([{ "cid": IMAGE_CID, "source": "upload", "aid": AID, "width": width, "height": 10 }]))).ok().map(|payload| payload.listed_images[0].width);
        assert_eq!(sized(json!("200")), Some(200));
        assert_eq!(sized(json!(" 200\n")), Some(200));
        assert_eq!(sized(json!([200])), Some(200));
        assert_eq!(sized(json!("0xc8")), Some(200));
        assert_eq!(sized(json!(200.0)), Some(200));
        assert_eq!(sized(json!("2e2")), Some(200));
        assert_eq!(sized(json!(true)), Some(1));
        for refused in [json!(200.5), json!("200px"), json!([200, 1]), json!({}), json!(null), json!(""), json!("Infinity"), json!("١٢"), json!(4001), json!(0), json!(-5)] {
            assert_eq!(sized(refused.clone()), None, "{refused}");
        }
        // A tiny height still shows.
        let flat = send(&image_mail(json!([{ "cid": IMAGE_CID, "source": "upload", "aid": AID, "width": 4000, "height": 1 }]))).unwrap();
        assert_eq!((flat.listed_images[0].width, flat.listed_images[0].height), (560, 1));

        let image = |cid: &str, aid: &str, width: u32, height: u32| json!({ "cid": cid, "source": "upload", "aid": aid, "width": width, "height": height });
        let refused = [
            json!((1..=4).map(|index| image(&format!("tafac-img-0000000{index}-0000@tafac.fr"), &format!("aid-000{index}-upload"), 10, 10)).collect::<Vec<_>>()),
            json!([image("logo@example.org", AID, 10, 10)]),
            json!([image(IMAGE_CID, "../etc", 10, 10)]),
            json!([image(IMAGE_CID, AID, 0, 10)]),
            json!([image(IMAGE_CID, AID, 10, 99999)]),
            json!([image(IMAGE_CID, AID, 10, 10), image(IMAGE_CID, OTHER_AID, 10, 10)]),
            json!([image(IMAGE_CID, AID, 10, 10), image(OTHER_CID, AID, 10, 10)]),
            json!([{ "cid": IMAGE_CID, "aid": AID, "width": 10, "height": 10 }]),
            json!("pas une liste"),
        ];
        for images in refused {
            assert_eq!(send(&image_mail(images.clone())).unwrap_err().body(), json!({ "error": INVALID }), "{images}");
        }
        // An upload both attached and in the text.
        let both = with(json!({ "attachments": [{ "source": "upload", "aid": AID }], "inlineImages": [image(IMAGE_CID, AID, 10, 10)] }));
        assert_eq!(code(both), INVALID);
        assert!(is_inline_cid(IMAGE_CID));
        assert!(!is_inline_cid("tafac-img-0123ABCD@tafac.fr"));
    }

    #[test]
    fn a_signature_group_is_one_short_line() {
        let group = |group: Value| send(&with(json!({ "signature": { "include": true, "group": group } }))).unwrap().signature.group;
        assert_eq!(group(json!(" MMI\n2\u{200d} TP ")), "MMI 2 TP");
        assert_eq!(group(json!("é".repeat(100))).chars().count(), 80);
        assert_eq!(group(json!(["MMI"])), "");
        assert_eq!(group(json!("<b>MMI</b>")), "<b>MMI</b>", "escaped where it is used, not here");
    }

    #[test]
    fn a_subject_is_one_line() {
        let subject = |subject: Value| send(&with(json!({ "subject": subject }))).unwrap().subject;
        assert_eq!(subject(json!("a".repeat(400))).len(), 255);
        assert_eq!(subject(json!(12)), "");
        assert_eq!(subject(json!(" Re:\r\nBcc: x\u{202e} \t ok ")), "Re: Bcc: x ok");
    }

    #[test]
    fn numbers_as_javascript_reads_them() {
        for (text, number) in [("", 0.0), ("  ", 0.0), ("12", 12.0), ("+12", 12.0), ("-12", -12.0), ("1.5", 1.5), (".5", 0.5), ("5.", 5.0), ("1e3", 1000.0), ("1E+3", 1000.0), ("0x1F", 31.0), ("0b11", 3.0), ("0o17", 15.0), ("Infinity", f64::INFINITY), ("\u{feff}7\u{a0}", 7.0)] {
            assert_eq!(string_to_number(text), number, "{text:?}");
        }
        for text in ["1e", "e3", ".", "+.e1", "0x", "-0x1", "inf", "NaN", "1_000", "1 2", "infinity", "１２"] {
            assert!(string_to_number(text).is_nan(), "{text:?}");
        }
        assert_eq!(js_number(Some(&json!([[3]]))), 3.0);
        assert_eq!(js_number(Some(&json!([]))), 0.0);
        assert!(js_number(None).is_nan());
        assert_eq!(js_round(322.5), 323);
        assert_eq!(js_round(0.499_999_999_999_999_94), 0);
    }
}
