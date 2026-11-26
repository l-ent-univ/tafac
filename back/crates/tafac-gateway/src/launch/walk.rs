// The steps of the relay: a service's sign-in walked with the CAS ticket,
// as far as the address the browser is sent to (server/entAuthApp.js:
// previewServerLaunch, and the walk of GET /__ent_auth/launch).
//
// A service behind the CAS answers a visitor it doesn't know with a
// redirect to the CAS, which, shown the ticket, redirects back to the
// service with a service ticket in the address. The walk stops there: the
// browser makes that last step, and the service ticket signs it in.
//
// The jar the walk asks with holds the CAS ticket and nothing else of the
// student's: a cookie goes to the host that set it, so the ticket goes to
// the CAS only, and a service is asked as a visitor it has never seen.
// Every address asked is one of the university's (targets.rs).

use http::header::{ACCEPT, CONTENT_TYPE, LOCATION, ORIGIN, REFERER};
use http::{HeaderMap, HeaderValue, Method};
use tonapi_http::Browser;
use url::Url;

use super::html;
use super::targets::Targets;

pub(crate) const ACCEPT_HTML: &str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
// How many steps a launch may take (Node's), and the preview fewer.
const LAUNCH_STEPS: usize = 15;
const PREVIEW_STEPS: usize = 8;

// What the walks know of the university.
pub(crate) struct Relay<'a> {
    pub targets: &'a Targets,
    // The CAS's host: where the ticket signs in.
    pub cas_host: &'a str,
}

impl Relay<'_> {
    pub(crate) fn is_cas(&self, url: &Url) -> bool {
        !self.cas_host.is_empty() && host(url) == self.cas_host
    }
}

pub(crate) fn host(url: &Url) -> &str {
    url.host_str().unwrap_or_default()
}

// The chain broke: no answer, or an address that isn't one.
pub(crate) struct Broken;

pub(crate) struct Answered {
    pub status: u16,
    // The Location header, as it came.
    pub location: Option<String>,
    pub body: String,
}

impl Answered {
    pub(crate) fn is_redirect(&self) -> bool {
        [301, 302, 303, 307, 308].contains(&self.status)
    }
}

async fn asked(browser: &mut Browser, method: Method, url: &Url, headers: HeaderMap, body: Option<String>) -> Result<Answered, Broken> {
    let (status, headers, body) = browser.send(method, url.clone(), headers, body, None).await.map_err(|_| Broken)?;
    let location = headers.get(LOCATION).and_then(|value| value.to_str().ok()).map(str::to_string);
    Ok(Answered { status: status.as_u16(), location, body })
}

pub(crate) async fn get(browser: &mut Browser, url: &Url) -> Result<Answered, Broken> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static(ACCEPT_HTML));
    asked(browser, Method::GET, url, headers, None).await
}

// A form posted as a browser posts it, from the page it was on.
pub(crate) async fn post(browser: &mut Browser, url: &Url, fields: &[(String, String)], page: &Url) -> Result<Answered, Broken> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static(ACCEPT_HTML));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/x-www-form-urlencoded"));
    for (name, value) in [(ORIGIN, url.origin().ascii_serialization()), (REFERER, page.to_string())] {
        headers.insert(name, HeaderValue::from_str(&value).map_err(|_| Broken)?);
    }
    let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(fields).finish();
    asked(browser, Method::POST, url, headers, Some(body)).await
}

// Where a launch ends.
pub(crate) enum Launched {
    // Where the browser goes: the service with its ticket, or as it is.
    To(Url),
    // The CAS showed its login form, at this address: the session may be
    // over (the gateway asks the CAS).
    AtCasForm(Url),
    Broken,
}

