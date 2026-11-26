// tonAPI's universities: their settings, as tonAPI's own repository has
// them at the commit this crate is built with (build.rs puts the files in
// the crate; nothing is read at run time, on a server or a phone).

use std::collections::BTreeMap;

use tonapi_config::{EstablishmentFile, HomeworkService, ResolvedUniversity, Sso, UniversityFile};
use url::Url;

use crate::portals::Portal;
use crate::routes;

// One university's files: university.toml, and establishments/<name>.toml.
pub struct Embedded {
    pub id: &'static str,
    pub university: &'static str,
    pub establishments: &'static [(&'static str, &'static str)],
}

include!(concat!(env!("OUT_DIR"), "/universities.rs"));

// A university tonAPI knows, and where its portal and its CAS are: whose
// cookies are whose.
pub struct University {
    pub settings: ResolvedUniversity,
    // The portal's software (portals.rs).
    pub portal: Portal,
    pub portal_host: String,
    // Whether the portal is asked over https (any real one is).
    portal_over_https: bool,
    pub cas_host: String,
    // The path of the CAS's login page, where tonAPI goes for a lost session.
    pub cas_login_path: String,
    // Where Moodle is, when the university's deadlines are read there.
    pub moodle: Option<Url>,
    // The time the university lives by.
    pub timezone: chrono_tz::Tz,
}

impl University {
    // None unless it signs in through a CAS and has one of the portals
    // Node's own session check and account are written for (portals.rs).
    // None too when its settings name certificate files, which aren't in
    // the crate.
    pub fn of(settings: ResolvedUniversity) -> Option<Self> {
        let (kind, portal) = Portal::of(&settings.university.portal)?;
        let Sso::Cas(cas) = &settings.university.sso else { return None };
        if settings.university.tls.is_some() || settings.establishments.values().any(|establishment| establishment.tls.is_some()) {
            return None;
        }
        let portal_host = portal.host_str()?.to_ascii_lowercase();
        let portal_over_https = portal.scheme() == "https";
        let cas_host = cas.base_url.host_str()?.to_ascii_lowercase();
        let cas_login_path = cas.base_url.join("login").ok()?.path().to_string();
        let moodle = match &settings.university.services.homework {
            Some(HomeworkService::MoodleAjax { base_url, .. } | HomeworkService::MoodleWebservice { base_url, .. }) => Some(base_url.clone()),
            _ => None,
        };
        let timezone = settings.university.timezone.parse().ok()?;
        Some(Self { settings, portal: kind, portal_host, portal_over_https, cas_host, cas_login_path, moodle, timezone })
    }
}

impl University {
    // Whether the university is asked over https (any real one is): its
    // cookies then go to nothing else.
    pub(crate) fn asked_over_https(&self) -> bool {
        self.portal_over_https
    }
}

// The settings of one university, read as tonAPI reads its files. tonAPI
// checks them in its own repository; a file it would refuse isn't one it
// has (the tests below load them through tonAPI's own loader all the same).
pub fn read(embedded: &Embedded) -> Option<ResolvedUniversity> {
    let university: UniversityFile = toml::from_str(embedded.university).ok()?;
    let mut establishments = BTreeMap::new();
    for (_, file) in embedded.establishments {
        let establishment: EstablishmentFile = toml::from_str(file).ok()?;
        establishments.insert(establishment.id.clone(), establishment);
    }
    Some(ResolvedUniversity { dir: Default::default(), university, establishments })
}

