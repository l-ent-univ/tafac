// What JavaScript does to text where Rust does otherwise, for the answers
// made here as Node makes them: its idea of a space, a length counted in
// UTF-16 units, and JSON.stringify's strings.
//
// A JavaScript string is UTF-16 and may hold half of a pair (a title cut in
// the middle of an emoji, server/appIcons.js); a Rust one may not. The text
// that can come to that is kept as UTF-16 units here (`Utf16`), and written
// back as JSON.stringify writes it.

pub(crate) type Utf16 = Vec<u16>;

// JavaScript's white space (\s, and what trim() takes away): WhiteSpace and
// LineTerminator, which Rust's char::is_whitespace isn't (U+FEFF is one,
// U+0085 isn't).
pub(crate) fn is_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

// String.prototype.trim.
pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

// String.prototype.slice(0, length): `length` UTF-16 units at most, half of
// a pair included when the cut falls inside one.
pub(crate) fn utf16_prefix(text: &str, length: usize) -> Utf16 {
    text.encode_utf16().take(length).collect()
}

// The same, of text already in units.
pub(crate) fn units_prefix(units: &[u16], length: usize) -> Utf16 {
    units[..units.len().min(length)].to_vec()
}

// Units as text, for what only reads it (a title's keywords): half of a
// pair is no letter, and reads as one here (U+FFFD), as there.
pub(crate) fn lossy(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

// A JSON string as JSON.stringify writes it: « " », « \ » and the control
// characters escaped (\b \t \n \f \r, \u00xx for the others), half of a
// pair as \udxxx, everything else as it is.
pub(crate) fn write_json_units(out: &mut String, units: &[u16]) {
    out.push('"');
    for decoded in char::decode_utf16(units.iter().copied()) {
        match decoded {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\u{8}') => out.push_str("\\b"),
            Ok('\t') => out.push_str("\\t"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\u{c}') => out.push_str("\\f"),
            Ok('\r') => out.push_str("\\r"),
            Ok(c) if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            Ok(c) => out.push(c),
            Err(lone) => out.push_str(&format!("\\u{:04x}", lone.unpaired_surrogate())),
        }
    }
    out.push('"');
}

pub(crate) fn write_json_str(out: &mut String, text: &str) {
    write_json_units(out, &text.encode_utf16().collect::<Vec<_>>());
}

// A code point of the last 2048 of Unicode (plane 16's private use, which
// no title holds) stands for half of a pair while serde_json, which refuses
// those, reads a file JSON.parse reads.
const LONE_STAND_IN: u32 = 0x10_F800;

// JSON text JSON.parse reads, made one serde_json reads: each escape of
// half of a pair (« \ud83d » alone) becomes the escape of its stand-in.
// Nothing else changes: what was JSON stays JSON, what wasn't still isn't.
pub(crate) fn json_with_lone_halves_stood_in(text: &str) -> String {
    let bytes = text.as_bytes();
    let unit_at = |index: usize| -> Option<u16> {
        let escape = bytes.get(index..index + 6)?;
        if escape[0] != b'\\' || escape[1] != b'u' || !escape[2..].iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        u16::from_str_radix(std::str::from_utf8(&escape[2..]).ok()?, 16).ok()
    };
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if !in_string {
            in_string = byte == b'"';
        } else if byte == b'"' {
            in_string = false;
        } else if byte == b'\\' {
            if let Some(unit) = unit_at(index).filter(|unit| (0xd800..=0xdfff).contains(unit)) {
                let pair = (0xd800..=0xdbff).contains(&unit) && unit_at(index + 6).is_some_and(|low| (0xdc00..=0xdfff).contains(&low));
                if pair {
                    out.push_str(&text[index..index + 12]);
                    index += 12;
                } else {
                    let stand_in = LONE_STAND_IN + u32::from(unit - 0xd800) - 0x1_0000;
                    out.push_str(&format!("\\u{:04x}\\u{:04x}", 0xd800 + (stand_in >> 10), 0xdc00 + (stand_in & 0x3ff)));
                    index += 6;
                }
                continue;
            }
            // Any other escape: its two characters, as they are.
            let length = text[index + 1..].chars().next().map_or(0, char::len_utf8);
            out.push_str(&text[index..index + 1 + length]);
            index += 1 + length;
            continue;
        }
        let length = text[index..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&text[index..index + length]);
        index += length;
    }
    out
}

// Text serde_json read from that JSON, as the UTF-16 units JSON.parse
// would have made: each stand-in back to its half of a pair.
pub(crate) fn units_with_lone_halves(text: &str) -> Utf16 {
    let mut units = Vec::with_capacity(text.len());
    for c in text.chars() {
        match c as u32 {
            code if code >= LONE_STAND_IN => units.push((0xd800 + code - LONE_STAND_IN) as u16),
            _ => units.extend_from_slice(c.encode_utf16(&mut [0; 2])),
        }
    }
    units
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascripts_spaces_are_its_own() {
        assert_eq!(trim("\u{feff}\u{a0} a b\u{2028}\t"), "a b");
        // NEL is a control character to JavaScript, not a space.
        assert_eq!(trim("\u{85}a"), "\u{85}a");
        assert!(!is_space('\u{200b}'));
    }

    #[test]
    fn a_length_is_counted_in_utf16_units() {
        assert_eq!(utf16_prefix("aé📚b", 3), vec![0x61, 0xe9, 0xd83d]);
        assert_eq!(lossy(&utf16_prefix("aé📚b", 3)), "aé\u{fffd}");
        assert_eq!(utf16_prefix("ab", 5), vec![0x61, 0x62]);
    }

    #[test]
    fn strings_are_written_as_json_stringify_writes_them() {
        let mut out = String::new();
        write_json_units(&mut out, &[0x22, 0x5c, 0x08, 0x0c, 0x01, 0x7f, 0xe9, 0x2028, 0xd83d, 0xdcda, 0xd83d]);
        assert_eq!(out, "\"\\\"\\\\\\b\\f\\u0001\u{7f}é\u{2028}📚\\ud83d\"");
    }

    #[test]
    fn half_of_a_pair_is_read_as_json_parse_reads_it() {
        let text = r#"{"a":"x\ud83d","b":"📚\\ud83d","c":"\udcdaend","d":"é"}"#;
        let read: serde_json::Value = serde_json::from_str(&json_with_lone_halves_stood_in(text)).unwrap();
        assert_eq!(units_with_lone_halves(read["a"].as_str().unwrap()), vec![0x78, 0xd83d]);
        assert_eq!(read["b"], "📚\\ud83d");
        assert_eq!(units_with_lone_halves(read["c"].as_str().unwrap())[0], 0xdcda);
        assert_eq!(read["d"], "é");
        // What wasn't JSON still isn't.
        assert!(serde_json::from_str::<serde_json::Value>(&json_with_lone_halves_stood_in(r#"{"a":"\ud83d}"#)).is_err());
        assert_eq!(json_with_lone_halves_stood_in("{ broken"), "{ broken");
    }
}