// GET /__ent_auth/launch, for any service but a federated Moodle. `start`:
// where the walk starts (the target, or the address a service signs in at).
pub(crate) async fn launch(browser: &mut Browser, relay: &Relay<'_>, target: &Url, start: Url) -> Launched {
    let service = host(&start).to_string();
    let mut current = start;
    for _ in 0..LAUNCH_STEPS {
        let Ok(answered) = get(browser, &current).await else { return Launched::Broken };
        let location = answered.location.as_deref().filter(|_| answered.is_redirect());
        if !answered.is_redirect() {
            if let Some(next) = html::written_redirect(&answered.body, &current) {
                // Leaving the university's services: the browser takes it
                // from the target.
                if !relay.targets.is_allowed(&next) {
                    return Launched::To(target.clone());
                }
                current = next;
                continue;
            }
            if relay.is_cas(&current) && html::is_cas_login(&answered.body) {
                return Launched::AtCasForm(current);
            }
            return Launched::To(current);
        }
        let Some(location) = location else { return Launched::To(current) };
        let Ok(next) = current.join(location) else { return Launched::Broken };
        if relay.is_cas(&current) && !relay.is_cas(&next) {
            // The CAS sends back to the service: the address with the
            // ticket, for the browser. To another host, it is a federation
            // (the CAS answers an IdP, whose own session can't be handed to
            // a browser): the browser signs in by itself.
            let with_ticket = host(&next) == service && matches!(next.scheme(), "http" | "https");
            return Launched::To(if with_ticket { next } else { target.clone() });
        }
        if !relay.targets.is_allowed(&next) {
            return Launched::To(target.clone());
        }
        current = next;
    }
    Launched::To(target.clone())
}

// One step of a chain, as the preview tells it.
#[derive(serde::Serialize)]
pub(crate) struct Step {
    pub status: u16,
    pub url: String,
    pub location: Option<String>,
}

// What the preview found of a target: whether the launch relay signs in to
// it (`use_server_launch`), by which way (`reason`: Node's own words, which
// the page reads none of but the debug menu shows), and the chain.
pub(crate) struct Previewed {
    pub final_url: String,
    pub chain: Vec<Step>,
    pub use_server_launch: bool,
    pub saml: bool,
    pub reason: &'static str,
    pub error: Option<&'static str>,
}

// GET /__ent_auth/launch-preview. `written`: the target as the page wrote
// it, which the answer repeats.
pub(crate) async fn preview(browser: &mut Browser, relay: &Relay<'_>, written: &str, target: &Url) -> Previewed {
    let mut chain = Vec::new();
    let found = follow(browser, relay, written, target, &mut chain).await;
    let (final_url, use_server_launch, reason) = found.unwrap_or_else(|Broken| (written.to_string(), false, "preview-error"));
    let error = ["too-many-redirects", "preview-error"].into_iter().find(|error| *error == reason);
    Previewed { final_url, chain, use_server_launch, saml: reason == "saml-browser-handoff", reason, error }
}

// Where the chain leads, whether the relay signs in there, and why.
async fn follow(browser: &mut Browser, relay: &Relay<'_>, written: &str, target: &Url, chain: &mut Vec<Step>) -> Result<(String, bool, &'static str), Broken> {
    let by_the_browser = |reason| Ok((written.to_string(), false, reason));
    let mut current = target.clone();
    // The first address as the page wrote it, the next ones as they resolve.
    let mut shown = written.to_string();
    for _ in 0..PREVIEW_STEPS {
        let answered = get(browser, &current).await?;
        chain.push(Step { status: answered.status, url: shown.clone(), location: answered.location.clone() });
        if let Some(location) = answered.location.as_deref().filter(|_| answered.is_redirect()) {
            let next = current.join(location).map_err(|_| Broken)?;
            if !relay.is_cas(&current) && relay.is_cas(&next) {
                return Ok((next.into(), true, "cas-login"));
            }
            if relay.is_cas(&current) && !relay.is_cas(&next) {
                return if host(&next) == host(target) { Ok((next.into(), true, "cas-ticket")) } else { by_the_browser("saml-browser-handoff") };
            }
            // The chain leaves the university's services: the browser
            // follows it.
            if !relay.targets.is_allowed(&next) {
                return by_the_browser("direct-browser-launch");
            }
            shown = next.to_string();
            current = next;
            continue;
        }
        if let Some(next) = html::written_redirect(&answered.body, &current) {
            if !relay.is_cas(&current) && relay.is_cas(&next) {
                return Ok((next.into(), true, "cas-html-redirect"));
            }
            if !relay.targets.is_allowed(&next) {
                return by_the_browser("direct-browser-launch");
            }
            shown = next.to_string();
            current = next;
            continue;
        }
        return match html::read(&answered.body, &current, false) {
            html::Page::Posting(form) if relay.is_cas(&form.action) => Ok((form.action.into(), true, "cas-form")),
            html::Page::Posting(_) => Ok((shown, false, "browser-form-handoff")),
            _ => Ok((shown, false, "direct-browser-launch")),
        };
    }
    Ok((shown, false, "too-many-redirects"))
}
