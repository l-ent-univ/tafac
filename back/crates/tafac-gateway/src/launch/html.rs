// What a page of a sign-in chain says of where to go next, when it isn't a
// redirect of HTTP's: an address written in it (a `refresh`, a script that
// sets the location), or a form that posts itself. As Node read them
// (server/entAuthApp.js: extractHtmlRedirect, extractAutoSubmitForm,
// isCasLoginForm), on pages of the CAS, of a federation and of the services.

use tonapi_http::forms::{self, Form};
use url::Url;

// The address a page sends the browser to by itself:
// <meta http-equiv="refresh" content="0; url=…">, or a script's
// `location = '…'`, `location.href = '…'`, `location.replace('…')`.
pub(crate) fn written_redirect(html: &str, page: &Url) -> Option<Url> {
    let written = refresh(html).or_else(|| script_location(html))?;
    page.join(&written).ok()
}

// The same text, ASCII letters in lower case: a place in one is the same
// place in the other.
fn lower(html: &str) -> String {
    html.to_ascii_lowercase()
}

fn refresh(html: &str) -> Option<String> {
    let lowered = lower(html);
    let mut from = 0;
    while let Some(found) = lowered[from..].find("<meta") {
        let start = from + found;
        let end = lowered[start..].find('>').map_or(lowered.len(), |end| start + end);
        from = end;
        let tag = &lowered[start..end];
        if !tag.contains("http-equiv") || !tag.contains("refresh") {
            continue;
        }
        let Some(url) = tag.find("url=") else { continue };
        let value = html[start + url + "url=".len()..end].trim_start_matches(['"', '\'']);
        let value = value.split(|character: char| character.is_whitespace() || matches!(character, '"' | '\'' | '>')).next().unwrap_or_default();
        if !value.is_empty() {
            return Some(decoded(value));
        }
    }
    None
}

// The text between quotes that starts `text`, after any space.
fn quoted(text: &str) -> Option<&str> {
    let text = text.trim_start();
    let rest = text.strip_prefix(['"', '\''])?;
    let value = rest.split(['"', '\'']).next()?;
    // Closed, and not empty.
    (rest.len() > value.len() && !value.is_empty()).then_some(value)
}

fn script_location(html: &str) -> Option<String> {
    let lowered = lower(html);
    // What follows a place of the lowered text, spaces aside, and where.
    let after = |at: usize| {
        let rest = lowered[at..].trim_start();
        (rest, lowered.len() - rest.len())
    };
    let assigned = lowered.match_indices("location").find_map(|(found, name)| {
        let named = found + name.len();
        let named = if lowered[named..].starts_with(".href") { named + ".href".len() } else { named };
        let (rest, at) = after(named);
        // « = », never « == ».
        rest.starts_with('=').then(|| quoted(&html[at + 1..])).flatten()
    });
    let replaced = || {
        lowered.match_indices("location.replace").find_map(|(found, name)| {
            let (rest, at) = after(found + name.len());
            let inside = rest.starts_with('(').then(|| html[at + 1..].trim_start())?;
            let value = quoted(inside)?;
            inside[value.len() + 2..].trim_start().starts_with(')').then_some(value)
        })
    };
    assigned.or_else(replaced).map(str::to_string)
}

// An attribute's text as a browser reads it: the entities a sign-in page
// writes an address with.
fn decoded(text: &str) -> String {
    let mut decoded = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        decoded.push_str(&rest[..at]);
        rest = &rest[at..];
        let entity = rest.find(';').filter(|end| *end <= 10).and_then(|end| {
            let name = &rest[1..end];
            let character = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ => {
                    let number = name.strip_prefix('#')?;
                    let code = match number.strip_prefix(['x', 'X']) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                        None => number.parse().ok()?,
                    };
                    char::from_u32(code)
                }
            };
            Some((character?, end + 1))
        });
        match entity {
            Some((character, length)) => {
                decoded.push(character);
                rest = &rest[length..];
            }
            None => {
                decoded.push('&');
                rest = &rest[1..];
            }
        }
    }
    decoded.push_str(rest);
    decoded
}

