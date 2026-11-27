// A minisign signature, checked as server/remoteSettings/minisign.ts checks
// it: the format of the desktop app's updates (`tauri signer sign`), so the
// remote settings are signed with the same key and the same command.
//
// The public key and the signature come as Tauri writes them: the minisign
// file's text, in base64, or the text itself. A signature by `tauri signer`
// is over the file's BLAKE2b-512 digest (« ED »); the older form over the
// file itself (« Ed ») is read too. The trusted comment (the date, the
// file's name) is signed with it: both are checked. The lines are found as
// Node finds them (the key's last line that isn't a comment; the line before
// the trusted comment, and the one after), and the crypto is minisign's own
// verifier's.
//
// Stricter than Node in one thing: base64 is read as it is written
// (standard alphabet, nothing between its characters), where Node's
// Buffer.from skips what isn't base64. A key or a signature Tauri wrote
// reads the same here; one Node reads only by skipping characters is
// refused.

use base64::alphabet::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};

const TRUSTED_COMMENT: &str = "trusted comment: ";

// Base64 with its padding or without, as Tauri writes it either way.
const BASE64: GeneralPurpose = GeneralPurpose::new(&STANDARD, GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent));

// JavaScript's trim: its white space and line ends, which isn't Rust's
// (U+FEFF is, U+0085 isn't).
pub(super) fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

pub(super) fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

// The file's text, whether given as it is or in base64.
fn file_text(value: &str) -> Option<String> {
    let text = js_trim(value);
    if text.contains("comment:") {
        return Some(text.to_string());
    }
    let bytes = BASE64.decode(text).ok()?;
    Some(js_trim(&String::from_utf8_lossy(&bytes)).to_string())
}

fn lines(text: &str) -> Vec<&str> {
    text.split('\n').map(js_trim).filter(|line| !line.is_empty()).collect()
}

fn public_key(value: &str) -> Option<PublicKey> {
    let text = file_text(value)?;
    let line = lines(&text).into_iter().filter(|line| !line.contains("comment:")).next_back()?;
    let bytes = BASE64.decode(line).ok()?;
    if bytes.len() != 42 || &bytes[..2] != b"Ed" {
        return None;
    }
    PublicKey::from_base64(&BASE64.encode(&bytes)).ok()
}

fn signature(value: &str) -> Option<Signature> {
    let text = file_text(value)?;
    let lines = lines(&text);
    let at = lines.iter().position(|line| line.starts_with(TRUSTED_COMMENT))?;
    if at < 1 || at + 1 >= lines.len() {
        return None;
    }
    let signed = BASE64.decode(lines[at - 1]).ok()?;
    let global = BASE64.decode(lines[at + 1]).ok()?;
    if signed.len() != 74 || !matches!(&signed[..2], b"Ed" | b"ED") || global.len() != 64 {
        return None;
    }
    // As minisign writes it, for its verifier to read: the untrusted
    // comment is nobody's business.
    Signature::decode(&format!("untrusted comment:\n{}\n{}\n{}\n", BASE64.encode(&signed), lines[at], BASE64.encode(&global))).ok()
}

// Whether `signature` is `public_key`'s over `data`. Anything that doesn't
// read (a key, a signature, a text that isn't one) is a no.
pub(super) fn verify_signature(data: &[u8], signature_text: &str, public_key_text: &str) -> bool {
    let (Some(key), Some(signed)) = (public_key(public_key_text), signature(signature_text)) else { return false };
    // The key's id is the signature's, then the file (its digest for « ED »),
    // then the trusted comment.
    key.verify(data, &signed, true).is_ok()
}

#[cfg(test)]
mod tests {
    use super::super::tests::{fixture, public_key as key};
    use super::*;

    #[test]
    fn a_signature_is_the_keys_over_that_very_file() {
        let (taken, taken_signature) = fixture("TAKEN");
        let (newer, newer_signature) = fixture("NEWER");
        assert!(verify_signature(taken.as_bytes(), &taken_signature, &key()));
        // Another file, one byte changed, another file's signature.
        assert!(!verify_signature(newer.as_bytes(), &taken_signature, &key()));
        assert!(!verify_signature(taken.replace("\"serial\":2", "\"serial\":9").as_bytes(), &taken_signature, &key()));
        assert!(!verify_signature(taken.as_bytes(), &newer_signature, &key()));
        // What isn't a key or a signature.
        assert!(!verify_signature(taken.as_bytes(), "", &key()));
        assert!(!verify_signature(taken.as_bytes(), &taken_signature, ""));
        assert!(!verify_signature(taken.as_bytes(), "bm90IGEgc2lnbmF0dXJl", &key()));
    }

    fn decoded(value: &str) -> String {
        String::from_utf8(BASE64.decode(value).unwrap()).unwrap()
    }

    #[test]
    fn the_trusted_comment_is_signed_too() {
        let (taken, signature) = fixture("TAKEN");
        let text = decoded(&signature);
        let at = text.find("file:").unwrap();
        let end = at + text[at..].find(char::is_whitespace).unwrap();
        let forged = BASE64.encode(format!("{}file:another.json{}", &text[..at], &text[end..]));
        assert_ne!(forged, signature);
        assert!(!verify_signature(taken.as_bytes(), &forged, &key()));
    }

    #[test]
    fn a_key_and_a_signature_read_as_text_or_in_base64() {
        let (taken, signature) = fixture("TAKEN");
        // The minisign files themselves, as Node reads them too.
        assert!(verify_signature(taken.as_bytes(), &decoded(&signature), &decoded(&key())));
        // Lines ending in \r\n, blank lines, spaces around: trimmed.
        let loose = decoded(&signature).replace('\n', " \r\n\n");
        assert!(verify_signature(taken.as_bytes(), &loose, &key()));
        // A trusted comment first, with nothing before it: no signature.
        let text = decoded(&signature);
        let from_comment = &text[text.find(TRUSTED_COMMENT).unwrap()..];
        assert!(!verify_signature(taken.as_bytes(), from_comment, &key()));
        // A key signed with another algorithm, or that isn't 42 bytes.
        let mut bytes = BASE64.decode(lines(&decoded(&key()))[1]).unwrap();
        bytes[1] = b'D';
        assert!(!verify_signature(taken.as_bytes(), &signature, &format!("untrusted comment: x\n{}", BASE64.encode(&bytes))));
        assert!(!verify_signature(taken.as_bytes(), &signature, &format!("untrusted comment: x\n{}", BASE64.encode(&bytes[..41]))));
    }

    #[test]
    fn white_space_is_javascripts() {
        assert_eq!(js_trim("\u{feff}\u{a0} a b\u{3000}\n"), "a b");
        assert_eq!(js_trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
    }
}
