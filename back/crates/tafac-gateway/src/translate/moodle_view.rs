// GET /__ent_auth/moodle/view: what Moodle's view in the apps may show as
// its page (src-tauri/src/moodle.rs). The app asks rather than trust the
// page for it, so the answer is the signed-in university's.
//
// Node's answers (server/entAuthApp.js, server/moodleView/policy.ts), both
// given here for a session the gateway holds:
//
//   200 { home, hosts, domains, signIn }
//       home     Moodle's dashboard, where the view opens
//       hosts,   the university's own services, as the launch relay knows
//       domains  them (launch/targets.rs): they load in the view, any other
//                address opens in the student's browser
//       signIn   the hosts of the sign-in chain other than Moodle's (the
//                CAS, the federation's WAYF, the IdP): a page there, or
//                Moodle's own login page, is a student signed out
//   404 { ok: false }: a university without Moodle, or with one that isn't
//       over https.
//
// `hosts` lists the addresses tonAPI's settings name where Node listed its
// own: at Rennes the two differ by two hosts (the webmail's API here, ADE's
// mobile API there), every one of which is under a domain of `domains`,
// which is Node's list as it was.
//
// 404 { ok: false } for nobody signed in, another university: answered
// here too (gateway/nobody.rs).

use std::collections::BTreeSet;

use super::json_response;
use crate::launch::targets::{own, Targets};
use crate::universities::University;

pub fn policy(university: &University) -> Option<serde_json::Value> {
    let moodle = university.moodle.as_ref().filter(|moodle| moodle.scheme() == "https")?;
    let moodle_host = moodle.host_str()?.to_ascii_lowercase();
    let home = format!("{}/my/", moodle.as_str().trim_end_matches('/'));
    let targets = Targets::of(&university.settings);
    let hosts: BTreeSet<&str> = std::iter::once(moodle_host.as_str()).chain(targets.hosts()).collect();
    let domains: Vec<&str> = targets.domains().collect();
    let through = own(&university.settings.university.id).moodle_sign_in.iter().map(|domain| domain.trim().to_ascii_lowercase());
    let sign_in: BTreeSet<String> = std::iter::once(university.cas_host.clone()).chain(through).filter(|host| !host.is_empty() && *host != moodle_host).collect();
    Some(serde_json::json!({ "home": home, "hosts": hosts, "domains": domains, "signIn": sign_in }))
}

pub fn translate(university: &University) -> http::Response<Vec<u8>> {
    match policy(university) {
        Some(policy) => json_response(200, serde_json::to_vec(&policy).unwrap_or_default()),
        None => json_response(404, br#"{"ok":false}"#.to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::universities;

    fn university(file: &str) -> University {
        let settings = tonapi_config::ResolvedUniversity { dir: Default::default(), university: toml::from_str(file).unwrap(), establishments: Default::default() };
        University::of(settings).unwrap()
    }

    // What Node's own tests hold its policy to (tests/moodleView.test.ts).
    #[test]
    fn rennes_moodle_its_cas_and_the_federations_hosts_are_the_universitys() {
        let served = universities::served();
        let policy = policy(&served["univ-rennes"]).unwrap();
        assert_eq!(policy["home"], "https://foad.univ-rennes.fr/my/");
        let listed = |name: &str| -> Vec<String> { policy[name].as_array().unwrap().iter().map(|host| host.as_str().unwrap().to_string()).collect() };
        assert!(listed("hosts").contains(&"foad.univ-rennes.fr".to_string()));
        assert!(listed("hosts").contains(&"sso-cas.univ-rennes.fr".to_string()));
        assert!(listed("hosts").is_sorted());
        // Node's list, as it was.
        assert_eq!(listed("domains"), ["ident-shib.univ-rennes1.fr", "iut-lannion.loxya.app", "partage.renater.fr", "univ-rennes.fr", "univ-rennes1.fr", "wayf.univ-rennes.fr"]);
        assert_eq!(listed("signIn"), ["ident-shib.univ-rennes1.fr", "sso-cas.univ-rennes.fr", "wayf.univ-rennes.fr"]);

        let response = translate(&served["univ-rennes"]);
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }

    const WITHOUT_MOODLE: &str = r#"
        id = "univ-test"
        name = "Université de test"
        [sso]
        kind = "cas"
        base-url = "https://cas.exemple.test/cas/"
        [portal]
        kind = "uportal5"
        base-url = "https://ent.exemple.test/"
    "#;

    fn with_moodle(address: &str) -> String {
        format!("{WITHOUT_MOODLE}\n[services.homework]\nprovider = \"moodle-ajax\"\nbase-url = \"{address}\"\nentry = \"cas\"\n")
    }

    #[test]
    fn a_moodle_and_its_cas_without_a_federation() {
        let policy = policy(&university(&with_moodle("https://moodle.exemple.test/moodle"))).unwrap();
        assert_eq!(
            policy,
            serde_json::json!({
                "home": "https://moodle.exemple.test/moodle/my/",
                "hosts": ["cas.exemple.test", "ent.exemple.test", "moodle.exemple.test"],
                "domains": [],
                "signIn": ["cas.exemple.test"],
            })
        );
        // A Moodle on the CAS's own host isn't a sign-in page of its own.
        let same_host = super::policy(&university(&with_moodle("https://cas.exemple.test/moodle/"))).unwrap();
        assert_eq!(same_host["signIn"], serde_json::json!([]));
    }

    #[test]
    fn never_a_moodle_over_plain_http_nor_one_there_isnt() {
        for file in [WITHOUT_MOODLE.to_string(), with_moodle("http://moodle.exemple.test/")] {
            let university = university(&file);
            assert!(policy(&university).is_none());
            let response = translate(&university);
            assert_eq!(response.status(), 404);
            assert_eq!(response.body(), br#"{"ok":false}"#);
            assert_eq!(response.headers()["cache-control"], "no-store");
        }
    }
}