// Whether a script of the page posts a form without the student:
// « .submit() ».
fn posts_itself(html: &str) -> bool {
    lower(html).match_indices(".submit").any(|(at, name)| {
        let after = html[at + name.len()..].trim_start();
        after.strip_prefix('(').is_some_and(|inside| inside.trim_start().starts_with(')'))
    })
}

// A form to post: where, and what a browser would send.
pub(crate) struct Posted {
    pub action: Url,
    pub fields: Vec<(String, String)>,
}

fn posted(form: &Form, page: &Url) -> Option<Posted> {
    let action = match form.action.as_deref().filter(|action| !action.is_empty()) {
        Some(action) => page.join(action).ok()?,
        None => page.clone(),
    };
    Some(Posted { action, fields: form.fields.clone() })
}

// What a page of a sign-in chain is, for whoever walks the chain.
pub(crate) enum Page {
    // The federation's discovery page (WAYF): a form that asks which
    // university the student is of (`user_idp`), with its other fields and
    // its button.
    Discovery { form: Posted, button: Option<(String, String)> },
    // A form the page posts by itself (a SAML message on its way, most
    // often).
    Posting(Posted),
    // The CAS's own login form: it wants the password again.
    CasLogin,
    Other,
}

pub(crate) fn read(html: &str, page: &Url, is_cas: bool) -> Page {
    let forms = forms::forms(html);
    if is_cas && forms.iter().any(|form| form.has_password || form.value("execution").is_some_and(|value| !value.is_empty())) {
        return Page::CasLogin;
    }
    if let Some(form) = forms.iter().find(|form| form.has("user_idp")) {
        let button = form.buttons.iter().find(|(name, _)| name == "Select").cloned();
        return match posted(form, page) {
            Some(mut form) => {
                form.fields.retain(|(name, _)| name != "user_idp");
                Page::Discovery { form, button }
            }
            None => Page::Other,
        };
    }
    // A form that carries a SAML message is posted by its page, whatever
    // the script that does it; any other only when a script says so. The
    // first form with an address, as Node took it.
    let carries_saml = |form: &&Form| form.has("SAMLResponse") || form.has("SAMLRequest");
    let posting = forms.iter().find(carries_saml).or_else(|| forms.iter().find(|form| form.action.is_some()).filter(|_| posts_itself(html)));
    match posting.and_then(|form| posted(form, page)) {
        // A password is never posted from here.
        Some(form) if !forms.iter().any(|form| form.has_password) => Page::Posting(form),
        _ => Page::Other,
    }
}

