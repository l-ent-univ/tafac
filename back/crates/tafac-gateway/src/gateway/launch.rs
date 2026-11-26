// The launch relay's routes: GET /__ent_auth/launch and its preview
// (launch/ is the relay itself, translate/launch.rs its answers).
//
// Both go the same way:
//
//   the target     `url`, given once: one of the university's services
//                  over https (launch/targets.rs), or the answer is the one
//                  for a target that isn't
//   who asks       a request another site started (launch/site.rs) is
//                  answered as nobody's: nothing is asked of the university
//                  with the session
//   the walk       with a browser of its own that holds the CAS ticket of
//                  the session's cookie and nothing else, thrown away
//                  after: the relay keeps nothing, and the services'
//                  sessions the gateway holds are no part of it

use std::time::Duration;

use url::Url;

use super::{Asked, Gateway};
use crate::launch::moodle::{self, Prepared, SignIn};
use crate::launch::targets::Targets;
use crate::launch::walk::{self, Launched, Relay};
use crate::launch::{self, site};
use crate::session::{handed, Held};
use crate::tonapi::bounded;
use crate::translate::launch as answers;
use crate::translate::settled::Settled;
use crate::universities::University;

// How long a walk may take, as long as a service is waited for
// (tonapi/mod.rs): the browser waits meanwhile on an empty tab.
const WALK_PATIENCE: Duration = Duration::from_secs(20);

// Each `url` of a request's query, decoded. Node takes a target given once:
// given twice it is a list, which is no address.
fn targets_asked(query: Option<&str>) -> Vec<String> {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()).filter(|(name, _)| name == "url").map(|(_, value)| value.into_owned()).collect()
}

// Whether what was asked is written as an address (Node's own first look,
// before any other: http:// or https://, whatever the case).
fn written_as_an_address(written: &str) -> bool {
    let start = written.get(..8).unwrap_or(written).to_ascii_lowercase();
    start.starts_with("http://") || start.starts_with("https://")
}

impl Gateway {
    // GET /__ent_auth/launch, for nobody: to the target when it is one of
    // the university's services, to the app otherwise.
    pub(super) fn launch_for_nobody(university: &University, asked: &Asked<'_>) -> http::Response<Vec<u8>> {
        let targets = Targets::of(&university.settings);
        match targets_asked(asked.query).as_slice() {
            [written] => answers::redirect(targets.allowed(written).as_ref().map_or(answers::APP_PATH, Url::as_str)),
            _ => answers::redirect(answers::APP_PATH),
        }
    }

    // GET /__ent_auth/launch (translate/launch.rs).
    pub(super) async fn launch(&self, held: &Held<'_>, asked: &Asked<'_>) -> Settled {
        let Held { session, university, .. } = held;
        let targets = Targets::of(&university.settings);
        let target = match targets_asked(asked.query).as_slice() {
            [written] => targets.allowed(written),
            _ => None,
        };
        // Only the university's services, never any address: no open
        // redirect from Tafac's own domain, nothing else asked from here.
        let Some(target) = target else { return Settled::Answer(answers::redirect(answers::APP_PATH)) };
        let to_target = || answers::redirect(target.as_str());
        // A link from another site is not the student asking: no sign-in
        // on their behalf.
        if site::is_cross_site(asked.headers) {
            return Settled::Answer(to_target());
        }
        let relay = Relay { targets: &targets, cas_host: &university.cas_host };
        let Some(mut browser) = launch::browser(handed::cas_cookies(university, session), self.net) else { return Settled::Answer(to_target()) };
        let start = match moodle::sign_in(&university.settings, &target) {
            Some(SignIn::Federated(moodle)) => {
                return match bounded(WALK_PATIENCE, moodle::prepare(&mut browser, &relay, &moodle, &target)).await {
                    Ok(Prepared::Handoff(handoff)) => Settled::Answer(answers::handoff(&handoff)),
                    // No way through, whatever the reason: the browser signs
                    // in to Moodle by itself, unless the session is over.
                    Ok(Prepared::AtCasForm | Prepared::Broken) | Err(_) => Settled::Lost { otherwise: to_target() },
                };
            }
            Some(SignIn::ByCas(login)) => login,
            None => target.clone(),
        };
        match bounded(WALK_PATIENCE, walk::launch(&mut browser, &relay, &target, start)).await {
            Ok(Launched::To(address)) => Settled::Answer(answers::redirect(address.as_str())),
            // The CAS asks for the password: signed out when it is the
            // session that is gone, not a service asking for more.
            Ok(Launched::AtCasForm(address)) => Settled::Lost { otherwise: answers::redirect(address.as_str()) },
            Ok(Launched::Broken) | Err(_) => Settled::Lost { otherwise: to_target() },
        }
    }

