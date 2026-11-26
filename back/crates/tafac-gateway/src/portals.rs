// What differs from one portal software to another, for the routes a portal
// answers (the sign-in, the session check, the account, the applications).
//
// tonAPI reads each portal with a provider of its own, into the same
// profile and the same list of applications; Node read each its own way
// (server/portalSession.js: auth.portal). What is left to tell apart here
// is small:
//
//   Uportal     uPortal 5 (Rennes). The portal names the student (its
//               userinfo's `sub`): that name is the session's `user`. Its
//               applications are known by the portal's own names (fname).
//   Drupal      a Drupal site behind the CAS (Rennes 2): the session shows
//               on a page's body class, the name on /user, the applications
//               on a catalogue page.
//   Isorbonne   the Sorbonne Nouvelle's own JSF portal: one page has the
//               logout link (and the name in it) and the tiles.
//
// The last two give no login of the student's: the session's `user` is the
// login typed, trimmed and in lower case, as Node keeps it
// (normalizeLoginIdentifier). And Node listed their applications under ids
// of its own making (buildPortalApps: `portal-tool-<id>`), which the page
// keeps a favourite by: the list goes out with those.
//
// A portal of another software is not one the gateway answers for: its
// university is Node's (universities.rs).

use tonapi_config::PortalConfig;
use tonapi_core::App;
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Portal {
    Uportal,
    Drupal,
    Isorbonne,
}

// What Node put before a tool's id, for the portals it read itself.
const TOOL_ID: &str = "portal-tool-";

impl Portal {
    // The portal of a university's settings, and its address there; None
    // for one the gateway doesn't answer for.
    pub(crate) fn of(settings: &PortalConfig) -> Option<(Self, &Url)> {
        match settings {
            PortalConfig::Uportal5 { base_url } => Some((Portal::Uportal, base_url)),
            PortalConfig::Drupal { base_url, .. } => Some((Portal::Drupal, base_url)),
            PortalConfig::Isorbonne { base_url } => Some((Portal::Isorbonne, base_url)),
            _ => None,
        }
    }

    // Whether the portal says the student's login itself.
    pub(crate) fn names_the_student(self) -> bool {
        self == Portal::Uportal
    }

    // tonAPI's list, under the ids the page knows each application by.
    pub(crate) fn as_the_page_knows_them(self, mut apps: Vec<App>) -> Vec<App> {
        if self != Portal::Uportal {
            for app in &mut apps {
                app.id.insert_str(0, TOOL_ID);
            }
        }
        apps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str) -> App {
        App { id: id.to_string(), title: "Outil".to_string(), description: None, url: "https://outil.exemple.test/".to_string(), icon_url: None, category: None, favorite: false }
    }

    #[test]
    fn a_tool_keeps_the_id_node_gave_it() {
        let ids = |portal: Portal| portal.as_the_page_knows_them(vec![app("tempo"), app("35")]).into_iter().map(|app| app.id).collect::<Vec<_>>();
        assert_eq!(ids(Portal::Drupal), ["portal-tool-tempo", "portal-tool-35"]);
        assert_eq!(ids(Portal::Isorbonne), ["portal-tool-tempo", "portal-tool-35"]);
        // uPortal's own names are the ids, as they always were.
        assert_eq!(ids(Portal::Uportal), ["tempo", "35"]);
        // The prefix is the one Node writes.
        assert!(include_str!("../../../../server/portalSession.js").contains(&format!("id: `{TOOL_ID}${{tool.id}}`")));
    }

    #[test]
    fn only_the_portals_node_reads_are_answered_for() {
        let at = |kind: &str| -> PortalConfig { toml::from_str(&format!("kind = \"{kind}\"\nbase-url = \"https://ent.exemple.test/\"")).unwrap() };
        assert_eq!(Portal::of(&at("uportal5")).map(|(portal, _)| portal), Some(Portal::Uportal));
        assert_eq!(Portal::of(&at("drupal")).map(|(portal, _)| portal), Some(Portal::Drupal));
        assert_eq!(Portal::of(&at("isorbonne")).map(|(portal, _)| portal), Some(Portal::Isorbonne));
        assert!(Portal::of(&at("uportal4-prolongation")).is_none());
        assert!(Portal::of(&at("tiles-portal")).is_none());
        assert!(Portal::of(&PortalConfig::None).is_none());
        assert!(Portal::Uportal.names_the_student());
        assert!(!Portal::Drupal.names_the_student() && !Portal::Isorbonne.names_the_student());
    }
}