// The universities answered from here (routes::UNIVERSITIES), by id.
pub fn served() -> BTreeMap<String, University> {
    EMBEDDED
        .iter()
        .filter(|embedded| routes::UNIVERSITIES.contains(&embedded.id))
        .filter_map(|embedded| Some((embedded.id.to_string(), University::of(read(embedded)?)?)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rennes_is_served_with_its_portal_and_its_cas() {
        let served = served();
        let rennes = served.get("univ-rennes").expect("univ-rennes among tonAPI's universities");
        assert_eq!(rennes.portal_host, "services-numeriques.univ-rennes.fr");
        assert_eq!(rennes.cas_host, "sso-cas.univ-rennes.fr");
        assert_eq!(rennes.cas_login_path, "/login");
        assert_eq!(rennes.moodle.as_ref().and_then(|moodle| moodle.host_str()), Some("foad.univ-rennes.fr"));
        // The grades are the IUT's own: the student's component decides.
        assert!(rennes.differs_by_component(tonapi_config::ServiceKind::Grades));
        assert!(!rennes.differs_by_component(tonapi_config::ServiceKind::Homework));
        assert_eq!(served.len(), routes::UNIVERSITIES.len());
        assert!(TONAPI_COMMIT.len() >= 7);
    }

    // Rennes 2 and the Sorbonne Nouvelle, whose portals are not uPortal:
    // served, with the places Node's own settings name for them.
    #[test]
    fn rennes_2_and_the_sorbonne_nouvelle_are_served_at_nodes_own_places() {
        // Node's own settings for a university: shared.js, server.js.
        let node = |university: &str| match university {
            "univ-rennes-2" => (include_str!("../../../../universities/univ-rennes-2/shared.js"), include_str!("../../../../universities/univ-rennes-2/server.js")),
            _ => (include_str!("../../../../universities/univ-sorbonne-nouvelle/shared.js"), include_str!("../../../../universities/univ-sorbonne-nouvelle/server.js")),
        };
        // A value of Node's settings: « export const <name> = '<value>' ».
        let said = |source: &str, name: &str| -> String {
            let declared = format!("export const {name} = '");
            let rest = &source[source.find(&declared).unwrap_or_else(|| panic!("{name} is no longer one of Node's")) + declared.len()..];
            rest[..rest.find('\'').unwrap()].to_string()
        };
        let host = |address: &str| Url::parse(address).unwrap().host_str().unwrap().to_string();

        for (id, portal, cas_login_path) in [("univ-rennes-2", Portal::Drupal, "/login"), ("univ-sorbonne-nouvelle", Portal::Isorbonne, "/cas/login")] {
            let embedded = EMBEDDED.iter().find(|embedded| embedded.id == id).unwrap_or_else(|| panic!("{id} among tonAPI's universities"));
            let university = University::of(read(embedded).unwrap()).unwrap_or_else(|| panic!("{id} is one the gateway can answer for"));
            assert_eq!(university.portal, portal);
            assert!(university.asked_over_https());
            assert_eq!(university.cas_login_path, cas_login_path);
            assert!(university.settings.establishments.is_empty());

            // The same university, the same places, as Node's own settings.
            let (shared, server) = node(id);
            assert_eq!(said(shared, "id"), id);
            assert_eq!(university.portal_host, host(&said(shared, "entOrigin")));
            assert_eq!(university.cas_host, host(&said(shared, "casOrigin")));
            assert_eq!(university.moodle.as_ref().and_then(|moodle| moodle.host_str()), Some(host(&said(shared, "moodleOrigin")).as_str()));
            // Moodle's own CAS login, which tonAPI's `entry = "cas"` is.
            assert!(server.contains("casLoginPath: '/login/index.php?authCAS=CAS'"));
            assert!(embedded.university.contains("entry = \"cas\""));

            assert!(served().contains_key(id), "{id} is one of routes::UNIVERSITIES");
        }
    }

    // The files in the crate are the ones tonAPI's own loader accepts, and
    // reading them here gives what it gives.
    #[test]
    fn the_files_in_the_crate_load_as_tonapi_loads_them() {
        let folder = std::env::temp_dir().join(format!("tafac-gateway-universities-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        // Without the certificates some name: those universities aren't served.
        let names_certificates =
            |embedded: &&Embedded| embedded.university.contains("extra-ca") || embedded.establishments.iter().any(|(_, file)| file.contains("extra-ca"));
        let without_certificates: Vec<&Embedded> = EMBEDDED.iter().filter(|embedded| !names_certificates(embedded)).collect();
        assert!(without_certificates.iter().any(|embedded| embedded.id == "univ-rennes"));
        for embedded in &without_certificates {
            let university = folder.join(embedded.id);
            std::fs::create_dir_all(university.join("establishments")).unwrap();
            std::fs::write(university.join("university.toml"), embedded.university).unwrap();
            for (name, file) in embedded.establishments {
                std::fs::write(university.join("establishments").join(format!("{name}.toml")), file).unwrap();
            }
        }
        let (registry, report) = tonapi_config::Registry::load(&folder);
        assert!(report.is_ok(), "{:?}", report.rejected);
        for embedded in &without_certificates {
            let here = read(embedded).unwrap();
            let theirs = registry.get(embedded.id).unwrap();
            assert_eq!(here.university, theirs.university, "{}", embedded.id);
            assert_eq!(here.establishments.keys().collect::<Vec<_>>(), theirs.establishments.keys().collect::<Vec<_>>());
        }
        let _ = std::fs::remove_dir_all(&folder);
    }
}
