// The portal: the applications it lists for the student.
//
// tonAPI reads the portal's layout into a list (an id, a title, a
// description, the application's own address, a category, whether the
// student starred it on the portal), with the address each tile really
// opens, which the portal says tile by tile and tonAPI keeps for everyone.
//
// Asked as a service is (mod.rs: Service), with the CAS ticket and never
// the portal's cookies of the session's cookie: those are the ones Node's
// own portal requests go with (session/handed.rs). tonAPI opens a portal
// session of its own with the ticket, which the session holds in this
// process for the next question, and opens again by itself when the portal
// forgot it.

use tonapi_config::ServiceKind;
use tonapi_core::App;

use super::{Asked, Service, Unanswered};

pub(crate) async fn read(service: &Service<'_>) -> Result<Asked<Vec<App>>, Unanswered> {
    service.ask(ServiceKind::Apps, async |context| tonapi_providers::apps(context).await).await
}
