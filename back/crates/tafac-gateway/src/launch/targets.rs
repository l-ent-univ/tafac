// Which addresses the launch relay may ask with the student's CAS ticket,
// and send the browser to (server/launchTargets.js).
//
// The relay asks the target itself and redirects the browser to where the
// CAS sends it. An open target would be an open redirect from Tafac's own
// domain, and a way to make the gateway ask any address. Only the
// university's own services pass:
//
//   the hosts     of the addresses tonAPI's settings name for it: its
//                 portal, its CAS, each service of each of its components
//                 (Moodle, the planning, ScoDoc, the webmail, the school
//                 records)
//   the domains   Tafac's own list for it (OWN, below): the domains whose
//                 services its portal lists, and the ones the sign-in
//                 chains of its webmail and of its Moodle go through. A
//                 subdomain of one passes with it
//
// Over https only: the CAS ticket never goes out in clear. A host the
// settings themselves give over plain http (a made-up campus, for the
// tests) is the one exception.
//
// Anything else the browser opens by itself (the preview says so), and the
// relay sends it back to the app.

use std::collections::BTreeSet;

use tonapi_config::{PortalConfig, ResolvedUniversity, Sso};
use url::Url;

// Tafac's own, for one university: what its settings in Node say that
// tonAPI's don't, because it is about what Tafac opens rather than about a
// software (universities/<id>/server.js). A test holds each list to that
// file.
pub(crate) struct Own {
    // launch.allowedDomains: the domains whose services the portal lists.
    pub launch: &'static [&'static str],
    // mail.signInDomains: where the webmail's sign-in goes through.
    pub mail_sign_in: &'static [&'static str],
    // moodle.signInDomains: where Moodle's does, besides Moodle and the CAS
    // (the federation's WAYF, the university's IdP).
    pub moodle_sign_in: &'static [&'static str],
}

const OWN: &[(&str, Own)] = &[
    (
        "univ-rennes",
        Own {
            launch: &["univ-rennes.fr", "univ-rennes1.fr", "iut-lannion.loxya.app"],
            mail_sign_in: &["partage.renater.fr", "univ-rennes1.fr", "univ-rennes.fr"],
            moodle_sign_in: &["wayf.univ-rennes.fr", "ident-shib.univ-rennes1.fr"],
        },
    ),
    // Cursus signs in at the CAS itself: no federation to go through.
    ("univ-rennes-2", Own { launch: &["univ-rennes2.fr"], mail_sign_in: &["partage.renater.fr", "uhb.fr", "univ-rennes2.fr"], moodle_sign_in: &[] }),
    // univ-paris3.fr: the university's former name, still on some hosts.
    // No webmail of Tafac's there, and iCampus signs in at the CAS itself.
    ("univ-sorbonne-nouvelle", Own { launch: &["sorbonne-nouvelle.fr", "univ-paris3.fr"], mail_sign_in: &[], moodle_sign_in: &[] }),
];

const NONE_OF_ITS_OWN: Own = Own { launch: &[], mail_sign_in: &[], moodle_sign_in: &[] };

pub(crate) fn own(university: &str) -> &'static Own {
    OWN.iter().find_map(|(id, own)| (*id == university).then_some(own)).unwrap_or(&NONE_OF_ITS_OWN)
}

// A domain as a list may write it (normalizeDomain): lower case, no dot
// around it, and at least one inside.
fn domain(written: &str) -> Option<String> {
    let domain = written.trim().to_ascii_lowercase();
    let domain = domain.trim_matches('.');
    let named = !domain.is_empty() && domain.contains('.') && domain.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-');
    named.then(|| domain.to_string())
}

// Every address written in a part of tonAPI's settings: whatever the
// provider, its `base-url`, `entry-url`, `service-url`…
fn addresses(settings: &impl serde::Serialize) -> Vec<Url> {
    fn collect(value: &serde_json::Value, found: &mut Vec<Url>) {
        match value {
            serde_json::Value::String(text) => found.extend(Url::parse(text).ok().filter(|url| matches!(url.scheme(), "http" | "https"))),
            serde_json::Value::Array(list) => list.iter().for_each(|value| collect(value, found)),
            serde_json::Value::Object(map) => map.values().for_each(|value| collect(value, found)),
            _ => {}
        }
    }
    let mut found = Vec::new();
    collect(&serde_json::to_value(settings).unwrap_or_default(), &mut found);
    found
}

