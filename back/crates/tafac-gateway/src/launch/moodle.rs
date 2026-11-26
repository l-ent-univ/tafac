// Moodle behind the federation (Shibboleth: Rennes): the sign-in walked as
// far as the form the browser posts (server/entAuthApp.js:
// prepareMoodleLaunchRelay).
//
// Such a Moodle takes no CAS ticket. Its sign-in goes from Moodle to the
// federation's discovery page (which university?), to the university's IdP,
// to the CAS (the ticket), back to the IdP, which answers a page that posts
// a SAML message to Moodle. The walk makes every step but that last post:
// the message is handed to the browser in a page that posts it, and Moodle
// opens its session for the browser.
//
// Every address of the chain is one of the university's (targets.rs: its
// Moodle, its CAS, the domains its sign-in goes through). Node followed
// this chain wherever it led; here a step elsewhere stops the walk, and the
// browser signs in by itself. The password is never asked for nor posted:
// the CAS's own form on the way is the session to ask the CAS about.

use tonapi_config::{HomeworkService, MoodleEntry, ResolvedUniversity, Sso};
use tonapi_http::Browser;
use url::Url;

use super::html::{self, Page};
use super::walk::{get, host, post, Relay};

// Node's own number of steps.
const STEPS: usize = 15;
// The discovery page's button, when the page doesn't say its own.
const SELECT: (&str, &str) = ("Select", "Sélection");

// A Moodle that signs in through the federation.
pub(crate) struct Federated {
    // Its root, with a slash at the end.
    pub base: Url,
    // The university's name for the discovery page (its IdP's entity id).
    pub idp: String,
}

// How the relay signs in to the university's Moodle.
pub(crate) enum SignIn {
    // Through the federation: the walk of this file.
    Federated(Federated),
    // By the CAS, at Moodle's own CAS login (an activity's page would
    // answer Moodle's page of logins, not the CAS): the plain walk, started
    // there, so the student lands on Moodle signed in.
    ByCas(Url),
}

// A service's root: a slash at the end, nothing after the path.
fn root(base: &Url) -> Url {
    let mut root = base.clone();
    if !root.path().ends_with('/') {
        root.set_path(&format!("{}/", base.path()));
    }
    root.set_query(None);
    root.set_fragment(None);
    root
}

// None when the target isn't a page of the university's Moodle (tonAPI's
// settings say where it is, and which way it signs in), or when that Moodle
// has no sign-in of the web's.
pub(crate) fn sign_in(settings: &ResolvedUniversity, target: &Url) -> Option<SignIn> {
    let Some(HomeworkService::MoodleAjax { base_url, entry, .. }) = &settings.university.services.homework else { return None };
    let base = root(base_url);
    // On Moodle's host (Node looked no further), and under its folder there
    // when it has one.
    let under = target.path().starts_with(base.path()) || format!("{}/", target.path()) == base.path();
    if host(target) != host(&base) || !under {
        return None;
    }
    match entry {
        MoodleEntry::Cas => base.join("login/index.php?authCAS=CAS").ok().map(SignIn::ByCas),
        MoodleEntry::Shibboleth => {
            let Sso::Cas(cas) = &settings.university.sso else { return None };
            Some(SignIn::Federated(Federated { base, idp: cas.saml.as_ref()?.idp_entity_id.clone() }))
        }
    }
}

impl Federated {
    // Where the sign-in starts. Moodle's Shibboleth entry takes the page to
    // land on after (`target`, a page of Moodle's own): a launch to an
    // activity lands on it, not on the dashboard.
    pub(crate) fn entry(&self, target: &Url) -> Option<Url> {
        let mut entry = self.base.join("auth/shibboleth/index.php").ok()?;
        let inside = target.origin() == self.base.origin() && target.path().starts_with(self.base.path());
        let page = target.path().strip_prefix(self.base.path()).unwrap_or_default();
        if inside && !page.is_empty() && !page.starts_with("auth/") {
            entry.query_pairs_mut().append_pair("target", target.as_str());
        }
        Some(entry)
    }

    // Whether a form is the last one: the SAML message, posted to this
    // Moodle's own Shibboleth.
    fn takes(&self, action: &Url) -> bool {
        host(action) == host(&self.base) && action.path().to_ascii_lowercase().contains("/shibboleth.sso/")
    }
}

// What the browser posts to be signed in.
pub(crate) struct Handoff {
    pub action: Url,
    pub fields: Vec<(String, String)>,
}

pub(crate) enum Prepared {
    Handoff(Handoff),
    // The CAS showed its login form: the session may be over.
    AtCasForm,
    // No way through (a page the walk doesn't know, a service down, a step
    // outside the university): the browser signs in by itself.
    Broken,
}

