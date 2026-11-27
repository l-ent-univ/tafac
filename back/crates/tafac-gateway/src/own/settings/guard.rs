// What a patch may not do, whoever signed it (server/remoteSettings/guard.ts).
//
// A patch can switch a feature off or follow an address that moved. It can
// never send anything somewhere new: every address it names must be one of
// the university's own, as the app ships them (the hosts of the https
// addresses in its settings, and the domains it lists: launch.allowedDomains,
// the sign-in chains' signInDomains). A new domain takes a new version of
// the app, which is read before it is published.
//
// Nor may it name a file of the device (a mail's logo is read from one), or
// change which university the settings are.
//
// Node's patterns, written out: an address is « https?:// » in any case and
// what follows up to a space or one of " ' < > \ (JavaScript's spaces); a
// bare host is labels of letters, digits and dashes, and a last one of two
// letters or more; a list of domains is a key that ends in « domains ».
// Which reason is said first may differ from Node's when there are several
// (Node goes through an object's keys in the order they were written, this
// in their alphabetical order); whether a patch is refused doesn't.

use serde_json::{Map, Value};

use super::minisign::is_js_space;

// Every address in a text, as Node's /https?:\/\/[^\s"'<>\\]+/gi finds them.
fn addresses(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < text.len() {
        let rest = &text[at..];
        let scheme = ["https://", "http://"].into_iter().find(|scheme| rest.len() >= scheme.len() && rest.as_bytes()[..scheme.len()].eq_ignore_ascii_case(scheme.as_bytes()));
        if let Some(scheme) = scheme {
            let after = &rest[scheme.len()..];
            let length = after.find(|c: char| is_js_space(c) || matches!(c, '"' | '\'' | '<' | '>' | '\\')).unwrap_or(after.len());
            if length > 0 {
                found.push(&rest[..scheme.len() + length]);
                at += scheme.len() + length;
                continue;
            }
        }
        at += rest.chars().next().map_or(1, char::len_utf8);
    }
    found
}

fn is_https(address: &str) -> bool {
    address.len() >= 8 && address.as_bytes()[..8].eq_ignore_ascii_case(b"https://")
}

// new URL(address).hostname, in lower case.
fn host_of(address: &str) -> Option<String> {
    url::Url::parse(address).ok()?.host_str().map(str::to_lowercase).filter(|host| !host.is_empty())
}

// /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i
fn is_bare_host(text: &str) -> bool {
    let Some((labels, last)) = text.rsplit_once('.') else { return false };
    last.len() >= 2 && last.bytes().all(|byte| byte.is_ascii_alphabetic()) && labels.split('.').all(|label| !label.is_empty() && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))
}

// /domains$/i. Node read a university's own domains from its settings
// (trusted_domains); the apps read them from tonAPI's (remote.rs), so this
// and the two below are for the tests that hold the guard to Node's.
#[cfg(test)]
fn is_domain_list(key: &str) -> bool {
    key.len() >= 7 && key.as_bytes()[key.len() - 7..].eq_ignore_ascii_case(b"domains")
}

// Each text in a value, with the key it is under (an array's entries under
// the array's).
#[cfg(test)]
fn strings<'a>(value: &'a Value, key: &'a str, visit: &mut dyn FnMut(&'a str, &'a str)) {
    match value {
        Value::String(text) => visit(text, key),
        Value::Array(entries) => entries.iter().for_each(|entry| strings(entry, key, visit)),
        Value::Object(object) => object.iter().for_each(|(name, entry)| strings(entry, name, visit)),
        _ => {}
    }
}

// The university's own domains, from its settings as the app ships them.
#[cfg(test)]
pub(super) fn trusted_domains(config: &Value) -> Vec<String> {
    let mut domains: Vec<String> = Vec::new();
    let mut add = |domain: String| {
        if !domains.contains(&domain) {
            domains.push(domain);
        }
    };
    strings(config, "", &mut |text, key| {
        for address in addresses(text) {
            if let Some(host) = is_https(address).then(|| host_of(address)).flatten() {
                add(host);
            }
        }
        if is_domain_list(key) && is_bare_host(text) {
            add(text.to_lowercase());
        }
    });
    domains
}

pub(super) fn is_trusted_host(host: &str, trusted: &[String]) -> bool {
    let name = host.to_lowercase();
    trusted.iter().any(|domain| name == *domain || name.ends_with(&format!(".{domain}")))
}

// Why a patch's settings are refused, or None.
pub(super) fn refusal(overriding: &Map<String, Value>, trusted: &[String]) -> Option<String> {
    if overriding.contains_key("id") {
        return Some("changes which university this is".to_string());
    }
    let mut reason = None;
    for (name, entry) in overriding {
        visit(entry, name, trusted, &mut reason);
    }
    reason
}

