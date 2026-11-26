// The portal: who the student is. The session check and the account are
// both this one question, asked one of two ways:
//
//   read       with the portal cookies of the session's cookie and nothing
//              else: one request, and no other portal session opened. A
//              portal that no longer knows that session is tonAPI's
//              `session_expired`
//   read_own   as a service is asked (mod.rs: Service), with the CAS ticket
//              and what the session holds in this process: tonAPI opens a
//              portal session of its own with the ticket, held from then
//              on, and opens it again by itself when the portal forgot it.
//              Then `session_expired` is the CAS's own refusal
//
// The gateway asks the first way while the cookie's portal session lives,
// and the second from the moment it doesn't (gateway/portal.rs).

use tonapi_config::ServiceKind;
use tonapi_core::Profile;
use tonapi_providers::{Context, NetSettings};
use tonapi_session::StoredCookie;

use super::{answered, bounded, session_data, Service, Unanswered, PORTAL_PATIENCE};
use crate::session::cookie::Session;
use crate::session::handed;
use crate::universities::University;

// `sent`: the session's portal cookies (handed::portal_cookies).
pub(crate) async fn read(university: &University, session: &Session, sent: &[StoredCookie], net: NetSettings) -> Result<Profile, Unanswered> {
    if sent.is_empty() {
        return Err(Unanswered::NoPortalSession);
    }
    let mut data = session_data(university, session, sent.to_vec())?;
    let mut context = Context { university: &university.settings, session: &mut data, now: chrono::Utc::now(), net };
    let profile = answered(bounded(PORTAL_PATIENCE, tonapi_providers::profile(&mut context)).await)?;
    if !handed::still_held(sent, &data.cookies) {
        return Err(Unanswered::CookiesChanged);
    }
    Ok(profile)
}

pub(crate) async fn read_own(service: &Service<'_>) -> Result<Profile, Unanswered> {
    service.ask(ServiceKind::Profile, async |context| tonapi_providers::profile(context).await).await.map(|asked| asked.value)
}
