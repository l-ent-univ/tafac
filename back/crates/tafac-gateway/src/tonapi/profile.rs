// The portal: who the student is. The session check and the account are
// both this one question.
//
// Asked with the session's own portal cookies and nothing else: tonAPI
// cannot open another portal session, which Node wouldn't have
// (session/handed.rs). A portal that no longer knows the session is
// tonAPI's `session_expired`: the gateway asks the CAS whether the session
// is over, and if it isn't, Node signs in to the portal again.

use tonapi_core::Profile;
use tonapi_providers::{Context, NetSettings};
use tonapi_session::StoredCookie;

use super::{answered, bounded, session_data, Unanswered, PORTAL_PATIENCE};
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