pub(crate) struct Targets {
    hosts: BTreeSet<String>,
    // The hosts the settings reach over plain http.
    insecure: BTreeSet<String>,
    domains: BTreeSet<String>,
}

impl Targets {
    pub(crate) fn of(settings: &ResolvedUniversity) -> Self {
        let mut named = Vec::new();
        if let Sso::Cas(cas) = &settings.university.sso {
            named.push(cas.base_url.clone());
        }
        match &settings.university.portal {
            PortalConfig::Uportal4Prolongation { base_url } | PortalConfig::Uportal5 { base_url } | PortalConfig::TilesPortal { base_url, .. } => named.push(base_url.clone()),
            _ => {}
        }
        named.extend(addresses(&settings.university.services));
        for component in settings.establishments.keys() {
            named.extend(addresses(&settings.services_for(Some(component))));
        }
        let host = |url: &Url| url.host_str().map(str::to_ascii_lowercase);
        let own = own(&settings.university.id);
        Self {
            hosts: named.iter().filter_map(host).collect(),
            insecure: named.iter().filter(|url| url.scheme() == "http").filter_map(host).collect(),
            domains: own.launch.iter().chain(own.mail_sign_in).chain(own.moodle_sign_in).filter_map(|written| domain(written)).collect(),
        }
    }

    // Sorted, each once.
    pub(crate) fn hosts(&self) -> impl Iterator<Item = &str> {
        self.hosts.iter().map(String::as_str)
    }

    pub(crate) fn domains(&self) -> impl Iterator<Item = &str> {
        self.domains.iter().map(String::as_str)
    }

    pub(crate) fn is_allowed_host(&self, host: &str) -> bool {
        let host = host.to_ascii_lowercase();
        !host.is_empty() && (self.hosts.contains(&host) || self.domains.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}"))))
    }

    // The address, when it is one of the university's: written with http://
    // or https:// (never « //host », a path, another scheme), without a
    // login or a password before the host (they would change what the host
    // means), over https.
    pub(crate) fn allowed(&self, address: &str) -> Option<Url> {
        let scheme = address.get(..8).unwrap_or(address).to_ascii_lowercase();
        if !scheme.starts_with("http://") && !scheme.starts_with("https://") {
            return None;
        }
        let url = Url::parse(address).ok()?;
        self.is_allowed(&url).then_some(url)
    }