// The first reason found stays the one said.
fn visit(value: &Value, key: &str, trusted: &[String], reason: &mut Option<String>) {
    let mut refuse = |why: String| {
        reason.get_or_insert(why);
    };
    if key == "file" {
        return refuse("names a file of the device".to_string());
    }
    match value {
        Value::String(text) => {
            for address in addresses(text) {
                if !is_https(address) {
                    return refuse("an address that is not https".to_string());
                }
                match host_of(address) {
                    Some(host) if is_trusted_host(&host, trusted) => {}
                    host => return refuse(format!("an address outside the university's domains ({})", host.as_deref().unwrap_or("unreadable"))),
                }
            }
            if is_bare_host(text) && !is_trusted_host(text, trusted) {
                refuse(format!("a host outside the university's domains ({})", text.to_lowercase()));
            }
        }
        Value::Array(entries) => entries.iter().for_each(|entry| visit(entry, key, trusted, reason)),
        Value::Object(object) => object.iter().for_each(|(name, entry)| visit(entry, name, trusted, reason)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::document::tests::shipped;
    use super::*;

    fn refused(overriding: Value) -> Option<String> {
        refusal(overriding.as_object().unwrap(), &trusted_domains(&shipped()))
    }

    #[test]
    fn the_universitys_own_domains_are_the_ones_the_app_ships_with() {
        let mut domains = trusted_domains(&shipped());
        domains.sort();
        assert_eq!(domains, ["ent.univ-rennes.fr", "partage.renater.fr", "partage.univ-rennes.fr", "sso-cas.univ-rennes.fr", "univ-rennes.fr"]);
        // Only https addresses, and only a list's bare hosts.
        assert_eq!(trusted_domains(&json!({ "a": "http://plain.example.org", "b": "example.org", "signInDomains": ["not a host", "Idp.Example.ORG"] })), ["idp.example.org"]);
    }

    #[test]
    fn a_patch_never_sends_anything_to_a_new_domain() {
        assert_eq!(refused(json!({ "origins": { "cas": "https://sso2.univ-rennes.fr/cas" } })), None);
        assert_eq!(refused(json!({ "features": { "mail": false }, "mail": { "maxMessages": 10 } })), None);
        assert_eq!(refused(json!({ "origins": { "cas": "https://sso.example.org" } })).as_deref(), Some("an address outside the university's domains (sso.example.org)"));
        // A look-alike, an address in a sentence, one without https, a bare host.
        for overriding in [json!({ "origins": { "cas": "https://univ-rennes.fr.example.org" } }), json!({ "origins": { "cas": "https://evil-univ-rennes.fr" } }), json!({ "note": "see https://example.org/page for more" })] {
            assert!(refused(overriding.clone()).unwrap().contains("outside"), "{overriding}");
        }
        assert_eq!(refused(json!({ "origins": { "cas": "http://sso-cas.univ-rennes.fr" } })).as_deref(), Some("an address that is not https"));
        assert_eq!(refused(json!({ "origins": { "cas": "HTTP://sso-cas.univ-rennes.fr" } })).as_deref(), Some("an address that is not https"));
        assert_eq!(refused(json!({ "mail": { "signInDomains": ["example.org"] } })).as_deref(), Some("a host outside the university's domains (example.org)"));
        assert_eq!(refused(json!({ "mail": { "signInDomains": ["idp.univ-rennes.fr"] } })), None);
        // Nor name a file of the device, nor change the university.
        assert_eq!(refused(json!({ "mail": { "signature": { "logo": { "file": "/private/cookies.json" } } } })).as_deref(), Some("names a file of the device"));
        assert_eq!(refused(json!({ "file": ["anything"] })).as_deref(), Some("names a file of the device"));
        assert_eq!(refused(json!({ "id": "univ-rennes-2" })).as_deref(), Some("changes which university this is"));
    }

    #[test]
    fn an_address_ends_where_nodes_pattern_ends_it() {
        assert_eq!(addresses("a https://x.fr/p, then HtTp://y.fr\"z 'https://' http://w.fr\u{3000}v https://u.fr\\t"), ["https://x.fr/p,", "HtTp://y.fr", "http://w.fr", "https://u.fr"]);
        assert_eq!(addresses("hhttps://é.fr/é"), ["https://é.fr/é"]);
        // What the URL reader can't read is an address all the same, refused.
        assert_eq!(refused(json!({ "a": "https://[nope" })).as_deref(), Some("an address outside the university's domains (unreadable)"));
        // The host as the URL reader has it: after a user, in lower case.
        assert_eq!(refused(json!({ "a": "https://sso.example.org@ENT.univ-rennes.fr/" })), None);
        assert!(is_bare_host("a-b.c9.fr") && !is_bare_host("a..fr") && !is_bare_host("a.f") && !is_bare_host("fr") && !is_bare_host("a.fr.") && !is_bare_host("a.f2"));
    }
}