pub(crate) async fn prepare(browser: &mut Browser, relay: &Relay<'_>, moodle: &Federated, target: &Url) -> Prepared {
    let Some(mut current) = moodle.entry(target) else { return Prepared::Broken };
    // The form to post at the next step, and the page it was on.
    let mut form: Option<(Vec<(String, String)>, Url)> = None;
    for _ in 0..STEPS {
        if !relay.targets.is_allowed(&current) {
            return Prepared::Broken;
        }
        let posted = form.take();
        let answered = match &posted {
            Some((fields, page)) => post(browser, &current, fields, page).await,
            None => get(browser, &current).await,
        };
        let Ok(answered) = answered else { return Prepared::Broken };
        if let Some(location) = answered.location.as_deref().filter(|_| answered.is_redirect()) {
            // A form is never posted a second time, to another address.
            if posted.is_some() && matches!(answered.status, 307 | 308) {
                return Prepared::Broken;
            }
            let Ok(next) = current.join(location) else { return Prepared::Broken };
            current = next;
            continue;
        }
        if let Some(next) = html::written_redirect(&answered.body, &current) {
            current = next;
            continue;
        }
        match html::read(&answered.body, &current, relay.is_cas(&current)) {
            Page::CasLogin => return Prepared::AtCasForm,
            Page::Posting(posting) if moodle.takes(&posting.action) => {
                let allowed = relay.targets.is_allowed(&posting.action);
                return if allowed { Prepared::Handoff(Handoff { action: posting.action, fields: posting.fields }) } else { Prepared::Broken };
            }
            Page::Posting(posting) => {
                form = Some((posting.fields, current));
                current = posting.action;
            }
            Page::Discovery { form: discovery, button } => {
                let mut fields = discovery.fields;
                fields.push(("user_idp".to_string(), moodle.idp.clone()));
                fields.push(button.unwrap_or_else(|| (SELECT.0.to_string(), SELECT.1.to_string())));
                form = Some((fields, current));
                current = discovery.action;
            }
            Page::Other => return Prepared::Broken,
        }
    }
    Prepared::Broken
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(address: &str) -> Url {
        Url::parse(address).unwrap()
    }

    #[test]
    fn the_sign_in_starts_at_moodles_shibboleth_entry_with_the_page_to_land_on() {
        let moodle = Federated { base: at("https://foad.exemple.test/"), idp: "urn:test:idp".to_string() };
        let entry = |target: &str| moodle.entry(&at(target)).unwrap().to_string();
        assert_eq!(entry("https://foad.exemple.test/mod/assign/view.php?id=1&x=a b"), "https://foad.exemple.test/auth/shibboleth/index.php?target=https%3A%2F%2Ffoad.exemple.test%2Fmod%2Fassign%2Fview.php%3Fid%3D1%26x%3Da%2520b");
        // The dashboard, Moodle's own sign-in pages, another site: no page
        // to land on.
        for target in ["https://foad.exemple.test/", "https://foad.exemple.test/auth/shibboleth/index.php", "https://ailleurs.exemple.test/mod/x", "http://foad.exemple.test/mod/x"] {
            assert_eq!(entry(target), "https://foad.exemple.test/auth/shibboleth/index.php", "{target}");
        }
        // A Moodle in a folder of its host.
        let moodle = Federated { base: at("https://ent.exemple.test/moodle/"), idp: "urn:test:idp".to_string() };
        assert_eq!(moodle.entry(&at("https://ent.exemple.test/moodle/my/")).unwrap().as_str(), "https://ent.exemple.test/moodle/auth/shibboleth/index.php?target=https%3A%2F%2Fent.exemple.test%2Fmoodle%2Fmy%2F");
        assert_eq!(moodle.entry(&at("https://ent.exemple.test/autre/")).unwrap().as_str(), "https://ent.exemple.test/moodle/auth/shibboleth/index.php");
    }

    #[test]
    fn the_last_form_is_the_one_posted_to_this_moodles_shibboleth() {
        let moodle = Federated { base: at("https://foad.exemple.test/"), idp: "urn:test:idp".to_string() };
        assert!(moodle.takes(&at("https://foad.exemple.test/Shibboleth.sso/SAML2/POST")));
        assert!(moodle.takes(&at("https://foad.exemple.test/shibboleth.SSO/SAML2/POST")));
        assert!(!moodle.takes(&at("https://idp.exemple.test/Shibboleth.sso/SAML2/POST")));
        assert!(!moodle.takes(&at("https://foad.exemple.test/login/index.php")));
    }

    #[test]
    fn tonapis_settings_say_where_moodle_is_and_which_way_it_signs_in() {
        let rennes = &crate::universities::served()["univ-rennes"].settings;
        let Some(SignIn::Federated(moodle)) = sign_in(rennes, &at("https://foad.univ-rennes.fr/mod/assign/view.php?id=1")) else { panic!("Rennes' Moodle signs in through the federation") };
        assert_eq!(moodle.base.as_str(), "https://foad.univ-rennes.fr/");
        // The name Node's settings gave the discovery page (moodle.wayfEntityId).
        assert!(include_str!("../../../../../universities/univ-rennes/server.js").contains(&format!("wayfEntityId: '{}'", moodle.idp)));
        assert!(sign_in(rennes, &at("https://planning.univ-rennes.fr/portal/")).is_none());

        // A Moodle that signs in by the CAS, in a folder of its host.
        let campus = crate::testing::campus();
        let port = campus.port();
        let Some(SignIn::ByCas(login)) = sign_in(&campus.settings(), &at(&format!("http://127.0.0.1:{port}/moodle/mod/assign/view.php?id=106"))) else { panic!("the campus's Moodle signs in by the CAS") };
        assert_eq!(login.as_str(), format!("http://127.0.0.1:{port}/moodle/login/index.php?authCAS=CAS"));
        assert!(matches!(sign_in(&campus.settings(), &at(&format!("http://127.0.0.1:{port}/moodle"))), Some(SignIn::ByCas(_))));
        // Another service of the same host isn't Moodle.
        for elsewhere in ["library/catalogue", "moodle-archive/", ""] {
            assert!(sign_in(&campus.settings(), &at(&format!("http://127.0.0.1:{port}/{elsewhere}"))).is_none(), "{elsewhere}");
        }
    }
}