    // What the preview answers before anyone's session matters: no target,
    // or one that isn't one of the university's services. Otherwise the
    // target, as it was written and as it reads.
    fn previewed_target(targets: &Targets, asked: &Asked<'_>) -> Result<(String, Url), http::Response<Vec<u8>>> {
        let written = targets_asked(asked.query);
        // Given twice, Node reads them as one text for this first look.
        let as_one = written.join(",");
        if !written_as_an_address(&as_one) {
            return Err(answers::invalid_target(&as_one));
        }
        let [only] = written.as_slice() else {
            return Err(answers::by_the_browser(&serde_json::json!(written), "target-not-allowed"));
        };
        match targets.allowed(only) {
            Some(target) => Ok((only.clone(), target)),
            // Not one of this university's services: the browser opens it
            // itself.
            None => Err(answers::by_the_browser(&only.as_str().into(), "target-not-allowed")),
        }
    }

    // GET /__ent_auth/launch-preview, for nobody.
    pub(super) fn preview_for_nobody(university: &University, asked: &Asked<'_>) -> http::Response<Vec<u8>> {
        match Self::previewed_target(&Targets::of(&university.settings), asked) {
            Ok((written, _)) => answers::by_the_browser(&written.into(), "missing-session"),
            Err(answer) => answer,
        }
    }

    // GET /__ent_auth/launch-preview (translate/launch.rs).
    pub(super) async fn launch_preview(&self, held: &Held<'_>, asked: &Asked<'_>) -> Settled {
        let Held { session, university, .. } = held;
        let targets = Targets::of(&university.settings);
        let (written, target) = match Self::previewed_target(&targets, asked) {
            Ok(target) => target,
            Err(answer) => return Settled::Answer(answer),
        };
        // Asked from another site: no request is made with the session.
        if site::is_cross_site(asked.headers) {
            return Settled::Answer(answers::by_the_browser(&written.into(), "missing-session"));
        }
        match moodle::sign_in(&university.settings, &target) {
            Some(SignIn::Federated(_)) => return Settled::Answer(answers::moodle(&written, "server-saml-relay")),
            Some(SignIn::ByCas(_)) => return Settled::Answer(answers::moodle(&written, "moodle-cas-relay")),
            None => {}
        }
        let relay = Relay { targets: &targets, cas_host: &university.cas_host };
        let broken = || walk::Previewed { final_url: written.clone(), chain: Vec::new(), use_server_launch: false, saml: false, reason: "preview-error", error: Some("preview-error") };
        let Some(mut browser) = launch::browser(handed::cas_cookies(university, session), self.net) else { return Settled::Answer(answers::preview(&broken())) };
        let previewed = bounded(WALK_PATIENCE, walk::preview(&mut browser, &relay, &written, &target)).await.unwrap_or_else(|_| broken());
        Settled::Answer(answers::preview(&previewed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_is_the_one_url_of_the_query() {
        assert_eq!(targets_asked(Some("url=https%3A%2F%2Fa.test%2F%3Fx%3D1%26y%3D2&debug=1")), ["https://a.test/?x=1&y=2"]);
        assert_eq!(targets_asked(Some("url=a&url=b")), ["a", "b"]);
        assert!(targets_asked(Some("URL=a&next=b")).is_empty() && targets_asked(None).is_empty());
        assert!(written_as_an_address("HTTPS://a.test/") && written_as_an_address("http://a"));
        for written in ["", "//a.test/", "/x", "javascript:alert(1)", "ftp://a.test/", " https://a.test/", "https:/a.test/", "é"] {
            assert!(!written_as_an_address(written), "{written}");
        }
    }
}