    pub(crate) fn is_allowed(&self, url: &Url) -> bool {
        let Some(host) = url.host_str() else { return false };
        let secure = match url.scheme() {
            "https" => true,
            "http" => self.insecure.contains(&host.to_ascii_lowercase()),
            _ => false,
        };
        secure && url.username().is_empty() && url.password().is_none() && self.is_allowed_host(host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::universities;

    fn rennes() -> Targets {
        Targets::of(&universities::served()["univ-rennes"].settings)
    }

    fn settings(file: &str) -> ResolvedUniversity {
        ResolvedUniversity { dir: Default::default(), university: toml::from_str(file).unwrap(), establishments: Default::default() }
    }

    // The addresses of Node's own tests (tests/launchTargets.test.js).
    #[test]
    fn rennes_own_services_pass_and_the_subdomains_of_its_domains() {
        let targets = rennes();
        for address in [
            "https://services-numeriques.univ-rennes.fr/f/services/normal/render.uP",
            "https://sso-cas.univ-rennes.fr/login?service=x",
            "https://foad.univ-rennes.fr/mod/assign/view.php?id=1",
            "https://planning.univ-rennes.fr/portal/planning/calendar",
            "https://notes9.iutlan.univ-rennes1.fr/services/doAuth.php?href=x",
            "https://partage.univ-rennes.fr/",
            "https://mdw.univ-rennes.fr/",
            "https://esup-signature.univ-rennes.fr/",
            "https://iut-lannion.loxya.app/external/login",
            "https://partage.renater.fr/",
            "HTTPS://FOAD.UNIV-RENNES.FR/",
        ] {
            assert!(targets.allowed(address).is_some(), "{address}");
        }
    }

    #[test]
    fn anything_else_is_refused() {
        let targets = rennes();
        for address in [
            "https://evil.example/",
            "https://univ-rennes.fr.evil.example/",
            "https://evil-univ-rennes.fr/",
            "https://evil.example/?next=https://foad.univ-rennes.fr/",
            "https://foad.univ-rennes.fr@evil.example/",
            "https://user:pass@foad.univ-rennes.fr/",
            "https://user@foad.univ-rennes.fr/",
            "//evil.example/",
            "/relative",
            "javascript:alert(1)",
            "ftp://foad.univ-rennes.fr/",
            "http://127.0.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "https://www.office.com/",
            "https:/foad.univ-rennes.fr/",
            "https:\\\\foad.univ-rennes.fr/",
            " https://foad.univ-rennes.fr/",
            "https://foad.univ-rennes.fr./",
            "https://renater.fr/",
            "https://",
            "",
        ] {
            assert!(targets.allowed(address).is_none(), "{address}");
        }
    }

    #[test]
    fn the_hosts_are_the_ones_tonapis_settings_name() {
        let targets = rennes();
        let hosts: Vec<&str> = targets.hosts().collect();
        // Sorted. The IUT's ScoDoc is a component's; the webmail has two
        // addresses (where it signs in, where its API is).
        assert_eq!(
            hosts,
            [
                "foad.univ-rennes.fr",
                "mdw.univ-rennes.fr",
                "notes9.iutlan.univ-rennes1.fr",
                "partage.univ-rennes.fr",
                "partage.univ-rennes1.fr",
                "planning.univ-rennes.fr",
                "services-numeriques.univ-rennes.fr",
                "sso-cas.univ-rennes.fr",
            ]
        );
        assert_eq!(
            targets.domains().collect::<Vec<_>>(),
            ["ident-shib.univ-rennes1.fr", "iut-lannion.loxya.app", "partage.renater.fr", "univ-rennes.fr", "univ-rennes1.fr", "wayf.univ-rennes.fr"]
        );
    }

    #[test]
    fn a_university_without_domains_of_its_own_allows_its_hosts_only() {
        let targets = Targets::of(&settings(
            r#"
            id = "univ-test"
            name = "Université de test"
            [sso]
            kind = "cas"
            base-url = "https://cas.exemple.test/cas/"
            [portal]
            kind = "uportal5"
            base-url = "https://ent.exemple.test/"
            [services.timetable]
            provider = "ade-portal-rest"
            base-url = "https://planning.exemple.test/portal/"
            [services.grades]
            provider = "link"
            url = "https://notes.exemple.test/"
            "#,
        ));
        assert!(targets.allowed("https://ent.exemple.test/x").is_some());
        assert!(targets.allowed("https://planning.exemple.test/direct/myplanning.jsp").is_some());
        assert!(targets.allowed("https://notes.exemple.test/").is_some());
        assert!(targets.allowed("https://other.exemple.test/").is_none());
        assert!(targets.allowed("https://services-numeriques.univ-rennes.fr/").is_none());
        // The same hosts in clear: the ticket would travel unencrypted.
        assert!(targets.allowed("http://ent.exemple.test/").is_none());
    }

    #[test]
    fn a_host_the_settings_give_over_http_is_asked_over_http() {
        let targets = Targets::of(&settings(
            r#"
            id = "univ-test"
            name = "Université de test"
            [sso]
            kind = "cas"
            base-url = "https://cas.exemple.test/cas/"
            [portal]
            kind = "uportal5"
            base-url = "http://127.0.0.1:8080/"
            "#,
        ));
        assert!(targets.allowed("http://127.0.0.1:8080/f/accueil").is_some());
        assert!(targets.allowed("http://cas.exemple.test/login").is_none());
        assert!(targets.allowed("https://cas.exemple.test/login").is_some());
    }

    #[test]
    fn a_domain_is_one_whatever_way_it_is_written() {
        assert_eq!(domain(" .Univ-Rennes.FR. ").as_deref(), Some("univ-rennes.fr"));
        for refused in ["fr", "", ".", "univ rennes.fr", "univ-rennes.fr/x", "*.univ-rennes.fr"] {
            assert_eq!(domain(refused), None, "{refused}");
        }
    }

}
