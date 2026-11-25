// tonAPI's universities: their settings, as tonAPI's own repository has
// them at the commit this crate is built with (build.rs puts the files in
// the crate; nothing is read at run time, on a server or a phone).

use std::collections::BTreeMap;

use tonapi_config::{EstablishmentFile, HomeworkService, PortalConfig, ResolvedUniversity, Sso, UniversityFile};
use url::Url;

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
    pub portal_host: String,
    pub cas_host: String,
    // The path of the CAS's login page, where tonAPI goes for a lost session.
    pub cas_login_path: String,
    // Where Moodle is, when the university's deadlines are read there.
    pub moodle: Option<Url>,
}

impl University {
    // None unless it signs in through a CAS and has a uPortal 5: the portal
    // Node's own session check and account are written for. None too when
    // its settings name certificate files, which aren't in the crate.
    pub fn of(settings: ResolvedUniversity) -> Option<Self> {
        let PortalConfig::Uportal5 { base_url: portal } = &settings.university.portal else { return None };
        let Sso::Cas(cas) = &settings.university.sso else { return None };
        if settings.university.tls.is_some() || settings.establishments.values().any(|establishment| establishment.tls.is_some()) {
            return None;
        }
        let portal_host = portal.host_str()?.to_ascii_lowercase();
        let cas_host = cas.base_url.host_str()?.to_ascii_lowercase();
        let cas_login_path = cas.base_url.join("login").ok()?.path().to_string();
        let moodle = match &settings.university.services.homework {
            Some(HomeworkService::MoodleAjax { base_url, .. } | HomeworkService::MoodleWebservice { base_url, .. }) => Some(base_url.clone()),
            _ => None,
        };
        Some(Self { settings, portal_host, cas_host, cas_login_path, moodle })
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