// Whether the page is the CAS's login form (the ticket no longer signs in).
pub(crate) fn is_cas_login(html: &str) -> bool {
    forms::forms(html).iter().any(|form| form.value("execution").is_some_and(|value| !value.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(address: &str) -> Url {
        Url::parse(address).unwrap()
    }

    fn redirect(html: &str) -> Option<String> {
        written_redirect(html, &at("https://service.exemple.test/a/page")).map(String::from)
    }

    #[test]
    fn a_refresh_and_a_scripts_location_are_addresses_to_follow() {
        assert_eq!(redirect(r#"<meta http-equiv="refresh" content="0; url=https://cas.exemple.test/login?service=x&amp;y=1">"#).as_deref(), Some("https://cas.exemple.test/login?service=x&y=1"));
        assert_eq!(redirect(r#"<META CONTENT="0;URL=/next" HTTP-EQUIV=Refresh>"#).as_deref(), Some("https://service.exemple.test/next"));
        assert_eq!(redirect(r#"<meta http-equiv="refresh" content="2; url='other'">"#).as_deref(), Some("https://service.exemple.test/a/other"));
        assert_eq!(redirect(r#"<script>window.location = "https://b.exemple.test/x";</script>"#).as_deref(), Some("https://b.exemple.test/x"));
        assert_eq!(redirect("<script>location.href='/y'</script>").as_deref(), Some("https://service.exemple.test/y"));
        assert_eq!(redirect("<script>document.location.HREF  =  '/y'</script>").as_deref(), Some("https://service.exemple.test/y"));
        assert_eq!(redirect(r#"<script>window.location.replace( "/z" )</script>"#).as_deref(), Some("https://service.exemple.test/z"));
        // The refresh first, as a browser without scripts would go.
        assert_eq!(redirect(r#"<script>location='/s'</script><meta http-equiv="refresh" content="0;url=/m">"#).as_deref(), Some("https://service.exemple.test/m"));
    }

    #[test]
    fn a_page_that_goes_nowhere_by_itself() {
        for html in [
            "",
            "<html><body>Tableau de bord</body></html>",
            r#"<meta name="description" content="url=https://x.test/">"#,
            r#"<meta http-equiv="refresh" content="30">"#,
            "<script>if (location.href == '/x') {}</script>",
            "<script>if (window.location === \"/x\") {}</script>",
            "<script>var location_name = 'x';</script>",
            "<script>location.replace(next)</script>",
            "<script>location = '</script>",
            "<meta",
        ] {
            assert_eq!(redirect(html), None, "{html}");
        }
    }

    #[test]
    fn an_attributes_entities_are_read() {
        assert_eq!(decoded("a&amp;b&#x3d;c&#61;d&quot;&lt;&gt;&apos;"), "a&b=c=d\"<>'");
        assert_eq!(decoded("a&b&unknown;&#xzz;&"), "a&b&unknown;&#xzz;&");
    }

    const SAML: &str = r#"<html><body onload="document.forms[0].submit()">
        <form method="post" action="https://moodle.exemple.test/Shibboleth.sso/SAML2/POST">
        <input type="hidden" name="RelayState" value="ss:mem:1"><input type="hidden" name="SAMLResponse" value="PHNhbWw+">
        <noscript><input type="submit" value="Continue"></noscript></form></body></html>"#;

    #[test]
    fn a_form_that_posts_itself_is_read_with_what_a_browser_sends() {
        let Page::Posting(form) = read(SAML, &at("https://idp.exemple.test/idp/profile"), false) else { panic!("a form that posts itself") };
        assert_eq!(form.action.as_str(), "https://moodle.exemple.test/Shibboleth.sso/SAML2/POST");
        assert_eq!(form.fields, [("RelayState".to_string(), "ss:mem:1".to_string()), ("SAMLResponse".to_string(), "PHNhbWw+".to_string())]);

        // Any other form only when a script posts it; its address read
        // from the page's own when it has a relative one.
        let scripted = r#"<form action="next?a=1&amp;b=2"><input type="hidden" name="k" value="v"></form><script>document.forms[0].submit ( );</script>"#;
        let Page::Posting(form) = read(scripted, &at("https://a.exemple.test/dir/page"), false) else { panic!("a form that posts itself") };
        assert_eq!(form.action.as_str(), "https://a.exemple.test/dir/next?a=1&b=2");
        assert!(matches!(read(r#"<form action="/search"><input name="q"></form>"#, &at("https://a.exemple.test/"), false), Page::Other));
        assert!(matches!(read("<p>Bonjour</p>", &at("https://a.exemple.test/"), false), Page::Other));
    }

    #[test]
    fn the_discovery_page_and_the_cas_own_form_are_told_apart() {
        let wayf = r#"<form action="/wayf/select" method="post"><input type="hidden" name="return" value="/Shibboleth.sso/Login">
            <select name="user_idp"><option value="urn:autre">Autre</option></select><input type="submit" name="Select" value="Sélection"></form>"#;
        let Page::Discovery { form, button } = read(wayf, &at("https://wayf.exemple.test/wayf"), false) else { panic!("the discovery page") };
        assert_eq!(form.action.as_str(), "https://wayf.exemple.test/wayf/select");
        assert_eq!(form.fields, [("return".to_string(), "/Shibboleth.sso/Login".to_string())]);
        assert_eq!(button, Some(("Select".to_string(), "Sélection".to_string())));

        let login = r#"<form id="fm1" method="post" action="login"><input name="username"><input type="password" name="password">
            <input type="hidden" name="execution" value="e1s1"></form><script>document.getElementById('fm1').submit()</script>"#;
        assert!(matches!(read(login, &at("https://cas.exemple.test/cas/login"), true), Page::CasLogin));
        assert!(is_cas_login(login));
        assert!(!is_cas_login("<html><body><h2>Log In Successful</h2></body></html>"));
        // The same form elsewhere is a password asked for: never posted.
        assert!(matches!(read(login, &at("https://idp.exemple.test/login"), false), Page::Other));
    }
}
